import { describe, expect, it } from "vitest";
import { chooseAdaptivePlan, nextAdaptiveStage, scoreICTSetup } from "../src/orchestrator/adaptive-routing.js";

const providers = ids => ids.map(provider => ({ meta: { provider } }));

describe("four-vote AI routing", () => {
  it("keeps two AI roles with two votes each", () => {
    const p = chooseAdaptivePlan(
      {},
      providers(["google-gemini", "groq", "openrouter"]),
      {}
    );
    expect(p.gate).toBe("AI");
    expect(p.roles).toHaveLength(2);
    expect(p.roles[0]).toMatchObject({ role: "AI_A", providerId: "google-gemini", votes: 2 });
    expect(p.roles[1]).toMatchObject({ role: "AI_B", providerId: "groq", votes: 2 });
    expect(p.total_vote_slots).toBe(4);
    expect(p.data_source).toBe("chart_db");
  });

  it("respects explicit AI A and B provider configuration", () => {
    const p = chooseAdaptivePlan(
      { AI_A_PROVIDER: "openrouter", AI_B_PROVIDER: "cohere" },
      providers(["google-gemini", "groq", "openrouter", "cohere"]),
      {}
    );
    expect(p.roles.map(x => x.providerId)).toEqual(["openrouter", "cohere"]);
    expect(p.total_vote_slots).toBe(4);
  });

  it("does not add fallback providers as extra votes", () => {
    const p = chooseAdaptivePlan(
      { AI_A_PROVIDER: "google-gemini", AI_B_PROVIDER: "groq" },
      providers(["google-gemini", "groq", "mistral-ai"]),
      {}
    );
    expect(nextAdaptiveStage(p)).toBeNull();
    expect(p.total_vote_slots).toBe(4);
    expect(p.roles.map(x => x.providerId)).not.toContain("mistral-ai");
  });

  it("scores ICT confluence", () => {
    const s = scoreICTSetup({
      hierarchy: { alignment: "bullish" },
      timeframes: {
        m5: { bias: "bullish", structure: { recent_events: [{ type: "BOS" }] }, liquidity: { recent_sweeps: [{ type: "SSL_SWEEP" }] }, fvg: { recent: [{}] } },
        m15: { fvg: { recent: [{}] } },
        h1: { fvg: { recent: [] } },
        h4: { fvg: { recent: [] } }
      }
    });
    expect(s.score).toBeGreaterThanOrEqual(75);
    expect(s.reasons).toContain("M5 BOS");
  });
});