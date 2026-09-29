/**
 * Multi-timeframe historical market context (M15 / H1 / H4 / D1).
 *
 * D1-first strategy: read cached candles from the D1 `candles` table.
 * If coverage is insufficient or the last cached candle is stale, fetch
 * live from the exchange (startTime/endTime range) and upsert into D1
 * so the next run reads from D1 instead of calling the exchange again.
 */

import { getCandlesFromD1, upsertCandles } from "./candleStore.js";
import { OKX_BASE_URL, okxBar, toOkxInstId, parseOkxCandle } from "./okx.js";

const INTERVAL_MS = { "15m": 15 * 60 * 1000, "1h": 60 * 60 * 1000, "4h": 4 * 60 * 60 * 1000, "1d": 24 * 60 * 60 * 1000 };
const BINANCE_INTERVAL = { "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d" };
const BYBIT_INTERVAL = { "15m": "15", "1h": "60", "4h": "240", "1d": "D" };

const FRESHNESS_MULTIPLIER = 3; // last stored candle must be within 3x the interval to be considered fresh
const MIN_COVERAGE_RATIO = 0.9; // D1 must hold >=90% of expected candles to skip a live fetch

// OKX history-candles returns at most 100 rows per request and is paginated
// backwards in time. 30 pages = 3000 candles, enough for the largest window
// (H4 x 180d = 1080).
const OKX_PAGE_SIZE = 100;
const OKX_MAX_PAGES = 30;

/**
 * @param {Object} params
 * @param {D1Database} [params.db]
 * @param {string} params.exchange
 * @param {string} params.symbol
 * @param {string} params.timeframe  "15m" | "1h" | "4h" | "1d"
 * @param {number} params.days       lookback window in days
 * @returns {Promise<{candles: Array<Object>, source: "d1"|"exchange"}>}
 */
export async function getHistoricalCandles({ db, exchange, symbol, timeframe, days }) {
  const intervalMs = INTERVAL_MS[timeframe];
  if (!intervalMs) throw new Error(`Unsupported history timeframe: ${timeframe}`);

  const end = Date.now();
  const start = end - days * 24 * 60 * 60 * 1000;
  const expectedCandles = Math.floor((end - start) / intervalMs);

  let cached = [];
  if (db) {
    try {
      cached = await getCandlesFromD1(db, { exchange, symbol, timeframe, sinceMs: start });
    } catch (err) {
      cached = []; // table not migrated yet / transient D1 error - fall through to live fetch
    }
  }

  const lastCached = cached[cached.length - 1];
  const isFresh = lastCached && end - lastCached.timestamp <= intervalMs * FRESHNESS_MULTIPLIER;
  const hasCoverage = cached.length >= expectedCandles * MIN_COVERAGE_RATIO;

  if (hasCoverage && isFresh) {
    return { candles: cached, source: "d1" };
  }

  const fetched = await fetchExchangeRange({ exchange, symbol, timeframe, start, end });

  if (db && fetched.length) {
    try {
      await upsertCandles(db, { exchange, symbol, timeframe, candles: fetched });
    } catch (err) {
      // Non-fatal: the prompt still gets fresh data even if the D1 write fails.
      console.error(`candle upsert failed (${exchange} ${symbol} ${timeframe}): ${err.message}`);
    }
  }

  // Merge in case D1 held older rows outside the exchange fetch window - keeps continuity.
  const merged = mergeCandles(cached, fetched, start);
  return { candles: merged, source: "exchange" };
}

function mergeCandles(cached, fresh, start) {
  const byTs = new Map();
  for (const c of cached) if (c.timestamp >= start) byTs.set(c.timestamp, c);
  for (const c of fresh) byTs.set(c.timestamp, c); // fresh wins on conflict
  return Array.from(byTs.values()).sort((a, b) => a.timestamp - b.timestamp);
}

async function fetchExchangeRange({ exchange, symbol, timeframe, start, end }) {
  if (exchange === "binance") return fetchBinanceRange(symbol, timeframe, start, end);
  if (exchange === "bybit") return fetchBybitRange(symbol, timeframe, start, end);
  if (exchange === "okx") return fetchOkxRange(symbol, timeframe, start, end);
  throw new Error(`Unsupported historical exchange: ${exchange}`);
}

async function fetchBinanceRange(symbol, timeframe, start, end) {
  const interval = BINANCE_INTERVAL[timeframe];
  const url =
    `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${start}&endTime=${end}&limit=1500`;
  const res = await fetchWithTimeout(url, 15000);
  if (!res.ok) throw new Error(`Binance historical klines HTTP ${res.status} (${timeframe})`);

  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error(`Binance returned no ${timeframe} history`);
  }

  const now = Date.now();
  return rows.map((k) => ({
    timestamp: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    closed: Number(k[6]) <= now,
  }));
}

async function fetchBybitRange(symbol, timeframe, start, end) {
  const interval = BYBIT_INTERVAL[timeframe];
  const url =
    `https://api.bybit.com/v5/market/kline?category=linear&symbol=${encodeURIComponent(symbol)}&interval=${interval}&start=${start}&end=${end}&limit=1000`;
  const res = await fetchWithTimeout(url, 15000);
  if (!res.ok) throw new Error(`Bybit historical kline HTTP ${res.status} (${timeframe})`);

  const body = await res.json();
  if (body.retCode !== 0) throw new Error(`Bybit historical kline error (${timeframe}): ${body.retMsg}`);

  const rows = body.result?.list || [];
  if (!rows.length) throw new Error(`Bybit returned no ${timeframe} history`);

  const intervalMs = INTERVAL_MS[timeframe];
  const now = Date.now();
  return rows
    .slice()
    .reverse()
    .map((k) => ({
      timestamp: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      closed: Number(k[0]) + intervalMs <= now,
    }));
}

async function fetchOkxRange(symbol, timeframe, start, end) {
  const instId = toOkxInstId(symbol);
  const bar = okxBar(timeframe);
  const intervalMs = INTERVAL_MS[timeframe];
  const now = Date.now();
  const byTs = new Map();

  // `after` = return records older than this timestamp; walk backwards
  // page by page until the window start is covered.
  let after = end + 1;
  for (let page = 0; page < OKX_MAX_PAGES; page++) {
    const url =
      `${OKX_BASE_URL}/api/v5/market/history-candles?instId=${encodeURIComponent(instId)}&bar=${bar}&after=${after}&limit=${OKX_PAGE_SIZE}`;
    const res = await fetchWithTimeout(url, 15000);
    if (!res.ok) throw new Error(`OKX historical candles HTTP ${res.status} (${timeframe})`);

    const body = await res.json();
    if (body.code !== "0") throw new Error(`OKX historical candles error (${timeframe}): ${body.msg}`);

    const rows = body.data || [];
    if (!rows.length) break;

    let oldest = Infinity;
    for (const row of rows) {
      const ts = Number(row[0]);
      if (ts < oldest) oldest = ts;
      if (ts >= start && ts <= end) byTs.set(ts, parseOkxCandle(row, intervalMs, now));
    }

    if (oldest <= start || rows.length < OKX_PAGE_SIZE) break;
    after = oldest;
  }

  if (!byTs.size) throw new Error(`OKX returned no ${timeframe} history`);
  return Array.from(byTs.values()).sort((a, b) => a.timestamp - b.timestamp);
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
