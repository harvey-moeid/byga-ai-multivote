import { describe,it,expect } from 'vitest';
import { summarizeProviderHealth } from '../src/lib/providerHealth.js';

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
