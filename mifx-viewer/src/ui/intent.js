// src/ui/intent.js

import { state } from "../app/state.js";

export function renderIntent() {
  const container = document.getElementById("intentRoot");
  if (!container) return;

  const ops = (state.operations || [])
    .filter(op => op.setupRef === state.activeSetupId);

  const tools = state.tools || [];

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
    return tools.find(t => String(t.id) === String(toolId));
  }

  function extractLengthOffset(op) {
    const sets = op.compensation?.sets || [];
    const lengthSet = sets.find(s => s.id === "length");
    return lengthSet?.offsets?.[0]?.number ?? null;
  }

  container.innerHTML = `
    <h2>Intent</h2>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="border-bottom:1px solid #ccc;">
          <th align="left">Operation</th>
          <th align="left">Tool</th>
          <th align="left">SpindleDir</th>
          <th align="left">Spindle</th>
          <th align="left">Feed</th>
          <th align="left">Coolant</th>
          <th align="left">Length Offset</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;

  const tbody = container.querySelector("tbody");

  for (const op of ops) {
    const toolId = extractToolId(op);
    const tool = getTool(toolId);

    const cc = op.cuttingConditions || {};
    const unit = op.workplane?.unit === "in" ? "in/min" : "mm/min";
    const lengthOffset = extractLengthOffset(op);

    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid #eee";

    tr.innerHTML = `
      <td>${op.name || op.id}</td>
      <td>${tool?.name || toolId || "-"}</td>
      <td>${cc.spindle_dir || "-"}</td>
      <td>${cc.spindle_rpm ? cc.spindle_rpm + " rpm" : "-"}</td>
      <td>${cc.feed ? cc.feed + " " + unit : "-"}</td>
      <td>${cc.coolant || "-"}</td>
      <td>${lengthOffset ? "H" + lengthOffset : "-"}</td>
    `;

    tbody.appendChild(tr);
  }
}