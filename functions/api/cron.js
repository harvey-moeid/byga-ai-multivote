import { runPipeline } from '../../src/pipeline/run.js';
import { verifyCron } from '../../src/pipeline/discord.js';
import { json,pipelineError } from '../../src/pipeline/http.js';
export async function onRequestPost({env,request,waitUntil}) {
  if(!await verifyCron(request,env.SESSION_SECRET))return json(401,{error_code:'INVALID_CRON_SIGNATURE'});
  try{const r=await runPipeline(env,{trigger:'cron'});if(waitUntil)waitUntil(cleanup(env));return json(200,{id:r.id,status:r.status,meeting:r.meeting,duplicate:!!r.duplicate,delivery:r.delivery});}
  catch(error){return pipelineError(error);}
}
async function cleanup(env) {
  const days=Math.max(1,Math.min(365,Number(env.PIPELINE_RETENTION_DAYS)||30)),cutoff=new Date(Date.now()-days*86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM discord_outbox WHERE analysis_id IN (SELECT id FROM pipeline_runs WHERE created_at<?)').bind(cutoff),
    env.DB.prepare('DELETE FROM analyses WHERE id IN (SELECT id FROM pipeline_runs WHERE created_at<?)').bind(cutoff),
    env.DB.prepare('DELETE FROM pipeline_runs WHERE created_at<?').bind(cutoff)
  ]);
}
