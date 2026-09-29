import{describe,it,expect}from"vitest";import{computeMultiHorizonOutcomeSummary}from"../src/lib/signalOutcomes.js";
const H=3600000,T=Date.parse("2026-09-28T00:00:00Z");
function a(i){return{created_at:new Date(T+i*H).toISOString(),exchange:"binance",symbol:"BTCUSDT",majority_signal:"BUY",last_price:100};}
function closeMap(){const m=new Map();for(let i=0;i<10;i++)m.set("binance:BTCUSDT:"+(T+i*H),100+i);return m;}
describe("multi-horizon outcomes",()=>{it("returns separate 1h,2h,4h evaluations",()=>{const s=computeMultiHorizonOutcomeSummary([a(0)],closeMap(),{horizonHours:[1,2,4],now:T+10*H});expect(Object.keys(s.by_horizon)).toEqual(["1","2","4"]);expect(s.by_horizon["1"].horizon_hours).toBe(1);expect(s.by_horizon["4"].horizon_hours).toBe(4);});});
