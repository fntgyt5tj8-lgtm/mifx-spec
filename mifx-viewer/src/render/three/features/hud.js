// src/render/three/features/hud.js
// Minimal HUD: show APT/CL lines only (5-line window)
// - Pure module (no globals, no backward compat)
// - No Three.js deps
//
// Used by three_renderer.js:
//   hudMount(this.host)
//   hudClear()
//   hudRegisterTimeline(opId, timeline)
//   hudSetFromTimeline(opId, idx)
//   hudDestroy()

let _host = null;

// opId -> timeline array
const _timelines = new Map();

// DOM
let _root = null;
let _linesEl = null;

function _ensureDom() {
  if (_root) return;
  if (!_host) _host = document.body;

  _root = document.createElement("div");
  _root.id = "mifx-hud";
  Object.assign(_root.style, {
    position: "absolute",
    left: "12px",
    bottom: "12px",
    zIndex: 9999,
    pointerEvents: "none",
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: "12px",
    lineHeight: "1.35",
    color: "#eaeef2",
    background: "rgba(0,0,0,0.55)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: "10px",
    padding: "10px 12px",
    maxWidth: "70vw",
    whiteSpace: "pre",
    userSelect: "none",
  });

  _linesEl = document.createElement("div");
  _root.appendChild(_linesEl);

  // host must be positioned for absolute overlay
  try {
    const st = getComputedStyle(_host);
    if (st.position === "static") _host.style.position = "relative";
  } catch (_) {}

  _host.appendChild(_root);
}

function _destroyDom() {
  if (_root && _root.parentNode) _root.parentNode.removeChild(_root);
  _root = null;
  _linesEl = null;
}

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
  _host = host || document.body;
}

export function hudClear() {
  _timelines.clear();
  _destroyDom();
}

export function hudDestroy() {
  _host = null;
  hudClear();
}

export function hudRegisterTimeline(opId, timeline /*, pointsCount */) {
  const id = opId || null;
  if (!id) return;

  const arr = Array.isArray(timeline) ? timeline : [];
  _timelines.set(id, arr);
}

export function hudSetFromTimeline(opId, pointIndex) {
  const id = opId || null;
  if (!id) return;

  const timeline = _timelines.get(id);
  if (!Array.isArray(timeline) || !timeline.length) return;

  const n = timeline.length;
  const idx = Math.max(0, Math.min(n - 1, Number(pointIndex) || 0));

  _ensureDom();

  const win = 2; // 2 above + current + 2 below = 5 lines
  const start = Math.max(0, idx - win);
  const end = Math.min(n - 1, idx + win);

  const rows = [];
  for (let i = start; i <= end; i++) {
    const apt = _toAptLine(timeline[i]);
    const isCur = i === idx;
    const prefix = isCur ? ">> " : "   ";
    rows.push({ isCur, text: prefix + (apt || "(no apt)") });
  }

  _linesEl.innerHTML = "";
  for (const r of rows) {
    const div = document.createElement("div");
    div.textContent = r.text;

    if (r.isCur) {
      Object.assign(div.style, {
        color: "#ffffff",
        background: "rgba(255,255,255,0.12)",
        borderRadius: "6px",
        padding: "1px 6px",
        margin: "0 -6px",
      });
    } else {
      Object.assign(div.style, { opacity: "0.85" });
    }

    _linesEl.appendChild(div);
  }
}