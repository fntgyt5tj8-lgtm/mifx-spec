// src/render/three/features/toolpath.js
// Feature: fatline toolpaths + playback integration + HUD timeline integration
// - Rendering only (Line2 segments) + selection visibility
// - Marker is delegated to ctx.marker (marker.js owns meshes)
// - Scene canonical units = MM (we scale points using scaleToMM(units))

import { scaleToMM } from "/src/render/three/util/units.js";

export function installToolpaths(ctx) {
  const THREE = ctx.THREE;
  const host = ctx.host;
  const grpToolpaths = ctx.groups?.toolpaths;
  const camera = () => ctx.camera;

  const loadToolpathsForOps = ctx.loadToolpathsForOps; // (source, ops) => parsedMap
  const buildHudTimelineFromParsed = ctx.buildHudTimelineFromParsed; // ({opId,motionPoints,events}) => timeline[]
  const hud = ctx.hud || {};
  const marker = ctx.marker || null;

  function _clamp01(x) {
    x = Number(x);
    if (!isFinite(x)) x = 0;
    return Math.max(0, Math.min(1, x));
  }

  const MOTION_STYLE = {
    RAPID: { color: 0x9aa0a6, width: 2.0, opacity: 1.0 },
    FEED: { color: 0x00c2ff, width: 2.4, opacity: 1.0 },
    ARC: { color: 0x0066ff, width: 2.6, opacity: 1.0 },
    HELIX: { color: 0x35d07f, width: 2.8, opacity: 1.0 },
    PLUNGE: { color: 0xff3b30, width: 3.0, opacity: 1.0 },
    RETRACT: { color: 0xffd60a, width: 3.0, opacity: 1.0 },
    CYCLE_TRAVEL: { color: 0xb0b7c3, width: 2.0, opacity: 0.9 },
    DEFAULT: { color: 0xffffff, width: 2.0, opacity: 1.0 },
  };

  function _applyMotionStyle(line2, motion) {
    const key = String(motion || "DEFAULT").toUpperCase();
    const s = MOTION_STYLE[key] || MOTION_STYLE.DEFAULT;

    line2.material.color.setHex(s.color);
    line2.material.linewidth = s.width;

    line2.userData._baseMat = {
      opacity: s.opacity,
      transparent: s.opacity < 1.0,
    };

    if (s.opacity < 1.0) {
      line2.material.transparent = true;
      line2.material.opacity = s.opacity;
    } else {
      line2.material.transparent = false;
      line2.material.opacity = 1.0;
    }

    line2.material.needsUpdate = true;
  }

  function _normalizeRenderPoints(renderPoints) {
    return (renderPoints || [])
      .map((p) => ({
        x: Number(p?.x),
        y: Number(p?.y),
        z: Number(p?.z),
        motion: p?.motion != null ? String(p.motion).toUpperCase() : "FEED",
      }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
  }

  function _buildMotionSegments(points, eps = 1e-9) {
    if (!Array.isArray(points) || points.length < 2) return [];

    const samePoint = (a, b) => {
      const dx = a.x - b.x,
        dy = a.y - b.y,
        dz = a.z - b.z;
      return dx * dx + dy * dy + dz * dz <= eps * eps;
    };

    const segments = [];
    let cur = null;
    let prevPt = null;
    let prevMotion = null;

    for (const p of points) {
      const motion = String(p.motion || "FEED").toUpperCase();
      const pt = { x: p.x, y: p.y, z: p.z, motion };

      const motionChanged = !cur || motion !== prevMotion;
      if (motionChanged) {
        cur = { motion, points: [] };
        segments.push(cur);
        if (prevPt) cur.points.push({ ...prevPt });
      }

      const n = cur.points.length;
      if (n === 0 || !samePoint(cur.points[n - 1], pt)) cur.points.push(pt);

      prevPt = pt;
      prevMotion = motion;
    }

    const out = [];
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      if (s.points.length >= 2) {
        out.push(s);
        continue;
      }

      const lone = s.points[0];
      const prev = out[out.length - 1];
      const next = segments[i + 1];

      if (prev && lone && !samePoint(prev.points[prev.points.length - 1], lone)) {
        prev.points.push(lone);
      } else if (next && lone) {
        if (!next.points.length || !samePoint(lone, next.points[0])) next.points.unshift(lone);
      }
    }

    return out.filter((s) => s.points.length >= 2);
  }

  function _makeLine2FromPoints(points, w, h) {
    if (!Array.isArray(points) || points.length < 2) return null;

    const Line2 = ctx.Line2;
    const LineMaterial = ctx.LineMaterial;
    const LineGeometry = ctx.LineGeometry;

    if (!Line2 || !LineMaterial || !LineGeometry) {
      throw new Error("Toolpaths feature requires Line2/LineMaterial/LineGeometry in ctx.");
    }

    const positions = new Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      positions[i * 3 + 0] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
    }

    const geom = new LineGeometry();
    geom.setPositions(positions);

    const mat = new LineMaterial({
      color: 0xffffff,
      linewidth: 2.0,
      transparent: false,
      opacity: 1.0,
      depthTest: false,
      depthWrite: false,
    });

    mat.resolution.set(w || 1, h || 1);

    const line = new Line2(geom, mat);
    line.computeLineDistances();
    line.frustumCulled = false;
    line.renderOrder = 999;
    return line;
  }

  let fatLines = [];

  const play = {
    t: 0,
    playing: false,
    opId: null,
    pose: null, // { pos: THREE.Vector3 } in MM
    byOp: new Map(),
  };

  function _clearGroup(group) {
    if (!group) return;
    for (let i = group.children.length - 1; i >= 0; i--) {
      const obj = group.children[i];
      group.remove(obj);
      obj.traverse?.((n) => {
        n.geometry?.dispose?.();
        if (n.material) {
          if (Array.isArray(n.material)) n.material.forEach((m) => m.dispose?.());
          else n.material.dispose?.();
        }
      });
    }
  }

  function _applySelectionVisibility() {
    const active = play?.opId || null;
    for (const child of grpToolpaths.children) {
      const id = child.userData?.opId;
      child.visible = active ? id === active : false;
    }
  }

  function _applyDimming() {
    const dimMul = play.playing ? 0.35 : 1.0;

    grpToolpaths.traverse((o) => {
      const mat = o?.material;
      if (!mat) return;

      const base = o.userData?._baseMat || null;
      const baseOpacity = base ? Number(base.opacity) : 1.0;
      const baseTransparent = base ? !!base.transparent : false;

      const nextOpacity = Math.max(0, Math.min(1, baseOpacity * dimMul));
      const needTrans = nextOpacity < 1.0 ? true : baseTransparent;

      mat.opacity = nextOpacity;
      mat.transparent = needTrans;
      mat.needsUpdate = true;
    });
  }

  function clear() {
    _clearGroup(grpToolpaths);

    play.byOp = new Map();
    play.opId = null;
    play.t = 0;
    play.playing = false;
    play.pose = null;

    fatLines = [];

    marker?.clearTool?.();
    marker?.hide?.();
    hud.hudClear?.();
  }

  function resize(w, h) {
    for (const l of fatLines) {
      if (l?.material?.resolution) l.material.resolution.set(w, h);
    }
  }

  async function load(ops, source) {
    _clearGroup(grpToolpaths);
    play.byOp = new Map();
    fatLines = [];

    play.opId = null;
    play.playing = false;
    play.t = 0;
    play.pose = null;

    hud.hudClear?.();
    marker?.clearTool?.();
    marker?.hide?.();

    if (!ops?.length) {
      _applySelectionVisibility();
      return;
    }

    if (typeof loadToolpathsForOps !== "function") {
      throw new Error("Toolpaths feature requires ctx.loadToolpathsForOps(source, ops).");
    }

    const parsedMap = await loadToolpathsForOps(source, ops);

    for (const op of ops) {
      const parsed = parsedMap.get(op.id);
      if (!parsed) continue;

      const motionPoints = Array.isArray(parsed.motionPoints) ? parsed.motionPoints : [];
      const renderPts =
        Array.isArray(parsed.renderPoints) && parsed.renderPoints.length
          ? parsed.renderPoints
          : Array.isArray(parsed.flatPoints) && parsed.flatPoints.length
            ? parsed.flatPoints
            : [];

      if (renderPts.length < 2 && motionPoints.length < 2) continue;

      play.byOp.set(op.id, {
        motionPoints,
        renderPoints: renderPts,
        events: Array.isArray(parsed.events) ? parsed.events : [],
        units: parsed.units,
      });

      if (typeof buildHudTimelineFromParsed === "function" && motionPoints.length >= 1) {
        const timeline = buildHudTimelineFromParsed({
          opId: op.id,
          motionPoints,
          events: parsed.events,
        });

        if (Array.isArray(timeline) && timeline.length) {
          hud.hudRegisterTimeline?.(op.id, timeline, timeline.length);
        }
      }

      const ptsToDrawRaw = renderPts.length ? renderPts : motionPoints;
      const ptsNorm = _normalizeRenderPoints(ptsToDrawRaw);
      if (ptsNorm.length < 2) continue;

      const s = scaleToMM(parsed.units);
      const ptsScaled = ptsNorm.map((p) => ({
        x: p.x * s,
        y: p.y * s,
        z: p.z * s,
        motion: p.motion,
      }));

      const segments = _buildMotionSegments(ptsScaled);

      const w = host?.clientWidth || window.innerWidth;
      const h = host?.clientHeight || window.innerHeight;

      for (const seg of segments) {
        const line2 = _makeLine2FromPoints(seg.points, w, h);
        if (!line2) continue;

        _applyMotionStyle(line2, seg.motion);
        line2.name = `tp_${op.id}_${seg.motion}`;
        line2.userData = { ...(line2.userData || {}), opId: op.id, motion: seg.motion };
        grpToolpaths.add(line2);
        fatLines.push(line2);
      }
    }

    _applySelectionVisibility();
    marker?.clearTool?.();
    marker?.hide?.();
    _applyDimming();
  }

  function getPlaybackStepCount(opId) {
    const rec = play.byOp.get(opId);
    return rec?.motionPoints?.length || 0;
  }

  function getPlaybackPose() {
    if (!play.pose) return null;
    return { pos: play.pose.pos.clone() };
  }

  function setPlayback({ t, playing, opId, stepIndex } = {}) {
    const useId = typeof opId !== "undefined" ? (opId || null) : (play.opId || null);
    if (!useId) {
      marker?.hide?.();
      return;
    }

    if (typeof playing === "boolean") play.playing = playing;
    if (typeof opId !== "undefined") play.opId = opId || null;

    const rec = play.byOp.get(useId);
    const pts = rec?.motionPoints || null;

    if (!pts || pts.length < 1) {
      marker?.hide?.();
      play.pose = null;
      return;
    }

    const n = pts.length;
    let idx;

    if (Number.isInteger(stepIndex)) {
      idx = Math.max(0, Math.min(n - 1, stepIndex));
      play.t = n <= 1 ? 0 : idx / (n - 1);
    } else {
      const tt = typeof t === "number" ? _clamp01(t) : _clamp01(play.t ?? 0);
      play.t = tt;
      idx = Math.max(0, Math.min(n - 1, Math.floor(tt * (n - 1))));
    }

    const p = pts[idx];
    const s = scaleToMM(rec.units);

    const pos = new THREE.Vector3(
      (p.x || 0) * s,
      (p.y || 0) * s,
      (p.z || 0) * s
    );

    play.pose = { pos };

    // ---------------------------------------------------
    // 🔥 TOOL AXIS EXTRACTION (robust)
    // Accepts numbers OR numeric strings.
    // Tries common locations:
    //   p.toolAxis = {i,j,k}
    //   p.axis = {i,j,k}
    //   p.hud.toolAxis = {i,j,k}
    //   p.hud.taxis = {i,j,k}
    //   p.i/p.j/p.k
    // ---------------------------------------------------
    function _axisFrom(obj) {
      if (!obj) return null;
      const i = Number(obj.i);
      const j = Number(obj.j);
      const k = Number(obj.k);
      if (!Number.isFinite(i) || !Number.isFinite(j) || !Number.isFinite(k)) return null;
      return { i, j, k };
    }

    let axis =
      _axisFrom(p?.toolAxis) ||
      _axisFrom(p?.axis) ||
      _axisFrom(p?.hud?.toolAxis) ||
      _axisFrom(p?.hud?.taxis) ||
      _axisFrom(p?.hud?.tool_axis) || // in case snake_case
      null;

    if (!axis) {
      const i = Number(p?.i);
      const j = Number(p?.j);
      const k = Number(p?.k);
      if (Number.isFinite(i) && Number.isFinite(j) && Number.isFinite(k)) {
        axis = { i, j, k };
      }
    }

    if (axis) {
      marker?.setToolAxis?.(axis);
    } else {
      marker?.clearToolAxis?.();
    }

    // ---------------------------------------------------
    // Move marker/tool
    // ---------------------------------------------------
    marker?.setPosition?.(pos, {
      cameraFacing: true,
      autoScale: true,
    });

    // Keep halo facing camera if fallback is active
    const cam = camera();
    if (cam && marker?._debug?.halo) {
      marker._debug.halo.lookAt(cam.position);
    }

    hud.hudSetFromTimeline?.(useId, idx);
    _applyDimming();
  }

  function setActiveOperation(opId) {
    const active = opId || null;

    play.opId = active;
    play.t = 0;
    play.playing = false;
    play.pose = null;

    _applySelectionVisibility();

    if (!active) {
      marker?.clearTool?.();
      marker?.hide?.();
      _applyDimming();
      return;
    }

    // IMPORTANT:
    // Tool geometry selection comes from renderer.setActiveOperation()
    // Toolpath only drives pose + tool axis from motion points.
    setPlayback({ opId: active, playing: false, stepIndex: 0 });
  }

  return {
    load,
    clear,
    resize,
    getPlaybackStepCount,
    getPlaybackPose,
    setPlayback,
    setActiveOperation,
    _state: { play },
  };
}