/**
 * POST /api/analyze
 * Triggers a full analysis run: market data -> selected AI models -> voting -> D1 save.
 *
 * Optional JSON body: { "models": ["llama-3.3-70b", "gemma-4-26b-a4b"] }
 * Ids are the `meta.provider` values from src/providers/*.js. No body (or an
 * invalid one) runs every model. See src/orchestrator/select-providers.js.
 */

import { runAnalysis } from "../../src/orchestrator/analysis.js";
import { MarketDataError } from "../../src/market/provider.js";
import { cleanupOldAnalyses, getLatestAnalysisTimestamp } from "../../src/lib/storage.js";

const DEFAULT_CANDLE_MS = 5 * 60 * 1000;

// "5m" -> 300000, "1h" -> 3600000. Falls back to 5 minutes on anything unexpected.
function timeframeToMs(timeframe) {
  const m = /^(\d+)([mhd])$/.exec(String(timeframe || "5m"));
  if (!m) return DEFAULT_CANDLE_MS;
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
  return Number(m[1]) * unit || DEFAULT_CANDLE_MS;
}

/**
 * Two guards against burning external AI providers API quota on redundant runs. Both compare
 * against the last SAVED analysis (failed runs are not saved, so they never block):
 *  1. Cooldown: minimum ANALYZE_COOLDOWN_SECONDS between runs (0 disables).
 *  2. Once per candle: refuse a second run inside the same candle bucket of
 *     TIMEFRAME, because the closed candles - and so the prompt - are identical.
 *     ANALYZE_ONCE_PER_CANDLE="0" disables.
 * Returns null when the run may proceed, otherwise { retryAfterSeconds, message }.
 */
async function checkRunGuards(env) {
  const cooldownSeconds = parseInt(env.ANALYZE_COOLDOWN_SECONDS ?? "60", 10);
  const oncePerCandle = (env.ANALYZE_ONCE_PER_CANDLE ?? "1") !== "0";
  if (!(cooldownSeconds > 0) && !oncePerCandle) return null;

  const lastCreatedAt = await getLatestAnalysisTimestamp(env.DB);
  if (!lastCreatedAt) return null;

  const now = Date.now();
  const lastMs = new Date(lastCreatedAt).getTime();
  if (!Number.isFinite(lastMs)) return null;

  let retryMs = 0;
  let message = "";

  if (cooldownSeconds > 0) {
    const remaining = cooldownSeconds * 1000 - (now - lastMs);
    if (remaining > 0) {
      retryMs = remaining;
      message = "Tunggu {s} detik sebelum menjalankan analisis berikutnya.";
    }
  }

  if (oncePerCandle) {
    const step = timeframeToMs(env.TIMEFRAME);
    const lastBucket = Math.floor(lastMs / step);
    const nowBucket = Math.floor(now / step);
    if (lastBucket === nowBucket) {
      const remaining = (nowBucket + 1) * step - now;
      if (remaining > retryMs) {
        retryMs = remaining;
        message = "Candle {tf} belum berganti sejak analisis terakhir. Tunggu {s} detik.";
      }
    }
  }

  if (retryMs <= 0) return null;

  const retryAfterSeconds = Math.ceil(retryMs / 1000);
  return {
    retryAfterSeconds,
    message: message.replace("{s}", String(retryAfterSeconds)).replace("{tf}", (env.TIMEFRAME || "5m").toUpperCase()),
  };
}

export async function onRequestPost(context) {
  const { env, waitUntil, request } = context;

  try {
    const blocked = await checkRunGuards(env);
    if (blocked) {
      // Same error_code as the plain cooldown so the dashboard needs no change.
      return json(
        429,
        {
          error_code: "COOLDOWN_ACTIVE",
          error: blocked.message,
          retry_after_seconds: blocked.retryAfterSeconds,
        },
        { "retry-after": String(blocked.retryAfterSeconds) }
      );
    }

    const models = await readRequestedModels(request);
    const result = await runAnalysis(env, (msg) => console.log(msg), { models });

    // Opportunistic retention cleanup, doesn't block the response (PRD Section 25).
    const retentionDays = parseInt(env.HISTORY_RETENTION_DAYS || "365", 10);
    if (waitUntil) {
      waitUntil(cleanupOldAnalyses(env.DB, retentionDays).catch((e) => console.error("cleanup failed", e)));
    }

    return json(200, result);
  } catch (err) {
    if (err instanceof MarketDataError) {
      return json(502, { error_code: "MARKET_DATA_ERROR", error: err.message });
    }
    console.error(err);
    return json(500, { error_code: "UNKNOWN_ERROR", error: err.message || "Unexpected server error." });
  }
}

export async function onRequestGet() {
  return json(405, { error: "Use POST to trigger an analysis." });
}

// Returns body.models if it is an array, otherwise undefined (= run all models).
// Filtering against the real registry happens in selectProviders().
async function readRequestedModels(request) {
  try {
    const body = await request.json();
    return Array.isArray(body?.models) ? body.models : undefined;
  } catch {
    return undefined; // empty body or invalid JSON
  }
}

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}
