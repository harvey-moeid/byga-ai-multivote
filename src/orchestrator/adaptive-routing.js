const DEFAULT_CORE = ["google-gemini", "groq", "openrouter"];
const DEFAULT_VERIFIERS = ["hugging-face", "cohere", "nvidia-api-catalog"];
const DEFAULT_BACKUPS = ["mistral-ai", "sambanova-cloud", "vercel-ai-gateway"];

const unique = values => [...new Set(values.filter(Boolean))];
const ids = list => new Set((Array.isArray(list) ? list : []).map(p => p?.meta?.provider).filter(Boolean));

function envList(env, key, fallback) {
  const raw = env?.[key];
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  return unique(raw.split(",").map(x => x.trim()).filter(Boolean));
}

export function scoreICTSetup(ict = {}) {
  const m5 = ict?.timeframes?.m5 || {};
  const m15 = ict?.timeframes?.m15 || {};
  const h1 = ict?.timeframes?.h1 || {};
  let score = 0;
  const reasons = [];
  const alignment = ict?.hierarchy?.alignment;

  if (alignment === "bullish" || alignment === "bearish") { score += 25; reasons.push("HTF alignment"); }
  else score += 5;
  if ((m5.structure?.recent_events || []).length) { score += 25; reasons.push("M5 BOS"); }
  if ((m5.liquidity?.recent_sweeps || []).length) { score += 20; reasons.push("liquidity sweep"); }
  if ((m5.fvg?.recent || []).length) { score += 15; reasons.push("M5 FVG"); }
  if ((m15.fvg?.recent || []).length || (h1.fvg?.recent || []).length) { score += 10; reasons.push("HTF FVG"); }
  if (["premium", "discount"].includes(m5.dealing_range?.zone)) { score += 5; reasons.push(m5.dealing_range.zone); }
  if (m5.bias && h1.bias && m5.bias === h1.bias) score += 5;

  return { score: Math.min(100, score), reasons, directional_bias: alignment === "mixed" ? null : alignment || m5.bias || null };
}

export function chooseAdaptivePlan(env, providers, { ict, requestedModels } = {}) {
  const available = ids(providers);
  const explicit = Array.isArray(requestedModels) && requestedModels.length;
  const selected = new Set((explicit ? requestedModels : [...available]).filter(id => available.has(id)));
  const score = scoreICTSetup(ict);
  const coreOrder = envList(env, "AI_CORE_PROVIDERS", DEFAULT_CORE);
  const verifierOrder = envList(env, "AI_VERIFIER_PROVIDERS", DEFAULT_VERIFIERS);
  const backupOrder = envList(env, "AI_BACKUP_PROVIDERS", DEFAULT_BACKUPS);
  const take = (order, n, exclude = new Set()) => order.filter(id => selected.has(id) && !exclude.has(id)).slice(0, n);
  const plan = { gate: "AI", setup_score: score.score, reasons: score.reasons, stages: [] };

  if (score.score < 40) {
    plan.gate = "NO_AI";
    return plan;
  }

  let core = take(coreOrder, 3);
  if (core.length < 3) core = [...new Set([...core, ...[...selected].filter(id => !core.includes(id))])].slice(0, 3);
  if (!core.length) { plan.gate = "NO_AI"; return plan; }

  plan.stages.push({ type: "core", providers: core });
  plan.verifier = take(verifierOrder, 2, new Set(core));
  plan.backups = take(backupOrder, 2, new Set([...core, ...plan.verifier]));
  plan.verifier_threshold = score.score >= 75 ? 2 : 1;
  return plan;
}

export function nextAdaptiveStage(plan, results = []) {
  const good = results.filter(r => r?.status === "success" && ["BUY", "SELL", "NO_TRADE"].includes(r.signal));
  if (!good.length) return plan.backups?.length ? { type: "fallback", providers: plan.backups } : null;

  const counts = good.reduce((a, r) => ({ ...a, [r.signal]: (a[r.signal] || 0) + 1 }), {});
  const top = Math.max(...Object.values(counts));
  const tied = Object.values(counts).filter(x => x === top).length > 1;
  const conflict = tied || (good.length >= 3 && top < Math.ceil(good.length * 2 / 3));
  if (conflict && plan.verifier?.length) return { type: "verifier", providers: plan.verifier };
  return null;
}

export const ROUTING_DEFAULTS = { core: DEFAULT_CORE, verifier: DEFAULT_VERIFIERS, backups: DEFAULT_BACKUPS };