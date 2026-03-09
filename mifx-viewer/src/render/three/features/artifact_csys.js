// src/render/three/features/artifact_csys.js
export function installArtifactCsys(ctx) {
  const THREE = ctx.THREE;

  const roots = new Map();      // `${setupId}:${role}` -> Object3D
  const axesByKey = new Map();  // `${setupId}:${role}` -> AxesHelper

  function _key(setupId, role) {
    return `${String(setupId || "").trim()}:${String(role || "").trim().toLowerCase()}`;
  }

  function _dispose(k) {
    const ax = axesByKey.get(k);
    if (!ax) return;

    ax.parent?.remove?.(ax);
    ax.traverse?.((n) => {
      n.geometry?.dispose?.();
      if (n.material) {
        if (Array.isArray(n.material)) n.material.forEach((m) => m?.dispose?.());
        else n.material.dispose?.();
      }
    });

    axesByKey.delete(k);
  }

  function registerArtifactRoot(setupId, role, rootOrNull) {
    const k = _key(setupId, role);

    if (!rootOrNull) {
      roots.delete(k);
      _dispose(k);
      return;
    }

    roots.set(k, rootOrNull);
  }

  function clear() {
    for (const k of Array.from(axesByKey.keys())) _dispose(k);
    axesByKey.clear();
    roots.clear();
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

  function _computeLen(root) {
    const box = new THREE.Box3().setFromObject(root);

    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      return THREE.MathUtils.clamp(maxDim * 0.25, 10, 300);
    }

    const cam = ctx.camera;
    const controls = ctx.controls;
    const target = controls?.target || new THREE.Vector3(0, 0, 0);
    const d = cam ? cam.position.distanceTo(target) : 500;
    return THREE.MathUtils.clamp(d * 0.05, 20, 300);
  }

  function setVisible(setupId, role, visible) {
    const k = _key(setupId, role);
    const root = roots.get(k);

    if (!root) {
      console.warn("[artifact_csys] artifact root not found:", k);
      return;
    }

    if (!visible) {
      _dispose(k);
      return;
    }

    _dispose(k);

    const len = _computeLen(root);
    const axes = new THREE.AxesHelper(len);
    axes.name = `artifact_csys_${k}`;
    axes.position.set(0, 0, 0);

    _forceOnTop(axes);

    root.add(axes);
    axes.updateMatrixWorld(true);
    axesByKey.set(k, axes);
  }

  function rebuild(setupId, role) {
    setVisible(setupId, role, true);
  }

  return {
    registerArtifactRoot,
    setVisible,
    rebuild,
    clear,
    _debug: { roots, axesByKey },
  };
}