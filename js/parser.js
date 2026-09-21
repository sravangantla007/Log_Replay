/**
 * @file parser.js
 * @description ES module for parsing binary flight log files from a Teensy avionics board.
 * 
 * Binary Record Format (21 bytes packed, little-endian):
 * - Offset 0: uint8_t type (sensor tag)
 * - Offset 1: uint32_t time (millis timestamp)
 * - Offset 5: 16-byte union payload (padded to largest member which is GPS at 16 bytes)
 * 
 * Sensor Types:
 * - 0x01 (IMU):   ax(int16), ay(int16), az(int16), gx(int16), gy(int16), gz(int16) [12 bytes used]
 * - 0x02 (BARO):  pressure(float32), temp(float32) [8 bytes used]
 * - 0x03 (ADXL):  ax(int16), ay(int16), az(int16) [6 bytes used]
 * - 0x04 (GPS):   utc_time(uint32), lat(int32), lon(int32), gps_alt(int32) [16 bytes used]
 * - 0x05 (BOARD): temp(uint8), v_batt(uint8), state(uint8), error_code(uint8), pyro_state(uint8), RSSI(uint8) [6 bytes used]
 */

export const RECORD_SIZE = 21;

export const TYPE_IMU = 0x01;
export const TYPE_BARO = 0x02;
export const TYPE_ADXL = 0x03;
export const TYPE_GPS = 0x04;
export const TYPE_BOARD = 0x05;

/**
 * Format registry mapping sensor type tags to their metadata and parser functions.
 * @type {Map<number, {name: string, parseFunction: function(DataView, number): object}>}
 */
export const sensorRegistry = new Map();

/**
 * Registers or overrides a sensor type in the format registry.
 * 
 * @param {number} tag - 8-bit sensor type tag (0-255).
 * @param {string} name - Human-readable name for the sensor (e.g. 'IMU').
 * @param {function(DataView, number): object} parserFn - Parser function taking (DataView, payloadOffset) and returning parsed data object.
 */
export function registerSensorType(tag, name, parserFn) {
  if (typeof tag !== 'number' || !Number.isInteger(tag) || tag < 0 || tag > 255) {
    throw new TypeError(`Invalid sensor tag: ${tag}. Tag must be an integer between 0 and 255.`);
  }
  if (typeof name !== 'string' || !name.trim()) {
    throw new TypeError('Sensor name must be a non-empty string.');
  }
  if (typeof parserFn !== 'function') {
    throw new TypeError('parserFn must be a function.');
  }

  sensorRegistry.set(tag, {
    name: name.trim(),
    parseFunction: parserFn,
  });
}

// Built-in parser functions for standard Teensy avionics sensors

/**
 * Parses IMU payload (12 bytes used).
 * ax(int16), ay(int16), az(int16), gx(int16), gy(int16), gz(int16)
 * 
 * @param {DataView} view - DataView of the binary log.
 * @param {number} offset - Byte offset where payload starts (recordOffset + 5).
 * @returns {{ax: number, ay: number, az: number, gx: number, gy: number, gz: number}}
 */
function parseIMU(view, offset) {
  return {
    ax: view.getInt16(offset, true),
    ay: view.getInt16(offset + 2, true),
    az: view.getInt16(offset + 4, true),
    gx: view.getInt16(offset + 6, true),
    gy: view.getInt16(offset + 8, true),
    gz: view.getInt16(offset + 10, true),
  };
}

/**
 * Parses BARO payload (8 bytes used).
 * pressure(float32), temp(float32)
 * 
 * @param {DataView} view - DataView of the binary log.
 * @param {number} offset - Byte offset where payload starts (recordOffset + 5).
 * @returns {{pressure: number, temp: number}}
 */
function parseBARO(view, offset) {
  return {
    pressure: view.getFloat32(offset, true),
    temp: view.getFloat32(offset + 4, true),
  };
}

/**
 * Parses ADXL payload (6 bytes used).
 * ax(int16), ay(int16), az(int16)
 * 
 * @param {DataView} view - DataView of the binary log.
 * @param {number} offset - Byte offset where payload starts (recordOffset + 5).
 * @returns {{ax: number, ay: number, az: number}}
 */
function parseADXL(view, offset) {
  return {
    ax: view.getInt16(offset, true),
    ay: view.getInt16(offset + 2, true),
    az: view.getInt16(offset + 4, true),
  };
}

/**
 * Parses GPS payload (16 bytes used).
 * utc_time(uint32), lat(int32), lon(int32), gps_alt(int32)
 * 
 * @param {DataView} view - DataView of the binary log.
 * @param {number} offset - Byte offset where payload starts (recordOffset + 5).
 * @returns {{utc_time: number, lat: number, lon: number, gps_alt: number}}
 */
function parseGPS(view, offset) {
  return {
    utc_time: view.getUint32(offset, true),
    lat: view.getInt32(offset + 4, true),
    lon: view.getInt32(offset + 8, true),
    gps_alt: view.getInt32(offset + 12, true),
  };
}

/**
 * Parses BOARD payload (6 bytes used).
 * temp(uint8), v_batt(uint8), state(uint8), error_code(uint8), pyro_state(uint8), RSSI(uint8)
 * 
 * @param {DataView} view - DataView of the binary log.
 * @param {number} offset - Byte offset where payload starts (recordOffset + 5).
 * @returns {{temp: number, v_batt: number, state: number, error_code: number, pyro_state: number, RSSI: number}}
 */
function parseBOARD(view, offset) {
  return {
    temp: view.getUint8(offset),
    v_batt: view.getUint8(offset + 1),
    state: view.getUint8(offset + 2),
    error_code: view.getUint8(offset + 3),
    pyro_state: view.getUint8(offset + 4),
    RSSI: view.getUint8(offset + 5),
  };
}

// Pre-register standard sensor types
registerSensorType(TYPE_IMU, 'IMU', parseIMU);
registerSensorType(TYPE_BARO, 'BARO', parseBARO);
registerSensorType(TYPE_ADXL, 'ADXL', parseADXL);
registerSensorType(TYPE_GPS, 'GPS', parseGPS);
registerSensorType(TYPE_BOARD, 'BOARD', parseBOARD);

/**
 * Parses a binary flight log buffer and returns chronological records.
 * Records are sorted in ascending order of their timestamps.
 * 
 * @param {ArrayBuffer|ArrayBufferView} buffer - Binary flight log buffer.
 * @returns {Array<{type: number, typeName: string, time: number, data: object}>} Chronological records.
 */
export function parseFlightLog(buffer) {
  if (!buffer) {
    return [];
  }

  let view;
  if (buffer instanceof ArrayBuffer) {
    view = new DataView(buffer);
  } else if (ArrayBuffer.isView(buffer)) {
    view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } else {
    throw new TypeError('Expected an ArrayBuffer or ArrayBufferView as input to parseFlightLog.');
  }

  const byteLength = view.byteLength;
  if (byteLength < RECORD_SIZE) {
    if (byteLength > 0) {
      console.warn(`Flight log buffer is smaller than minimum record size (${byteLength} < ${RECORD_SIZE} bytes).`);
    }
    return [];
  }

  const remainder = byteLength % RECORD_SIZE;
  if (remainder !== 0) {
    console.warn(
      `Flight log size (${byteLength} bytes) is not a multiple of RECORD_SIZE (${RECORD_SIZE} bytes). Trailing ${remainder} bytes will be ignored.`
    );
  }

  const recordCount = Math.floor(byteLength / RECORD_SIZE);
  const records = [];

  for (let i = 0; i < recordCount; i++) {
    const recordOffset = i * RECORD_SIZE;
    const type = view.getUint8(recordOffset);
    const time = view.getUint32(recordOffset + 1, true);

    const entry = sensorRegistry.get(type);
    if (!entry) {
      console.warn(
        `Unknown sensor type tag: 0x${type.toString(16).padStart(2, '0')} at record index ${i} (byte offset ${recordOffset}). Skipping.`
      );
      continue;
    }

    try {
      const data = entry.parseFunction(view, recordOffset + 5);
      records.push({
        type,
        typeName: entry.name,
        time,
        data,
      });
    } catch (err) {
      console.warn(
        `Error parsing record index ${i} (type: ${entry.name}, tag: 0x${type.toString(16).padStart(2, '0')}):`,
        err
      );
    }
  }

  // Sort records chronologically by timestamp
  records.sort((a, b) => a.time - b.time);

  return records;
}

/**
 * Computes summary statistics from parsed flight log records.
 * 
 * @param {Array<{type: number, typeName: string, time: number, data: object}>} records - Parsed records array.
 * @returns {{totalRecords: number, duration: number, countByType: Object<string, number>}} Summary statistics.
 */
export function getStats(records) {
  if (!Array.isArray(records)) {
    throw new TypeError('Expected an array of records for getStats.');
  }

  const totalRecords = records.length;
  const duration = totalRecords > 1 ? records[totalRecords - 1].time - records[0].time : 0;

  // Initialize counts for all registered types
  const countByType = {};
  for (const entry of sensorRegistry.values()) {
    countByType[entry.name] = 0;
  }

  // Accumulate counts for each record
  for (let i = 0; i < totalRecords; i++) {
    const name = records[i].typeName;
    countByType[name] = (countByType[name] || 0) + 1;
  }

  return {
    totalRecords,
    duration,
    countByType,
  };
}
