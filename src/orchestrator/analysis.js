import { getMarketSnapshot } from "../market/provider.js";
import { buildPrompt, PROMPT_VERSION } from "../prompt/builder.js";
import { PROVIDERS } from "../providers/registry.js";
import { selectProviders } from "./select-providers.js";
import { parseSignal } from "./normalizer.js";
import { computeVoting } from "./voting.js";
import { saveAnalysis } from "../lib/storage.js";

const nowIso = () => new Date().toISOString();
const number = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;

export async function runAnalysis(env, logger = () => {}, { models } = {}) {
  const started = Date.now();
  if (!env?.DB) throw new Error("D1 binding DB is not configured");
  const symbol = String(env.SYMBOL || "BTCUSDT").toUpperCase();
  const timeframe = String(env.TIMEFRAME || "5m");
  const marketType = String(env.MARKET_TYPE || "perpetual");
  const snapshot = await getMarketSnapshot({
    primary: String(env.PRIMARY_EXCHANGE || "binance").toLowerCase(),
    fallback: env.FALLBACK_EXCHANGE || "bybit,okx",
    symbol, marketType, timeframe,
    candleLimit: number(env.CANDLE_LIMIT, 150),
    db: env.DB, env
  });
  const prompt = buildPrompt(snapshot, null);
  const selected = selectProviders(PROVIDERS, models);
  if (!selected.length) throw new Error("No AI providers are configured");

  const timeoutMs = Math.max(1000, number(env.AI_TIMEOUT_MS, 60000));
  const maxRetries = Math.max(0, Math.min(5, number(env.MAX_RETRIES, 1)));
  const results = await Promise.all(selected.map(async provider => {
    const t = Date.now();
    const meta = provider.meta || {};
    try {
      if (typeof provider.run !== "function") throw Object.assign(new Error("Provider adapter is not implemented"), { code: "ADAPTER_NOT_CONFIGURED" });
      const raw = await provider.run({ env, prompt, timeoutMs, maxRetries });
      const answer = typeof raw === "string" ? raw : (raw?.raw_answer ?? raw?.text ?? raw?.content ?? "");
      const parsed = raw?.signal ? { signal: String(raw.signal).toUpperCase(), reason: raw.reason || "" } : parseSignal(answer);
      if (!["BUY", "SELL", "NO_TRADE"].includes(parsed.signal)) {
        throw Object.assign(new Error("AI response does not contain a valid SIGNAL"), { code: "INVALID_AI_RESPONSE" });
      }
      return { id: crypto.randomUUID(), analysis_id: null, provider: meta.provider || "unknown",
        provider_label: meta.providerLabel || meta.provider || "Unknown",
        status: "success", signal: parsed.signal, reason: parsed.reason || "",
        raw_answer: String(answer), confidence: Number.isFinite(Number(raw?.confidence)) ? Number(raw.confidence) : null,
        duration_ms: Date.now()-t, error_code: null, error: null,
        adapter_version: String(meta.adapterVersion || "1.0.0"), created_at: nowIso() };
    } catch (err) {
      return { id: crypto.randomUUID(), analysis_id: null, provider: meta.provider || "unknown",
        provider_label: meta.providerLabel || meta.provider || "Unknown",
        status: err?.name === "TimeoutError" ? "timeout" : "error", signal: null, reason: "",
        raw_answer: "", confidence: null, duration_ms: Date.now()-t,
        error_code: String(err?.code || err?.error_code || "PROVIDER_ERROR"),
        error: String(err?.message || err).slice(0, 1000),
        adapter_version: String(meta.adapterVersion || "1.0.0"), created_at: nowIso() };
    }
  }));

  const voting = computeVoting(results);
  const createdAt = nowIso();
  const id = `ANL-${createdAt.slice(0,10).replaceAll("-","")}-${createdAt.slice(11,19).replaceAll(":","")}-${crypto.randomUUID().slice(0,4).toUpperCase()}`;
  for (const r of results) r.analysis_id = id;
  const row = {
    id, created_at: createdAt, exchange: snapshot.exchange || "unknown", symbol,
    market_type: marketType, timeframe, market_snapshot: JSON.stringify(snapshot),
    prompt_version: String(env.PROMPT_VERSION || PROMPT_VERSION),
    market_schema_version: String(env.MARKET_SCHEMA_VERSION || "1.4.0"),
    majority_signal: voting.majority_signal, buy_votes: voting.buy, sell_votes: voting.sell,
    no_trade_votes: voting.no_trade, success_count: voting.success, error_count: voting.error,
    total_models: voting.total_models, duration_ms: Date.now()-started,
    last_price: Number.isFinite(Number(snapshot.last_price)) ? Number(snapshot.last_price) : null,
    price_change_pct_24h: Number.isFinite(Number(snapshot.price_change_pct_24h)) ? Number(snapshot.price_change_pct_24h) : null
  };
  await saveAnalysis(env.DB, row, results);
  logger?.("analysis.completed", { id, signal: voting.majority_signal, duration_ms: row.duration_ms });
  return { id, created_at: createdAt, exchange: row.exchange, symbol, timeframe,
    last_price: row.last_price, majority_signal: voting.majority_signal,
    voting, results: results.map(({raw_answer, ...r}) => r), duration_ms: row.duration_ms,
    prompt_version: row.prompt_version, market_schema_version: row.market_schema_version,
    market: { fallback_used: !!snapshot.fallback_used, cached_snapshot_used: !!snapshot.cached_snapshot_used } };
}