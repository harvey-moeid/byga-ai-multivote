import { describe, expect, it,vi } from "vitest";
import { PROVIDERS, classifyProviderError } from "../src/providers/registry.js";

describe("external AI provider registry", () => {
  it('sends the exact model configured for a character without substituting aliases',async()=>{
    const f=vi.fn().mockResolvedValue(new Response(JSON.stringify({candidates:[{content:{parts:[{text:'SIGNAL: BUY'}]}}]}),{status:200}));
    vi.stubGlobal('fetch',f);
    try {
      await PROVIDERS.find(p=>p.meta.provider==='google-gemini').run({env:{GEMINI_API_KEY:'test-key',GEMINI_MODEL:'gemini-2.5-flash'},prompt:'snapshot',maxRetries:0});
      expect(String(f.mock.calls[0][0])).toContain('/gemini-2.5-flash:generateContent');
    }finally{vi.unstubAllGlobals();}
  });
  it("contains nine external providers and Workers AI", () => {
    expect(PROVIDERS.map(p => p.meta.provider)).toEqual([
      "google-gemini", "groq", "openrouter", "mistral-ai", "hugging-face",
      "cohere", "nvidia-api-catalog", "sambanova-cloud", "vercel-ai-gateway", "workers-ai"
    ]);
  });

  it("has unique provider ids and labels", () => {
    expect(new Set(PROVIDERS.map(p => p.meta.provider)).size).toBe(10);
    expect(PROVIDERS.every(p => p.meta.providerLabel && p.meta.modelId)).toBe(true);
  });

  it("classifies provider HTTP failures", () => {
    expect(classifyProviderError(401, "Unauthorized")).toBe("AUTH_ERROR");
    expect(classifyProviderError(429, "Too many requests")).toBe("RATE_LIMITED");
    expect(classifyProviderError(404, "model not found")).toBe("MODEL_NOT_FOUND");
    expect(classifyProviderError(400, "The model does not exist")).toBe("MODEL_NOT_FOUND");
    expect(classifyProviderError(500, "upstream failure")).toBe("PROVIDER_SERVER_ERROR");
    expect(classifyProviderError(410, "model reached end of life")).toBe("MODEL_NOT_FOUND");
    expect(classifyProviderError(403, "This model is not available in your subscription tier")).toBe("MODEL_TIER_RESTRICTED");
    expect(classifyProviderError(402, "A payment method is required")).toBe("BILLING_REQUIRED");
    expect(classifyProviderError(400, "User location is not supported for the API use.")).toBe("LOCATION_UNSUPPORTED");
  });
});
