const definitions = [
  { provider: "google-gemini", providerLabel: "Google Gemini", modelEnv: "GEMINI_MODEL", keyEnv: "GEMINI_API_KEY", endpoint: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", kind: "gemini", defaultModel: "gemini-3.8-flash" },
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
  if (kind === "cohere") { const content = data?.message?.content; if (Array.isArray(content)) return content.filter(p => p?.type === "text" || p?.text).map(p => p.text || "").join("\n"); if (typeof content === "string") return content; return data?.message?.text || ""; }
  return data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? "";
}

function splitPrompt(prompt) {
  if (typeof prompt === "string") return { system: "", user: prompt };
  return { system: String(prompt?.system ?? ""), user: String(prompt?.user ?? "") };
}

function chatMessages({ system, user }) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });
  return messages;
}

export function classifyProviderError(status, message = "") {
  const text = String(message || "").toLowerCase();
  if (status === 401) return "AUTH_ERROR";
  if (/payment method|credit card|billing|add one at|billing account/i.test(text)) return "BILLING_REQUIRED";\n  if (status === 403 && /subscription tier|not available in your subscription|plan/i.test(text)) return "MODEL_TIER_RESTRICTED";\n  if (status === 403) return "AUTH_FORBIDDEN";
  if (status === 429) return "RATE_LIMITED";
  if (
    status === 404 ||\n    status === 410 ||
    /model(?:\s+id)?\s*(?:not found|does not exist|is unavailable|not available)/i.test(text) ||
    /unknown model|invalid model|model .*not.*found|end of life/i.test(text)
  ) return "MODEL_NOT_FOUND";
  if (status >= 500) return "PROVIDER_SERVER_ERROR";
  return "PROVIDER_HTTP_ERROR";
}

async function request(def, { env, prompt, timeoutMs = 60000, maxRetries = 1 }) {
  const apiKey = env?.[def.keyEnv];
  if (!apiKey) throw Object.assign(new Error(`Missing secret ${def.keyEnv}`), { code: "MISSING_API_KEY" });
  const model = String(env?.[def.modelEnv] || def.defaultModel);
  const endpoint = def.endpointEnv ? String(env?.[def.endpointEnv] || def.endpoint) : def.endpoint;
  const p = splitPrompt(prompt);
  if (def.kind === "gemini") {
    const url = endpoint.replace("{model}", encodeURIComponent(model)) + "?key=" + encodeURIComponent(apiKey);
    const body = { contents: [{ role: "user", parts: [{ text: p.user }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 2048 } };
    if (p.system) body.systemInstruction = { parts: [{ text: p.system }] };
    return send(url, { "content-type": "application/json" }, body, def, timeoutMs, maxRetries);
  }
  return send(endpoint, { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, { model, messages: chatMessages(p), temperature: 0.2, max_tokens: 2048 }, def, timeoutMs, maxRetries);
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
        const message = data?.error?.message || data?.message || text || `Provider HTTP ${response.status}`;
        const code = classifyProviderError(response.status, message);
        const error = Object.assign(new Error(String(message).slice(0, 500)), { code, status: response.status });
        if (response.status < 500 && response.status !== 429) throw error;
        lastError = error;
      } else {
        const answer = extractText(data, def.kind);
        if (!String(answer).trim()) throw Object.assign(new Error("Provider returned no text content"), { code: "EMPTY_AI_RESPONSE" });
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
  meta: { provider: def.provider, providerLabel: def.providerLabel, modelId: def.defaultModel, modelEnv: def.modelEnv, keyEnv: def.keyEnv, adapterVersion: "1.0.0" },
  run: args => request(def, args)
}));