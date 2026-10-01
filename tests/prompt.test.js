import { describe, expect, it } from "vitest";
import { PROMPT_VERSION, buildPrompt } from "../src/prompt/builder.js";

describe("prompt builder", () => {
  it("uses the current prompt version", () => {
    expect(PROMPT_VERSION).toBe("1.15.0");
  });

  it("requires chart_db confluence and the exact two-line output contract", () => {
    const { system, user } = buildPrompt({
      market_data_source: "chart_db",
      exchange: "chart_db",
      symbol: "BTCUSDT",
      candles: Array.from({ length: 40 }, (_, i) => ({
        timestamp: Date.now() - (40 - i) * 300000,
        open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 1000 + i
      })),
      history_m15: [], history_h1: [], history_h4: [], history_1d: []
    }, null, { role: "AI_A", voteIndex: 1 });
    expect(system).toContain("AI_A");
    expect(system).toContain("chart_db");
    expect(user).toContain("DATA SOURCE: chart_db");
    expect(user).toContain("SIGNAL: BUY");
    expect(user).toContain("REASON: <one concise sentence>");
    expect(user).toContain('"source":"chart_db"');
    expect(user).not.toContain("Ã");
  });
});