/**
 * Primary market data source: `chart_db` — a separate Cloudflare D1
 * database owned by the `byga-chart` project
 * (https://github.com/harvey-moeid/byga-chart), ingested there every
 * 5 minutes by a Cloudflare Cron Trigger (Bybit, symbols BTCUSDT /
 * ETHUSDT / XAUUSDT, timeframes M5 / M15 / H1 / D1).
 *
 * READ-ONLY from this project: this file only ever runs SELECT against
 * chart_db. All writes to chart_db stay inside byga-chart's own ingest
 * pipeline — nothing here does INSERT/UPDATE/DELETE.
 *
 * chart_db has no H4 candles, so H4 history is built here by aggregating
 * 4 consecutive H1 candles. chart_db also has no derivatives data
 * (funding rate / open interest / basis) — those fields are simply
 * absent from the returned snapshot (see src/prompt/builder.js, which
 * only adds a `derivatives` block when the snapshot has one).
 *
 * If chart_db is unreachable, has no M5 rows, or its latest M5 candle is
 * older than M5_FRESHNESS_MS (chart_db's own ingest cron did not run
 * recently), this throws ChartDbUnavailableError. The caller
 * (src/market/provider.js) catches that and falls back to the live
 * exchange chain (Binance -> Bybit -> OKX) unchanged.
 */

const CHART_DB_TIMEFRAME = { "5m": "M5", "15m": "M15", "1h": "H1", "1d": "D1" }; // no "4h" entry on purpose
const INTERVAL_MS = { "5m": 300000, "15m": 900000, "1h": 3600000, "4h": 14400000, "1d": 86400000 };
const M5_FRESHNESS_MS = 15 * 60 * 1000; // chart_db's own ingest cron runs every 5 min; allow up to 3 misses
const DAY_MS = 24 * 60 * 60 * 1000;

export class ChartDbUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "ChartDbUnavailableError";
  }
}

/**
 * @param {Object} params
 * @param {D1Database} params.chartDb      env.CHART_DB binding
 * @param {string} params.symbol
 * @param {string} params.marketType
 * @param {number} params.candleLimit      how many M5 candles to include in snapshot.candles
 * @param {Array<{key:string, timeframe:string, days:number}>} params.historyConfig
 * @returns {Promise<Object>} same shape as the live-exchange snapshot in provider.js
 */
export async function getChartDbSnapshot({ chartDb, symbol, marketType, candleLimit, historyConfig }) {
  if (!chartDb) throw new ChartDbUnavailableError("CHART_DB binding is not configured");

  const m5 = await readLatestCandles(chartDb, symbol, "M5", candleLimit);
  if (!m5.length) throw new ChartDbUnavailableError(`chart_db has no M5 candles for ${symbol}`);

  const last = m5[m5.length - 1];
  const now = Date.now();
  const ageMs = now - last.timestamp;
  if (ageMs > M5_FRESHNESS_MS) {
    throw new ChartDbUnavailableError(
      `chart_db M5 data is stale (${Math.round(ageMs / 60000)}m old, limit ${M5_FRESHNESS_MS / 60000}m) — byga-chart ingest cron may be down`
    );
  }

  const { price_change_pct_24h, volume_24h } = await compute24h(chartDb, symbol, last);

  const history = {};
  for (const tf of historyConfig) {
    const candles = await readHistoryTimeframe(chartDb, symbol, tf);
    history[tf.key] = candles;
    history[`${tf.key}_source`] = "chart_db";
    history[`${tf.key}_days`] = tf.days;
  }
  history.history_1y = history.history_1d || [];
  history.history_days = history.history_1y.length;

  return {
    symbol,
    market_type: marketType || "perpetual",
    timeframe: "5m",
    timestamp: new Date(now).toISOString(),
    last_price: last.close,
    price_change_pct_24h,
    volume_24h,
    candles: m5,
    exchange: last.source || "chart_db",
    market_data_source: "chart_db",
    ...history,
  };
}

async function compute24h(chartDb, symbol, lastCandle) {
  const since = lastCandle.timestamp - DAY_MS;
  const rows = await chartDb
    .prepare(
      `SELECT open_time, close, volume FROM candles
       WHERE symbol = ? AND timeframe = 'M5' AND open_time >= ?
       ORDER BY open_time ASC`
    )
    .bind(symbol, since)
    .all();
  const window = (rows.results || []).map((r) => ({ timestamp: r.open_time, close: r.close, volume: r.volume }));
  if (!window.length) return { price_change_pct_24h: 0, volume_24h: 0 };
  const openPrice = window[0].close;
  const price_change_pct_24h = openPrice ? ((lastCandle.close - openPrice) / openPrice) * 100 : 0;
  const volume_24h = window.reduce((sum, c) => sum + (Number(c.volume) || 0), 0);
  return { price_change_pct_24h, volume_24h };
}

async function readHistoryTimeframe(chartDb, symbol, tf) {
  if (tf.timeframe === "4h") return readAggregatedH4(chartDb, symbol, tf.days);
  const chartTf = CHART_DB_TIMEFRAME[tf.timeframe];
  if (!chartTf) throw new ChartDbUnavailableError(`No chart_db mapping for timeframe "${tf.timeframe}"`);
  const since = Date.now() - tf.days * DAY_MS;
  const rows = await chartDb
    .prepare(
      `SELECT open_time, open, high, low, close, volume FROM candles
       WHERE symbol = ? AND timeframe = ? AND open_time >= ?
       ORDER BY open_time ASC`
    )
    .bind(symbol, chartTf, since)
    .all();
  return (rows.results || []).map((r) => rowToCandle(r, INTERVAL_MS[tf.timeframe]));
}

async function readAggregatedH4(chartDb, symbol, days) {
  const since = Date.now() - days * DAY_MS;
  const rows = await chartDb
    .prepare(
      `SELECT open_time, open, high, low, close, volume FROM candles
       WHERE symbol = ? AND timeframe = 'H1' AND open_time >= ?
       ORDER BY open_time ASC`
    )
    .bind(symbol, since)
    .all();
  const h1 = (rows.results || []).map((r) => rowToCandle(r, INTERVAL_MS["1h"]));
  return aggregateToH4(h1);
}

function aggregateToH4(h1Candles) {
  const h4Ms = INTERVAL_MS["4h"];
  const now = Date.now();
  const buckets = new Map();
  for (const c of h1Candles) {
    const bucketTs = Math.floor(c.timestamp / h4Ms) * h4Ms;
    const b = buckets.get(bucketTs);
    if (!b) {
      buckets.set(bucketTs, { timestamp: bucketTs, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
    } else {
      b.high = Math.max(b.high, c.high);
      b.low = Math.min(b.low, c.low);
      b.close = c.close;
      b.volume += c.volume;
    }
  }
  return Array.from(buckets.values())
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((b) => ({ ...b, closed: b.timestamp + h4Ms <= now }));
}

async function readLatestCandles(chartDb, symbol, chartTf, limit) {
  const rows = await chartDb
    .prepare(
      `SELECT open_time, open, high, low, close, volume, source FROM candles
       WHERE symbol = ? AND timeframe = ?
       ORDER BY open_time DESC LIMIT ?`
    )
    .bind(symbol, chartTf, Math.max(1, Number(limit) || 150))
    .all();
  const intervalMs = INTERVAL_MS["5m"];
  return (rows.results || [])
    .map((r) => ({ ...rowToCandle(r, intervalMs), source: r.source }))
    .reverse();
}

function rowToCandle(r, intervalMs) {
  const now = Date.now();
  return {
    timestamp: r.open_time,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
    closed: r.open_time + intervalMs <= now,
  };
}
