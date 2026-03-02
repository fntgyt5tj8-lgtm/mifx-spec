// src/render/three/features/world_csys.js
export function installWcs(ctx) {
  const THREE = ctx.THREE;
  const grpHelpers = ctx.groups?.helpers;

  let wcsAxes = null;
  let wcsGrid = null;

  let builtOnce = false;
  let baseAxesLen = 120;
  let baseGridSize = 400;
  let gridStep = null;

  // ✅ SINGLE SOURCE OF TRUTH for visibility (engine-side)
  // Renderer calls applyVisibility() and we never read UI state directly.
  let _vis = {
    axesOn: true,
    gridOn: false,
  };

  function _wcsMakeFadeFriendly(obj) {
    if (!obj) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m) continue;
      m.transparent = true;
      m.depthWrite = false;
      m.needsUpdate = true;
    }
  }

  function _wcsSetOpacity(obj, opacity) {
    if (!obj) return;
    const o = THREE.MathUtils.clamp(opacity, 0, 1);
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m) continue;
      m.transparent = true;
      m.opacity = o;
      m.depthWrite = false;
      m.needsUpdate = true;
    }
  }

  function _niceStep(x) {
    if (!Number.isFinite(x) || x <= 0) return 10;
    const pow10 = Math.pow(10, Math.floor(Math.log10(x)));
    const n = x / pow10;
    let base = 1;
    if (n >= 5) base = 5;
    else if (n >= 2) base = 2;
    return base * pow10;
  }

  function _applyVisibilityNow() {
    if (wcsAxes) wcsAxes.visible = !!_vis.axesOn;
    if (wcsGrid) wcsGrid.visible = !!_vis.gridOn;
  }

  // ✅ PUBLIC: renderer calls this on toggle
  function applyVisibility({ axesOn, gridOn } = {}) {
    if (typeof axesOn === "boolean") _vis.axesOn = axesOn;
    if (typeof gridOn === "boolean") _vis.gridOn = gridOn;
    _applyVisibilityNow();
  }

  function rebuild({ axesLen = 120, gridSize = 400, step = null } = {}) {
    if (!grpHelpers) return;

    baseAxesLen = axesLen;
    baseGridSize = gridSize;

    // remove old
    if (wcsAxes) grpHelpers.remove(wcsAxes);
    if (wcsGrid) grpHelpers.remove(wcsGrid);
    wcsAxes = null;
    wcsGrid = null;

    let divisions = 20;
    if (step && Number.isFinite(step) && step > 0) {
      divisions = Math.max(2, Math.round(gridSize / step));
    } else {
      divisions = Math.max(10, Math.round(gridSize / 20));
    }

    // GridHelper is XZ-plane by default. Rotate to XY plane for Z-up CAM look.
    const grid = new THREE.GridHelper(gridSize, divisions, 0x335a9a, 0x1f2f4d);
    grid.rotation.x = Math.PI / 2; // XY plane (Z-up)
    grid.position.set(0, 0, 0);
    grid.name = "wcs_grid";
    grpHelpers.add(grid);
    wcsGrid = grid;

    const axes = new THREE.AxesHelper(axesLen);
    axes.name = "wcs_axes";
    grpHelpers.add(axes);
    wcsAxes = axes;

    // nicer CAD look
    if (Array.isArray(axes.material)) {
      for (const m of axes.material) {
        if (!m) continue;
        m.linewidth = 2.0;
        m.transparent = true;
        m.opacity = 0.9;
        m.depthWrite = false;
        m.needsUpdate = true;
      }
    }

    _wcsMakeFadeFriendly(wcsGrid);

    builtOnce = true;

    // ✅ re-apply the current effective visibility (NOT UI state)
    _applyVisibilityNow();
  }

  function _getViewDistance() {
    const camera = ctx.camera;
    const controls = ctx.controls;
    if (!camera || !controls) return 500;
    return camera.position.distanceTo(controls.target);
  }

  function autoScaleFromScene() {
    const scene = ctx.scene;
    if (!scene) return;

    const box = new THREE.Box3().setFromObject(scene);
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    const axesLen = THREE.MathUtils.clamp(maxDim * 0.05, 20, 90);
    const gridSize = THREE.MathUtils.clamp(maxDim * 0.4, 100, 800);

    gridStep = null;
    rebuild({ axesLen, gridSize });
  }

  function updateFromZoom() {
    if (!builtOnce) return;
    if (!ctx.controls || !ctx.camera) return;

    // ✅ use internal visibility (do not read UI state)
    _applyVisibilityNow();
    if (!_vis.axesOn && !_vis.gridOn) return;

    const d = _getViewDistance();

    // axes scale
    if (wcsAxes && _vis.axesOn) {
      const desiredAxesLen = d * 0.08;
      const axesLen = THREE.MathUtils.clamp(desiredAxesLen, 8, 200);

      const base = baseAxesLen || 120;
      const k = axesLen / base;
      wcsAxes.scale.setScalar(k);
    }

    // grid fade + step rebuild
    if (wcsGrid && _vis.gridOn) {
      const fadeStart = 200;
      const fadeEnd = 1400;
      const t = THREE.MathUtils.clamp((d - fadeStart) / (fadeEnd - fadeStart), 0, 1);
      const gridOpacity = THREE.MathUtils.lerp(0.75, 0.08, t);
      _wcsSetOpacity(wcsGrid, gridOpacity);

      const step = _niceStep(d * 0.05);
      if (gridStep !== step) {
        gridStep = step;
        rebuild({ axesLen: baseAxesLen || 120, gridSize: baseGridSize || 400, step });
      }
    }
  }

  function clear() {
    if (!grpHelpers) return;
    if (wcsAxes) grpHelpers.remove(wcsAxes);
    if (wcsGrid) grpHelpers.remove(wcsGrid);
    wcsAxes = null;
    wcsGrid = null;
    builtOnce = false;
    gridStep = null;
  }

  function isBuilt() {
    return !!builtOnce && !!wcsAxes; // grid may be intentionally hidden
  }

  return {
    rebuild,
    autoScaleFromScene,
    updateFromZoom,
    clear,
    applyVisibility,
    isBuilt,
    // optional debug
    _debug: { get vis() { return { ..._vis }; } },
  };
}