import { loadSettings } from '../../src/pipeline/config.js';
import { readChart } from '../../src/pipeline/chart.js';
import { json, pipelineError } from '../../src/pipeline/http.js';
export async function onRequestGet({env}) {
  try{const settings=await loadSettings(env);return json(200,{settings,market:await readChart(env,settings)});}
  catch(error){return pipelineError(error);}
}
