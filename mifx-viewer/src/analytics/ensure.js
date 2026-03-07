// analytics/ensure.js
// ------------------------------------------------------------
// Ensures op.analytics is present (summary + full result) using cache.
//
// - Keyed by artifact.sha256 => toolpath change => automatic cache miss.
// - Stores summary on op.analytics for UI.
// - Also stores full result under op.analytics._raw (optional).
// ------------------------------------------------------------

import { makeAnalyticsKey, getCachedAnalytics, setCachedAnalytics } from "./cache.js";
import { runOpAnalyticsAsync } from "./run_async.js";

function _toUiSummary(result) {
  const totalSec = Number(result?.timeSec?.total) || 0;
  const totalDist = Number(result?.lengths?.total) || 0;

  // Your UI wants these names:
  return {
    cycle_time_sec: totalSec,
    distance: totalDist,
    distance_unit: String(result?.programUnits || "").toUpperCase(), // "MM" / "INCH"
    // keep richer data too (optional)
    _raw: result,
  };
}

export async function ensureOpAnalyticsComputed({
  jobId,
  op,
  motionPoints,
  units,
  toolId,
  artifactSha256,
  machineSettings = null,
  onProgress = null,
  signal = null,
} = {}) {
  if (!op || !Number.isFinite(Number(op.id))) return null;

  const key = makeAnalyticsKey({
    jobId,
    opId: op.id,
    artifactSha256,
  });

  // Cache hit
  const cached = getCachedAnalytics(key);
  if (cached) {
    op.analytics = cached;
    return cached;
  }

  // Compute
  const res = await runOpAnalyticsAsync({
    opId: op.id,
    setupId: op.setup_id ?? null,
    motionPoints,
    units,
    toolId: toolId ?? op.tool_id ?? null,
    machineSettings,
    onProgress,
    signal,
  });

  const summary = _toUiSummary(res);

  // Attach to op for UI
  op.analytics = summary;

  // Cache summary (NOT raw points)
  setCachedAnalytics(key, summary);

  return summary;
}