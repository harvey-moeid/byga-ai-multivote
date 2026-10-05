import { loadSettings,validateSettings,providerAvailable } from '../../src/pipeline/config.js';
import { PROVIDERS } from '../../src/providers/registry.js';
import { sealWebhook,webhookConfigured } from '../../src/pipeline/discord.js';
import { json,pipelineError } from '../../src/pipeline/http.js';
import { getProviderHealth } from '../../src/lib/providerHealth.js';
export async function onRequestGet({env}) {
  try{
    const providers=PROVIDERS.map(p=>({provider:p.meta.provider,label:p.meta.providerLabel,configured:providerAvailable(p,env),default_model:String(env[p.meta.modelEnv]||p.meta.modelId)}));
    return json(200,{settings:await loadSettings(env),providers,provider_health:await getProviderHealth(env.DB,providers),webhook_configured:await webhookConfigured(env),cron:'*/5 * * * *'});
  } catch(error){return pipelineError(error);}
}
export async function onRequestPut({env,request}) {
  if(!request.headers.get('content-type')?.includes('application/json'))return json(415,{error:'Gunakan application/json.'});
  let body;try{body=await request.json();}catch{return json(400,{error:'JSON tidak valid.'});}
  try{
    const settings=validateSettings(body.settings,env),iso=new Date().toISOString();
    const stmt=(key,value)=>env.DB.prepare('INSERT INTO app_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(key,value,iso);
    const statements=[stmt('pipeline_settings',JSON.stringify(settings))];
    if(typeof body.discord_webhook==='string'&&body.discord_webhook.trim()) {
      let value;try{value=await sealWebhook(body.discord_webhook.trim(),env.SESSION_SECRET);}catch{throw Object.assign(new Error('Webhook Discord tidak valid atau kunci enkripsi belum tersedia.'),{code:'INVALID_SETTINGS'});}
      statements.push(stmt('discord_webhook_encrypted',value));
    }
    if(body.clear_webhook===true)statements.push(env.DB.prepare('DELETE FROM app_settings WHERE key=?').bind('discord_webhook_encrypted'));
    await env.DB.batch(statements);
    return json(200,{ok:true,settings,webhook_configured:await webhookConfigured(env)});
  }catch(error){return pipelineError(error);}
}
