/** GET /api/model-performance?days=365 */
import{getModelPerformance}from"../../src/lib/modelPerformance.js";
export async function onRequestGet(context){const{env,request}=context;const url=new URL(request.url);const days=Math.min(Math.max(parseInt(url.searchParams.get("days")||"365",10),1),365);try{return json(200,await getModelPerformance(env.DB,{days}));}catch(err){console.error(err);return json(500,{error_code:"UNKNOWN_ERROR",error:err.message});}}
function json(status,body){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});}
