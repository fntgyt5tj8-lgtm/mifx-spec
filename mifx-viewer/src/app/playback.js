// src/app/playback.js
import { state } from "./state.js";

let raf = 0;
let lastTs = 0;

function _cancelRaf() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  lastTs = 0;
}

function _resetFloatStep(pb) {
  pb._stepFloat = Number.isInteger(pb.stepIndex) ? pb.stepIndex : 0;
}

function _getStepCount() {
  const r = state.renderer;
  const opId = state.activeOpId;
  if (!r || !opId) return 0;
  return Number(r.getPlaybackStepCount?.(opId)) || 0;
}

function _applyToRenderer() {
  const pb = (state.playback ??= {});
  const r = state.renderer;
  if (!r) return;

  r.setPlayback?.({
    playing: !!pb.playing,
    opId: state.activeOpId || null,
    stepIndex: Number.isInteger(pb.stepIndex) ? pb.stepIndex : 0,
    // optional future interpolation
    t: 0,
  });
}

function _syncScrubUI() {
  const pb = (state.playback ??= {});
  const scrub = document.getElementById("pbScrub");
  if (!scrub) return;

  const v = Number.isFinite(pb._stepFloat) ? pb._stepFloat : (pb.stepIndex ?? 0);
  scrub.value = String(v);
}

// ✅ NEW: scrub in STEP space (float)
export function playbackSetStepFloat(stepFloat) {
  const pb = (state.playback ??= {});
  const n = _getStepCount();

  const f = Number(stepFloat);
  if (!isFinite(f)) return;

  pb.playing = false;
  _cancelRaf();

  const max = Math.max(0, n - 1);
  const clamped = Math.max(0, Math.min(max, f));

  pb._stepFloat = clamped;
  pb.stepIndex = Math.floor(clamped);

  _applyToRenderer();
  _syncScrubUI();
}

export function playbackStop() {
  const pb = (state.playback ??= {});
  pb.playing = false;

  pb.stepIndex = 0;
  _resetFloatStep(pb);

  _cancelRaf();
  _applyToRenderer();
  _syncScrubUI();
}

export function playbackPause() {
  const pb = (state.playback ??= {});
  pb.playing = false;

  _cancelRaf();
  _resetFloatStep(pb);
  _applyToRenderer();
  _syncScrubUI();
}

export function playbackPlay() {
  const pb = (state.playback ??= {});
  pb.playing = true;

  if (pb.speed == null) pb.speed = 1.0;
  if (pb.stepsPerSec == null) pb.stepsPerSec = 60;

  _resetFloatStep(pb);

  _cancelRaf();
  raf = requestAnimationFrame(tick);
}

export function playbackSetSpeed(speed) {
  const pb = (state.playback ??= {});
  const s = Number(speed);
  pb.speed = isFinite(s) && s > 0 ? s : 1.0;
}

export function playbackStep(dir, nSteps = 1) {
  const pb = (state.playback ??= {});
  pb.playing = false;
  _cancelRaf();

  const n = _getStepCount();
  const max = Math.max(0, n - 1);

  const cur = Number.isInteger(pb.stepIndex) ? pb.stepIndex : 0;
  const d = (dir < 0 ? -1 : 1) * Math.max(1, nSteps | 0);

  const next = Math.max(0, Math.min(max, cur + d));
  pb.stepIndex = next;
  pb._stepFloat = next;

  _applyToRenderer();
  _syncScrubUI();
}

export function playbackPrev() { playbackStep(-1, 1); }
export function playbackNext() { playbackStep(+1, 1); }

export function playbackResetForOpChange() {
  const pb = (state.playback ??= {});
  pb.playing = false;
  _cancelRaf();

  pb.stepIndex = 0;
  pb._stepFloat = 0;

  _applyToRenderer();
  _syncScrubUI();
}

function tick(ts) {
  const pb = (state.playback ??= {});
  if (!pb.playing) return;

  const opId = state.activeOpId;
  if (!opId) {
    playbackPause();
    return;
  }

  const n = _getStepCount();
  if (!n || n < 1) {
    playbackPause();
    return;
  }

  if (!lastTs) lastTs = ts;
  const dt = Math.max(0, (ts - lastTs) / 1000);
  lastTs = ts;

  const sps = (pb.stepsPerSec ?? 60) * (pb.speed ?? 1.0);

  const stepFloat = Number.isFinite(pb._stepFloat)
    ? pb._stepFloat
    : (Number.isInteger(pb.stepIndex) ? pb.stepIndex : 0);

  const nextFloat = stepFloat + dt * sps;
  pb._stepFloat = nextFloat;

  const nextIdx = Math.max(0, Math.min(n - 1, Math.floor(nextFloat)));
  pb.stepIndex = nextIdx;

  _applyToRenderer();
  _syncScrubUI();

  if (nextIdx >= n - 1) {
    pb.playing = false;
    _cancelRaf();
    _resetFloatStep(pb);
    _applyToRenderer();
    _syncScrubUI();
    return;
  }

  raf = requestAnimationFrame(tick);
}