/**
 * ChartManager - Time-Series Telemetry Charts for Flight Data Visualizer
 *
 * Manages 5 synchronized telemetry charts rendered using Chart.js:
 * 1. imuAccel  - IMU Acceleration (ax, ay, az in g)
 * 2. imuGyro   - IMU Gyroscope (gx, gy, gz in °/s)
 * 3. adxl      - High-G Accelerometer (ax, ay, az in counts)
 * 4. baro      - Barometer (pressure in hPa, temperature in °C)
 * 5. gpsAlt    - GPS Altitude (altitude in m)
 *
 * Features:
 * - Scatter series with line connections (straight lines, pointRadius: 0)
 * - LTTB decimation algorithm for optimal performance with large datasets
 * - Custom vertical dashed magenta cursor line plugin synchronized across all charts
 * - Click-to-seek callback integration
 * - Dark cyber/telemetry theme matching visualizer styling
 *
 * NOTE: Chart.js is loaded as a global (window.Chart) via script tag.
 */

// Sensor type constants
export const TYPE_IMU = 0x01;
export const TYPE_BARO = 0x02;
export const TYPE_ADXL = 0x03;
export const TYPE_GPS = 0x04;

/**
 * Custom cursor plugin: draws a vertical magenta dashed line across the chart
 * at `chart.cursorTime` (time in seconds on the linear X axis).
 */
export const cursorPlugin = {
  id: 'cursorLine',
  afterDraw(chart) {
    if (chart.cursorTime == null) return;
    const xAxis = chart.scales && chart.scales.x;
    if (!xAxis || !chart.chartArea) return;
    const x = xAxis.getPixelForValue(chart.cursorTime);
    if (x < xAxis.left || x > xAxis.right) return;
    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, chart.chartArea.top);
    ctx.lineTo(x, chart.chartArea.bottom);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ff00e5';
    ctx.setLineDash([5, 3]);
    ctx.stroke();
    ctx.restore();
  }
};

/**
 * Helper to safely obtain global Chart reference
 */
function getGlobalChart() {
  if (typeof window !== 'undefined' && window.Chart) {
    return window.Chart;
  }
  if (typeof Chart !== 'undefined') {
    return Chart;
  }
  return null;
}

/**
 * Helper to register cursorPlugin globally with Chart
 */
function registerCursorPlugin(chartClass) {
  const C = chartClass || getGlobalChart();
  if (C && typeof C.register === 'function') {
    const isRegistered = C.registry?.plugins?.get?.('cursorLine');
    if (!isRegistered) {
      try {
        C.register(cursorPlugin);
      } catch (_) {
        // Plugin might already be registered
      }
    }
  }
}

// Register plugin globally at module load
registerCursorPlugin();

/**
 * ChartManager class
 */
export class ChartManager {
  /**
   * Constructs the ChartManager instance.
   */
  constructor() {
    /** @type {Object.<string, Object>} Keyed by chart name */
    this.charts = {};

    /** @type {number|null} Current cursor time in seconds */
    this.cursorTime = null;

    /** @type {Function|null} Callback invoked on click with time in ms */
    this.seekCallback = null;

    // Ensure plugin registration if Chart was loaded after initial module parse
    registerCursorPlugin();
  }

  /**
   * Sets the timeline seek callback function.
   * @param {function(number): void} fn - Callback invoked with clicked time in milliseconds
   */
  setSeekCallback(fn) {
    this.seekCallback = typeof fn === 'function' ? fn : null;
  }

  /**
   * Loads telemetry records, extracts and converts time-series data for each
   * sensor type, and constructs/recreates all 5 chart panels.
   *
   * @param {Array<Object>} records - Array of telemetry record objects
   */
  loadData(records) {
    const Chart = getGlobalChart();
    if (!Chart) {
      console.error('ChartManager: Chart.js (window.Chart) must be loaded globally.');
      return;
    }

    // Ensure cursor plugin is registered before creating chart instances
    registerCursorPlugin(Chart);

    // Prepare data containers for all 5 charts
    const imuAccel = { ax: [], ay: [], az: [] };
    const imuGyro = { gx: [], gy: [], gz: [] };
    const adxl = { ax: [], ay: [], az: [] };
    const baro = { pressure: [], temp: [] };
    const gps = { alt: [] };

    if (Array.isArray(records)) {
      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        if (!record) continue;

        const timeMs = this._extractTimeMs(record);
        if (timeMs === null) continue;
        const timeSec = timeMs / 1000;

        const data = (record.data && typeof record.data === 'object') ? record.data : record;
        const type = record.type !== undefined ? record.type : record.sensorType;

        // 1 & 2. IMU ACCEL & GYRO (TYPE_IMU = 0x01)
        if (type === TYPE_IMU || type === 'imu' || type === 'IMU') {
          // Accel: raw counts / 2048 to get g
          const ax = data.ax ?? data.accel_x ?? data.accX;
          const ay = data.ay ?? data.accel_y ?? data.accY;
          const az = data.az ?? data.accel_z ?? data.accZ;

          if (typeof ax === 'number' && !isNaN(ax)) imuAccel.ax.push({ x: timeSec, y: ax / 2048 });
          if (typeof ay === 'number' && !isNaN(ay)) imuAccel.ay.push({ x: timeSec, y: ay / 2048 });
          if (typeof az === 'number' && !isNaN(az)) imuAccel.az.push({ x: timeSec, y: az / 2048 });

          // Gyro: raw counts / 16.4 to get °/s
          const gx = data.gx ?? data.gyro_x ?? data.gyroX;
          const gy = data.gy ?? data.gyro_y ?? data.gyroY;
          const gz = data.gz ?? data.gyro_z ?? data.gyroZ;

          if (typeof gx === 'number' && !isNaN(gx)) imuGyro.gx.push({ x: timeSec, y: gx / 16.4 });
          if (typeof gy === 'number' && !isNaN(gy)) imuGyro.gy.push({ x: timeSec, y: gy / 16.4 });
          if (typeof gz === 'number' && !isNaN(gz)) imuGyro.gz.push({ x: timeSec, y: gz / 16.4 });
        }

        // 3. HIGH-G ACCELEROMETER (TYPE_ADXL = 0x03)
        else if (type === TYPE_ADXL || type === 'adxl' || type === 'ADXL') {
          // Raw counts (no conversion)
          const ax = data.ax ?? data.accel_x ?? data.x;
          const ay = data.ay ?? data.accel_y ?? data.y;
          const az = data.az ?? data.accel_z ?? data.z;

          if (typeof ax === 'number' && !isNaN(ax)) adxl.ax.push({ x: timeSec, y: ax });
          if (typeof ay === 'number' && !isNaN(ay)) adxl.ay.push({ x: timeSec, y: ay });
          if (typeof az === 'number' && !isNaN(az)) adxl.az.push({ x: timeSec, y: az });
        }

        // 4. BAROMETER (TYPE_BARO = 0x02)
        else if (type === TYPE_BARO || type === 'baro' || type === 'BARO') {
          const press = data.pressure ?? data.press ?? data.p;
          const temp = data.temp ?? data.temperature ?? data.t;

          if (typeof press === 'number' && !isNaN(press)) baro.pressure.push({ x: timeSec, y: press });
          if (typeof temp === 'number' && !isNaN(temp)) baro.temp.push({ x: timeSec, y: temp });
        }

        // 5. GPS ALTITUDE (TYPE_GPS = 0x04)
        else if (type === TYPE_GPS || type === 'gps' || type === 'GPS') {
          const rawAlt = data.gps_alt ?? data.alt ?? data.altitude;

          // mm / 1000 to get meters
          if (typeof rawAlt === 'number' && !isNaN(rawAlt)) {
            gps.alt.push({ x: timeSec, y: rawAlt / 1000 });
          }
        }
      }
    }

    // Sort datasets by time (required for Chart.js LTTB decimation)
    const sortByX = (arr) => arr.sort((a, b) => a.x - b.x);
    sortByX(imuAccel.ax);
    sortByX(imuAccel.ay);
    sortByX(imuAccel.az);
    sortByX(imuGyro.gx);
    sortByX(imuGyro.gy);
    sortByX(imuGyro.gz);
    sortByX(adxl.ax);
    sortByX(adxl.ay);
    sortByX(adxl.az);
    sortByX(baro.pressure);
    sortByX(baro.temp);
    sortByX(gps.alt);

    // Build/rebuild Chart 1: imuAccel
    this._buildChart({
      name: 'imuAccel',
      canvasId: 'chart-imu-accel',
      title: 'IMU ACCELERATION',
      yTitle: 'g',
      datasets: [
        { label: 'ax', data: imuAccel.ax, borderColor: '#ff4444' },
        { label: 'ay', data: imuAccel.ay, borderColor: '#44ff44' },
        { label: 'az', data: imuAccel.az, borderColor: '#4488ff' }
      ]
    });

    // Build/rebuild Chart 2: imuGyro
    this._buildChart({
      name: 'imuGyro',
      canvasId: 'chart-imu-gyro',
      title: 'IMU GYROSCOPE',
      yTitle: '°/s',
      datasets: [
        { label: 'gx', data: imuGyro.gx, borderColor: '#ff4444' },
        { label: 'gy', data: imuGyro.gy, borderColor: '#44ff44' },
        { label: 'gz', data: imuGyro.gz, borderColor: '#4488ff' }
      ]
    });

    // Build/rebuild Chart 3: adxl
    this._buildChart({
      name: 'adxl',
      canvasId: 'chart-adxl',
      title: 'HIGH-G ACCELEROMETER',
      yTitle: 'counts',
      datasets: [
        { label: 'ax', data: adxl.ax, borderColor: '#ff4444' },
        { label: 'ay', data: adxl.ay, borderColor: '#44ff44' },
        { label: 'az', data: adxl.az, borderColor: '#4488ff' }
      ]
    });

    // Build/rebuild Chart 4: baro (Dual Y-axes: hPa left, °C right)
    this._buildBaroChart({
      name: 'baro',
      canvasId: 'chart-baro',
      title: 'BAROMETER',
      pressureData: baro.pressure,
      tempData: baro.temp
    });

    // Build/rebuild Chart 5: gpsAlt
    this._buildChart({
      name: 'gpsAlt',
      canvasId: 'chart-gps-alt',
      title: 'GPS ALTITUDE',
      yTitle: 'm',
      datasets: [
        { label: 'altitude', data: gps.alt, borderColor: '#00e5ff' }
      ]
    });
  }

  /**
   * Updates the vertical cursor line across all charts and forces an immediate
   * redraw without animation.
   *
   * @param {number|null} timeMs - Current playback time in milliseconds
   */
  updateCursor(timeMs) {
    if (timeMs === null || timeMs === undefined || isNaN(timeMs)) {
      this.cursorTime = null;
    } else {
      this.cursorTime = timeMs / 1000;
    }

    const chartKeys = Object.keys(this.charts);
    for (let i = 0; i < chartKeys.length; i++) {
      const chart = this.charts[chartKeys[i]];
      if (chart) {
        chart.cursorTime = this.cursorTime;
        chart.update('none');
      }
    }
  }

  /**
   * Destroys all Chart.js instances and resets internal state.
   */
  destroy() {
    const chartKeys = Object.keys(this.charts);
    for (let i = 0; i < chartKeys.length; i++) {
      const chart = this.charts[chartKeys[i]];
      if (chart && typeof chart.destroy === 'function') {
        chart.destroy();
      }
    }
    this.charts = {};
    this.cursorTime = null;
    this.seekCallback = null;
  }

  /**
   * Triggers resize recalculation for all active charts.
   */
  resize() {
    const chartKeys = Object.keys(this.charts);
    for (let i = 0; i < chartKeys.length; i++) {
      const chart = this.charts[chartKeys[i]];
      if (chart && typeof chart.resize === 'function') {
        chart.resize();
      }
    }
  }

  // ==========================================
  // Internal Helpers & Chart Constructors
  // ==========================================

  /**
   * Extracts timestamp in milliseconds from a record.
   * @private
   */
  _extractTimeMs(record) {
    if (typeof record.time === 'number') return record.time;
    if (typeof record.timestamp === 'number') return record.timestamp;
    if (typeof record.timeMs === 'number') return record.timeMs;

    if (record.data && typeof record.data === 'object') {
      if (typeof record.data.time === 'number') return record.data.time;
      if (typeof record.data.timestamp === 'number') return record.data.timestamp;
      if (typeof record.data.timeMs === 'number') return record.data.timeMs;
    }

    return null;
  }

  /**
   * Resolves a canvas element by id and destroys any existing chart on it.
   * @private
   */
  _prepareCanvas(name, canvasId) {
    const Chart = getGlobalChart();
    if (!Chart) return null;

    if (this.charts[name]) {
      this.charts[name].destroy();
      delete this.charts[name];
    }

    if (typeof document === 'undefined') return null;

    const canvas = document.getElementById(canvasId);
    if (!canvas) {
      console.warn(`ChartManager: Canvas with ID '${canvasId}' not found.`);
      return null;
    }

    // If an existing chart is associated with the canvas, destroy it
    const existing = Chart.getChart ? Chart.getChart(canvas) : null;
    if (existing) {
      existing.destroy();
    }

    return canvas;
  }

  /**
   * Builds and mounts a standard single Y-axis chart.
   * @private
   */
  _buildChart({ name, canvasId, title, yTitle, datasets }) {
    const canvas = this._prepareCanvas(name, canvasId);
    if (!canvas) return;

    const Chart = getGlobalChart();

    const formattedDatasets = datasets.map(ds => ({
      label: ds.label,
      data: ds.data,
      borderColor: ds.borderColor,
      backgroundColor: 'transparent',
      fill: false,
      borderWidth: 1.2,
      pointRadius: 0,
      tension: 0,
      showLine: true
    }));

    const config = {
      type: 'scatter',
      data: {
        datasets: formattedDatasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        onClick: (event, _elements, chartInstance) => {
          this._handleChartClick(event, chartInstance || this.charts[name]);
        },
        scales: {
          x: {
            type: 'linear',
            title: {
              display: true,
              text: 'Time (s)',
              color: '#6a6a8a',
              font: { family: 'monospace', size: 10 }
            },
            grid: { color: '#1a1a2e' },
            ticks: {
              color: '#6a6a8a',
              font: { family: 'monospace', size: 10 }
            }
          },
          y: {
            title: {
              display: Boolean(yTitle),
              text: yTitle || '',
              color: '#6a6a8a',
              font: { family: 'monospace', size: 10 }
            },
            grid: { color: '#1a1a2e' },
            ticks: {
              color: '#6a6a8a',
              font: { family: 'monospace', size: 10 }
            }
          }
        },
        plugins: {
          title: {
            display: true,
            text: title,
            color: '#e0e0ff',
            font: { family: 'monospace', size: 11, weight: 'bold' },
            padding: { top: 4, bottom: 4 }
          },
          legend: {
            display: true,
            labels: {
              color: '#e0e0ff',
              font: { family: 'monospace', size: 10 },
              boxWidth: 12,
              boxHeight: 2
            }
          },
          decimation: {
            enabled: true,
            algorithm: 'lttb',
            samples: 800
          }
        }
      }
    };

    const chartInstance = new Chart(canvas, config);
    chartInstance.cursorTime = this.cursorTime;
    this.charts[name] = chartInstance;
  }

  /**
   * Builds and mounts the dual Y-axis Barometer chart (pressure on left, temp on right).
   * @private
   */
  _buildBaroChart({ name, canvasId, title, pressureData, tempData }) {
    const canvas = this._prepareCanvas(name, canvasId);
    if (!canvas) return;

    const Chart = getGlobalChart();

    const config = {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: 'pressure',
            data: pressureData,
            borderColor: '#00e5ff',
            backgroundColor: 'transparent',
            fill: false,
            borderWidth: 1.2,
            pointRadius: 0,
            tension: 0,
            showLine: true,
            yAxisID: 'y'
          },
          {
            label: 'temperature',
            data: tempData,
            borderColor: '#ffab00',
            backgroundColor: 'transparent',
            fill: false,
            borderWidth: 1.2,
            pointRadius: 0,
            tension: 0,
            showLine: true,
            yAxisID: 'yTemp'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        onClick: (event, _elements, chartInstance) => {
          this._handleChartClick(event, chartInstance || this.charts[name]);
        },
        scales: {
          x: {
            type: 'linear',
            title: {
              display: true,
              text: 'Time (s)',
              color: '#6a6a8a',
              font: { family: 'monospace', size: 10 }
            },
            grid: { color: '#1a1a2e' },
            ticks: {
              color: '#6a6a8a',
              font: { family: 'monospace', size: 10 }
            }
          },
          y: {
            type: 'linear',
            position: 'left',
            title: {
              display: true,
              text: 'hPa',
              color: '#00e5ff',
              font: { family: 'monospace', size: 10 }
            },
            grid: { color: '#1a1a2e' },
            ticks: {
              color: '#6a6a8a',
              font: { family: 'monospace', size: 10 }
            }
          },
          yTemp: {
            type: 'linear',
            position: 'right',
            title: {
              display: true,
              text: '°C',
              color: '#ffab00',
              font: { family: 'monospace', size: 10 }
            },
            grid: { drawOnChartArea: false },
            ticks: {
              color: '#6a6a8a',
              font: { family: 'monospace', size: 10 }
            }
          }
        },
        plugins: {
          title: {
            display: true,
            text: title,
            color: '#e0e0ff',
            font: { family: 'monospace', size: 11, weight: 'bold' },
            padding: { top: 4, bottom: 4 }
          },
          legend: {
            display: true,
            labels: {
              color: '#e0e0ff',
              font: { family: 'monospace', size: 10 },
              boxWidth: 12,
              boxHeight: 2
            }
          },
          decimation: {
            enabled: true,
            algorithm: 'lttb',
            samples: 800
          }
        }
      }
    };

    const chartInstance = new Chart(canvas, config);
    chartInstance.cursorTime = this.cursorTime;
    this.charts[name] = chartInstance;
  }

  /**
   * Handles click events on a chart to compute clicked time and trigger callback.
   * @private
   */
  _handleChartClick(event, chart) {
    if (!chart || !chart.scales || !chart.scales.x) return;

    // Use event.x as specified; fallback to native offsetX if needed
    const pixelX = (event && typeof event.x === 'number')
      ? event.x
      : (event?.native?.offsetX ?? null);

    if (pixelX === null) return;

    const timeInSec = chart.scales.x.getValueForPixel(pixelX);
    if (timeInSec != null && !isNaN(timeInSec)) {
      const timeInMs = Math.round(timeInSec * 1000);
      if (typeof this.seekCallback === 'function') {
        this.seekCallback(timeInMs);
      }
    }
  }
}

export default ChartManager;
