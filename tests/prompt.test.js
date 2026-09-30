import { describe, expect, it } from "vitest";
import { PROMPT_VERSION, buildPrompt } from "../src/prompt/builder.js";

describe("prompt builder", () => {
  it("uses the current prompt version", () => {
    expect(PROMPT_VERSION).toBe("1.13.0");
  });

  it("requires the exact two-line output contract", () => {
    const { system, user } = buildPrompt({
      exchange: "binance",
      symbol: "BTCUSDT",
      candles: Array.from({ length: 40 }, (_, i) => ({
        timestamp: Date.now() - (40 - i) * 300000,
        open: 100 + i,
        high: 102 + i,
        low: 99 + i,
        close: 101 + i,
        volume: 1000 + i
      }))
    });
    expect(system).toContain("deterministic ICT-style");
    expect(user).toContain("SIGNAL: BUY");
    expect(user).toContain("REASON: <one concise sentence>");
    expect(user).not.toContain("OUTPUT CONTRACT â");
  });
});