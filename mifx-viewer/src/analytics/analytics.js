// src/analytics/analytics.js
// Pure compute only (NO DOM)

export function analyzeOp({
  opId,
  setupId,
  toolId = null,
  motionPoints = [],
  unitsLinear = "mm",
} = {}) {
  const warnings = [];

  if (!opId) warnings.push({ code: "OP_ID_MISSING", message: "opId is missing or invalid." });
  if (!Array.isArray(motionPoints) || motionPoints.length < 2) {
    warnings.push({
      code: "NO_MOTION",
      message: "Not enough motion points provided.",
      detail: { motionPoints: motionPoints?.length || 0 },
    });
  }

  const byMotion = {};
  let total = 0;

  if (Array.isArray(motionPoints)) {
    for (let i = 1; i < motionPoints.length; i++) {
      const a = motionPoints[i - 1];
      const b = motionPoints[i];
      if (!a || !b) continue;

      const dx = (Number(b.x) || 0) - (Number(a.x) || 0);
      const dy = (Number(b.y) || 0) - (Number(a.y) || 0);
      const dz = (Number(b.z) || 0) - (Number(a.z) || 0);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!Number.isFinite(d) || d <= 0) continue;

      const m = String(b.motion || b.type || b.kind || "FEED").toUpperCase();
      total += d;
      byMotion[m] = (byMotion[m] || 0) + d;
    }
  }

  return {
    kind: "op_analytics_v0",
    opId: opId || null,
    setupId: setupId || null,
    programUnits: String(unitsLinear || "mm").toUpperCase(),
    toolId: toolId || null,
    bounds: null,
    lengths: {
      units: unitsLinear || null,
      total,
      byMotion,
    },
    timeSec: {
      total: 0,
      byMotion: {},
      unknown: null,
    },
    counts: {
      motionPoints: Array.isArray(motionPoints) ? motionPoints.length : 0,
      segments: Array.isArray(motionPoints) ? Math.max(0, motionPoints.length - 1) : 0,
    },
    warnings,
  };
}