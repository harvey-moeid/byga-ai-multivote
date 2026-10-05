import { timingSafeEqual } from '../lib/auth.js';
const encode=new TextEncoder();
const base64=a=>btoa(String.fromCharCode(...new Uint8Array(a)));
const unbase64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export function validateWebhook(value) {
  const url=new URL(value);
  if(url.protocol!=='https:'||!['discord.com','discordapp.com'].includes(url.hostname)||url.port||url.username||url.password||!/^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname)||url.search||url.hash)throw new Error('Gunakan URL webhook Discord yang valid.');
  return url.toString();
}
async function encryptionKey(secret) {
  if(!secret)throw new Error('SESSION_SECRET belum tersedia.');
  const hash=await crypto.subtle.digest('SHA-256',encode.encode('BYGA-DISCORD-v1:'+secret));
  return crypto.subtle.importKey('raw',hash,'AES-GCM',false,['encrypt','decrypt']);
}
export async function sealWebhook(value,secret) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(secret),encode.encode(validateWebhook(value)));
  return base64(iv)+'.'+base64(encrypted);
}
export async function openWebhook(value,secret) {
  const [iv,encrypted]=value.split('.');
  const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(iv)},await encryptionKey(secret),unbase64(encrypted));
  return validateWebhook(new TextDecoder().decode(raw));
}
export async function webhookConfigured(env) {
  if(env.DISCORD_WEBHOOK_URL)return true;
  return !!(await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind('discord_webhook_encrypted').first())?.value;
}
export async function refreshDelivery(env,result) {
  if(!result?.voting?.approved)return result;
  const row=await env.DB.prepare('SELECT state FROM discord_outbox WHERE analysis_id=?').bind(result.id).first();
  if(row&&['sent','expired','failed'].includes(row.state))result.delivery={...result.delivery,state:row.state};
  return result;
}
async function webhook(env) {
  if(env.DISCORD_WEBHOOK_URL)return validateWebhook(env.DISCORD_WEBHOOK_URL);
  const row=await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind('discord_webhook_encrypted').first();
  return row?.value?openWebhook(row.value,env.SESSION_SECRET):null;
}
export function discordPayload(result) {
  const direction=result.deterministic_direction||result.initial_direction;
  return {allowed_mentions:{parse:[]},embeds:[{title:'BYGA Trading Office · '+direction,color:direction==='BUY'?3066993:15158332,description:'BTCUSDT.P · '+result.timeframe+'\nAI berbobot mengonfirmasi arah deterministik · weighted share '+result.voting.weighted_share_pct+'% · raw '+result.voting.buy+' BUY / '+result.voting.sell+' SELL.',fields:[{name:'Market regime',value:String(result.snapshot.regime?.label||'UNKNOWN')},{name:'Snapshot tanpa AI',value:Object.entries(result.snapshot.groups).map(([k,g])=>k+': '+g.signal).join('\n')},{name:'Vote analis',value:result.results.map(r=>r.analyst_name+': '+(r.status==='success'?r.signal+(r.confidence!=null?' ('+r.confidence+'%)':''):'ERROR')).join('\n')},{name:'Harga snapshot',value:String(result.last_price)},{name:'ID',value:result.id}],footer:{text:'Candle tertutup · chart_db · Weighted confirmation · tanpa eksekusi order'},timestamp:result.created_at}]};
}
export async function enqueueDiscord(env,result) {
  if(!result.voting.approved)return null;
  return env.DB.prepare('INSERT OR IGNORE INTO discord_outbox (analysis_id,payload,state,expires_at) VALUES (?,?,?,?)').bind(result.id,JSON.stringify(discordPayload(result)),'pending',Date.parse(result.created_at)+15*60000);
}
export async function flushDiscord(env,enabled=true) {
  if(!enabled)return {state:'disabled'};
  let url;
  try {url=await webhook(env);} catch {return {state:'configuration_error'};}
  if(!url)return {state:'not_configured'};
  const now=Date.now();
  await env.DB.prepare("UPDATE discord_outbox SET state='expired',lease_until=0,last_error='SIGNAL_EXPIRED' WHERE state IN ('pending','sending') AND expires_at<=?").bind(now).run();
  const rows=await env.DB.prepare("SELECT analysis_id,payload,attempts FROM discord_outbox WHERE (state='pending' OR (state='sending' AND lease_until<?)) AND next_attempt<=? ORDER BY next_attempt LIMIT 5").bind(now,now).all();
  let sent=0,failed=0;
  for(const row of rows.results||[]) {
    const claim=await env.DB.prepare("UPDATE discord_outbox SET state='sending',lease_until=?,attempts=attempts+1 WHERE analysis_id=? AND (state='pending' OR (state='sending' AND lease_until<?)) AND next_attempt<=?").bind(now+60000,row.analysis_id,now,now).run();
    if(!claim.meta?.changes)continue;
    try {
      const response=await fetch(url+'?wait=true',{method:'POST',headers:{'content-type':'application/json'},body:row.payload,redirect:'manual',signal:AbortSignal.timeout(15000)});
      if(!response.ok) {
        const retry=response.status===429?Number(response.headers.get('retry-after'))*1000:0;
        throw Object.assign(new Error('DISCORD_HTTP_'+response.status),{status:response.status,retry});
      }
      await env.DB.prepare("UPDATE discord_outbox SET state='sent',sent_at=?,lease_until=0,last_error=NULL WHERE analysis_id=?").bind(new Date().toISOString(),row.analysis_id).run();sent++;
    } catch(error) {
      // Never log request errors or response bodies: they may contain webhook tokens.
      const code=error.status?'DISCORD_HTTP_'+error.status:'DISCORD_NETWORK_ERROR';
      const permanent=error.status>=300&&error.status<500&&error.status!==429;
      const retry=Math.max(error.retry||0,Math.min(3600000,300000*2**Math.min(row.attempts,4)));
      await env.DB.prepare('UPDATE discord_outbox SET state=?,next_attempt=?,lease_until=0,last_error=? WHERE analysis_id=?').bind(permanent?'failed':'pending',Date.now()+retry,code,row.analysis_id).run();failed++;
    }
  }
  return {state:failed?'pending':sent?'sent':'idle',sent,failed};
}
export async function cronSignature(secret,time,body='') {
  const key=await crypto.subtle.importKey('raw',encode.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return base64(await crypto.subtle.sign('HMAC',key,encode.encode('BYGA-CRON-v1\n'+time+'\n'+body)));
}
export async function verifyCron(request,secret) {
  if(!secret)return false;
  const time=request.headers.get('x-byga-time'),signature=request.headers.get('x-byga-signature');
  if(!/^\d{13}$/.test(time||'')||Math.abs(Date.now()-Number(time))>120000)return false;
  return timingSafeEqual(signature,await cronSignature(secret,time,await request.clone().text()));
}
