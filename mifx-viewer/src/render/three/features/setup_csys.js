// src/render/three/features/setup_csys.js
// Setup CSYS helper (CAM-like)
// - Attaches AxesHelper to a registered setup root
// - CAM-like: axes are placed at SETUP ORIGIN (root local 0,0,0)
// - Size is derived from setup geometry bbox (if present) for nice scaling
// - If bbox empty, falls back to camera-distance-based length
// - Forces on-top rendering (depthTest=false)

export function installSetupCsys(ctx) {
  const THREE = ctx.THREE;

  const geometryRoots = new Map(); // `${kind}:${id}` -> Object3D root
  const axesByKey = new Map(); // `${kind}:${id}` -> AxesHelper

  function _key(kind, id) {
    return `${String(kind || "").toLowerCase()}:${String(id || "").trim()}`;
  }

  function _disposeAxes(key) {
    const ax = axesByKey.get(key);
    if (!ax) return;

    ax.parent?.remove?.(ax);
    ax.traverse?.((n) => {
      n.geometry?.dispose?.();
      if (n.material) {
        if (Array.isArray(n.material)) n.material.forEach((m) => m?.dispose?.());
        else n.material.dispose?.();
      }
    });

    axesByKey.delete(key);
  }

  function registerGeometryRoot(kind, id, rootOrNull) {
    const k = _key(kind, id);

    if (!rootOrNull) {
      geometryRoots.delete(k);
      _disposeAxes(k);
      return;
    }

    geometryRoots.set(k, rootOrNull);
  }

  function clear() {
    for (const k of Array.from(axesByKey.keys())) _disposeAxes(k);
    axesByKey.clear();
    geometryRoots.clear();
  }

  function _forceOnTop(axes) {
    axes.renderOrder = 9000;
    axes.frustumCulled = false;

    const mats = Array.isArray(axes.material) ? axes.material : [axes.material];
    for (const m of mats) {
      if (!m) continue;
      m.depthTest = false;
      m.depthWrite = false;
      m.transparent = true;
      m.opacity = 0.98;
      m.needsUpdate = true;
    }
  }

  function _computeLenFromBox(box) {
    // Prefer bbox size (world bbox includes setup transform), else fallback to camera distance.
    if (box && !box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      return THREE.MathUtils.clamp(maxDim * 0.25, 20, 500);
    }

    const cam = ctx.camera;
    const controls = ctx.controls;
    const target = controls?.target || new THREE.Vector3(0, 0, 0);
    const d = cam ? cam.position.distanceTo(target) : 500;
    return THREE.MathUtils.clamp(d * 0.08, 30, 600);
  }

  function setVisible(kind, id, visible) {
    const k = _key(kind, id);
    const root = geometryRoots.get(k);

    if (!root) {
      console.warn("[setup_csys] geometry root not found:", k);
      return;
    }

    if (!visible) {
      _disposeAxes(k);
      return;
    }

    // Always rebuild cleanly
    _disposeAxes(k);

    // Compute bbox in WORLD space (for sizing only)
    const box = new THREE.Box3().setFromObject(root);
    const len = _computeLenFromBox(box);

    const axes = new THREE.AxesHelper(len);
    axes.name = `setup_csys_${k}`;
    _forceOnTop(axes);

    // CAM-like: setup CSYS sits at setup origin (root local origin)
    axes.position.set(0, 0, 0);

    root.add(axes);
    axes.updateMatrixWorld(true);

    axesByKey.set(k, axes);
  }

  function rebuild(kind, id) {
    setVisible(kind, id, true);
  }

  return {
    registerGeometryRoot,
    setVisible,
    rebuild,
    clear,
    _debug: { geometryRoots, axesByKey },
  };
}