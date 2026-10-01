const SIGNALS = ["BUY", "SELL"];
function voteWeight(result) { const confidence=Number(result?.confidence); if(!Number.isFinite(confidence)) return 1; const c=Math.max(0,Math.min(1,confidence>1?confidence/100:confidence)); return 0.5+c*0.5; }
export function computeVoting(results=[],{weights={}}={}){
 const total=results.length, good=results.filter(r=>r?.status==="success"&&SIGNALS.includes(r.signal));
 const scores={BUY:0,SELL:0,NO_TRADE:0};
 for(const r of good){const configured=Number(weights?.[r.provider]);const w=Number.isFinite(configured)&&configured>0?configured:voteWeight(r);scores[r.signal]+=w;}
 const max=Math.max(scores.BUY,scores.SELL,0), leaders=SIGNALS.filter(s=>scores[s]===max);
 const majority_signal=leaders.length===1&&max>0?leaders[0]:"BUY";
 const buy=good.filter(r=>r.signal==="BUY").length,sell=good.filter(r=>r.signal==="SELL").length,no_trade=0,weightedTotal=scores.BUY+scores.SELL;
 return {buy,sell,no_trade,total_models:total,success:good.length,error:total-good.length,majority_signal,buy_vote_share:total?buy/total*100:0,sell_vote_share:total?sell/total*100:0,no_trade_vote_share:total?no_trade/total*100:0,weighted_buy:Number(scores.BUY.toFixed(3)),weighted_sell:Number(scores.SELL.toFixed(3)),weighted_no_trade:0,weighted_vote_share:{BUY:weightedTotal?Number((scores.BUY/weightedTotal*100).toFixed(2)):0,SELL:weightedTotal?Number((scores.SELL/weightedTotal*100).toFixed(2)):0}};
}