// src/render/units.js
// Renderer-layer unit helpers (keep core pure).
// Convention: Three.js scene uses MM as canonical length unit.

export function normUnit(u) {
  const s = String(u || "").trim().toUpperCase();
  if (s === "IN" || s === "INCH" || s === "INCHES") return "IN";
  if (s === "MM" || s === "MILLIMETER" || s === "MILLIMETERS") return "MM";
  return s || "MM";
}

export function scaleToMM(unit) {
  return normUnit(unit) === "IN" ? 25.4 : 1.0;
}

export function vec3ToMM(p, unit) {
  const s = scaleToMM(unit);
  const x = Number(p?.x), y = Number(p?.y), z = Number(p?.z);
  return {
    x: Number.isFinite(x) ? x * s : 0,
    y: Number.isFinite(y) ? y * s : 0,
    z: Number.isFinite(z) ? z * s : 0,
  };
}

export function matrixFromRowsToSceneMM(THREE, rows4x4, unit) {
  if (!THREE) throw new Error("matrixFromRowsToSceneMM: THREE is required");

  if (!Array.isArray(rows4x4) || rows4x4.length !== 4) {
    throw new Error("matrixFromRowsToSceneMM: rows4x4 must be a 4x4 array");
  }

  const m = new THREE.Matrix4();
  m.set(
    Number(rows4x4[0][0]), Number(rows4x4[0][1]), Number(rows4x4[0][2]), Number(rows4x4[0][3]),
    Number(rows4x4[1][0]), Number(rows4x4[1][1]), Number(rows4x4[1][2]), Number(rows4x4[1][3]),
    Number(rows4x4[2][0]), Number(rows4x4[2][1]), Number(rows4x4[2][2]), Number(rows4x4[2][3]),
    Number(rows4x4[3][0]), Number(rows4x4[3][1]), Number(rows4x4[3][2]), Number(rows4x4[3][3])
  );

  const s = scaleToMM(unit);
  if (s !== 1.0) {
    const t = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();

    m.decompose(t, q, sc);
    t.multiplyScalar(s);
    m.compose(t, q, sc);
  }

  return m;
}

export function applyTransformRowsToObjectMM(THREE, obj3d, transform) {
  if (!obj3d) return;

  const rows = transform?.rows;
  const unit = transform?.unit;

  if (!Array.isArray(rows) || rows.length !== 4) {
    obj3d.matrixAutoUpdate = true;
    return;
  }

  const m = matrixFromRowsToSceneMM(THREE, rows, unit);
  obj3d.matrixAutoUpdate = false;
  obj3d.matrix.copy(m);
  obj3d.matrixWorldNeedsUpdate = true;
}