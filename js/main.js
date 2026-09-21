/**
 * main.js — Application bootstrap & event routing
 * 
 * Wires together: parser, timeline, charts, viewer3d, map, and testdata.
 * Handles file loading (drag-drop + file picker) and coordinates
 * the event flow between modules during playback and stepping.
 */

import { parseFlightLog, TYPE_IMU, TYPE_BARO, TYPE_ADXL, TYPE_GPS, TYPE_BOARD, getStats } from './parser.js';
import { Timeline } from './timeline.js';
import { ChartManager } from './charts.js';
import { Viewer3D } from './viewer3d.js';
import { FlightMap } from './map.js';
import { generateTestData } from './testdata.js';

// ── Module Instances ──────────────────────────────────────────────
let timeline   = null;
let charts     = null;
let viewer3d   = null;
let flightMap  = null;
let records    = [];
let gpsIndices = []; // indices into records[] for GPS records only

// ── DOM Elements ──────────────────────────────────────────────────
const fileInput      = document.getElementById('file-input');
const fileLabel      = document.getElementById('file-label');
const dropOverlay    = document.getElementById('drop-overlay');
const welcomePanel   = document.getElementById('welcome');

const statTotal      = document.getElementById('stat-total');
const statDuration   = document.getElementById('stat-duration');
const statIMU        = document.getElementById('stat-imu');
const statBaro       = document.getElementById('stat-baro');
const statADXL       = document.getElementById('stat-adxl');
const statGPS        = document.getElementById('stat-gps');

const btnPlay        = document.getElementById('btn-play');
const btnPause       = document.getElementById('btn-pause');
const btnStepBack    = document.getElementById('btn-step-back');
const btnStepForward = document.getElementById('btn-step-forward');
const scrubber       = document.getElementById('scrubber');
const speedSelect    = document.getElementById('speed-select');
const timeDisplay    = document.getElementById('time-display');
const recordCounter  = document.getElementById('record-counter');
const btnTestData    = document.getElementById('btn-test-data');

// ── Initialization ────────────────────────────────────────────────

function init() {
    // Timeline
    timeline = new Timeline();
    
    // Charts
    charts = new ChartManager();
    charts.setSeekCallback((timeMs) => {
        timeline.seekToTime(timeMs);
    });

    // 3D Viewer
    try {
        viewer3d = new Viewer3D('viewer-3d');
    } catch (e) {
        console.warn('Viewer3D init failed:', e.message);
        viewer3d = null;
    }

    // Map
    flightMap = new FlightMap('map-container');
    flightMap.init();

    // Timeline event handlers
    timeline.on('tick', onTimelineTick);
    timeline.on('indexChange', onIndexChange);
    timeline.on('stateChange', onStateChange);

    // UI event handlers
    fileInput.addEventListener('change', onFileSelected);
    btnPlay.addEventListener('click', () => timeline.play());
    btnPause.addEventListener('click', () => timeline.pause());
    btnStepBack.addEventListener('click', () => timeline.stepBack());
    btnStepForward.addEventListener('click', () => timeline.stepForward());
    
    scrubber.addEventListener('input', () => {
        timeline.seek(parseInt(scrubber.value, 10));
    });

    speedSelect.addEventListener('change', () => {
        timeline.setSpeed(parseFloat(speedSelect.value));
    });

    if (btnTestData) {
        btnTestData.addEventListener('click', loadTestData);
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', onKeyDown);

    // Drag and drop
    setupDragDrop();

    console.log('[FlightReplay] Initialized');
}

// ── File Loading ──────────────────────────────────────────────────

function onFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;
    loadFile(file);
}

async function loadFile(file) {
    try {
        fileLabel.textContent = file.name;
        const buffer = await file.arrayBuffer();
        processBuffer(buffer, file.name);
    } catch (err) {
        console.error('Failed to load file:', err);
        fileLabel.textContent = 'Error loading file';
    }
}

function loadTestData() {
    const buffer = generateTestData();
    fileLabel.textContent = 'test_flight.bin (synthetic)';
    processBuffer(buffer, 'test_flight.bin');
}

function processBuffer(buffer, filename) {
    // Parse binary records and sort chronologically
    records = parseFlightLog(buffer);
    
    if (records.length === 0) {
        console.warn('No valid records found in file');
        return;
    }

    // Build GPS index map (record index -> GPS track point index)
    gpsIndices = [];
    let gpsTrackIndex = 0;
    for (let i = 0; i < records.length; i++) {
        if (records[i].type === TYPE_GPS) {
            gpsIndices[i] = gpsTrackIndex++;
        }
    }

    // Update stats display
    const stats = getStats(records);
    updateStatsDisplay(stats);

    // Hide welcome, show data
    if (welcomePanel) welcomePanel.style.display = 'none';

    // Load data into modules
    timeline.load(records);
    charts.loadData(records);
    
    // Load GPS track
    const gpsRecords = records.filter(r => r.type === TYPE_GPS);
    flightMap.loadTrack(gpsRecords);

    // Reset 3D viewer
    if (viewer3d) viewer3d.reset();

    // Setup scrubber
    scrubber.max = records.length - 1;
    scrubber.value = 0;

    // Show initial state
    updateTimeDisplay(0, 0);
    updateRecordCounter(0, records.length);

    console.log(`[FlightReplay] Loaded ${filename}: ${records.length} records, ${Timeline.formatTime(stats.duration)} duration`);
}

// ── Timeline Event Handlers ───────────────────────────────────────

function onTimelineTick(record, index) {
    // Update charts cursor
    charts.updateCursor(record.time);

    // Route to type-specific handlers
    switch (record.type) {
        case TYPE_IMU:
            if (viewer3d) viewer3d.updateOrientation(record.data);
            break;
        case TYPE_GPS:
            flightMap.updatePosition(record.data);
            break;
        // BARO, ADXL, BOARD — charts handle via cursor, no extra routing needed
    }
}

function onIndexChange(index, total) {
    // Update scrubber position (throttled via rAF to avoid flooding)
    scrubber.value = index;
    
    const time = timeline.currentTime;
    const baseTime = timeline.records[0]?.time ?? 0;
    updateTimeDisplay(time - baseTime, timeline.duration);
    updateRecordCounter(index, total);
}

function onStateChange(playing) {
    btnPlay.classList.toggle('active', playing);
    btnPause.classList.toggle('active', !playing);
    
    if (playing) {
        btnPlay.style.display = 'none';
        btnPause.style.display = '';
    } else {
        btnPlay.style.display = '';
        btnPause.style.display = 'none';
    }
}

// ── UI Updates ────────────────────────────────────────────────────

function updateStatsDisplay(stats) {
    if (statTotal) statTotal.textContent = stats.totalRecords.toLocaleString();
    if (statDuration) statDuration.textContent = Timeline.formatTime(stats.duration);
    if (statIMU) statIMU.textContent = (stats.countByType['IMU'] || 0).toLocaleString();
    if (statBaro) statBaro.textContent = (stats.countByType['BARO'] || 0).toLocaleString();
    if (statADXL) statADXL.textContent = (stats.countByType['ADXL'] || 0).toLocaleString();
    if (statGPS) statGPS.textContent = (stats.countByType['GPS'] || 0).toLocaleString();
}

function updateTimeDisplay(elapsedMs, durationMs) {
    if (timeDisplay) {
        timeDisplay.textContent = `${Timeline.formatTime(elapsedMs)} / ${Timeline.formatTime(durationMs)}`;
    }
}

function updateRecordCounter(index, total) {
    if (recordCounter) {
        recordCounter.textContent = `${(index + 1).toLocaleString()} / ${total.toLocaleString()}`;
    }
}

// ── Keyboard Shortcuts ───────────────────────────────────────────

function onKeyDown(e) {
    // Don't capture if user is typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    switch (e.key) {
        case ' ':
        case 'k':
            e.preventDefault();
            timeline.isPlaying ? timeline.pause() : timeline.play();
            break;
        case 'ArrowLeft':
        case 'j':
            e.preventDefault();
            timeline.stepBack();
            break;
        case 'ArrowRight':
        case 'l':
            e.preventDefault();
            timeline.stepForward();
            break;
        case 'Home':
            e.preventDefault();
            timeline.seek(0);
            break;
        case 'End':
            e.preventDefault();
            timeline.seek(timeline.records.length - 1);
            break;
    }
}

// ── Drag and Drop ─────────────────────────────────────────────────

function setupDragDrop() {
    let dragCounter = 0;

    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        if (dropOverlay) dropOverlay.classList.add('active');
    });

    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            if (dropOverlay) dropOverlay.classList.remove('active');
        }
    });

    document.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    document.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        if (dropOverlay) dropOverlay.classList.remove('active');

        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            loadFile(files[0]);
        }
    });
}

// ── Bootstrap ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
