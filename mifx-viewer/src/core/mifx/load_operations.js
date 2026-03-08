// src/core/mifx/load_operations.js
import { loadOperationCsys } from "./load_operations_csys.js";

function findArtifactByRole(op, role) {
  const arts = Array.isArray(op?.artifacts) ? op.artifacts : [];
  return (
    arts.find(
      (a) =>
        a &&
        typeof a === "object" &&
        a.role === role &&
        a.path &&
        a.present !== false
    ) || null
  );
}

export async function loadOperations(source, job = null) {
  const out = [];
  const refs = Array.isArray(job?.operations) ? job.operations : [];

  for (const ref of refs) {
    const path = ref?.path;
    if (!path) continue;

    let op = null;
    try {
      op = await source.getJson(path);
    } catch (err) {
      console.warn("[load_operations] failed operation json", path, err);
      continue;
    }

    if (!op || typeof op !== "object") continue;

    const toolpathArt = findArtifactByRole(op, "toolpath");
    if (toolpathArt) {
      op.artifactRef = toolpathArt;
    } else {
      op.artifactRef = null;
    }

    const csysPayload = await loadOperationCsys(source, op);
    op.operationCsys = csysPayload || null;
    op.opCsys = csysPayload?.transform || null;
    op.workplane = csysPayload?.transform || null;

    out.push(op);
  }

  console.log("[load_operations] result", {
    refs: refs.length,
    loaded: out.length,
    withArtifactRef: out.filter((o) => !!o.artifactRef?.path).length,
    withWorkplane: out.filter((o) => !!o.workplane?.rows).length,
  });

  return out;
}