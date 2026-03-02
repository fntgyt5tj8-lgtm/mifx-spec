// src/core/mifx/load_toolpaths.js
import { parseAptCl as parseAptClModule } from "../toolpath/apt_parser.js";

function extOf(path) {
  const p = String(path || "");
  const i = p.lastIndexOf(".");
  return i >= 0 ? p.slice(i + 1).toLowerCase() : "";
}

function _getParser() {
  // Prefer JobRun global parser if you loaded toolpath_apt.js as a classic script
  const g = (typeof window !== "undefined") ? window : null;
  const fn = g && typeof g.parseAptCl === "function" ? g.parseAptCl : null;
  return fn || parseAptClModule;
}

function _normParsed(parsed) {
  // We normalize to the fields your ThreeRenderer expects.
  // Keep any extra fields from the parser as-is.
  if (!parsed || typeof parsed !== "object") return null;

  const motionPoints = Array.isArray(parsed.motionPoints)
    ? parsed.motionPoints
    : (Array.isArray(parsed.points) ? parsed.points : []);

  const renderPoints = Array.isArray(parsed.renderPoints)
    ? parsed.renderPoints
    : (Array.isArray(parsed.flatPoints) ? parsed.flatPoints : motionPoints);

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

export async function loadToolpathsForOps(source, ops) {
  const out = new Map();
  const parseAptCl = _getParser();

  for (const op of ops || []) {
    try {
      const ar = op?.artifactRef;
      if (!ar?.path || ar.present === false) continue;

      const ext = (ar.kind || extOf(ar.path) || "").toLowerCase();
      if (ext !== "apt" && ext !== "cl" && ext !== "cls" && ext !== "txt") continue;

      if (typeof source?.getText !== "function") {
        console.warn("Toolpath loader: source.getText is missing", source);
        continue;
      }

      const text = await source.getText(ar.path);
      if (!text) continue;

      const parsedRaw = parseAptCl(text);
      const parsed = _normParsed(parsedRaw);
      if (!parsed) continue;

      out.set(op.id, parsed);
    } catch (err) {
      console.warn(`Toolpath parse failed for op ${op?.id}:`, err);
    }
  }

  // Debug once, then delete if you want
  // console.log("Toolpaths parsed:", out.size, "parser=", _getParser().name || "anon");

  return out;
}