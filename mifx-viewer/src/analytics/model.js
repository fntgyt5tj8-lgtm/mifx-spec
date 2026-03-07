// analytics/model.js
// ------------------------------------------------------------
// Result schema (stable contract for UI + future aggregation)
//
// Keep this SMALL. Everything optional can be added later.
// ------------------------------------------------------------

export function makeOpAnalyticsResult({
  opId = null,
  setupId = null,
  programUnits = null, // "MM", "INCH", etc.
  toolId = null,       // from job.xml later
} = {}) {
  return {
    kind: "op_analytics_v0",
    opId,
    setupId,
    programUnits,
    toolId,

    // geometry
    bounds: null, // { min:{x,y,z}, max:{x,y,z} }
    lengths: {
      units: null,    // "MM" | "IN" | null
      total: 0,       // same units as motionPoints
      byMotion: {},   // { FEED: 123, RAPID: 45, ARC: 12 ... }
    },

    // timing
    timeSec: {
      total: 0,
      byMotion: {},   // { FEED: 12.3, RAPID: 0.8 ... }
      unknown: null,  // { length, segments, reasons:{...} } if missing feed/RPM etc.
    },

    // metadata + debug
    counts: {
      motionPoints: 0,
      segments: 0,    // mp.length - 1 (minus zero-length if you choose)
    },

    // warnings for UI
    warnings: [], // [{code, message, detail?}]
  };
}

export function addWarning(result, code, message, detail = null) {
  result?.warnings?.push?.({ code, message, ...(detail != null ? { detail } : {}) });
  return result;
}

export function addByKey(mapObj, key, delta) {
  if (!mapObj || key == null) return;
  const k = String(key).toUpperCase();
  const v = Number(delta) || 0;
  mapObj[k] = (Number(mapObj[k]) || 0) + v;
}