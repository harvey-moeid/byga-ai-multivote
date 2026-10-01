const DEFAULT_AI_A = "google-gemini";
const DEFAULT_AI_B = "groq";

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

export function chooseAdaptivePlan(env, providers, { requestedModels } = {}) {
  const available = new Set((providers || []).map(p => p?.meta?.provider).filter(Boolean));
  const requested = Array.isArray(requestedModels) ? requestedModels.filter(x => available.has(x)) : [];
  const configuredA = String(env?.AI_A_PROVIDER || DEFAULT_AI_A);
  const configuredB = String(env?.AI_B_PROVIDER || DEFAULT_AI_B);
  const aiA = available.has(configuredA) ? configuredA : [...available][0];
  const aiB = available.has(configuredB) && configuredB !== aiA
    ? configuredB
    : [...available].find(id => id !== aiA);

  const selected = requested.length >= 2
    ? requested.slice(0, 2)
    : unique([aiA, aiB]).filter(Boolean).slice(0, 2);

  const votesPerAI = envInt(env, "AI_VOTES_PER_PROVIDER", 2, 2, 2);
  const roles = selected.map((providerId, i) => ({
    role: i === 0 ? "AI_A" : "AI_B",
    providerId,
    votes: votesPerAI
  }));

  return {
    gate: roles.length === 2 ? "AI" : "NO_AI",
    data_source: "chart_db",
    voter_count: roles.length,
    votes_per_provider: votesPerAI,
    total_vote_slots: roles.reduce((n, r) => n + r.votes, 0),
    roles,
    stages: roles.length ? [{ type: "confluence_vote", roles }] : []
  };
}

export const ROUTING_DEFAULTS = {
  ai_a: DEFAULT_AI_A,
  ai_b: DEFAULT_AI_B,
  votes_per_provider: 2
};
