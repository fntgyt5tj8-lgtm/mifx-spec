// src/ui/shell.js
import { state } from "../app/state.js";
import {
  playbackPlay,
  playbackPause,
  playbackStop,
  playbackSetStepFloat,
  playbackSetSpeed,
  playbackPrev,
  playbackNext,
  playbackResetForOpChange,
} from "../app/playback.js";

let _keyHandlerInstalled = false;

export function renderShell(root) {
  root.innerHTML = `<div id="dropzone">Drop a .mifx file here</div>`;
}

function _ensurePreviewState() {
  const p = (state.preview ??= {});
  if (typeof p.showWcs !== "boolean") p.showWcs = true;
  if (typeof p.showAxes !== "boolean") p.showAxes = true;
  if (typeof p.showGrid !== "boolean") p.showGrid = false;
  return p;
}

function _updateWcsButtonUi(btn) {
  if (!btn) return;
  const p = _ensurePreviewState();
  btn.textContent = p.showWcs ? "WCS: ON" : "WCS: OFF";
  btn.style.opacity = p.showWcs ? "1" : "0.65";
}

function _applyWcsToRenderer() {
  const p = _ensurePreviewState();
  state.renderer?.setWcsVisibility?.({
    showWcs: p.showWcs,
    showAxes: p.showAxes,
    showGrid: p.showGrid,
  });
}

// ------------------------------------------------------------
// Playback UI enable/disable based on active op
// ------------------------------------------------------------
function _setPlaybackUiEnabled(enabled) {
  const ids = ["pbPrev", "pbPlay", "pbPause", "pbStop", "pbNext", "pbScrub", "pbSpeed"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.disabled = !enabled;
    el.style.opacity = enabled ? "1" : "0.45";
    el.style.pointerEvents = enabled ? "auto" : "none";
  }
}

function _syncScrubRange() {
  const scrub = document.getElementById("pbScrub");
  if (!scrub) return;

  const r = state.renderer;
  const opId = state.activeOpId;
  const n =
    r && opId && typeof r.getPlaybackStepCount === "function"
      ? Number(r.getPlaybackStepCount(opId)) || 0
      : 0;

  scrub.min = "0";
  scrub.max = String(Math.max(0, n - 1));
  scrub.step = "0.001";

  const pb = (state.playback ??= {});
  const v = Number.isFinite(pb._stepFloat) ? pb._stepFloat : (pb.stepIndex ?? 0);
  scrub.value = String(Math.max(0, Math.min((n || 1) - 1, Number(v) || 0)));
}

export function renderLoaded(root, onSetupChange) {
  const job = state.job;
  const setups = job.setups || [];

  _ensurePreviewState();

  root.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100vh;">
      <div style="padding:10px;border-bottom:1px solid #ddd;display:flex;gap:10px;align-items:center;">
        <label>
          Setup:
          <select id="setupSelect"></select>
        </label>

        <button id="btnWcs" title="Toggle WCS (axes/grid)">WCS: ON</button>

        <!-- ✅ View dropdown (no fit / no align_op) -->
        <label style="display:flex;align-items:center;gap:6px;">
          View:
          <select id="viewSelect" title="Camera view">
            <option value="iso" selected>ISO</option>
            <option value="top">Top</option>
            <option value="bottom">Bottom</option>
            <option value="front">Front</option>
            <option value="right">Right</option>
            <option value="left">Left</option>
          </select>
        </label>

        <div style="flex:1"></div>

        <label style="display:flex;align-items:center;gap:6px;">
          Speed:
          <select id="pbSpeed">
            <option value="0.25">0.25x</option>
            <option value="0.5">0.5x</option>
            <option value="1" selected>1x</option>
            <option value="2">2x</option>
            <option value="4">4x</option>
          </select>
        </label>

        <button id="pbPrev" title="Step back (←)">◀︎</button>
        <button id="pbPlay">Play</button>
        <button id="pbPause">Pause</button>
        <button id="pbStop">Reset</button>
        <button id="pbNext" title="Step forward (→)">▶︎</button>

        <input id="pbScrub" type="range" min="0" max="0" step="0.001" value="0" style="width:260px;" />
      </div>

      <div style="display:flex;flex:1;min-height:0;">
        <div style="width:300px;border-right:1px solid #ddd;padding:10px;overflow:auto;">
          <div><b>Operations</b></div>
          <ul id="opList" style="padding-left:16px;margin-top:8px;"></ul>
        </div>

        <div id="viewport" style="flex:1;min-width:0;position:relative;"></div>
      </div>
    </div>
  `;

  // setup dropdown
  const select = document.getElementById("setupSelect");
  setups.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name || s.id;
    select.appendChild(opt);
  });
  select.value = state.activeSetupId;
  select.addEventListener("change", (e) => onSetupChange(e.target.value));

  renderOps();

  // WCS button
  const btnWcs = document.getElementById("btnWcs");
  _updateWcsButtonUi(btnWcs);
  btnWcs?.addEventListener("click", () => {
    const p = _ensurePreviewState();
    p.showWcs = !p.showWcs;
    _updateWcsButtonUi(btnWcs);
    _applyWcsToRenderer();
  });
  _applyWcsToRenderer();

  // ✅ Views wiring
  const viewSelect = document.getElementById("viewSelect");
  viewSelect?.addEventListener("change", (e) => {
    const v = e.target.value || "iso";
    state.renderer?.setView?.(v);
  });

  // playback wiring
  const scrub = document.getElementById("pbScrub");
  const btnPlay = document.getElementById("pbPlay");
  const btnPause = document.getElementById("pbPause");
  const btnStop = document.getElementById("pbStop");
  const btnPrev = document.getElementById("pbPrev");
  const btnNext = document.getElementById("pbNext");
  const speed = document.getElementById("pbSpeed");

  const pb = (state.playback ??= {});
  if (pb.speed == null) pb.speed = 1.0;
  if (speed) speed.value = String(pb.speed);

  btnPlay?.addEventListener("click", () => playbackPlay());
  btnPause?.addEventListener("click", () => playbackPause());
  btnStop?.addEventListener("click", () => playbackStop());
  btnPrev?.addEventListener("click", () => playbackPrev());
  btnNext?.addEventListener("click", () => playbackNext());

  speed?.addEventListener("change", (e) => {
    playbackSetSpeed(Number(e.target.value) || 1.0);
  });

  scrub?.addEventListener("input", (e) => {
    playbackSetStepFloat(Number(e.target.value));
  });

  // 🔒 disable playback until op selected
  _setPlaybackUiEnabled(!!state.activeOpId);
  _syncScrubRange();

  if (!_keyHandlerInstalled) {
    _keyHandlerInstalled = true;
    window.addEventListener(
      "keydown",
      (e) => {
        const tag = e.target?.tagName?.toLowerCase?.() || "";
        const typing = tag === "input" || tag === "select" || tag === "textarea";
        if (typing) return;

        if (!state.activeOpId) return;

        if (e.key === "ArrowLeft") {
          e.preventDefault();
          playbackPrev();
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          playbackNext();
        }
      },
      { passive: false }
    );
  }
}

export function renderOps() {
  const list = document.getElementById("opList");
  if (!list) return;

  list.innerHTML = "";

  const ops = state.operations || [];
  const filtered = ops.filter((op) => op.setupRef === state.activeSetupId);

  filtered.forEach((op) => {
    const li = document.createElement("li");
    li.textContent = op.name || op.id;
    li.style.cursor = "pointer";

    if (state.activeOpId === op.id) {
      li.style.fontWeight = "600";
      li.style.color = "#ff5500";
    }

    li.addEventListener("click", () => {
      state.activeOpId = op.id;

      playbackResetForOpChange();
      state.renderer?.setActiveOperation?.(op.id);

      _setPlaybackUiEnabled(true);
      _syncScrubRange();

      const scrub = document.getElementById("pbScrub");
      if (scrub) scrub.value = "0";

      renderOps();
    });

    list.appendChild(li);
  });

  // if active op no longer exists in this setup, lock transport
  if (!filtered.some((o) => o.id === state.activeOpId)) {
    state.activeOpId = null;
    _setPlaybackUiEnabled(false);
    _syncScrubRange();
  }
}