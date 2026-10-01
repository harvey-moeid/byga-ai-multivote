import { fetchBinanceFutures } from "./binance.js";
import { fetchBybitLinear } from "./bybit.js";
import { fetchOkxSwap } from "./okx.js";
import { getHistoricalCandles } from "./history.js";
import { getLiveSnapshot } from "./liveSnapshotStore.js";
import { getChartDbSnapshot, ChartDbUnavailableError } from "./chartDbProvider.js";

const PROVIDERS = { binance: fetchBinanceFutures, bybit: fetchBybitLinear, okx: fetchOkxSwap };

const HISTORY_TIMEFRAMES = [
  { key: "history_m15", timeframe: "15m", daysConfig: "M15_HISTORY_DAYS", defaultDays: 4 },
  { key: "history_h1", timeframe: "1h", daysConfig: "H1_HISTORY_DAYS", defaultDays: 30 },
  { key: "history_h4", timeframe: "4h", daysConfig: "H4_HISTORY_DAYS", defaultDays: 180 },
  { key: "history_1d", timeframe: "1d", daysConfig: "DAILY_HISTORY_DAYS", defaultDays: 365 },
];

const LIVE_SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;

function parseFallbacks(fallback, primary) {
  const list = Array.isArray(fallback) ? fallback : String(fallback || "").split(",");
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const n = String(raw).trim().toLowerCase();
    if (n && n !== primary && !seen.has(n) && PROVIDERS[n]) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

function resolveHistoryConfig(env) {
  return HISTORY_TIMEFRAMES.map((tf) => ({
    key: tf.key,
    timeframe: tf.timeframe,
    days: parseInt(env?.[tf.daysConfig] || String(tf.defaultDays), 10),
  }));
}

/**
 * Market data entry point used by the orchestrator.
 *
 * Primary source: chart_db (config.chartDb — env.CHART_DB binding), read-only,
 * covers M5 (live) + M15/H1/H4(aggregated)/D1 history in one place.
 *
 * If chart_db is not configured, unreachable, or its latest M5 candle is
 * stale, this falls back unchanged to the original live exchange chain
 * (primary exchange -> configured fallbacks -> cached live_ticker snapshot).
 */
export async function getMarketSnapshot(config) {
  const { primary, fallback, symbol, marketType, timeframe, candleLimit, db, env, chartDb } = config;

  if (chartDb) {
    try {
      return await getChartDbSnapshot({
        chartDb,
        symbol,
        marketType,
        candleLimit,
        historyConfig: resolveHistoryConfig(env),
      });
    } catch (err) {
      const reason = err instanceof ChartDbUnavailableError ? err.message : `unexpected chart_db error: ${err.message}`;
      console.error(`chart_db snapshot unavailable, falling back to live exchange chain: ${reason}`);
    }
  }

  const fn = PROVIDERS[primary];
  if (!fn) throw new MarketDataError(`Unknown primary exchange: ${primary}`);
  try {
    const current = await fn({ symbol, marketType, timeframe, candleLimit });
    const history = await fetchAllHistory({ db, env, exchange: primary, symbol });
    return { ...current, exchange: primary, ...history };
  } catch (primaryErr) {
    const fallbacks = parseFallbacks(fallback, primary);
    if (!fallbacks.length) {
      return useCachedSnapshotOrThrow({
        db,
        env,
        symbol,
        timeframe,
        message: `Primary exchange "${primary}" failed and no valid fallback configured: ${primaryErr.message}`,
      });
    }
    const errors = [];
    for (const name of fallbacks) {
      try {
        const current = await PROVIDERS[name]({ symbol, marketType, timeframe, candleLimit });
        const history = await fetchAllHistory({ db, env, exchange: name, symbol });
        return { ...current, exchange: name, fallback_used: true, primary_error: primaryErr.message, ...history };
      } catch (err) {
        errors.push(`fallback(${name}): ${err.message}`);
      }
    }
    return useCachedSnapshotOrThrow({
      db,
      env,
      symbol,
      timeframe,
      message: `${fallbacks.length === 1 ? "Both exchanges failed." : "All exchanges failed."} primary(${primary}): ${primaryErr.message} | ${errors.join(" | ")}`,
    });
  }
}

async function useCachedSnapshotOrThrow({ db, env, symbol, timeframe, message }) {
  if (db) {
    try {
      const cached = await getLiveSnapshot(db, { symbol, timeframe });
      if (cached) {
        const age = Date.now() - Date.parse(cached.fetched_at);
        if (age <= LIVE_SNAPSHOT_MAX_AGE_MS) {
          let history;
          try {
            history = await fetchAllHistory({ db, env, exchange: cached.exchange, symbol });
          } catch {
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
            cached_snapshot_age_seconds: Math.round(age / 1000),
            live_fetch_error: message,
            ...history,
          };
        }
      }
    } catch {}
  }
  throw new MarketDataError(message);
}

function emptyHistory() {
  const o = {};
  for (const t of HISTORY_TIMEFRAMES) {
    o[t.key] = [];
    o[`${t.key}_source`] = "unavailable";
    o[`${t.key}_days`] = 0;
  }
  o.history_1y = o.history_1d;
  o.history_days = 0;
  return o;
}

async function fetchAllHistory({ db, env, exchange, symbol }) {
  const out = {};
  for (const tf of HISTORY_TIMEFRAMES) {
    const days = parseInt(env?.[tf.daysConfig] || String(tf.defaultDays), 10);
    try {
      const r = await getHistoricalCandles({ db, exchange, symbol, timeframe: tf.timeframe, days });
      out[tf.key] = r.candles;
      out[`${tf.key}_source`] = r.source;
      out[`${tf.key}_days`] = days;
    } catch {
      out[tf.key] = [];
      out[`${tf.key}_source`] = "unavailable";
      out[`${tf.key}_days`] = days;
    }
  }
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
