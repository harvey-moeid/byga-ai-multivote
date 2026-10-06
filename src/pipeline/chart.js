import { FRAMES } from './config.js';
export class ChartDataError extends Error {
  constructor(message){super(message);this.code='CHART_DATA_ERROR';}
}
// This is the only market-data adapter used by the new pipeline. SELECT only.
// BTCUSDT.P is the displayed perpetual symbol; chart_db stores it as BTCUSDT.
function normalizeDerivativeRows(rows=[]) {
  return rows.map(row=>({ts:Number(row.ts),value:Number(row.value),value2:row.value2==null?null:Number(row.value2),value3:row.value3==null?null:Number(row.value3),source:row.source}))
    .filter(row=>Number.isFinite(row.ts)&&Number.isFinite(row.value));
}
async function derivativeRows(db,metric,timeframe,limit,now) {
  try {
    const r=await db.prepare('SELECT ts,value,value2,value3,source FROM derivative_metrics WHERE symbol = ? AND metric = ? AND timeframe = ? AND ts <= ? ORDER BY ts DESC LIMIT ?').bind('BTCUSDT',metric,timeframe,now,limit).all();
    return normalizeDerivativeRows((r.results||[]).reverse());
  } catch(error) {
    if(/no such table[^\n]*derivative_metrics/i.test(String(error?.message||error)))return [];
    throw error;
  }
}
async function readDerivatives(env,settings,now) {
  const d=settings.calculation.derivatives,limit=Math.max(8,d.oiLookback+2);
  const fundingPromise=derivativeRows(env.CHART_DB,'funding_rate','',8,now),frames={};
  await Promise.all([...new Set(Object.values(settings.calculation.frames))].map(async frame=>{
    const [open_interest,long_short_ratio,liquidation]=await Promise.all([
      derivativeRows(env.CHART_DB,'open_interest',frame,limit,now),
      derivativeRows(env.CHART_DB,'long_short_ratio',frame,limit,now),
      derivativeRows(env.CHART_DB,'liquidation',frame,limit,now)
    ]);
    frames[frame]={open_interest,long_short_ratio,liquidation};
  }));
  return {funding:await fundingPromise,frames};
}
export async function readChart(env,settings,now=Date.now()) {
  if(!env.CHART_DB?.prepare)throw new ChartDataError('Binding CHART_DB belum tersedia.');
  const series={}, sources={};
  for(const frame of Object.values(settings.calculation.frames)) {
    const interval=FRAMES[frame];
    const r=await env.CHART_DB.prepare(`SELECT open_time,open,high,low,close,volume,source FROM candles WHERE symbol = ? AND timeframe = ? AND is_closed = 1 AND open_time + ? <= ? ORDER BY open_time DESC LIMIT ?`).bind('BTCUSDT',frame,interval,now,settings.calculation.candleLimit).all();
    if(r.success===false)throw new ChartDataError('Pembacaan chart_db gagal.');
    const candles=(r.results||[]).reverse().map(row=>({timestamp:Number(row.open_time),open:Number(row.open),high:Number(row.high),low:Number(row.low),close:Number(row.close),volume:Number(row.volume),source:row.source}));
    if(candles.length<settings.calculation.candleLimit)throw new ChartDataError(`${frame}: candle tertutup tidak cukup (${candles.length}/${settings.calculation.candleLimit}).`);
    if(candles.some((c,i)=>!['timestamp','open','high','low','close','volume'].every(k=>Number.isFinite(c[k]))||c.volume<0||c.low<=0||c.low>Math.min(c.open,c.close)||c.high<Math.max(c.open,c.close)||c.timestamp%interval!==0||(i>0&&c.timestamp-candles[i-1].timestamp!==interval)))throw new ChartDataError(`${frame}: data candle tidak valid atau ada celah waktu.`);
    const last=candles.at(-1);
    if(now-(last.timestamp+interval)>Math.max(900000,interval))throw new ChartDataError(`${frame}: data chart_db terlalu lama. Meeting ditunda.`);
    const providers=[...new Set((r.results||[]).map(row=>row.source))];
    if(providers.some(p=>!['bybit','binance_futures','okx_swap'].includes(p)))throw new ChartDataError(`${frame}: sumber perpetual tidak dikenal.`);
    series[frame]=candles;sources[frame]=providers;
  }
  return {symbol:'BTCUSDT.P',storage_symbol:'BTCUSDT',market_type:'perpetual',data_source:'chart_db',exchange:'chart_db',fetched_at:new Date(now).toISOString(),series,sources,derivatives:await readDerivatives(env,settings,now)};
}
