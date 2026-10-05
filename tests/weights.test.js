import { describe,it,expect } from 'vitest';
import { scoreReliability,closedOutcomeOpen } from '../src/pipeline/weights.js';
import { meetingDecision } from '../src/pipeline/calculate.js';

describe('adaptive analyst weighting',()=>{
  it('scores only the last candle already closed at the outcome horizon',()=>{
    const interval=300000,target=10*interval+60000;
    expect(closedOutcomeOpen(target,interval)).toBe(9*interval);
    expect(closedOutcomeOpen(10*interval,interval)).toBe(9*interval);
  });
  it('falls back to neutral weight until enough outcomes exist',()=>{
    const r=scoreReliability(Array.from({length:8},()=>({hit:true})));
    expect(r.weight).toBe(1);expect(r.ready).toBe(false);expect(r.samples).toBe(8);
  });

  it('shrinks observed accuracy and caps reliability weights',()=>{
    const strong=scoreReliability(Array.from({length:30},(_,i)=>({hit:i<24})));
    const weak=scoreReliability(Array.from({length:30},(_,i)=>({hit:i<6})));
    expect(strong.weight).toBeGreaterThan(1);expect(strong.weight).toBeLessThanOrEqual(1.2);
    expect(weak.weight).toBeLessThan(1);expect(weak.weight).toBeGreaterThanOrEqual(.8);
  });

  it('uses reliability and confidence without allowing one vote to dominate',()=>{
    const results=[
      {analyst_id:'a',status:'success',signal:'BUY',confidence:80},
      {analyst_id:'b',status:'success',signal:'BUY',confidence:70},
      {analyst_id:'c',status:'success',signal:'BUY',confidence:75},
      {analyst_id:'d',status:'success',signal:'SELL',confidence:60},
      {analyst_id:'e',status:'success',signal:'SELL',confidence:60},
      {analyst_id:'f',status:'success',signal:'SELL',confidence:60}
    ];
    const weights={a:{weight:1.2},b:{weight:1.2},c:{weight:1.2},d:{weight:.8},e:{weight:.8},f:{weight:.8}};
    const r=meetingDecision(results,'BUY',{weights,mode:'auto'});
    expect(r.approved).toBe(true);expect(r.majority_signal).toBe('BUY');expect(r.weighted_share_pct).toBeGreaterThanOrEqual(60);
  });
});
