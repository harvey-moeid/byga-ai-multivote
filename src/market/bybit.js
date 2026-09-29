/**
 * Bybit Linear Futures adapter - PRD Section 5.2.
 * Fallback exchange, used only when Binance fails.
 * Derivatives context comes from the same ticker row (no extra request).
 */

import { parseBybitDerivatives } from "./derivatives.js";

const BASE_URL = "https://api.bybit.com";

// Bybit uses interval codes like "5" (minutes) instead of "5m".
const INTERVAL_MAP = { "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "4h": "240", "1d": "D" };

export async function fetchBybitLinear({ symbol, timeframe, candleLimit }) {
  const interval = INTERVAL_MAP[timeframe] || "5";

  const [tickerRes, klineRes] = await Promise.all([
    fetchWithTimeout(`${BASE_URL}/v5/market/tickers?category=linear&symbol=${symbol}`, 8000),
    fetchWithTimeout(
      `${BASE_URL}/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${candleLimit}`,
      8000
    ),
  ]);

  if (!tickerRes.ok) throw new Error(`Bybit ticker HTTP ${tickerRes.status}`);
  if (!klineRes.ok) throw new Error(`Bybit kline HTTP ${klineRes.status}`);

  const tickerJson = await tickerRes.json();
  const klineJson = await klineRes.json();

  if (tickerJson.retCode !== 0) throw new Error(`Bybit ticker error: ${tickerJson.retMsg}`);
  if (klineJson.retCode !== 0) throw new Error(`Bybit kline error: ${klineJson.retMsg}`);

  const ticker = tickerJson.result?.list?.[0];
  const rawCandles = klineJson.result?.list || [];
  if (!ticker) throw new Error("Bybit returned no ticker data");
  if (rawCandles.length === 0) throw new Error("Bybit returned empty candle set");

  const now = Date.now();
  const intervalMs = (parseInt(interval, 10) || 5) * 60 * 1000;
  // Bybit returns candles newest-first; normalize to oldest-first like Binance.
  const candles = rawCandles
    .slice()
    .reverse()
    .map((c) => {
      const ts = Number(c[0]);
      return {
        timestamp: ts,
        open: Number(c[1]),
        high: Number(c[2]),
        low: Number(c[3]),
        close: Number(c[4]),
        volume: Number(c[5]),
        closed: ts + intervalMs <= now,
      };
    });

  return {
    symbol,
    market_type: "perpetual",
    timeframe,
    timestamp: new Date().toISOString(),
    last_price: Number(ticker.lastPrice),
    price_change_pct_24h: Number(ticker.price24hPcnt) * 100,
    volume_24h: Number(ticker.turnover24h),
    candles,
    derivatives: parseBybitDerivatives(ticker),
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
