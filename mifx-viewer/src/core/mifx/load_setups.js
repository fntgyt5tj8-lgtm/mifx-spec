// src/core/mifx/load_setups.js
// Pure loader: resolves setup refs to full setup payloads
// Supports both:
//   - old schema: setup.artifactRef
//   - new schema: setup.artifacts[]
// Normalizes to:
//   - setup.artifacts[]
//   - setup.artifactRef (primary setup geometry fallback for legacy renderer code)

function _isSetupGeomRole(role) {
  const r = String(role || "").trim().toLowerCase();
  return (
    r === "setup_geometry" ||
    r === "part" ||
    r === "stock" ||
    r === "fixture"
  );
}

function _normalizeArtifact(a, setup) {
  if (!a || typeof a !== "object") return null;

  const role = String(a.role || "").trim().toLowerCase();
  const path = String(a.path || "").trim();
  if (!_isSetupGeomRole(role) || !path || a.present === false) return null;

  return {
    role,
    kind: a.kind ? String(a.kind).trim().toLowerCase() : null,
    path,
    present: a.present !== false,
    transform: a.transform || setup?.transform || null,
  };
}

function _normalizeSetupArtifacts(setup) {
  if (!setup || typeof setup !== "object") return setup;

  const out = { ...setup };

  const arts = Array.isArray(out.artifacts) ? out.artifacts : [];
  let normalized = arts
    .map((a) => _normalizeArtifact(a, out))
    .filter(Boolean);

  // Backward compatibility: old schema with single artifactRef
  if (!normalized.length && out.artifactRef && typeof out.artifactRef === "object") {
    const legacy = _normalizeArtifact(
      {
        role: out.artifactRef.role || "setup_geometry",
        kind: out.artifactRef.kind || null,
        path: out.artifactRef.path || null,
        present: out.artifactRef.present,
        transform: out.artifactRef.transform || out.transform || null,
      },
      out
    );

    if (legacy) normalized = [legacy];
  }

  out.artifacts = normalized;

  // Legacy compatibility for old renderer paths:
  // keep a single primary setup geometry artifact in artifactRef
  const primary =
    normalized.find((a) => a.role === "setup_geometry") ||
    normalized[0] ||
    null;

  out.artifactRef = primary
    ? {
        role: primary.role,
        kind: primary.kind,
        path: primary.path,
        present: primary.present,
        transform: primary.transform,
      }
    : null;

  return out;
}

export async function loadSetups(source, job = null) {
  const manifest = await source.getJson("manifest.json");
  const entities = manifest?.trace?.entities?.setups || {};
  const out = [];

  // Preferred: manifest trace entities
  const keys = Object.keys(entities);
  if (keys.length) {
    for (const key of keys) {
      const path = entities[key]?.path;
      if (!path) continue;

      const setup = await source.getJson(path);
      if (setup) out.push(_normalizeSetupArtifacts(setup));
    }
    return out;
  }

  // Fallback: job.json setup refs
  const refs = Array.isArray(job?.setups) ? job.setups : [];
  for (const s of refs) {
    const path = s?.path;
    if (!path) continue;

    const setup = await source.getJson(path);
    if (setup) out.push(_normalizeSetupArtifacts(setup));
  }

  return out;
}