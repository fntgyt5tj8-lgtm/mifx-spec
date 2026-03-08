// src/core/mifx/index_job.js
export function indexJob(job) {
  const setups = new Map();
  const opsBySetup = new Map();

  for (const s of job.setups || []) {
    setups.set(s.id, s);
    opsBySetup.set(s.id, []);
  }

  for (const op of job.operations || []) {
    const sid = op.setupRef;
    if (!opsBySetup.has(sid)) {
      opsBySetup.set(sid, []);
    }
    opsBySetup.get(sid).push(op);
  }

  return {
    setups,
    opsBySetup,
  };
}