/**
 * POST /api/analyze
 *
 * Alur: lock run -> run guards (cooldown + once-per-candle) -> validasi
 * pilihan provider -> runAnalysis -> balas hasil. Lock dilepas di `finally`.
 *
 * Kode status:
 *   200 sukses
 *   400 INVALID_PROVIDER_SELECTION  (body.models bukan tepat 6 provider unik)
 *   422 INSUFFICIENT_PROVIDERS / NO_PROVIDER_ENABLED  (provider aktif kurang;
 *       dilempar runAnalysis sebelum ada call AI, tidak ada yang disimpan)
 *   429 COOLDOWN_ACTIVE | ANALYSIS_IN_PROGRESS  (+ retry_after_seconds)
 *   502 MARKET_DATA_ERROR
 *   500 UNKNOWN_ERROR
 */
import { runAnalysis } from "../../src/orchestrator/analysis.js";
import { AnalysisConfigError } from "../../src/orchestrator/errors.js";
import { MarketDataError } from "../../src/market/provider.js";
import { cleanupOldAnalyses, getLatestAnalysisTimestamp } from "../../src/lib/storage.js";
import { acquireAnalyzeLock } from "../../src/lib/analyzeLock.js";

const REQUIRED_PROVIDERS = 6;
const DEFAULT_LOCK_TTL_SECONDS = 180;

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const timeframeMs = tf => {
  const m = /^(\d+)([mhd])$/.exec(String(tf || "5m"));
  return m ? Number(m[1]) * { m: 60000, h: 3600000, d: 86400000 }[m[2]] : 300000;
};

/**
 * Cooldown + once-per-candle, dibandingkan dengan analisis tersimpan terakhir.
 * @returns {Promise<{retryAfterSeconds: number} | null>} null = boleh lanjut
 */
async function runGuard(env) {
  const cooldown = parseInt(env.ANALYZE_COOLDOWN_SECONDS ?? "60", 10);
  const oncePerCandle = (env.ANALYZE_ONCE_PER_CANDLE ?? "1") !== "0";
  if (!(cooldown > 0) && !oncePerCandle) return null;

  const last = await getLatestAnalysisTimestamp(env.DB);
  if (!last) return null;

  const now = Date.now();
  const lastMs = Date.parse(last);
  const step = timeframeMs(env.TIMEFRAME);
  let waitMs = 0;

  if (cooldown > 0) waitMs = Math.max(waitMs, cooldown * 1000 - (now - lastMs));
  if (oncePerCandle && Math.floor(now / step) === Math.floor(lastMs / step)) {
    waitMs = Math.max(waitMs, (Math.floor(now / step) + 1) * step - now);
  }

  return waitMs > 0 ? { retryAfterSeconds: Math.ceil(waitMs / 1000) } : null;
}

async function readRequestedModels(request) {
  try {
    const body = await request.json();
    return Array.isArray(body?.models) ? body.models : undefined;
  } catch {
    return undefined;
  }
}

export async function onRequestPost({ env, waitUntil, request }) {
  let lock;
  try {
    const ttl = parseInt(env.ANALYZE_LOCK_TTL_SECONDS ?? String(DEFAULT_LOCK_TTL_SECONDS), 10);
    lock = await acquireAnalyzeLock(env.DB, { ttlSeconds: ttl > 0 ? ttl : DEFAULT_LOCK_TTL_SECONDS });
    if (!lock.acquired) {
      return json(
        429,
        {
          error_code: "ANALYSIS_IN_PROGRESS",
          error: `Analisis lain sedang berjalan. Coba lagi dalam ${lock.retryAfterSeconds} detik.`,
          retry_after_seconds: lock.retryAfterSeconds
        },
        { "retry-after": String(lock.retryAfterSeconds) }
      );
    }

    const blocked = await runGuard(env);
    if (blocked) {
      return json(
        429,
        {
          error_code: "COOLDOWN_ACTIVE",
          error: `Candle belum berganti. Tunggu ${blocked.retryAfterSeconds} detik.`,
          retry_after_seconds: blocked.retryAfterSeconds
        },
        { "retry-after": String(blocked.retryAfterSeconds) }
      );
    }

    const requestedModels = await readRequestedModels(request);
    if (requestedModels) {
      const unique = [...new Set(requestedModels.filter(x => typeof x === "string" && x.trim()))];
      if (unique.length !== REQUIRED_PROVIDERS) {
        return json(400, {
          error_code: "INVALID_PROVIDER_SELECTION",
          error: "Pilih tepat 6 provider AI untuk satu tugas analisis.",
          required_providers: REQUIRED_PROVIDERS,
          selected_providers: unique.length
        });
      }
    }

    const result = await runAnalysis(env, console.log, { models: requestedModels });

    if (waitUntil) {
      const retention = parseInt(env.HISTORY_RETENTION_DAYS ?? "365", 10);
      waitUntil(cleanupOldAnalyses(env.DB, retention > 0 ? retention : 365));
    }
    return json(200, result);
  } catch (e) {
    if (e instanceof MarketDataError) return json(502, { error_code: "MARKET_DATA_ERROR", error: e.message });
    if (e instanceof AnalysisConfigError) {
      return json(422, { error_code: e.error_code, error: e.message, ...e.details });
    }
    return json(500, { error_code: "UNKNOWN_ERROR", error: e.message });
  } finally {
    await lock?.release();
  }
}
