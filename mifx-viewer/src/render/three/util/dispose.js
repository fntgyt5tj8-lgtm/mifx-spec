// src/render/three/util/dispose.js
// Small utilities for deterministic cleanup of Three.js objects.
// Keep it boring and re-usable (like units.js).

function _disposeMaterial(mat) {
  if (!mat) return;

  // Optional: dispose common texture slots (safe no-op if absent)
  const texSlots = [
    "map",
    "alphaMap",
    "aoMap",
    "bumpMap",
    "normalMap",
    "displacementMap",
    "emissiveMap",
    "envMap",
    "lightMap",
    "metalnessMap",
    "roughnessMap",
    "specularMap",
  ];
  for (const k of texSlots) {
    const t = mat[k];
    if (t && typeof t.dispose === "function") t.dispose();
  }

  if (typeof mat.dispose === "function") mat.dispose();
}

export function disposeObject3D(obj) {
  if (!obj) return;

  // Dispose this node
  if (obj.geometry && typeof obj.geometry.dispose === "function") {
    obj.geometry.dispose();
  }

  if (obj.material) {
    if (Array.isArray(obj.material)) {
      for (const m of obj.material) _disposeMaterial(m);
    } else {
      _disposeMaterial(obj.material);
    }
  }

  // Dispose descendants
  if (typeof obj.traverse === "function") {
    obj.traverse((n) => {
      if (n === obj) return;

      if (n.geometry && typeof n.geometry.dispose === "function") {
        n.geometry.dispose();
      }

      if (n.material) {
        if (Array.isArray(n.material)) {
          for (const m of n.material) _disposeMaterial(m);
        } else {
          _disposeMaterial(n.material);
        }
      }
    });
  }
}

export function clearGroup(group) {
  if (!group) return;

  for (let i = group.children.length - 1; i >= 0; i--) {
    const obj = group.children[i];
    group.remove(obj);
    disposeObject3D(obj);
  }
}