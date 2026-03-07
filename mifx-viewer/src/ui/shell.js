// src/ui/shell.js
import { state } from "../app/state.js";
import { renderIntent } from "./intent.js";
import { renderAnalytics } from "./analytics.js";
import { viewerMount, viewerSelectOp } from "./viewer.js";

let _keyHandlerInstalled = false;

export function renderShell(root) {
  root.innerHTML = `<div id="dropzone">Drop a .mifx file here</div>`;
}

export function renderLoaded(root, onSetupChange) {
  const job = state.job || {};
  const setups = job.setups || [];

  root.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100vh;">

      <!-- TOP BAR: minimal -->
      <div style="padding:10px;border-bottom:1px solid #ddd;display:flex;gap:10px;align-items:center;">

        <label>
          Setup:
          <select id="setupSelect"></select>
        </label>

        <label>
          Mode:
          <select id="modeSelect">
            <option value="viewer" selected>Viewer</option>
            <option value="intent">Intent</option>
            <option value="analytics">Analytics</option>
          </select>
        </label>

        <div style="flex:1"></div>
      </div>

      <!-- VIEWER MODE -->
      <div id="viewViewer" style="display:flex;flex:1;min-height:0;">
        <div style="width:300px;border-right:1px solid #ddd;padding:10px;overflow:auto;">
          <div><b>Operations</b></div>
          <ul id="opList" style="padding-left:16px;margin-top:8px;"></ul>
        </div>
        <div id="viewport" style="flex:1;min-width:0;position:relative;"></div>
      </div>

      <!-- INTENT MODE -->
      <div id="viewIntent" style="display:none;flex:1;overflow:auto;padding:20px;">
        <div id="intentRoot"></div>
      </div>

      <!-- ANALYTICS MODE -->
      <div id="viewAnalytics" style="display:none;flex:1;overflow:auto;padding:20px;">
        <div id="analyticsRoot"></div>
      </div>

    </div>
  `;

  // setup dropdown
  const select = document.getElementById("setupSelect");
  for (const s of setups) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name || s.id;
    select.appendChild(opt);
  }

  select.value = state.activeSetupId || (setups[0]?.id ?? "");
  select.addEventListener("change", (e) => onSetupChange(e.target.value));

  // viewer-owned overlay UI
  viewerMount();

  // ops list
  renderOps();

  // mode switching
  function showMode(mode) {
    const viewViewer = document.getElementById("viewViewer");
    const viewIntent = document.getElementById("viewIntent");
    const viewAnalytics = document.getElementById("viewAnalytics");

    if (!viewViewer || !viewIntent || !viewAnalytics) return;

    viewViewer.style.display = mode === "viewer" ? "flex" : "none";
    viewIntent.style.display = mode === "intent" ? "block" : "none";
    viewAnalytics.style.display = mode === "analytics" ? "block" : "none";

    if (mode === "viewer") {
      const vp = document.getElementById("viewport");
      if (vp && state.renderer) {
        state.renderer.resize(vp.clientWidth, vp.clientHeight);
      }
      viewerMount(); // re-assert overlay/hud host when coming back to viewer
    }

    if (mode === "intent") renderIntent();
    if (mode === "analytics") renderAnalytics();
  }

  const modeSelect = document.getElementById("modeSelect");
  modeSelect?.addEventListener("change", (e) => showMode(e.target.value || "viewer"));

  showMode("viewer");

  // keep key handler installed only once
  if (!_keyHandlerInstalled) {
    _keyHandlerInstalled = true;
    window.addEventListener(
      "keydown",
      (e) => {
        const tag = e.target?.tagName?.toLowerCase?.() || "";
        const typing = tag === "input" || tag === "select" || tag === "textarea";
        if (typing) return;

        if (!state.activeOpId) return;

        // viewer.js already handles arrows; keep this as harmless guard
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          // no-op
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

  const ops = (state.operations || []).filter((op) => op.setupRef === state.activeSetupId);

  for (const op of ops) {
    const li = document.createElement("li");
    li.textContent = op.name || op.id;
    li.style.cursor = "pointer";

    if (state.activeOpId === op.id) {
      li.style.fontWeight = "600";
      li.style.color = "#ff5500";
    }

    li.addEventListener("click", () => {
      viewerSelectOp(op.id);
      renderOps();
    });

    list.appendChild(li);
  }

  // if active op not in list, clear selection
  if (!ops.some((o) => o.id === state.activeOpId)) {
    state.activeOpId = null;
    state.renderer?.setActiveOperation?.(null);
    viewerMount();
  }
}