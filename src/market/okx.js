/**
 * OKX USDT-margined perpetual swap adapter.
 * Additional fallback exchange, tried after Bybit (see provider.js).
 *
 * Public endpoints only - no API key needed. BTCUSDT maps to the OKX
 * instrument id BTC-USDT-SWAP.
 */

import { fetchJson, parseOkxDerivatives } from "./derivatives.js";

export const OKX_BASE_URL = "https://www.okx.com";

// OKX bar codes: minutes are lowercase ("5m"), hours/days uppercase ("1H", "4H").
// "1Dutc" (not "1D") so daily candles open at 00:00 UTC like Binance/Bybit;
// plain "1D" opens at 00:00 UTC+8.
const BAR_MAP = { "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "2h": "2H", "4h": "4H", "1d": "1Dutc" };

const TIMEFRAME_MS = {
  "1m": 60 * 1000,
  "3m": 3 * 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "2h": 2 * 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

// /market/candles returns at most 300 rows per request.
const MAX_LIVE_CANDLES = 300;

/** BTCUSDT -> BTC-USDT-SWAP. Already-dashed ids are passed through. */
export function toOkxInstId(symbol) {
  const s = String(symbol || "").toUpperCase();
  if (s.includes("-")) return s;
  const m = s.match(/^(.+)(USDT|USDC)$/);
  if (!m) throw new Error(`OKX: cannot map symbol "${symbol}" to an instrument id`);
  return `${m[1]}-${m[2]}-SWAP`;
}

export function okxBar(timeframe) {
  return BAR_MAP[timeframe] || "5m";
}

/**
 * OKX candle row: [ts, open, high, low, close, vol(contracts), volCcy(base),
 * volCcyQuote, confirm]. Volume uses volCcy (base currency, e.g. BTC) so it
 * matches Binance/Bybit; confirm "1" = closed candle.
 */
export function parseOkxCandle(row, intervalMs, now = Date.now()) {
  const ts = Number(row[0]);
  const volume = row[6] !== undefined ? Number(row[6]) : Number(row[5]);
  const closed = row[8] !== undefined ? row[8] === "1" : ts + intervalMs <= now;
  return {
    timestamp: ts,
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume,
    closed,
  };
}

async function fetchOkxDerivatives(instId) {
  const id = encodeURIComponent(instId);
  const [funding, openInterest] = await Promise.all([
    fetchJson(`${OKX_BASE_URL}/api/v5/public/funding-rate?instId=${id}`),
    fetchJson(`${OKX_BASE_URL}/api/v5/public/open-interest?instType=SWAP&instId=${id}`),
  ]);
  const ok = (body) => (body?.code === "0" ? body.data?.[0] : undefined);
  return parseOkxDerivatives(ok(funding), ok(openInterest));
}

export async function fetchOkxSwap({ symbol, timeframe, candleLimit }) {
  const instId = toOkxInstId(symbol);
  const bar = okxBar(timeframe);
  const intervalMs = TIMEFRAME_MS[timeframe] || TIMEFRAME_MS["5m"];
  const limit = Math.min(Math.max(parseInt(candleLimit, 10) || 150, 1), MAX_LIVE_CANDLES);

  // Started first so it runs alongside ticker/candles; never rejects.
  const derivativesPromise = fetchOkxDerivatives(instId);

  const [tickerRes, klineRes] = await Promise.all([
    fetchWithTimeout(`${OKX_BASE_URL}/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`, 8000),
    fetchWithTimeout(
      `${OKX_BASE_URL}/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${bar}&limit=${limit}`,
      8000
    ),
  ]);

  if (!tickerRes.ok) throw new Error(`OKX ticker HTTP ${tickerRes.status}`);
  if (!klineRes.ok) throw new Error(`OKX candles HTTP ${klineRes.status}`);

  const tickerJson = await tickerRes.json();
  const klineJson = await klineRes.json();

  if (tickerJson.code !== "0") throw new Error(`OKX ticker error: ${tickerJson.msg}`);
  if (klineJson.code !== "0") throw new Error(`OKX candles error: ${klineJson.msg}`);

  const ticker = tickerJson.data?.[0];
  const rawCandles = klineJson.data || [];
  if (!ticker) throw new Error("OKX returned no ticker data");
  if (rawCandles.length === 0) throw new Error("OKX returned empty candle set");

  const last = Number(ticker.last);
  const open24h = Number(ticker.open24h);
  const now = Date.now();
  // OKX returns candles newest-first; normalize to oldest-first like Binance.
  const candles = rawCandles
    .slice()
    .reverse()
    .map((row) => parseOkxCandle(row, intervalMs, now));

  return {
    symbol,
    market_type: "perpetual",
    timeframe,
    timestamp: new Date().toISOString(),
    last_price: last,
    price_change_pct_24h: open24h > 0 ? ((last - open24h) / open24h) * 100 : 0,
    // The swap ticker has no quote-currency volume, so approximate USDT
    // turnover as base volume (volCcy24h) x last price.
    volume_24h: Number(ticker.volCcy24h) * last,
    candles,
    derivatives: await derivativesPromise,
  };
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}
