import { FRAMES } from './config.js';

const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const neutral=(analysts=[])=>Object.fromEntries(analysts.map(a=>[a.id,{weight:1,samples:0,hit_rate_pct:null,scope:'neutral'}]));

function regimeFromRow(row) {
  try {
    const parsed=JSON.parse(row.market_snapshot||'{}');
    return parsed?.snapshot?.regime?.label || null;
  } catch {
    return null;
  }
}

export function scoreReliability(rows=[], { minSamples=12, priorSamples=20 }={}) {
  if(rows.length<minSamples)return {weight:1,samples:rows.length,hit_rate_pct:rows.length?Number((rows.filter(x=>x.hit).length/rows.length*100).toFixed(2)):null,ready:false};
  const hits=rows.filter(x=>x.hit).length,raw=hits/rows.length;
  const shrunk=.5+(raw-.5)*(rows.length/(rows.length+priorSamples));
  const weight=clamp(1+(shrunk-.5)*1.2,.8,1.2);
  return {weight:Number(weight.toFixed(3)),samples:rows.length,hit_rate_pct:Number((raw*100).toFixed(2)),ready:true};
}

export async function loadAnalystWeights(env,snapshot,settings,{horizonHours=2,maxAnalyses=90,minSamples=12}={}) {
  const analysts=settings?.analysts||[];
  if(!env?.DB?.prepare||!env?.CHART_DB?.prepare||!analysts.length)return neutral(analysts);
  try {
    const horizonMs=horizonHours*3600000,frame=settings.calculation.frames.trigger,interval=FRAMES[frame];
    const cutoff=new Date(Date.now()-horizonMs).toISOString();
    const aq=await env.DB.prepare(`SELECT id,created_at,last_price,timeframe,market_snapshot FROM analyses
      WHERE created_at<=? ORDER BY created_at DESC LIMIT ?`).bind(cutoff,maxAnalyses).all();
    const currentTimeframe=Object.values(settings.calculation.frames).join('/');
    const analyses=(aq.results||[]).filter(r=>r.timeframe===currentTimeframe&&Number(r.last_price)>0)
      .map(r=>({...r,target:Date.parse(r.created_at)+horizonMs,regime:regimeFromRow(r)}))
      .filter(r=>Number.isFinite(r.target));
    if(!analyses.length)return neutral(analysts);
    const byId=new Map(analyses.map(a=>[a.id,a])),oldest=analyses.at(-1)?.created_at;
    const vq=await env.DB.prepare(`SELECT r.analysis_id,r.vote_group,r.provider,r.signal
      FROM analysis_results r JOIN analyses a ON a.id=r.analysis_id
      WHERE r.status='success' AND r.signal IN ('BUY','SELL') AND a.created_at>=? AND a.created_at<=?
      ORDER BY a.created_at DESC`).bind(oldest,cutoff).all();
    const rows=(vq.results||[]).flatMap(v=>{const a=byId.get(v.analysis_id);return a?[{...v,...a}]:[]});

    const minTarget=Math.min(...rows.map(r=>r.target)),maxTarget=Math.max(...rows.map(r=>r.target));
    const prices=await env.CHART_DB.prepare(`SELECT open_time,close FROM candles
      WHERE symbol=? AND timeframe=? AND is_closed=1 AND open_time BETWEEN ? AND ?
      ORDER BY open_time ASC`).bind('BTCUSDT',frame,Math.floor(minTarget/interval)*interval,Math.floor(maxTarget/interval)*interval).all();
    const closeByOpen=new Map((prices.results||[]).map(c=>[Number(c.open_time),Number(c.close)]));
    const evaluated=rows.flatMap(r=>{
      const close=closeByOpen.get(Math.floor(r.target/interval)*interval);
      if(!Number.isFinite(close))return [];
      const hit=r.signal==='BUY'?close>Number(r.last_price):close<Number(r.last_price);
      return [{...r,hit}];
    });
    const currentRegime=snapshot?.regime?.label||null;
    return Object.fromEntries(analysts.map(a=>{
      const same=evaluated.filter(r=>r.vote_group===a.id&&r.provider===a.provider);
      const regime=currentRegime?same.filter(r=>r.regime===currentRegime):[];
      const selected=regime.length>=minSamples?regime:same;
      const scored=scoreReliability(selected,{minSamples});
      return [a.id,{...scored,scope:regime.length>=minSamples?'regime':'slot_provider',regime:currentRegime,horizon_hours:horizonHours}];
    }));
  } catch {
    return neutral(analysts);
  }
}
