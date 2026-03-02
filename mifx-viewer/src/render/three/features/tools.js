// src/render/three/features/tools.js
// Feature: playback marker + halo (fallback) + optional tool cylinder
// - Owns its meshes and lifecycle
// - Scene units assumed to be MM

export function installMarker(ctx) {
  const THREE = ctx.THREE;
  const grpHelpers = ctx.groups?.helpers;
  const camera = () => ctx.camera;

  let marker = null;
  let halo = null;

  // tool
  let toolRoot = null;
  let toolMesh = null;
  let toolAxis = new THREE.Vector3(0, 0, 1); // world axis, default +Z
  let toolAxisValid = false;

  function _ensure() {
    if (!grpHelpers) return;
    if (marker && halo) return;

    const markerGeom = new THREE.SphereGeometry(0.6, 24, 16);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
    marker = new THREE.Mesh(markerGeom, markerMat);
    marker.visible = false;
    marker.name = "playback_marker";
    grpHelpers.add(marker);

    const ringGeom = new THREE.RingGeometry(0.9, 1.2, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff3b30,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35,
    });
    halo = new THREE.Mesh(ringGeom, ringMat);
    halo.rotation.x = Math.PI / 2;
    halo.visible = false;
    halo.name = "playback_halo";
    grpHelpers.add(halo);
  }

  function _ensureToolRoot() {
    if (!grpHelpers) return null;
    if (toolRoot) return toolRoot;

    toolRoot = new THREE.Group();
    toolRoot.name = "tool_root";
    toolRoot.visible = false;
    grpHelpers.add(toolRoot);
    return toolRoot;
  }

  function _disposeMesh(m) {
    if (!m) return;
    try {
      m.geometry?.dispose?.();
      if (Array.isArray(m.material)) m.material.forEach((x) => x?.dispose?.());
      else m.material?.dispose?.();
    } catch {}
  }

  function clear() {
    if (grpHelpers) {
      if (marker) grpHelpers.remove(marker);
      if (halo) grpHelpers.remove(halo);
      if (toolRoot) grpHelpers.remove(toolRoot);
    }
    marker = null;
    halo = null;

    if (toolMesh) _disposeMesh(toolMesh);
    toolMesh = null;
    toolRoot = null;

    toolAxis.set(0, 0, 1);
    toolAxisValid = false;
  }

  function hide() {
    if (marker) marker.visible = false;
    if (halo) halo.visible = false;
    if (toolRoot) toolRoot.visible = false;
  }

  // -----------------------
  // Tool API (minimal)
  // -----------------------
  function clearTool() {
    if (toolRoot && toolMesh) {
      toolRoot.remove(toolMesh);
      _disposeMesh(toolMesh);
    }
    toolMesh = null;
    if (toolRoot) toolRoot.visible = false;

    toolAxisValid = false;
    toolAxis.set(0, 0, 1);
  }

  function _toolMat() {
    return new THREE.MeshStandardMaterial({
      color: 0xffe600,   // intense yellow
      metalness: 0.5,
      roughness: 0.15,
    });
  }

  function setToolCylinder({ diaMM = 30, lenMM = 60 } = {}) {
    const root = _ensureToolRoot();
    if (!root) return;

    clearTool();

    const dia = Math.max(1e-6, Number(diaMM) || 30);
    const len = Math.max(1e-6, Number(lenMM) || 60);
    const r = dia / 2;

    const geom = new THREE.CylinderGeometry(r, r, len, 24, 1, false);
    geom.rotateX(Math.PI / 2); // axis => +Z

    const m = new THREE.Mesh(geom, _toolMat());
    m.name = "tool_cylinder";
    m.position.set(0, 0, len / 2); // tip at origin
    root.add(m);

    toolMesh = m;
    root.visible = true;
  }

  // -------- payload -> cylinder --------

  function _toMM(value, unit, unitsLinearFallback = "mm") {
    const v = Number(value);
    if (!Number.isFinite(v)) return null;

    const u = String(unit || unitsLinearFallback || "mm").toLowerCase();
    if (u === "in" || u === "inch" || u === "inches") return v * 25.4;
    return v; // mm default
  }

  function setToolFromPayload(tool, { unitsLinear = "mm" } = {}) {
    if (!tool || typeof tool !== "object") {
      clearTool();
      return;
    }

    // Your tool json:
    // diameter: {value, unit}, length: {value, unit}
    const diaMM =
      _toMM(tool?.diameter?.value, tool?.diameter?.unit, unitsLinear) ??
      _toMM(tool?.toolDiameter?.value, tool?.toolDiameter?.unit, unitsLinear) ??
      _toMM(tool?.dia?.value, tool?.dia?.unit, unitsLinear) ??
      null;

    if (!Number.isFinite(diaMM) || diaMM <= 0) {
      clearTool();
      return;
    }

    const lenMM =
      _toMM(tool?.length?.value, tool?.length?.unit, unitsLinear) ??
      _toMM(tool?.fluteLength?.value, tool?.fluteLength?.unit, unitsLinear) ??
      _toMM(tool?.overallLength?.value, tool?.overallLength?.unit, unitsLinear) ??
      null;

    setToolCylinder({
      diaMM,
      lenMM: Number.isFinite(lenMM) && lenMM > 0 ? lenMM : diaMM * 4,
    });
  }

  // -------- axis --------

  function setToolAxis({ i, j, k } = {}) {
    const x = Number(i), y = Number(j), z = Number(k);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;

    const v = new THREE.Vector3(x, y, z);
    const n = v.length();
    if (!Number.isFinite(n) || n < 1e-9) return;

    v.multiplyScalar(1 / n);
    toolAxis.copy(v);
    toolAxisValid = true;
  }

  function clearToolAxis() {
    toolAxis.set(0, 0, 1);
    toolAxisValid = false;
  }

  function _applyToolOrientationIfAny() {
    if (!toolRoot || !toolMesh || !toolRoot.visible) return;

    const z = new THREE.Vector3(0, 0, 1);
    const dir = toolAxisValid ? toolAxis : z;

    const q = new THREE.Quaternion().setFromUnitVectors(z, dir);
    toolRoot.quaternion.copy(q);
    toolRoot.updateMatrixWorld(true);
  }

  /**
   * Set marker position in *scene units* (MM).
   * @param {THREE.Vector3} pos
   * @param {{cameraFacing?: boolean, autoScale?: boolean}} opts
   */
  function setPosition(pos, opts = {}) {
    _ensure();
    if ((!marker || !halo) && !toolRoot) return;
    if (!pos) return;

    if (toolRoot) {
      toolRoot.position.copy(pos);
      _applyToolOrientationIfAny();
    }

    const toolActive = !!(toolRoot && toolRoot.visible && toolMesh);
    if (marker) marker.visible = !toolActive;
    if (halo) halo.visible = !toolActive;

    if (!toolActive && marker && halo) {
      marker.position.copy(pos);
      halo.position.copy(pos);

      const cam = camera();
      if (cam) {
        if (opts.cameraFacing !== false) halo.lookAt(cam.position);

        if (opts.autoScale !== false) {
          const d = cam.position.distanceTo(pos);
          const sc = Math.max(1.5, d * 0.02);
          marker.scale.setScalar(sc);
          halo.scale.setScalar(sc);
        }
      }
    }
  }

  return {
    _ensure,
    clear,
    hide,
    setPosition,

    // tool api
    setToolCylinder,
    setToolFromPayload,
    clearTool,
    setToolAxis,
    clearToolAxis,

    _debug: {
      get marker() { return marker; },
      get halo() { return halo; },
      get toolRoot() { return toolRoot; },
    },
  };
}