/**
 * FlightMap - Leaflet.js GPS Ground Track Map Component
 *
 * Visualizes flight paths, GPS telemetry tracks, and real-time playback position
 * for UAV/aircraft log analysis. Designed with a dark cyber/telemetry theme.
 *
 * NOTE: Leaflet is expected to be loaded globally (window.L) via script tag.
 */

export class FlightMap {
  /**
   * Constructs the FlightMap instance.
   * @param {string|HTMLElement} containerId - Element ID or HTMLElement container for the map
   */
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.trackLine = null;
    this.marker = null;
    this.launched = false;

    // Track state
    this.startMarker = null;
    this.endMarker = null;
    this.latLngs = [];
    this.autoPan = true;

    // Observers for visibility and layout changes
    this._resizeObserver = null;
    this._intersectionObserver = null;
    this._visibilityTimeouts = [];
  }

  /**
   * Initializes the Leaflet map, Dark Matter basemap tiles, custom styling,
   * and visibility observers.
   * @returns {FlightMap}
   */
  init() {
    if (this.launched && this.map) {
      this.invalidateSize();
      return this;
    }

    if (typeof L === 'undefined') {
      console.error('FlightMap: Leaflet (L) must be loaded globally before calling init().');
      return this;
    }

    // Apply dark theme CSS overrides for Leaflet controls
    this._injectThemeStyles();

    // Style map container with dark background and cyan border/glow
    const container = this._getContainer();
    if (container) {
      container.style.border = '1px solid rgba(0, 229, 255, 0.3)';
      container.style.boxShadow = '0 0 15px rgba(0, 229, 255, 0.15)';
      container.style.backgroundColor = '#12161f';
      container.style.position = 'relative';
      container.style.overflow = 'hidden';
      container.style.borderRadius = '4px';
    }

    // Create Leaflet map instance
    this.map = L.map(this.containerId, {
      zoomControl: true,
      attributionControl: false
    });

    // Default view: [0, 0] zoom level 2
    this.map.setView([0, 0], 2);

    this.isOffline = false;
    
    // Add OpenStreetMap tile layer (free, no API key)
    this.tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(this.map);

    // Add compact attribution control in bottom-right
    L.control.attribution({
      position: 'bottomright',
      prefix: false
    })
      .addAttribution('&copy; <a href="https://carto.com/" target="_blank" rel="noopener">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OSM</a>')
      .addTo(this.map);

    // Add a North indicator arrow in the top-right
    const NorthControl = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function() {
        const div = L.DomUtil.create('div', 'leaflet-control-north');
        div.innerHTML = '⮝ N';
        div.style.backgroundColor = 'rgba(10, 10, 20, 0.8)';
        div.style.color = '#00e5ff';
        div.style.border = '1px solid rgba(0, 229, 255, 0.3)';
        div.style.padding = '4px 8px';
        div.style.borderRadius = '4px';
        div.style.fontFamily = "'JetBrains Mono', monospace";
        div.style.fontSize = '12px';
        div.style.fontWeight = 'bold';
        div.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.5)';
        div.style.pointerEvents = 'none';
        return div;
      }
    });
    this.map.addControl(new NorthControl());

    this.launched = true;

    // Handle maps initialized inside hidden or resizing containers
    this._setupVisibilityWatchers(container);

    return this;
  }

  /**
   * Toggles between online OpenStreetMap tiles and local offline tiles.
   */
  toggleOfflineMode(forceOffline = null) {
    if (!this.map || !this.tileLayer) return false;
    
    this.isOffline = forceOffline !== null ? forceOffline : !this.isOffline;
    
    const newUrl = this.isOffline 
        ? 'tiles/{z}/{x}/{y}.png' 
        : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
        
    this.tileLayer.setUrl(newUrl);
    return this.isOffline;
  }

  /**
   * Loads and renders a flight GPS track from log records.
   *
   * @param {Array<Object>} gpsRecords - Array of {type, time, data: {utc_time, lat, lon, gps_alt}}
   *                                    Lat/lon are UBX 1e-7 deg integers or decimal degrees.
   *                                    gps_alt is in mm.
   */
  loadTrack(gpsRecords) {
    if (!this.map) {
      this.init();
    }
    if (!this.map || !Array.isArray(gpsRecords) || gpsRecords.length === 0) {
      return;
    }

    // Clean up previous track elements
    this._clearTrackLayers();

    const latLngs = [];

    for (let i = 0; i < gpsRecords.length; i++) {
      const record = gpsRecords[i];
      if (!record) continue;

      const data = (record.data && typeof record.data === 'object') ? record.data : record;
      const rawLat = data.lat;
      const rawLon = data.lon;

      if (rawLat === undefined || rawLon === undefined || rawLat === null || rawLon === null) {
        continue;
      }

      // Filter out records where lat=0 and lon=0 (no GPS fix)
      if (rawLat === 0 && rawLon === 0) {
        continue;
      }

      const lat = this._normalizeCoordinate(rawLat, 90);
      const lon = this._normalizeCoordinate(rawLon, 180);

      if (lat === null || lon === null) {
        continue;
      }

      latLngs.push([lat, lon]);
    }

    if (latLngs.length === 0) {
      this.latLngs = [];
      return;
    }

    // Store points for fast timeline seeking
    this.latLngs = latLngs;

    // Draw track polyline: color #00e5ff (cyan), weight 2, opacity 0.8
    this.trackLine = L.polyline(latLngs, {
      color: '#00e5ff',
      weight: 2,
      opacity: 0.8,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.map);

    // Start circle marker (green, #44ff44, radius 6)
    const startPoint = latLngs[0];
    this.startMarker = L.circleMarker(startPoint, {
      radius: 6,
      color: '#44ff44',
      fillColor: '#44ff44',
      fillOpacity: 0.9,
      weight: 2
    }).addTo(this.map);
    this.startMarker.bindTooltip('Start', {
      className: 'flight-map-tooltip',
      direction: 'top'
    });

    // End circle marker (red, #ff4444, radius 6)
    const endPoint = latLngs[latLngs.length - 1];
    this.endMarker = L.circleMarker(endPoint, {
      radius: 6,
      color: '#ff4444',
      fillColor: '#ff4444',
      fillOpacity: 0.9,
      weight: 2
    }).addTo(this.map);
    this.endMarker.bindTooltip('End', {
      className: 'flight-map-tooltip',
      direction: 'top'
    });

    // Moving position marker (cyan circle, radius 5, filled) at start position
    this.marker = L.circleMarker(startPoint, {
      radius: 5,
      color: '#00e5ff',
      fillColor: '#00e5ff',
      fillOpacity: 1.0,
      weight: 2
    }).addTo(this.map);

    // Invalidate size in case container size stabilized, then fit bounds
    this.invalidateSize();

    const bounds = this.trackLine.getBounds();
    if (bounds.isValid()) {
      this.map.fitBounds(bounds, {
        padding: [30, 30],
        maxZoom: 18
      });
    }
  }

  /**
   * Updates the moving marker position during playback or live telemetry.
   *
   * @param {Object} gpsData - {utc_time, lat, lon, gps_alt} or record with .data property
   */
  updatePosition(gpsData) {
    if (!gpsData || !this.map) return;

    const data = (gpsData.data && typeof gpsData.data === 'object') ? gpsData.data : gpsData;
    const rawLat = data.lat;
    const rawLon = data.lon;

    if (rawLat === undefined || rawLon === undefined || rawLat === null || rawLon === null) {
      return;
    }

    if (rawLat === 0 && rawLon === 0) {
      return;
    }

    const lat = this._normalizeCoordinate(rawLat, 90);
    const lon = this._normalizeCoordinate(rawLon, 180);

    if (lat === null || lon === null) return;

    const latLng = [lat, lon];
    this._setMarkerPosition(latLng);
  }

  /**
   * Moves the marker to the coordinate corresponding to the given index
   * in the stored latLng array.
   *
   * @param {number} index - Index into stored track points
   */
  seekToIndex(index) {
    if (!this.latLngs || this.latLngs.length === 0 || !this.map) {
      return;
    }

    if (typeof index !== 'number' || isNaN(index)) {
      return;
    }

    const clampedIndex = Math.max(0, Math.min(Math.floor(index), this.latLngs.length - 1));
    const targetLatLng = this.latLngs[clampedIndex];

    if (!targetLatLng) return;

    this._setMarkerPosition(targetLatLng);
  }

  /**
   * Converts GPS altitude from millimeters to meters.
   *
   * @param {Object} gpsData - {gps_alt, ...} or record with .data property
   * @returns {number} Altitude in meters
   */
  getAltitude(gpsData) {
    if (!gpsData) return 0;
    const data = (gpsData.data && typeof gpsData.data === 'object') ? gpsData.data : gpsData;
    const rawAlt = data.gps_alt !== undefined ? data.gps_alt : data.alt;

    if (typeof rawAlt !== 'number' || isNaN(rawAlt)) {
      return 0;
    }

    // gps_alt (hMSL) in mm -> convert to meters
    return rawAlt / 1000;
  }

  /**
   * Forces Leaflet to recalculate the map container size and redraw tiles.
   */
  invalidateSize() {
    if (this.map && typeof this.map.invalidateSize === 'function') {
      this.map.invalidateSize();
    }
  }

  /**
   * Enables or disables automatic panning to keep marker in view.
   * @param {boolean} enabled
   */
  setAutoPan(enabled) {
    this.autoPan = Boolean(enabled);
  }

  /**
   * Cleans up map layers, observers, timers, and the Leaflet map instance.
   */
  destroy() {
    this._clearVisibilityWatchers();
    this._clearTrackLayers();

    if (this.map) {
      this.map.remove();
      this.map = null;
    }

    this.latLngs = [];
    this.launched = false;
  }

  // ==========================================
  // Internal Helpers
  // ==========================================

  /**
   * Converts coordinates from UBX 1e-7 scale to decimal degrees if needed.
   * @private
   */
  _normalizeCoordinate(val, maxDegrees) {
    if (typeof val !== 'number' || isNaN(val)) {
      return null;
    }

    // If coordinate exceeds valid degrees range (or is a large integer in 1e-7 format)
    if (Math.abs(val) > maxDegrees || (Number.isInteger(val) && Math.abs(val) > 1000)) {
      val = val / 1e7;
    }

    if (val < -maxDegrees || val > maxDegrees) {
      return null;
    }

    return val;
  }

  /**
   * Updates marker position and optionally pans the map if out of view.
   * @private
   */
  _setMarkerPosition(latLng) {
    if (this.marker) {
      this.marker.setLatLng(latLng);
    } else if (this.map && typeof L !== 'undefined') {
      this.marker = L.circleMarker(latLng, {
        radius: 5,
        color: '#00e5ff',
        fillColor: '#00e5ff',
        fillOpacity: 1.0,
        weight: 2
      }).addTo(this.map);
    }

    // Optionally pan the map if the marker moves outside visible bounds
    if (this.autoPan && this.map) {
      const bounds = this.map.getBounds();
      if (bounds.isValid() && !bounds.contains(latLng)) {
        this.map.panTo(latLng);
      }
    }
  }

  /**
   * Clears track polyline and start/end/moving markers.
   * @private
   */
  _clearTrackLayers() {
    if (this.trackLine && this.map) {
      this.map.removeLayer(this.trackLine);
      this.trackLine = null;
    }
    if (this.startMarker && this.map) {
      this.map.removeLayer(this.startMarker);
      this.startMarker = null;
    }
    if (this.endMarker && this.map) {
      this.map.removeLayer(this.endMarker);
      this.endMarker = null;
    }
    if (this.marker && this.map) {
      this.map.removeLayer(this.marker);
      this.marker = null;
    }
  }

  /**
   * Obtains the DOM container element.
   * @private
   */
  _getContainer() {
    if (typeof document === 'undefined') return null;
    if (typeof this.containerId === 'string') {
      return document.getElementById(this.containerId);
    }
    return this.containerId;
  }

  /**
   * Observes container visibility & size changes so invalidateSize() is called
   * when tabs switch, modal opens, or elements become unhidden.
   * @private
   */
  _setupVisibilityWatchers(container) {
    // Staggered size invalidation checks for animation / deferred rendering
    const delays = [50, 150, 400, 1000];
    delays.forEach(delay => {
      const timerId = setTimeout(() => {
        this.invalidateSize();
      }, delay);
      this._visibilityTimeouts.push(timerId);
    });

    if (!container) return;

    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
          if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
            this.invalidateSize();
          }
        }
      });
      this._resizeObserver.observe(container);
    }

    if (typeof IntersectionObserver !== 'undefined') {
      this._intersectionObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.invalidateSize();
          }
        }
      });
      this._intersectionObserver.observe(container);
    }
  }

  /**
   * Cleans up observers and scheduled timeout checks.
   * @private
   */
  _clearVisibilityWatchers() {
    this._visibilityTimeouts.forEach(id => clearTimeout(id));
    this._visibilityTimeouts = [];

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    if (this._intersectionObserver) {
      this._intersectionObserver.disconnect();
      this._intersectionObserver = null;
    }
  }

  /**
   * Injects cyber/dark-themed CSS rules for Leaflet controls, zoom buttons,
   * attributions, and popups.
   * @private
   */
  _injectThemeStyles() {
    if (typeof document === 'undefined') return;

    const styleId = 'flight-map-theme-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .leaflet-container {
        background-color: #0c1017 !important;
        font-family: inherit;
        outline: none;
      }
      .leaflet-layer,
      .leaflet-control-zoom-in,
      .leaflet-control-zoom-out,
      .leaflet-control-attribution {
        filter: invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%);
      }
      .leaflet-bar {
        border: 1px solid rgba(0, 229, 255, 0.3) !important;
        box-shadow: 0 0 10px rgba(0, 0, 0, 0.6) !important;
        border-radius: 4px !important;
        overflow: hidden;
      }
      .leaflet-bar a {
        background-color: #141a24 !important;
        color: #00e5ff !important;
        border-bottom: 1px solid rgba(0, 229, 255, 0.2) !important;
        transition: background-color 0.15s ease, color 0.15s ease;
      }
      .leaflet-bar a:hover {
        background-color: #1f2937 !important;
        color: #64ffda !important;
      }
      .leaflet-bar a.leaflet-disabled {
        background-color: #0d1219 !important;
        color: #4b5563 !important;
      }
      .leaflet-control-attribution {
        background: rgba(15, 20, 29, 0.8) !important;
        color: rgba(255, 255, 255, 0.45) !important;
        font-size: 10px !important;
        padding: 2px 6px !important;
        border-radius: 3px 0 0 0 !important;
        backdrop-filter: blur(4px);
      }
      .leaflet-control-attribution a {
        color: #00e5ff !important;
        text-decoration: none;
      }
      .leaflet-control-attribution a:hover {
        text-decoration: underline;
      }
      .flight-map-tooltip {
        background: rgba(15, 20, 29, 0.92) !important;
        border: 1px solid rgba(0, 229, 255, 0.4) !important;
        color: #e0f2fe !important;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5) !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        padding: 3px 7px !important;
        border-radius: 3px !important;
        letter-spacing: 0.03em;
      }
      .flight-map-tooltip::before {
        border-top-color: rgba(0, 229, 255, 0.4) !important;
      }
    `;
    document.head.appendChild(style);
  }
}

export default FlightMap;
