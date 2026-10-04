import { cronSignature } from './discord.js';
export async function dispatchCron(env,time=Date.now()) {
  if(!env.SESSION_SECRET)throw new Error('Scheduler SESSION_SECRET belum tersedia.');
  const body=JSON.stringify({scheduled_time:time}),timestamp=String(Date.now());
  const res=await fetch(new URL('/api/cron',env.APP_URL),{method:'POST',headers:{'content-type':'application/json','x-byga-time':timestamp,'x-byga-signature':await cronSignature(env.SESSION_SECRET,timestamp,body)},body,redirect:'error',signal:AbortSignal.timeout(180000)});
  const data=await res.json();
  if(!res.ok)throw new Error('CRON_DISPATCH_'+res.status+'_'+(data.error_code||'ERROR'));
  console.log('pipeline.cron',{id:data.id,status:data.status,meeting:data.meeting,duplicate:data.duplicate});
  return data;
}
export default {
  async scheduled(event,env,ctx){ctx.waitUntil(dispatchCron(env,event.scheduledTime));},
  fetch(){return new Response('BYGA pipeline scheduler · */5 * * * *',{headers:{'content-type':'text/plain'}});}
};
