// src/analytics/run_async.js
import { runOpAnalytics } from "./index.js";
import { validateOpInput } from "./validate.js";

export async function runOpAnalyticsAsync({
  opId,
  setupId,
  toolId,
  motionPoints,
  unitsLinear,
} = {}) {
  const input = {
    opId: opId != null ? String(opId) : null,
    setupId: setupId != null ? String(setupId) : null,
    toolId: toolId != null ? String(toolId) : null,
    motionPoints: Array.isArray(motionPoints) ? motionPoints : [],
    unitsLinear: String(unitsLinear || "mm").toLowerCase(),
  };

  const warnings = validateOpInput(input);

  if (warnings.length) {
    return {
      kind: "op_analytics_v0",
      opId: input.opId,
      setupId: input.setupId,
      programUnits: input.unitsLinear?.toUpperCase?.() || null,
      toolId: input.toolId,
      bounds: null,
      lengths: { units: null, total: 0, byMotion: {} },
      timeSec: { total: 0, byMotion: {}, unknown: null },
      counts: { motionPoints: input.motionPoints.length || 0, segments: 0 },
      warnings,
    };
  }

  await new Promise((r) => setTimeout(r, 0));

  return runOpAnalytics({
    opId: input.opId,
    setupId: input.setupId,
    toolId: input.toolId,
    motionPoints: input.motionPoints,
    units: input.unitsLinear,
  });
}