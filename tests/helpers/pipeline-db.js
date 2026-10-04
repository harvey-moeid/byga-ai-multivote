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
export function setup(mode='up') {
  const db=new DatabaseSync(':memory:'),chart=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../../migrations/'+file,import.meta.url),'utf8'));
  chart.exec('CREATE TABLE candles (symbol TEXT,timeframe TEXT,open_time INTEGER,open REAL,high REAL,low REAL,close REAL,volume REAL,source TEXT,is_closed INTEGER)');
  const insert=chart.prepare('INSERT INTO candles VALUES (?,?,?,?,?,?,?,?,?,1)');
  const market={symbol:'BTCUSDT.P',series:{}};
  for(const tf of ['H1','M15','M5']) {market.series[tf]=candles(tf,250,mode);for(const c of market.series[tf])insert.run('BTCUSDT',tf,c.timestamp,c.open,c.high,c.low,c.close,c.volume,c.source);}
  const env={DB:adapter(db),CHART_DB:adapter(chart,true),AI:{run:async()=>({response:'{"signal":"BUY","reason":"snapshot"}'})},SESSION_SECRET:'unit-test-secret'};
  return {env,db,chart,market,settings:defaultSettings(env),close:()=>{db.close();chart.close();}};
}
