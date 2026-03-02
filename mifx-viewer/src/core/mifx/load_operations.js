export async function loadOperations(source) {
  const manifest = await source.getJson("manifest.json");

  const ops = [];
  const entities = manifest?.trace?.entities?.operations || {};

  for (const key in entities) {
    const path = entities[key].path;
    const op = await source.getJson(path);
    ops.push(op);
  }

  return ops;
}