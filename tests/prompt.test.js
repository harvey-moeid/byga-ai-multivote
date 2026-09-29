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
  const jsonMatch = user.match(/MARKET DATA \(JSON\):\n([\s\S]+?)\n\nCandle schema:/);
  expect(jsonMatch).not.toBeNull();
  return JSON.parse(jsonMatch[1]);
}

describe("buildPrompt current_m5 capping", () => {
  it("trims the raw current_m5 candles sent to the model even when 150 are fetched", () => {
    const { user } = buildPrompt(baseSnapshot());
    const compactSnapshot = extractMarketData(user);

    expect(compactSnapshot.current_m5.candles_fetched).toBe(150);
    expect(compactSnapshot.current_m5.candles_included).toBeLessThan(150);
    expect(compactSnapshot.current_m5.candles.length).toBe(compactSnapshot.current_m5.candles_included);
    expect(compactSnapshot.current_m5.note).toMatch(/most recent/);
  });

  it("computes current_m5 statistics over the full fetched window, not just the trimmed sample", () => {
    const { user } = buildPrompt(baseSnapshot());
    const compactSnapshot = extractMarketData(user);

    expect(compactSnapshot.current_m5.statistics.candles_count).toBe(150);
  });

  it("does not add a note when the fetched window is already within the cap", () => {
    const { user } = buildPrompt(baseSnapshot({ candles: makeCandles(20) }));
    const compactSnapshot = extractMarketData(user);

    expect(compactSnapshot.current_m5.candles_fetched).toBe(20);
    expect(compactSnapshot.current_m5.candles_included).toBe(20);
    expect(compactSnapshot.current_m5.note).toBeUndefined();
  });

  it("bumps PROMPT_VERSION to reflect derivatives and the realized track record", () => {
    expect(PROMPT_VERSION).toBe("1.11.0");
  });
});

describe("buildPrompt compact candle encoding", () => {
  it("encodes candles as [k, o, h, l, c, v] rows with a start + step_min header", () => {
    const { user } = buildPrompt(baseSnapshot({ candles: makeCandles(20) }));
    const m5 = extractMarketData(user).current_m5;

    expect(m5.step_min).toBe(5);
    expect(m5.start).toBe(new Date(1700000000000).toISOString());
    expect(m5.candles[0]).toEqual([0, 90000, 90015, 89985, 90005, 12.5]);
    expect(m5.candles[1][0]).toBe(1);
    for (const row of m5.candles) expect(row.length).toBe(6);
  });

  it("does not repeat per-candle key names or closed flags", () => {
    const { user } = buildPrompt(baseSnapshot());
    const data = user.match(/MARKET DATA \(JSON\):\n([\s\S]+?)\n\nCandle schema:/)[1];

    expect(data).not.toMatch(/"closed"/);
    expect(data).not.toMatch(/"timestamp":\d{13}/);
    expect(data).not.toMatch(/"open":/);
  });

  it("applies the reduced caps (M15 32, D1 30)", () => {
    const snap = baseSnapshot({ history_m15: makeCandles(100), history_1d: makeCandles(100) });
    const data = extractMarketData(buildPrompt(snap).user);

    expect(data.history_m15.candles_included).toBe(32);
    expect(data.historical_1y.candles_included).toBe(30);
    expect(data.history_m15.statistics.candles_count).toBe(100);
  });

  it("keeps the market-data payload well under the old object-per-candle size", () => {
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

    // v1.7.0 sent ~270 candle objects (~100 chars each, ~27k chars). Compact rows plus the
    // indicators / key levels / derivatives / track record must stay far below that.
    expect(user.length).toBeLessThan(24000);
  });
});

describe("buildPrompt signal_track_record (v1.11.0)", () => {
  const record = {
    window_days: 365,
    horizon_hours: 2,
    evaluated: 120,
    buy: { n: 60, hit_rate_pct: 52.1, avg_return_pct: 0.03 },
    sell: { n: 60, hit_rate_pct: 48.3, avg_return_pct: -0.01 },
    no_trade_n: 300,
  };

  it("passes the realized track record through unchanged", () => {
    const { user } = buildPrompt(baseSnapshot(), record);
    expect(extractMarketData(user).signal_track_record).toEqual(record);
  });

  it("replaces the old day-count block", () => {
    const { user } = buildPrompt(baseSnapshot(), record);
    const data = extractMarketData(user);

    expect(data.historical_signals_1y).toBeUndefined();
    expect(user).not.toMatch(/historical_signals_1y/);
  });

  it("is null when there is no track record", () => {
    expect(extractMarketData(buildPrompt(baseSnapshot()).user).signal_track_record).toBeNull();
    expect(extractMarketData(buildPrompt(baseSnapshot(), null).user).signal_track_record).toBeNull();
  });

  it("tells the model to treat it as weak context", () => {
    const { user } = buildPrompt(baseSnapshot(), record);
    expect(user).toMatch(/signal_track_record describes past votes/);
  });
});

describe("buildPrompt derivatives (v1.11.0)", () => {
  it("includes the derivatives block when the snapshot has one", () => {
    const derivatives = { funding_rate_pct: 0.01, open_interest_btc: 50000, basis_pct: 0.0111 };
    const data = extractMarketData(buildPrompt(baseSnapshot({ derivatives })).user);

    expect(data.derivatives).toEqual(derivatives);
  });

  it("omits the block entirely when no derivatives were fetched", () => {
    expect(extractMarketData(buildPrompt(baseSnapshot()).user).derivatives).toBeUndefined();
    expect(extractMarketData(buildPrompt(baseSnapshot({ derivatives: null })).user).derivatives).toBeUndefined();
  });

  it("explains the fields and warns against using a single snapshot as a trend", () => {
    const { user } = buildPrompt(baseSnapshot());

    expect(user).toMatch(/funding_rate_pct/);
    expect(user).toMatch(/never infer a trend from a single snapshot/);
  });
});

describe("buildPrompt indicators (v1.9.0)", () => {
  it("computes indicators over the full M5 window, not just the trimmed sample", () => {
    const { user } = buildPrompt(baseSnapshot());
    const ind = extractMarketData(user).current_m5.indicators;

    expect(typeof ind.ema20).toBe("number");
    expect(typeof ind.ema50).toBe("number");
    expect(ind.rsi14).toBe(100); // strictly rising closes -> no losses
    expect(ind.atr14).toBeGreaterThan(0);
    expect(ind.atr_pct).toBeGreaterThan(0);
    expect(ind.range_pos_pct).toBeGreaterThan(90);
    expect(ind.range_pos_pct).toBeLessThanOrEqual(100);
    expect(typeof ind.vwap_window).toBe("number");
  });

  it("omits indicators that need more candles than the window has", () => {
    const { user } = buildPrompt(baseSnapshot()); // history blocks have only 10 candles
    const h1 = extractMarketData(user).history_h1.indicators;

    expect(h1.ema20).toBeUndefined();
    expect(h1.rsi14).toBeUndefined();
    expect(h1.atr14).toBeUndefined();
    expect(h1.range_pos_pct).toBeDefined();
    expect(h1.vwap_window).toBeUndefined(); // only sent for current_m5
  });

  it("finds the latest confirmed swing high as [price, candles_ago]", () => {
    const flat = Array.from({ length: 20 }, (_, i) => ({
      timestamp: 1700000000000 + i * 5 * 60 * 1000,
      open: 100,
      high: i === 10 ? 120 : 100,
      low: 99,
      close: 100,
      volume: 1,
      closed: true,
    }));
    const { user } = buildPrompt(baseSnapshot({ candles: flat }));
    const ind = extractMarketData(user).current_m5.indicators;

    expect(ind.swing_high).toEqual([120, 9]);
    expect(ind.swing_low).toBeUndefined();
  });
});

describe("buildPrompt key_levels (v1.9.0)", () => {
  function makeDaily(count) {
    return Array.from({ length: count }, (_, i) => ({
      timestamp: 1700000000000 + i * 24 * 60 * 60 * 1000,
      open: 100 + i,
      high: 110 + i,
      low: 90 + i,
      close: 105 + i,
      volume: 1000,
      closed: true,
    }));
  }

  it("derives previous day, week and year levels from closed daily candles", () => {
    const { user } = buildPrompt(baseSnapshot({ history_1d: makeDaily(40) }));
    const kl = extractMarketData(user).key_levels;

    expect(kl.prev_day).toEqual({ high: 149, low: 129, close: 144 });
    expect(kl.week_7d).toEqual({ high: 149, low: 123 });
    expect(kl.month_30d).toBeDefined();
    expect(kl.year).toEqual({ high: 149, low: 90, high_days_ago: 0, low_days_ago: 39, days: 40 });
    expect(kl.today).toBeUndefined();
  });

  it("reports the forming daily candle separately as today and excludes it from the levels", () => {
    const daily = makeDaily(40);
    daily.push({ ...daily[39], timestamp: daily[39].timestamp + 24 * 60 * 60 * 1000, high: 500, low: 50, closed: false });
    const { user } = buildPrompt(baseSnapshot({ history_1d: daily }));
    const kl = extractMarketData(user).key_levels;

    expect(kl.today).toEqual({ high: 500, low: 50 });
    expect(kl.prev_day.high).toBe(149);
    expect(kl.year.high).toBe(149);
  });

  it("is null when there are no closed daily candles", () => {
    const { user } = buildPrompt(baseSnapshot({ history_1d: [] }));
    expect(extractMarketData(user).key_levels).toBeNull();
  });
});

describe("buildPrompt task definition (v1.9.0)", () => {
  it("states the prediction horizon and explicit NO_TRADE criteria", () => {
    const { user } = buildPrompt(baseSnapshot());

    expect(user).toMatch(/NEXT 1-4 HOURS/);
    expect(user).toMatch(/NO_TRADE when/);
    expect(user).toMatch(/atr14/);
  });
});