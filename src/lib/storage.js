const SIGNALS = ["BUY", "SELL", "NO_TRADE"];
const clampInt = (v, min, max, fallback) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };
export async function getLatestAnalysisTimestamp(db) { if (!db?.prepare) throw new Error("D1 binding DB is not configured"); const r = await db.prepare("SELECT created_at FROM analyses ORDER BY created_at DESC LIMIT 1").first(); return r?.created_at ?? null; }
export async function saveAnalysis(db, analysis, results = [], extraStatements = []) {
  if (!db?.prepare || !db?.batch) throw new Error("D1 binding DB does not support writes"); const a = analysis;
  const statements = [db.prepare(`INSERT INTO analyses
    (id,created_at,exchange,symbol,market_type,timeframe,market_snapshot,prompt_version,market_schema_version,majority_signal,decision_reason,buy_votes,sell_votes,no_trade_votes,success_count,error_count,total_models,duration_ms,last_price,price_change_pct_24h)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      a.id,a.created_at,a.exchange,a.symbol,a.market_type,a.timeframe,a.market_snapshot,a.prompt_version,a.market_schema_version,
      a.majority_signal,a.decision_reason || "MAJORITY",a.buy_votes,a.sell_votes,a.no_trade_votes,a.success_count,a.error_count,a.total_models,a.duration_ms,a.last_price,a.price_change_pct_24h
    )];
  for (const r of results) {
    statements.push(db.prepare(`INSERT INTO analysis_results
      (id,analysis_id,provider,provider_label,role,vote_index,vote_group,data_source,status,signal,reason,raw_answer,confidence,evidence_json,duration_ms,error_code,error,adapter_version,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(r.id,r.analysis_id,r.provider,r.provider_label,r.role,r.vote_index,r.vote_group,r.data_source,r.status,r.signal,r.reason,r.raw_answer,r.confidence,JSON.stringify(r.directional_evidence||[]),r.duration_ms,r.error_code,r.error,r.adapter_version,r.created_at));
    for (const [index,attempt] of (r.attempts||[]).entries()) statements.push(db.prepare(`INSERT INTO provider_attempts
      (id,analysis_id,result_id,analyst_id,provider,provider_label,model,attempt_index,status,duration_ms,error_code,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        r.id+':attempt:'+(index+1),r.analysis_id,r.id,r.analyst_id||r.vote_group,attempt.provider,attempt.provider_label||attempt.provider,
        attempt.model,index+1,attempt.status,attempt.duration_ms||0,attempt.error_code||null,r.created_at
      ));
  }
  await db.batch([...statements,...extraStatements]); return a;
}
export async function cleanupOldAnalyses(db, days = 365) { if (!db?.prepare) throw new Error("D1 binding DB is not configured"); const retention = clampInt(days, 1, 36500, 365); const cutoff = new Date(Date.now() - retention * 86400000).toISOString(); const result = await db.prepare("DELETE FROM analyses WHERE created_at < ?").bind(cutoff).run(); return { deleted: Number(result?.meta?.changes ?? 0), cutoff }; }
export async function listAnalyses(db, { limit = 50, offset = 0, signal = null } = {}) {
  if (!db?.prepare) throw new Error("D1 binding DB is not configured"); const n = clampInt(limit, 1, 200, 50), o = clampInt(offset, 0, 100000000, 0); const valid = SIGNALS.includes(String(signal || "").toUpperCase()) ? String(signal).toUpperCase() : null;
  const fields="id,created_at,exchange,symbol,market_type,timeframe,majority_signal,decision_reason,buy_votes,sell_votes,no_trade_votes,success_count,error_count,total_models,duration_ms,last_price,price_change_pct_24h";
  const query = valid ? db.prepare(`SELECT ${fields} FROM analyses WHERE majority_signal = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(valid,n,o) : db.prepare(`SELECT ${fields} FROM analyses ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(n,o); return (await query.all()).results || [];
}
export async function getAnalysisDetail(db, id) {
  if (!db?.prepare) throw new Error("D1 binding DB is not configured"); if (typeof id !== "string" || !id.trim()) return null;
  const analysis = await db.prepare("SELECT * FROM analyses WHERE id = ?").bind(id).first(); if (!analysis) return null;
  const results = await db.prepare("SELECT id,analysis_id,provider,provider_label,role,vote_index,vote_group,data_source,status,signal,reason,raw_answer,confidence,evidence_json,duration_ms,error_code,error,adapter_version,created_at FROM analysis_results WHERE analysis_id = ? ORDER BY role ASC, vote_index ASC").bind(id).all();
  let attempts=[];
  try {
    attempts=(await db.prepare("SELECT result_id,analyst_id,provider,provider_label,model,attempt_index,status,duration_ms,error_code,created_at FROM provider_attempts WHERE analysis_id = ? ORDER BY result_id ASC, attempt_index ASC").bind(id).all()).results||[];
  } catch {}
  const byResult=new Map();
  for(const attempt of attempts){if(!byResult.has(attempt.result_id))byResult.set(attempt.result_id,[]);byResult.get(attempt.result_id).push(attempt);}
  const normalized=(results.results||[]).map(r=>{
    const providerAttempts=byResult.get(r.id)||[],primary=providerAttempts[0],fallback=providerAttempts[1];
    return {
      ...r,directional_evidence:safeJson(r.evidence_json)||[],attempts:providerAttempts,
      primary_provider:primary?.provider||r.provider,primary_model:primary?.model||null,
      fallback_provider:fallback?.provider||null,fallback_model:fallback?.model||null,
      fallback_used:providerAttempts.length>1,fallback_reason:providerAttempts.length>1?(primary?.error_code||null):null
    };
  });
  return { ...analysis, market_snapshot: safeJson(analysis.market_snapshot), results: normalized };
}
function safeJson(value) { try { return JSON.parse(value); } catch { return null; } }
