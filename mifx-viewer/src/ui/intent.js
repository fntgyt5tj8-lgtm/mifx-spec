// src/ui/intent.js

import { state } from "../app/state.js";

export function renderIntent() {
  const container = document.getElementById("intentRoot");
  if (!container) return;

  const ops = Array.isArray(state.operations) ? state.operations : [];
  const setups = Array.isArray(state.job?.setups) ? state.job.setups : [];
  const tools = Array.isArray(state.tools) ? state.tools : [];

  function extractToolId(op) {
    return (
      op.toolId ??
      op.toolRef ??
      op.tool?.id ??
      op.tool?.toolId ??
      op.tool?.ref ??
      op.tool_id ??
      null
    );
  }

  function getTool(toolId) {
    return tools.find((t) => String(t.id) === String(toolId)) || null;
  }

  function toolLabel(toolId) {
    const tool = getTool(toolId);
    if (!tool) return toolId || "-";

    const number =
      tool.number !== null && tool.number !== undefined && tool.number !== ""
        ? `T${tool.number}`
        : null;

    const name = tool.name || tool.description || tool.id || toolId || "Tool";
    return number ? `${number} · ${name}` : name;
  }

  function extractLengthOffset(op) {
    const sets = op.compensation?.sets || [];
    const lengthSet = sets.find((s) => s.id === "length");
    return lengthSet?.offsets?.[0]?.number ?? null;
  }

  function feedUnit(op) {
    return op.workplane?.unit === "in" ? "in/min" : "mm/min";
  }

  function sortToolGroups(a, b) {
    const ta = getTool(a.toolId);
    const tb = getTool(b.toolId);

    const na =
      ta?.number !== null && ta?.number !== undefined && ta?.number !== ""
        ? Number(ta.number)
        : Number.POSITIVE_INFINITY;

    const nb =
      tb?.number !== null && tb?.number !== undefined && tb?.number !== ""
        ? Number(tb.number)
        : Number.POSITIVE_INFINITY;

    if (na !== nb) return na - nb;

    return String(a.toolId || "").localeCompare(String(b.toolId || ""));
  }

  function groupOpsByTool(setupOps) {
    const map = new Map();

    for (const op of setupOps) {
      const toolId = extractToolId(op) || "__no_tool__";
      if (!map.has(toolId)) map.set(toolId, []);
      map.get(toolId).push(op);
    }

    return Array.from(map.entries())
      .map(([toolId, operations]) => ({ toolId, operations }))
      .sort(sortToolGroups);
  }

  container.innerHTML = `<h2>Intent</h2>`;

  for (const setup of setups) {
    const setupOps = ops.filter((op) => op.setupRef === setup.id);

    const section = document.createElement("div");
    section.style.marginBottom = "24px";

    const subtitleParts = [];
    if (setup.machine) subtitleParts.push(setup.machine);
    if (setup.work_offset) subtitleParts.push(`WCS ${setup.work_offset}`);

    section.innerHTML = `
      <h3>${setup.name || setup.id || "Setup"}</h3>
      <div style="margin-bottom:10px;color:#666;">
        ${subtitleParts.length ? subtitleParts.join(" • ") : ""}
      </div>
    `;

    const groups = groupOpsByTool(setupOps);

    if (!groups.length) {
      const empty = document.createElement("div");
      empty.textContent = "No operations in this setup.";
      section.appendChild(empty);
      container.appendChild(section);
      continue;
    }

    for (const group of groups) {
      const toolHeader = document.createElement("div");
      toolHeader.style.margin = "14px 0 6px 0";
      toolHeader.style.fontWeight = "600";
      toolHeader.textContent = toolLabel(group.toolId);
      section.appendChild(toolHeader);

      const table = document.createElement("table");
      table.style.width = "100%";
      table.style.borderCollapse = "collapse";
      table.style.marginBottom = "14px";
      table.innerHTML = `
        <thead>
          <tr style="border-bottom:1px solid #ccc;">
            <th align="left">Operation</th>
            <th align="left">SpindleDir</th>
            <th align="left">Spindle</th>
            <th align="left">Feed</th>
            <th align="left">Coolant</th>
            <th align="left">Length Offset</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;

      const tbody = table.querySelector("tbody");

      for (const op of group.operations) {
        const cc = op.cuttingConditions || {};
        const lengthOffset = extractLengthOffset(op);

        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid #eee";

        tr.innerHTML = `
          <td>${op.name || op.id || "-"}</td>
          <td>${cc.spindle_dir || "-"}</td>
          <td>${cc.spindle_rpm ? `${cc.spindle_rpm} rpm` : "-"}</td>
          <td>${cc.feed ? `${cc.feed} ${feedUnit(op)}` : "-"}</td>
          <td>${cc.coolant || "-"}</td>
          <td>${lengthOffset ? `H${lengthOffset}` : "-"}</td>
        `;

        tbody.appendChild(tr);
      }

      section.appendChild(table);
    }

    container.appendChild(section);
  }

  const assignedSetupIds = new Set(setups.map((s) => s.id));
  const unassignedOps = ops.filter(
    (op) => !op.setupRef || !assignedSetupIds.has(op.setupRef)
  );

  if (unassignedOps.length) {
    const section = document.createElement("div");
    section.style.marginBottom = "24px";
    section.innerHTML = `<h3>Unassigned Operations</h3>`;

    const groups = groupOpsByTool(unassignedOps);

    for (const group of groups) {
      const toolHeader = document.createElement("div");
      toolHeader.style.margin = "14px 0 6px 0";
      toolHeader.style.fontWeight = "600";
      toolHeader.textContent = toolLabel(group.toolId);
      section.appendChild(toolHeader);

      const table = document.createElement("table");
      table.style.width = "100%";
      table.style.borderCollapse = "collapse";
      table.style.marginBottom = "14px";
      table.innerHTML = `
        <thead>
          <tr style="border-bottom:1px solid #ccc;">
            <th align="left">Operation</th>
            <th align="left">SpindleDir</th>
            <th align="left">Spindle</th>
            <th align="left">Feed</th>
            <th align="left">Coolant</th>
            <th align="left">Length Offset</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;

      const tbody = table.querySelector("tbody");

      for (const op of group.operations) {
        const cc = op.cuttingConditions || {};
        const lengthOffset = extractLengthOffset(op);

        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid #eee";

        tr.innerHTML = `
          <td>${op.name || op.id || "-"}</td>
          <td>${cc.spindle_dir || "-"}</td>
          <td>${cc.spindle_rpm ? `${cc.spindle_rpm} rpm` : "-"}</td>
          <td>${cc.feed ? `${cc.feed} ${feedUnit(op)}` : "-"}</td>
          <td>${cc.coolant || "-"}</td>
          <td>${lengthOffset ? `H${lengthOffset}` : "-"}</td>
        `;

        tbody.appendChild(tr);
      }

      section.appendChild(table);
    }

    container.appendChild(section);
  }
}