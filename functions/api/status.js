import { pipelineStatus } from '../../src/pipeline/run.js';
import { json,pipelineError } from '../../src/pipeline/http.js';
export async function onRequestGet({env}) {try{return json(200,await pipelineStatus(env));}catch(error){return pipelineError(error);}}
