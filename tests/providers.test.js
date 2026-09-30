import { describe, expect, it } from "vitest";
import { PROVIDERS, classifyProviderError } from "../src/providers/registry.js";

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

  it("classifies provider HTTP failures into actionable error codes", () => {
    expect(classifyProviderError(401, "Unauthorized")).toBe("AUTH_ERROR");
    expect(classifyProviderError(429, "Too many requests")).toBe("RATE_LIMITED");
    expect(classifyProviderError(404, "model not found")).toBe("MODEL_NOT_FOUND");
    expect(classifyProviderError(400, "The model does not exist")).toBe("MODEL_NOT_FOUND");
    expect(classifyProviderError(500, "upstream failure")).toBe("PROVIDER_SERVER_ERROR");\n    expect(classifyProviderError(410, "model reached end of life")).toBe("MODEL_NOT_FOUND");\n    expect(classifyProviderError(403, "This model is not available in your subscription tier")).toBe("MODEL_TIER_RESTRICTED");\n    expect(classifyProviderError(402, "A payment method is required")).toBe("BILLING_REQUIRED");
  });
});