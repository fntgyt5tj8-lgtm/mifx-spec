// analytics/summarize.js
// ------------------------------------------------------------
// Convert result objects into UI-friendly rows.
// Keep it dead simple for v0.
// ------------------------------------------------------------

export function summarizeOp(opResult) {
  if (!opResult) return [];

  const rows = [];

  rows.push({ label: "Total length", value: opResult.lengths.total });
  rows.push({ label: "Total time (sec)", value: opResult.timeSec.total });

  // motion breakdown (length)
  for (const k of Object.keys(opResult.lengths.byMotion || {})) {
    rows.push({ label: `Len ${k}`, value: opResult.lengths.byMotion[k] });
  }

  // motion breakdown (time)
  for (const k of Object.keys(opResult.timeSec.byMotion || {})) {
    rows.push({ label: `Time ${k}`, value: opResult.timeSec.byMotion[k] });
  }

  return rows;
}