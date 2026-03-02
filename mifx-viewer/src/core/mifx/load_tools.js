// src/core/mifx/load_tools.js
export async function loadTools(source) {
  const manifest = await source.getJson("manifest.json");

  const tools = [];
  const entities = manifest?.trace?.entities?.tools || {};

  for (const key in entities) {
    const path = entities[key]?.path;
    if (!path) continue;

    const tool = await source.getJson(path);

    if (tool && typeof tool === "object") {
      tool._mifxKey = key;     // ✅ critical
      if (!tool.id) tool.id = key;
    }

    tools.push(tool);
  }

  return tools;
}