import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * 3D Orientation Visualizer for Avionics PCB using Three.js.
 *
 * Coordinate System:
 * - Z = UP (vertical)
 * - X = Toward user/camera
 * - Y = Right
 */
export class Viewer3D {
  constructor(containerId) {
    this.container = typeof containerId === 'string'
      ? document.getElementById(containerId)
      : containerId;

    if (!this.container) {
      throw new Error(`Viewer3D: Container element "${containerId}" not found.`);
    }

    const computedPosition = window.getComputedStyle(this.container).position;
    if (computedPosition === 'static') {
      this.container.style.position = 'relative';
    }

    const width = this.container.clientWidth || 300;
    const height = this.container.clientHeight || 300;

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
    // Important for GLTF materials:
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a14);

    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(5, -4, 3.5);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.update();

    const ambientLight = new THREE.AmbientLight(0xffffff, 2.5); // Brighter ambient
    this.scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2.0);
    hemiLight.position.set(0, 0, 10);
    this.scene.add(hemiLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight1.position.set(5, -5, 10);
    this.scene.add(dirLight1);
    
    const dirLight2 = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight2.position.set(-5, 5, -10);
    this.scene.add(dirLight2);

    this.currentYaw = 0;
    this.targetQuaternion = new THREE.Quaternion();
    this._lastTimestamp = null;
    this.isDestroyed = false;

    this._createOffsetControls();
    this._createPcbCuboid();
    this._createAxisArrows();
    this._createGrid();
    this._createHUD();

    this._setupResizeObserver();

    this._animate = this._animate.bind(this);
    this.animationFrameId = requestAnimationFrame(this._animate);
  }

  _createPcbCuboid() {
    this.pcbGroup = new THREE.Group();
    this.scene.add(this.pcbGroup);

    const loader = new GLTFLoader();
    loader.load('board.glb', (gltf) => {
      const obj = gltf.scene;
      
      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      
      this.pcbWrapper = new THREE.Group();
      this.pcbWrapper.add(obj);

      // Translate the object so its bounding box center is exactly at the origin of the wrapper
      obj.position.set(-center.x, -center.y, -center.z);

      // Now apply scaling and rotation to the wrapper
      const size = box.getSize(new THREE.Vector3());
      const scale = 3.5 / Math.max(size.x, size.y, size.z);
      this.pcbWrapper.scale.set(scale, scale, scale);

      // Adjust rotation if needed to face +X upright
      this.pcbWrapper.rotation.y = Math.PI / 2;
      this.pcbWrapper.rotation.x = Math.PI / 2;

      // Make materials brighter
      this.pcbWrapper.traverse((child) => {
        if (child.isMesh && child.material) {
            // Convert to a basic array iteration if material is array
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(mat => {
                if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
                    mat.metalness = 0.1; // Reduce metalness to stop it from reflecting black (since we have no environment map)
                    mat.roughness = 0.8; // Increase roughness for softer, brighter diffuse light
                    mat.envMapIntensity = 0.0;
                    mat.needsUpdate = true;
                }
            });
        }
      });

      // Apply initial offset if set before load
      if (this.initialOffset) {
         this.pcbWrapper.position.copy(this.initialOffset);
      }

      this.pcbGroup.add(this.pcbWrapper);

      this._addAxisDots();
      console.log('Loaded Avionics Board GLB successfully (with colors)');
    }, undefined, (error) => {
      console.warn('Failed to load GLB, using fallback upright cuboid', error);
      
      const pcbGeometry = new THREE.BoxGeometry(0.3, 2.5, 3.5);
      const mainMaterial = new THREE.MeshPhongMaterial({
        color: 0x0a1628, transparent: true, opacity: 0.7, side: THREE.DoubleSide
      });
      const pcbMesh = new THREE.Mesh(pcbGeometry, mainMaterial);
      this.pcbGroup.add(pcbMesh);

      const edgesGeometry = new THREE.EdgesGeometry(pcbGeometry);
      const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x00e5ff, linewidth: 1 });
      this.pcbGroup.add(new THREE.LineSegments(edgesGeometry, edgeMaterial));
      
      const wireframeGeometry = new THREE.WireframeGeometry(pcbGeometry);
      const wireframeMaterial = new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.1 });
      this.pcbGroup.add(new THREE.LineSegments(wireframeGeometry, wireframeMaterial));
      
      this._addAxisDots();
    });
  }

  _addAxisDots() {
    const dotGeometry = new THREE.SphereGeometry(0.08, 16, 16);
    
    // +X edge dot: Red
    const dotX = new THREE.Mesh(dotGeometry, new THREE.MeshBasicMaterial({ color: 0xff4444 }));
    dotX.position.set(0.15, 0, 0); // Moved close to +X face
    this.pcbGroup.add(dotX);

    // +Y edge dot: Green
    const dotY = new THREE.Mesh(dotGeometry, new THREE.MeshBasicMaterial({ color: 0x44ff44 }));
    dotY.position.set(0, 1.25, 0);
    this.pcbGroup.add(dotY);

    // +Z edge dot: Blue
    const dotZ = new THREE.Mesh(dotGeometry, new THREE.MeshBasicMaterial({ color: 0x4488ff }));
    dotZ.position.set(0, 0, 1.75);
    this.pcbGroup.add(dotZ);
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
   * Creates a panel with sliders to adjust the origin offset.
   */
  _createOffsetControls() {
    this.initialOffset = new THREE.Vector3(0, 0, 0);

    this.offsetPanel = document.createElement('div');
    Object.assign(this.offsetPanel.style, {
      position: 'absolute',
      bottom: '10px',
      left: '10px',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '11px',
      color: '#fff',
      background: 'rgba(10, 10, 20, 0.8)',
      border: '1px solid rgba(0, 229, 255, 0.3)',
      padding: '8px',
      borderRadius: '4px',
      zIndex: '10',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)'
    });

    const createSlider = (axis, min, max, val) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      
      const label = document.createElement('span');
      label.textContent = `Offset ${axis.toUpperCase()}`;
      label.style.width = '60px';
      label.style.color = '#00e5ff';

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = min;
      slider.max = max;
      slider.step = 0.01;
      slider.value = val;
      slider.style.width = '100px';
      slider.style.cursor = 'pointer';
      
      const valDisplay = document.createElement('span');
      valDisplay.textContent = Number(val).toFixed(2);
      valDisplay.style.width = '40px';
      valDisplay.style.textAlign = 'right';
      
      slider.addEventListener('input', (e) => {
        const numVal = parseFloat(e.target.value);
        valDisplay.textContent = numVal.toFixed(2);
        this.initialOffset[axis] = numVal;
        if (this.pcbWrapper) {
          this.pcbWrapper.position[axis] = numVal;
        }
      });
      
      row.appendChild(label);
      row.appendChild(slider);
      row.appendChild(valDisplay);
      this.offsetPanel.appendChild(row);
    };

    const title = document.createElement('div');
    title.textContent = 'MANUAL ORIGIN OFFSET';
    title.style.color = '#00e5ff';
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '4px';
    title.style.textAlign = 'center';
    this.offsetPanel.appendChild(title);

    createSlider('x', -2, 2, 0);
    createSlider('y', -2, 2, 0);
    createSlider('z', -2, 2, 0);

    const toggleRow = document.createElement('div');
    toggleRow.style.display = 'flex';
    toggleRow.style.alignItems = 'center';
    toggleRow.style.gap = '8px';
    toggleRow.style.marginTop = '4px';
    
    const gyroCheckbox = document.createElement('input');
    gyroCheckbox.type = 'checkbox';
    gyroCheckbox.id = 'gyro-yaw-toggle';
    gyroCheckbox.checked = false; // default disabled due to drift
    gyroCheckbox.style.cursor = 'pointer';
    
    this.integrateGyroYaw = false;
    
    gyroCheckbox.addEventListener('change', (e) => {
        this.integrateGyroYaw = e.target.checked;
        if (!this.integrateGyroYaw) {
            this.currentYaw = 0; // Reset drift
        }
    });
    
    const toggleLabel = document.createElement('label');
    toggleLabel.htmlFor = 'gyro-yaw-toggle';
    toggleLabel.textContent = 'Enable Gyro Yaw (Drift Warning)';
    toggleLabel.style.color = '#ff4444';
    toggleLabel.style.cursor = 'pointer';
    
    toggleRow.appendChild(gyroCheckbox);
    toggleRow.appendChild(toggleLabel);
    this.offsetPanel.appendChild(toggleRow);

    this.container.appendChild(this.offsetPanel);
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

    // Integrate gyro gz for yaw ONLY if enabled
    if (this.integrateGyroYaw) {
      this.currentYaw += gz_dps * (Math.PI / 180) * dt;
    }

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
