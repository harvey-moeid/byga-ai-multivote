// Compatibility entry point. All production/manual/cron analyses now use the
// same deterministic pipeline; provider selection belongs to six character slots.
import { runPipeline } from '../pipeline/run.js';
export async function runAnalysis(env,logger=()=>{},options={}) {
  const result=await runPipeline(env,options);
  logger('analysis.completed',{id:result.id,status:result.status,meeting:result.meeting});
  return result;
}
