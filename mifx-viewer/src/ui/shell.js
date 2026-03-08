// src/ui/shell.js
import { renderIntent } from "./intent.js";
import { renderAnalytics } from "./analytics.js";
import { viewerMount } from "./viewer.js";

let _keyHandlerInstalled = false;

export function renderShell(root) {
  root.innerHTML = `<div id="dropzone">Drop a .mifx file here</div>`;
}

export function renderLoaded(root, onSetupChange) {
  root.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100vh;">

      <div style="padding:10px;border-bottom:1px solid #ddd;display:flex;gap:10px;align-items:center;">
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

      <div id="viewViewer" style="display:flex;flex:1;min-height:0;">
        <div
          id="viewerSidebar"
          style="width:320px;min-width:320px;border-right:1px solid #ddd;padding:10px;overflow:auto;display:block;background:#fff;"
        ></div>
        <div
          id="viewport"
          style="flex:1;min-width:0;position:relative;display:block;"
        ></div>
      </div>

      <div id="viewIntent" style="display:none;flex:1;overflow:auto;padding:20px;">
        <div id="intentRoot"></div>
      </div>

      <div id="viewAnalytics" style="display:none;flex:1;overflow:auto;padding:20px;">
        <div id="analyticsRoot"></div>
      </div>
    </div>
  `;

  function showMode(mode) {
    const viewViewer = document.getElementById("viewViewer");
    const viewIntent = document.getElementById("viewIntent");
    const viewAnalytics = document.getElementById("viewAnalytics");

    if (!viewViewer || !viewIntent || !viewAnalytics) return;

    viewViewer.style.display = mode === "viewer" ? "flex" : "none";
    viewIntent.style.display = mode === "intent" ? "block" : "none";
    viewAnalytics.style.display = mode === "analytics" ? "block" : "none";

    if (mode === "viewer") {
      viewerMount(onSetupChange);
    } else if (mode === "intent") {
      renderIntent();
    } else if (mode === "analytics") {
      renderAnalytics();
    }
  }

  const modeSelect = document.getElementById("modeSelect");
  modeSelect?.addEventListener("change", (e) => showMode(e.target.value || "viewer"));

  showMode("viewer");

  if (!_keyHandlerInstalled) {
    _keyHandlerInstalled = true;
    window.addEventListener(
      "keydown",
      () => {
        // viewer.js owns actual viewer keyboard handling
      },
      { passive: false }
    );
  }
}