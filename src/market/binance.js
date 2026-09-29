/**
 * Binance Futures adapter - PRD Section 5.1.
 * Primary exchange. BTCUSDT perpetual, M5 by default.
 * Also returns best-effort derivatives context (funding, open interest, basis).
 */

import { fetchJson, parseBinanceDerivatives } from "./derivatives.js";

const BASE_URL = "https://fapi.binance.com";

async function fetchBinanceDerivatives(symbol) {
  const [premium, openInterest] = await Promise.all([
    fetchJson(`${BASE_URL}/fapi/v1/premiumIndex?symbol=${symbol}`),
    fetchJson(`${BASE_URL}/fapi/v1/openInterest?symbol=${symbol}`),
  ]);
  return parseBinanceDerivatives(premium, openInterest);
}

/**
 * @param {Object} params
 * @param {string} params.symbol      e.g. "BTCUSDT"
 * @param {string} params.marketType  "perpetual"
 * @param {string} params.timeframe   e.g. "5m"
 * @param {number} params.candleLimit
 */
export async function fetchBinanceFutures({ symbol, timeframe, candleLimit }) {
  // Started first so it runs alongside ticker/klines; never rejects.
  const derivativesPromise = fetchBinanceDerivatives(symbol);

  const [tickerRes, klineRes] = await Promise.all([
    fetchWithTimeout(`${BASE_URL}/fapi/v1/ticker/24hr?symbol=${symbol}`, 8000),
    fetchWithTimeout(
      `${BASE_URL}/fapi/v1/klines?symbol=${symbol}&interval=${timeframe}&limit=${candleLimit}`,
      8000
    ),
  ]);

  if (!tickerRes.ok) throw new Error(`Binance ticker HTTP ${tickerRes.status}`);
  if (!klineRes.ok) throw new Error(`Binance klines HTTP ${klineRes.status}`);

  const ticker = await tickerRes.json();
  const klines = await klineRes.json();

  if (!Array.isArray(klines) || klines.length === 0) {
    throw new Error("Binance returned empty candle set");
  }

  const now = Date.now();
  const candles = klines.map((k) => {
    const closeTime = k[6];
    return {
      timestamp: k[0],
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      closed: closeTime <= now,
    };
  });

  return {
    symbol,
    market_type: "perpetual",
    timeframe,
    timestamp: new Date().toISOString(),
    last_price: Number(ticker.lastPrice),
    price_change_pct_24h: Number(ticker.priceChangePercent),
    volume_24h: Number(ticker.quoteVolume),
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
