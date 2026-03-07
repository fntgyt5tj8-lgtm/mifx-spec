// analytics/time.js
// ------------------------------------------------------------
// Time estimation (simple + robust)
// - RAPID uses settings.rapidRate (units/min)
// - FEED/ARC/HELIX/PLUNGE/RETRACT/CYCLE_TRAVEL use feed + feedMode (+ rpm if IPR/MMPR)
// - Cycles: currently timed like normal feed segments (phase 1)
//
// Returns minutes internally, orchestrator wants seconds.
// ------------------------------------------------------------

import { dist3 } from "./geometry.js";

function _normFeedMode(feedMode) {
  const fm = String(feedMode || "").trim().toUpperCase();
  // Treat blank/unknown as "units per minute" style
  // (APT/CL often omits mode when it's implicit)
  return fm || ""; // "" means IPM/MMPM style in feedToUnitsPerMin()
}

function feedToUnitsPerMin(feed, feedModeNorm, spindleRpm) {
  const f = Number(feed);
  if (!Number.isFinite(f) || f <= 0) return null;

  const m = String(feedModeNorm || "").toUpperCase();

  // Units per minute (default)
  if (m === "" || m === "IPM" || m === "MMPM") return f;

  // Units per revolution -> needs rpm
  if (m === "IPR" || m === "MMPR") {
    const rpm = Number(spindleRpm);
    if (!Number.isFinite(rpm) || rpm <= 0) return null;
    return f * rpm;
  }

  return null;
}

export function computeTime(motionPoints, settings) {
  const mp = Array.isArray(motionPoints) ? motionPoints : [];
  const rapidRate = Number(settings?.rapidRate);

  const timeMinByMotion = {
    RAPID: 0,
    FEED: 0,
    ARC: 0,
    HELIX: 0,
    PLUNGE: 0,
    RETRACT: 0,
    CYCLE_TRAVEL: 0,
    OTHER: 0,
  };

  const unknown = {
    length: 0,
    segments: 0,
    reasons: { missingFeed: 0, missingRpm: 0, badNumbers: 0 },
  };

  const feedModeCounts = { IPM: 0, IPR: 0, MMPM: 0, MMPR: 0, OTHER: 0 };

  for (let i = 1; i < mp.length; i++) {
    const a = mp[i - 1];
    const b = mp[i];

    const L = dist3(a, b);
    if (!Number.isFinite(L) || L <= 0) continue;

    const motion = String(b.motion || "FEED").toUpperCase();

    // RAPID: settings-based
    if (motion === "RAPID") {
      if (Number.isFinite(rapidRate) && rapidRate > 0) timeMinByMotion.RAPID += L / rapidRate;
      else {
        unknown.length += L;
        unknown.segments++;
        unknown.reasons.badNumbers++;
      }
      continue;
    }

    // FEED-like: use feed + mode (+ rpm if per-rev)
    const feed = b.feed ?? b.hud?.feed ?? null;
    const feedModeRaw = b.feedMode ?? b.hud?.feedMode ?? null;
    const rpm = b.hud?.spindle?.rpm ?? null;

    const fm = _normFeedMode(feedModeRaw);

    // Count feed modes for debugging/telemetry
    if (fm === "IPM") feedModeCounts.IPM++;
    else if (fm === "IPR") feedModeCounts.IPR++;
    else if (fm === "MMPM") feedModeCounts.MMPM++;
    else if (fm === "MMPR") feedModeCounts.MMPR++;
    else feedModeCounts.OTHER++;

    const upm = feedToUnitsPerMin(feed, fm, rpm);
    if (!Number.isFinite(upm) || upm <= 0) {
      unknown.length += L;
      unknown.segments++;

      const fnum = Number(feed);
      if (!Number.isFinite(fnum) || fnum <= 0) unknown.reasons.missingFeed++;
      else if ((fm === "IPR" || fm === "MMPR") && !(Number.isFinite(Number(rpm)) && Number(rpm) > 0))
        unknown.reasons.missingRpm++;
      else unknown.reasons.badNumbers++;

      continue;
    }

    const dtMin = L / upm; // minutes
    if (timeMinByMotion[motion] != null) timeMinByMotion[motion] += dtMin;
    else timeMinByMotion.OTHER += dtMin;
  }

  const totalTimeMin = Object.values(timeMinByMotion).reduce((s, v) => s + v, 0);

  const warnings = [];
  if (unknown.segments > 0) {
    warnings.push({
      code: "TIME_UNKNOWN",
      message: "Some segments could not be timed due to missing feed and/or spindle RPM.",
      detail: unknown,
    });
  }

  return {
    metrics: { timeMinByMotion, totalTimeMin, unknown },
    debug: { usedRapidRate: rapidRate, feedModeCounts },
    warnings,
  };
}

// ------------------------------------------------------------
// Orchestrator-friendly wrapper: returns SECONDS
// ------------------------------------------------------------

export function estimateTimeFromMotionPoints(motionPoints, settings) {
  const r = computeTime(motionPoints, settings);

  const byMotionSec = {};
  const tbm = r?.metrics?.timeMinByMotion || {};
  for (const k of Object.keys(tbm)) {
    const vMin = Number(tbm[k]) || 0;
    byMotionSec[k] = vMin * 60.0;
  }

  const totalSec = (Number(r?.metrics?.totalTimeMin) || 0) * 60.0;

  return {
    totalSec,
    byMotionSec,
    unknown: r?.metrics?.unknown || null,
    debug: r?.debug || null,
    warnings: Array.isArray(r?.warnings) ? r.warnings : [],
  };
}

// Optional alias (if you prefer this name later)
export const estimateOpTime = estimateTimeFromMotionPoints;