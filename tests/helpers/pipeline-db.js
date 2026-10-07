import { createRequire } from 'node:module';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
import { readFileSync,readdirSync } from 'node:fs';
import { FRAMES,defaultSettings } from '../../src/pipeline/config.js';
export function adapter(db,readOnly=false) {
  const prepare=(sql)=>{
    if(readOnly&&!/^SELECT\s/i.test(sql.trim()))throw Error('chart_db must remain read only');
    const withArgs=(args)=>({sql,args,bind:(...values)=>withArgs(values),
      first:async()=>db.prepare(sql).get(...args)??null,
      all:async()=>({success:true,results:db.prepare(sql).all(...args)}),
      run:async()=>({success:true,meta:{changes:Number(db.prepare(sql).run(...args).changes)}})});
    return withArgs([]);
  };
  return {prepare,batch:async statements=>{db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}};
}
export function candles(tf,count=250,mode='up',now=Date.now()) {
  const interval=FRAMES[tf],end=Math.floor(now/interval)*interval-interval;
  return Array.from({length:count},(_,i)=>{
    const base=mode==='flat'?100:100+i*.25+Math.sin(i*.75)*1;
    let open=base,close=mode==='flat'?base:base+.15;
    if(i===count-1&&mode!=='flat')close+=3;
    if(mode==='down'){open=250-open;close=250-close;}
    return {timestamp:end-(count-1-i)*interval,open,close,high:Math.max(open,close)+.5,low:Math.min(open,close)-.5,volume:i===count-1?500:100,source:'bybit'};
  });
}

function deterministicTestReply(_model,{messages}={}) {
  const user=messages?.filter(m=>m.role==='user').at(-1)?.content||'{}';
  let payload={};
  try { payload=JSON.parse(user); } catch {}
  const group=payload.group_snapshot||{},parameters=group.parameters||{},allowed=new Set(payload.semantic_contract?.allowed_metrics||[]);
  const candidates={BUY:[],SELL:[]};
  const add=(signal,timeframe,metric)=>{
    if((signal==='BUY'||signal==='SELL')&&allowed.has(metric)&&!candidates[signal].some(x=>x.timeframe===timeframe&&x.metric===metric))candidates[signal].push({timeframe,metric,supports:signal});
  };
  for(const [timeframe,frame] of Object.entries(group.frames||{})) {
    for(const [metric,signal] of Object.entries(frame.votes||{}))add(signal,timeframe,metric);
    if(group.group==='smc_ict')add(frame.measurements?.bias,timeframe,'bias');
    if(group.group==='volume') {
      const m=frame.measurements||{};
      const cmf=Number(m.cmf),obv=Number(m.obvChange);
      add(cmf>=Number(parameters.cmfMin)?'BUY':cmf<=-Number(parameters.cmfMin)?'SELL':'NEUTRAL',timeframe,'cmf');
      add(obv>0?'BUY':obv<0?'SELL':'NEUTRAL',timeframe,'obv');
      add(m.flow,timeframe,'flow');add(m.candleDirection,timeframe,'candleDirection');
    }
  }
  const signal=candidates.BUY.length>=2?'BUY':candidates.SELL.length>=2?'SELL':'BUY';
  const evidence=candidates[signal].slice(0,3);
  return {response:JSON.stringify({signal,confidence:evidence.length>=2?76:10,directional_evidence:evidence,reason:evidence.length>=2?'Verified deterministic fixture evidence.':'Insufficient deterministic fixture evidence.'})};
}

export function setup(mode='up') {
  const db=new DatabaseSync(':memory:'),chart=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../../migrations/'+file,import.meta.url),'utf8'));
  chart.exec('CREATE TABLE candles (symbol TEXT,timeframe TEXT,open_time INTEGER,open REAL,high REAL,low REAL,close REAL,volume REAL,source TEXT,is_closed INTEGER)');
  chart.exec("CREATE TABLE derivative_metrics (symbol TEXT,metric TEXT,timeframe TEXT,ts INTEGER,value REAL,value2 REAL,value3 REAL,source TEXT,PRIMARY KEY(symbol,metric,timeframe,ts))");
  const insert=chart.prepare('INSERT INTO candles VALUES (?,?,?,?,?,?,?,?,?,1)');
  const market={symbol:'BTCUSDT.P',series:{},derivatives:{funding:[],frames:{}}};
  const derivativeInsert=chart.prepare('INSERT INTO derivative_metrics VALUES (?,?,?,?,?,?,?,?)');
  for(const tf of ['H1','M15','M5']) {
    market.series[tf]=candles(tf,250,mode);
    for(const c of market.series[tf])insert.run('BTCUSDT',tf,c.timestamp,c.open,c.high,c.low,c.close,c.volume,c.source);
    market.derivatives.frames[tf]={open_interest:[],long_short_ratio:[],liquidation:[]};
    const recent=market.series[tf].slice(-4);
    recent.forEach((c,i)=>{
      const progress=i/Math.max(1,recent.length-1),oi=mode==='up'?100000000*(1+progress*.012):mode==='down'?100000000*(1+progress*.012):100000000;
      const ratio=mode==='up'?.75:mode==='down'?1.35:1;
      const liq=mode==='up'?[600000,100000,500000]:mode==='down'?[600000,500000,100000]:[200000,100000,100000];
      const oiRow={ts:c.timestamp,value:oi,value2:oi/(c.close||1),value3:null,source:'fixture'};
      const lsRow={ts:c.timestamp,value:ratio,value2:ratio/(1+ratio),value3:1/(1+ratio),source:'fixture'};
      const liqRow={ts:c.timestamp,value:liq[0],value2:liq[1],value3:liq[2],source:'fixture'};
      for(const [metric,row] of [['open_interest',oiRow],['long_short_ratio',lsRow],['liquidation',liqRow]]) {
        derivativeInsert.run('BTCUSDT',metric,tf,row.ts,row.value,row.value2,row.value3,row.source);
        market.derivatives.frames[tf][metric].push(row);
      }
    });
  }
  const fundingRow={ts:market.series.M5.at(-1).timestamp,value:mode==='up'?-.0004:mode==='down'?.0004:0,value2:null,value3:null,source:'fixture'};
  derivativeInsert.run('BTCUSDT','funding_rate','',fundingRow.ts,fundingRow.value,null,null,fundingRow.source);
  market.derivatives.funding.push(fundingRow);
  const env={DB:adapter(db),CHART_DB:adapter(chart,true),AI:{run:deterministicTestReply},SESSION_SECRET:'unit-test-secret'};
  return {env,db,chart,market,settings:defaultSettings(env),close:()=>{db.close();chart.close();}};
}
