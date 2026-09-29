/**
 * POST /api/cleanup
 * Manually trigger retention cleanup (PRD Section 25). Also invoked
 * opportunistically after every /api/analyze call. Expose this as a
 * scheduled Cron Trigger target if you want it to run independently of
 * analysis runs (Pages Functions themselves don't support Cron Triggers —
 * see README "Scheduled cleanup" for the tiny standalone Worker needed).
 */

import { cleanupOldAnalyses } from "../../src/lib/storage.js";

export async function onRequestPost(context) {
  const { env } = context;
  const retentionDays = parseInt(env.HISTORY_RETENTION_DAYS || "365", 10);
  try {
    const deleted = await cleanupOldAnalyses(env.DB, retentionDays);
    return json(200, { deleted, retention_days: retentionDays });
  } catch (err) {
    return json(500, { error_code: "UNKNOWN_ERROR", error: err.message });
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
