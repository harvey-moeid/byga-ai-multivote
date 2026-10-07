const LABELS={
  HEALTHY:'Healthy',
  DEGRADED:'Degraded',
  DOWN:'Down',
  READY:'Ready',
  NOT_CONFIGURED:'Not configured'
};

const round=n=>Math.round(Number(n)||0);

function summarize(rows=[],configured=true) {
  if(!configured)return {state:'NOT_CONFIGURED',label:LABELS.NOT_CONFIGURED,configured:false,samples:0,success_rate_pct:null,avg_latency_ms:null,last_checked_at:null,last_error_code:'NOT_CONFIGURED'};
  if(!rows.length)return {state:'READY',label:LABELS.READY,configured:true,samples:0,success_rate_pct:null,avg_latency_ms:null,last_checked_at:null,last_error_code:null};

  const operationalSuccess=row=>row.status==='success'||row.error_code==='SEMANTIC_INVALID_AI_RESPONSE';
  const success=rows.filter(operationalSuccess);
  const successRate=success.length/rows.length*100;
  let consecutiveFailures=0;
  for(const row of rows){if(operationalSuccess(row))break;consecutiveFailures++;}
  let state='DEGRADED';
  if(consecutiveFailures>=3||(rows.length>=4&&successRate<50))state='DOWN';
  else if(operationalSuccess(rows[0])&&successRate>=80)state='HEALTHY';

  const durations=success.map(r=>Number(r.duration_ms)).filter(Number.isFinite);
  const lastFailure=rows.find(r=>!operationalSuccess(r));
  return {
    state,label:LABELS[state],configured:true,samples:rows.length,
    success_rate_pct:Number(successRate.toFixed(1)),
    avg_latency_ms:durations.length?round(durations.reduce((a,b)=>a+b,0)/durations.length):null,
    last_checked_at:rows[0]?.created_at||null,
    last_error_code:lastFailure?.error_code||null
  };
}

export function summarizeProviderHealth(rows=[],providers=[]) {
  const grouped=new Map();
  for(const row of rows){
    if(!grouped.has(row.provider))grouped.set(row.provider,[]);
    grouped.get(row.provider).push(row);
  }
  return providers.map(p=>({
    provider:p.provider,
    label:p.label,
    ...summarize(grouped.get(p.provider)||[],p.configured)
  }));
}

export async function getProviderHealth(db,providers,{sampleLimit=12}={}) {
  if(!db?.prepare)return summarizeProviderHealth([],providers);
  try {
    const q=await db.prepare(`SELECT provider,status,error_code,duration_ms,created_at FROM (
      SELECT provider,status,error_code,duration_ms,created_at,
      ROW_NUMBER() OVER (PARTITION BY provider ORDER BY created_at DESC,attempt_index DESC) AS rn
      FROM (
        SELECT provider,status,error_code,duration_ms,created_at,attempt_index FROM provider_attempts
        UNION ALL
        SELECT ar.provider,ar.status,ar.error_code,ar.duration_ms,ar.created_at,1 AS attempt_index
        FROM analysis_results ar
        WHERE NOT EXISTS (SELECT 1 FROM provider_attempts pa WHERE pa.result_id=ar.id)
      )
    ) WHERE rn<=? ORDER BY provider,created_at DESC`).bind(sampleLimit).all();
    return summarizeProviderHealth(q.results||[],providers);
  } catch {
    try {
      const legacy=await db.prepare(`SELECT provider,status,error_code,duration_ms,created_at FROM (
        SELECT provider,status,error_code,duration_ms,created_at,
        ROW_NUMBER() OVER (PARTITION BY provider ORDER BY created_at DESC) AS rn
        FROM analysis_results
      ) WHERE rn<=? ORDER BY provider,created_at DESC`).bind(sampleLimit).all();
      return summarizeProviderHealth(legacy.results||[],providers);
    } catch {
      return summarizeProviderHealth([],providers);
    }
  }
}
