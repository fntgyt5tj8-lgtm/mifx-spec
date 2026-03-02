// src/render/three/features/views.js
// Feature: camera presets that are ALWAYS based on a canonical ISO pose
// - Presets ignore last orbit/zoom
// - resetView() restores canonical ISO pose
// - frameAll() can update the canonical pose (optional; see note)

export function installViews(ctx) {
  const THREE = ctx.THREE;
  const camera = ctx.camera;
  const controls = ctx.controls;
  const scene = ctx.scene;

  // ------------------------------------------------------------
  // Canonical pose (base for ALL preset views)
  // ------------------------------------------------------------
  const canonical = {
    target: new THREE.Vector3(0, 0, 0),
    distance: 10,
    isoDir: new THREE.Vector3(1, 1, 1).normalize(), // camera direction for ISO
  };

  function _syncCanonicalFromCurrentIso() {
    // Capture current camera/controls as the canonical ISO pose
    canonical.target.copy(controls?.target || new THREE.Vector3(0, 0, 0));
    canonical.distance = camera.position.distanceTo(canonical.target) || canonical.distance;

    // isoDir is direction from target -> camera
    canonical.isoDir.copy(camera.position).sub(canonical.target).normalize();
    if (!Number.isFinite(canonical.isoDir.lengthSq()) || canonical.isoDir.lengthSq() < 1e-12) {
      canonical.isoDir.set(1, 1, 1).normalize();
    }
  }

  // call once at install so presets have a stable base
  _syncCanonicalFromCurrentIso();

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------
  function _applyPose(target, dir, distance) {
    const t = target.clone();
    const d = Math.max(0.01, Number(distance) || 10);
    const nd = dir.clone().normalize();

    const pos = t.clone().add(nd.multiplyScalar(d));

    camera.position.copy(pos);
    camera.lookAt(t);
    camera.updateProjectionMatrix();

    if (controls) {
      controls.target.copy(t);
      controls.update();
    }
  }

  // Directions in Z-up convention:
  // top: +Z looking down => camera above target (dir +Z)
  // bottom: -Z
  // front: +Y (or -Y depending on your convention; pick one and stay consistent)
  // right: +X
  // left: -X
  const DIRS = {
    iso: () => canonical.isoDir.clone(),
    top: () => new THREE.Vector3(0, 0, 1),
    bottom: () => new THREE.Vector3(0, 0, -1),
    front: () => new THREE.Vector3(0, 1, 0),
    back: () => new THREE.Vector3(0, -1, 0),
    right: () => new THREE.Vector3(1, 0, 0),
    left: () => new THREE.Vector3(-1, 0, 0),
  };

  // ------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------
  function setView(name) {
    const key = String(name || "iso").toLowerCase();
    const dirFn = DIRS[key] || DIRS.iso;

    // ALWAYS use canonical target + canonical distance
    _applyPose(canonical.target, dirFn(), canonical.distance);
  }

  function resetView() {
    setView("iso");
  }

  function frameAll() {
    if (!camera || !scene) return;

    const box = new THREE.Box3().setFromObject(scene);
    if (!isFinite(box.min.x) || box.isEmpty()) return;

    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * 1.5;

    // move camera to canonical ISO direction at new distance
    canonical.target.copy(center);
    canonical.distance = dist;

    // keep iso direction stable (do NOT overwrite isoDir here)
    _applyPose(canonical.target, canonical.isoDir, canonical.distance);
  }

  // Optional: if you want “ISO” to always be exactly the initial pose even after frameAll(),
  // then remove canonical updates inside frameAll() and just move camera without touching canonical.

  return {
    setView,
    resetView,
    frameAll,

    // useful for debugging/tuning
    _debug: { canonical, _syncCanonicalFromCurrentIso },
  };
}