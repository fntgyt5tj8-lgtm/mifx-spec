// src/core/mifx/load_toolpaths.js
import { parseAptCl as parseAptClModule } from "../toolpath/apt_parser.js";

function extOf(path) {
  const p = String(path || "");
  const i = p.lastIndexOf(".");
  return i >= 0 ? p.slice(i + 1).toLowerCase() : "";
}

function _getParser() {
  const g = typeof window !== "undefined" ? window : null;
  const fn = g && typeof g.parseAptCl === "function" ? g.parseAptCl : null;
  return fn || parseAptClModule;
}

function _normParsed(parsed) {
  if (!parsed || typeof parsed !== "object") return null;

  const motionPoints = Array.isArray(parsed.motionPoints)
    ? parsed.motionPoints
    : Array.isArray(parsed.points)
      ? parsed.points
      : [];

  const renderPoints = Array.isArray(parsed.renderPoints)
    ? parsed.renderPoints
    : Array.isArray(parsed.flatPoints)
      ? parsed.flatPoints
      : motionPoints;

  const events = Array.isArray(parsed.events) ? parsed.events : [];

  const units =
    parsed.units ||
    parsed.unit ||
    parsed.header?.units ||
    parsed.meta?.units ||
    "MM";

  return {
    ...parsed,
    units,
    motionPoints,
    renderPoints,
    events,
  };
}

function findToolpathArtifact(op) {
  if (op?.artifactRef?.path) return op.artifactRef;

  const arts = op?.artifacts;
  if (!Array.isArray(arts)) return null;

  for (const a of arts) {
    if (!a || typeof a !== "object") continue;
    if (a.role === "toolpath") return a;
  }

  return null;
}

export async function loadToolpathsForOps(source, ops) {
  const out = new Map();
  const parseAptCl = _getParser();

  for (const op of ops || []) {
    try {
      const ar = findToolpathArtifact(op);
      if (!ar?.path || ar.present === false) continue;

      const ext = (ar.kind || extOf(ar.path) || "").toLowerCase();
      if (ext !== "apt" && ext !== "cl" && ext !== "cls" && ext !== "txt") continue;

      const text = await source.getText(ar.path);
      if (!text) continue;

      const parsedRaw = parseAptCl(text);
      const parsed = _normParsed(parsedRaw);
      if (!parsed) continue;

      out.set(op.id, parsed);
    } catch (err) {
      console.warn(`[load_toolpaths] parse failed for op ${op?.id}:`, err);
    }
  }

  return out;
}