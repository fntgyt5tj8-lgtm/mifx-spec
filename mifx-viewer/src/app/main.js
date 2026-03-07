// src/app/main.js
import { loadPackage } from "./actions.js";
import { renderShell, renderLoaded } from "../ui/shell.js";
import { viewerMount } from "../ui/viewer.js";
import { ZipSource } from "../sources/zip_source.js";
import { state } from "./state.js";
import { ThreeRenderer } from "../render/three/three_renderer.js";

const root = document.getElementById("app");

renderShell(root);

root.addEventListener("dragover", (e) => {
  e.preventDefault();
});

function applyWcsFlagsToRenderer() {
  const r = state.renderer;
  if (!r) return;

  const p = state.preview || {};
  const payload = {
    showWcs: p.showWcs ?? true,
    showAxes: p.showAxes ?? true,
    showGrid: p.showGrid ?? false,
  };

  console.log("[app] applyWcsFlagsToRenderer ->", payload);
  r.setWcsVisibility?.(payload);
}

function clearActiveOpSelection() {
  state.activeOpId = null;
  state.renderer?.setActiveOperation?.(null);

  if (state.playback) {
    state.playback.playing = false;
    state.playback.stepIndex = 0;
    state.playback.t = 0;
    state.playback._stepFloat = 0;
  }

  const scrub = document.getElementById("pbScrub");
  if (scrub) scrub.value = "0";
}

async function refreshRendererForActiveSetup() {
  const job = state.job;
  if (!job || !state.renderer) return;

  const setup = (job.setups || []).find((s) => s.id === state.activeSetupId) || null;
  const opsForSetup = (state.operations || []).filter((op) => op.setupRef === state.activeSetupId);

  clearActiveOpSelection();

  await state.renderer.loadSetupGeometry(setup, state.source);
  await state.renderer.loadToolpaths(opsForSetup, state.source);

  state.renderer.setActiveOperation?.(null);

  // viewer overlay/hud may need a refresh after toolpaths/setup load
  viewerMount();
}

async function ensureRendererMounted() {
  const viewport = document.getElementById("viewport");
  if (!viewport) throw new Error("Missing #viewport in UI (renderLoaded must create it)");

  if (!state.renderer || state.renderer.host !== viewport) {
    if (state.renderer) {
      console.log("[app] viewport changed -> disposing old renderer");
      await state.renderer.dispose?.();
      state.renderer = null;
    }

    console.log("[app] mounting renderer on #viewport");
    state.renderer = new ThreeRenderer(viewport);
    await state.renderer.init();

    // ✅ re-assert viewer-owned overlay after renderer creates canvas
    viewerMount();

    const resize = () => {
      const r = state.renderer;
      if (!r) return;
      r.resize(viewport.clientWidth, viewport.clientHeight);
    };

    window.addEventListener("resize", resize);
    resize();

    applyWcsFlagsToRenderer();
  }

  try {
    state.renderer?.setTools?.(state.tools || []);
    console.log("[app] setTools ->", state.tools?.length || 0, "tools");
    console.log("[app] renderer _toolById size ->", state.renderer?._toolById?.size || 0);
  } catch (e) {
    console.warn("[app] setTools failed:", e);
  }

  window.__mifx = {
    state,
    get renderer() {
      return state.renderer;
    },
  };
  console.log("[debug] __mifx ready", window.__mifx);
}

root.addEventListener("drop", async (e) => {
  e.preventDefault();

  const file = e.dataTransfer.files[0];
  if (!file || !file.name.endsWith(".mifx")) {
    alert("Drop a .mifx file");
    return;
  }

  try {
    const source = await ZipSource.fromFile(file);
    await loadPackage(source);

    state.activeOpId = null;

    renderLoaded(root, async (newSetupId) => {
      state.activeSetupId = newSetupId;

      await ensureRendererMounted();
      applyWcsFlagsToRenderer();
      await refreshRendererForActiveSetup();
    });

    await ensureRendererMounted();
    applyWcsFlagsToRenderer();
    await refreshRendererForActiveSetup();
  } catch (err) {
    console.error(err);
    alert(String(err?.message || err));
  }
});