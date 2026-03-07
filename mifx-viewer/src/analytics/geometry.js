export function dist3(a, b) {
  const dx = (b.x - a.x), dy = (b.y - a.y), dz = (b.z - a.z);
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

export function computeLengths(motionPoints) {
  const mp = Array.isArray(motionPoints) ? motionPoints : [];
  const lengthByMotion = { RAPID:0, FEED:0, ARC:0, HELIX:0, PLUNGE:0, RETRACT:0, CYCLE_TRAVEL:0, OTHER:0 };

  let min = null, max = null, zMin = null, zMax = null;
  const motionCounts = {};

  function expand(p) {
    if (!p) return;
    const x = Number(p.x), y = Number(p.y), z = Number(p.z);
    if (![x,y,z].every(Number.isFinite)) return;

    if (!min) { min = {x,y,z}; max = {x,y,z}; zMin = z; zMax = z; return; }
    min.x = Math.min(min.x, x); min.y = Math.min(min.y, y); min.z = Math.min(min.z, z);
    max.x = Math.max(max.x, x); max.y = Math.max(max.y, y); max.z = Math.max(max.z, z);
    zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
  }

  mp.forEach(expand);

  for (let i=1; i<mp.length; i++) {
    const a = mp[i-1], b = mp[i];
    const L = dist3(a,b);
    if (!Number.isFinite(L) || L <= 0) continue;

    const m = String(b.motion || "FEED").toUpperCase();
    motionCounts[m] = (motionCounts[m] || 0) + 1;

    if (lengthByMotion[m] != null) lengthByMotion[m] += L;
    else lengthByMotion.OTHER += L;
  }

  const totalLength = Object.values(lengthByMotion).reduce((s,v)=>s+v,0);

  return {
    metrics: {
      pointCount: mp.length,
      lengthByMotion,
      totalLength,
      bbox: (min && max) ? { min, max } : null,
      zMin, zMax,
    },
    debug: { motionCounts },
    warnings: [],
  };
}