/**
 * Playback timeline engine for flight data visualizer.
 *
 * Operates on a sorted array of telemetry records (sorted by time in milliseconds).
 * Each record shape: { type: number, typeName: string, time: number, data: Object }
 *
 * Provides real-time and variable-speed playback driven by requestAnimationFrame,
 * virtual time tracking, binary search seeking, and event emitter capabilities.
 */
export class Timeline {
  /**
   * Initializes timeline state and listener subscriptions.
   *
   * @param {Array<Object>} [records=[]] - Initial sorted telemetry records
   */
  constructor(records = []) {
    this.records = Array.isArray(records) ? records : [];
    this.currentIndex = 0;
    this.playing = false;
    this.speed = 1.0;

    /**
     * Map of registered event listener sets.
     * Events: 'tick', 'indexChange', 'stateChange', 'load'
     * @type {Map<string, Set<Function>>}
     */
    this.listeners = new Map([
      ['tick', new Set()],
      ['indexChange', new Set()],
      ['stateChange', new Set()],
      ['load', new Set()]
    ]);

    // Animation frame handle and clock tracking
    this._rafId = null;
    this._wallStart = 0;
    this._virtualStart = 0;
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  /**
   * Whether the timeline is currently playing.
   * @returns {boolean}
   */
  get isPlaying() {
    return this.playing;
  }

  /**
   * Normalized playback progress between 0.0 and 1.0.
   * @returns {number}
   */
  get progress() {
    if (this.records.length <= 1) {
      return 0;
    }
    return this.currentIndex / (this.records.length - 1);
  }

  /**
   * Virtual timestamp (in milliseconds) of current record.
   * @returns {number}
   */
  get currentTime() {
    return this.records[this.currentIndex]?.time ?? 0;
  }

  /**
   * Total duration (in milliseconds) from first to last record.
   * @returns {number}
   */
  get duration() {
    if (this.records.length <= 1) {
      return 0;
    }
    return this.records[this.records.length - 1].time - this.records[0].time;
  }

  // ---------------------------------------------------------------------------
  // Event Subscription
  // ---------------------------------------------------------------------------

  /**
   * Registers an event listener.
   * Supported events: 'tick', 'indexChange', 'stateChange', 'load'
   *
   * @param {string} event - Event name
   * @param {Function} callback - Event listener callback
   * @returns {Function} Unsubscribe function
   */
  on(event, callback) {
    if (typeof callback !== 'function') return () => {};
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  /**
   * Removes an event listener or clears all listeners for an event.
   *
   * @param {string} event - Event name
   * @param {Function} [callback] - Specific callback to remove. If omitted, clears all for event.
   */
  off(event, callback) {
    const set = this.listeners.get(event);
    if (!set) return;
    if (callback) {
      set.delete(callback);
    } else {
      set.clear();
    }
  }

  /**
   * Dispatches an event to all registered listeners safely.
   *
   * @param {string} event - Event name
   * @param {...*} args - Arguments forwarded to listener callbacks
   * @private
   */
  _emit(event, ...args) {
    const callbacks = this.listeners.get(event);
    if (!callbacks || callbacks.size === 0) return;

    for (const cb of Array.from(callbacks)) {
      try {
        cb(...args);
      } catch (err) {
        console.error(`Timeline: Error in '${event}' listener:`, err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Playback Control
  // ---------------------------------------------------------------------------

  /**
   * Loads a new array of sorted records, resets currentIndex to 0, and stops playback.
   *
   * @param {Array<Object>} records - Sorted telemetry records
   */
  load(records = []) {
    this.pause();
    this.records = Array.isArray(records) ? records : [];
    this.currentIndex = 0;

    this._emit('load', this.records);
    this._emit('indexChange', this.currentIndex, this.records.length);
  }

  /**
   * Starts real-time playback driven by requestAnimationFrame.
   * Emits records matching elapsed virtual time.
   */
  play() {
    if (this.playing) return;
    if (this.records.length === 0) return;

    // If at or past the end, restart from the beginning
    if (this.currentIndex >= this.records.length - 1) {
      this.currentIndex = 0;
      this._emit('indexChange', this.currentIndex, this.records.length);
    }

    this.playing = true;
    this._emit('stateChange', this.playing, { playing: this.playing, speed: this.speed });

    this._wallStart = performance.now();
    this._virtualStart = this.records[this.currentIndex]?.time ?? 0;

    const tick = (now) => {
      if (!this.playing) return;

      const wallElapsed = now - this._wallStart;
      const virtualTarget = this._virtualStart + wallElapsed * this.speed;

      while (
        this.currentIndex < this.records.length &&
        this.records[this.currentIndex].time <= virtualTarget
      ) {
        this._emit('tick', this.records[this.currentIndex], this.currentIndex);
        this.currentIndex++;
      }

      if (this.currentIndex < this.records.length) {
        this._emit('indexChange', this.currentIndex, this.records.length);
        this._rafId = requestAnimationFrame(tick);
      } else {
        // Auto-stop at end of records
        this.currentIndex = Math.max(0, this.records.length - 1);
        this._emit('indexChange', this.currentIndex, this.records.length);
        this.pause();
      }
    };

    this._rafId = requestAnimationFrame(tick);
  }

  /**
   * Pauses playback and cancels any active requestAnimationFrame.
   */
  pause() {
    if (!this.playing && this._rafId === null) return;

    this.playing = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    this._emit('stateChange', this.playing, { playing: this.playing, speed: this.speed });
  }

  /**
   * Steps forward by one record if not at end.
   */
  stepForward() {
    if (this.records.length === 0) return;
    if (this.currentIndex < this.records.length - 1) {
      this.seek(this.currentIndex + 1);
    }
  }

  /**
   * Steps backward by one record if not at start.
   */
  stepBack() {
    if (this.records.length === 0) return;
    if (this.currentIndex > 0) {
      this.seek(this.currentIndex - 1);
    }
  }

  /**
   * Seeks to a specific record index (clamped between 0 and records.length - 1).
   * Restarts wall clock if currently playing.
   *
   * @param {number} index - Target record index
   */
  seek(index) {
    if (this.records.length === 0) return;

    const parsedIndex = Number(index);
    const validIndex = Number.isFinite(parsedIndex) ? Math.round(parsedIndex) : 0;
    const clamped = Math.max(0, Math.min(validIndex, this.records.length - 1));

    this.currentIndex = clamped;

    if (this.playing) {
      this._wallStart = performance.now();
      this._virtualStart = this.records[this.currentIndex]?.time ?? 0;
    }

    const record = this.records[this.currentIndex];
    this._emit('tick', record, this.currentIndex);
    this._emit('indexChange', this.currentIndex, this.records.length);
  }

  /**
   * Performs binary search for the record nearest to timeMs, then seeks to it.
   *
   * @param {number} timeMs - Target time in milliseconds
   * @returns {number} The resolved record index seeked to, or -1 if empty
   */
  seekToTime(timeMs) {
    if (this.records.length === 0) return -1;

    const targetTime = Number(timeMs);
    if (!Number.isFinite(targetTime)) return -1;

    // Fast bounds checking
    if (targetTime <= this.records[0].time) {
      this.seek(0);
      return 0;
    }

    const lastIdx = this.records.length - 1;
    if (targetTime >= this.records[lastIdx].time) {
      this.seek(lastIdx);
      return lastIdx;
    }

    // Binary search for nearest timestamp
    let low = 0;
    let high = lastIdx;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const midTime = this.records[mid].time;

      if (midTime === targetTime) {
        this.seek(mid);
        return mid;
      } else if (midTime < targetTime) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    // high and low are adjacent (low = high + 1)
    const diffHigh = Math.abs(this.records[high].time - targetTime);
    const diffLow = Math.abs(this.records[low].time - targetTime);
    const nearestIndex = diffHigh <= diffLow ? high : low;

    this.seek(nearestIndex);
    return nearestIndex;
  }

  /**
   * Updates playback speed multiplier (e.g. 0.25, 0.5, 1.0, 2.0, 5.0, 10.0).
   * Adjusts clock reference if currently playing to prevent discontinuities.
   *
   * @param {number} multiplier - Speed multiplier (> 0)
   */
  setSpeed(multiplier) {
    const speed = Number(multiplier);
    if (!Number.isFinite(speed) || speed <= 0) return;

    if (this.playing) {
      const now = performance.now();
      const wallElapsed = now - this._wallStart;
      this._virtualStart = this._virtualStart + wallElapsed * this.speed;
      this._wallStart = now;
    }

    this.speed = speed;
    this._emit('stateChange', this.playing, { playing: this.playing, speed: this.speed });
  }

  // ---------------------------------------------------------------------------
  // Static Utilities
  // ---------------------------------------------------------------------------

  /**
   * Formats milliseconds into 'MM:SS.mmm' string representation.
   *
   * @param {number} ms - Milliseconds
   * @returns {string} Formatted time string
   */
  static formatTime(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
      return '00:00.000';
    }

    const totalMs = Math.floor(ms);
    const milliseconds = totalMs % 1000;
    const totalSeconds = Math.floor(totalMs / 1000);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60);

    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    const mmm = String(milliseconds).padStart(3, '0');

    return `${mm}:${ss}.${mmm}`;
  }
}

export default Timeline;
