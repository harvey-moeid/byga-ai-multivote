import { getMarketSnapshot } from "../market/provider.js";
import { buildPrompt, PROMPT_VERSION } from "../prompt/builder.js";
import { PROVIDERS } from "../providers/registry.js";
import { selectProviders } from "./select-providers.js";
import { parseSignal } from "./normalizer.js";
import { computeVoting } from "./voting.js";
import { chooseAdaptivePlan, scoreICTSetup } from "./adaptive-routing.js";
import { saveAnalysis } from "../lib/storage.js";
import { loadModelSettings, applyModelOverrides } from "../lib/model-settings.js";
import { buildICTContext } from "../prompt/ict.js";

const nowIso = () => new Date().toISOString();
const number = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;

export async function runAnalysis(env, logger = () => {}, { models } = {}) {
  const started = Date.now();
  if (!env?.DB) throw new Error("D1 binding DB is not configured");
  const symbol = String(env.SYMBOL || "BTCUSDT").toUpperCase();
  const timeframe = String(env.TIMEFRAME || "5m");

  const snapshot = await getMarketSnapshot({
    primary: String(env.PRIMARY_EXCHANGE || "binance").toLowerCase(),
    fallback: env.FALLBACK_EXCHANGE || "bybit,okx",
    symbol,
    marketType: String(env.MARKET_TYPE || "perpetual"),
    timeframe,
    candleLimit: number(env.CANDLE_LIMIT, 150),
    db: env.DB,
    env,
    chartDb: env.CHART_DB
  });

  // chart_db is the confluence source. The exchange fallback is only used
  // when chart_db is unavailable; the routing metadata remains explicit.
  const ict = buildICTContext({
    m5: snapshot.candles || [],
    m15: snapshot.history_m15 || [],
    h1: snapshot.history_h1 || [],
    h4: snapshot.history_h4 || []
  });

  const settings = await loadModelSettings(env.DB);
  const selected = selectProviders(PROVIDERS, models).filter(p => settings[p.meta.provider]?.enabled !== false);
  if (!selected.length) throw new Error("No AI providers are enabled");
  const runEnv = applyModelOverrides(env, settings);
  const timeoutMs = Math.max(1000, number(env.AI_TIMEOUT_MS, 60000));
  const maxRetries = Math.max(0, Math.min(5, number(env.MAX_RETRIES, 1)));
  const routing = chooseAdaptivePlan(env, selected, { requestedModels: models });
  const providerMap = new Map(selected.map(p => [p.meta.provider, p]));

  const callVote = async ({ role, providerId, voteIndex }) => {
    const provider = providerMap.get(providerId);
    if (!provider) return null;
    const startedVote = Date.now();
    const meta = provider.meta || {};
    try {
      const prompt = buildPrompt(snapshot, null, { role, voteIndex });
      const raw = await provider.run({ env: runEnv, prompt, timeoutMs, maxRetries });
      const answer = typeof raw === "string" ? raw : (raw?.raw_answer ?? raw?.text ?? raw?.content ?? "");
      const parsed = raw?.signal ? { signal: String(raw.signal).toUpperCase(), reason: raw.reason || "" } : parseSignal(answer);
      if (!["BUY", "SELL", "NO_TRADE"].includes(parsed.signal)) {
        throw Object.assign(new Error("AI response does not contain a valid SIGNAL"), { code: "INVALID_AI_RESPONSE" });
      }
      return {
        id: crypto.randomUUID(),
        analysis_id: null,
        provider: meta.provider || providerId,
        provider_label: meta.providerLabel || meta.provider || providerId,
        role,
        vote_index: voteIndex,
        vote_group: `${role}_${voteIndex}`,
        data_source: "chart_db",
        status: "success",
        signal: parsed.signal,
        reason: parsed.reason || "",
        raw_answer: String(answer),
        confidence: Number.isFinite(Number(raw?.confidence)) ? Number(raw.confidence) : null,
        duration_ms: Date.now() - startedVote,
        error_code: null,
        error: null,
        adapter_version: String(meta.adapterVersion || "1.0.0"),
        created_at: nowIso()
      };
    } catch (err) {
      return {
        id: crypto.randomUUID(),
        analysis_id: null,
        provider: meta.provider || providerId,
        provider_label: meta.providerLabel || meta.provider || providerId,
        role,
        vote_index: voteIndex,
        vote_group: `${role}_${voteIndex}`,
        data_source: "chart_db",
        status: err?.name === "TimeoutError" ? "timeout" : "error",
        signal: null,
        reason: "",
        raw_answer: "",
        confidence: null,
        duration_ms: Date.now() - startedVote,
        error_code: String(err?.code || err?.error_code || "PROVIDER_ERROR"),
        error: String(err?.message || err).slice(0, 1000),
        adapter_version: String(meta.adapterVersion || "1.0.0"),
        created_at: nowIso()
      };
    }
  };

  const roles = routing.roles || [];
  const slots = roles.flatMap(({ role, providerId, votes }) =>
    Array.from({ length: votes }, (_, i) => ({ role, providerId, voteIndex: i + 1 }))
  );

  // Four independent calls: AI_A vote 1+2 and AI_B vote 1+2.
  const results = routing.gate === "AI" ? await Promise.all(slots.map(callVote)) : [];
  const cleanResults = results.filter(Boolean);
  const voting = computeVoting(cleanResults);
  const setup = scoreICTSetup(ict);
  const createdAt = nowIso();
  const id = `ANL-${createdAt.slice(0,10).replaceAll("-", "")}-${createdAt.slice(11,19).replaceAll(":", "")}-${crypto.randomUUID().slice(0,4).toUpperCase()}`;

  for (const r of cleanResults) r.analysis_id = id;

  const row = {
    id, created_at: createdAt, exchange: snapshot.exchange || "chart_db", symbol,
    market_type: String(env.MARKET_TYPE || "perpetual"), timeframe,
    market_snapshot: JSON.stringify(snapshot),
    prompt_version: String(env.PROMPT_VERSION || PROMPT_VERSION),
    market_schema_version: String(env.MARKET_SCHEMA_VERSION || "1.4.0"),
    majority_signal: voting.majority_signal,
    buy_votes: voting.buy, sell_votes: voting.sell, no_trade_votes: voting.no_trade,
    success_count: voting.success, error_count: voting.error, total_models: voting.total_models,
    duration_ms: Date.now() - started, last_price: Number.isFinite(Number(snapshot.last_price)) ? Number(snapshot.last_price) : null,
    price_change_pct_24h: Number.isFinite(Number(snapshot.price_change_pct_24h)) ? Number(snapshot.price_change_pct_24h) : null
  };

  await saveAnalysis(env.DB, row, cleanResults);
  logger?.("analysis.completed", {
    id, signal: voting.majority_signal, duration_ms: row.duration_ms,
    data_source: "chart_db", vote_slots: cleanResults.length
  });

  return {
    id, created_at: createdAt, exchange: row.exchange, symbol, timeframe,
    last_price: row.last_price, majority_signal: voting.majority_signal,
    voting, results: cleanResults.map(({ raw_answer, ...r }) => r),
    duration_ms: row.duration_ms,
    prompt_version: row.prompt_version,
    market_schema_version: row.market_schema_version,
    routing: {
      gate: routing.gate,
      data_source: "chart_db",
      setup_score: setup.score,
      reasons: setup.reasons,
      ai_a: roles[0] || null,
      ai_b: roles[1] || null,
      ai_calls: cleanResults.length,
      total_vote_slots: routing.total_vote_slots,
      expected_vote_slots: 4
    },
    market: {
      data_source: snapshot.market_data_source || "chart_db",
      fallback_used: !!snapshot.fallback_used,
      cached_snapshot_used: !!snapshot.cached_snapshot_used,
      chart_db_used: snapshot.market_data_source === "chart_db"
    }
  };
}
