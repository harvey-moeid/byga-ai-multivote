import { describe, expect, it } from "vitest";
import { chooseAdaptivePlan, nextAdaptiveStage, scoreICTSetup } from "../src/orchestrator/adaptive-routing.js";

const providers = ids => ids.map(provider => ({ meta: { provider } }));
const strongICT = {
  hierarchy: { alignment: "bullish" },
  timeframes: {
    m5: { bias: "bullish", structure: { recent_events: [{ type: "BOS" }] }, liquidity: { recent_sweeps: [{ type: "SSL_SWEEP" }] }, fvg: { recent: [{}] }, dealing_range: { zone: "discount" } },
    m15: { fvg: { recent: [{}] } }, h1: { fvg: { recent: [] } }
  }
};

describe("adaptive routing", () => {
  it("scores strong structure above the gate", () => {
    const s = scoreICTSetup(strongICT);
    expect(s.score).toBeGreaterThanOrEqual(75);
    expect(s.reasons).toContain("M5 BOS");
  });
  it("does not suppress the primary vote for weak ICT conditions", () => {
    const p = chooseAdaptivePlan({}, providers(["google-gemini", "groq", "openrouter"]), { ict: { hierarchy: { alignment: "mixed" }, timeframes: { m5: { bias: "bullish" } } } });
    expect(p.gate).toBe("AI");
    expect(p.stages[0].providers).toEqual(["google-gemini", "groq", "openrouter"]);
  });
  it("uses all selected providers as primary voters", () => {
    const p = chooseAdaptivePlan({}, providers(["google-gemini", "groq", "openrouter", "cohere", "nvidia-api-catalog"]), { ict: strongICT });
    expect(p.stages[0].providers).toEqual(["google-gemini", "groq", "openrouter", "cohere", "nvidia-api-catalog"]);
    expect(p.verifier).toEqual([]);
  });
  it("uses backups when primary results conflict", () => {
    const p = chooseAdaptivePlan({}, providers(["google-gemini", "groq", "openrouter", "mistral-ai"]), { ict: strongICT });
    expect(nextAdaptiveStage(p, [{status:"success",signal:"BUY"},{status:"success",signal:"SELL"},{status:"error"}])).toEqual({type:"fallback",providers:["mistral-ai"]});
  });
  it("does not use backups for unanimous primary votes", () => {
    const p = chooseAdaptivePlan({}, providers(["google-gemini", "groq", "openrouter", "mistral-ai"]), { ict: strongICT });
    expect(nextAdaptiveStage(p, [{status:"success",signal:"BUY"},{status:"success",signal:"BUY"},{status:"success",signal:"BUY"}])).toBeNull();
  });
  it("uses backups when all primary requests fail", () => {
    const p = chooseAdaptivePlan({}, providers(["google-gemini", "groq", "openrouter", "mistral-ai"]), { ict: strongICT });
    expect(nextAdaptiveStage(p, [{status:"error"},{status:"timeout"},{status:"error"}])).toEqual({type:"fallback",providers:["mistral-ai"]});
  });
});