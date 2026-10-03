import sys
import os
import struct
import json
import numpy as np
import pyqtgraph as pg

from PySide6.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, 
                               QSplitter, QPushButton, QLabel, QFileDialog, QSlider, QGridLayout, QFrame)
from PySide6.QtCore import Qt, QTimer, QUrl, QFileInfo
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEngineSettings

# --- 1. Parser Definition ---
RECORD_SIZE = 21

TYPE_IMU = 0x01
TYPE_BARO = 0x02
TYPE_ADXL = 0x03
TYPE_GPS = 0x04
TYPE_BOARD = 0x05

class FlightData:
    def __init__(self):
        self.records = []
        # Storing vectors for fast plotting
        self.times = []
        self.imu_gyroz = []
        self.baro_alt = []
        self.gps_alt = []
        
        self.lat = []
        self.lon = []
        
        self.quaternions = [] # We'll just generate dummy quaternions or compute them in a real app, 
                              # for now we'll just extract raw gyro/accel and mock orientation
        self.hud_data = []

def parse_log_file(filepath):
    data = FlightData()
    try:
        with open(filepath, 'rb') as f:
            raw_data = f.read()
    except Exception as e:
        print(f"Failed to read file: {e}")
        return data

    total_records = len(raw_data) // RECORD_SIZE
    
    t0 = None
    
    # Simple Madgwick/Mahony placeholder integration for orientation
    q = [1.0, 0.0, 0.0, 0.0] 
    
    for i in range(total_records):
        offset = i * RECORD_SIZE
        record_type = raw_data[offset]
        time_ms = struct.unpack_from('<I', raw_data, offset + 1)[0]
        payload = raw_data[offset + 5 : offset + 21]
        
        if t0 is None:
            t0 = time_ms
            
        t_sec = (time_ms - t0) / 1000.0
        
        if record_type == TYPE_IMU:
            ax, ay, az, gx, gy, gz = struct.unpack_from('<hhhhhh', payload)
            data.times.append(t_sec)
            data.imu_gyroz.append(gz)
            
            # Very fake orientation update for visualization
            q[1] += gx * 0.0001
            q[2] += gy * 0.0001
            q[3] += gz * 0.0001
            # Normalize
            mag = (q[0]**2 + q[1]**2 + q[2]**2 + q[3]**2)**0.5
            q = [x/mag for x in q]
            
            data.quaternions.append(list(q))
            data.hud_data.append({'ax': ax, 'ay': ay, 'az': az, 'gx': gx, 'gy': gy, 'gz': gz})
            
        elif record_type == TYPE_BARO:
            pressure, temp = struct.unpack_from('<ff', payload)
            alt = 44330.0 * (1.0 - (pressure / 101325.0)**0.1903) if pressure > 0 else 0
            if len(data.times) > 0:
                data.baro_alt.append((data.times[-1], alt))
            
        elif record_type == TYPE_GPS:
            utc, lat, lon, gps_alt = struct.unpack_from('<Iiii', payload)
            data.lat.append(lat / 1e7)
            data.lon.append(lon / 1e7)
            if len(data.times) > 0:
                data.gps_alt.append((data.times[-1], gps_alt / 1000.0))

    return data


import threading
from http.server import SimpleHTTPRequestHandler, HTTPServer

def start_server():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = HTTPServer(('127.0.0.1', 8999), SimpleHTTPRequestHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

# --- 2. Main Desktop App ---
class FlightReplayApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Flight Replay - Desktop (PySide6)")
        self.resize(1400, 900)
        
        start_server()
        
        self.data = None
        self.current_idx = 0
        self.is_playing = False
        
        # Setup dark theme
        self.setStyleSheet("""
            QMainWindow, QWidget { background-color: #0a0a14; color: #ffffff; font-family: 'JetBrains Mono', monospace; }
            QPushButton { background-color: #00e5ff; color: #000; padding: 6px; border-radius: 4px; font-weight: bold; }
            QPushButton:hover { background-color: #55ffff; }
            QSplitter::handle { background-color: #1a2a3a; }
        """)
        
        self.init_ui()
        
        self.timer = QTimer()
        self.timer.timeout.connect(self.tick)
        self.timer.setInterval(16) # ~60fps
        
    def init_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)
        
        # Top toolbar
        toolbar = QHBoxLayout()
        self.btn_load = QPushButton("LOAD .BIN")
        self.btn_load.clicked.connect(self.load_file)
        
        self.btn_play = QPushButton("PLAY")
        self.btn_play.clicked.connect(self.toggle_play)
        
        self.slider = QSlider(Qt.Horizontal)
        self.slider.valueChanged.connect(self.scrub)
        
        self.lbl_time = QLabel("0.0s")
        
        toolbar.addWidget(self.btn_load)
        toolbar.addWidget(self.btn_play)
        toolbar.addWidget(self.slider)
        toolbar.addWidget(self.lbl_time)
        layout.addLayout(toolbar)
        
        # Main Splitter
        main_split = QSplitter(Qt.Horizontal)
        layout.addWidget(main_split)
        
        # Left: Charts
        self.chart_widget = pg.GraphicsLayoutWidget()
        self.plot_gyro = self.chart_widget.addPlot(title="Gyro Z")
        self.curve_gyro = self.plot_gyro.plot(pen='c')
        self.vline_gyro = pg.InfiniteLine(angle=90, movable=False, pen=pg.mkPen('y', width=2))
        self.plot_gyro.addItem(self.vline_gyro)
        
        self.chart_widget.nextRow()
        
        self.plot_alt = self.chart_widget.addPlot(title="Altitude")
        self.curve_baro = self.plot_alt.plot(pen='r', name="Baro")
        self.curve_gps = self.plot_alt.plot(pen='g', name="GPS")
        self.vline_alt = pg.InfiniteLine(angle=90, movable=False, pen=pg.mkPen('y', width=2))
        self.plot_alt.addItem(self.vline_alt)
        
        main_split.addWidget(self.chart_widget)
        
        # Right Splitter: Web Views
        right_split = QSplitter(Qt.Vertical)
        main_split.addWidget(right_split)
        
        settings = QWebEngineSettings.globalSettings()
        settings.setAttribute(QWebEngineSettings.WebGLEnabled, True)
        settings.setAttribute(QWebEngineSettings.LocalContentCanAccessRemoteUrls, True)
        
        self.web_map = QWebEngineView()
        self.web_3d = QWebEngineView()
        
        self.web_map.load(QUrl("http://127.0.0.1:8999/desktop_map.html"))
        self.web_3d.load(QUrl("http://127.0.0.1:8999/desktop_3d.html"))
        
        right_split.addWidget(self.web_map)
        right_split.addWidget(self.web_3d)
        
        main_split.setSizes([700, 700])
        right_split.setSizes([450, 450])
        
    def load_file(self):
        filepath, _ = QFileDialog.getOpenFileName(self, "Open Flight Log", "", "Bin Files (*.bin);;All Files (*)")
        if filepath:
            self.data = parse_log_file(filepath)
            self.slider.setRange(0, len(self.data.times) - 1)
            self.slider.setValue(0)
            
            # Plot data
            self.curve_gyro.setData(self.data.times, self.data.imu_gyroz)
            
            if self.data.baro_alt:
                tx, ty = zip(*self.data.baro_alt)
                self.curve_baro.setData(tx, ty)
            if self.data.gps_alt:
                gx, gy = zip(*self.data.gps_alt)
                self.curve_gps.setData(gx, gy)
                
            # Set map path
            if self.data.lat:
                path = [[lat, lon] for lat, lon in zip(self.data.lat, self.data.lon)]
                self.web_map.page().runJavaScript(f"if(window.setPath) window.setPath({json.dumps(path)});")
                
            self.update_frame(0)
            
    def toggle_play(self):
        if not self.data: return
        self.is_playing = not self.is_playing
        self.btn_play.setText("PAUSE" if self.is_playing else "PLAY")
        if self.is_playing:
            self.timer.start()
        else:
            self.timer.stop()
            
    def tick(self):
        if not self.data: return
        self.current_idx += 5 # playback speed multiplier
        if self.current_idx >= len(self.data.times):
            self.current_idx = len(self.data.times) - 1
            self.toggle_play()
        self.slider.blockSignals(True)
        self.slider.setValue(self.current_idx)
        self.slider.blockSignals(False)
        self.update_frame(self.current_idx)
        
    def scrub(self, value):
        self.current_idx = value
        self.update_frame(self.current_idx)
        
    def update_frame(self, idx):
        if not self.data or idx >= len(self.data.times): return
        t = self.data.times[idx]
        self.lbl_time.setText(f"{t:.2f}s")
        
        self.vline_gyro.setValue(t)
        self.vline_alt.setValue(t)
        
        q = self.data.quaternions[idx]
        self.web_3d.page().runJavaScript(f"if(window.updateOrientation) window.updateOrientation({q[0]}, {q[1]}, {q[2]}, {q[3]});")
        
        hud = self.data.hud_data[idx]
        self.web_3d.page().runJavaScript(f"if(window.updateHUD) window.updateHUD({json.dumps(hud)});")
        
        # Approximate map location update (mapping time to nearest GPS point)
        # For a real app, use bisect to find nearest timestamp
        gps_idx = int((idx / len(self.data.times)) * len(self.data.lat))
        if gps_idx < len(self.data.lat):
            lat = self.data.lat[gps_idx]
            lon = self.data.lon[gps_idx]
            self.web_map.page().runJavaScript(f"if(window.updateMap) window.updateMap({lat}, {lon}, 0);")

if __name__ == "__main__":
    app = QApplication(sys.argv)
    
    # We must use high-DPI scaling
    QApplication.setHighDpiScaleFactorRoundingPolicy(Qt.HighDpiScaleFactorRoundingPolicy.PassThrough)
    
    window = FlightReplayApp()
    window.show()
    sys.exit(app.exec())
