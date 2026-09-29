import { describe, it, expect } from "vitest";
import { buildICTContext, ICT_ENGINE_VERSION } from "../src/prompt/ict.js";

function candle(i, values) {
  const open = values.open;
  return {
    timestamp: 1700000000000 + i * 5 * 60 * 1000,
    open,
    high: values.high ?? open + 2,
    low: values.low ?? open - 2,
    close: values.close ?? open + 1,
    volume: 10,
    closed: true,
  };
}

function series(rows) {
  return rows.map((row, i) => candle(i, row));
}

describe("ICT engine", () => {
  it("exposes a stable engine version", () => {
    expect(ICT_ENGINE_VERSION).toBe("1.0.0");
  });

  it("detects a bullish FVG and keeps it active", () => {
    const m5 = series([
      { open: 100, high: 101, low: 99, close: 100 },
      { open: 100, high: 108, low: 100, close: 107 },
      { open: 107, high: 111, low: 106, close: 110 },
      { open: 110, high: 112, low: 109, close: 111 },
      { open: 111, high: 113, low: 110, close: 112 },
    ]);
    const ctx = buildICTContext({ m5 }, { swingLookback: 1 });
    expect(ctx.timeframes.m5.fvg.recent.some((x) => x.type === "BULLISH_FVG" && x.active)).toBe(true);
  });

  it("detects a sell-side liquidity sweep", () => {
    const m5 = series([
      { open: 100, high: 103, low: 98, close: 101 },
      { open: 101, high: 110, low: 100, close: 105 },
      { open: 105, high: 106, low: 99, close: 102 },
      { open: 102, high: 104, low: 90, close: 100 },
      { open: 100, high: 105, low: 96, close: 103 },
      { open: 103, high: 115, low: 100, close: 114 },
      { open: 114, high: 112, low: 105, close: 110 },
      { open: 110, high: 94, low: 88, close: 92 },
      { open: 92, high: 120, low: 92, close: 119 },
      { open: 119, high: 122, low: 116, close: 121 },
    ]);
    const ctx = buildICTContext({ m5 }, { swingLookback: 1 });
    expect(ctx.timeframes.m5.liquidity.recent_sweeps.some((x) => x.type === "SSL_SWEEP")).toBe(true);
  });

  it("builds a dealing range", () => {
    const m5 = series([
      { open: 100, high: 103, low: 98, close: 101 },
      { open: 101, high: 110, low: 100, close: 105 },
      { open: 105, high: 106, low: 99, close: 102 },
      { open: 102, high: 104, low: 90, close: 100 },
      { open: 100, high: 105, low: 96, close: 103 },
      { open: 103, high: 115, low: 100, close: 114 },
      { open: 114, high: 112, low: 105, close: 110 },
      { open: 110, high: 94, low: 88, close: 92 },
      { open: 92, high: 120, low: 92, close: 119 },
      { open: 119, high: 122, low: 116, close: 121 },
    ]);
    const ctx = buildICTContext({ m5 }, { swingLookback: 1 });
    expect(ctx.timeframes.m5.dealing_range).not.toBeNull();
    expect(["premium", "discount", "equilibrium"]).toContain(ctx.timeframes.m5.dealing_range.zone);
  });

  it("detects structural breaks", () => {
    const m5 = series([
      { open: 100, high: 103, low: 98, close: 101 },
      { open: 101, high: 110, low: 100, close: 105 },
      { open: 105, high: 106, low: 99, close: 102 },
      { open: 102, high: 104, low: 90, close: 100 },
      { open: 100, high: 105, low: 96, close: 103 },
      { open: 103, high: 115, low: 100, close: 114 },
      { open: 114, high: 112, low: 105, close: 110 },
      { open: 110, high: 94, low: 88, close: 92 },
      { open: 92, high: 120, low: 92, close: 119 },
      { open: 119, high: 122, low: 116, close: 121 },
    ]);
    const ctx = buildICTContext({ m5 }, { swingLookback: 1 });
    expect(ctx.timeframes.m5.structure.recent_events.length).toBeGreaterThan(0);
    expect(["bullish", "bearish"]).toContain(ctx.timeframes.m5.bias);
  });
});