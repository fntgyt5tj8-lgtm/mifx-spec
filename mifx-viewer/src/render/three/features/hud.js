// src/render/three/features/hud.js
// HUD data/state only
// - No DOM layout
// - No styling
// - No positioning
//
// Used by renderer/toolpaths:
//   hudMount(hostEl)              // optional host tracking only
//   hudClear()
//   hudRegisterTimeline(opId, timeline)
//   hudBuildRows(opId, pointIndex)
//   hudDestroy()

let _host = null;

// opId -> timeline array
const _timelines = new Map();

function _toAptLine(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return entry.trim();
  if (typeof entry === "object") {
    const s = entry.apt ?? entry.raw ?? entry.line ?? "";
    return String(s || "").trim();
  }
  return String(entry).trim();
}

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

export function hudMount(host) {
  // kept only so existing call sites stay valid
  _host = host || null;
}

export function hudClear() {
  _timelines.clear();
}

export function hudDestroy() {
  _host = null;
  _timelines.clear();
}

export function hudRegisterTimeline(opId, timeline /*, pointsCount */) {
  const id = opId || null;
  if (!id) return;

  const arr = Array.isArray(timeline) ? timeline : [];
  _timelines.set(id, arr);
}

export function hudBuildRows(opId, pointIndex) {
  const id = opId || null;
  if (!id) return [];

  const timeline = _timelines.get(id);
  if (!Array.isArray(timeline) || !timeline.length) return [];

  const n = timeline.length;
  const idx = Math.max(0, Math.min(n - 1, Number(pointIndex) || 0));

  const win = 2; // 2 above + current + 2 below = 5 lines
  const start = Math.max(0, idx - win);
  const end = Math.min(n - 1, idx + win);

  const rows = [];
  for (let i = start; i <= end; i++) {
    const apt = _toAptLine(timeline[i]);
    rows.push({
      isCurrent: i === idx,
      text: (i === idx ? ">> " : "   ") + (apt || "(no apt)"),
      index: i,
    });
  }

  return rows;
}