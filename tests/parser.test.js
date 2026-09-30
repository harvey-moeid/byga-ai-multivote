import { describe, it, expect } from "vitest";
import { parseSignal } from "../src/orchestrator/normalizer.js";

describe("parseSignal", () => {
  it("parses the standard SIGNAL/REASON format", () => {
    const r = parseSignal("SIGNAL: BUY\nREASON: Struktur M5 menunjukkan higher high dan momentum bullish.");
    expect(r.signal).toBe("BUY");
    expect(r.reason).toContain("bullish");
  });

  it("parses extra commentary after the required block", () => {
    const r = parseSignal("SIGNAL: SELL\nREASON: Breakdown below support with rising volume.\n\nAdditional notes: watch 65k level.");
    expect(r.signal).toBe("SELL");
    expect(r.reason).toBe("Breakdown below support with rising volume.");
  });

  it("is case-insensitive", () => {
    expect(parseSignal("signal: no_trade\nreason: Range-bound.").signal).toBe("NO_TRADE");
  });

  it("strips reasoning-model <think> content", () => {
    expect(parseSignal("<think>hmm...</think>\nSIGNAL: BUY\nREASON: Reclaimed resistance.").signal).toBe("BUY");
  });

  it("returns ERROR on empty input", () => {
    expect(parseSignal("").signal).toBe("ERROR");
    expect(parseSignal(null).signal).toBe("ERROR");
  });

  it("does not infer a signal from prose", () => {
    expect(parseSignal("I would not BUY here because the structure is weak.").signal).toBe("ERROR");
    expect(parseSignal("The setup could SELL if support breaks.").signal).toBe("ERROR");
  });

  it("returns ERROR without a valid signal", () => {
    expect(parseSignal("The market looks interesting today, hard to say.").signal).toBe("ERROR");
  });

  it("accepts a loose leading keyword", () => {
    expect(parseSignal("BUY - momentum is strong.").signal).toBe("BUY");
  });
});