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
  hudClear,
  hudRegisterTimeline,
  hudDestroy,
} from "/src/render/three/features/hud.js";

// Features
import { installWcs } from "/src/render/three/features/world_csys.js";
import { installMarker } from "/src/render/three/features/tools.js";
import { installToolpaths } from "/src/render/three/features/toolpath.js";
import { installOpCsys } from "/src/render/three/features/op_csys.js";
import { installArtifactCsys } from "/src/render/three/features/artifact_csys.js";
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

  if (op.toolId != null) return op.toolId;
  if (op.toolRef != null) return op.toolRef;

  if (op.tool?.id != null) return op.tool.id;
  if (op.tool?.toolId != null) return op.tool.toolId;
  if (op.tool?.ref != null) return op.tool.ref;

  if (op.tool_id != null) return op.tool_id;

  return null;
}

function _artifactRootKey(setupId, role) {
  return `${String(setupId || "")}:${String(role || "").trim().toLowerCase()}`;
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
    this.marker = null;
    this.toolpaths = null;
    this.opCsys = null;
    this.artifactCsys = null;

    // state
    this._activeSetupId = null;

    // debug sentinel axes
    this.__debugAxes = null;

    // lookups
    this._opById = new Map();
    this._toolById = new Map();

    // setup artifact roots for model tree visibility
    this._setupArtifactRootByKey = new Map();
  }

  // ------------------------------------------------------------
  // Tools map plumbing
  // ------------------------------------------------------------
  setTools(tools = []) {
    this._toolById = new Map();

    const arr = Array.isArray(tools) ? tools : [];
    for (const t of arr) {
      if (!t || typeof t !== "object") continue;

      const id = t.id ?? t.toolId ?? t.uuid ?? t.key ?? null;
      if (id == null) continue;

      this._toolById.set(String(id), t);
    }
  }

  async init() {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 1e9);

    this.camera.up.set(0, 0, 1);
    this.camera.position.set(8, 6, 8);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);

    const oldCanvas = this.host.querySelector("canvas");
    if (oldCanvas && oldCanvas !== this.renderer.domElement) {
      oldCanvas.remove();
    }
    this.host.appendChild(this.renderer.domElement);

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

    this.__debugAxes = _makeOnTopAxes(200);
    this.__debugAxes.name = "__debug_axes_sentinel";
    this.grpHelpers.add(this.__debugAxes);

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

      Line2,
      LineMaterial,
      LineGeometry,

      loadToolpathsForOps,
      buildHudTimelineFromParsed,
      hud: { hudClear, hudRegisterTimeline },

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

    this.marker = installMarker(ctx);
    ctx.marker = this.marker;

    this.toolpaths = installToolpaths(ctx);

    this.opCsys = installOpCsys(ctx);
    this.artifactCsys = installArtifactCsys(ctx);

    this.wcs?.rebuild?.({ axesLen: 120, gridSize: 400 });
    this.setWcsVisibility(this.getWcsVisibility());

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
    this.artifactCsys?.clear?.();
    this._activeSetupId = null;

    this._opById = new Map();
    this._setupArtifactRootByKey = new Map();

    this.__debugAxes = _makeOnTopAxes(200);
    this.__debugAxes.name = "__debug_axes_sentinel";
    this.grpHelpers.add(this.__debugAxes);

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
    this.artifactCsys = null;

    this.__debugAxes = null;
  }

  // ------------------------------------------------------------
  // WCS visibility
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
  // Visibility API (model tree)
  // ------------------------------------------------------------
  setSetupArtifactVisible(setupId, role, visible) {
    const root = this._setupArtifactRootByKey.get(_artifactRootKey(setupId, role));
    if (!root) return;
    root.visible = !!visible;
  }

  setArtifactCsysVisible(setupId, role, visible) {
    this.artifactCsys?.setVisible?.(setupId, role, visible);
  }

  setOperationToolpathVisible(opId, visible) {
    this.toolpaths?.setOperationVisible?.(opId, visible);
  }

  setOperationCsysVisible(opId, visible) {
    this.opCsys?.setVisible?.(opId, visible);
  }

  // ------------------------------------------------------------
  // Setup helpers
  // ------------------------------------------------------------
  _getSetupArtifacts(setup) {
    const arts = Array.isArray(setup?.artifacts) ? setup.artifacts : [];

    return arts.filter(
      (a) =>
        a &&
        typeof a === "object" &&
        a.path &&
        a.present !== false &&
        (
          a.role === "setup_geometry" ||
          a.role === "part" ||
          a.role === "stock" ||
          a.role === "fixture"
        )
    );
  }

  _makeArtifactRoot(setupId, art) {
    const role = String(art?.role || "artifact").trim().toLowerCase();
    const root = new THREE.Group();
    root.name = `artifact:${setupId}:${role}`;

    applyTransformRowsToObjectMM(THREE, root, art?.transform);

    return root;
  }

  // ------------------------------------------------------------
  // Setup geometry
  // ------------------------------------------------------------
  async loadSetupGeometry(setup, source) {
    clearGroup(this.grpSetup);
    this._setupArtifactRootByKey = new Map();

    const setupId = setup?.id || `set-${setup?.index ?? "?"}`;
    const artifacts = this._getSetupArtifacts(setup);
    if (!artifacts.length) return;

    this._activeSetupId = setupId;

    // each artifact transform is absolute in WCS, so they are siblings
    for (const art of artifacts) {
      const role = String(art?.role || "").trim().toLowerCase();
      const artifactRoot = this._makeArtifactRoot(setupId, art);

      this.grpSetup.add(artifactRoot);
      this._setupArtifactRootByKey.set(_artifactRootKey(setupId, role), artifactRoot);

      this.artifactCsys?.registerArtifactRoot?.(setupId, role, artifactRoot);

      await this.geometry?.loadIntoGroup?.({
        artifactRef: art,
        source,
        group: artifactRoot,
        kind: "setup_artifact",
        id: `${setupId}:${role}`,
        unitsHint: art?.transform?.unit || null,
      });
    }

    this.picker?.setRoot?.(this.grpSetup);

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
  // Selection drives: toolpaths + tool cylinder
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
      this.marker?.clearTool?.();
      this.setPlayback({ opId: id, playing: false, stepIndex: 0 });
      return;
    }

    const tool = this._toolById.get(String(toolId)) || null;
    if (!tool) {
      this.marker?.clearTool?.();
      this.setPlayback({ opId: id, playing: false, stepIndex: 0 });
      return;
    }

    this.marker?.setToolFromPayload?.(tool, { unitsLinear: "mm" });
    this.setPlayback({ opId: id, playing: false, stepIndex: 0 });
  }
}