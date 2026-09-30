const definitions = [
  { provider: "google-gemini", providerLabel: "Google Gemini", modelEnv: "GEMINI_MODEL", keyEnv: "GEMINI_API_KEY", endpoint: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", kind: "gemini", defaultModel: "gemini-2.5-flash" },
  { provider: "groq", providerLabel: "Groq", modelEnv: "GROQ_MODEL", keyEnv: "GROQ_API_KEY", endpoint: "https://api.groq.com/openai/v1/chat/completions", defaultModel: "openai/gpt-oss-120b" },
  { provider: "openrouter", providerLabel: "OpenRouter", modelEnv: "OPENROUTER_MODEL", keyEnv: "OPENROUTER_API_KEY", endpoint: "https://openrouter.ai/api/v1/chat/completions", defaultModel: "openai/gpt-oss-120b" },
  { provider: "mistral-ai", providerLabel: "Mistral AI", modelEnv: "MISTRAL_MODEL", keyEnv: "MISTRAL_API_KEY", endpoint: "https://api.mistral.ai/v1/chat/completions", defaultModel: "mistral-large-latest" },
  { provider: "hugging-face", providerLabel: "Hugging Face", modelEnv: "HF_MODEL", keyEnv: "HF_TOKEN", endpoint: "https://router.huggingface.co/v1/chat/completions", defaultModel: "openai/gpt-oss-120b:fastest" },
  { provider: "cohere", providerLabel: "Cohere", modelEnv: "COHERE_MODEL", keyEnv: "COHERE_API_KEY", endpoint: "https://api.cohere.com/v2/chat", kind: "cohere", defaultModel: "command-a-plus-05-2026" },
  { provider: "nvidia-api-catalog", providerLabel: "NVIDIA API Catalog", modelEnv: "NVIDIA_MODEL", keyEnv: "NVIDIA_API_KEY", endpoint: "https://integrate.api.nvidia.com/v1/chat/completions", defaultModel: "openai/gpt-oss-120b" },
  { provider: "sambanova-cloud", providerLabel: "SambaNova Cloud", modelEnv: "SAMBANOVA_MODEL", keyEnv: "SAMBANOVA_API_KEY", endpointEnv: "SAMBANOVA_BASE_URL", endpoint: "https://api.sambanova.ai/v1/chat/completions", defaultModel: "DeepSeek-V3.1" },
  { provider: "vercel-ai-gateway", providerLabel: "Vercel AI Gateway", modelEnv: "AI_GATEWAY_MODEL", keyEnv: "AI_GATEWAY_API_KEY", endpoint: "https://ai-gateway.vercel.sh/v1/chat/completions", defaultModel: "openai/gpt-oss-120b" }
];

function extractText(data, kind) {
  if (kind === "gemini") return (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("\n");
  if (kind === "cohere") return (data?.message?.content || []).map(p => p.text || "").join("\n");
  return data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? "";
}

async function request(def, { env, prompt, timeoutMs = 60000, maxRetries = 1 }) {
  const apiKey = env?.[def.keyEnv];
  if (!apiKey) throw Object.assign(new Error(`Missing secret ${def.keyEnv}`), { code: "MISSING_API_KEY" });
  const model = String(env?.[def.modelEnv] || def.defaultModel);
  const endpoint = def.endpointEnv ? String(env?.[def.endpointEnv] || def.endpoint) : def.endpoint;
  if (def.kind === "gemini") {
    const url = endpoint.replace("{model}", encodeURIComponent(model)) + "?key=" + encodeURIComponent(apiKey);
    return send(url, { "content-type": "application/json" }, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 2048 } }, def, timeoutMs, maxRetries);
  }
  if (def.kind === "cohere") {
    return send(endpoint, { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, { model, messages: [{ role: "user", content: prompt }], temperature: 0.2, max_tokens: 2048 }, def, timeoutMs, maxRetries);
  }
  return send(endpoint, { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, { model, messages: [{ role: "user", content: prompt }], temperature: 0.2, max_tokens: 2048 }, def, timeoutMs, maxRetries);
}

async function send(url, headers, body, def, timeoutMs, maxRetries) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = null; }
      if (!response.ok) {
        const message = data?.error?.message || data?.message || `Provider HTTP ${response.status}`;
        const error = Object.assign(new Error(String(message).slice(0, 500)), { code: response.status === 429 ? "RATE_LIMITED" : "PROVIDER_HTTP_ERROR", status: response.status });
        if (response.status < 500 && response.status !== 429) throw error;
        lastError = error;
      } else {
        const answer = extractText(data, def.kind);
        if (!String(answer).trim()) throw Object.assign(new Error("Provider returned an empty response"), { code: "EMPTY_AI_RESPONSE" });
        return { raw_answer: answer };
      }
    } catch (error) {
      if (error?.name === "AbortError") lastError = Object.assign(new Error("AI provider request timed out"), { name: "TimeoutError", code: "AI_TIMEOUT" });
      else lastError = error;
      if (error?.status && error.status < 500 && error.status !== 429) throw error;
    } finally { clearTimeout(timer); }
    if (attempt < maxRetries) await new Promise(resolve => setTimeout(resolve, Math.min(500 * 2 ** attempt, 2000)));
  }
  throw lastError || new Error("AI provider request failed");
}

export const PROVIDERS = definitions.map(def => ({
  meta: { provider: def.provider, providerLabel: def.providerLabel, modelId: def.defaultModel, adapterVersion: "1.0.0" },
  run: args => request(def, args)
}));
