// analytics/tool_usage.js
// ------------------------------------------------------------
// Aggregation bucket: toolId -> stats
// We'll wire this once job.xml tool mapping is plugged.
// ------------------------------------------------------------

import { addByKey } from "./model.js";

export function addOpResultToToolBucket(toolMap, opResult) {
  if (!toolMap || !opResult) return;

  const toolId = opResult.toolId ?? "UNKNOWN";
  const k = String(toolId);

  toolMap[k] ||= {
    toolId: opResult.toolId ?? null,
    opIds: [],
    lengths: { total: 0, byMotion: {} },
    timeSec: { total: 0, byMotion: {} },
  };

  const b = toolMap[k];
  if (Number.isFinite(opResult.opId)) b.opIds.push(opResult.opId);

  b.lengths.total += Number(opResult?.lengths?.total) || 0;
  b.timeSec.total += Number(opResult?.timeSec?.total) || 0;

  const lm = opResult?.lengths?.byMotion || {};
  for (const motion of Object.keys(lm)) addByKey(b.lengths.byMotion, motion, lm[motion]);

  const tm = opResult?.timeSec?.byMotion || {};
  for (const motion of Object.keys(tm)) addByKey(b.timeSec.byMotion, motion, tm[motion]);
}