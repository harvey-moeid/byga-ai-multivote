import { PROVIDERS } from "../../src/providers/registry.js";
import { MODEL_RE, loadModelSettings, saveModelSettings } from "../../src/lib/model-settings.js";

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" }
});

// GET /api/models -> providers with their effective model and enabled state.
// Never returns secrets, only whether an API key is configured.
export async function onRequestGet({ env }) {
  if (!env?.DB) return json(500, { error_code: "NO_DB", error: "D1 binding DB is not configured" });
  const settings = await loadModelSettings(env.DB);
  const items = PROVIDERS.map(({ meta }) => {
    const s = settings[meta.provider] || {};
    const defaultModel = String(env[meta.modelEnv] || meta.modelId);
    return {
      provider: meta.provider,
      label: meta.providerLabel,
      key_configured: Boolean(env[meta.keyEnv]),
      default_model: defaultModel,
      model: s.model || defaultModel,
      custom: Boolean(s.model),
      enabled: s.enabled !== false
    };
  });
  return json(200, { items });
}

// PUT /api/models  body: { settings: { <provider>: { model?: string, enabled?: boolean } } }
export async function onRequestPut({ env, request }) {
  if (!env?.DB) return json(500, { error_code: "NO_DB", error: "D1 binding DB is not configured" });
  if (!String(request.headers.get("content-type") || "").includes("application/json")) {
    return json(415, { error_code: "BAD_CONTENT_TYPE", error: "Content-Type harus application/json." });
  }
  let body;
  try { body = await request.json(); } catch { return json(400, { error_code: "BAD_JSON", error: "Body harus JSON." }); }
  const input = body?.settings;
  if (!input || typeof input !== "object") return json(400, { error_code: "BAD_BODY", error: "Field settings wajib diisi." });

  const known = new Set(PROVIDERS.map(p => p.meta.provider));
  for (const [provider, s] of Object.entries(input)) {
    if (!known.has(provider)) return json(400, { error_code: "UNKNOWN_PROVIDER", error: "Provider tidak dikenal: " + provider });
    const model = typeof s?.model === "string" ? s.model.trim() : "";
    if (model && !MODEL_RE.test(model)) return json(400, { error_code: "INVALID_MODEL", error: "Nama model tidak valid untuk " + provider });
  }
  const enabledCount = PROVIDERS.filter(p => input[p.meta.provider]?.enabled !== false).length;
  if (!enabledCount) return json(400, { error_code: "NO_PROVIDER_ENABLED", error: "Minimal satu model harus aktif." });

  const saved = await saveModelSettings(env.DB, input);
  return json(200, { ok: true, settings: saved });
}
