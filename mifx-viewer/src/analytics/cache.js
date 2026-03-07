// analytics/cache.js
// ------------------------------------------------------------
// Simple 2-layer cache for op analytics:
// - in-memory Map (fast, per session)
// - localStorage (persist between reloads)
//
// Cache key includes artifact sha so if toolpath changes => cache miss.
// ------------------------------------------------------------

const MEM = (window.__analyticsMemCache ||= new Map());
const LS_PREFIX = "jobrun:analytics:v0:";

function _safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

export function makeAnalyticsKey({ jobId, opId, artifactSha256 }) {
  const j = Number(jobId);
  const o = Number(opId);
  const sha = String(artifactSha256 || "").trim();
  if (!Number.isFinite(j) || !Number.isFinite(o) || !sha) return null;
  return `${LS_PREFIX}${j}:${o}:${sha}`;
}

export function getCachedAnalytics(key) {
  if (!key) return null;

  // 1) memory
  if (MEM.has(key)) return MEM.get(key) || null;

  // 2) localStorage
  const raw = localStorage.getItem(key);
  if (!raw) return null;

  const obj = _safeJsonParse(raw);
  if (obj && typeof obj === "object") {
    MEM.set(key, obj);
    return obj;
  }
  return null;
}

export function setCachedAnalytics(key, value) {
  if (!key) return;
  if (!value || typeof value !== "object") return;

  MEM.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // localStorage might be full — ignore and keep mem cache
    console.warn("[analytics cache] localStorage set failed", e);
  }
}

export function clearAnalyticsCacheForJob(jobId) {
  const j = String(Number(jobId));
  // clear mem
  for (const k of Array.from(MEM.keys())) {
    if (k.includes(`${LS_PREFIX}${j}:`)) MEM.delete(k);
  }
  // clear localStorage (best effort)
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX) && k.includes(`${j}:`)) localStorage.removeItem(k);
    }
  } catch {}
}