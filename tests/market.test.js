import { describe, it, expect, vi, beforeEach } from "vitest";
import { getMarketSnapshot, MarketDataError } from "../src/market/provider.js";

function mockCandle(i) {
  const t = 1700000000000 + i * 5 * 60 * 1000;
  return [t, "60000", "60100", "59900", "60050", "12.5", t + 5 * 60 * 1000 - 1];
}

// Minimal fake D1 binding: enough for liveSnapshotStore.getLiveSnapshot()
// (prepare().bind().first()) and candleStore.getCandlesFromD1()
// (prepare().bind().all()) to both resolve without throwing.
function makeFakeDb(liveTickerRow) {
  const stmt = {
    bind: () => stmt,
    first: async () => liveTickerRow,
    all: async () => ({ results: [] }),
    run: async () => ({}),
  };
  return { prepare: () => stmt };
}

describe("getMarketSnapshot", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the primary exchange (Binance) when it succeeds", async () => {
    global.fetch = vi.fn(async (url) => {
      if (url.includes("ticker/24hr")) {
        return new Response(JSON.stringify({ lastPrice: "68432.50", priceChangePercent: "1.86", quoteVolume: "1000000" }), { status: 200 });
      }
      if (url.includes("klines")) {
        return new Response(JSON.stringify(Array.from({ length: 5 }, (_, i) => mockCandle(i))), { status: 200 });
      }
      throw new Error("unexpected url " + url);
    });

    const snapshot = await getMarketSnapshot({
      primary: "binance",
      fallback: "bybit",
      symbol: "BTCUSDT",
      marketType: "perpetual",
      timeframe: "5m",
      candleLimit: 5,
    });

    expect(snapshot.exchange).toBe("binance");
    expect(snapshot.last_price).toBe(68432.5);
    expect(snapshot.candles).toHaveLength(5);
    expect(snapshot.candles[0]).toHaveProperty("open");
    expect(snapshot.candles[0]).toHaveProperty("closed");
  });

  it("falls back to Bybit when Binance fails, and records fallback_used", async () => {
    global.fetch = vi.fn(async (url) => {
      if (url.includes("fapi.binance.com")) {
        return new Response("error", { status: 500 });
      }
      if (url.includes("tickers")) {
        return new Response(
          JSON.stringify({ retCode: 0, result: { list: [{ lastPrice: "68400", price24hPcnt: "0.018", turnover24h: "900000" }] } }),
          { status: 200 }
        );
      }
      if (url.includes("kline")) {
        return new Response(
          JSON.stringify({ retCode: 0, result: { list: [["1700000000000", "60000", "60100", "59900", "60050", "12.5"]] } }),
          { status: 200 }
        );
      }
      throw new Error("unexpected url " + url);
    });

    const snapshot = await getMarketSnapshot({
      primary: "binance",
      fallback: "bybit",
      symbol: "BTCUSDT",
      marketType: "perpetual",
      timeframe: "5m",
      candleLimit: 5,
    });

    expect(snapshot.exchange).toBe("bybit");
    expect(snapshot.fallback_used).toBe(true);
  });

  it("throws MarketDataError when both exchanges fail and there is no cached snapshot", async () => {
    global.fetch = vi.fn(async () => new Response("error", { status: 500 }));

    await expect(
      getMarketSnapshot({
        primary: "binance",
        fallback: "bybit",
        symbol: "BTCUSDT",
        marketType: "perpetual",
        timeframe: "5m",
        candleLimit: 5,
      })
    ).rejects.toBeInstanceOf(MarketDataError);
  });

  it("falls back to a fresh cached snapshot from D1 when both exchanges fail", async () => {
    global.fetch = vi.fn(async () => new Response("error", { status: 500 }));

    const freshRow = {
      symbol: "BTCUSDT",
      timeframe: "5m",
      exchange: "binance",
      last_price: 68000,
      price_change_pct_24h: 1.2,
      volume_24h: 500000,
      candles_json: JSON.stringify([
        { timestamp: 1700000000000, open: 60000, high: 60100, low: 59900, close: 60050, volume: 12.5, closed: true },
      ]),
      fetched_at: new Date().toISOString(),
    };

    const snapshot = await getMarketSnapshot({
      primary: "binance",
      fallback: "bybit",
      symbol: "BTCUSDT",
      marketType: "perpetual",
      timeframe: "5m",
      candleLimit: 5,
      db: makeFakeDb(freshRow),
      env: {},
    });

    expect(snapshot.cached_snapshot_used).toBe(true);
    expect(snapshot.exchange).toBe("binance");
    expect(snapshot.last_price).toBe(68000);
  });

  it("still throws MarketDataError when both exchanges fail and the cached snapshot is stale", async () => {
    global.fetch = vi.fn(async () => new Response("error", { status: 500 }));

    const staleRow = {
      symbol: "BTCUSDT",
      timeframe: "5m",
      exchange: "binance",
      last_price: 68000,
      price_change_pct_24h: 1.2,
      volume_24h: 500000,
      candles_json: JSON.stringify([
        { timestamp: 1700000000000, open: 60000, high: 60100, low: 59900, close: 60050, volume: 12.5, closed: true },
      ]),
      fetched_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h old
    };

    await expect(
      getMarketSnapshot({
        primary: "binance",
        fallback: "bybit",
        symbol: "BTCUSDT",
        marketType: "perpetual",
        timeframe: "5m",
        candleLimit: 5,
        db: makeFakeDb(staleRow),
        env: {},
      })
    ).rejects.toBeInstanceOf(MarketDataError);
  });
});
