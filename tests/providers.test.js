import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../src/providers/registry.js";

describe("external AI provider registry", () => {
  it("contains all nine configured providers", () => {
    expect(PROVIDERS.map(p => p.meta.provider)).toEqual([
      "google-gemini","groq","openrouter","mistral-ai","hugging-face",
      "cohere","nvidia-api-catalog","sambanova-cloud","vercel-ai-gateway"
    ]);
  });

  it("has unique provider ids and labels", () => {
    expect(new Set(PROVIDERS.map(p => p.meta.provider)).size).toBe(9);
    expect(PROVIDERS.every(p => p.meta.providerLabel && p.meta.modelId)).toBe(true);
  });
});
