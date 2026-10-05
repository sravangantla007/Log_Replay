/**
 * @file parser.js
 * @description ES module for parsing binary flight log files from Avionics V2.
 * 
 * Binary Record Format (17 bytes packed, little-endian):
 * - Offset 0: uint8_t type (sensor tag)
 * - Offset 1: uint32_t time (millis timestamp)
 * - Offset 5: 12-byte union payload
 */

export const RECORD_SIZE = 17;

export const TYPE_IMU = 0x01;
export const TYPE_BARO = 0x02;
export const TYPE_ADXL = 0x03;
export const TYPE_GPS_POS = 0x04;
export const TYPE_GPS_VEL = 0x05;
export const TYPE_GPS_ACC = 0x06;
export const TYPE_GPS_LOW = 0x07;
export const TYPE_BOARD = 0x08;

// We redefine TYPE_GPS to point to TYPE_GPS_POS so the rest of the UI doesn't break
export const TYPE_GPS = TYPE_GPS_POS;

export const sensorRegistry = new Map();

export function registerSensorType(tag, name, parserFn) {
  if (typeof tag !== 'number' || !Number.isInteger(tag) || tag < 0 || tag > 255) {
    throw new TypeError(`Invalid sensor tag: ${tag}. Tag must be an integer between 0 and 255.`);
  }
  sensorRegistry.set(tag, {
    name: name.trim(),
    parseFunction: parserFn,
  });
}

function parseIMU(dv, offset) {
  return {
    ax: dv.getInt16(offset, true),
    ay: dv.getInt16(offset + 2, true),
    az: dv.getInt16(offset + 4, true),
    gx: dv.getInt16(offset + 6, true),
    gy: dv.getInt16(offset + 8, true),
    gz: dv.getInt16(offset + 10, true),
  };
}

function parseBARO(dv, offset) {
  return {
    pressure: dv.getFloat32(offset, true),
    temp: dv.getFloat32(offset + 4, true),
  };
}

function parseADXL(dv, offset) {
  return {
    ax: dv.getInt16(offset, true),
    ay: dv.getInt16(offset + 2, true),
    az: dv.getInt16(offset + 4, true),
  };
}

function parseGPS_POS(dv, offset) {
  return {
    // The UI previously expected utc_time in GPS payload, we just leave it undefined
    lat: dv.getInt32(offset, true),
    lon: dv.getInt32(offset + 4, true),
    gps_alt: dv.getInt32(offset + 8, true),
  };
}

function parseGPS_VEL(dv, offset) {
  return {
    ground_velocity: dv.getInt32(offset, true),
    vertical_velocity: dv.getInt32(offset + 4, true),
    heading: dv.getInt32(offset + 8, true),
  };
}

function parseGPS_ACC(dv, offset) {
  return {
    hAcc: dv.getUint32(offset, true),
    vAcc: dv.getUint32(offset + 4, true),
    headAcc: dv.getUint32(offset + 8, true),
  };
}

function parseGPS_LOW(dv, offset) {
  return {
    UTC_time: dv.getUint32(offset, true),
    hMSL: dv.getInt32(offset + 4, true),
    numSV: dv.getUint8(offset + 8),
    valid: dv.getUint8(offset + 9),
    fixType: dv.getUint8(offset + 10),
    flags: dv.getUint8(offset + 11),
  };
}

function parseBOARD(dv, offset) {
  return {
    temp: dv.getUint8(offset),
    v_batt: dv.getUint8(offset + 1),
    state: dv.getUint8(offset + 2),
    error_code: dv.getUint8(offset + 3),
    pyro_state: dv.getUint8(offset + 4),
    RSSI: dv.getUint8(offset + 5),
  };
}

registerSensorType(TYPE_IMU, 'IMU', parseIMU);
registerSensorType(TYPE_BARO, 'BARO', parseBARO);
registerSensorType(TYPE_ADXL, 'ADXL', parseADXL);
registerSensorType(TYPE_GPS_POS, 'GPS_POS', parseGPS_POS);
registerSensorType(TYPE_GPS_VEL, 'GPS_VEL', parseGPS_VEL);
registerSensorType(TYPE_GPS_ACC, 'GPS_ACC', parseGPS_ACC);
registerSensorType(TYPE_GPS_LOW, 'GPS_LOW', parseGPS_LOW);
registerSensorType(TYPE_BOARD, 'BOARD', parseBOARD);

export function parseFlightLog(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const totalBytes = dv.byteLength;
  const records = [];

  let offset = 0;
  while (offset + RECORD_SIZE <= totalBytes) {
    const type = dv.getUint8(offset);
    const timeMs = dv.getUint32(offset + 1, true);
    const payloadOffset = offset + 5;

    const sensor = sensorRegistry.get(type);

    if (sensor) {
      try {
        const data = sensor.parseFunction(dv, payloadOffset);
        records.push({
          type,
          name: sensor.name,
          time: timeMs,
          data,
        });
      } catch (err) {
        console.warn(`Error parsing record at offset ${offset}:`, err);
      }
    }

    offset += RECORD_SIZE;
  }

  return records.sort((a, b) => a.time - b.time);
}

export function getStats(records) {
  if (!records || records.length === 0) {
    return { count: 0, duration: 0, sensors: {} };
  }
  const minTime = records[0].time;
  const maxTime = records[records.length - 1].time;
  const sensors = {};

  records.forEach(r => {
    if (!sensors[r.name]) sensors[r.name] = 0;
    sensors[r.name]++;
  });

  return {
    count: records.length,
    duration: maxTime - minTime,
    minTime,
    maxTime,
    sensors,
  };
}
