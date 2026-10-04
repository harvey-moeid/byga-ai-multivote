/**
 * GET /api/history?limit=&offset=&signal=
 * Lists past analyses for the History screen (PRD Section 29).
 */


export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const signal = url.searchParams.get("signal"); // BUY | SELL | NO_TRADE | null

  try {
    const where=['BUY','SELL','NO_TRADE'].includes(signal)?'WHERE a.majority_signal=?':'';
    const args=where?[signal]:[];
    args.push(Number.isFinite(limit)?Math.max(1,limit):50,Number.isFinite(offset)?Math.max(0,offset):0);
    const pipeline = await env.DB.prepare(`SELECT a.id,a.created_at,a.symbol,a.majority_signal,a.decision_reason,a.success_count,a.total_models,a.buy_votes,a.sell_votes,p.state,p.result FROM analyses a LEFT JOIN pipeline_runs p ON p.id=a.id ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`).bind(...args).all();
    const rows = (pipeline.results||[]).map(row=>{const r=row.result?JSON.parse(row.result):null;return r?{id:row.id,created_at:row.created_at,symbol:r.symbol,status:r.status,majority_signal:r.majority_signal,initial_direction:r.initial_direction,decision_reason:r.decision_reason,success_count:r.voting.success,total_models:r.voting.total_models,buy_votes:r.voting.buy,sell_votes:r.voting.sell,meeting:r.meeting}:{...row,state:undefined,result:undefined,status:'legacy'};});
    return json(200, { items: rows, limit, offset });
  } catch (err) {
    console.error(err);
    return json(500, { error_code: "UNKNOWN_ERROR", error: err.message });
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
