import { describe, it, expect } from "vitest";
import { computeOutcomeSummary, getSignalOutcomeSummary } from "../src/lib/signalOutcomes.js";

const HOUR = 60 * 60 * 1000;
// 2026-09-28T10:00:00Z, exactly on an hour boundary.
const T0 = Date.parse("2026-09-28T10:00:00.000Z");
const NOW = T0 + 10 * HOUR;

function analysis(offsetMs, signal, price, extra = {}) {
  return {
    created_at: new Date(T0 + offsetMs).toISOString(),
    exchange: "binance",
    symbol: "BTCUSDT",
    majority_signal: signal,
    last_price: price,
    ...extra,
  };
}

// Exit candle for a run at T0 with a 2h horizon opens at T0 + 1h (closes at T0 + 2h).
function closesAt(map, runOffsetMs, horizonHours, close, exchange = "binance") {
  const target = T0 + runOffsetMs + horizonHours * HOUR;
  const open = Math.floor(target / HOUR) * HOUR - HOUR;
  map.set(`${exchange}:BTCUSDT:${open}`, close);
}

describe("computeOutcomeSummary", () => {
  it("scores BUY up-moves and SELL down-moves as hits, in the signal's direction", () => {
    const closes = new Map();
    const analyses = [
      analysis(0, "BUY", 100), // -> 102: +2%
      analysis(HOUR, "BUY", 100), // -> 99: -1%
      analysis(2 * HOUR, "SELL", 100), // -> 96: +4% for a short
    ];
    closesAt(closes, 0, 2, 102);
    closesAt(closes, HOUR, 2, 99);
    closesAt(closes, 2 * HOUR, 2, 96);

    const s = computeOutcomeSummary(analyses, closes, { horizonHours: 2, windowDays: 365, now: NOW });

    expect(s.evaluated).toBe(3);
    expect(s.buy).toEqual({ n: 2, hit_rate_pct: 50, avg_return_pct: 0.5 });
    expect(s.sell).toEqual({ n: 1, hit_rate_pct: 100, avg_return_pct: 4 });
    expect(s.note).toMatch(/small sample/);
  });

  it("counts NO_TRADE separately and never scores it", () => {
    const s = computeOutcomeSummary([analysis(0, "NO_TRADE", 100), analysis(HOUR, "NO_TRADE", 100)], new Map(), {
      now: NOW,
    });

    expect(s.no_trade_n).toBe(2);
    expect(s.evaluated).toBe(0);
    expect(s.buy).toEqual({ n: 0 });
    expect(s.sell).toEqual({ n: 0 });
  });

  it("skips signals whose horizon has not elapsed or whose exit candle is missing", () => {
    const closes = new Map();
    const recent = analysis(9.5 * HOUR, "BUY", 100); // 2h horizon ends after NOW
    const noCandle = analysis(0, "BUY", 100);
    const s = computeOutcomeSummary([recent, noCandle], closes, { horizonHours: 2, now: NOW });

    expect(s).toBeNull(); // nothing evaluated and no NO_TRADE votes
  });

  it("matches exit candles per exchange, so a fallback exchange run is not scored with another exchange's candle", () => {
    const closes = new Map();
    closesAt(closes, 0, 2, 110, "binance");
    const s = computeOutcomeSummary([analysis(0, "BUY", 100, { exchange: "bybit" })], closes, { now: NOW });

    expect(s).toBeNull();
  });

  it("ignores rows with a missing or non-positive entry price and unknown signals", () => {
    const closes = new Map();
    closesAt(closes, 0, 2, 110);
    const s = computeOutcomeSummary(
      [analysis(0, "BUY", 0), analysis(0, "BUY", null), analysis(0, "MAYBE", 100), analysis(0, null, 100)],
      closes,
      { now: NOW }
    );

    expect(s).toBeNull();
  });

  it("drops the small-sample note once 20 signals are evaluated", () => {
    const closes = new Map();
    const analyses = [];
    for (let i = 0; i < 20; i++) {
      analyses.push(analysis(i * HOUR, "BUY", 100));
      closesAt(closes, i * HOUR, 2, 101);
    }
    const s = computeOutcomeSummary(analyses, closes, { horizonHours: 2, now: T0 + 40 * HOUR });

    expect(s.evaluated).toBe(20);
    expect(s.note).toBeUndefined();
  });

  it("returns null for an empty history", () => {
    expect(computeOutcomeSummary([], new Map(), { now: NOW })).toBeNull();
  });
});

describe("getSignalOutcomeSummary", () => {
  function fakeDb({ analyses, candles }) {
    return {
      prepare(sql) {
        const rows = sql.includes("FROM analyses") ? analyses : candles;
        const stmt = { bind: () => stmt, all: async () => ({ results: rows }) };
        return stmt;
      },
    };
  }

  it("joins stored analyses with cached 1h candles", async () => {
    const db = fakeDb({
      analyses: [analysis(0, "BUY", 100)],
      candles: [{ exchange: "binance", symbol: "BTCUSDT", timestamp: T0 + HOUR, close: 103 }],
    });
    const s = await getSignalOutcomeSummary(db, { days: 30, horizonHours: 2, now: NOW });

    expect(s.buy).toEqual({ n: 1, hit_rate_pct: 100, avg_return_pct: 3 });
    expect(s.window_days).toBe(30);
    expect(s.horizon_hours).toBe(2);
  });

  it("is null when there are no analyses", async () => {
    expect(await getSignalOutcomeSummary(fakeDb({ analyses: [], candles: [] }), { now: NOW })).toBeNull();
  });
});
