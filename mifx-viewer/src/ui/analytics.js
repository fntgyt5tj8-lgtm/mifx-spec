// src/ui/analytics.js
import { state } from "../app/state.js";
import { runOpAnalyticsAsync } from "../analytics/run_async.js";
import {
  makeAnalyticsKey,
  getCachedAnalytics,
  setCachedAnalytics,
} from "../analytics/cache.js";

export async function renderAnalytics() {
  const root = document.getElementById("analyticsRoot");
  if (!root) return;

  const opId = state.activeOpId || null;
  if (!opId) {
    root.innerHTML = "<h2>Analytics</h2><div>No operation selected</div>";
    return;
  }

  const key = makeAnalyticsKey({
    source: state.source,
    setupId: state.activeSetupId,
    opId,
  });

  const cached = getCachedAnalytics(key);
  if (cached) {
    root.innerHTML =
      cached.html || "<pre>" + JSON.stringify(cached, null, 2) + "</pre>";
    return;
  }

  root.innerHTML = "<h2>Analytics</h2><div>Computing…</div>";

  const res = await runOpAnalyticsAsync({
    source: state.source,
    job: state.job,
    operations: state.operations,
    setupId: state.activeSetupId,
    opId,
  });

  const html = `
    <h2>Analytics</h2>
    <div><b>opId:</b> ${opId}</div>
    <pre style="white-space:pre-wrap">${JSON.stringify(res, null, 2)}</pre>
  `;

  setCachedAnalytics(key, { html, res });
  root.innerHTML = html;
}