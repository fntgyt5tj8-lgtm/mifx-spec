export const state = {
  source: null,
  job: null,
  index: null,
  operations: [],
  activeSetupId: null,
  renderer: null,

  preview: {
    showWcs: true,
    showAxes: true,
    showGrid: false,
  },
};

// Debug/bridge for renderer modules that read window.state
if (typeof window !== "undefined") {
  window.state = state;
}