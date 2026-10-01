const PROVIDER_COUNT = 6;
const DEFAULT_PROVIDERS = [
  "google-gemini",
  "groq",
  "openrouter",
  "mistral-ai",
  "hugging-face",
  "cohere"
];
const ROLE_LABELS = ["AI_A", "AI_B", "AI_C", "AI_D", "AI_E", "AI_F"];

const unique = values => [...new Set((values || []).filter(Boolean))];

function envInt(env, key, fallback, min, max) {
  const n = Number(env?.[key]);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
}

export function scoreICTSetup(ict = {}) {
  const m5 = ict?.timeframes?.m5 || {};
  const m15 = ict?.timeframes?.m15 || {};
  const h1 = ict?.timeframes?.h1 || {};
  const h4 = ict?.timeframes?.h4 || {};
  let score = 0;
  const reasons = [];

  if (ict?.hierarchy?.alignment === "bullish" || ict?.hierarchy?.alignment === "bearish") {
    score += 25; reasons.push("HTF alignment");
  }
  if ((m5.structure?.recent_events || []).length) { score += 20; reasons.push("M5 BOS"); }
  if ((m5.liquidity?.recent_sweeps || []).length) { score += 20; reasons.push("liquidity sweep"); }
  if ((m5.fvg?.recent || []).length) { score += 15; reasons.push("M5 FVG"); }
  if ((m15.fvg?.recent || []).length || (h1.fvg?.recent || []).length || (h4.fvg?.recent || []).length) {
    score += 15; reasons.push("higher-timeframe FVG");
  }
  if (m5.bias && h1.bias && m5.bias === h1.bias) { score += 5; reasons.push("M5/H1 bias aligned"); }

  return {
    score: Math.min(100, score),
    reasons,
    directional_bias: ["bullish", "bearish"].includes(ict?.hierarchy?.alignment)
      ? ict.hierarchy.alignment
      : (m5.bias || null)
  };
}

// Picks PROVIDER_COUNT distinct providers for one analysis task. Each role
// (AI_A .. AI_F) can be pinned to a specific provider via an
// <ROLE>_PROVIDER env var (e.g. AI_C_PROVIDER=cohere); unset roles fall
// back to DEFAULT_PROVIDERS by position, and any still-missing slots are
// filled from whatever else is available so a task never silently runs
// with fewer than PROVIDER_COUNT voters as long as enough providers exist.
export function chooseAdaptivePlan(env, providers, { requestedModels } = {}) {
  const available = new Set((providers || []).map(p => p?.meta?.provider).filter(Boolean));
  const requested = Array.isArray(requestedModels) ? requestedModels.filter(x => available.has(x)) : [];

  const configured = ROLE_LABELS.map((role, i) => String(env?.[`${role}_PROVIDER`] || DEFAULT_PROVIDERS[i] || ""));

  const chosen = [];
  for (const id of configured) {
    if (id && available.has(id) && !chosen.includes(id)) chosen.push(id);
  }
  if (chosen.length < PROVIDER_COUNT) {
    for (const id of available) {
      if (chosen.length >= PROVIDER_COUNT) break;
      if (!chosen.includes(id)) chosen.push(id);
    }
  }

  const selected = requested.length >= PROVIDER_COUNT
    ? requested.slice(0, PROVIDER_COUNT)
    : unique(chosen).slice(0, PROVIDER_COUNT);

  const votesPerAI = envInt(env, "AI_VOTES_PER_PROVIDER", 2, 2, 2);
  const roles = selected.map((providerId, i) => ({
    role: ROLE_LABELS[i] || `AI_${i + 1}`,
    providerId,
    votes: votesPerAI
  }));

  return {
    gate: roles.length === PROVIDER_COUNT ? "AI" : "NO_AI",
    data_source: "chart_db",
    voter_count: roles.length,
    votes_per_provider: votesPerAI,
    total_vote_slots: roles.reduce((n, r) => n + r.votes, 0),
    roles,
    stages: roles.length ? [{ type: "confluence_vote", roles }] : []
  };
}

export function nextAdaptiveStage() {
  return null;
}

export const ROUTING_DEFAULTS = {
  providers: DEFAULT_PROVIDERS,
  provider_count: PROVIDER_COUNT,
  votes_per_provider: 2
};
