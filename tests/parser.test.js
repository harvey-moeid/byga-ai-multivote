import { describe, it, expect } from "vitest";
import { parseSignal, parseAnalystDecision } from "../src/orchestrator/normalizer.js";

describe("parseSignal", () => {
  it("parses the standard SIGNAL/REASON format", () => {
    const r = parseSignal("SIGNAL: BUY\nCONFIDENCE: 82\nREASON: Struktur M5 menunjukkan higher high dan momentum bullish.");
    expect(r.signal).toBe("BUY");
    expect(r.confidence).toBe(82);
    expect(r.reason).toContain("bullish");
  });

  it("parses and clamps JSON confidence", () => {
    expect(parseSignal('{"signal":"SELL","confidence":0.91,"reason":"weak momentum"}').confidence).toBe(91);
    expect(parseSignal('{"signal":"BUY","confidence":120,"reason":"trend"}').confidence).toBe(100);
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

describe("parseAnalystDecision", () => {
  const context={
    group:"indicators",
    parameters:{},
    frames:{
      H1:{votes:{ema:"BUY",macd:"BUY",rsi:"NEUTRAL",bollinger:"NEUTRAL",adx:"BUY"}},
      M5:{votes:{ema:"BUY",macd:"SELL",rsi:"NEUTRAL",bollinger:"NEUTRAL",adx:"BUY"}}
    }
  };

  it("accepts strict JSON only when at least two evidence items are snapshot-verifiable", () => {
    const r=parseAnalystDecision(JSON.stringify({
      signal:"BUY",confidence:78,
      directional_evidence:[
        {timeframe:"H1",metric:"ema",supports:"BUY"},
        {timeframe:"M5",metric:"adx",supports:"BUY"}
      ],
      reason:"Trend and directional strength align."
    }),context);
    expect(r.signal).toBe("BUY");expect(r.confidence).toBe(78);expect(r.directional_evidence).toHaveLength(2);
  });

  it("rejects missing, duplicated, hallucinated, or contradictory evidence", () => {
    const base={signal:"BUY",confidence:90,reason:"Claim.",directional_evidence:[
      {timeframe:"H1",metric:"ema",supports:"BUY"},
      {timeframe:"H1",metric:"macd",supports:"BUY"}
    ]};
    expect(()=>parseAnalystDecision(JSON.stringify({...base,directional_evidence:[]}),context)).toThrow();
    expect(()=>parseAnalystDecision(JSON.stringify({...base,directional_evidence:[base.directional_evidence[0],base.directional_evidence[0]]}),context)).toThrow();
    expect(()=>parseAnalystDecision(JSON.stringify({...base,directional_evidence:[base.directional_evidence[0],{timeframe:"M5",metric:"macd",supports:"BUY"}]}),context)).toThrow();
    expect(()=>parseAnalystDecision("SIGNAL: BUY\nCONFIDENCE: 99\nREASON: prose",context)).toThrow();
  });
});
