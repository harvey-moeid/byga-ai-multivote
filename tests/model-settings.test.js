import { describe, expect, it } from "vitest";
import { MODEL_RE, applyModelOverrides, sanitizeSettings } from "../src/lib/model-settings.js";

describe("model settings", () => {
  it("keeps only valid model overrides and disabled flags", () => {
    const out = sanitizeSettings({
      groq: { model: " llama-3.3-70b-versatile ", enabled: true },
      cohere: { enabled: false },
      nope: { model: "x" },
      "mistral-ai": { model: "bad model!" }
    });
    expect(out).toEqual({ groq: { model: "llama-3.3-70b-versatile" }, cohere: { enabled: false } });
  });

  it("applies overrides to the provider model env var", () => {
    const env = applyModelOverrides({ GROQ_MODEL: "a", OTHER: 1 }, { groq: { model: "b" } });
    expect(env.GROQ_MODEL).toBe("b");
    expect(env.OTHER).toBe(1);
  });

  it("accepts typical model ids", () => {
    expect(MODEL_RE.test("Qwen/Qwen3-235B-A22B-Instruct-2507:fastest")).toBe(true);
    expect(MODEL_RE.test("gemini-2.5-flash")).toBe(true);
  });
});
