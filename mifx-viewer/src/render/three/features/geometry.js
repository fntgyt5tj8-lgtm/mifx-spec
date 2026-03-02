// src/render/three/features/geometry.js
import { STLLoader } from "/vendor/three/addons/loaders/STLLoader.js";
import { ThreeMFLoader } from "/vendor/three/addons/loaders/3MFLoader.js";
import { scaleToMM } from "/src/render/three/util/units.js";

export function installGeometry(ctx) {
  const THREE = ctx.THREE;

  function _ext(path) {
    const p = String(path || "").split("#")[0].split("?")[0];
    const m = p.toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : "";
  }

  async function _maybeAwait(x) {
    return x && typeof x.then === "function" ? await x : x;
  }

  async function _resolveUrl(source, path) {
    const p = String(path || "").trim();
    if (!p) return null;
    if (/^(https?:|blob:|data:)/i.test(p)) return p;

    const candidates = [
      source?.getUrl?.bind(source),
      source?.urlFor?.bind(source),
      source?.urlForPath?.bind(source),
      source?.getObjectUrl?.bind(source),
      source?.getBlobUrl?.bind(source),
      source?.resolveUrl?.bind(source),
      source?.resolve?.bind(source),
    ].filter(Boolean);

    for (const fn of candidates) {
      try {
        const out = await _maybeAwait(fn(p));
        if (out) return out;
      } catch {}
    }

    const base = source?.baseUrl || source?.baseURL || source?.url || "";
    if (base) {
      const b = String(base).replace(/\/+$/, "");
      const pp = p.replace(/^\/+/, "");
      return `${b}/${pp}`;
    }
    return null;
  }

  function _fixupMaterials(root) {
    root.traverse?.((o) => {
      if (!o?.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        m.side = THREE.DoubleSide;
        m.depthWrite = true;
        m.needsUpdate = true;
      }
    });
  }

  function _wrapLoaded(loaded, name) {
    const g = new THREE.Group();
    g.name = name || "geometry";

    if (loaded?.isBufferGeometry) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x8fb3ff,
        metalness: 0.0,
        roughness: 0.95,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(loaded, mat);
      g.add(mesh);
      return g;
    }

    if (loaded?.isObject3D) {
      g.add(loaded);
      return g;
    }

    return null;
  }

  async function _loadWith(loader, url) {
    return await new Promise((resolve, reject) => {
      loader.load(url, (obj) => resolve(obj), undefined, (err) => reject(err));
    });
  }

  /**
   * @param {{
   *   artifactRef: { path: string, unit?: string, units?: string },
   *   unitsHint?: string, // ✅ preferred (e.g. setup.transform.unit)
   *   source: any,
   *   group: THREE.Group,
   *   kind?: string,
   *   id?: string,
   *   visible?: boolean,
   * }} args
   */
  async function loadIntoGroup({
    artifactRef,
    unitsHint,
    source,
    group,
    kind,
    id,
    visible = true,
  } = {}) {
    const path = artifactRef?.path;
    if (!group || !path) return null;

    const url = await _resolveUrl(source, path);
    if (!url) {
      console.warn("[geometry] cannot resolve url for", { path });
      return null;
    }

    const ext = _ext(path);
    let loaded = null;

    try {
      if (ext === "stl") loaded = await _loadWith(new STLLoader(), url);
      else if (ext === "3mf") loaded = await _loadWith(new ThreeMFLoader(), url);
      else {
        console.warn("[geometry] unsupported geometry extension:", ext, "path:", path);
        return null;
      }
    } catch (e) {
      console.error("[geometry] load failed:", { path, url, e });
      return null;
    }

    const name = `geom_${String(kind || "setup")}:${String(id || "")}`.replace(/:+$/, "");
    const geomGroup = _wrapLoaded(loaded, name);
    if (!geomGroup) {
      console.warn("[geometry] unsupported loaded object:", loaded);
      return null;
    }

    _fixupMaterials(geomGroup);
    geomGroup.visible = !!visible;

    // ✅ Units → scene-mm scaling
    // unitsHint wins, else artifactRef.units/unit, else mm
    const units = unitsHint ?? artifactRef?.units ?? artifactRef?.unit ?? "mm";
    const s = scaleToMM(units);
    if (Number.isFinite(s) && s > 0) geomGroup.scale.setScalar(s);

    group.add(geomGroup);
    geomGroup.updateMatrixWorld(true);

    return geomGroup;
  }

  function clear() {}

  return { loadIntoGroup, clear };
}