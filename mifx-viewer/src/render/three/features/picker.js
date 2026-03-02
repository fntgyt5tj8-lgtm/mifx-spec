// src/render/three/features/picker.js
// Feature: click-pick + hide/unhide (Alt+Click hides)
// - Owns raycast + event listeners
// - Does not know about MIFX, setups, toolpaths, etc.
// - Works on any Object3D you register as "pick root"
//
// Usage:
//   const picker = installPicker(ctx);
//   picker.setRoot(groupThatContainsGeometry);
//   picker.setEnabled(true);
//   picker.unhideAll();

export function installPicker(ctx) {
  const THREE = ctx.THREE;
  const host = ctx.host;                 // DOM element hosting canvas
  const camera = () => ctx.camera;
  const renderer = () => ctx.renderer;   // optional; we can use host bounds too

  // Optional persistence hook
  // ctx.pickerState = {
  //   getHiddenMap: () => ({ [id]: true }),
  //   setHiddenMap: (m) => {},
  // }
  const pickerState = ctx.pickerState || null;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  let enabled = true;
  let root = null; // Object3D where we raycast (typically grpSetup or a child)

  // simple in-memory hidden registry (id -> true)
  let hiddenById = Object.create(null);

  function _loadHiddenMapFromState() {
    if (!pickerState?.getHiddenMap) return;
    const m = pickerState.getHiddenMap();
    if (m && typeof m === "object") hiddenById = { ...m };
  }

  function _saveHiddenMapToState() {
    if (!pickerState?.setHiddenMap) return;
    pickerState.setHiddenMap({ ...hiddenById });
  }

  function setEnabled(v) {
    enabled = !!v;
  }

  function setRoot(obj3d) {
    root = obj3d || null;
    // when root changes, re-apply existing hidden map
    _applyHiddenMapToRoot();
  }

  function clear() {
    // remove listeners + reset internal refs
    _detach();
    root = null;
    hiddenById = Object.create(null);
  }

  // ------------------------------------------------------------
  // ID strategy
  // ------------------------------------------------------------
  // We need a stable id per picked object.
  // Prefer userData.geomId (or any caller-defined id), else fallback to uuid.
  function _getObjId(obj) {
    return obj?.userData?.geomId || obj?.userData?.id || obj?.name || obj?.uuid;
  }

  function _isPickable(obj) {
    // only meshes are "hit"; but we might want to hide the parent group
    return !!obj?.isMesh;
  }

  function _getHideTarget(hitObj) {
    // decide what to actually hide:
    // - If mesh has a "geomRoot" parent marker, hide that (better UX)
    // - Else hide mesh itself
    let o = hitObj;
    while (o && o.parent) {
      if (o.userData?.pickGroup === true) return o; // allow grouping
      o = o.parent;
    }
    return hitObj;
  }

  // ------------------------------------------------------------
  // Visibility ops
  // ------------------------------------------------------------
  function hideObject(obj) {
    if (!obj) return;
    const id = _getObjId(obj);
    if (!id) return;

    obj.visible = false;
    hiddenById[id] = true;
    _saveHiddenMapToState();
  }

  function unhideAll() {
    hiddenById = Object.create(null);
    _saveHiddenMapToState();

    if (!root) return;
    root.traverse?.((o) => {
      // don’t touch helper layers if you place them under root (you shouldn't)
      o.visible = true;
    });
  }

  function _applyHiddenMapToRoot() {
    _loadHiddenMapFromState();
    if (!root) return;

    root.traverse?.((o) => {
      const id = _getObjId(o);
      if (!id) return;
      if (hiddenById[id]) o.visible = false;
    });
  }

  // ------------------------------------------------------------
  // Raycast
  // ------------------------------------------------------------
  function _getPointerNdc(evt) {
    const rect = host.getBoundingClientRect();
    const x = (evt.clientX - rect.left) / rect.width;
    const y = (evt.clientY - rect.top) / rect.height;
    ndc.set(x * 2 - 1, -(y * 2 - 1));
  }

  function pick(evt) {
    if (!enabled) return null;
    if (!root) return null;

    const cam = camera();
    if (!cam) return null;

    _getPointerNdc(evt);
    raycaster.setFromCamera(ndc, cam);

    // intersect all descendants
    const hits = raycaster.intersectObject(root, true);
    if (!hits?.length) return null;

    // find first pickable mesh
    const hit = hits.find((h) => _isPickable(h.object)) || hits[0];
    if (!hit) return null;

    const target = _getHideTarget(hit.object);
    return { hit, object: target };
  }

  // ------------------------------------------------------------
  // DOM events
  // ------------------------------------------------------------
  let _attached = false;

  function _onPointerDown(evt) {
    if (!enabled) return;

    // Keep your existing UX: Alt+Click hides.
    if (!evt.altKey) return;

    const res = pick(evt);
    if (!res?.object) return;

    hideObject(res.object);
    evt.preventDefault();
    evt.stopPropagation();
  }

  function _attach() {
    if (_attached) return;
    if (!host) return;

    host.addEventListener("pointerdown", _onPointerDown, { passive: false });
    _attached = true;
  }

  function _detach() {
    if (!_attached) return;
    host.removeEventListener("pointerdown", _onPointerDown);
    _attached = false;
  }

  // attach immediately (feature owns itself)
  _attach();

  return {
    setEnabled,
    setRoot,
    pick,        // optional: expose for future “select” features
    hideObject,
    unhideAll,
    applyHiddenMap: _applyHiddenMapToRoot,
    clear,
    _debug: {
      get enabled() { return enabled; },
      get root() { return root; },
      get hiddenById() { return hiddenById; },
    },
  };
}