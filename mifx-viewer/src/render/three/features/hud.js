// src/render/three/features/hud.js

const _timelineByOpId = new Map();
let _hudHost = null;

export function hudMount(hostEl) {
  _hudHost = hostEl || null;
}

export function hudClear() {
  if (_hudHost) _hudHost.innerHTML = "";
}

export function hudDestroy() {
  if (_hudHost) _hudHost.innerHTML = "";
  _hudHost = null;
  _timelineByOpId.clear();
}

export function hudRegisterTimeline(opId, timeline) {
  if (opId == null) return;
  _timelineByOpId.set(String(opId), Array.isArray(timeline) ? timeline : []);
}

export function hudUnregisterTimeline(opId) {
  if (opId == null) return;
  _timelineByOpId.delete(String(opId));
}

function _coerceTimeline(raw) {
  const src = Array.isArray(raw) ? raw : [];
  return src
    .map((r, idx) => ({
      idx,
      apt: r?.apt || null,
      n: Number.isFinite(r?.n) ? r.n : null,
      kind: r?.kind || "record",
      pointIndex: Number.isFinite(r?.pointIndex) ? r.pointIndex : null,
    }))
    .filter((r) => r.apt);
}

function _getTimeline(opId) {
  if (opId == null) return [];
  return _coerceTimeline(_timelineByOpId.get(String(opId)) || []);
}

function _hasAnyPointIndex(timeline) {
  return timeline.some((r) => Number.isFinite(r.pointIndex));
}

function _findAnchorTimelineIndex(timeline, stepIndex) {
  const step = Number.isFinite(stepIndex) ? stepIndex : 0;
  if (!timeline.length) return -1;

  // Best case: timeline rows are linked to motion points
  if (_hasAnyPointIndex(timeline)) {
    let best = -1;

    for (let i = 0; i < timeline.length; i++) {
      const r = timeline[i];
      if (!Number.isFinite(r.pointIndex)) continue;
      if (r.pointIndex <= step) best = i;
      else break;
    }

    if (best >= 0) return best;
  }

  // Fallback: no pointIndex mapping available
  // Use proportional anchor so HUD still moves during playback
  const n = timeline.length;
  if (n === 1) return 0;

  const approx = Math.max(0, Math.min(n - 1, Math.round(step)));
  return approx;
}

function _formatLineNumber(n) {
  if (!Number.isFinite(n)) return "     ";
  return String(n + 1).padStart(5, " ");
}

function _cleanAptText(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

export function hudBuildRows(opId, stepIndex, radius = 2) {
  const timeline = _getTimeline(opId);
  if (!timeline.length) return [];

  const anchor = _findAnchorTimelineIndex(timeline, stepIndex);
  if (anchor < 0) return [];

  const from = Math.max(0, anchor - radius);
  const to = Math.min(timeline.length - 1, anchor + radius);

  const rows = [];
  for (let i = from; i <= to; i++) {
    const r = timeline[i];
    const apt = _cleanAptText(r.apt || "");
    if (!apt) continue;

    rows.push({
      text: `${_formatLineNumber(r.n)}  ${apt}`,
      isCurrent: i === anchor,
      kind: r.kind || "record",
      pointIndex: Number.isFinite(r.pointIndex) ? r.pointIndex : null,
      n: Number.isFinite(r.n) ? r.n : null,
    });
  }

  return rows;
}

export function hudGetHost() {
  return _hudHost;
}