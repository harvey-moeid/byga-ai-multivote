import { json,pipelineError } from '../../src/pipeline/http.js';

export async function onRequestGet({env}) {
  try {
    const rows=await env.DB.prepare("SELECT result,created_at,updated_at FROM pipeline_runs WHERE state='completed' AND result IS NOT NULL ORDER BY created_at DESC LIMIT 20").all();
    for (const row of rows.results||[]) {
      try {
        const result=JSON.parse(row.result);
        if (!['BUY','SELL'].includes(result.majority_signal)) continue;
        return json(200,{
          symbol:result.symbol||'BTCUSDT.P',
          timeframe:result.timeframe||'H1/M15/M5',
          signal:result.majority_signal,
          updated_at:result.created_at||row.updated_at||row.created_at||null
        });
      } catch {}
    }
    return json(200,{symbol:'BTCUSDT.P',timeframe:'H1/M15/M5',signal:null,updated_at:null});
  } catch (error) {
    return pipelineError(error);
  }
}
