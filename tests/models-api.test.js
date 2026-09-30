import { describe, expect, it } from "vitest";
import { onRequestPut } from "../functions/api/models.js";

// Minimal D1 stand-in: accepts any prepare().bind().run()/first() chain.
const fakeDb = () => {
  const stmt = { bind: () => stmt, run: async () => ({}), first: async () => null };
  return { prepare: () => stmt };
};

const put = (settings, env) => onRequestPut({
  env: { DB: fakeDb(), ...env },
  request: new Request("https://x.test/api/models", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ settings })
  })
});

describe("PUT /api/models: at least one enabled provider must have an API key", () => {
  it("rejects when no provider has a key, even if all are enabled", async () => {
    const res = await put({ groq: { enabled: true } }, {});
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe("NO_PROVIDER_ENABLED");
  });

  it("rejects when the only keyed provider is disabled", async () => {
    const res = await put({ groq: { enabled: false } }, { GROQ_API_KEY: "k", MISTRAL_API_KEY: "" });
    // every other provider has no key, so nothing usable remains enabled
    expect(res.status).toBe(400);
  });

  it("accepts when an enabled provider has a key", async () => {
    const res = await put({ groq: { enabled: true, model: "openai/gpt-oss-120b" } }, { GROQ_API_KEY: "k" });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("counts providers omitted from the body as enabled (full-replace semantics)", async () => {
    const res = await put({ cohere: { enabled: false } }, { GROQ_API_KEY: "k" });
    expect(res.status).toBe(200);
  });
});
