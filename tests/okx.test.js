import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchOkxSwap, toOkxInstId, okxBar } from "../src/market/okx.js";
import { getMarketSnapshot, MarketDataError } from "../src/market/provider.js";

// OKX candle row: [ts, o, h, l, c, vol(contracts), volCcy(base), volCcyQuote, confirm]
function okxRow(ts, confirm = "1") {
  return [String(ts), "60000", "60100", "59900", "60050", "1250", "12.5", "750000", confirm];
}

function okxFetchMock() {
  return vi.fn(async (url) => {
    if (url.includes("fapi.binance.com") || url.includes("api.bybit.com")) {
      return new Response("error", { status: 500 });
    }
    if (url.includes("/market/ticker")) {
      return new Response(
        JSON.stringify({ code: "0", msg: "", data: [{ last: "66000", open24h: "60000", volCcy24h: "100" }] }),
        { status: 200 }
      );
    }
    if (url.includes("/market/history-candles")) {
      return new Response(JSON.stringify({ code: "0", msg: "", data: [okxRow(Date.now() - 60 * 1000)] }), {
        status: 200,
      });
    }
    if (url.includes("/market/candles")) {
      const t = 1700000000000;
      // OKX is newest-first.
      return new Response(
        JSON.stringify({ code: "0", msg: "", data: [okxRow(t + 300000, "0"), okxRow(t, "1")] }),
        { status: 200 }
      );
    }
    throw new Error("unexpected url " + url);
  });
}

describe("okx helpers", () => {
  it("maps symbols to OKX swap instrument ids", () => {
    expect(toOkxInstId("BTCUSDT")).toBe("BTC-USDT-SWAP");
    expect(toOkxInstId("ethusdt")).toBe("ETH-USDT-SWAP");
    expect(toOkxInstId("BTC-USDT-SWAP")).toBe("BTC-USDT-SWAP");
    expect(() => toOkxInstId("BTCEUR")).toThrow();
  });

  it("maps timeframes to OKX bar codes (UTC daily)", () => {
    expect(okxBar("5m")).toBe("5m");
    expect(okxBar("1h")).toBe("1H");
    expect(okxBar("4h")).toBe("4H");
    expect(okxBar("1d")).toBe("1Dutc");
  });
});

describe("fetchOkxSwap", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes ticker and candles (oldest-first, base volume, closed flag)", async () => {
    global.fetch = okxFetchMock();

    const snap = await fetchOkxSwap({ symbol: "BTCUSDT", timeframe: "5m", candleLimit: 150 });

    expect(snap.last_price).toBe(66000);
    expect(snap.price_change_pct_24h).toBeCloseTo(10, 5);
    expect(snap.volume_24h).toBe(100 * 66000);
    expect(snap.candles).toHaveLength(2);
    expect(snap.candles[0].timestamp).toBeLessThan(snap.candles[1].timestamp);
    expect(snap.candles[0].volume).toBe(12.5);
    expect(snap.candles[0].closed).toBe(true);
    expect(snap.candles[1].closed).toBe(false);
  });

  it("throws on an OKX API error code", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ code: "50011", msg: "Too Many Requests", data: [] }), { status: 200 })
    );

    await expect(fetchOkxSwap({ symbol: "BTCUSDT", timeframe: "5m", candleLimit: 5 })).rejects.toThrow(/OKX/);
  });
});

describe("getMarketSnapshot with OKX in the fallback chain", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const base = {
    primary: "binance",
    fallback: "bybit,okx",
    symbol: "BTCUSDT",
    marketType: "perpetual",
    timeframe: "5m",
    candleLimit: 5,
  };

  it("falls through Binance and Bybit to OKX and records fallback_used", async () => {
    global.fetch = okxFetchMock();

    const snapshot = await getMarketSnapshot(base);

    expect(snapshot.exchange).toBe("okx");
    expect(snapshot.fallback_used).toBe(true);
    expect(snapshot.primary_error).toMatch(/Binance/);
    expect(snapshot.last_price).toBe(66000);
    expect(snapshot.history_1d.length).toBeGreaterThan(0);
  });

  it("does not touch OKX when it is not in the fallback list", async () => {
    global.fetch = okxFetchMock();

    await expect(getMarketSnapshot({ ...base, fallback: "bybit" })).rejects.toBeInstanceOf(MarketDataError);
    const urls = global.fetch.mock.calls.map((c) => c[0]);
    expect(urls.some((u) => u.includes("okx.com"))).toBe(false);
  });

  it("throws MarketDataError listing every exchange when all of them fail", async () => {
    global.fetch = vi.fn(async () => new Response("error", { status: 500 }));

    await expect(getMarketSnapshot(base)).rejects.toThrow(/fallback\(okx\)/);
  });
});
