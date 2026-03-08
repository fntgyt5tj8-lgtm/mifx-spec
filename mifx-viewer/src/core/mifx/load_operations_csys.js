// src/core/mifx/load_operations_csys.js

function findOperationCsysArtifact(op) {
  const arts = Array.isArray(op?.artifacts) ? op.artifacts : [];
  return (
    arts.find(
      (a) =>
        a &&
        typeof a === "object" &&
        a.role === "operation_csys" &&
        a.path &&
        a.present !== false
    ) || null
  );
}

export async function loadOperationCsys(source, op) {
  const art = findOperationCsysArtifact(op);
  if (!art?.path) return null;

  try {
    const payload = await source.getJson(art.path);
    return payload || null;
  } catch (err) {
    console.warn("[load_operation_csys] failed", op?.id, art?.path, err);
    return null;
  }
}