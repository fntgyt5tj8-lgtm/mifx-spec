// src/app/actions.js
import { state } from "./state.js";

import { loadJob } from "../core/mifx/load_job.js";
import { loadOperations } from "../core/mifx/load_operations.js";
import { loadSetups } from "../core/mifx/load_setups.js";
import { loadTools } from "../core/mifx/load_tools.js"; // ✅ NEW
import { indexJob } from "../core/mifx/index_job.js";

export async function loadPackage(source) {
  if (state.source) {
    await state.source.close();
  }

  state.source = source;

  // 1) load job (refs)
  const job = await loadJob(source);

  // 2) resolve setups (full setup json with transform.rows)
  job.setups = await loadSetups(source, job);

  // 3) load operations and attach to job BEFORE indexing (3A)
  job.operations = await loadOperations(source);

  // ✅ 4) load tools (manifest.trace.entities.tools)
  state.tools = await loadTools(source);

  // store canonical job + ops
  state.job = job;
  state.operations = job.operations;

  // ✅ push tools into renderer if it already exists
  state.renderer?.setTools?.(state.tools);

  // 5) build index from fully-resolved job
  state.index = indexJob(job);

  // 6) pick default active setup
  const firstSetup = job.setups?.[0]?.id || null;
  state.activeSetupId = firstSetup;
}