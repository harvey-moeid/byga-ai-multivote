import { describe,it,expect,vi,afterEach } from 'vitest';
import { calculateSnapshot,groupConsensus,meetingDecision,combineFrames,rsi,ema,adx,volumeFrame,derivativesFrame,smcFrame } from '../src/pipeline/calculate.js';
import { defaultSettings,validateSettings } from '../src/pipeline/config.js';
import { readChart } from '../src/pipeline/chart.js';
import { runPipeline,callAnalyst,analystPrompt,pipelineStatus } from '../src/pipeline/run.js';
import { sealWebhook,openWebhook,verifyCron,cronSignature,flushDiscord } from '../src/pipeline/discord.js';
import { onRequestPost } from '../functions/api/analyze.js';
import { onRequestGet,onRequestPut } from '../functions/api/settings.js';
import { onRequestPost as cron } from '../functions/api/cron.js';
import {dispatchCron} from '../src/pipeline/scheduler.js';
import { setup,candles } from './helpers/pipeline-db.js';
let resources=[];
const use=(mode)=>{const r=setup(mode);resources.push(r);return r;};
afterEach(()=>{resources.forEach(r=>r.close());resources=[];vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('deterministic formulas and gates',()=>{
  it('checks known RSI/EMA/ADX fixtures instead of model-generated numbers',()=>{
    expect(rsi([44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28],14)).toBeCloseTo(70.464,2);
    expect(ema([1,2,3,4,5],3)).toEqual([null,null,2,3,4]);
    expect(adx(candles('M5',250,'flat'),14).adx).toBe(0);
  });
  it('requires two directional groups; neutral and opposing signals cannot pass',()=>{
    const g=(a,b,c,d='NEUTRAL')=>groupConsensus({smc_ict:{signal:a},indicators:{signal:b},volume:{signal:c},derivatives:{signal:d}});
    expect(g('BUY','BUY','NEUTRAL').direction).toBe('BUY');
    expect(g('SELL','NEUTRAL','SELL').direction).toBe('SELL');
    expect(g('BUY','SELL','NEUTRAL').meeting).toBe(false);
    const split=g('BUY','BUY','SELL','SELL');
    expect(split.meeting).toBe(false);expect(split.direction).toBe('NEUTRAL');expect(split.reason).toBe('GROUP_CONSENSUS_TIE');
    expect(g('NEUTRAL','NEUTRAL','NEUTRAL').meeting).toBe(false);
  });
  it('requires four successful votes for the initial direction, including partial failures',()=>{
    const votes=(list)=>list.map(signal=>({signal,status:signal?'success':'error'}));
    expect(meetingDecision(votes(['BUY','BUY','BUY','BUY','SELL',null]),'BUY').approved).toBe(true);
    expect(meetingDecision(votes(['SELL','SELL','SELL','SELL','BUY','BUY']),'BUY').approved).toBe(false);
    expect(meetingDecision(votes(['BUY','BUY','BUY','SELL','SELL','SELL']),'BUY').approved).toBe(false);
    expect(meetingDecision(votes(['BUY','BUY','BUY','NO_TRADE',null,null]),'BUY').success).toBe(3);
  });
  it('uses trend and trigger agreement while rejecting an opposing structure frame',()=>{
    const roles={trend:'H1',structure:'M15',trigger:'M5'};
    const combine=(a,b,c)=>combineFrames({H1:{signal:a},M15:{signal:b},M5:{signal:c}},roles);
    expect(combine('BUY','NEUTRAL','BUY')).toBe('BUY');
    expect(combine('BUY','SELL','BUY')).toBe('NEUTRAL');
    expect(combine('BUY','BUY','SELL')).toBe('NEUTRAL');
  });
  it('calculates a reproducible snapshot and preserves inputs',()=>{
    const {market,settings}=use();const original=JSON.stringify(market);
    const first=calculateSnapshot(market,settings),second=calculateSnapshot(market,settings);
    expect(first).toEqual(second);expect(JSON.stringify(market)).toBe(original);expect(first.gate.direction).toBe('BUY');
    expect(calculateSnapshot(use('down').market,settings).gate.direction).toBe('SELL');
    expect(calculateSnapshot(use('flat').market,settings).gate.meeting).toBe(false);
  });
  it('does not mark pivots confirmed without right-side closed candles',()=>{
    const s=defaultSettings({}).calculation.smc,c=candles('M5');
    c[c.length-2].high=1000;
    expect(smcFrame(c,s).measurements.pivots.some(p=>p.index===c.length-2)).toBe(false);
  });
  it('avoids mixing contracts with BTC volume across a venue transition',()=>{
    const {settings}=use();const c=candles('M5');c.at(-1).source='okx_swap';
    const result=volumeFrame(c,settings.calculation.volume);
    expect(result.signal).toBe('NEUTRAL');expect(result.measurements.available).toBe(1);
  });
  it('scores derivative positioning deterministically from chart_db metrics',()=>{
    const {market,settings}=use();
    const d=derivativesFrame(market.series.M5,{...market.derivatives.frames.M5,funding:market.derivatives.funding},settings.calculation.derivatives);
    expect(d.signal).toBe('BUY');expect(d.votes.openInterest).toBe('BUY');expect(d.votes.funding).toBe('BUY');
    expect(calculateSnapshot(market,settings).groups.derivatives.signal).toBe('BUY');
  });
});
describe('real SQL read-only source and run guards',()=>{
  it('rejects open, stale, missing, and invalid candles with no AI/fallback calls',async()=>{
    const {env,chart,settings}=use();const ai=vi.spyOn(env.AI,'run');
    await expect(readChart(env,settings)).resolves.toHaveProperty('data_source','chart_db');
    chart.exec("UPDATE candles SET is_closed=0 WHERE timeframe='M5' AND open_time=(SELECT MAX(open_time) FROM candles WHERE timeframe='M5')");
    await expect(runPipeline(env)).rejects.toHaveProperty('code','CHART_DATA_ERROR');expect(ai).not.toHaveBeenCalled();
    chart.exec('UPDATE candles SET is_closed=1');
    await expect(readChart(env,settings,Date.now()+7200000)).rejects.toHaveProperty('code','CHART_DATA_ERROR');
    chart.exec("UPDATE candles SET high=0 WHERE timeframe='M5'");
    await expect(readChart(env,settings)).rejects.toHaveProperty('code','CHART_DATA_ERROR');
  });
  it('filters neutral auto runs but lets manual analysis call all eight AI',async()=>{
    const {env,db}=use('flat');const ai=vi.spyOn(env.AI,'run'),fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
    const auto=await runPipeline(env,{trigger:'cron'});expect(auto.status).toBe('filtered');expect(auto.results).toHaveLength(0);expect(ai).not.toHaveBeenCalled();
    const manual=await runPipeline(env);expect(manual.status).toBe('manual_inconclusive');expect(manual.meeting).toBe(true);expect(manual.gate_passed).toBe(false);expect(manual.results).toHaveLength(8);expect(ai).toHaveBeenCalledTimes(8);
    expect(manual.results.every(r=>r.status==='error'&&r.error_code==='SEMANTIC_INVALID_AI_RESPONSE')).toBe(true);
    expect(manual.majority_signal).toBeNull();expect(manual.delivery.eligible).toBe(false);expect(fetchMock).not.toHaveBeenCalled();expect(db.prepare('SELECT COUNT(*) AS n FROM analyses').get().n).toBe(2);
  });
  it('runs eight characters on the same provider and isolates each model/snapshot',async()=>{
    const {env,db}=use();const ai=vi.spyOn(env.AI,'run');
    const r=await runPipeline(env);expect(r.results).toHaveLength(8);expect(r.voting.approved).toBe(true);expect(ai).toHaveBeenCalledTimes(8);
    expect(new Set(r.results.map(r=>r.analyst_id)).size).toBe(8);
    const a={...defaultSettings(env).analysts[0],model:'@cf/test/custom-model'};
    await callAnalyst(env,r.snapshot,a);expect(ai.mock.calls.at(-1)[0]).toBe('@cf/test/custom-model');
    const prompt=JSON.parse(analystPrompt(r.snapshot,a).user);expect(prompt.group_snapshot.group).toBe('smc_ict');expect(prompt.groups).toBeUndefined();expect(prompt.initial_direction).toBeUndefined();expect(prompt.market_regime.label).toBeTruthy();
    expect(prompt.locked_rubric.mode).toBe('STRUCTURE_CONFLUENCE');expect(prompt.semantic_contract.required_directional_evidence).toBe(2);
    expect(r.results.every(x=>x.directional_evidence.length>=2)).toBe(true);
    expect(JSON.parse(db.prepare('SELECT evidence_json FROM analysis_results LIMIT 1').get().evidence_json).length).toBeGreaterThanOrEqual(2);
    expect(db.prepare('SELECT COUNT(*) AS n FROM analysis_results').get().n).toBe(8);
  });
  it('deduplicates cron per candle while allowing repeated manual analyses',async()=>{
    const {env,db}=use();const ai=vi.spyOn(env.AI,'run');
    const firstManual=await runPipeline(env),secondManual=await runPipeline(env);
    expect(firstManual.duplicate).not.toBe(true);expect(secondManual.duplicate).not.toBe(true);expect(ai).toHaveBeenCalledTimes(16);
    const cronRuns=await Promise.all([runPipeline(env,{trigger:'cron'}),runPipeline(env,{trigger:'cron'})]);
    expect(cronRuns.filter(r=>r.duplicate)).toHaveLength(1);expect(ai).toHaveBeenCalledTimes(24);
    const repeat=await runPipeline(env,{trigger:'cron'});expect(repeat.duplicate).toBe(true);expect(ai).toHaveBeenCalledTimes(24);
    expect(db.prepare('SELECT COUNT(*) AS n FROM pipeline_runs').get().n).toBe(3);
  });
  it('does not call AI when the client snapshot became outdated',async()=>{
    const {env}=use();const ai=vi.spyOn(env.AI,'run');
    await expect(runPipeline(env,{expectedCandleTimes:{M5:1}})).rejects.toHaveProperty('code','SNAPSHOT_CHANGED');expect(ai).not.toHaveBeenCalled();
  });
  it('never turns provider failure or NO_TRADE into a fabricated directional vote',async()=>{
    const {env}=use();const snapshot=calculateSnapshot(use().market,defaultSettings(env)),a=defaultSettings(env).analysts[0];
    env.AI.run=async()=>({response:'SIGNAL: NO_TRADE'});expect((await callAnalyst(env,snapshot,a)).status).toBe('error');
    env.AI.run=async()=>{throw Error('sensitive upstream error');};const r=await callAnalyst(env,snapshot,a);expect(r.signal).toBeNull();expect(r.error).not.toContain('sensitive');
  });
});
describe('settings, authentication, and Discord delivery',()=>{
  it('allows one provider across eight slots but rejects invalid parameters and frame ordering',()=>{
    const s=defaultSettings({AI:{run(){}}});expect(validateSettings(s,{AI:{run(){}}}).analysts).toHaveLength(8);
    s.calculation.indicators.emaFast=80;expect(()=>validateSettings(s,{})).toThrow();
    s.calculation.indicators.emaFast=20;s.calculation.frames.trigger='H1';expect(()=>validateSettings(s,{})).toThrow();
  });
  it('encrypts webhook URLs, rejects arbitrary destinations, and never returns the token',async()=>{
    const {env,db,settings}=use();const url='https://discord.com/api/webhooks/123/unit_test_token';
    const put=await onRequestPut({env,request:new Request('https://x/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({settings,discord_webhook:url})})});expect(put.status).toBe(200);
    const encrypted=db.prepare("SELECT value FROM app_settings WHERE key='discord_webhook_encrypted'").get().value;expect(encrypted).not.toContain('unit_test_token');expect(await openWebhook(encrypted,env.SESSION_SECRET)).toBe(url);
    const get=await onRequestGet({env});const getText=await get.text();expect(getText).not.toContain('unit_test_token');
    const settingsPayload=JSON.parse(getText);expect(settingsPayload.provider_health).toHaveLength(settingsPayload.providers.length);
    expect(settingsPayload.provider_health.find(x=>x.provider==='workers-ai').state).toBe('READY');
    await expect(sealWebhook('https://example.com/webhook','x')).rejects.toThrow();await expect(openWebhook(encrypted,'wrong')).rejects.toThrow();
  });
  it('requires a fresh HMAC covering the exact cron body',async()=>{
    const {env}=use(),time=String(Date.now()),body='{}',headers={'x-byga-time':time,'x-byga-signature':await cronSignature(env.SESSION_SECRET,time,body)};
    expect(await verifyCron(new Request('https://x/api/cron',{method:'POST',headers,body}),env.SESSION_SECRET)).toBe(true);
    expect(await verifyCron(new Request('https://x/api/cron',{method:'POST',headers,body:'{"modified":true}'}),env.SESSION_SECRET)).toBe(false);
    const old=String(Date.now()-180000),stale={'x-byga-time':old,'x-byga-signature':await cronSignature(env.SESSION_SECRET,old,body)};
    expect((await cron({env,request:new Request('https://x/api/cron',{method:'POST',headers:stale,body})})).status).toBe(401);
  });
  it('uses the Cloudflare-supported manual redirect mode and validates the signed dispatch',async()=>{
    const {env}=use('flat');env.APP_URL='https://test.example';
    const f=vi.fn(async(url,options)=>{
      expect(options.redirect).toBe('manual');
      return cron({env,request:new Request(url,options)});
    });vi.stubGlobal('fetch',f);
    expect((await dispatchCron(env)).status).toBe('filtered');
    f.mockResolvedValue(new Response('',{status:302,headers:{location:'https://other.example'}}));
    await expect(dispatchCron(env)).rejects.toThrow('CRON_REDIRECT_BLOCKED');
  });
  it('queues only approved signals and does not send again after acknowledgment',async()=>{
    const {env,db}=use();env.DISCORD_WEBHOOK_URL='https://discord.com/api/webhooks/123/test_token';
    const f=vi.fn().mockResolvedValue(new Response('{}',{status:200}));vi.stubGlobal('fetch',f);
    const r=await runPipeline(env,{trigger:'cron'});expect(r.voting.support).toBe(8);expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][1].redirect).toBe('manual');
    expect(JSON.parse(f.mock.calls[0][1].body).allowed_mentions.parse).toEqual([]);
    await flushDiscord(env);await runPipeline(env,{trigger:'cron'});expect(f).toHaveBeenCalledTimes(1);expect(db.prepare('SELECT state FROM discord_outbox').get().state).toBe('sent');
  });
  it('retries rate-limited delivery without rerunning AI',async()=>{
    const {env,db}=use();env.DISCORD_WEBHOOK_URL='https://discord.com/api/webhooks/123/test_token';
    const ai=vi.spyOn(env.AI,'run'),f=vi.fn().mockResolvedValueOnce(new Response('',{status:429,headers:{'retry-after':'2'}})).mockResolvedValue(new Response('{}',{status:200}));vi.stubGlobal('fetch',f);
    await runPipeline(env,{trigger:'cron'});expect(db.prepare('SELECT state FROM discord_outbox').get().state).toBe('pending');
    db.exec('UPDATE discord_outbox SET next_attempt=0');await flushDiscord(env);expect(ai).toHaveBeenCalledTimes(8);expect(f).toHaveBeenCalledTimes(2);
    expect((await pipelineStatus(env)).latest.result.delivery.state).toBe('sent');
    expect((await runPipeline(env,{trigger:'cron'})).delivery.state).toBe('sent');
  });
  it('excludes semantic-invalid directional claims and never sends them to Discord',async()=>{
    const {env,db}=use();env.DISCORD_WEBHOOK_URL='https://discord.com/api/webhooks/123/test_token';
    env.AI.run=async()=>({response:JSON.stringify({signal:'SELL',confidence:99,directional_evidence:[],reason:'unsupported opposing claim'})});
    const f=vi.fn();vi.stubGlobal('fetch',f);
    const r=await runPipeline(env);expect(r.status).toBe('rejected');expect(r.voting.sell).toBe(0);expect(r.voting.success).toBe(0);expect(r.majority_signal).toBeNull();
    expect(r.results.every(x=>x.error_code==='SEMANTIC_INVALID_AI_RESPONSE')).toBe(true);
    expect(f).not.toHaveBeenCalled();expect(db.prepare('SELECT COUNT(*) AS n FROM discord_outbox').get().n).toBe(0);
  });
  it('expires old queued signals before a newly configured webhook can send them',async()=>{
    const {env,db}=use();await runPipeline(env);
    db.exec('UPDATE discord_outbox SET expires_at=0');env.DISCORD_WEBHOOK_URL='https://discord.com/api/webhooks/123/test_token';
    const f=vi.fn();vi.stubGlobal('fetch',f);await flushDiscord(env);expect(f).not.toHaveBeenCalled();expect(db.prepare('SELECT state FROM discord_outbox').get().state).toBe('expired');
  });
  it('blocks webhook redirects permanently without forwarding the request or token',async()=>{
    const {env,db}=use();env.DISCORD_WEBHOOK_URL='https://discord.com/api/webhooks/123/test_token';
    const f=vi.fn().mockResolvedValue(new Response('',{status:302,headers:{location:'https://other.example'}}));vi.stubGlobal('fetch',f);
    await runPipeline(env);expect(f).toHaveBeenCalledTimes(1);expect(db.prepare('SELECT state FROM discord_outbox').get().state).toBe('failed');
    await flushDiscord(env);expect(f).toHaveBeenCalledTimes(1);
  });
  it('respects disabled cron and rejects non-JSON manual requests',async()=>{
    const {env,db,settings}=use();settings.cronEnabled=false;
    db.prepare('INSERT INTO app_settings VALUES (?,?,?)').run('pipeline_settings',JSON.stringify(settings),'now');
    expect((await runPipeline(env,{trigger:'cron'})).status).toBe('disabled');
    const res=await onRequestPost({env,request:new Request('https://x/api/analyze',{method:'POST'})});expect(res.status).toBe(415);
  });
});
