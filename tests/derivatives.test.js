import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildDerivatives,
  fetchJson,
  parseBinanceDerivatives,
  parseBybitDerivatives,
  parseOkxDerivatives,
} from "../src/market/derivatives.js";
import { fetchBinanceFutures } from "../src/market/binance.js";
import { fetchBybitLinear } from "../src/market/bybit.js";
import { fetchOkxSwap } from "../src/market/okx.js";

describe("buildDerivatives", () => {
  it("converts funding to percent and computes basis and USD open interest", () => {
    const d = buildDerivatives({
      fundingRate: "0.0001",
      nextFundingTime: 1700000000000,
      markPrice: "90010",
      indexPrice: "90000",
      openInterestBtc: "50000.04",
    });

    expect(d.funding_rate_pct).toBe(0.01);
    expect(d.next_funding_time).toBe(new Date(1700000000000).toISOString());
    expect(d.basis_pct).toBe(0.0111);
    expect(d.open_interest_btc).toBe(50000);
    expect(d.open_interest_usd).toBe(Math.round(50000.04 * 90010));
  });

  it("omits missing, empty and non-numeric values, and is null when nothing is usable", () => {
    expect(buildDerivatives({ fundingRate: "", openInterestBtc: "abc", markPrice: undefined })).toBeNull();
    expect(buildDerivatives({ fundingRate: "-0.00005" })).toEqual({ funding_rate_pct: -0.005 });
  });
});

describe("exchange parsers", () => {
  it("maps Binance premiumIndex + openInterest", () => {
    const d = parseBinanceDerivatives(
      { lastFundingRate: "-0.00005", nextFundingTime: 1700000000000, markPrice: "60000.5", indexPrice: "60000" },
      { openInterest: "12345.678" }
    );
    expect(d.funding_rate_pct).toBe(-0.005);
    expect(d.open_interest_btc).toBe(12345.7);
    expect(d.basis_pct).toBe(0.0008);
  });

  it("maps a Bybit ticker row, preferring its own USD open interest value", () => {
    const d = parseBybitDerivatives({
      fundingRate: "0.0001",
      nextFundingTime: "1700000000000",
      markPrice: "90010",
      indexPrice: "90000",
      openInterest: "50000",
      openInterestValue: "4500000000",
    });
    expect(d.open_interest_usd).toBe(4500000000);
    expect(d.funding_rate_pct).toBe(0.01);
  });

  it("maps OKX funding-rate and open-interest rows without basis", () => {
    const d = parseOkxDerivatives(
      { fundingRate: "0.0002", fundingTime: "1700000000000" },
      { oiCcy: "8000.4", oiUsd: "528000000" }
    );
    expect(d.funding_rate_pct).toBe(0.02);
    expect(d.open_interest_btc).toBe(8000.4);
    expect(d.open_interest_usd).toBe(528000000);
    expect(d.basis_pct).toBeUndefined();
  });

  it("returns null when the upstream rows are missing", () => {
    expect(parseBinanceDerivatives(null, null)).toBeNull();
    expect(parseBybitDerivatives({})).toBeNull();
    expect(parseOkxDerivatives(undefined, undefined)).toBeNull();
  });
});

describe("fetchJson", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns null on HTTP errors and on thrown network errors", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 }));
    expect(await fetchJson("https://example.test/a")).toBeNull();

    global.fetch = vi.fn(async () => {
      throw new Error("boom");
    });
    expect(await fetchJson("https://example.test/b")).toBeNull();
  });
});

describe("adapters attach derivatives without making them required", () => {
  beforeEach(() => vi.restoreAllMocks());

  function binanceMock({ withDerivatives }) {
    return vi.fn(async (url) => {
      if (url.includes("ticker/24hr")) {
        return new Response(JSON.stringify({ lastPrice: "60000", priceChangePercent: "1", quoteVolume: "1000" }), { status: 200 });
      }
      if (url.includes("klines")) {
        const t = 1700000000000;
        return new Response(JSON.stringify([[t, "1", "2", "0.5", "1.5", "10", t + 299999]]), { status: 200 });
      }
      if (url.includes("premiumIndex") && withDerivatives) {
        return new Response(
          JSON.stringify({ lastFundingRate: "0.0001", nextFundingTime: 1700000000000, markPrice: "60000", indexPrice: "60000" }),
          { status: 200 }
        );
      }
      if (url.includes("openInterest") && withDerivatives) {
        return new Response(JSON.stringify({ openInterest: "1000" }), { status: 200 });
      }
      return new Response("error", { status: 500 });
    });
  }

  it("Binance: includes derivatives when the endpoints answer", async () => {
    global.fetch = binanceMock({ withDerivatives: true });
    const snap = await fetchBinanceFutures({ symbol: "BTCUSDT", timeframe: "5m", candleLimit: 5 });

    expect(snap.derivatives.funding_rate_pct).toBe(0.01);
    expect(snap.derivatives.open_interest_btc).toBe(1000);
    expect(snap.derivatives.basis_pct).toBe(0);
  });

  it("Binance: still returns the snapshot when the derivatives endpoints fail", async () => {
    global.fetch = binanceMock({ withDerivatives: false });
    const snap = await fetchBinanceFutures({ symbol: "BTCUSDT", timeframe: "5m", candleLimit: 5 });

    expect(snap.last_price).toBe(60000);
    expect(snap.derivatives).toBeNull();
  });

  it("Bybit: reads funding and open interest from the ticker row", async () => {
    global.fetch = vi.fn(async (url) => {
      if (url.includes("tickers")) {
        return new Response(
          JSON.stringify({
            retCode: 0,
            result: {
              list: [
                {
                  lastPrice: "68400",
                  price24hPcnt: "0.018",
                  turnover24h: "900000",
                  fundingRate: "0.0001",
                  openInterest: "50000",
                  openInterestValue: "4500000000",
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({ retCode: 0, result: { list: [["1700000000000", "1", "2", "0.5", "1.5", "10"]] } }),
        { status: 200 }
      );
    });

    const snap = await fetchBybitLinear({ symbol: "BTCUSDT", timeframe: "5m", candleLimit: 5 });
    expect(snap.derivatives.funding_rate_pct).toBe(0.01);
    expect(snap.derivatives.open_interest_usd).toBe(4500000000);
  });

  it("OKX: includes derivatives from the public endpoints", async () => {
    global.fetch = vi.fn(async (url) => {
      if (url.includes("/public/funding-rate")) {
        return new Response(
          JSON.stringify({ code: "0", msg: "", data: [{ fundingRate: "0.0002", fundingTime: "1700000000000" }] }),
          { status: 200 }
        );
      }
      if (url.includes("/public/open-interest")) {
        return new Response(JSON.stringify({ code: "0", msg: "", data: [{ oiCcy: "8000", oiUsd: "500000000" }] }), {
          status: 200,
        });
      }
      if (url.includes("/market/ticker")) {
        return new Response(JSON.stringify({ code: "0", msg: "", data: [{ last: "66000", open24h: "60000", volCcy24h: "100" }] }), {
          status: 200,
        });
      }
      const t = 1700000000000;
      return new Response(
        JSON.stringify({ code: "0", msg: "", data: [[String(t), "1", "2", "0.5", "1.5", "10", "1", "1", "1"]] }),
        { status: 200 }
      );
    });

    const snap = await fetchOkxSwap({ symbol: "BTCUSDT", timeframe: "5m", candleLimit: 5 });
    expect(snap.derivatives.funding_rate_pct).toBe(0.02);
    expect(snap.derivatives.open_interest_usd).toBe(500000000);
  });
});
