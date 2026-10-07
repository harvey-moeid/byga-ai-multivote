import { describe,it,expect } from 'vitest';
import { getProviderHealth,summarizeProviderHealth } from '../src/lib/providerHealth.js';
import { setup } from './helpers/pipeline-db.js';

const providers=[
  {provider:'a',label:'Provider A',configured:true},
  {provider:'b',label:'Provider B',configured:true},
  {provider:'c',label:'Provider C',configured:true},
  {provider:'d',label:'Provider D',configured:false}
];
const row=(provider,status,created_at,error_code=null,duration_ms=500)=>({provider,status,created_at,error_code,duration_ms});

describe('provider health',()=>{
  it('marks configured providers without history as ready and missing secrets as not configured',()=>{
    const h=summarizeProviderHealth([],providers);
    expect(h.find(x=>x.provider==='a').state).toBe('READY');
    expect(h.find(x=>x.provider==='d').state).toBe('NOT_CONFIGURED');
  });

  it('marks stable recent calls healthy and exposes bounded operational metrics',()=>{
    const rows=Array.from({length:10},(_,i)=>row('a',i===8?'error':'success',new Date(Date.now()-i*60000).toISOString(),i===8?'RATE_LIMITED':null,400+i*10));
    const h=summarizeProviderHealth(rows,providers).find(x=>x.provider==='a');
    expect(h.state).toBe('HEALTHY');
    expect(h.samples).toBe(10);
    expect(h.success_rate_pct).toBe(90);
    expect(h.avg_latency_ms).toBeGreaterThan(0);
    expect(h.last_error_code).toBe('RATE_LIMITED');
  });

  it('does not classify semantic-invalid model output as a provider outage',()=>{
    const rows=[
      row('a','error','2026-10-07T03:00:00Z','SEMANTIC_INVALID_AI_RESPONSE',700),
      row('a','error','2026-10-07T02:59:00Z','SEMANTIC_INVALID_AI_RESPONSE',650),
      row('a','error','2026-10-07T02:58:00Z','SEMANTIC_INVALID_AI_RESPONSE',620),
      row('a','success','2026-10-07T02:57:00Z',null,500)
    ];
    const h=summarizeProviderHealth(rows,providers).find(x=>x.provider==='a');
    expect(h.state).toBe('HEALTHY');
    expect(h.success_rate_pct).toBe(100);
    expect(h.last_error_code).toBeNull();
  });

  it('keeps primary failures visible when a character succeeds through fallback',async()=>{
    const fixture=setup();
    try {
      const analysis=fixture.db.prepare(`INSERT INTO analyses
        (id,created_at,exchange,symbol,market_type,timeframe,market_snapshot,prompt_version,market_schema_version,majority_signal,decision_reason,buy_votes,sell_votes,no_trade_votes,success_count,error_count,total_models,duration_ms,last_price,price_change_pct_24h)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const resultRow=fixture.db.prepare(`INSERT INTO analysis_results
        (id,analysis_id,provider,provider_label,role,vote_index,vote_group,data_source,status,signal,reason,raw_answer,confidence,evidence_json,duration_ms,error_code,error,adapter_version,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const insert=fixture.db.prepare('INSERT INTO provider_attempts (id,analysis_id,result_id,analyst_id,provider,provider_label,model,attempt_index,status,duration_ms,error_code,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
      for(let i=0;i<3;i++) {
        const created='2026-10-08T00:0'+(3-i)+':00Z',analysisId='a'+i,result='r'+i;
        analysis.run(analysisId,created,'chart_db','BTCUSDT.P','perpetual','H1/M15/M5','{}','test','test','BUY','TEST',1,0,0,1,0,1,200,100,null);
        resultRow.run(result,analysisId,'workers-ai','Workers AI','smc_ict',1,'smc_ict_1','chart_db','success','BUY','ok','{}',80,'[]',200,null,null,'test',created);
        insert.run('p'+i,analysisId,result,'smc_ict_1','groq','Groq','test-model',1,'error',120,'RATE_LIMITED',created);
        insert.run('f'+i,analysisId,result,'smc_ict_1','workers-ai','Workers AI','@cf/test',2,'success',80,null,created);
      }
      const health=await getProviderHealth(fixture.env.DB,[
        {provider:'groq',label:'Groq',configured:true},
        {provider:'workers-ai',label:'Workers AI',configured:true}
      ]);
      expect(health.find(x=>x.provider==='groq').state).toBe('DOWN');
      expect(health.find(x=>x.provider==='workers-ai').state).toBe('HEALTHY');
    } finally { fixture.close(); }
  });

  it('marks three consecutive failures down and mixed results degraded',()=>{
    const down=[
      row('b','error','2026-10-05T03:00:00Z','AUTH_ERROR'),
      row('b','timeout','2026-10-05T02:59:00Z','AI_TIMEOUT'),
      row('b','error','2026-10-05T02:58:00Z','RATE_LIMITED'),
      row('b','success','2026-10-05T02:57:00Z')
    ];
    const degraded=[
      row('c','error','2026-10-05T03:00:00Z','RATE_LIMITED'),
      row('c','success','2026-10-05T02:59:00Z'),
      row('c','success','2026-10-05T02:58:00Z'),
      row('c','success','2026-10-05T02:57:00Z')
    ];
    const h=summarizeProviderHealth([...down,...degraded],providers);
    expect(h.find(x=>x.provider==='b').state).toBe('DOWN');
    expect(h.find(x=>x.provider==='c').state).toBe('DEGRADED');
  });
});
