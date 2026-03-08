// src/ui/viewer.js
import { state } from "../app/state.js";
import {
  playbackPlay,
  playbackPause,
  playbackStop,
  playbackPrev,
  playbackNext,
  playbackSetStepFloat,
  playbackSetSpeed,
  playbackResetForOpChange,
} from "../app/playback.js";
import {
  hudMount,
  hudBuildRows,
} from "/src/render/three/features/hud.js";

let _installed = false;
let _keysInstalled = false;
let _setupChangeHandler = null;

let _hudLoop = null;
let _lastHudActivity = 0;
let _lastSeenStep = null;
let _lastHudRenderKey = "";

const HUD_IDLE_HIDE_MS = 1800;
const HUD_FORCE_SHOW_MS = 450;

function _now() {
  return Date.now();
}

function _touchHud() {
  _lastHudActivity = _now();
  _updateHudVisibility();
  _renderHud();
}

function _ensurePreviewState() {
  const p = (state.preview ??= {});
  if (typeof p.showWcs !== "boolean") p.showWcs = true;
  if (typeof p.showAxes !== "boolean") p.showAxes = true;
  if (typeof p.showGrid !== "boolean") p.showGrid = false;
  return p;
}

function _applyWcsToRenderer() {
  const p = _ensurePreviewState();
  state.renderer?.setWcsVisibility?.({
    showWcs: p.showWcs,
    showAxes: p.showAxes,
    showGrid: p.showGrid,
  });
}

function _updateWcsBtn(btn) {
  if (!btn) return;
  const p = _ensurePreviewState();
  btn.textContent = p.showWcs ? "WCS: ON" : "WCS: OFF";
  btn.style.opacity = p.showWcs ? "1" : "0.65";
}

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
  const v = Number.isFinite(pb._stepFloat) ? pb._stepFloat : pb.stepIndex ?? 0;
  scrub.value = String(Math.max(0, Math.min((n || 1) - 1, Number(v) || 0)));
}

function _getSetups() {
  return Array.isArray(state.job?.setups) ? state.job.setups : [];
}

function _getViewerOps() {
  return (state.operations || []).filter((op) => op.setupRef === state.activeSetupId);
}

function _renderSidebar() {
  const host = document.getElementById("viewerSidebar");
  if (!host) return;

  const setups = _getSetups();
  const ops = _getViewerOps();

  host.innerHTML = `
    <div style="margin-bottom:12px;">
      <label for="viewerSetupSelect"><b>Setup</b></label>
      <div style="margin-top:6px;">
        <select id="viewerSetupSelect" style="width:100%;">
          ${setups
            .map(
              (s) =>
                `<option value="${String(s.id)}"${
                  s.id === state.activeSetupId ? " selected" : ""
                }>${s.name || s.id}</option>`
            )
            .join("")}
        </select>
      </div>
    </div>

    <div style="margin-bottom:8px;"><b>Operations</b></div>
    <ul id="opList" style="padding-left:16px;margin-top:8px;"></ul>
  `;

  const select = document.getElementById("viewerSetupSelect");
  if (select) {
    select.addEventListener("change", async (e) => {
      const newSetupId = e.target.value || null;
      state.activeSetupId = newSetupId;

      const setupOps = (state.operations || []).filter((op) => op.setupRef === newSetupId);
      if (!setupOps.some((op) => op.id === state.activeOpId)) {
        state.activeOpId = null;
        state.renderer?.setActiveOperation?.(null);
      }

      _renderSidebar();
      viewerSyncPlaybackUi();

      if (typeof _setupChangeHandler === "function") {
        await _setupChangeHandler(newSetupId);
      }
    });
  }

  const list = document.getElementById("opList");
  if (!list) return;

  list.innerHTML = "";

  for (const op of ops) {
    const li = document.createElement("li");
    li.textContent = op.name || op.id;
    li.style.cursor = "pointer";
    li.style.marginBottom = "4px";

    if (state.activeOpId === op.id) {
      li.style.fontWeight = "600";
      li.style.color = "#ff5500";
    }

    li.addEventListener("click", () => {
      viewerSelectOp(op.id);
      _renderSidebar();
    });

    list.appendChild(li);
  }

  if (!ops.length) {
    const empty = document.createElement("div");
    empty.textContent = "No operations in this setup.";
    empty.style.opacity = "0.7";
    host.appendChild(empty);
  }
}

function _ensureViewportOverlay() {
  const viewport = document.getElementById("viewport");
  if (!viewport) return false;

  if (getComputedStyle(viewport).position === "static") {
    viewport.style.position = "relative";
  }

  let hudHost = document.getElementById("hudHost");
  if (!hudHost) {
    hudHost = document.createElement("div");
    hudHost.id = "hudHost";
    Object.assign(hudHost.style, {
      position: "absolute",
      top: "10px",
      right: "10px",
      zIndex: "60",
      pointerEvents: "none",
      opacity: "1",
      transition: "opacity 140ms ease",
    });
    viewport.appendChild(hudHost);
  }

  let hudRoot = document.getElementById("mifx-hud");
  if (!hudRoot) {
    hudRoot = document.createElement("div");
    hudRoot.id = "mifx-hud";
    Object.assign(hudRoot.style, {
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
    hudHost.appendChild(hudRoot);
  } else if (hudRoot.parentNode !== hudHost) {
    hudHost.appendChild(hudRoot);
  }

  hudMount(hudHost);

  let bar = document.getElementById("viewerControls");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "viewerControls";
    Object.assign(bar.style, {
      position: "absolute",
      left: "10px",
      right: "10px",
      bottom: "10px",
      zIndex: "70",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "8px",
      border: "1px solid #ddd",
      background: "rgba(255,255,255,0.92)",
      backdropFilter: "blur(2px)",
      borderRadius: "8px",
      pointerEvents: "auto",
    });

    bar.innerHTML = `
      <button id="btnWcs" title="Toggle WCS">WCS: ON</button>

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
    `;

    viewport.appendChild(bar);
  }

  return true;
}

function _renderHud() {
  const hudRoot = document.getElementById("mifx-hud");
  if (!hudRoot) return;

  const pb = state.playback || {};
  const opId = state.activeOpId || null;
  const step =
    Number.isFinite(pb._stepFloat) ? Math.round(pb._stepFloat) : Number(pb.stepIndex) || 0;

  const key = `${opId ?? "null"}:${step}`;
  if (key === _lastHudRenderKey) return;

  _lastHudRenderKey = key;

  const rows = hudBuildRows(opId, step);
  hudRoot.innerHTML = "";

  if (!rows.length) return;

  for (const r of rows) {
    const div = document.createElement("div");
    div.textContent = r.text;

    if (r.isCurrent) {
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

    hudRoot.appendChild(div);
  }
}

function _updateHudVisibility() {
  const hudHost = document.getElementById("hudHost");
  if (!hudHost) return;

  const pb = state.playback || {};
  const playing = !!pb.playing;
  const hasOp = !!state.activeOpId;
  const idleMs = _now() - (_lastHudActivity || 0);

  const shouldShow = hasOp && (playing || idleMs < HUD_IDLE_HIDE_MS);
  hudHost.style.opacity = shouldShow ? "1" : "0";
}

function _startHudLoop() {
  if (_hudLoop) return;

  _lastHudActivity = _now();

  _hudLoop = window.setInterval(() => {
    const pb = state.playback || {};
    const step = Number.isFinite(pb._stepFloat) ? pb._stepFloat : pb.stepIndex ?? 0;

    if (_lastSeenStep == null) _lastSeenStep = step;

    if (state.activeOpId && step !== _lastSeenStep) {
      _lastSeenStep = step;
      _touchHud();
      return;
    }

    if (pb.playing && state.activeOpId) {
      _lastHudActivity = _now();
    }

    _renderHud();
    _updateHudVisibility();
  }, 120);
}

function _wireControlsOnce() {
  const btnWcs = document.getElementById("btnWcs");
  _updateWcsBtn(btnWcs);

  btnWcs?.addEventListener("click", () => {
    const p = _ensurePreviewState();
    p.showWcs = !p.showWcs;
    _updateWcsBtn(btnWcs);
    _applyWcsToRenderer();
    _touchHud();
  });

  document.getElementById("viewSelect")?.addEventListener("change", (e) => {
    state.renderer?.setView?.(e.target.value || "iso");
    _touchHud();
  });

  document.getElementById("pbPlay")?.addEventListener("click", () => {
    playbackPlay();
    _touchHud();
  });
  document.getElementById("pbPause")?.addEventListener("click", () => {
    playbackPause();
    _touchHud();
  });
  document.getElementById("pbStop")?.addEventListener("click", () => {
    playbackStop();
    _touchHud();
  });
  document.getElementById("pbPrev")?.addEventListener("click", () => {
    playbackPrev();
    _touchHud();
  });
  document.getElementById("pbNext")?.addEventListener("click", () => {
    playbackNext();
    _touchHud();
  });

  document.getElementById("pbSpeed")?.addEventListener("change", (e) => {
    playbackSetSpeed(Number(e.target.value) || 1.0);
    _touchHud();
  });

  document.getElementById("pbScrub")?.addEventListener("input", (e) => {
    playbackSetStepFloat(Number(e.target.value));
    _touchHud();
  });

  _applyWcsToRenderer();
}

function _wireKeysOnce() {
  if (_keysInstalled) return;
  _keysInstalled = true;

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
        _touchHud();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        playbackNext();
        _touchHud();
      }
    },
    { passive: false }
  );
}

export function viewerMount(onSetupChange = null) {
  if (typeof onSetupChange === "function") {
    _setupChangeHandler = onSetupChange;
  }

  const setups = _getSetups();
  if (!state.activeSetupId && setups.length) {
    state.activeSetupId = setups[0].id;
  }

  _renderSidebar();

  const ok = _ensureViewportOverlay();
  if (!ok) return;

  if (!_installed) {
    _installed = true;
    _wireControlsOnce();
    _wireKeysOnce();
    _startHudLoop();
  } else {
    _applyWcsToRenderer();
    _updateWcsBtn(document.getElementById("btnWcs"));
  }

  _lastHudActivity = _now() - (HUD_IDLE_HIDE_MS - HUD_FORCE_SHOW_MS);
  _renderHud();
  _updateHudVisibility();
  viewerSyncPlaybackUi();
}

export function viewerSyncPlaybackUi() {
  _setPlaybackUiEnabled(!!state.activeOpId);
  _syncScrubRange();

  const speed = document.getElementById("pbSpeed");
  const pb = (state.playback ??= {});
  if (pb.speed == null) pb.speed = 1.0;
  if (speed) speed.value = String(pb.speed);

  _touchHud();
}

export function viewerSelectOp(opId) {
  state.activeOpId = opId || null;

  playbackResetForOpChange();
  state.renderer?.setActiveOperation?.(state.activeOpId);

  _lastSeenStep = null;
  _lastHudRenderKey = "";

  _lastHudActivity = _now();
  _renderHud();
  _updateHudVisibility();

  viewerSyncPlaybackUi();
  _renderSidebar();

  const scrub = document.getElementById("pbScrub");
  if (scrub) scrub.value = "0";
}