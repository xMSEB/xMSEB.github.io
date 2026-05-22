/**
 * scene.js
 * Three.js 3D scene: node spheres + bundled/original edge lines.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const _tmpColor = new THREE.Color();

const THEMES = {
  dark: {
    clearColor: 0x0d0d0d,
    nodeColor:  0xffffff,
    bundled:   { color: new THREE.Color(0x4fc3f7), opacity: 0.55, blending: THREE.AdditiveBlending },
    original:  { color: new THREE.Color(0xff8a65), opacity: 0.45, blending: THREE.AdditiveBlending },
    mseb:      { color: new THREE.Color(0x69f0ae), opacity: 0.55, blending: THREE.AdditiveBlending },
    xmsebCpu:  { color: new THREE.Color(0xce93d8), opacity: 0.55, blending: THREE.AdditiveBlending },
    dirStart: new THREE.Color(0x26c6da),
    dirEnd:   new THREE.Color(0xef5350),
  },
  light: {
    clearColor: 0xffffff,
    nodeColor:  0xaaaaaa,  // soft gray — unobtrusive on white
    bundled:   { color: new THREE.Color(0x1565c0), opacity: 0.5,  blending: THREE.NormalBlending },
    original:  { color: new THREE.Color(0xbf360c), opacity: 0.4,  blending: THREE.NormalBlending },
    mseb:      { color: new THREE.Color(0x2e7d32), opacity: 0.5,  blending: THREE.NormalBlending },
    xmsebCpu:  { color: new THREE.Color(0x7b1fa2), opacity: 0.5,  blending: THREE.NormalBlending },
    dirStart: new THREE.Color(0x00838f),
    dirEnd:   new THREE.Color(0xb71c1c),
  },
};

export class Scene {
  constructor(canvas) {
    this._canvas   = canvas;
    this._viewMode = 'bundled'; // 'bundled' | 'xmseb-cpu' | 'original' | 'mseb'
    this._theme    = 'dark';

    this._nodesMesh     = null;
    this._bundledLines  = null;
    this._originalLines = null;
    this._msebLines     = null;
    this._xmsebCpuLines = null;

    // Stored to allow line rebuild on theme change without re-running WASM
    this._lastNodes    = null;
    this._lastBundled  = null;
    this._lastOriginal = null;
    this._lastMseb     = null;
    this._lastXmsebCpu = null;
    this._lastDirected = false;

    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._initControls();
    this._initResize();
    this._animate();
  }

  // ── Initialisation ──────────────────────────────────────────────────────────

  _initRenderer() {
    this._renderer = new THREE.WebGLRenderer({
      canvas: this._canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setClearColor(THEMES.dark.clearColor, 1);
  }

  _initScene() {
    this._scene = new THREE.Scene();
    // Soft ambient + directional for sphere shading
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(1, 2, 3);
    this._scene.add(dir);
  }

  _initCamera() {
    this._camera = new THREE.PerspectiveCamera(55, 1, 0.1, 50000);
    this._camera.position.set(0, 0, 200);
  }

  _initControls() {
    this._controls = new OrbitControls(this._camera, this._canvas);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.06;
    this._controls.minDistance   = 1;
    this._controls.maxDistance   = 20000;
    this._initKeyboard();
  }

  _initKeyboard() {
    this._keys = new Set();
    this._canvas.tabIndex = 0;
    const down = (e) => {
      if (this._isKeyHandled(e.code)) {
        this._keys.add(e.code);
        e.preventDefault();
      }
    };
    const up = (e) => {
      this._keys.delete(e.code);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    this._lastFrameTime = performance.now();
  }

  _isKeyHandled(code) {
    return code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD' ||
           code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight' ||
           code === 'KeyQ' || code === 'KeyE';
  }

  _updateKeyboardCamera() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this._lastFrameTime) / 1000);
    this._lastFrameTime = now;
    if (!this._keys || this._keys.size === 0) return;

    const cam = this._camera;
    const target = this._controls.target;
    const dist = cam.position.distanceTo(target);
    const speed = dist * 1.2 * dt;

    const forward = new THREE.Vector3();
    cam.getWorldDirection(forward);
    const right = new THREE.Vector3().crossVectors(forward, cam.up).normalize();
    const up = cam.up.clone().normalize();

    const move = new THREE.Vector3();
    if (this._keys.has('KeyW') || this._keys.has('ArrowUp'))    move.add(forward);
    if (this._keys.has('KeyS') || this._keys.has('ArrowDown'))  move.sub(forward);
    if (this._keys.has('KeyD') || this._keys.has('ArrowRight')) move.add(right);
    if (this._keys.has('KeyA') || this._keys.has('ArrowLeft'))  move.sub(right);
    if (this._keys.has('KeyE')) move.add(up);
    if (this._keys.has('KeyQ')) move.sub(up);

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed);
      cam.position.add(move);
      target.add(move);
    }
  }

  _initResize() {
    this._ro = new ResizeObserver(() => this._onResize());
    this._ro.observe(this._canvas.parentElement);
    this._onResize();
  }

  _onResize() {
    const el = this._canvas.parentElement;
    const w  = el.clientWidth;
    const h  = el.clientHeight;
    this._renderer.setSize(w, h, false);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this._updateKeyboardCamera();
    this._controls.update();
    this._renderer.render(this._scene, this._camera);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Load new data into the scene.
   *
   * @param {Array<{x,y,z}>}         nodes
   * @param {Array<{points:Array}>}   bundledEdges  - points are [x,y,z] arrays
   * @param {Array<{points:Array}>}   originalEdges - points are {x,y,z} objects
   */
  setData(nodes, bundledEdges, originalEdges, fitCamera = true, directed = false) {
    this._lastNodes    = nodes;
    this._lastBundled  = bundledEdges;
    this._lastOriginal = originalEdges;
    this._lastMseb     = null;   // invalidated — new dataset/params
    this._lastXmsebCpu = null;   // invalidated — new dataset/params
    this._lastDirected = directed;

    this._clearObjects();

    // Compute centre + scale so the graph always fits in a ±50 unit cube
    const { center, scale } = this._computeTransform(nodes);
    this._xf = (p) => {
      const arr = Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : p;
      return {
        x: (arr.x - center.x) * scale,
        y: (arr.y - center.y) * scale,
        z: (arr.z - center.z) * scale,
      };
    };

    const t = THEMES[this._theme];
    const nodeRadius = Math.max(0.4, 100 / Math.sqrt(nodes.length) * 0.12) / 10;
    this._nodesMesh = this._buildNodes(nodes, this._xf, nodeRadius, t.nodeColor);
    this._scene.add(this._nodesMesh);

    this._bundledLines  = this._buildLines(bundledEdges,  this._xf, t.bundled,  directed);
    this._originalLines = this._buildLines(originalEdges, this._xf, t.original, directed);
    this._scene.add(this._bundledLines);
    this._scene.add(this._originalLines);

    this._applyViewMode();
    if (fitCamera) this._fitCamera();
  }

  /**
   * Set (or replace) the xMSEB CPU edge lines. Called lazily on first view switch.
   * @param {Array<{points:Array}>} edges
   */
  setXmsebCpuLines(edges) {
    this._lastXmsebCpu = edges;

    if (this._xmsebCpuLines) {
      this._scene.remove(this._xmsebCpuLines);
      this._xmsebCpuLines.geometry?.dispose();
      this._xmsebCpuLines.material?.dispose();
      this._xmsebCpuLines = null;
    }

    if (!this._xf) return;

    const t = THEMES[this._theme];
    this._xmsebCpuLines = this._buildLines(edges, this._xf, t.xmsebCpu, this._lastDirected);
    this._scene.add(this._xmsebCpuLines);
    this._applyViewMode();
  }

  /**
   * Set (or replace) the mseb edge lines. Called lazily after mseb runs.
   * @param {Array<{points:Array}>} msebEdges
   */
  setMsebLines(msebEdges) {
    this._lastMseb = msebEdges;

    if (this._msebLines) {
      this._scene.remove(this._msebLines);
      this._msebLines.geometry?.dispose();
      this._msebLines.material?.dispose();
      this._msebLines = null;
    }

    if (!this._xf) return;   // no dataset loaded yet

    const t = THEMES[this._theme];
    this._msebLines = this._buildLines(msebEdges, this._xf, t.mseb, this._lastDirected);
    this._scene.add(this._msebLines);
    this._applyViewMode();
  }

  /** Switch between 'dark' and 'light' themes. */
  setTheme(name) {
    this._theme = name;
    const t = THEMES[name];
    this._renderer.setClearColor(t.clearColor, 1);

    // Rebuild lines with new colors/blending if data is loaded
    if (!this._lastNodes) return;
    this._rebuildLines();
  }

  /**
   * Update line colors from hex strings and rebuild lines.
   * @param {{bundled:string, original:string, mseb:string, dirStart:string, dirEnd:string}} colors
   */
  setColors(colors) {
    console.log('setColors called', colors, 'hasData:', !!this._lastNodes);
    // Update both themes so a theme toggle preserves the custom colors
    for (const themeName of ['dark', 'light']) {
      const t = THEMES[themeName];
      t.bundled.color.set(colors.bundled);
      t.original.color.set(colors.original);
      t.mseb.color.set(colors.mseb);
      t.xmsebCpu.color.set(colors.xmsebCpu);
      t.dirStart.set(colors.dirStart);
      t.dirEnd.set(colors.dirEnd);
    }

    // Rebuild lines with updated theme colors
    if (this._lastNodes) this._rebuildLines();
  }

  /** Switch between 'bundled' and 'original' edge view. */
  setViewMode(mode) {
    this._viewMode = mode;
    this._applyViewMode();
  }

  /** Capture the current view and trigger a PNG download. */
  screenshot() {
    this._renderer.render(this._scene, this._camera);
    const dataURL = this._canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataURL;
    a.download = 'xmseb-screenshot.png';
    a.click();
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  _rebuildLines() {
    const t = THEMES[this._theme];
    const removeLine = (obj) => {
      if (!obj) return;
      this._scene.remove(obj);
      obj.geometry?.dispose();
      obj.material?.dispose();
    };
    removeLine(this._bundledLines);
    removeLine(this._originalLines);
    removeLine(this._msebLines);
    removeLine(this._xmsebCpuLines);

    this._bundledLines  = this._buildLines(this._lastBundled,  this._xf, t.bundled,  this._lastDirected);
    this._originalLines = this._buildLines(this._lastOriginal, this._xf, t.original, this._lastDirected);
    this._scene.add(this._bundledLines);
    this._scene.add(this._originalLines);

    if (this._lastMseb) {
      this._msebLines = this._buildLines(this._lastMseb, this._xf, t.mseb, this._lastDirected);
      this._scene.add(this._msebLines);
    }

    if (this._lastXmsebCpu) {
      this._xmsebCpuLines = this._buildLines(this._lastXmsebCpu, this._xf, t.xmsebCpu, this._lastDirected);
      this._scene.add(this._xmsebCpuLines);
    }

    // Update node color
    if (this._nodesMesh) this._nodesMesh.material.color.set(t.nodeColor);

    this._applyViewMode();
  }

  _clearObjects() {
    for (const obj of [this._nodesMesh, this._bundledLines, this._originalLines, this._msebLines, this._xmsebCpuLines]) {
      if (!obj) continue;
      this._scene.remove(obj);
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material?.dispose();
    }
    this._nodesMesh = this._bundledLines = this._originalLines = this._msebLines = this._xmsebCpuLines = null;
  }

  _computeTransform(nodes) {
    const bbox = new THREE.Box3();
    for (const n of nodes) bbox.expandByPoint(new THREE.Vector3(n.x, n.y, n.z));
    const center = new THREE.Vector3();
    const size   = new THREE.Vector3();
    bbox.getCenter(center);
    bbox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
    return { center, scale: 100 / maxDim };
  }

  _buildNodes(nodes, xf, radius, color = 0xffffff) {
    const geo = new THREE.SphereGeometry(radius, 10, 10);
    const mat = new THREE.MeshPhongMaterial({
      color,
      emissive: 0x2a2a2a,
      shininess: 60,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, nodes.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < nodes.length; i++) {
      const t = xf(nodes[i]);
      dummy.position.set(t.x, t.y, t.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  /**
   * Build a single LineSegments from an array of polylines.
   * Each consecutive pair of points in a polyline becomes a segment,
   * all batched into one draw call.
   */
  // style = { color: THREE.Color, opacity, blending }
  _buildLines(edgePolylines, xf, style, directed = false) {
    const t         = THEMES[this._theme];
    const positions = [];
    const colors    = directed ? [] : null;

    for (const edge of edgePolylines) {
      const pts = edge.points;
      const n   = pts.length;
      for (let i = 0; i < n - 1; i++) {
        const a = xf(pts[i]);
        const b = xf(pts[i + 1]);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        if (directed) {
          // Gradient along the full polyline: dirStart (from) → dirEnd (to)
          _tmpColor.copy(t.dirStart).lerp(t.dirEnd, i / (n - 1));
          colors.push(_tmpColor.r, _tmpColor.g, _tmpColor.b);
          _tmpColor.copy(t.dirStart).lerp(t.dirEnd, (i + 1) / (n - 1));
          colors.push(_tmpColor.r, _tmpColor.g, _tmpColor.b);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (directed) geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.LineBasicMaterial({
      color:        directed ? 0xffffff : style.color,
      vertexColors: directed,
      transparent:  true,
      opacity:      style.opacity,
      blending:     style.blending,
      depthWrite:   false,
    });

    return new THREE.LineSegments(geo, mat);
  }

  _applyViewMode() {
    if (this._bundledLines)   this._bundledLines.visible   = (this._viewMode === 'bundled');
    if (this._originalLines)  this._originalLines.visible  = (this._viewMode === 'original');
    if (this._msebLines)      this._msebLines.visible      = (this._viewMode === 'mseb');
    if (this._xmsebCpuLines)  this._xmsebCpuLines.visible  = (this._viewMode === 'xmseb-cpu');
  }

  _fitCamera() {
    // The data is normalised to ±50 units; position camera to see it all
    const dist = 150;
    this._camera.position.set(0, 0, dist);
    this._camera.near = dist * 0.001;
    this._camera.far  = dist * 100;
    this._camera.updateProjectionMatrix();
    this._controls.target.set(0, 0, 0);
    this._controls.update();
  }
}
