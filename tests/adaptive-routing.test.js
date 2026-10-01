import { describe, expect, it } from "vitest";
import { chooseAdaptivePlan, nextAdaptiveStage, scoreICTSetup } from "../src/orchestrator/adaptive-routing.js";

const providers = ids => ids.map(provider => ({ meta: { provider } }));

describe("twelve-vote AI routing", () => {
  it("keeps six AI roles with two votes each", () => {
    const p = chooseAdaptivePlan(
      {},
      providers(["google-gemini", "groq", "openrouter", "mistral-ai", "hugging-face", "cohere", "nvidia-api-catalog"]),
      {}
    );
    expect(p.gate).toBe("AI");
    expect(p.roles).toHaveLength(6);
    expect(p.roles[0]).toMatchObject({ role: "AI_A", providerId: "google-gemini", votes: 2 });
    expect(p.roles[1]).toMatchObject({ role: "AI_B", providerId: "groq", votes: 2 });
    expect(p.roles[5]).toMatchObject({ role: "AI_F", providerId: "cohere", votes: 2 });
    expect(p.total_vote_slots).toBe(12);
    expect(p.data_source).toBe("chart_db");
  });

  it("respects explicit per-role provider configuration", () => {
    const p = chooseAdaptivePlan(
      {
        AI_A_PROVIDER: "openrouter",
        AI_B_PROVIDER: "cohere",
        AI_C_PROVIDER: "google-gemini",
        AI_D_PROVIDER: "groq",
        AI_E_PROVIDER: "mistral-ai",
        AI_F_PROVIDER: "hugging-face"
      },
      providers(["google-gemini", "groq", "openrouter", "cohere", "mistral-ai", "hugging-face"]),
      {}
    );
    expect(p.roles.map(x => x.providerId)).toEqual([
      "openrouter", "cohere", "google-gemini", "groq", "mistral-ai", "hugging-face"
    ]);
    expect(p.total_vote_slots).toBe(12);
  });

  it("falls back to another available provider when a configured role is missing", () => {
    const p = chooseAdaptivePlan(
      { AI_A_PROVIDER: "google-gemini", AI_B_PROVIDER: "groq" },
      providers(["google-gemini", "groq", "mistral-ai", "hugging-face", "cohere", "nvidia-api-catalog", "sambanova-cloud"]),
      {}
    );
    expect(nextAdaptiveStage(p)).toBeNull();
    expect(p.total_vote_slots).toBe(12);
    expect(p.roles).toHaveLength(6);
    expect(p.roles.map(x => x.providerId)).toContain("google-gemini");
    expect(p.roles.map(x => x.providerId)).toContain("groq");
  });

  it("drops to NO_AI gate when fewer than six providers are available", () => {
    const p = chooseAdaptivePlan(
      {},
      providers(["google-gemini", "groq"]),
      {}
    );
    expect(p.gate).toBe("NO_AI");
    expect(p.roles).toHaveLength(2);
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
