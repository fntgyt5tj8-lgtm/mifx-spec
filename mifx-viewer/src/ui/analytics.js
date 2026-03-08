// src/ui/analytics.js
import { state } from "../app/state.js";
import { runOpAnalyticsAsync } from "../analytics/run_async.js";
import {
  makeAnalyticsKey,
  getCachedAnalytics,
  setCachedAnalytics,
} from "../analytics/cache.js";
import { loadToolpathsForOps } from "../core/mifx/load_toolpaths.js";

const $ = (sel, root = document) => root.querySelector(sel);

function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmt(v, digits = 1) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : "0";
}

function formatHMS(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h ${m}m ${ss}s`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}

function footerStatus(text) {
  const el = document.getElementById("statusVersion");
  if (el) el.textContent = String(text || "");
}

function ensureAnalyticsState() {
  if (!state.analytics) state.analytics = {};
  if (!(state.analytics.byOpId instanceof Map)) state.analytics.byOpId = new Map();
  return state.analytics;
}

function getTools() {
  return Array.isArray(state?.tools) ? state.tools : [];
}

function getJobSetups() {
  return Array.isArray(state?.job?.setups) ? state.job.setups : [];
}

function getAllOps() {
  return Array.isArray(state?.operations) ? state.operations : [];
}

function getSetupOps(setupId) {
  return getAllOps().filter((op) => op?.setupRef === setupId);
}

function getUnassignedOps() {
  const setupIds = new Set(getJobSetups().map((s) => s?.id));
  return getAllOps().filter((op) => !op?.setupRef || !setupIds.has(op.setupRef));
}

function getToolById(toolId) {
  return getTools().find((t) => String(t?.id) === String(toolId)) || null;
}

function toolLabelFromId(toolId) {
  const t = getToolById(toolId);
  if (!t) return String(toolId || "—");
  const num =
    t?.number !== null && t?.number !== undefined && t?.number !== "" ? `T${t.number}` : null;
  const desc = t?.description || t?.name || t?.id || "Tool";
  return num ? `${num} · ${desc}` : desc;
}

function setupSubtitle(setup) {
  const parts = [];
  if (setup?.machine) parts.push(setup.machine);
  if (setup?.work_offset) parts.push(`WCS ${setup.work_offset}`);
  if (!parts.length && setup?.description) parts.push(setup.description);
  return parts.join(" • ");
}

function getOpAnalytics(op) {
  if (op?.analytics) return op.analytics;

  const m = state?.analytics?.byOpId;
  if (m && typeof m.get === "function") {
    const hit = m.get(op?.id);
    if (hit) return hit;
  }
  return null;
}

function programUnitsToDistanceUnitLabel(units) {
  const u = String(units || "").trim().toUpperCase();
  if (u === "MM" || u === "METRIC" || u === "MILLIMETER" || u === "MILLIMETERS") return "mm";
  if (u === "IN" || u === "INCH" || u === "INCHES") return "in";
  return u ? u : "";
}

function opTimeSec(op) {
  const a = getOpAnalytics(op);
  if (!a) return 0;

  if (a?.cycle_time_sec != null) {
    const n = Number(a.cycle_time_sec);
    return Number.isFinite(n) ? n : 0;
  }

  const raw = a?._raw || a;
  if (raw?.timeSec?.total != null) {
    const n = Number(raw.timeSec.total);
    return Number.isFinite(n) ? n : 0;
  }

  return 0;
}

function opTimeByMotion(op) {
  const a = getOpAnalytics(op);
  if (!a) return {};

  const raw = a?._raw || a;
  const by = raw?.timeSec?.byMotion;
  return by && typeof by === "object" ? by : {};
}

function opDistanceTotal(op) {
  const a = getOpAnalytics(op);
  if (!a) return { val: null, unit: "" };

  if (a?.distance != null) {
    const n = Number(a.distance);
    return {
      val: Number.isFinite(n) ? n : null,
      unit: String(a.distance_unit || "").trim(),
    };
  }

  const raw = a?._raw || a;
  if (raw?.lengths?.total != null) {
    const n = Number(raw.lengths.total);
    return {
      val: Number.isFinite(n) ? n : null,
      unit: programUnitsToDistanceUnitLabel(raw.programUnits || raw?.lengths?.units),
    };
  }

  return { val: null, unit: "" };
}

function sumObj(obj) {
  let s = 0;
  for (const k of Object.keys(obj || {})) s += Number(obj[k]) || 0;
  return s;
}

function safePct(num, den) {
  const n = Number(num) || 0;
  const d = Number(den) || 0;
  if (d <= 0) return 0;
  return Math.max(0, Math.min(1, n / d));
}

function splitRapidVsCut(byMotion) {
  const rapid = Number(byMotion?.RAPID) || 0;
  const cut =
    (Number(byMotion?.FEED) || 0) +
    (Number(byMotion?.ARC) || 0) +
    (Number(byMotion?.HELIX) || 0) +
    (Number(byMotion?.PLUNGE) || 0) +
    (Number(byMotion?.RETRACT) || 0) +
    (Number(byMotion?.CYCLE_TRAVEL) || 0);

  const other = Math.max(0, sumObj(byMotion) - rapid - cut);
  const total = rapid + cut + other;
  return { rapid, cut, other, total };
}

async function ensureAnalyticsForOp(op, parsedMap) {
  const analyticsState = ensureAnalyticsState();
  if (!op?.id) return null;

  const parsed = parsedMap.get(op.id);
  if (!parsed?.motionPoints?.length || parsed.motionPoints.length < 2) return null;

  const key = makeAnalyticsKey({
    source: state.source,
    setupId: op.setupRef || null,
    opId: op.id,
  });

  const cached = getCachedAnalytics(key);
  if (cached) {
    op.analytics = cached;
    analyticsState.byOpId.set(op.id, cached);
    return cached;
  }

  const res = await runOpAnalyticsAsync({
    opId: op.id,
    setupId: op.setupRef || null,
    toolId: op.toolRef || null,
    motionPoints: parsed.motionPoints,
    unitsLinear: parsed.units || op?.workplane?.unit || "mm",
  });

  const summary = {
    cycle_time_sec: Number(res?.timeSec?.total) || 0,
    distance: Number(res?.lengths?.total) || 0,
    distance_unit: String(res?.programUnits || parsed.units || "").toUpperCase(),
    _raw: res,
  };

  op.analytics = summary;
  analyticsState.byOpId.set(op.id, summary);
  setCachedAnalytics(key, summary);
  return summary;
}

async function computeAllAnalytics(root) {
  const btn = document.getElementById("computeAnalyticsBtn");
  const infoEl = document.getElementById("computeAnalyticsInfo");

  const ops = getAllOps().filter((op) => op?.artifactRef?.role === "toolpath");
  if (!ops.length) {
    footerStatus("analytics: no toolpath operations");
    return;
  }

  if (btn) btn.disabled = true;
  const statusEl = $("#analyticsStatus", root);
  if (statusEl) statusEl.textContent = "Computing analytics...";
  footerStatus(`analytics: 0/${ops.length}`);

  let ok = 0;
  let fail = 0;

  const parsedMap = await loadToolpathsForOps(state.source, ops);

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    try {
      await ensureAnalyticsForOp(op, parsedMap);
      const t = opTimeSec(op);
      const d = opDistanceTotal(op)?.val;
      if (t > 0 || (Number.isFinite(d) && d > 0)) ok++;
      else fail++;
    } catch (err) {
      fail++;
      console.warn("[analytics] compute op failed", op?.id, err);
    }

    footerStatus(`analytics: ${i + 1}/${ops.length}`);
    if (infoEl) infoEl.textContent = `${i + 1}/${ops.length} (ok ${ok}, fail ${fail})`;
    if (statusEl) statusEl.textContent = `Computing ${i + 1}/${ops.length}...`;
    if ((i + 1) % 3 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  if (statusEl) statusEl.textContent = `Done (${ok} ok, ${fail} failed)`;
  footerStatus(`analytics: done (${ok} ok, ${fail} failed)`);
  if (btn) btn.disabled = false;

  renderAnalytics();
}

function renderSetupOverview(root) {
  const sumEl = $("#timeSummary", root);
  const wrap = $("#timeSetups", root);
  if (!sumEl || !wrap) return;

  wrap.innerHTML = "";

  const setups = getJobSetups();
  const unassigned = getUnassignedOps();
  const allOps = getAllOps();
  const jobTotalSec = allOps.reduce((acc, op) => acc + opTimeSec(op), 0);

  sumEl.innerHTML = `
    <p><b>Total job machining time:</b> ${esc(formatHMS(jobTotalSec))}</p>
    <p id="analyticsStatus"></p>
  `;

  const summaryTable = document.createElement("table");
  summaryTable.border = "1";
  summaryTable.cellPadding = "6";
  summaryTable.style.borderCollapse = "collapse";
  summaryTable.style.width = "100%";
  summaryTable.innerHTML = `
    <thead>
      <tr>
        <th>Setup</th>
        <th>Subtitle</th>
        <th>Operations</th>
        <th>Total Time</th>
        <th>Cut %</th>
        <th>Rapid %</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const summaryBody = $("tbody", summaryTable);

  function addSummaryRow(title, subtitle, ops) {
    const byMotion = {};
    let total = 0;

    for (const op of ops) {
      total += opTimeSec(op);
      const bm = opTimeByMotion(op);
      for (const k of Object.keys(bm || {})) {
        byMotion[k] = (byMotion[k] || 0) + (Number(bm[k]) || 0);
      }
    }

    const split = splitRapidVsCut(byMotion);
    const cutPct = (safePct(split.cut, split.total) * 100).toFixed(0);
    const rapidPct = (safePct(split.rapid, split.total) * 100).toFixed(0);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(title)}</td>
      <td>${esc(subtitle || "—")}</td>
      <td>${esc(ops.length)}</td>
      <td>${esc(formatHMS(total))}</td>
      <td>${esc(cutPct)}%</td>
      <td>${esc(rapidPct)}%</td>
    `;
    summaryBody.appendChild(tr);
  }

  for (const s of setups) {
    addSummaryRow(s.name || "Setup", setupSubtitle(s), getSetupOps(s.id));
  }
  if (unassigned.length) {
    addSummaryRow("Unassigned", "Operations not linked to a setup", unassigned);
  }

  wrap.appendChild(summaryTable);

  for (const s of setups) {
    renderSetupBlock(wrap, s.name || "Setup", setupSubtitle(s), getSetupOps(s.id));
  }
  if (unassigned.length) {
    renderSetupBlock(wrap, "Unassigned Operations", "Operations not linked to a setup", unassigned);
  }
}

function renderSetupBlock(parent, title, subtitle, ops) {
  const heading = document.createElement("h4");
  heading.textContent = title;
  parent.appendChild(heading);

  const meta = document.createElement("p");
  meta.textContent = subtitle || "—";
  parent.appendChild(meta);

  const table = document.createElement("table");
  table.border = "1";
  table.cellPadding = "6";
  table.style.borderCollapse = "collapse";
  table.style.width = "100%";
  table.style.marginBottom = "16px";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Operation</th>
        <th>ID</th>
        <th>Tool</th>
        <th>Machining Time</th>
        <th>Distance</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = $("tbody", table);
  for (const op of ops) {
    const d = opDistanceTotal(op);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(op.name || "—")}</td>
      <td>${esc(op.id || "")}</td>
      <td>${esc(toolLabelFromId(op.toolRef))}</td>
      <td>${esc(formatHMS(opTimeSec(op)))}</td>
      <td>${esc(d.val != null ? fmt(d.val, 3) : "—")} ${esc(d.unit || "")}</td>
    `;
    tbody.appendChild(tr);
  }

  parent.appendChild(table);
}

function renderDistanceByTool(root) {
  const sumEl = $("#distSummary", root);
  const wrap = $("#distGroups", root);
  if (!sumEl || !wrap) return;

  wrap.innerHTML = "";

  const tools = getTools();
  const allOps = getAllOps();

  const distByToolId = new Map();
  const timeByToolId = new Map();
  const byMotionTimeByToolId = new Map();
  let jobUnit = null;

  for (const op of allOps) {
    if (!op?.toolRef) continue;

    const d = opDistanceTotal(op);
    if (d.val !== null) {
      const unit = (d.unit || "").trim();
      if (!jobUnit && unit) jobUnit = unit;
      if (!jobUnit || !unit || unit === jobUnit) {
        distByToolId.set(op.toolRef, (distByToolId.get(op.toolRef) || 0) + (Number(d.val) || 0));
      }
    }

    const ts = opTimeSec(op);
    if (ts > 0) timeByToolId.set(op.toolRef, (timeByToolId.get(op.toolRef) || 0) + ts);

    const bm = opTimeByMotion(op);
    if (bm && typeof bm === "object") {
      const acc = byMotionTimeByToolId.get(op.toolRef) || {};
      for (const k of Object.keys(bm)) acc[k] = (acc[k] || 0) + (Number(bm[k]) || 0);
      byMotionTimeByToolId.set(op.toolRef, acc);
    }
  }

  const totalDist = Array.from(distByToolId.values()).reduce((a, x) => a + (Number(x) || 0), 0);
  const totalTime = Array.from(timeByToolId.values()).reduce((a, x) => a + (Number(x) || 0), 0);

  sumEl.innerHTML = `
    <p><b>Total tracked distance:</b> ${esc(fmt(totalDist, 3))} ${esc(jobUnit || "")}</p>
    <p><b>Total tracked time:</b> ${esc(formatHMS(totalTime))}</p>
  `;

  const table = document.createElement("table");
  table.border = "1";
  table.cellPadding = "6";
  table.style.borderCollapse = "collapse";
  table.style.width = "100%";
  table.style.marginBottom = "16px";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Tool</th>
        <th>Description</th>
        <th>Type</th>
        <th>Distance</th>
        <th>Time</th>
        <th>Wear</th>
        <th>Cut %</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = $("tbody", table);

  for (const t of tools) {
    const dist = distByToolId.get(t.id) || 0;
    const tsec = timeByToolId.get(t.id) || 0;

    const bm = byMotionTimeByToolId.get(t.id) || {};
    const split = splitRapidVsCut(bm);
    const cutPct = safePct(split.cut, split.total);

    const dpm = tsec > 0 ? dist / (tsec / 60) : 0;
    const severity = dpm * Math.sqrt(Math.max(1, tsec));

    let wearLabel = "Low";
    if (severity > 5000) wearLabel = "High";
    else if (severity > 1200) wearLabel = "Med";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(toolLabelFromId(t.id))}</td>
      <td>${esc(t.description || t.name || "—")}</td>
      <td>${esc(t.type || t.kind || "")}</td>
      <td>${esc(fmt(dist, 3))} ${esc(jobUnit || "")}</td>
      <td>${esc(formatHMS(tsec))}</td>
      <td>${esc(wearLabel)}</td>
      <td>${esc((cutPct * 100).toFixed(0))}%</td>
    `;
    tbody.appendChild(tr);
  }

  wrap.appendChild(table);

  renderFeedStrategyTable(wrap, allOps);
}

function renderFeedStrategyTable(parent, allOps) {
  const heading = document.createElement("h4");
  heading.textContent = "Feed Strategy Mix";
  parent.appendChild(heading);

  const fm = { IPM: 0, IPR: 0, MMPM: 0, MMPR: 0, OTHER: 0 };
  let hasFm = false;

  for (const op of allOps) {
    const a = getOpAnalytics(op);
    const raw = a?._raw || a;
    const c = raw?.debug?.feedModeCounts;
    if (!c || typeof c !== "object") continue;

    hasFm = true;
    for (const k of Object.keys(fm)) fm[k] += Number(c[k]) || 0;
    for (const k of Object.keys(c)) {
      if (!(k in fm)) fm.OTHER += Number(c[k]) || 0;
    }
  }

  if (!hasFm) {
    const p = document.createElement("p");
    p.textContent = "Feed mode distribution not exposed yet.";
    parent.appendChild(p);
    return;
  }

  const total = Math.max(1, Object.values(fm).reduce((a, x) => a + x, 0));
  const pct = (k) => 100 * (fm[k] / total);

  const table = document.createElement("table");
  table.border = "1";
  table.cellPadding = "6";
  table.style.borderCollapse = "collapse";
  table.style.width = "100%";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Mode</th>
        <th>Count</th>
        <th>Percent</th>
      </tr>
    </thead>
    <tbody>
      <tr><td>IPM</td><td>${esc(fm.IPM)}</td><td>${esc(pct("IPM").toFixed(0))}%</td></tr>
      <tr><td>IPR</td><td>${esc(fm.IPR)}</td><td>${esc(pct("IPR").toFixed(0))}%</td></tr>
      <tr><td>MMPM</td><td>${esc(fm.MMPM)}</td><td>${esc(pct("MMPM").toFixed(0))}%</td></tr>
      <tr><td>MMPR</td><td>${esc(fm.MMPR)}</td><td>${esc(pct("MMPR").toFixed(0))}%</td></tr>
      <tr><td>Other</td><td>${esc(fm.OTHER)}</td><td>${esc(pct("OTHER").toFixed(0))}%</td></tr>
    </tbody>
  `;
  parent.appendChild(table);
}

export function renderAnalytics() {
  const root = document.getElementById("analyticsRoot");
  if (!root) return;

  root.innerHTML = `
    <div>
      <h2>Analytics</h2>
      <p>MIFX package analytics across all operations.</p>
      <p>
        <button id="computeAnalyticsBtn" type="button">Compute Analytics</button>
        <span id="computeAnalyticsInfo"></span>
      </p>

      <h3>Machining Time</h3>
      <div id="timeSummary"></div>
      <div id="timeSetups"></div>

      <h3>Distance by Tool</h3>
      <div id="distSummary"></div>
      <div id="distGroups"></div>
    </div>
  `;

  const btn = document.getElementById("computeAnalyticsBtn");
  if (btn && !btn.__wired) {
    btn.__wired = true;
    btn.addEventListener("click", async () => {
      await computeAllAnalytics(root);
    });
  }

  renderSetupOverview(root);
  renderDistanceByTool(root);
}

window.renderAnalytics = renderAnalytics;
window.__computeAllAnalytics = computeAllAnalytics;