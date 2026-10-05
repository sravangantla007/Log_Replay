/**
 * main.js — Application bootstrap & event routing
 * 
 * Wires together: parser, timeline, charts, viewer3d, map, and testdata.
 * Handles file loading (drag-drop + file picker) and coordinates
 * the event flow between modules during playback and stepping.
 */

import { parseFlightLog, TYPE_IMU, TYPE_BARO, TYPE_ADXL, TYPE_GPS, TYPE_BOARD, getStats } from './parser.js?v=5';
import { Timeline } from './timeline.js?v=5';
import { ChartManager } from './charts.js?v=5';
import { Viewer3D } from './viewer3d.js?v=5';
import { FlightMap } from './map.js?v=5';
import { generateTestData } from './testdata.js?v=5';

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

    const btnWelcomeTest = document.getElementById('btn-welcome-test');
    if (btnWelcomeTest) {
        btnWelcomeTest.addEventListener('click', () => {
            const buffer = generateTestData();
            processBuffer(buffer, 'Synthetic_Flight.bin');
        });
    }

    btnPlay.addEventListener('click', () => timeline.play());
    btnPause.addEventListener('click', () => timeline.pause());
    btnStepBack.addEventListener('click', () => timeline.stepBack());
    btnStepForward.addEventListener('click', () => timeline.stepForward());
    
    const btnMapToggle = document.getElementById('btn-map-toggle');
    if (btnMapToggle) {
        btnMapToggle.addEventListener('click', () => {
            const isOffline = flightMap.toggleOfflineMode();
            btnMapToggle.textContent = isOffline ? '🗺️ MAP: OFFLINE' : '🗺️ MAP: ONLINE';
            btnMapToggle.style.color = isOffline ? '#00e5ff' : '#aaa';
        });
    }
    
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

    // ── Resizable Splitters ───────────────────────────────────────────
    const splitterV = document.getElementById('splitter-v');
    const splitterH = document.getElementById('splitter-h');
    const root = document.documentElement;

    if (splitterV) {
        let isDraggingV = false;
        
        const startDragV = (e) => { isDraggingV = true; splitterV.classList.add('dragging'); e.preventDefault(); };
        const endDragV = () => { isDraggingV = false; splitterV.classList.remove('dragging'); };
        const dragV = (e) => {
            if (!isDraggingV) return;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            let newSplit = (clientX / window.innerWidth) * 100;
            newSplit = Math.max(10, Math.min(newSplit, 90));
            root.style.setProperty('--split-v', `${newSplit}%`);
            charts.resize();
            if (flightMap) flightMap.invalidateSize();
        };

        splitterV.addEventListener('mousedown', startDragV);
        splitterV.addEventListener('touchstart', startDragV, {passive: false});
        
        document.addEventListener('mousemove', dragV);
        document.addEventListener('touchmove', dragV, {passive: false});
        
        document.addEventListener('mouseup', endDragV);
        document.addEventListener('touchend', endDragV);
    }

    if (splitterH) {
        let isDraggingH = false;
        
        const startDragH = (e) => { isDraggingH = true; splitterH.classList.add('dragging'); e.preventDefault(); };
        const endDragH = () => { isDraggingH = false; splitterH.classList.remove('dragging'); };
        const dragH = (e) => {
            if (!isDraggingH) return;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            const rightPanel = document.getElementById('right-panel');
            if (!rightPanel) return;
            const rect = rightPanel.getBoundingClientRect();
            let newSplit = ((clientY - rect.top) / rect.height) * 100;
            newSplit = Math.max(10, Math.min(newSplit, 90));
            root.style.setProperty('--split-h', `${newSplit}%`);
            if (flightMap) flightMap.invalidateSize();
        };

        splitterH.addEventListener('mousedown', startDragH);
        splitterH.addEventListener('touchstart', startDragH, {passive: false});
        
        document.addEventListener('mousemove', dragH);
        document.addEventListener('touchmove', dragH, {passive: false});
        
        document.addEventListener('mouseup', endDragH);
        document.addEventListener('touchend', endDragH);
    }

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
    
    // Load GPS track — re-init map to ensure container is sized
    const gpsRecords = records.filter(r => r.type === TYPE_GPS);
    flightMap.init();  // re-init if needed (no-ops if already launched)
    flightMap.loadTrack(gpsRecords);
    // Staggered invalidateSize to catch CSS grid layout settling
    setTimeout(() => flightMap.invalidateSize(), 100);
    setTimeout(() => flightMap.invalidateSize(), 500);

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

// Accumulate latest sensor data per frame — only the last value matters
let latestIMU = null;
let latestGPS = null;
let latestBOARD = null;

function onTimelineTick(record, index) {
    // Buffer the latest data per type — cheap assignments, no rendering
    switch (record.type) {
        case TYPE_IMU:
            latestIMU = record.data;
            break;
        case TYPE_GPS:
            latestGPS = record.data;
            break;
        case TYPE_BOARD:
            latestBOARD = record.data;
            break;
    }
}

function onIndexChange(index, total) {
    // ── This fires ONCE per animation frame ──

    // Update scrubber position
    scrubber.value = index;
    
    const time = timeline.currentTime;
    const baseTime = timeline.records[0]?.time ?? 0;
    updateTimeDisplay(time - baseTime, timeline.duration);
    updateRecordCounter(index, total);

    // ── Render updates (once per frame) ──
    charts.updateCursor(time);

    if (latestIMU && viewer3d) {
        viewer3d.updateOrientation(latestIMU);
        latestIMU = null;
    }
    if (latestGPS) {
        flightMap.updatePosition(latestGPS);
        latestGPS = null;
    }
    if (latestBOARD) {
        updateBoardStatus(latestBOARD);
        latestBOARD = null;
    }
}

function updateBoardStatus(boardData) {
    // Update LEDs from error_code (bitmask)
    const err = boardData.error_code || 0;
    for (let i = 0; i < 8; i++) {
        const led = document.getElementById(`led-e${i}`);
        if (led) {
            if ((err & (1 << i)) !== 0) {
                led.className = 'led red'; // Bit set = error
            } else {
                led.className = 'led green'; // Bit clear = ok
            }
        }
    }
    
    // Update State
    const stateTxt = document.getElementById('board-state-text');
    if (stateTxt) {
        const states = ["INIT", "PAD", "BOOST", "COAST", "APOGEE", "DESCENT", "LANDED"];
        const s = states[boardData.state] || `STATE ${boardData.state}`;
        stateTxt.textContent = `STATE: ${s}`;
    }
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
