// src/app/actions.js
import { state } from "./state.js";

import { loadJob } from "../core/mifx/load_job.js";
import { loadOperations } from "../core/mifx/load_operations.js";
import { loadSetups } from "../core/mifx/load_setups.js";
import { loadTools } from "../core/mifx/load_tools.js";
import { indexJob } from "../core/mifx/index_job.js";

export async function loadPackage(source) {
  if (state.source) {
    await state.source.close();
  }

  state.source = source;

  const job = await loadJob(source);
  job.setups = await loadSetups(source, job);
  job.operations = await loadOperations(source, job);

  state.tools = await loadTools(source);

  state.job = job;
  state.setups = job.setups;
  state.operations = job.operations;

  state.renderer?.setTools?.(state.tools);

  state.index = indexJob(job);
  state.activeSetupId = job.setups?.[0]?.id || null;

  console.log("[actions] normalized operations", {
    count: state.operations.length,
    withArtifactRef: state.operations.filter((o) => !!o.artifactRef?.path).length,
    withWorkplane: state.operations.filter((o) => !!o.workplane?.rows).length,
  });

  console.log("[actions] loaded setups", {
    count: state.setups?.length || 0,
    setupIds: (state.setups || []).map((s) => s?.id),
    artifactCounts: (state.setups || []).map((s) => ({
      id: s?.id,
      artifacts: Array.isArray(s?.artifacts) ? s.artifacts.length : 0,
    })),
  });
}