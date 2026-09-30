import { describe, it, expect } from "vitest";
import { buildPrompt, PROMPT_VERSION } from "../src/prompt/builder.js";

function makeCandles(count, startPrice = 90000) {
  const candles = [];
  for (let i = 0; i < count; i++) {
    const open = startPrice + i * 10;
    candles.push({
      timestamp: 1700000000000 + i * 5 * 60 * 1000,
      open,
      high: open + 15,
      low: open - 15,
      close: open + 5,
      volume: 12.5,
      closed: true,
    });
  }
  return candles;
}

function baseSnapshot(overrides = {}) {
  return {
    exchange: "binance",
    symbol: "BTCUSDT",
    market_type: "perpetual",
    timeframe: "5m",
    timestamp: "2026-09-24T00:00:00.000Z",
    last_price: 95000,
    price_change_pct_24h: 1.2,
    volume_24h: 12345,
    candles: makeCandles(150),
    history_m15: makeCandles(10),
    history_m15_days: 4,
    history_h1: makeCandles(10),
    history_h1_days: 30,
    history_h4: makeCandles(10),
    history_h4_days: 180,
    history_1d: makeCandles(10),
    history_days: 365,
    ...overrides,
  };
}

function extractMarketData(user) {
  const jsonMatch = user.match(/MARKET DATA:\n([\s\S]+?)\nCandle schema:/);
  expect(jsonMatch).not.toBeNull();
  return JSON.parse(jsonMatch[1]);
}

describe("buildPrompt ICT integration", () => {
  it("bumps prompt version", () => {
    expect(PROMPT_VERSION).toBe("1.13.0");
  });

  it("includes canonical ICT context for every analysis", () => {
    const { system, user } = buildPrompt(baseSnapshot());
    const data = extractMarketData(user);
    expect(data.ict.framework).toBe("ICT_STYLE_DETERMINISTIC");
    expect(data.ict.timeframes.m5).toBeDefined();
    expect(data.ict.timeframes.m15).toBeDefined();
    expect(data.ict.timeframes.h1).toBeDefined();
    expect(data.ict.timeframes.h4).toBeDefined();
    expect(data.ict.hierarchy.alignment).toBeDefined();
    expect(system).toMatch(/deterministic ICT-style multi-timeframe framework/);
    expect(user).toMatch(/ICT CONTRACT/);
    expect(user).toMatch(/Do not invent an FVG, OB, sweep, BOS, CHOCH, MSS/);
  });

  it("keeps compact candles while adding ICT context", () => {
    const full = makeCandles(150);
    const snap = baseSnapshot({
      candles: full,
      history_m15: full,
      history_h1: full,
      history_h4: full,
      history_1d: full,
      derivatives: { funding_rate_pct: 0.01, open_interest_btc: 50000, open_interest_usd: 4500000000, basis_pct: 0.01 },
    });
    const { user } = buildPrompt(snap, {
      window_days: 365,
      horizon_hours: 2,
      evaluated: 120,
      buy: { n: 60, hit_rate_pct: 52.1, avg_return_pct: 0.03 },
      sell: { n: 60, hit_rate_pct: 48.3, avg_return_pct: -0.01 },
      no_trade_n: 300,
    });
    expect(user.length).toBeLessThan(24000);
  });
});