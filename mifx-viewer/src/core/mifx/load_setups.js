// src/core/mifx/load_setups.js
// Pure loader: resolves setup entities to full setup objects.
// - Reads manifest.json for trace.entities.setups (preferred)
// - Fallback: uses job.setups if present (id/path)
// Returns: Array<setupJson>

export async function loadSetups(source, job = null) {
  const manifest = await source.getJson("manifest.json");

  // Preferred: manifest trace entities
  const entities = manifest?.trace?.entities?.setups || {};
  const out = [];

  // If manifest has setups, load from there
  const keys = Object.keys(entities);
  if (keys.length) {
    for (const key of keys) {
      const path = entities[key]?.path;
      if (!path) continue;
      const setup = await source.getJson(path);
      if (setup) out.push(setup);
    }
    return out;
  }

  // Fallback: job.setups (refs) if provided
  const refs = job?.setups || [];
  for (const s of refs) {
    const path = s?.path;
    if (!path) continue;
    const setup = await source.getJson(path);
    if (setup) out.push(setup);
  }

  return out;
}