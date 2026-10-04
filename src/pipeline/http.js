export const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export function pipelineError(error) {
  const code=error.code||'PIPELINE_ERROR';
  const status=code==='CHART_DATA_ERROR'?503:code==='SNAPSHOT_CHANGED'?409:code==='INVALID_SETTINGS'?400:500;
  return json(status,{error_code:code,error:status===500?'Pipeline gagal. Periksa status dan konfigurasi server.':error.message});
}
