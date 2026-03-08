// src/render/three/three_renderer.js
import * as THREE from "/vendor/three/three.module.js";
import { OrbitControls } from "/vendor/three/addons/controls/OrbitControls.js";
import { Line2 } from "/vendor/three/addons/lines/Line2.js";
import { LineMaterial } from "/vendor/three/addons/lines/LineMaterial.js";
import { LineGeometry } from "/vendor/three/addons/lines/LineGeometry.js";

import { loadToolpathsForOps } from "/src/core/mifx/load_toolpaths.js";
import { Renderer } from "/src/render/renderer.js";

// units (scene canonical = MM)
import { applyTransformRowsToObjectMM } from "/src/render/three/util/units.js";

// HUD is now a viewer feature
import {
  hudMount,
  hudClear,
  hudRegisterTimeline,
  hudDestroy,
} from "/src/render/three/features/hud.js";

// Features
import { installWcs } from "/src/render/three/features/world_csys.js";
import { installMarker } from "/src/render/three/features/tools.js"; // ✅ renamed marker -> tools
import { installToolpaths } from "/src/render/three/features/toolpath.js";
import { installOpCsys } from "/src/render/three/features/op_csys.js";
import { installSetupCsys } from "/src/render/three/features/setup_csys.js";
import { installGeometry } from "/src/render/three/features/geometry.js";
import { installViews } from "/src/render/three/features/views.js";
import { installPicker } from "/src/render/three/features/picker.js";

// utils
import { clearGroup } from "/src/render/three/util/dispose.js";

// ------------------------------------------------------------
// Debug helper (sentinel axes)
// ------------------------------------------------------------
function _makeOnTopAxes(len = 200) {
  const axes = new THREE.AxesHelper(len);
  axes.renderOrder = 9999;
  axes.frustumCulled = false;

  if (Array.isArray(axes.material)) {
    for (const m of axes.material) {
      if (!m) continue;
      m.depthTest = false;
      m.depthWrite = false;
      m.transparent = true;
      m.opacity = 1.0;
      m.needsUpdate = true;
    }
  }
  return axes;
}

// ------------------------------------------------------------
// Minimal HUD timeline builder
// ------------------------------------------------------------
function buildHudTimelineFromParsed({ timeline, motionPoints } = {}) {
  if (Array.isArray(timeline) && timeline.length) {
    return timeline.map((r) => ({
      apt: r?.apt || null,
      n: Number.isFinite(r?.n) ? r.n : null,
      kind: r?.kind || "record",
      pointIndex: Number.isFinite(r?.pointIndex) ? r.pointIndex : null,
    }));
  }

  const pts = Array.isArray(motionPoints) ? motionPoints : [];
  return pts.map((p, idx) => ({
    apt: p?.apt ?? p?.hud?.apt ?? null,
    n: Number.isFinite(p?.n) ? p.n : null,
    kind: "motion",
    pointIndex: idx,
  }));
}

// ------------------------------------------------------------
// Operation -> toolId (keep dumb + robust)
// ------------------------------------------------------------
function _pickToolIdFromOp(op) {
  if (!op) return null;

  // common patterns
  if (op.toolId != null) return op.toolId;
  if (op.toolRef != null) return op.toolRef;

  // nested
  if (op.tool?.id != null) return op.tool.id;
  if (op.tool?.toolId != null) return op.tool.toolId;
  if (op.tool?.ref != null) return op.tool.ref;

  // snake_case
  if (op.tool_id != null) return op.tool_id;

  return null;
}

// ------------------------------------------------------------
// Renderer
// ------------------------------------------------------------
export class ThreeRenderer extends Renderer {
  constructor(host, opts = {}) {
    super(host, opts);

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;

    this.grpSetup = new THREE.Group();
    this.grpToolpaths = new THREE.Group();
    this.grpHelpers = new THREE.Group();

    this._raf = null;
    this._running = false;

    // features
    this.wcs = null;
    this.views = null;
    this.geometry = null;
    this.picker = null;
    this.marker = null; // tools.js instance
    this.toolpaths = null;
    this.opCsys = null;
    this.setupCsys = null;

    // state
    this._activeSetupId = null;
    this._showSetupCsys = true;

    // debug sentinel axes
    this.__debugAxes = null;

    // lookups
    this._opById = new Map();   // opId -> op payload
    this._toolById = new Map(); // toolId -> tool payload
  }

  // ------------------------------------------------------------
  // Tools map plumbing (call from app after loadTools(source))
  // ------------------------------------------------------------
  setTools(tools = []) {
    this._toolById = new Map();

    const arr = Array.isArray(tools) ? tools : [];
    for (const t of arr) {
      if (!t || typeof t !== "object") continue;

      // Prefer explicit id if you set it in load_tools.js (tool.id = key)
      const id = t.id ?? t.toolId ?? t.uuid ?? t.key ?? null;
      if (id == null) continue;

      this._toolById.set(String(id), t);
    }

    // optional: useful debug
    // console.log("[renderer] setTools:", arr.length, "-> map size", this._toolById.size);
  }

  async init() {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 1e9);

    // Z-up CAM convention
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(8, 6, 8);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);

    // do not wipe viewer overlay owned by viewer.js
    const oldCanvas = this.host.querySelector("canvas");
    if (oldCanvas && oldCanvas !== this.renderer.domElement) {
      oldCanvas.remove();
    }
    this.host.appendChild(this.renderer.domElement);

    // HUD
    hudClear();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.screenSpacePanning = true;
    this.controls.rotateSpeed = 0.8;
    this.controls.zoomSpeed = 1.2;
    this.controls.panSpeed = 0.8;
    this.controls.minDistance = 0.01;
    this.controls.maxDistance = 1e7;
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1.5);
    this.scene.add(hemi);

    this.scene.add(this.grpSetup);
    this.scene.add(this.grpToolpaths);
    this.scene.add(this.grpHelpers);

    // sentinel
    this.__debugAxes = _makeOnTopAxes(200);
    this.__debugAxes.name = "__debug_axes_sentinel";
    this.grpHelpers.add(this.__debugAxes);

    // Install features
    const ctx = {
      THREE,
      host: this.host,
      scene: this.scene,
      camera: this.camera,
      controls: this.controls,
      renderer: this.renderer,
      groups: {
        setup: this.grpSetup,
        toolpaths: this.grpToolpaths,
        helpers: this.grpHelpers,
      },

      // fatline deps
      Line2,
      LineMaterial,
      LineGeometry,

      // toolpath parsing + HUD timeline
      loadToolpathsForOps,
      buildHudTimelineFromParsed,
      hud: { hudClear, hudRegisterTimeline },

      // WCS visibility state from base Renderer
      getWcsVisibility: () => this.getWcsVisibility(),
      getWcsBaseAxesLen: () => 120,
    };

    this.wcs = installWcs(ctx);

    this.views = installViews(ctx);
    ctx.views = this.views;

    this.geometry = installGeometry(ctx);
    ctx.geometry = this.geometry;

    this.picker = installPicker(ctx);
    ctx.picker = this.picker;

    // tools.js (marker + halo + cylinder)
    this.marker = installMarker(ctx);
    ctx.marker = this.marker;

    // toolpaths drives marker pose + axis (inside toolpath.js)
    this.toolpaths = installToolpaths(ctx);

    this.opCsys = installOpCsys(ctx);
    this.setupCsys = installSetupCsys(ctx);

    this.wcs?.rebuild?.({ axesLen: 120, gridSize: 400 });
    this.setWcsVisibility(this.getWcsVisibility());

    // Optional global hooks
    window.viewerSetView = (name) => this.setView?.(name);
    window.viewerResetView = () => this.resetView?.();
    window.viewerUnhideAll = () => this.unhideAll?.();

    this._running = true;
    const tick = () => {
      if (!this._running) return;
      this.wcs?.updateFromZoom?.();
      this.controls?.update();
      this.renderer.render(this.scene, this.camera);
      this._raf = requestAnimationFrame(tick);
    };
    tick();
  }

  resize(w, h) {
    if (!this.renderer || !this.camera) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.toolpaths?.resize?.(w, h);
  }

  clear() {
    clearGroup(this.grpSetup);
    clearGroup(this.grpToolpaths);
    clearGroup(this.grpHelpers);

    this.toolpaths?.clear?.();
    this.marker?.clear?.();
    this.geometry?.clear?.();
    this.picker?.clear?.();
    this.opCsys?.clear?.();
    this.setupCsys?.clear?.();
    this._activeSetupId = null;

    this._opById = new Map();

    // re-add sentinel
    this.__debugAxes = _makeOnTopAxes(200);
    this.__debugAxes.name = "__debug_axes_sentinel";
    this.grpHelpers.add(this.__debugAxes);

    // rebuild WCS after helpers reset
    this.wcs?.clear?.();
    this.wcs?.rebuild?.({ axesLen: 120, gridSize: 400 });
    this.setWcsVisibility(this.getWcsVisibility());

    hudClear();
  }

  async dispose() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);

    this.clear();

    this.controls?.dispose?.();
    this.controls = null;

    hudDestroy?.();

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement?.parentNode?.removeChild(this.renderer.domElement);
    }

    this.scene = null;
    this.camera = null;
    this.renderer = null;

    this.wcs = null;
    this.views = null;
    this.geometry = null;
    this.picker = null;
    this.marker = null;
    this.toolpaths = null;
    this.opCsys = null;
    this.setupCsys = null;

    this.__debugAxes = null;
  }

  // ------------------------------------------------------------
  // WCS visibility (called by UI)
  // ------------------------------------------------------------
  setWcsVisibility({ showWcs, showAxes, showGrid } = {}) {
    super.setWcsVisibility({ showWcs, showAxes, showGrid });

    const vis = this.getWcsVisibility();
    const master = vis.showWcs !== false;
    const axesOn = master && vis.showAxes !== false;
    const gridOn = master && vis.showGrid === true;

    if (this.__debugAxes) this.__debugAxes.visible = master;

    this.wcs?.applyVisibility?.({ axesOn, gridOn });
    this.wcs?.updateFromZoom?.();
  }

  // ------------------------------------------------------------
  // Views API
  // ------------------------------------------------------------
  setView(name) {
    this.views?.setView?.(name);
  }
  resetView() {
    this.views?.resetView?.();
  }
  frameAll() {
    this.views?.frameAll?.();
  }

  // ------------------------------------------------------------
  // Picker API
  // ------------------------------------------------------------
  unhideAll() {
    this.picker?.unhideAll?.();
  }

  // ------------------------------------------------------------
  // Setup CSYS visibility
  // ------------------------------------------------------------
  setSetupCsysVisible(visible) {
    this._showSetupCsys = !!visible;
    if (!this._activeSetupId) return;
    this.setupCsys?.setVisible?.("setup", this._activeSetupId, this._showSetupCsys);
  }

  // ------------------------------------------------------------
  // Setup geometry
  // ------------------------------------------------------------
  async loadSetupGeometry(setup, source) {
    clearGroup(this.grpSetup);

    const ar = setup?.artifactRef;
    if (!ar?.path || ar.present === false) return;

    const setupId = setup?.id || `set-${setup?.index ?? "?"}`;

    this.setupCsys?.registerGeometryRoot?.("setup", setupId, this.grpSetup);

    if (this._activeSetupId && this._activeSetupId !== setupId) {
      this.setupCsys?.setVisible?.("setup", this._activeSetupId, false);
    }
    this._activeSetupId = setupId;

    applyTransformRowsToObjectMM(THREE, this.grpSetup, setup?.transform);

    await this.geometry?.loadIntoGroup?.({
      artifactRef: ar,
      source,
      group: this.grpSetup,
      kind: "setup",
      id: setupId,
      unitsHint: setup?.transform?.unit,
    });

    this.picker?.setRoot?.(this.grpSetup);

    if (this._showSetupCsys) {
      this.setupCsys?.setVisible?.("setup", setupId, true);
    }

    this.wcs?.autoScaleFromScene?.();
    this.frameAll();
  }

  // ------------------------------------------------------------
  // Toolpaths (+ cache ops for tool lookup)
  // ------------------------------------------------------------
  async loadToolpaths(ops, source) {
    this._opById.clear();
    for (const op of ops || []) {
      if (op?.id != null) this._opById.set(String(op.id), op);
    }

    this.opCsys?.registerOperations?.(ops);
    await this.toolpaths?.load?.(ops, source);

    this.wcs?.autoScaleFromScene?.();
    this.frameAll();

    this.opCsys?.reset?.();
    this.opCsys?.registerOperations?.(ops);
  }

  getPlaybackStepCount(opId) {
    return this.toolpaths?.getPlaybackStepCount?.(opId) || 0;
  }

  getPlaybackPose() {
    return this.toolpaths?.getPlaybackPose?.() || null;
  }

  setPlayback({ t, playing, opId, stepIndex } = {}) {
    this.toolpaths?.setPlayback?.({ t, playing, opId, stepIndex });
  }

  // ------------------------------------------------------------
  // Selection drives: toolpaths + tool cylinder (payload)
  // ------------------------------------------------------------
  setActiveOperation(opId) {
    const id = opId ?? null;

    this.toolpaths?.setActiveOperation?.(id);
    this.opCsys?.setActive?.(id);

    if (!id) {
      this.marker?.clearTool?.();
      this.marker?.hide?.();
      return;
    }

    const op = this._opById.get(String(id)) || null;
    const toolId = _pickToolIdFromOp(op);

    if (!toolId) {
      // no tool reference => fallback marker/halo only
      this.marker?.clearTool?.();
      this.setPlayback({ opId: id, playing: false, stepIndex: 0 });
      return;
    }

    const tool = this._toolById.get(String(toolId)) || null;
    if (!tool) {
      // tool map not loaded OR id mismatch => fallback
      this.marker?.clearTool?.();
      this.setPlayback({ opId: id, playing: false, stepIndex: 0 });
      return;
    }

    // ✅ build cylinder from payload (tools.js must implement setToolFromPayload)
    this.marker?.setToolFromPayload?.(tool, { unitsLinear: "mm" });

    // show first step (moves tool + applies axis if toolpath provides it)
    this.setPlayback({ opId: id, playing: false, stepIndex: 0 });
  }
}