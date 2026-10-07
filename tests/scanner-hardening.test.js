import { describe,it,expect,afterEach } from 'vitest';
import { calculateSnapshot, derivativesFrame } from '../src/pipeline/calculate.js';
import { readChart } from '../src/pipeline/chart.js';
import { setup } from './helpers/pipeline-db.js';

let resources=[];
const use=(mode)=>{const r=setup(mode);resources.push(r);return r;};
afterEach(()=>{resources.forEach(r=>r.close());resources=[];});

describe('scanner hardening regressions',()=>{
  it('refuses OI direction when derivative timestamps do not align to candle timestamps',()=>{
    const {market,settings}=use();
    const frame=market.series.M5;
    const rows=market.derivatives.frames.M5.open_interest.map(r=>({...r,ts:r.ts+200000}));
    const d=derivativesFrame(frame,{open_interest:rows,funding:[],long_short_ratio:[],liquidation:[]},settings.calculation.derivatives);
    expect(d.votes.openInterest).toBe('NEUTRAL');
    expect(d.measurements.priceChangePct).toBeNull();
  });

  it('requires the configured OI lookback instead of silently shortening it',()=>{
    const {market,settings}=use();
    const rows=market.derivatives.frames.M5.open_interest.slice(-2);
    const d=derivativesFrame(market.series.M5,{open_interest:rows,funding:[],long_short_ratio:[],liquidation:[]},settings.calculation.derivatives);
    expect(settings.calculation.derivatives.oiLookback).toBe(3);
    expect(d.votes.openInterest).toBe('NEUTRAL');
    expect(d.measurements.openInterestChangePct).toBeNull();
  });

  it('drops stale OI and long-short rows before scanner calculation',async()=>{
    const {env,chart,settings}=use();
    chart.exec("UPDATE derivative_metrics SET ts=ts-604800000 WHERE metric IN ('open_interest','long_short_ratio')");
    const market=await readChart(env,settings);
    expect(market.derivatives.frames.M5.open_interest).toHaveLength(0);
    expect(market.derivatives.frames.M5.long_short_ratio).toHaveLength(0);
    const snapshot=calculateSnapshot(market,settings);
    expect(snapshot.groups.derivatives.frames.M5.votes.openInterest).toBe('NEUTRAL');
    expect(snapshot.groups.derivatives.frames.M5.votes.longShort).toBe('NEUTRAL');
  });

  it('does not compute OI change across a provider source transition',async()=>{
    const {env,chart,settings}=use();
    chart.exec("UPDATE derivative_metrics SET source='okx_swap' WHERE metric='open_interest' AND timeframe='M5' AND ts=(SELECT MAX(ts) FROM derivative_metrics WHERE metric='open_interest' AND timeframe='M5')");
    const market=await readChart(env,settings);
    expect(market.derivatives.frames.M5.open_interest).toHaveLength(1);
    const snapshot=calculateSnapshot(market,settings);
    expect(snapshot.groups.derivatives.frames.M5.votes.openInterest).toBe('NEUTRAL');
  });

  it('aggregates upstream M5 liquidation into the requested higher timeframe',async()=>{
    const {env,chart,settings,market}=use();
    const start=market.series.H1.at(-1).timestamp;
    chart.prepare("INSERT OR REPLACE INTO derivative_metrics VALUES (?,?,?,?,?,?,?,?)").run(
      'BTCUSDT','liquidation','M5',start+300000,900000,100000,800000,'binance_futures_ws'
    );
    const read=await readChart(env,settings);
    const h1=read.derivatives.frames.H1.liquidation;
    expect(h1).toHaveLength(1);
    expect(h1[0].value).toBeGreaterThanOrEqual(900000);
    expect(h1[0].source).toBe('binance_futures_ws_aggregate');
  });
});
