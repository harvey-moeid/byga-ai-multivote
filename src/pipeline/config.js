import { PROVIDERS } from '../providers/registry.js';
import { MODEL_RE } from '../lib/model-settings.js';

export const FRAMES = { M5:300000, M15:900000, H1:3600000, H4:14400000, D1:86400000 };
export const GROUPS = ['smc_ict','indicators','volume'];
export const SLOT_IDS = GROUPS.flatMap(group => [group+'_1',group+'_2']);
export const DEFAULT_CALCULATION = {
  frames:{trend:'H1',structure:'M15',trigger:'M5'}, candleLimit:250,
  smc:{swing:3,range:80,eventWindow:20,atrPeriod:14,displacement:1,fvgAtr:.05,threshold:2},
  indicators:{emaFast:20,emaSlow:50,rsiPeriod:14,rsiBuy:55,rsiSell:45,macdFast:12,macdSlow:26,macdSignal:9,bbPeriod:20,bbStd:2,adxPeriod:14,adxMin:20,threshold:3},
  volume:{period:20,rvolMin:1.2,cmfMin:.05,obvLookback:10}
};
export function providerAvailable(provider, env) {
  return provider.meta.provider === 'workers-ai' ? typeof env.AI?.run === 'function' : !!env[provider.meta.keyEnv];
}
export function defaultSettings(env) {
  const ready=PROVIDERS.filter(p=>providerAvailable(p,env));
  const defaults=ready.length?ready:PROVIDERS.filter(p=>p.meta.provider==='workers-ai');
  return {version:1,symbol:'BTCUSDT.P',calculation:structuredClone(DEFAULT_CALCULATION),cronEnabled:true,discordEnabled:true,
    analysts:SLOT_IDS.map((id,i)=>{const p=defaults[i%defaults.length];return {id,name:['SMC/ICT','Indikator','Volume'][Math.floor(i/2)]+' '+(i%2+1),group:GROUPS[Math.floor(i/2)],provider:p.meta.provider,model:String(env[p.meta.modelEnv]||p.meta.modelId)};})};
}
const ranges={candleLimit:[100,1000],smc:{swing:[1,10],range:[20,200],eventWindow:[1,50],atrPeriod:[5,50],displacement:[.1,5],fvgAtr:[0,2],threshold:[1,5]},indicators:{emaFast:[2,100],emaSlow:[3,200],rsiPeriod:[2,50],rsiBuy:[50,90],rsiSell:[10,50],macdFast:[2,50],macdSlow:[3,100],macdSignal:[2,50],bbPeriod:[5,100],bbStd:[.5,4],adxPeriod:[5,50],adxMin:[0,60],threshold:[1,5]},volume:{period:[5,100],rvolMin:[.1,5],cmfMin:[.001,.5],obvLookback:[2,100]}};
const decimals=new Set(['displacement','fvgAtr','rsiBuy','rsiSell','bbStd','adxMin','rvolMin','cmfMin']);
function bad(message){throw Object.assign(new Error(message),{code:'INVALID_SETTINGS'});}
export function validateSettings(input,env) {
  const out=defaultSettings(env);
  if(!input || input.symbol!=='BTCUSDT.P')bad('Simbol harus BTCUSDT.P.');
  const c=input.calculation;
  if(!c || !c.frames)bad('Pengaturan perhitungan wajib diisi.');
  const frames=['trend','structure','trigger'].map(role=>c.frames[role]);
  if(frames.some(f=>!FRAMES[f]) || !(FRAMES[frames[0]]>FRAMES[frames[1]] && FRAMES[frames[1]]>FRAMES[frames[2]]))bad('Timeframe tren harus lebih besar dari struktur, dan struktur lebih besar dari pemicu.');
  out.calculation.frames=Object.fromEntries(['trend','structure','trigger'].map((r,i)=>[r,frames[i]]));
  for(const [section,bounds] of Object.entries(ranges)) {
    if(section==='candleLimit') {if(!Number.isInteger(c.candleLimit)||c.candleLimit<100||c.candleLimit>1000)bad('Jumlah candle harus 100–1000.');out.calculation.candleLimit=c.candleLimit;continue;}
    for(const [key,[min,max]] of Object.entries(bounds)) {
      const n=c[section]?.[key];
      if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max||(!decimals.has(key)&&!Number.isInteger(n)))bad(`Nilai ${section}.${key} harus ${min}–${max}.`);
      out.calculation[section][key]=n;
    }
  }
  const i=c.indicators;
  if(i.emaFast>=i.emaSlow || i.macdFast>=i.macdSlow || i.rsiSell>=i.rsiBuy)bad('Periode cepat harus lebih kecil dari periode lambat; batas RSI SELL harus di bawah BUY.');
  const minimum=Math.max(i.emaSlow+10,i.macdSlow+i.macdSignal+10,i.adxPeriod*3+5,c.smc.range+2*c.smc.swing,c.volume.period+c.volume.obvLookback+1);
  if(c.candleLimit<minimum)bad(`Jumlah candle minimal ${minimum} untuk parameter ini.`);
  if(!Array.isArray(input.analysts)||input.analysts.length!==6)bad('Harus ada tepat enam analis.');
  out.analysts=SLOT_IDS.map((id,index)=>{
    const a=input.analysts.find(x=>x.id===id);
    const p=PROVIDERS.find(p=>p.meta.provider===a?.provider);
    if(!p || typeof a.model!=='string'||!MODEL_RE.test(a.model.trim()))bad(`Provider/model ${id} tidak valid.`);
    if(typeof a.name!=='string'||!a.name.trim()||a.name.length>40)bad(`Nama ${id} harus 1–40 karakter.`);
    return {id,name:a.name.trim(),group:GROUPS[Math.floor(index/2)],provider:p.meta.provider,model:a.model.trim()};
  });
  for(const k of ['cronEnabled','discordEnabled']) {if(typeof input[k]!=='boolean')bad(`${k} harus boolean.`);out[k]=input[k];}
  return out;
}
export async function loadSettings(env) {
  const row=await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind('pipeline_settings').first();
  if(!row)return defaultSettings(env);
  // Invalid saved configuration fails closed rather than silently changing signals.
  return validateSettings(JSON.parse(row.value),env);
}
export async function saveSettings(env,input) {
  const settings=validateSettings(input,env);
  await env.DB.prepare('INSERT INTO app_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind('pipeline_settings',JSON.stringify(settings),new Date().toISOString()).run();
  return settings;
}
