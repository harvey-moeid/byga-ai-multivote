// Pure deterministic functions shared by the browser and Pages/cron runtime.
// No network, AI, clock, or database access belongs in this module.
export const ENGINE_VERSION='3.0.0';
const avg=a=>a.reduce((s,v)=>s+v,0)/a.length;
const direction=v=>v>0?'BUY':v<0?'SELL':'NEUTRAL';
export function ema(values,period) {
  const out=Array(values.length).fill(null);
  if(values.length<period)return out;
  let value=avg(values.slice(0,period));out[period-1]=value;
  for(let i=period;i<values.length;i++){value+=(values[i]-value)*2/(period+1);out[i]=value;}
  return out;
}
function wilder(values,period) {
  const out=Array(values.length).fill(null);
  if(values.length<period)return out;
  let v=avg(values.slice(0,period));out[period-1]=v;
  for(let i=period;i<values.length;i++){v=(v*(period-1)+values[i])/period;out[i]=v;}
  return out;
}
export function rsi(values,period) {
  const gains=[],losses=[];
  for(let i=1;i<values.length;i++){const d=values[i]-values[i-1];gains.push(Math.max(d,0));losses.push(Math.max(-d,0));}
  const g=wilder(gains,period).at(-1),l=wilder(losses,period).at(-1);
  if(g==null||l==null)return null;
  return !g&&!l?50:!l?100:100-100/(1+g/l);
}
function ranges(c){return c.map((x,i)=>Math.max(x.high-x.low,i?Math.abs(x.high-c[i-1].close):0,i?Math.abs(x.low-c[i-1].close):0));}
export function adx(c,period) {
  const plus=[],minus=[];
  for(let i=1;i<c.length;i++) {
    const up=c[i].high-c[i-1].high,down=c[i-1].low-c[i].low;
    plus.push(up>down&&up>0?up:0);minus.push(down>up&&down>0?down:0);
  }
  const tr=wilder(ranges(c).slice(1),period),p=wilder(plus,period),m=wilder(minus,period),dx=[];
  let diPlus=0,diMinus=0;
  for(let i=period-1;i<tr.length;i++) {
    diPlus=tr[i]?p[i]/tr[i]*100:0;diMinus=tr[i]?m[i]/tr[i]*100:0;
    dx.push(diPlus+diMinus?Math.abs(diPlus-diMinus)/(diPlus+diMinus)*100:0);
  }
  return {adx:wilder(dx,period).at(-1)??0,diPlus,diMinus};
}
function tally(votes,threshold) {
  const buy=votes.filter(v=>v==='BUY').length,sell=votes.filter(v=>v==='SELL').length;
  return {signal:buy>=threshold&&buy>sell?'BUY':sell>=threshold&&sell>buy?'SELL':'NEUTRAL',buy,sell};
}
export function indicatorFrame(c,s) {
  const closes=c.map(x=>x.close),close=closes.at(-1);
  const fast=ema(closes,s.emaFast).at(-1),slow=ema(closes,s.emaSlow).at(-1);
  const ri=rsi(closes,s.rsiPeriod),a=ema(closes,s.macdFast),b=ema(closes,s.macdSlow);
  const line=a.map((v,i)=>v!=null&&b[i]!=null?v-b[i]:null).filter(v=>v!=null);
  const macd=line.at(-1),macdSignal=ema(line,s.macdSignal).at(-1),histogram=macd-macdSignal;
  const window=closes.slice(-s.bbPeriod),middle=avg(window),std=Math.sqrt(avg(window.map(v=>(v-middle)**2)));
  const bands={middle,upper:middle+s.bbStd*std,lower:middle-s.bbStd*std};
  const strength=adx(c,s.adxPeriod);
  const votes={ema:fast>slow&&close>fast?'BUY':fast<slow&&close<fast?'SELL':'NEUTRAL',rsi:ri>=s.rsiBuy?'BUY':ri<=s.rsiSell?'SELL':'NEUTRAL',macd:direction(histogram),bollinger:close>bands.upper?'BUY':close<bands.lower?'SELL':'NEUTRAL',adx:strength.adx>=s.adxMin?direction(strength.diPlus-strength.diMinus):'NEUTRAL'};
  return {...tally(Object.values(votes),s.threshold),votes,measurements:{emaFast:fast,emaSlow:slow,rsi:ri,macd,macdSignal,histogram,bands,...strength}};
}
export function volumeFrame(c,s) {
  const source=c.at(-1).source;
  let start=c.length-1;
  while(start>0&&c[start-1].source===source)start--;
  c=c.slice(start);
  const needed=Math.max(s.period+1,s.obvLookback+1);
  if(c.length<needed)return {signal:'NEUTRAL',measurements:{source,available:c.length,required:needed},note:'Sumber volume berubah; menunggu cukup candle dari sumber yang sama. Volume kontrak OKX tidak dicampur dengan volume BTC.'};
  const last=c.at(-1),baseline=avg(c.slice(-s.period-1,-1).map(x=>x.volume));
  const rvol=baseline>0?last.volume/baseline:0;
  const window=c.slice(-s.period),total=window.reduce((v,x)=>v+x.volume,0);
  const cmf=total?window.reduce((v,x)=>v+(x.high===x.low?0:((2*x.close-x.high-x.low)/(x.high-x.low))*x.volume),0)/total:0;
  let obv=0;const series=[0];
  for(let i=1;i<c.length;i++){obv+=Math.sign(c[i].close-c[i-1].close)*c[i].volume;series.push(obv);}
  const slope=obv-series.at(-s.obvLookback-1),candleDirection=direction(last.close-last.open);
  const flow=cmf>=s.cmfMin&&slope>0?'BUY':cmf<=-s.cmfMin&&slope<0?'SELL':'NEUTRAL';
  const signal=rvol>=s.rvolMin&&flow===candleDirection?flow:'NEUTRAL';
  return {signal,measurements:{source,unit:source==='okx_swap'?'contracts':'BTC',relativeVolume:rvol,baselineVolume:baseline,volume:last.volume,cmf,obv,obvChange:slope,candleDirection,flow},note:'CMF dan OBV adalah proksi OHLCV; bukan order-flow atau buy/sell delta asli.'};
}
export function smcFrame(c,s) {
  const atrSeries=wilder(ranges(c),s.atrPeriod),atr=atrSeries.at(-1)??0;
  const pivots=[],events=[],sweeps=[],gaps=[],blocks=[];
  let high=null,low=null,bias='NEUTRAL';
  const broken=new Set();
  for(let i=0;i<c.length;i++) {
    // A pivot becomes available only after s.swing candles on its right close.
    const j=i-s.swing;
    if(j>=s.swing) {
      const neighbours=c.slice(j-s.swing,j+s.swing+1).filter((_,k)=>k!==s.swing);
      if(neighbours.every(x=>c[j].high>x.high)){high={index:j,price:c[j].high,confirmedAt:i};pivots.push({...high,type:'HIGH'});}
      if(neighbours.every(x=>c[j].low<x.low)){low={index:j,price:c[j].low,confirmedAt:i};pivots.push({...low,type:'LOW'});}
    }
    const current=c[i],a=atrSeries[i]??0;
    for(const g of gaps) {
      if(g.active&&i>g.index&&((g.direction==='BUY'&&current.low<=g.lower)||(g.direction==='SELL'&&current.high>=g.upper)))g.active=false;
    }
    for(const ob of blocks) {
      if(ob.active&&i>ob.index&&((ob.direction==='BUY'&&current.close<ob.lower)||(ob.direction==='SELL'&&current.close>ob.upper)))ob.active=false;
    }
    if(i>=2) {
      if(current.low>c[i-2].high&&(current.low-c[i-2].high)>=a*s.fvgAtr)gaps.push({direction:'BUY',lower:c[i-2].high,upper:current.low,index:i,active:true});
      if(current.high<c[i-2].low&&(c[i-2].low-current.high)>=a*s.fvgAtr)gaps.push({direction:'SELL',lower:current.high,upper:c[i-2].low,index:i,active:true});
    }
    if(high&&current.high>high.price&&current.close<high.price)sweeps.push({direction:'SELL',price:high.price,index:i});
    if(low&&current.low<low.price&&current.close>low.price)sweeps.push({direction:'BUY',price:low.price,index:i});
    const up=high&&current.close>high.price&&!broken.has('H'+high.index);
    const down=low&&current.close<low.price&&!broken.has('L'+low.index);
    if(up||down) {
      const d=up?'BUY':'SELL',pivot=up?high:low;
      broken.add((up?'H':'L')+pivot.index);
      const displaced=a>0&&Math.abs(current.close-current.open)>=a*s.displacement;
      events.push({type:bias!=='NEUTRAL'&&bias!==d?'CHOCH':'BOS',direction:d,index:i,level:pivot.price,displacement:displaced});bias=d;
      if(displaced) {
        for(let k=i-1;k>=Math.max(0,i-10);k--)if((d==='BUY'&&c[k].close<c[k].open)||(d==='SELL'&&c[k].close>c[k].open)){
          blocks.push({direction:d,lower:c[k].low,upper:c[k].high,origin:k,index:i,active:true});break;
        }
      }
    }
  }
  const cutoff=c.length-s.eventWindow,last=c.at(-1),window=c.slice(-s.range),hi=Math.max(...window.map(x=>x.high)),lo=Math.min(...window.map(x=>x.low)),equilibrium=(hi+lo)/2;
  const recentEvents=events.filter(e=>e.index>=cutoff),recentSweeps=sweeps.filter(e=>e.index>=cutoff);
  const activeFvg=gaps.filter(g=>g.active&&g.index>=cutoff),activeOb=blocks.filter(g=>g.active&&g.index>=cutoff);
  const sweep=recentSweeps.at(-1),event=recentEvents.at(-1);
  const fvg=activeFvg.at(-1),ob=activeOb.filter(b=>last.low<=b.upper&&last.high>=b.lower).at(-1);
  const votes={structure:event?.direction||bias,sweep:sweep?.direction||'NEUTRAL',fvg:fvg?.direction||'NEUTRAL',orderBlock:ob?.direction||'NEUTRAL',displacement:event?.displacement?event.direction:'NEUTRAL'};
  return {...tally(Object.values(votes),s.threshold),votes,measurements:{atr,bias,pivots:pivots.slice(-10),structure:recentEvents,sweeps:recentSweeps,fvg:activeFvg.slice(-10),orderBlocks:activeOb.slice(-10),dealingRange:{high:hi,low:lo,equilibrium,zone:last.close>equilibrium?'premium':last.close<equilibrium?'discount':'equilibrium'}},note:'SMC/ICT memakai aturan pivot terkonfirmasi, BOS/CHOCH, sweep, FVG, displacement, dan order block. Definisi ini dapat diatur; bukan interpretasi diskresioner.'};
}
export function combineFrames(frames,roles) {
  const trend=frames[roles.trend].signal,structure=frames[roles.structure].signal,trigger=frames[roles.trigger].signal;
  return trend!=='NEUTRAL'&&trigger===trend&&(structure===trend||structure==='NEUTRAL')?trend:'NEUTRAL';
}
export function groupConsensus(groups) {
  const buy=Object.values(groups).filter(g=>g.signal==='BUY').length,sell=Object.values(groups).filter(g=>g.signal==='SELL').length;
  return {meeting:buy>=2||sell>=2,direction:buy>=2?'BUY':sell>=2?'SELL':'NEUTRAL',buy,sell,required:2};
}
export function classifyMarketRegime(market,settings) {
  const frame=settings.calculation.frames.trend,c=market.series[frame]||[],s=settings.calculation.indicators;
  if(c.length<Math.max(60,s.emaSlow+s.macdSignal))return {label:'UNKNOWN',timeframe:frame};
  const metrics=indicatorFrame(c,s).measurements,trs=ranges(c),atrWindow=Math.min(14,trs.length),baseWindow=Math.min(80,trs.length);
  const atrNow=avg(trs.slice(-atrWindow)),atrBase=avg(trs.slice(-baseWindow));
  const volatilityRatio=atrBase?atrNow/atrBase:1,lookback=Math.min(20,c.length-1),reference=c.at(-lookback-1)?.close||c[0].close;
  const returnPct=(c.at(-1).close-reference)/reference*100;
  const trendSignal=metrics.emaFast>metrics.emaSlow&&metrics.diPlus>metrics.diMinus?'BUY':metrics.emaFast<metrics.emaSlow&&metrics.diMinus>metrics.diPlus?'SELL':'NEUTRAL';
  let label='RANGE';
  if(volatilityRatio>=1.35&&trendSignal!=='NEUTRAL')label=trendSignal==='BUY'?'EXPANSION_UP':'EXPANSION_DOWN';
  else if(metrics.adx>=s.adxMin&&trendSignal==='BUY'&&returnPct>0)label='TREND_UP';
  else if(metrics.adx>=s.adxMin&&trendSignal==='SELL'&&returnPct<0)label='TREND_DOWN';
  else if(volatilityRatio<=0.75&&metrics.adx<s.adxMin)label='COMPRESSION';
  return {label,timeframe:frame,trend_signal:trendSignal,adx:Number(metrics.adx.toFixed(2)),return_pct:Number(returnPct.toFixed(3)),atr_pct:Number((atrNow/(c.at(-1).close||1)*100).toFixed(3)),volatility_ratio:Number(volatilityRatio.toFixed(3))};
}
export function calculateSnapshot(market,settings) {
  const c=settings.calculation,roles=c.frames,groups={};
  for(const [group,fn,parameters] of [['smc_ict',smcFrame,c.smc],['indicators',indicatorFrame,c.indicators],['volume',volumeFrame,c.volume]]) {
    const frames=Object.fromEntries(Object.values(roles).map(tf=>[tf,fn(market.series[tf],parameters)]));
    groups[group]={group,signal:combineFrames(frames,roles),roles,parameters,frames};
  }
  const candles=market.series[roles.trigger];
  return {engine_version:ENGINE_VERSION,symbol:'BTCUSDT.P',data_source:'chart_db',last_price:candles.at(-1).close,candle_times:Object.fromEntries(Object.entries(market.series).map(([tf,cs])=>[tf,cs.at(-1).timestamp])),regime:classifyMarketRegime(market,settings),groups,gate:groupConsensus(groups)};
}
const voteClamp=(n,min,max)=>Math.max(min,Math.min(max,n));
export function meetingDecision(results,deterministicDirection,{weights={},mode='auto',minSuccess=4,minDirectionalVotes=3,minWeightedShare=.60}={}) {
  const valid=results.filter(r=>r.status==='success'&&['BUY','SELL'].includes(r.signal));
  const buy=valid.filter(r=>r.signal==='BUY').length,sell=valid.filter(r=>r.signal==='SELL').length;
  const scores={BUY:0,SELL:0};
  const weighted_results=valid.map(r=>{
    const reliability=voteClamp(Number(weights?.[r.analyst_id]?.weight??weights?.[r.vote_group]?.weight??1)||1,.8,1.2);
    const confidence=r.confidence!=null&&Number.isFinite(Number(r.confidence))?voteClamp(Number(r.confidence),0,100):null;
    const confidenceFactor=confidence==null?1:.9+(confidence/100)*.2;
    const score=reliability*confidenceFactor;scores[r.signal]+=score;
    return {analyst_id:r.analyst_id||r.vote_group,signal:r.signal,confidence,reliability_weight:reliability,score:Number(score.toFixed(3))};
  });
  const total=scores.BUY+scores.SELL,winner=scores.BUY===scores.SELL?null:(scores.BUY>scores.SELL?'BUY':'SELL');
  const winnerScore=winner?scores[winner]:0,weightedShare=total?winnerScore/total:0,winnerVotes=winner==='BUY'?buy:winner==='SELL'?sell:0;
  const decisive=valid.length>=minSuccess&&winnerVotes>=minDirectionalVotes&&weightedShare>=minWeightedShare;
  const hasDeterministic=['BUY','SELL'].includes(deterministicDirection);
  const support=hasDeterministic?valid.filter(r=>r.signal===deterministicDirection).length:winnerVotes;
  let approved=false,majority_signal=null,decision_reason='INSUFFICIENT_WEIGHTED_SUPPORT';
  if(hasDeterministic) {
    if(decisive&&winner===deterministicDirection){approved=true;majority_signal=winner;decision_reason='WEIGHTED_AI_CONFIRMS_DETERMINISTIC';}
    else if(decisive&&winner&&winner!==deterministicDirection)decision_reason='AI_OPPOSES_DETERMINISTIC';
  } else if(mode==='manual') {
    majority_signal=decisive?winner:null;
    decision_reason=decisive?'MANUAL_WEIGHTED_MAJORITY':'MANUAL_AI_INCONCLUSIVE';
  }
  return {buy,sell,no_trade:0,success:valid.length,error:results.length-valid.length,total_models:results.length,support,required:minDirectionalVotes,approved,majority_signal,decision_reason,weighted_buy:Number(scores.BUY.toFixed(3)),weighted_sell:Number(scores.SELL.toFixed(3)),weighted_share_pct:Number((weightedShare*100).toFixed(2)),minimum_weighted_share_pct:Number((minWeightedShare*100).toFixed(2)),minimum_success:minSuccess,weighted_results};
}
