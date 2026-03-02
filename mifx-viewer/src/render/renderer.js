// src/render/renderer.js
// Engine-agnostic renderer interface.
// Any renderer (three, babylon, native bridge) can rely on this base behavior.

export class Renderer {
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = opts;

    // canonical WCS visibility state (engine-agnostic)
    this._wcsVisibility = {
      showWcs: true,
      showAxes: true,
      showGrid: false,
    };

    // canonical Setup CSYS visibility state (engine-agnostic)
    // (Actual rendering is engine-specific; this is just the stored intent.)
    this._setupCsysVisible = true;
  }

  async init() {}
  resize(w, h) {}
  clear() {}
  async dispose() {}

  async loadSetupGeometry(setup, source) {}
  async loadToolpaths(ops, source) {}

  setActiveOperation(opId) {
    if (typeof this.setActiveOperations === "function") {
      this.setActiveOperations(opId ? [opId] : []);
    }
  }

  setActiveOperations(opIds) {}

  /**
   * Playback controls.
   *
   * Preferred: stepIndex (integer index into motionPoints).
   * Optional: t in [0..1] (UI slider) — renderer may map to stepIndex.
   */
  setPlayback({ t, playing, opId, stepIndex } = {}) {}

  /**
   * Number of playback steps available for an op.
   * In our model: motionPoints.length
   */
  getPlaybackStepCount(opId) {
    return 0;
  }

  /**
   * Visibility toggles for typical scene layers.
   * Renderers may interpret "helpers" as WCS/grid/axes/markers, etc.
   */
  setVisibility({ stock, fixture, tool, toolpaths, helpers } = {}) {}

  /**
   * Explicit WCS controls (preferred over setVisibility.helpers for fine control).
   * - showWcs: master switch
   * - showAxes / showGrid: optional overrides
   *
   * Base class stores the state and (optionally) calls a concrete hook:
   *   this._applyWcsVisibility({ axesOn, gridOn })
   */
  setWcsVisibility({ showWcs, showAxes, showGrid } = {}) {
    const cur = this._wcsVisibility || { showWcs: true, showAxes: true, showGrid: false };

    const next = {
      showWcs: showWcs !== undefined ? !!showWcs : cur.showWcs,
      showAxes: showAxes !== undefined ? !!showAxes : cur.showAxes,
      showGrid: showGrid !== undefined ? !!showGrid : cur.showGrid,
    };

    this._wcsVisibility = next;

    // concrete renderer hook (optional)
    if (typeof this._applyWcsVisibility === "function") {
      const master = next.showWcs !== false;
      this._applyWcsVisibility({
        axesOn: master && next.showAxes !== false,
        gridOn: master && next.showGrid === true,
      });
    }
  }

  /**
   * Optional: expose current WCS visibility so UI can sync button state.
   */
  getWcsVisibility() {
    return this._wcsVisibility || { showWcs: true, showAxes: true, showGrid: false };
  }

  /**
   * Setup CSYS toggle intent.
   * ThreeRenderer implements setSetupCsysVisible(visible) and will apply immediately.
   * Other engines may ignore.
   */
  setSetupCsysVisibility(visible) {
    this._setupCsysVisible = !!visible;

    // concrete renderer hook (optional)
    if (typeof this.setSetupCsysVisible === "function") {
      this.setSetupCsysVisible(this._setupCsysVisible);
    }
  }

  /**
   * Optional: expose current Setup CSYS intent.
   */
  getSetupCsysVisibility() {
    return !!this._setupCsysVisible;
  }

  frameAll() {}
}