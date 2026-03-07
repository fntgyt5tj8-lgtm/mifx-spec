// analytics/index.js
// ------------------------------------------------------------
// Orchestrator (glue). Keep SMALL.
// Input contract:
//   runOpAnalytics({ opId, setupId, motionPoints, units, toolId, machineSettings? })
//
// geometry.js: computeLengths(motionPoints) -> { metrics:{...}, warnings:[] }
// time.js:
//   - estimateTimeFromMotionPoints(...) -> { totalSec, byMotionSec, unknown?, warnings? }
//   - OR computeTime(...) -> { metrics:{ timeMinByMotion, totalTimeMin, unknown }, warnings:[] }
// ------------------------------------------------------------

import { getDefaultMachineSettings } from "./settings.js";
import { makeOpAnalyticsResult, addByKey, addWarning } from "./model.js";
import { validateOpAnalytics } from "./validate.js";

import { computeLengths } from "./geometry.js";
import * as TIME from "./time.js";

function _pickFn(mod, names) {
  for (const n of names) {
    if (typeof mod?.[n] === "function") return mod[n];
  }
  return null;
}

// Prefer seconds-returning estimators first.
// Fallback to computeTime() which returns minutes.
const timeEstimate = _pickFn(TIME, [
  "estimateTimeFromMotionPoints", // ✅ seconds wrapper
  "estimateOpTime",               // ✅ alias (seconds)
  "computeTime",                  // minutes fallback
  "computeOpTime",
  "estimateTime",
]);

function _unitsNorm(u) {
  const s = String(u || "").toUpperCase();
  if (s === "IN" || s === "INCH" || s === "INCHES") return "IN";
  if (s === "MM" || s === "METRIC") return "MM";
  return s || "MM";
}

export function runOpAnalytics({
  opId,
  setupId = null,
  motionPoints,
  units = "MM",
  toolId = null,
  machineSettings = null,
} = {}) {
  const programUnits = _unitsNorm(units);

  const result = makeOpAnalyticsResult({
    opId: Number(opId),
    setupId,
    programUnits,
    toolId,
  });

  // schema
  result.lengths.units = programUnits;

  const mp = Array.isArray(motionPoints) ? motionPoints : [];
  result.counts.motionPoints = mp.length;
  result.counts.segments = Math.max(0, mp.length - 1);

  if (mp.length < 2) {
    addWarning(result, "NO_MOTION", "Not enough motion points provided.", {
      motionPoints: mp.length,
    });
    return validateOpAnalytics(result);
  }

  const ms = machineSettings || getDefaultMachineSettings(programUnits);

  // -----------------
  // Geometry
  // -----------------
  try {
    const g = computeLengths(mp);
    const metrics = g?.metrics || {};

    if (metrics.bbox) result.bounds = metrics.bbox;

    if (Number.isFinite(metrics.totalLength)) {
      result.lengths.total = Number(metrics.totalLength) || 0;
    }

    const by = metrics.lengthByMotion || {};
    for (const k of Object.keys(by)) addByKey(result.lengths.byMotion, k, by[k]);

    if (Array.isArray(g?.warnings)) {
      for (const w of g.warnings) {
        if (typeof w === "string") addWarning(result, "GEOM_WARN", w);
        else if (w?.code && w?.message) result.warnings.push(w);
      }
    }
  } catch (e) {
    addWarning(result, "GEOM_FAIL", "Geometry computation failed.", String(e?.message || e));
  }

  // -----------------
  // Time
  // -----------------
  try {
    if (!timeEstimate) {
      addWarning(result, "TIME_NO_IMPL", "time.js estimator not wired yet.");
      return validateOpAnalytics(result);
    }

    const t = timeEstimate(mp, ms) || {};

    // Case A: estimator returns seconds (preferred)
    if (Number.isFinite(t.totalSec) || t.byMotionSec) {
      if (Number.isFinite(t.totalSec)) result.timeSec.total = Number(t.totalSec) || 0;

      const bySec = t.byMotionSec && typeof t.byMotionSec === "object" ? t.byMotionSec : {};
      for (const k of Object.keys(bySec)) {
        const v = Number(bySec[k]);
        if (Number.isFinite(v)) addByKey(result.timeSec.byMotion, k, v);
      }

      if (t.unknown) result.timeSec.unknown = t.unknown;

      if (Array.isArray(t.warnings)) {
        for (const w of t.warnings) {
          if (typeof w === "string") addWarning(result, "TIME_WARN", w);
          else if (w?.code && w?.message) result.warnings.push(w);
        }
      }

      return validateOpAnalytics(result);
    }

    // Case B: estimator returns minutes (computeTime style)
    const totalMin =
      t?.metrics?.totalTimeMin ??
      t?.totalMin ??
      t?.totalTimeMin ??
      null;

    if (Number.isFinite(totalMin)) result.timeSec.total = Number(totalMin) * 60;

    const byMin =
      t?.metrics?.timeMinByMotion ??
      t?.timeMinByMotion ??
      t?.byMotionMin ??
      null;

    if (byMin && typeof byMin === "object") {
      for (const k of Object.keys(byMin)) {
        const vMin = Number(byMin[k]);
        if (Number.isFinite(vMin)) addByKey(result.timeSec.byMotion, k, vMin * 60);
      }
    }

    const unk = t?.metrics?.unknown ?? t?.unknown ?? null;
    if (unk) result.timeSec.unknown = unk;

    if (Array.isArray(t?.warnings)) {
      for (const w of t.warnings) {
        if (typeof w === "string") addWarning(result, "TIME_WARN", w);
        else if (w?.code && w?.message) result.warnings.push(w);
      }
    }
  } catch (e) {
    addWarning(result, "TIME_FAIL", "Time estimation failed.", String(e?.message || e));
  }

  return validateOpAnalytics(result);
}