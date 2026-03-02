// toolpath_apt.js — APT/CL reader (global API)
//
// Backwards compatible:
//   - window.parseAptGotoPoints(text) => flat decimated [{x,y,z}, ...]
//
// Minimal API (clean):
//   - window.parseAptCl(text) => {
//       units,
//       flatPoints,
//       motionPoints,   // truth points for marker/playback + apt line mapping
//       renderPoints,   // pretty polyline (tessellated arcs)
//       events: []      // kept only for legacy callers; always empty
//     }
//
// Supported:
// - FROM treated as GOTO
// - TLAXIS modal (TLAXIS/i,j,k) (used only for motion classification)
// - CYCLE modal (CYCLE/..., CYCLE/OFF) (expanded into travel/plunge/retract points)
// - MOVARC (APT): MOVARC/centerXYZ, axisIJK, r, ANGLE, aDeg
// - CIRCLE (Creo/general): CIRCLE/centerXYZ, axisIJK, r [, ... , ANGLE,deg]
//
// Creo hardening:
// - Accept "WORD / ..." (spaces around slash)
// - Handle "$" continuation lines (join physical lines into one logical record)
// - Ignore "$$" comment lines
//
// HUD policy (new):
// - Each motion point carries the single APT logical record that produced it:
//     p.apt  -> string
//     p.n    -> logical line index (0-based)
// - Use hud.js to display a 5-line window around current point.
//
// Rendering policy:
// - motionPoints remain sparse; arc payload attaches to the END motion point
// - renderPoints are tessellated for display
(function () {
  function num(s) {
    const v = Number(String(s).trim());
    return Number.isFinite(v) ? v : null;
  }

  function splitCsvArgs(argStr) {
    return String(argStr || "")
      .split(",")
      .map((p) => p.trim())
      .filter((x) => x.length > 0);
  }

  function parseXYZIJKFromArgs(argStr) {
    const parts = splitCsvArgs(argStr);
    if (parts.length < 3) return null;

    const x = num(parts[0]);
    const y = num(parts[1]);
    const z = num(parts[2]);
    if (x === null || y === null || z === null) return null;

    let i = null,
      j = null,
      k = null;
    if (parts.length >= 6) {
      i = num(parts[3]);
      j = num(parts[4]);
      k = num(parts[5]);
      if (i === null || j === null || k === null) i = j = k = null;
    }
    return { x, y, z, i, j, k };
  }

  function decimatePoints(points, eps = 1e-8) {
    if (!points || points.length < 2) return points || [];
    const out = [points[0]];
    let last = points[0];

    for (let idx = 1; idx < points.length; idx++) {
      const p = points[idx];
      const dx = p.x - last.x,
        dy = p.y - last.y,
        dz = p.z - last.z;
      if (dx * dx + dy * dy + dz * dz > eps * eps) {
        out.push(p);
        last = p;
      }
    }
    return out;
  }

  function isWordToken(tok) {
    return /^[A-Z_][A-Z0-9_]*$/i.test(tok);
  }

  // -------------------------
  // Creo-style continuation + comment handling
  // -------------------------
  function _preprocessCreoLines(text) {
    const rawLines = String(text || "").split(/\r?\n/);
    const out = [];

    let buf = "";

    function flush() {
      const s = buf.trim();
      if (s) out.push(s);
      buf = "";
    }

    for (let i = 0; i < rawLines.length; i++) {
      const raw = String(rawLines[i] || "");
      const t = raw.trim();
      if (!t) continue;

      // Ignore Pro/CL comments ($$...)
      if (t.startsWith("$$")) continue;

      // '$' continuation when only whitespace follows it
      const dollarIdx = raw.indexOf("$");
      let linePart = raw;

      let isContinuation = false;
      if (dollarIdx >= 0) {
        const after = raw.slice(dollarIdx + 1);
        if (/^\s*$/.test(after)) {
          linePart = raw.slice(0, dollarIdx);
          isContinuation = true;
        } else {
          linePart = raw;
        }
      }

      const cleaned = String(linePart).replace(/\s+/g, " ").trim();
      if (!cleaned) {
        if (!isContinuation) flush();
        continue;
      }

      if (buf) buf += " " + cleaned;
      else buf = cleaned;

      if (!isContinuation) flush();
    }

    flush();
    return out;
  }

  // -------------------------
  // Vector helpers (no THREE)
  // -------------------------
  function v3(x, y, z) {
    return { x, y, z };
  }
  function add(a, b) {
    return v3(a.x + b.x, a.y + b.y, a.z + b.z);
  }
  function sub(a, b) {
    return v3(a.x - b.x, a.y - b.y, a.z - b.z);
  }
  function mul(a, s) {
    return v3(a.x * s, a.y * s, a.z * s);
  }
  function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }
  function cross(a, b) {
    return v3(
      a.y * b.z - a.z * b.y,
      a.z * b.x - a.x * b.z,
      a.x * b.y - a.y * b.x
    );
  }
  function len(a) {
    return Math.sqrt(dot(a, a));
  }
  function norm(a) {
    const l = len(a);
    return l > 0 ? mul(a, 1 / l) : v3(0, 0, 0);
  }
  function deg2rad(d) {
    return (d * Math.PI) / 180;
  }

  function rotateAroundAxis(v, kUnit, theta) {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const term1 = mul(v, c);
    const term2 = mul(cross(kUnit, v), s);
    const term3 = mul(kUnit, dot(kUnit, v) * (1 - c));
    return add(add(term1, term2), term3);
  }

  function signedAngleAroundAxis(center, axis, startPt, endPt) {
    const kUnit = norm(axis);
    const S = v3(startPt.x, startPt.y, startPt.z);
    const E = v3(endPt.x, endPt.y, endPt.z);

    let rS = sub(S, center);
    let rE = sub(E, center);

    // project into plane normal to axis
    rS = sub(rS, mul(kUnit, dot(kUnit, rS)));
    rE = sub(rE, mul(kUnit, dot(kUnit, rE)));

    const ls = len(rS),
      le = len(rE);
    if (ls === 0 || le === 0) return 0;

    const u = norm(rS);
    const v = norm(cross(kUnit, u));

    const x = dot(rE, u);
    const y = dot(rE, v);
    return Math.atan2(y, x);
  }

  function chooseSweepRadByBestFit(center, axis, startPt, endPt, angleDeg) {
    const kUnit = norm(axis);
    const aAbs = Math.abs(deg2rad(Number(angleDeg) || 0));
    if (!Number.isFinite(aAbs) || aAbs <= 0) return 0;

    const preferredSign = Number(angleDeg) < 0 ? -1 : 0;

    const C = v3(center.x, center.y, center.z);
    const S = v3(startPt.x, startPt.y, startPt.z);
    const E = v3(endPt.x, endPt.y, endPt.z);

    const sAx = dot(sub(S, C), kUnit);
    const eAx = dot(sub(E, C), kUnit);

    const rS = sub(sub(S, C), mul(kUnit, sAx));

    function errFor(sign) {
      const theta = sign * aAbs;
      const rPred = rotateAroundAxis(rS, kUnit, theta);
      const ax = eAx;
      const p = add(C, add(rPred, mul(kUnit, ax)));
      const dx = p.x - E.x,
        dy = p.y - E.y,
        dz = p.z - E.z;
      return dx * dx + dy * dy + dz * dz;
    }

    const ePlus = errFor(+1);
    const eMinus = errFor(-1);

    let sign = ePlus <= eMinus ? +1 : -1;

    if (preferredSign !== 0) {
      const chosenErr = sign === +1 ? ePlus : eMinus;
      const prefErr = preferredSign === +1 ? ePlus : eMinus;
      if (prefErr <= chosenErr * 1.01) sign = preferredSign;
    }

    return sign * aAbs;
  }

  function tessellateArc(startPt, arcDef, endPt, maxStepDeg = 5) {
    const C = arcDef.center;
    const kUnit = norm(arcDef.axis);

    const S = v3(startPt.x, startPt.y, startPt.z);
    const E = v3(endPt.x, endPt.y, endPt.z);

    const CS = sub(S, C);
    const CE = sub(E, C);

    const sAx = dot(CS, kUnit);
    const eAx = dot(CE, kUnit);

    const rS = sub(CS, mul(kUnit, sAx));
    const rE = sub(CE, mul(kUnit, eAx));

    const rSlen = len(rS),
      rElen = len(rE);
    if (rSlen === 0 || rElen === 0) return [];

    let sweep = Number(arcDef.sweepRad);
    if (!Number.isFinite(sweep)) {
      sweep = signedAngleAroundAxis(C, arcDef.axis, startPt, endPt);
    }

    const sweepDeg = Math.abs((sweep * 180) / Math.PI);
    const steps = Math.max(2, Math.ceil(sweepDeg / maxStepDeg));
    const pts = [];

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;

      const theta = sweep * t;
      const rRot = rotateAroundAxis(rS, kUnit, theta);

      const ax = (1 - t) * sAx + t * eAx;
      const axVec = mul(kUnit, ax);

      const P = add(C, add(rRot, axVec));
      pts.push({ x: P.x, y: P.y, z: P.z });
    }

    pts[pts.length - 1] = { x: endPt.x, y: endPt.y, z: endPt.z };
    return pts;
  }

  // ---------------------------------------------------------
  // Linear motion classification (tool-axis aware; fallback to world Z)
  // ---------------------------------------------------------
  function classifyLinearMotion(prev, next, baseMotion, toolAxis, opts = {}) {
    const m = String(baseMotion || "FEED").toUpperCase();
    if (!prev || !next) return m;

    // Only classify feed-like moves; RAPID stays RAPID
    if (m !== "FEED") return m;

    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const dz = next.z - prev.z;

    const dist2 = dx * dx + dy * dy + dz * dz;
    if (dist2 <= 0) return "FEED";

    const dist = Math.sqrt(dist2);

    const eps = Number.isFinite(opts.eps) ? opts.eps : 1e-6;
    const kDom = Number.isFinite(opts.kDom) ? opts.kDom : 2.0;

    const hasAxis =
      toolAxis &&
      Number.isFinite(toolAxis.i) &&
      Number.isFinite(toolAxis.j) &&
      Number.isFinite(toolAxis.k);

    if (hasAxis) {
      const u = norm(v3(toolAxis.i, toolAxis.j, toolAxis.k));
      const d = v3(dx, dy, dz);

      const along = dot(d, u);
      const alongAbs = Math.abs(along);

      const perp2 = Math.max(0, dist2 - along * along);
      const perp = Math.sqrt(perp2);

      if (alongAbs > eps && alongAbs > kDom * perp) {
        return along < 0 ? "PLUNGE" : "RETRACT";
      }
      return "FEED";
    }

    // Fallback: world-Z heuristic
    const zDominance = Number.isFinite(opts.zDominance) ? opts.zDominance : 0.85;
    const minDz = Number.isFinite(opts.minDz) ? opts.minDz : 1e-6;

    const adz = Math.abs(dz);
    if (adz < minDz) return "FEED";
    const zRatio = adz / dist;
    if (zRatio < zDominance) return "FEED";

    return dz < 0 ? "PLUNGE" : "RETRACT";
  }

  // -------------------------
  // TLAXIS parsing (modal)
  // -------------------------
  function parseTlaxisLine(line) {
    const m = line.match(/^TLAXIS\s*\/\s*(.+)$/i);
    if (!m) return null;
    const toks = splitCsvArgs(m[1]);
    if (toks.length < 3) return null;
    const i = num(toks[0]);
    const j = num(toks[1]);
    const k = num(toks[2]);
    if ([i, j, k].some((v) => v === null)) return null;
    return { i, j, k, raw: line };
  }

  // -------------------------
  // CYCLE parsing (minimal)
  // -------------------------
  const FEED_MODES = new Set(["IPM", "IPR", "MMPR", "MMPM"]);

  function normalizeCycle(cycle) {
    const out = { ...cycle, norm: null };
    if (!cycle || !cycle.type || !cycle.params) return out;

    const type = String(cycle.type).toUpperCase();
    const p = cycle.params || {};
    const pos = Array.isArray(p._pos) ? p._pos.filter((v) => typeof v === "number") : [];
    const mode = p.FEED_MODE || null;

    if (pos.length >= 3 && mode) {
      out.norm = {
        kind: type,
        depthOrStep: pos[0],
        feed: pos[1],
        clearance: pos[2],
        feedMode: mode,
        rapto: typeof p.RAPTO === "number" ? p.RAPTO : null,
      };
    }
    return out;
  }

  function getCycleTravelZ(activeCycle, holeZ) {
    if (!activeCycle) return holeZ;

    let c = null;
    if (activeCycle.norm && typeof activeCycle.norm.clearance === "number") c = activeCycle.norm.clearance;
    else {
      const p = activeCycle.params || {};
      const pos = Array.isArray(p._pos) ? p._pos : [];
      if (typeof pos[2] === "number") c = pos[2];
    }
    if (typeof c !== "number") return holeZ;
    return holeZ + c;
  }

  function parseCycleLine(line) {
    const m = line.match(/^CYCLE\s*\/\s*(.+)$/i);
    if (!m) return null;

    const rhs = m[1].trim();
    if (/^OFF\b/i.test(rhs)) return { kind: "CYCLE_OFF" };

    const firstComma = rhs.indexOf(",");
    const type = (firstComma >= 0 ? rhs.slice(0, firstComma) : rhs).trim().toUpperCase();
    const rest = (firstComma >= 0 ? rhs.slice(firstComma + 1) : "").trim();

    const tokens = splitCsvArgs(rest);
    const params = { _pos: [] };

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (!t) continue;

      if (isWordToken(t)) {
        const key = t.toUpperCase();

        if (FEED_MODES.has(key)) {
          params.FEED_MODE = key;
          continue;
        }

        const next = tokens[i + 1];
        const nv = next != null ? num(next) : null;
        if (nv !== null) {
          params[key] = nv;
          i++;
        } else {
          params[key] = true;
        }
      } else {
        const v = num(t);
        if (v !== null) params._pos.push(v);
        else params._pos.push(t);
      }
    }

    const cycleObj = normalizeCycle({ type, params, raw: line });
    return { kind: "CYCLE_ON", cycle: cycleObj };
  }

  // -------------------------
  // Arc line parsers
  // -------------------------
  function parseMovarcLine(line) {
    const m = line.match(/^MOVARC\s*\/\s*(.+)$/i);
    if (!m) return null;

    const toks = splitCsvArgs(m[1]).filter((t) => String(t).toUpperCase() !== "ANGLE");
    if (toks.length < 8) return null;

    const cx = num(toks[0]),
      cy = num(toks[1]),
      cz = num(toks[2]);
    const i = num(toks[3]),
      j = num(toks[4]),
      k = num(toks[5]);
    const r = num(toks[6]);
    const aDeg = num(toks[7]);

    if ([cx, cy, cz, i, j, k, r, aDeg].some((v) => v === null)) return null;

    return {
      kind: "MOVARC",
      center: v3(cx, cy, cz),
      axis: v3(i, j, k),
      radius: r,
      angleDeg: aDeg,
      raw: line,
    };
  }

  function parseCircleLine(line) {
    const m = line.match(/^CIRCLE\s*\/\s*(.+)$/i);
    if (!m) return null;

    const toks = splitCsvArgs(m[1]);

    let angleDegExplicit = null;
    for (let i = 0; i < toks.length; i++) {
      if (String(toks[i]).toUpperCase() === "ANGLE") {
        const v = num(toks[i + 1]);
        if (v !== null) angleDegExplicit = v;
      }
    }

    const nums = [];
    for (const t of toks) {
      const v = num(t);
      if (v !== null) nums.push(v);
    }
    if (nums.length < 7) return null;

    return {
      kind: "CIRCLE",
      center: v3(nums[0], nums[1], nums[2]),
      axis: v3(nums[3], nums[4], nums[5]),
      radius: nums[6],
      angleDegExplicit,
      raw: line,
    };
  }

  function parseAptCl(text) {
    const lines = _preprocessCreoLines(text);

    // keep shape for legacy callers that still pass events around
    const events = [];

    const motionPoints = [];
    const renderPoints = [];

    function pushRenderPoint(p, motion = null) {
      if (!p) return;

      const n = renderPoints.length;
      if (n > 0) {
        const q = renderPoints[n - 1];
        const dx = p.x - q.x,
          dy = p.y - q.y,
          dz = p.z - q.z;
        if (dx * dx + dy * dy + dz * dz <= 1e-16) return;
      }

      renderPoints.push({
        x: p.x,
        y: p.y,
        z: p.z,
        ...(motion ? { motion: String(motion).toUpperCase() } : {}),
      });
    }

    function pushMotionPoint(pt) {
      // attach the latest raw APT line so HUD can show it
      pt.apt = lastApt || null;           // robust (survives flattening)
      // optionally also keep the old "hud bundle" if you still want it later
      pt.hud = { apt: lastApt || null };  // minimal

      motionPoints.push(pt);
      lastPos = { x: pt.x, y: pt.y, z: pt.z };
    }

    let pendingRapid = false;
    let feed = null;
    let feedMode = null;
    let units = null;
    let activeCycle = null;

    let modalToolAxis = null; // {i,j,k}
    let pendingArc = null;
    let lastPos = null;

    // For HUD: last APT logical record (string) that produced a point
    let lastApt = null;

    function _axisFromIJK(i, j, k) {
      if ([i, j, k].every((v) => Number.isFinite(v))) return { i, j, k };
      return null;
    }

    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
      const line = String(lines[lineNo] || "").trim();
      if (!line) continue;

      // UNITS
      {
        const m = line.match(/^UNITS\s*\/\s*(.+)$/i);
        if (m) {
          units = m[1].trim().toUpperCase();
          continue;
        }
      }

      // TLAXIS (modal)
      {
        const t = parseTlaxisLine(line);
        if (t) {
          modalToolAxis = { i: t.i, j: t.j, k: t.k };
          lastApt = line;
          continue;
        }
      }

      // CYCLE
      {
        const cyc = parseCycleLine(line);
        if (cyc) {
          lastApt = line;
          if (cyc.kind === "CYCLE_OFF") activeCycle = null;
          else activeCycle = cyc.cycle;
          continue;
        }
      }

      // MOVARC pending
      {
        const arc = parseMovarcLine(line);
        if (arc) {
          pendingArc = arc;
          lastApt = line;
          continue;
        }
      }

      // CIRCLE pending
      {
        const c = parseCircleLine(line);
        if (c) {
          pendingArc = c;
          lastApt = line;
          continue;
        }
      }

      // RAPID
      if (/^RAPID\b/i.test(line)) {
        pendingRapid = true;
        lastApt = line;
        continue;
      }

      // FEDRAT
      {
        const m = line.match(/^FEDRAT\s*\/\s*(.+)$/i);
        if (m) {
          const toks = splitCsvArgs(m[1]);
          const v = toks.length ? num(toks[0]) : null;
          const mode = toks.length >= 2 && isWordToken(toks[1]) ? toks[1].toUpperCase() : null;
          feed = v;
          feedMode = mode;
          lastApt = line;
          continue;
        }
      }

      // FROM/GOTO
      {
        const m = line.match(/^(?:GOTO|FROM)\s*\/\s*(.+)$/i);
        if (m) {
          const p = parseXYZIJKFromArgs(m[1]);
          lastApt = line; // this is the record the HUD should show for this point
          if (!p) continue;

          const baseMotion = pendingRapid ? "RAPID" : "FEED";
          const inlineAxis = _axisFromIJK(p.i, p.j, p.k);
          const toolAxis = inlineAxis || modalToolAxis || null;

          // Pending arc: this point is END point
          if (pendingArc && lastPos) {
            const startPt = { x: lastPos.x, y: lastPos.y, z: lastPos.z };
            const endPt = { x: p.x, y: p.y, z: p.z };

            if (pendingArc.kind === "MOVARC") {
              const arcDef = {
                center: pendingArc.center,
                axis: pendingArc.axis,
                sweepRad: chooseSweepRadByBestFit(
                  pendingArc.center,
                  pendingArc.axis,
                  startPt,
                  endPt,
                  pendingArc.angleDeg
                ),
              };

              const kUnit = norm(arcDef.axis);
              const sAx = dot(sub(v3(startPt.x, startPt.y, startPt.z), arcDef.center), kUnit);
              const eAx = dot(sub(v3(endPt.x, endPt.y, endPt.z), arcDef.center), kUnit);
              const isHelix = Math.abs(eAx - sAx) > 1e-9;

              pushMotionPoint({
                x: endPt.x,
                y: endPt.y,
                z: endPt.z,
                motion: isHelix ? "HELIX" : "ARC",
                arc: {
                  center: { x: arcDef.center.x, y: arcDef.center.y, z: arcDef.center.z },
                  axis: { x: arcDef.axis.x, y: arcDef.axis.y, z: arcDef.axis.z },
                  sweepRad: arcDef.sweepRad,
                },
                toolAxis: toolAxis ? { i: toolAxis.i, j: toolAxis.j, k: toolAxis.k } : null,
                feed,
                feedMode,
                n: lineNo,
                apt: lastApt,
              });

              const arcPts = tessellateArc(startPt, arcDef, endPt, 5);
              const mtag = isHelix ? "HELIX" : "ARC";
              for (const ap of arcPts) pushRenderPoint(ap, mtag);
            } else {
              // CIRCLE
              const arcDef = {
                center: pendingArc.center,
                axis: pendingArc.axis,
                sweepRad: null,
              };

              const kUnit = norm(arcDef.axis);

              const S = v3(startPt.x, startPt.y, startPt.z);
              const E = v3(endPt.x, endPt.y, endPt.z);
              const Cc = arcDef.center;

              const sAx = dot(sub(S, Cc), kUnit);
              const eAx = dot(sub(E, Cc), kUnit);

              const rS = sub(sub(S, Cc), mul(kUnit, sAx));
              const rE = sub(sub(E, Cc), mul(kUnit, eAx));

              function radialClosed(a, b, tolAbs = 1e-7) {
                const d = sub(a, b);
                const dl = len(d);
                const ra = Math.max(1e-9, len(a));
                const rb = Math.max(1e-9, len(b));
                const tol = tolAbs * Math.max(ra, rb, 1);
                return dl <= tol;
              }

              const planarClosed = radialClosed(rS, rE, 1e-7);

              if (typeof pendingArc.angleDegExplicit === "number") {
                arcDef.sweepRad = chooseSweepRadByBestFit(
                  arcDef.center,
                  arcDef.axis,
                  startPt,
                  endPt,
                  pendingArc.angleDegExplicit
                );
              } else if (planarClosed) {
                arcDef.sweepRad = deg2rad(360);
              } else {
                arcDef.sweepRad = signedAngleAroundAxis(arcDef.center, arcDef.axis, startPt, endPt);
              }

              const isHelix = Math.abs(eAx - sAx) > 1e-9;

              pushMotionPoint({
                x: endPt.x,
                y: endPt.y,
                z: endPt.z,
                motion: isHelix ? "HELIX" : "ARC",
                arc: {
                  center: { x: arcDef.center.x, y: arcDef.center.y, z: arcDef.center.z },
                  axis: { x: arcDef.axis.x, y: arcDef.axis.y, z: arcDef.axis.z },
                  sweepRad: arcDef.sweepRad,
                },
                toolAxis: toolAxis ? { i: toolAxis.i, j: toolAxis.j, k: toolAxis.k } : null,
                feed,
                feedMode,
                n: lineNo,
                apt: lastApt,
              });

              const arcPts = tessellateArc(startPt, arcDef, endPt, 5);
              const mtag = isHelix ? "HELIX" : "ARC";
              for (const ap of arcPts) pushRenderPoint(ap, mtag);
            }

            pendingArc = null;
            pendingRapid = false;
            continue;
          }

          // Cycle handling (expanded motion points + render polyline)
          if (activeCycle) {
            const travelZ = getCycleTravelZ(activeCycle, p.z);

            // travel
            pushMotionPoint({
              x: p.x,
              y: p.y,
              z: travelZ,
              motion: "CYCLE_TRAVEL",
              toolAxis: toolAxis ? { i: toolAxis.i, j: toolAxis.j, k: toolAxis.k } : null,
              feed,
              feedMode,
              n: lineNo,
              apt: lastApt,
            });

            // plunge
            pushMotionPoint({
              x: p.x,
              y: p.y,
              z: p.z,
              motion: "PLUNGE",
              toolAxis: toolAxis ? { i: toolAxis.i, j: toolAxis.j, k: toolAxis.k } : null,
              feed,
              feedMode,
              n: lineNo,
              apt: lastApt,
            });

            // retract
            pushMotionPoint({
              x: p.x,
              y: p.y,
              z: travelZ,
              motion: "RETRACT",
              toolAxis: toolAxis ? { i: toolAxis.i, j: toolAxis.j, k: toolAxis.k } : null,
              feed,
              feedMode,
              n: lineNo,
              apt: lastApt,
            });

            pushRenderPoint({ x: p.x, y: p.y, z: travelZ }, "CYCLE_TRAVEL");
            pushRenderPoint({ x: p.x, y: p.y, z: p.z }, "PLUNGE");
            pushRenderPoint({ x: p.x, y: p.y, z: travelZ }, "RETRACT");

            pendingRapid = false;
            continue;
          }

          // Linear (tool-axis aware)
          const prev = lastPos ? { x: lastPos.x, y: lastPos.y, z: lastPos.z } : null;
          const next = { x: p.x, y: p.y, z: p.z };

          const motionClass = classifyLinearMotion(prev, next, baseMotion, toolAxis, {
            eps: 1e-6,
            kDom: 2.0,
            zDominance: 0.85,
            minDz: 1e-6,
          });

          pushMotionPoint({
            x: p.x,
            y: p.y,
            z: p.z,
            i: p.i,
            j: p.j,
            k: p.k,
            toolAxis: toolAxis ? { i: toolAxis.i, j: toolAxis.j, k: toolAxis.k } : null,
            motion: motionClass,
            feed,
            feedMode,
            n: lineNo,
            apt: lastApt,
          });

          pushRenderPoint({ x: p.x, y: p.y, z: p.z }, motionClass);

          pendingRapid = false;
          continue;
        }
      }

      // END/FINI just updates "lastApt" (if you scrub to it later)
      if (/^(END|FINI)\b/i.test(line)) {
        lastApt = line;
        continue;
      }

      // Default: do nothing (no events, no HUD pollution)
    }

    const flatPoints = decimatePoints(
      motionPoints.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      1e-8
    );

    return { units, events, flatPoints, motionPoints, renderPoints };
  }

  function parseAptGotoPoints(text) {
    const parsed = parseAptCl(text);
    return parsed.flatPoints;
  }

  // Timeline builder used by toolpath.js via ctx.buildHudTimelineFromParsed
  // It returns one entry per motion point, shaped for hud.js:
  //   { apt: string, n: number }
  window.buildHudTimelineFromAptText = function (text) {
    const parsed = window.parseAptCl(text);
    return (parsed.motionPoints || []).map((p) => ({
      apt: p?.apt || null,
      n: p?.n ?? null,
    }));
  };

  window.parseAptCl = parseAptCl;
  window.parseAptGotoPoints = parseAptGotoPoints;
})();