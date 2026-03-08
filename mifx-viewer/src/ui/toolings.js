// src/ui/toolings.js

import { state } from "../app/state.js";

export function renderToolings() {
  const container = document.getElementById("toolingsRoot");
  if (!container) return;

  const tools = Array.isArray(state.tools) ? state.tools : [];

  function toolGroupValue(tool) {
    const g = tool?.group;
    if (g === null || g === undefined || g === "") return "?";
    return String(g);
  }

  function sortGroupKeys(a, b) {
    const na = Number(a);
    const nb = Number(b);

    const aNum = Number.isFinite(na);
    const bNum = Number.isFinite(nb);

    if (aNum && bNum) return na - nb;
    if (aNum && !bNum) return -1;
    if (!aNum && bNum) return 1;
    return String(a).localeCompare(String(b));
  }

  function sortToolsByNumber(a, b) {
    const na =
      a?.number !== null && a?.number !== undefined && a?.number !== ""
        ? Number(a.number)
        : Number.POSITIVE_INFINITY;

    const nb =
      b?.number !== null && b?.number !== undefined && b?.number !== ""
        ? Number(b.number)
        : Number.POSITIVE_INFINITY;

    if (na !== nb) return na - nb;

    return String(a?.id || "").localeCompare(String(b?.id || ""));
  }

  function toolLabel(tool) {
    const number =
      tool?.number !== null && tool?.number !== undefined && tool?.number !== ""
        ? `T${tool.number}`
        : "T?";

    const name =
      tool?.name ||
      tool?.description ||
      tool?.id ||
      "-";

    return `${number} · ${name}`;
  }

  const byGroup = new Map();

  for (const tool of tools) {
    const g = toolGroupValue(tool);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(tool);
  }

  const groupKeys = Array.from(byGroup.keys()).sort(sortGroupKeys);

  container.innerHTML = `<h2>Toolings</h2>`;

  if (!groupKeys.length) {
    container.innerHTML += `<div>No tooling loaded.</div>`;
    return;
  }

  for (const groupKey of groupKeys) {
    const groupTools = (byGroup.get(groupKey) || []).slice().sort(sortToolsByNumber);

    const section = document.createElement("div");
    section.style.marginBottom = "24px";

    section.innerHTML = `
      <h3>Tool Group ${groupKey}</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px;">
        <thead>
          <tr style="border-bottom:1px solid #ccc;">
            <th align="left">Tool</th>
            <th align="left">Type</th>
            <th align="left">Diameter</th>
            <th align="left">Corner Radius</th>
            <th align="left">Flute Length</th>
            <th align="left">Gauge Length</th>
            <th align="left">Holder</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    `;

    const tbody = section.querySelector("tbody");

    for (const tool of groupTools) {
      const tr = document.createElement("tr");
      tr.style.borderBottom = "1px solid #eee";

      const diameter =
        tool?.diameter !== null && tool?.diameter !== undefined ? tool.diameter : "-";

      const cornerRadius =
        tool?.cornerRadius !== null && tool?.cornerRadius !== undefined
          ? tool.cornerRadius
          : tool?.corner_radius !== null && tool?.corner_radius !== undefined
            ? tool.corner_radius
            : "-";

      const fluteLength =
        tool?.fluteLength !== null && tool?.fluteLength !== undefined
          ? tool.fluteLength
          : tool?.flute_length !== null && tool?.flute_length !== undefined
            ? tool.flute_length
            : "-";

      const gaugeLength =
        tool?.gaugeLength !== null && tool?.gaugeLength !== undefined
          ? tool.gaugeLength
          : tool?.gauge_length !== null && tool?.gauge_length !== undefined
            ? tool.gauge_length
            : "-";

      const holder =
        tool?.holder_description ||
        tool?.holder ||
        "-";

      tr.innerHTML = `
        <td>${toolLabel(tool)}</td>
        <td>${tool?.type || tool?.kind || "-"}</td>
        <td>${diameter}</td>
        <td>${cornerRadius}</td>
        <td>${fluteLength}</td>
        <td>${gaugeLength}</td>
        <td>${holder}</td>
      `;

      tbody.appendChild(tr);
    }

    container.appendChild(section);
  }
}