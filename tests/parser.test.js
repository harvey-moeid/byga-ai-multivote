import { describe, it, expect } from "vitest";
import { parseSignal } from "../src/orchestrator/normalizer.js";

describe("parseSignal", () => {
  it("parses the standard SIGNAL/REASON format", () => {
    const text = "SIGNAL: BUY\nREASON: Struktur M5 menunjukkan higher high dan momentum bullish.";
    const r = parseSignal(text);
    expect(r.signal).toBe("BUY");
    expect(r.reason).toContain("bullish");
  });

  it("parses when extra commentary follows the required block", () => {
    const text = "SIGNAL: SELL\nREASON: Breakdown below support with rising volume.\n\nAdditional notes: watch 65k level.";
    const r = parseSignal(text);
    expect(r.signal).toBe("SELL");
    expect(r.reason).toBe("Breakdown below support with rising volume.");
  });

  it("is case-insensitive on the SIGNAL keyword", () => {
    const r = parseSignal("signal: no_trade\nreason: Range-bound, no clear structure.");
    expect(r.signal).toBe("NO_TRADE");
  });

  it("strips reasoning-model <think> content before falling back", () => {
    const text = "<think>hmm let me consider...</think>\nSIGNAL: BUY\nREASON: Reclaimed resistance.";
    const r = parseSignal(text);
    expect(r.signal).toBe("BUY");
  });

  it("returns ERROR on empty input, never forcing BUY/SELL", () => {
    expect(parseSignal("").signal).toBe("ERROR");
    expect(parseSignal(null).signal).toBe("ERROR");
  });

  it("does not infer a signal from prose containing BUY or SELL", () => {\n    expect(parseSignal("I would not BUY here because the structure is weak.").signal).toBe("ERROR");\n    expect(parseSignal("The setup could SELL if support breaks.").signal).toBe("ERROR");\n  });\n\n  it("returns ERROR when no valid signal keyword is present", () => {
    const r = parseSignal("The market looks interesting today, hard to say.");
    expect(r.signal).toBe("ERROR");
  });

  it("falls back to a loose leading keyword match", () => {
    const r = parseSignal("BUY - momentum is strong going into the next candle.");
    expect(r.signal).toBe("BUY");
  });
});