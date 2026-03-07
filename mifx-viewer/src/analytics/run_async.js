// src/analytics/run_async.js
import { analyzeOp } from "./analytics.js";
import { validateOpInput } from "./validate.js";

/**
 * Browser-friendly "async" wrapper for op analytics.
 * IMPORTANT: opId in this project is a STRING like "op-4" (not a number).
 */
export async function runOpAnalyticsAsync({ opId, setupId, toolId, motionPoints, unitsLinear } = {}) {
  const input = {
    opId: opId != null ? String(opId) : null,
    setupId: setupId != null ? String(setupId) : null,
    toolId: toolId != null ? String(toolId) : null,
    motionPoints: Array.isArray(motionPoints) ? motionPoints : [],
    unitsLinear: String(unitsLinear || "mm").toLowerCase(),
  };

  const warnings = validateOpInput(input);

  // If invalid, still return a structured result (with warnings)
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

  // Run in next tick (keeps UI responsive)
  await new Promise((r) => setTimeout(r, 0));
  return analyzeOp(input);
}