// src/render/three/features/op_csys.js
export function installOpCsys(ctx) {
  const THREE = ctx.THREE;
  const grpHelpers = ctx.groups?.helpers;

  let group = null;

  const axesById = new Map();
  const wpById = new Map();
  const wpM4ById = new Map();
  let activeId = null;

  // ------------------------------------------------------------
  // Internal: workplane finder (owned by op_csys)
  // ------------------------------------------------------------
  function _is4x4Rows(rows) {
    if (!Array.isArray(rows) || rows.length !== 4) return false;
    for (const r of rows) {
      if (!Array.isArray(r) || r.length !== 4) return false;
      for (const v of r) if (!Number.isFinite(Number(v))) return false;
    }
    return true;
  }

  function _findWorkplaneTransformDeep(obj, depth = 0, maxDepth = 6) {
    if (!obj || typeof obj !== "object") return null;
    if (depth > maxDepth) return null;

    if (_is4x4Rows(obj.rows)) return obj;

    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (!v) continue;
      if (typeof v === "object") {
        const hit = _findWorkplaneTransformDeep(v, depth + 1, maxDepth);
        if (hit) return hit;
      }
    }
    return null;
  }

  // ------------------------------------------------------------
  // Matrix parsing (row/column major)
  // ------------------------------------------------------------
  const parseMatrix4FromXmlRows =
    ctx.parseMatrix4FromXmlRows ||
    function (rows, storage) {
      if (!Array.isArray(rows) || rows.length !== 4) return null;

      const flat = [];
      for (let r = 0; r < 4; r++) {
        const rr = rows[r];
        if (!Array.isArray(rr) || rr.length !== 4) return null;
        for (let c = 0; c < 4; c++) {
          const v = Number(rr[c]);
          if (!Number.isFinite(v)) return null;
          flat.push(v);
        }
      }

      const m = new THREE.Matrix4();
      const s = String(storage || "row-major").toLowerCase();

      if (s === "column-major") {
        m.set(
          flat[0], flat[4], flat[8], flat[12],
          flat[1], flat[5], flat[9], flat[13],
          flat[2], flat[6], flat[10], flat[14],
          flat[3], flat[7], flat[11], flat[15]
        );
      } else {
        m.set(
          flat[0], flat[1], flat[2], flat[3],
          flat[4], flat[5], flat[6], flat[7],
          flat[8], flat[9], flat[10], flat[11],
          flat[12], flat[13], flat[14], flat[15]
        );
      }
      return m;
    };

  function _id(opId) {
    return String(opId);
  }

  function _ensureGroup() {
    if (!grpHelpers) return null;

    if (!group) {
      group = new THREE.Group();
      group.name = "op_csys";
      grpHelpers.add(group);
    } else if (!group.parent) {
      // UI/renderer may have cleared helpers; reattach
      grpHelpers.add(group);
    }

    return group;
  }

  function _axesLengthForOpCs() {
    const base = Number(ctx.getWcsBaseAxesLen?.() ?? 120);
    return THREE.MathUtils.clamp(base * 0.65, 12, 80);
  }

  function _disposeAxes(id) {
    const ax = axesById.get(id);
    if (!ax) return;

    ax.parent?.remove?.(ax);
    ax.traverse?.((o) => {
      o.geometry?.dispose?.();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m?.dispose?.());
        else o.material.dispose?.();
      }
    });

    axesById.delete(id);
  }

  // ------------------------------------------------------------
  // Clear ONLY visuals + caches (keeps group object alive)
  // ------------------------------------------------------------
  function reset() {
    for (const id of Array.from(axesById.keys())) _disposeAxes(id);
    axesById.clear();
    wpById.clear();
    wpM4ById.clear();
    activeId = null;
  }

  // Full clear (same as reset, but kept for API compatibility)
  function clear() {
    reset();
  }

  // ------------------------------------------------------------
  // Public: register a single workplane (compat)
  // ------------------------------------------------------------
  function registerWorkplane(opId, wpOrNull) {
    const id = _id(opId);

    if (!wpOrNull) {
      wpById.delete(id);
      wpM4ById.delete(id);
      _disposeAxes(id);
      if (activeId === id) activeId = null;
      return;
    }

    const rows = wpOrNull?.rows;
    if (!_is4x4Rows(rows)) return;

    const m4 = parseMatrix4FromXmlRows(rows, wpOrNull.storage);
    if (!m4) return;

    wpById.set(id, wpOrNull);
    wpM4ById.set(id, m4);
  }

  // ------------------------------------------------------------
  // Preferred: register ops in one shot
  // ------------------------------------------------------------
  function registerOperations(ops, { maxDepth = 6 } = {}) {
    // IMPORTANT: do NOT nuke group references; just reset caches/visuals
    reset();

    let found = 0;
    for (const op of ops || []) {
      const opId = op?.id;
      if (opId == null) continue;

      const wp = _findWorkplaneTransformDeep(op, 0, maxDepth);
      if (wp?.rows) {
        registerWorkplane(opId, wp);
        found++;
      }
    }

    console.log("[op_csys] registerOperations", {
      ops: (ops || []).length,
      found,
      registered: wpM4ById.size,
    });
  }

  function setVisible(opId, visible) {
    const id = _id(opId);

    if (!visible) {
      _disposeAxes(id);
      return;
    }

    const g = _ensureGroup();
    if (!g) return;

    const m4 = wpM4ById.get(id);
    if (!m4) {
      console.warn("[op_csys] setVisible: missing workplane matrix for opId", {
        opId,
        id,
        registeredIds: Array.from(wpM4ById.keys()).slice(0, 12),
        registeredCount: wpM4ById.size,
      });
      return;
    }

    _disposeAxes(id);

    const len = _axesLengthForOpCs();
    const axes = new THREE.AxesHelper(len);
    axes.name = `op_csys_${id}`;
    axes.renderOrder = 1200;
    axes.frustumCulled = false;

    if (Array.isArray(axes.material)) {
      for (const m of axes.material) {
        if (!m) continue;
        m.transparent = true;
        m.opacity = 0.95;
        m.depthWrite = false;
        m.needsUpdate = true;
        m.linewidth = 2.0;
      }
    }

    axes.applyMatrix4(m4);
    axes.updateMatrixWorld(true);

    g.add(axes);
    axesById.set(id, axes);
  }

  function setActive(opIdOrNull) {
    const next = opIdOrNull == null ? null : _id(opIdOrNull);

    if (activeId && activeId !== next) _disposeAxes(activeId);
    activeId = next;

    if (activeId) setVisible(activeId, true);
  }

  function getCount() {
    return wpM4ById.size;
  }

  function getRegisteredIds() {
    return Array.from(wpM4ById.keys());
  }

  return {
    clear,
    reset, // new
    registerWorkplane, // compat
    registerOperations, // preferred
    setVisible,
    setActive,
    getCount,
    getRegisteredIds,
    _debug: {
      axesById,
      wpById,
      wpM4ById,
      _findWorkplaneTransformDeep,
      get activeId() {
        return activeId;
      },
    },
  };
}