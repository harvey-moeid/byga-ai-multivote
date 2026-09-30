import { PROVIDERS } from "../providers/registry.js";

export const MODEL_RE = /^[A-Za-z0-9._:/@+-]{1,120}$/;
const KEY = "model_overrides";
const MODEL_ALIASES = {
  "gemini-2.5-flash": "gemini-3.8-flash",
  "meta/llama-3.3-70b-instruct": "openai/gpt-oss-20b",
  "mistral-large-latest": "mistral-small-latest"
};

export function sanitizeSettings(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const p of PROVIDERS) {
    const s = input[p.meta.provider];
    if (!s || typeof s !== "object") continue;
    const entry = {};
    const model = typeof s.model === "string" ? s.model.trim() : "";
    if (model && MODEL_RE.test(model)) entry.model = MODEL_ALIASES[model] || model;
    if (s.enabled === false) entry.enabled = false;
    if (Object.keys(entry).length) out[p.meta.provider] = entry;
  }
  return out;
}

export async function loadModelSettings(db) {
  if (!db) return {};
  try {
    const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(KEY).first();
    return row?.value ? sanitizeSettings(JSON.parse(row.value)) : {};
  } catch (error) {
    console.error("loadModelSettings failed, falling back to defaults:", error?.message || error);
    return {};
  }
}

export async function saveModelSettings(db, settings) {
  const value = JSON.stringify(sanitizeSettings(settings));
  await db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(KEY, value, new Date().toISOString()).run();
  return JSON.parse(value);
}

export function applyModelOverrides(env, settings) {
  const out = { ...env };
  for (const p of PROVIDERS) {
    const model = settings?.[p.meta.provider]?.model;
    if (model) out[p.meta.modelEnv] = model;
  }
  return out;
}