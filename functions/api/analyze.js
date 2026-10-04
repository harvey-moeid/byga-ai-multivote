import { runPipeline } from '../../src/pipeline/run.js';
import { json, pipelineError } from '../../src/pipeline/http.js';
export async function onRequestPost({env,request}) {
  if(!request.headers.get('content-type')?.includes('application/json'))return json(415,{error:'Gunakan application/json.'});
  let body;try{body=await request.json();}catch{return json(400,{error:'JSON tidak valid.'});}
  try{return json(200,await runPipeline(env,{expectedCandleTimes:body.candle_times}));}
  catch(error){return pipelineError(error);}
}
