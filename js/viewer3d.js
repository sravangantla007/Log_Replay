import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * 3D Orientation Visualizer for Avionics PCB using Three.js.
 *
 * Coordinate System:
 * - Z = UP (vertical)
 * - X = Toward user/camera
 * - Y = Right
 */
export class Viewer3D {
  /**
   * @param {string | HTMLElement} containerId - DOM element or ID of container element
   */
  constructor(containerId) {
    // 1. Resolve container element
    this.container = typeof containerId === 'string'
      ? document.getElementById(containerId)
      : containerId;

    if (!this.container) {
      throw new Error(`Viewer3D: Container element "${containerId}" not found.`);
    }

    // Ensure container has relative positioning for absolute HUD overlay
    const computedPosition = window.getComputedStyle(this.container).position;
    if (computedPosition === 'static') {
      this.container.style.position = 'relative';
    }

    const width = this.container.clientWidth || 300;
    const height = this.container.clientHeight || 300;

    // 2. WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.container.appendChild(this.renderer.domElement);

    // 3. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a14);

    // 4. Perspective Camera (Z-up coordinate system)
    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    this.camera.up.set(0, 0, 1); // Z = UP
    this.camera.position.set(5, -4, 3.5);
    this.camera.lookAt(0, 0, 0);

    // 5. OrbitControls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.update();

    // 6. Lights
    const ambientLight = new THREE.AmbientLight(0x404060);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0x00e5ff, 0.8);
    directionalLight.position.set(5, -5, 10);
    this.scene.add(directionalLight);

    // 7. Orientation State
    this.currentYaw = 0;
    this.targetQuaternion = new THREE.Quaternion();
    this._lastTimestamp = null;
    this.isDestroyed = false;

    // 8. Construct Elements
    this._createPcbCuboid();
    this._createAxisArrows();
    this._createGrid();
    this._createHUD();

    // 9. Resize Observer
    this._setupResizeObserver();

    // 10. Start Animation Loop
    this._animate = this._animate.bind(this);
    this.animationFrameId = requestAnimationFrame(this._animate);
  }

  /**
   * Builds the PCB cuboid group with edges, wireframe overlay, and axis edge dots.
   * Box dimensions: X=2.5 (depth toward user), Y=3.5 (width right), Z=0.3 (height up)
   */
  _createPcbCuboid() {
    this.pcbGroup = new THREE.Group();

    // Cuboid geometry: X=2.5, Y=3.5, Z=0.3
    const pcbGeometry = new THREE.BoxGeometry(2.5, 3.5, 0.3);

    // Main material
    const mainMaterial = new THREE.MeshPhongMaterial({
      color: 0x0a1628,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide
    });
    const pcbMesh = new THREE.Mesh(pcbGeometry, mainMaterial);
    this.pcbGroup.add(pcbMesh);

    // Edge highlight
    const edgesGeometry = new THREE.EdgesGeometry(pcbGeometry);
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x00e5ff,
      linewidth: 1
    });
    const edgeLines = new THREE.LineSegments(edgesGeometry, edgeMaterial);
    this.pcbGroup.add(edgeLines);

    // Wireframe overlay
    const wireframeGeometry = new THREE.WireframeGeometry(pcbGeometry);
    const wireframeMaterial = new THREE.LineBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.1
    });
    const wireframeLines = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
    this.pcbGroup.add(wireframeLines);

    // Colored indicator dots on PCB edges (radius: 0.08)
    const dotGeometry = new THREE.SphereGeometry(0.08, 16, 16);

    // +X edge dot: Red (#ff4444) at (+1.25, 0, 0)
    const redMaterial = new THREE.MeshBasicMaterial({ color: 0xff4444 });
    const dotX = new THREE.Mesh(dotGeometry, redMaterial);
    dotX.position.set(1.25, 0, 0);
    this.pcbGroup.add(dotX);

    // +Y edge dot: Green (#44ff44) at (0, +1.75, 0)
    const greenMaterial = new THREE.MeshBasicMaterial({ color: 0x44ff44 });
    const dotY = new THREE.Mesh(dotGeometry, greenMaterial);
    dotY.position.set(0, 1.75, 0);
    this.pcbGroup.add(dotY);

    // +Z edge dot: Blue (#4488ff) at (0, 0, +0.15)
    const blueMaterial = new THREE.MeshBasicMaterial({ color: 0x4488ff });
    const dotZ = new THREE.Mesh(dotGeometry, blueMaterial);
    dotZ.position.set(0, 0, 0.15);
    this.pcbGroup.add(dotZ);

    this.scene.add(this.pcbGroup);
  }

  /**
   * Builds fixed world reference axes (X=red, Y=green, Z=blue) with text labels.
   */
  _createAxisArrows() {
    const origin = new THREE.Vector3(0, 0, 0);
    const length = 3;
    const headLength = 0.4;
    const headWidth = 0.2;

    // X-axis: red (#ff4444), direction (1, 0, 0)
    const arrowX = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      origin,
      length,
      0xff4444,
      headLength,
      headWidth
    );
    this.scene.add(arrowX);

    // Y-axis: green (#44ff44), direction (0, 1, 0)
    const arrowY = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      origin,
      length,
      0x44ff44,
      headLength,
      headWidth
    );
    this.scene.add(arrowY);

    // Z-axis: blue (#4488ff), direction (0, 0, 1)
    const arrowZ = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      origin,
      length,
      0x4488ff,
      headLength,
      headWidth
    );
    this.scene.add(arrowZ);

    // Axis labels at arrow tips
    const labelX = this._createLabelSprite('+X', '#ff4444');
    labelX.position.set(3.25, 0, 0);
    this.scene.add(labelX);

    const labelY = this._createLabelSprite('+Y', '#44ff44');
    labelY.position.set(0, 3.25, 0);
    this.scene.add(labelY);

    const labelZ = this._createLabelSprite('+Z', '#4488ff');
    labelZ.position.set(0, 0, 3.25);
    this.scene.add(labelZ);
  }

  /**
   * Helper to generate a billboard sprite with text for axis labels.
   */
  _createLabelSprite(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    ctx.font = 'bold 36px "JetBrains Mono", monospace';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(0.8, 0.4, 1);
    return sprite;
  }

  /**
   * Builds the horizontal reference grid on the XY plane.
   */
  _createGrid() {
    // GridHelper default plane is XZ (Y is up).
    // Rotate 90 degrees around X-axis to position on XY plane (Z is up).
    const grid = new THREE.GridHelper(10, 20, 0x1a2a3a, 0x0d1520);
    grid.rotation.x = Math.PI / 2;
    this.scene.add(grid);
  }

  /**
   * Creates the HUD overlay element displaying telemetry values.
   */
  _createHUD() {
    this.hudOverlay = document.createElement('div');
    this.hudOverlay.className = 'viewer3d-hud';

    Object.assign(this.hudOverlay.style, {
      position: 'absolute',
      top: '10px',
      right: '10px',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '11px',
      color: '#00e5ff',
      background: 'rgba(10, 10, 20, 0.8)',
      border: '1px solid rgba(0, 229, 255, 0.3)',
      padding: '8px 12px',
      borderRadius: '4px',
      pointerEvents: 'none',
      whiteSpace: 'pre',
      lineHeight: '1.4',
      zIndex: '10',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)'
    });

    this.container.appendChild(this.hudOverlay);
    this.updateHUD({ ax: 0, ay: 0, az: 2048, gx: 0, gy: 0, gz: 0 });
  }

  /**
   * Observes container resize to update camera aspect ratio and renderer viewport.
   */
  _setupResizeObserver() {
    this._onResize = () => {
      if (this.isDestroyed || !this.container) return;
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      if (width === 0 || height === 0) return;

      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    };

    this.resizeObserver = new ResizeObserver(this._onResize);
    this.resizeObserver.observe(this.container);
  }

  /**
   * Main render and animation loop.
   */
  _animate() {
    if (this.isDestroyed) return;

    this.animationFrameId = requestAnimationFrame(this._animate);

    this.controls.update();

    // Smoothly SLERP PCB quaternion toward target quaternion
    if (this.pcbGroup && this.targetQuaternion) {
      this.pcbGroup.quaternion.slerp(this.targetQuaternion, 0.12);
    }

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Updates orientation from IMU telemetry.
   *
   * @param {Object} imuData
   * @param {number} imuData.ax - Accelerometer X (raw counts, ~2048 = 1g)
   * @param {number} imuData.ay - Accelerometer Y (raw counts, ~2048 = 1g)
   * @param {number} imuData.az - Accelerometer Z (raw counts, ~2048 = 1g)
   * @param {number} imuData.gx - Gyroscope X (raw counts, ~16.4 = 1°/s)
   * @param {number} imuData.gy - Gyroscope Y (raw counts, ~16.4 = 1°/s)
   * @param {number} imuData.gz - Gyroscope Z (raw counts, ~16.4 = 1°/s)
   * @param {number} [imuData.dt] - Optional time delta in seconds
   */
  updateOrientation(imuData) {
    if (!imuData) return;

    const ax = imuData.ax ?? 0;
    const ay = imuData.ay ?? 0;
    const az = imuData.az ?? 0;
    const gz = imuData.gz ?? 0;

    // Convert raw counts:
    // ~2048 counts = 1g for accel
    const ax_g = ax / 2048;
    const ay_g = ay / 2048;
    const az_g = az / 2048;

    // ~16.4 counts = 1°/s for gyro
    const gz_dps = gz / 16.4;

    // Calculate roll and pitch from accelerometer
    const roll = Math.atan2(ay_g, az_g);
    const pitch = Math.atan2(-ax_g, Math.hypot(ay_g, az_g));

    // Calculate time delta for yaw integration
    const now = performance.now();
    let dt = 0.02; // default 50Hz (20ms)
    if (typeof imuData.dt === 'number' && imuData.dt > 0) {
      dt = imuData.dt;
    } else if (this._lastTimestamp !== null) {
      dt = Math.min((now - this._lastTimestamp) / 1000, 0.2);
    }
    this._lastTimestamp = now;

    // Integrate gyro gz for yaw: currentYaw += (gz / 16.4) * (PI/180) * dt
    this.currentYaw += gz_dps * (Math.PI / 180) * dt;

    // Create target quaternion from Euler(roll, pitch, currentYaw, 'XYZ')
    const targetEuler = new THREE.Euler(roll, pitch, this.currentYaw, 'XYZ');
    this.targetQuaternion.setFromEuler(targetEuler);

    // Apply SLERP step immediately
    this.pcbGroup.quaternion.slerp(this.targetQuaternion, 0.12);

    // Update HUD display
    this.updateHUD(imuData);
  }

  /**
   * Updates the HUD overlay with formatted accelerometer and gyroscope metrics.
   *
   * @param {Object} imuData - {ax, ay, az, gx, gy, gz} in raw counts
   */
  updateHUD(imuData) {
    if (!this.hudOverlay || !imuData) return;

    const ax_g = ((imuData.ax ?? 0) / 2048).toFixed(2);
    const ay_g = ((imuData.ay ?? 0) / 2048).toFixed(2);
    const az_g = ((imuData.az ?? 0) / 2048).toFixed(2);

    const gx_dps = ((imuData.gx ?? 0) / 16.4).toFixed(1);
    const gy_dps = ((imuData.gy ?? 0) / 16.4).toFixed(1);
    const gz_dps = ((imuData.gz ?? 0) / 16.4).toFixed(1);

    const formatSigned = (val, padLen) => {
      const num = Number(val);
      const sign = num >= 0 ? '+' : '';
      return (sign + val).padStart(padLen);
    };

    this.hudOverlay.textContent = [
      'ACCEL (g)',
      `  X: ${formatSigned(ax_g, 6)}  Y: ${formatSigned(ay_g, 6)}  Z: ${formatSigned(az_g, 6)}`,
      '',
      'GYRO (°/s)',
      `  X: ${formatSigned(gx_dps, 6)}  Y: ${formatSigned(gy_dps, 6)}  Z: ${formatSigned(gz_dps, 6)}`
    ].join('\n');
  }

  /**
   * Resets PCB orientation to identity and yaw to zero.
   */
  reset() {
    this.currentYaw = 0;
    this.targetQuaternion.identity();
    this.pcbGroup.quaternion.identity();
    this._lastTimestamp = null;
    this.updateHUD({ ax: 0, ay: 0, az: 2048, gx: 0, gy: 0, gz: 0 });
  }

  /**
   * Disposes all resources, event listeners, and removes rendered DOM nodes.
   */
  destroy() {
    this.isDestroyed = true;

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }

    // Traverse and dispose geometries, materials, and textures
    this.scene.traverse((child) => {
      if (child.geometry) {
        child.geometry.dispose();
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => {
            if (mat.map) mat.map.dispose();
            mat.dispose();
          });
        } else {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      }
    });

    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement && this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
      this.renderer = null;
    }

    if (this.hudOverlay && this.hudOverlay.parentNode) {
      this.hudOverlay.parentNode.removeChild(this.hudOverlay);
      this.hudOverlay = null;
    }

    this.container = null;
    this.scene = null;
    this.camera = null;
    this.pcbGroup = null;
  }
}
