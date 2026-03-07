// src/analytics/validate.js

export function validateOpInput({ opId, setupId, toolId, motionPoints } = {}) {
  const warnings = [];

  // opId is a STRING like "op-12"
  if (typeof opId !== "string" || !opId.trim()) {
    warnings.push({
      code: "OP_ID_MISSING",
      message: "opId is missing or invalid.",
    });
  }

  if (!Array.isArray(motionPoints) || motionPoints.length < 2) {
    warnings.push({
      code: "NO_MOTION",
      message: "Not enough motion points to analyze.",
      detail: { motionPoints: Array.isArray(motionPoints) ? motionPoints.length : 0 },
    });
  }

  return warnings;
}