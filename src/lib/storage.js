export async function getLatestAnalysisTimestamp(db){const stmt=db?.prepare?.("SELECT created_at FROM analyses ORDER BY created_at DESC LIMIT 1");if(!stmt)return null;const r=await stmt.first();return r?.created_at??null}
export async function cleanupOldAnalyses(){return undefined}

/**
 * PLACEHOLDER - not yet implemented. Added only so `functions/api/history.js`
 * resolves at build time; currently always returns an empty page. Needs a
 * real query against the `analyses` table (id, created_at, signal, ...),
 * respecting limit/offset/signal filter, once src/orchestrator/analysis.js
 * is implemented and actually writes rows to save against.
 */
export async function listAnalyses(db, { limit = 50, offset = 0, signal = null } = {}) {
  return [];
}

/**
 * PLACEHOLDER - not yet implemented. Added only so
 * `functions/api/analysis/[id].js` resolves at build time; currently always
 * returns null (404). Needs a real query joining `analyses` +
 * `analysis_results` for the given id once analyses are actually saved.
 */
export async function getAnalysisDetail(db, id) {
  return null;
}
