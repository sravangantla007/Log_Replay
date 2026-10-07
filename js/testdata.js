/**
 * @file testdata.js
 * @description ES module that generates synthetic binary flight log data matching
 * the Teensy avionics 21-byte record format.
 * 
 * Simulates a ~40-second model rocket flight profile:
 * - Phase 1 (T=0-5s): Pad idle
 * - Phase 2 (T=5-8s): Boost (ramps to 4g)
 * - Phase 3 (T=8-15s): Coast/burnout (freefall ~0g)
 * - Phase 4 (T=15-25s): Apogee region (~2000m max alt, drogue deployment)
 * - Phase 5 (T=25-40s): Descent under parachute (steady 1g)
 * 
 * Records are written in INTERLEAVED order (as logged by embedded firmware FIFO flushes),
 * not sorted by time. The parser is responsible for sorting chronologically.
 */

import {
  RECORD_SIZE,
  TYPE_IMU,
  TYPE_BARO,
  TYPE_ADXL,
  TYPE_GPS,
  TYPE_BOARD,
} from './parser.js?v=10';

// Flight simulation constants
export const TOTAL_DURATION_MS = 40000; // 40 seconds

// Sensor sampling rates (intervals in milliseconds)
export const IMU_INTERVAL_MS = 5;     // 200 Hz
export const BARO_INTERVAL_MS = 10;   // 100 Hz
export const ADXL_INTERVAL_MS = 10;   // 100 Hz
export const GPS_INTERVAL_MS = 100;   // 10 Hz
export const BOARD_INTERVAL_MS = 500; // 2 Hz

// Flight State Enums
export const STATE_PAD = 1;
export const STATE_BOOST = 2;
export const STATE_COAST = 3;
export const STATE_APOGEE = 4;
export const STATE_DESCENT = 5;

// Pyro State Enums
export const PYRO_ARMED = 0;
export const PYRO_DROGUE_FIRED = 1;
export const PYRO_MAIN_FIRED = 2;

// Base geographic coordinates (Hyderabad, India)
const BASE_LAT = 17.3850;
const BASE_LON = 78.4867;
const PAD_ALTITUDE_M = 500.0; // 500m MSL (500,000 mm)
const APOGEE_ALTITUDE_M = 2000.0; // ~2000m MSL

/**
 * Creates a deterministic Mulberry32 pseudo-random number generator.
 * Ensures consistent, reproducible synthetic flight log data.
 * 
 * @param {number} seed - 32-bit unsigned seed integer.
 * @returns {function(): number} Random float in [0, 1).
 */
function createPRNG(seed = 0x5a17e0) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Numerical clamping helper functions
function clampInt16(val) {
  return Math.max(-32768, Math.min(32767, Math.round(val)));
}

function clampUint8(val) {
  return Math.max(0, Math.min(255, Math.round(val)));
}

function clampInt32(val) {
  return Math.max(-2147483648, Math.min(2147483647, Math.round(val)));
}

function clampUint32(val) {
  return Math.max(0, Math.min(4294967295, Math.round(val)));
}

/**
 * Calculates smooth relative altitude (meters above pad) at given time t (seconds).
 * 
 * @param {number} tSec - Time in seconds.
 * @returns {number} Height above launch pad in meters.
 */
function getRelativeAltitudeMeters(tSec) {
  if (tSec < 5.0) {
    // Phase 1: Pad idle
    return 0.0;
  }
  if (tSec < 8.0) {
    // Phase 2: Boost (5s - 8s), reaches 200m at burnout
    const u = (tSec - 5.0) / 3.0;
    return 200.0 * Math.pow(u, 2.2);
  }
  if (tSec < 18.0) {
    // Phase 3: Coast to apogee at T=18s (delta H = 1500m, total alt = 2000m MSL)
    const u = (tSec - 8.0) / 10.0;
    return 200.0 + 1300.0 * (1.0 - Math.pow(1.0 - u, 2.0));
  }
  if (tSec < 25.0) {
    // Phase 4: Apogee region & drogue chute descent (18s - 25s)
    const u = (tSec - 18.0) / 7.0;
    return 1500.0 - 250.0 * Math.pow(u, 1.2);
  }
  // Phase 5: Main parachute descent (25s - 40s), descending down towards pad
  const u = (tSec - 25.0) / 15.0;
  return 1250.0 - 1150.0 * u;
}

/**
 * Generates a complete synthetic binary flight log buffer.
 * 
 * @param {number} [seed=0x5a17e0] - Optional seed for the PRNG.
 * @returns {ArrayBuffer} 21-byte packed binary log buffer.
 */
export function generateTestData(seed = 0x5a17e0) {
  const prng = createPRNG(seed);

  // Noise generator helpers
  const imuNoise = () => (prng() - 0.5) * 100;   // ±50 counts
  const gyroNoise = () => (prng() - 0.5) * 20;   // ±10 counts
  const baroPNoise = () => (prng() - 0.5) * 0.2; // ±0.1 hPa
  const baroTNoise = () => (prng() - 0.5) * 0.3; // ±0.15 °C
  const adxlNoise = () => (prng() - 0.5) * 30;   // ±15 counts
  const gpsAltNoise = () => (prng() - 0.5) * 2000; // ±1000 mm

  // Total record counts across the 40-second flight
  const countIMU = Math.floor(TOTAL_DURATION_MS / IMU_INTERVAL_MS) + 1;     // 8001 records
  const countBARO = Math.floor(TOTAL_DURATION_MS / BARO_INTERVAL_MS) + 1;   // 4001 records
  const countADXL = Math.floor(TOTAL_DURATION_MS / ADXL_INTERVAL_MS) + 1;   // 4001 records
  const countGPS = Math.floor(TOTAL_DURATION_MS / GPS_INTERVAL_MS) + 1;     // 401 records
  const countBOARD = Math.floor(TOTAL_DURATION_MS / BOARD_INTERVAL_MS) + 1; // 81 records

  const totalRecords = countIMU + countBARO + countADXL + countGPS + countBOARD; // 16,485 records
  const buffer = new ArrayBuffer(totalRecords * RECORD_SIZE);
  const view = new DataView(buffer);

  // Base UTC start timestamp for GPS (e.g. May 2024 epoch)
  const baseUtcTime = 1716000000;

  // Helper to write record header: type(uint8) at offset 0, time(uint32) at offset 1
  function writeRecordHeader(offset, type, time) {
    view.setUint8(offset, type);
    view.setUint32(offset + 1, time, true);
  }

  // Sensor payload writers (payloads start at offset + 5)
  function writeIMU(offset, t) {
    writeRecordHeader(offset, TYPE_IMU, t);
    const tSec = t / 1000.0;
    const pOffset = offset + 5;

    let azBase = 2048; // 1g = 2048 counts
    let gxBase = 0;
    let gyBase = 0;
    let gzBase = 0;
    let axBase = 0;
    let ayBase = 0;

    const omegaRoll = 2 * Math.PI * 1.5; // 1.5 Hz roll rate
    const omegaSway = 2 * Math.PI * 0.35; // 0.35 Hz parachute sway

    if (tSec < 5.0) {
      // Phase 1: Pad idle. az ≈ 2048 (1g up), ax≈0, ay≈0, gyros≈0
      azBase = 2048;
      axBase = 0;
      ayBase = 0;
      gxBase = 0;
      gyBase = 0;
      gzBase = 0;
    } else if (tSec < 8.0) {
      // Phase 2: Boost. az ramps from 2048 to 8192 (4g)
      const u = (tSec - 5.0) / 3.0;
      azBase = 2048.0 + (8192.0 - 2048.0) * u;

      // Roll oscillation and dynamic body rates during boost
      const rollRate = u * 1800.0;
      gzBase = rollRate * Math.sin(omegaRoll * tSec);
      gxBase = 200.0 * Math.sin(omegaRoll * 0.7 * tSec);
      gyBase = 200.0 * Math.cos(omegaRoll * 0.7 * tSec);
      axBase = 90.0 * Math.sin(omegaRoll * tSec);
      ayBase = 90.0 * Math.cos(omegaRoll * tSec);
    } else if (tSec < 15.0) {
      // Phase 3: Coast/burnout. IMU az ≈ 0 (freefall)
      azBase = 0;

      // Decaying roll rate during coast
      const decay = Math.exp(-(tSec - 8.0) / 4.0);
      gzBase = 1800.0 * decay * Math.sin(omegaRoll * tSec);
      gxBase = 150.0 * decay * Math.sin(omegaRoll * 0.7 * tSec);
      gyBase = 150.0 * decay * Math.cos(omegaRoll * 0.7 * tSec);
      axBase = 50.0 * decay * Math.sin(omegaRoll * tSec);
      ayBase = 50.0 * decay * Math.cos(omegaRoll * tSec);
    } else if (tSec < 25.0) {
      // Phase 4: Apogee region. IMU az slowly returns toward 2048
      const u = (tSec - 15.0) / 10.0;
      azBase = 2048.0 * u;

      // Drogue deployment deceleration spike at T ≈ 18.5s - 19.5s
      if (tSec >= 18.5 && tSec <= 19.5) {
        azBase += 1200.0 * Math.sin((tSec - 18.5) * Math.PI);
      }

      // Transition to gentle body sway
      gzBase = 50.0 * Math.sin(omegaSway * tSec);
      gxBase = 80.0 * Math.cos(omegaSway * tSec);
      gyBase = 80.0 * Math.sin(omegaSway * tSec);
      axBase = 40.0 * Math.sin(omegaSway * tSec);
      ayBase = 40.0 * Math.cos(omegaSway * tSec);
    } else {
      // Phase 5: Descent under parachute. IMU az ≈ 2048 (1g)
      azBase = 2048.0;

      // Gentle pendulum sway under canopy
      gzBase = 40.0 * Math.sin(omegaSway * tSec);
      gxBase = 70.0 * Math.cos(omegaSway * tSec);
      gyBase = 70.0 * Math.sin(omegaSway * tSec);
      axBase = 35.0 * Math.sin(omegaSway * tSec);
      ayBase = 35.0 * Math.cos(omegaSway * tSec);
    }

    view.setInt16(pOffset, clampInt16(axBase + imuNoise()), true);
    view.setInt16(pOffset + 2, clampInt16(ayBase + imuNoise()), true);
    view.setInt16(pOffset + 4, clampInt16(azBase + imuNoise()), true);
    view.setInt16(pOffset + 6, clampInt16(gxBase + gyroNoise()), true);
    view.setInt16(pOffset + 8, clampInt16(gyBase + gyroNoise()), true);
    view.setInt16(pOffset + 10, clampInt16(gzBase + gyroNoise()), true);
  }

  function writeBARO(offset, t) {
    writeRecordHeader(offset, TYPE_BARO, t);
    const tSec = t / 1000.0;
    const pOffset = offset + 5;

    const hRel = getRelativeAltitudeMeters(tSec);
    // Standard barometric pressure formula referenced to pad (1013.25 hPa at pad level)
    const pressureClean = 1013.25 * Math.pow(1.0 - 2.25577e-5 * hRel, 5.25588);
    const tempClean = 25.0 - 0.0065 * hRel; // Standard lapse rate ~6.5°C per 1000m

    const pressure = pressureClean + baroPNoise();
    const temp = tempClean + baroTNoise();

    view.setFloat32(pOffset, pressure, true);
    view.setFloat32(pOffset + 4, temp, true);
  }

  function writeADXL(offset, t) {
    writeRecordHeader(offset, TYPE_ADXL, t);
    const tSec = t / 1000.0;
    const pOffset = offset + 5;

    let axBase = 0;
    let ayBase = 0;
    let azBase = 0;

    if (tSec < 5.0) {
      // Phase 1: Near zero
      azBase = 0;
    } else if (tSec < 8.0) {
      // Phase 2: Boost acceleration (ramps up to ~1600 counts on high-g sensor)
      const u = (tSec - 5.0) / 3.0;
      azBase = 1600.0 * u;
    } else if (tSec < 15.0) {
      // Phase 3: Coast (near zero in freefall)
      azBase = 0;
    } else if (tSec < 25.0) {
      // Phase 4: Near zero with deployment pulse
      if (tSec >= 18.5 && tSec <= 19.5) {
        azBase = 450.0 * Math.sin((tSec - 18.5) * Math.PI);
      } else {
        azBase = 0;
      }
    } else {
      // Phase 5: Descent under chute (near zero relative to high-G range)
      azBase = 0;
    }

    view.setInt16(pOffset, clampInt16(axBase + adxlNoise()), true);
    view.setInt16(pOffset + 2, clampInt16(ayBase + adxlNoise()), true);
    view.setInt16(pOffset + 4, clampInt16(azBase + adxlNoise()), true);
  }

  function writeGPS(offset, t) {
    writeRecordHeader(offset, TYPE_GPS, t);
    const tSec = t / 1000.0;
    const pOffset = offset + 5;

    // Slight wind drift during flight
    const driftLat = tSec > 5.0 ? (tSec - 5.0) * 0.000002 : 0;
    const driftLon = tSec > 5.0 ? (tSec - 5.0) * 0.000003 : 0;

    const lat = clampInt32((BASE_LAT + driftLat) * 1e7);
    const lon = clampInt32((BASE_LON + driftLon) * 1e7);

    const hRel = getRelativeAltitudeMeters(tSec);
    const altMslMm = (PAD_ALTITUDE_M + hRel) * 1000.0;
    const gpsAlt = clampInt32(altMslMm + gpsAltNoise());

    view.setInt32(pOffset, lat, true);
    view.setInt32(pOffset + 4, lon, true);
    view.setInt32(pOffset + 8, gpsAlt, true);
  }

  function writeBOARD(offset, t) {
    writeRecordHeader(offset, TYPE_BOARD, t);
    const tSec = t / 1000.0;
    const pOffset = offset + 5;

    // Board temperature (°C) slowly rises from 28°C to 34°C
    const temp = clampUint8(28 + Math.min(6, (tSec / 40.0) * 6));

    // Battery voltage (decivolts, e.g. 84 = 8.4V LiPo, drops slightly under pyro load)
    const vBatt = clampUint8(84 - (tSec > 18.5 ? 2 : 0) - Math.floor(tSec / 20.0));

    // Flight state transitions
    let state = STATE_PAD;
    if (tSec >= 25.0) {
      state = STATE_DESCENT;
    } else if (tSec >= 18.0) {
      state = STATE_APOGEE;
    } else if (tSec >= 8.0) {
      state = STATE_COAST;
    } else if (tSec >= 5.0) {
      state = STATE_BOOST;
    }

    const errorCode = 0;

    // Pyro state transitions
    let pyroState = PYRO_ARMED;
    if (tSec >= 25.0) {
      pyroState = PYRO_MAIN_FIRED;
    } else if (tSec >= 18.5) {
      pyroState = PYRO_DROGUE_FIRED;
    }

    // Telemetry RSSI (dBm), dips as altitude increases
    const hRel = getRelativeAltitudeMeters(tSec);
    const rssi = clampUint8(95 - Math.round((hRel / 1500.0) * 18) + Math.round((prng() - 0.5) * 2));

    view.setUint8(pOffset, 0); // cmd
    view.setUint8(pOffset + 1, 0); // cmd_param
    view.setUint8(pOffset + 2, vBatt); // v_batt
    view.setUint8(pOffset + 3, state); // state
    view.setUint8(pOffset + 4, errorCode); // error_code
    view.setUint8(pOffset + 5, 0); // flags (let's say 0 for test data)
    view.setUint8(pOffset + 6, pyroState); // pyro_state
    view.setUint8(pOffset + 7, rssi); // RSSI
  }

  // Write records in INTERLEAVED batch blocks (simulating embedded FIFO flush cycles)
  // Each 100ms window flushes IMU samples, then BARO, then ADXL, then GPS, then BOARD.
  // This causes timestamps to jump backwards within each window (e.g. BARO t=0 after IMU t=95),
  // which the parser will subsequently sort into chronological order.
  const BATCH_WINDOW_MS = 100;
  let recordIndex = 0;

  for (let wStart = 0; wStart <= TOTAL_DURATION_MS; wStart += BATCH_WINDOW_MS) {
    const wEnd = Math.min(TOTAL_DURATION_MS, wStart + BATCH_WINDOW_MS - 1);

    // 1. Flush IMU queue for current window
    for (let t = wStart; t <= wEnd; t += IMU_INTERVAL_MS) {
      writeIMU(recordIndex * RECORD_SIZE, t);
      recordIndex++;
    }

    // 2. Flush BARO queue for current window
    for (let t = wStart; t <= wEnd; t += BARO_INTERVAL_MS) {
      writeBARO(recordIndex * RECORD_SIZE, t);
      recordIndex++;
    }

    // 3. Flush ADXL queue for current window
    for (let t = wStart; t <= wEnd; t += ADXL_INTERVAL_MS) {
      writeADXL(recordIndex * RECORD_SIZE, t);
      recordIndex++;
    }

    // 4. Flush GPS queue for current window
    for (let t = wStart; t <= wEnd; t += GPS_INTERVAL_MS) {
      writeGPS(recordIndex * RECORD_SIZE, t);
      recordIndex++;
    }

    // 5. Flush BOARD queue for current window (every 500ms)
    if (wStart % BOARD_INTERVAL_MS === 0) {
      writeBOARD(recordIndex * RECORD_SIZE, wStart);
      recordIndex++;
    }
  }

  return buffer;
}
