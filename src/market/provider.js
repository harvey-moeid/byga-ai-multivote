/**
 * MarketProvider abstraction.
 * Fetches the current live timeframe (M5 by default) plus cached/backfilled
 * multi-timeframe history (M15, H1, H4, D1) for long-context AI analysis.
 *
 * The exchange chain is [primary, ...fallbacks]. FALLBACK_EXCHANGE may hold
 * one name or a comma-separated list (e.g. "bybit,okx"); each exchange is
 * tried in order and everything (live + history) is retried on the next one.
 *
 * If EVERY live fetch fails (most often HTTP 403 - exchange WAFs can block
 * Cloudflare's IP ranges), the last snapshot stored in D1 by POST /api/ingest
 * is used instead, as long as it isn't too stale.
 */

import { fetchBinanceFutures } from "./binance.js";
import { fetchBybitLinear } from "./bybit.js";
import { fetchOkxSwap } from "./okx.js";
import { getHistoricalCandles } from "./history.js";
import { getLiveSnapshot } from "./liveSnapshotStore.js";

const PROVIDERS = {
  binance: fetchBinanceFutures,
  bybit: fetchBybitLinear,
  okx: fetchOkxSwap,
};

const HISTORY_TIMEFRAMES = [
  { key: "history_m15", timeframe: "15m", daysConfig: "M15_HISTORY_DAYS", defaultDays: 4 },
  { key: "history_h1", timeframe: "1h", daysConfig: "H1_HISTORY_DAYS", defaultDays: 30 },
  { key: "history_h4", timeframe: "4h", daysConfig: "H4_HISTORY_DAYS", defaultDays: 180 },
  { key: "history_1d", timeframe: "1d", daysConfig: "DAILY_HISTORY_DAYS", defaultDays: 365 },
];

// A pushed snapshot is only used as a stand-in for a live fetch while it's
// fresher than this (same freshness multiplier convention as history.js).
const LIVE_SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;

/** "bybit,okx" | ["bybit","okx"] -> valid, de-duplicated fallback names (primary excluded). */
function parseFallbacks(fallback, primary) {
  const list = Array.isArray(fallback) ? fallback : String(fallback || "").split(",");
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const name = String(raw).trim().toLowerCase();
    if (!name || name === primary || seen.has(name) || !PROVIDERS[name]) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export async function getMarketSnapshot(config) {
  const { primary, fallback, symbol, marketType, timeframe, candleLimit, db, env } = config;
  const primaryFn = PROVIDERS[primary];

  if (!primaryFn) {
    throw new MarketDataError(`Unknown primary exchange: ${primary}`);
  }

  try {
    const current = await primaryFn({ symbol, marketType, timeframe, candleLimit });
    const history = await fetchAllHistory({ db, env, exchange: primary, symbol });
    return { ...current, exchange: primary, ...history };
  } catch (primaryErr) {
    const fallbacks = parseFallbacks(fallback, primary);

    if (fallbacks.length === 0) {
      return await useCachedSnapshotOrThrow({
        db,
        env,
        symbol,
        timeframe,
        message: `Primary exchange "${primary}" failed and no valid fallback configured: ${primaryErr.message}`,
      });
    }

    const fallbackErrors = [];
    for (const name of fallbacks) {
      try {
        const current = await PROVIDERS[name]({ symbol, marketType, timeframe, candleLimit });
        const history = await fetchAllHistory({ db, env, exchange: name, symbol });
        return {
          ...current,
          exchange: name,
          fallback_used: true,
          primary_error: primaryErr.message,
          ...history,
        };
      } catch (err) {
        fallbackErrors.push(`fallback(${name}): ${err.message}`);
      }
    }

    const prefix = fallbacks.length === 1 ? "Both exchanges failed." : "All exchanges failed.";
    return await useCachedSnapshotOrThrow({
      db,
      env,
      symbol,
      timeframe,
      message: `${prefix} primary(${primary}): ${primaryErr.message} | ${fallbackErrors.join(" | ")}`,
    });
  }
}

// Last resort when a live fetch isn't possible: fall back to the most
// recent snapshot pushed into D1 via /api/ingest, if it's still fresh
// enough. Otherwise throw the live-fetch failure so callers see the same
// MarketDataError as when no cache exists.
async function useCachedSnapshotOrThrow({ db, env, symbol, timeframe, message }) {
  if (db) {
    try {
      const cached = await getLiveSnapshot(db, { symbol, timeframe });
      if (cached) {
        const ageMs = Date.now() - new Date(cached.fetched_at).getTime();
        if (ageMs <= LIVE_SNAPSHOT_MAX_AGE_MS) {
          let history;
          try {
            history = await fetchAllHistory({ db, env, exchange: cached.exchange, symbol });
          } catch (historyErr) {
            console.error(`history fetch failed while using cached live snapshot: ${historyErr.message}`);
            history = emptyHistory();
          }
          return {
            symbol,
            market_type: "perpetual",
            timeframe,
            timestamp: new Date().toISOString(),
            last_price: cached.last_price,
            price_change_pct_24h: cached.price_change_pct_24h,
            volume_24h: cached.volume_24h,
            candles: cached.candles,
            exchange: cached.exchange,
            cached_snapshot_used: true,
            cached_snapshot_age_seconds: Math.round(ageMs / 1000),
            live_fetch_error: message,
            ...history,
          };
        }
      }
    } catch (cacheErr) {
      console.error(`live snapshot cache read failed: ${cacheErr.message}`);
    }
  }

  throw new MarketDataError(message);
}

function emptyHistory() {
  const out = {};
  for (const tf of HISTORY_TIMEFRAMES) {
    out[tf.key] = [];
    out[`${tf.key}_source`] = "unavailable";
    out[`${tf.key}_days`] = 0;
  }
  out.history_1y = out.history_1d;
  out.history_days = 0;
  return out;
}

async function fetchAllHistory({ db, env, exchange, symbol }) {
  const out = {};
  for (const tf of HISTORY_TIMEFRAMES) {
    const days = parseInt(env?.[tf.daysConfig] || String(tf.defaultDays), 10);
    const { candles, source } = await getHistoricalCandles({
      db,
      exchange,
      symbol,
      timeframe: tf.timeframe,
      days,
    });
    out[tf.key] = candles;
    out[`${tf.key}_source`] = source;
    out[`${tf.key}_days`] = days;
  }
  // Legacy aliases kept for anything still reading the pre-multi-timeframe fields.
  out.history_1y = out.history_1d;
  out.history_days = out.history_1d.length;
  return out;
}

export class MarketDataError extends Error {
  constructor(message) {
    super(message);
    this.name = "MarketDataError";
    this.error_code = "MARKET_DATA_ERROR";
  }
}
