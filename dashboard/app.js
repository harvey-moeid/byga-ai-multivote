const $=id=>document.getElementById(id);
const fmt=n=>Number.isFinite(Number(n))?Number(n).toLocaleString("en-US",{maximumFractionDigits:2}):"—";
const date=v=>v?new Date(v).toLocaleString("id-ID",{dateStyle:"medium",timeStyle:"short"}):"—";
function signalClass(s){return String(s||"").toLowerCase().replace(/[^a-z_]/g,"")}
function setSignal(el,s){el.textContent=s||"—";el.className="metric-value"+(s?" signal-"+signalClass(s):"")}
function errorLabel(r){
  const code=String(r?.error_code||"PROVIDER_ERROR");
  const status=Number(r?.http_status||0);
  return status ? status+" · "+code : code;
}
function renderAnalysis(d){
 const v=d.voting||{};setSignal($("consensus"),d.majority_signal);$("consensus-note").textContent=d.majority_signal==="NO_TRADE"?"Tidak ada mayoritas BUY/SELL":"Hasil mayoritas model";
 $("responses").textContent=v.success??d.success_count??"—";$("responses-total").textContent="/ "+(v.total_models??d.total_models??"—");
 $("vote-total").textContent=v.total_models??"—";$("buy-count").textContent=v.buy??d.buy_votes??0;$("sell-count").textContent=v.sell??d.sell_votes??0;$("neutral-count").textContent=v.no_trade??d.no_trade_votes??0;
 const total=Number(v.total_models||d.total_models||0);for(const [id,n] of [["buy-bar",v.buy],["sell-bar",v.sell],["neutral-bar",v.no_trade]])$(id).style.width=(total?Math.max(0,Number(n||0)/total*100):0)+"%";
 const dur=Number(d.duration_ms);$("duration").textContent=Number.isFinite(dur)?(dur>=1000?(dur/1000).toFixed(1):String(dur)):"—";$("duration-unit").textContent=Number.isFinite(dur)?(dur>=1000?" sec":" ms"):"";
 $("price").textContent=d.last_price!=null?fmt(d.last_price):"—";const pct=Number(d.price_change_pct_24h);const ch=$("price-change");if(d.price_change_pct_24h!=null&&Number.isFinite(pct)){ch.textContent=(pct>0?"+":"")+pct.toFixed(2)+"% / 24H";ch.className="change "+(pct>0?"positive":pct<0?"negative":"")}else{ch.textContent="Last analyzed snapshot";ch.className="change"}
 $("last-updated").textContent="UPDATED "+date(d.created_at).toUpperCase();$("result-status").textContent="RESULT READY";$("result-status").className="result-status ready";$("result-empty").classList.add("hidden");
 const rows=Array.isArray(d.results)?d.results:[];$("model-results").innerHTML=rows.map(r=>{
   const name=r.provider_label||r.provider||"Model";
   const failed=r.status!=="success";
   const sig=failed?(r.status==="timeout"?"TIMEOUT":"ERROR"):(r.signal||"NO_TRADE");
   const code=failed?errorLabel(r):"";
   const detail=failed?((r.error||"").slice(0,180)):(r.status||"success");
   return '<div class="model-row '+(failed?"model-row-error":"")+'"><span class="model-avatar">'+escapeHtml(name.slice(0,2).toUpperCase())+'</span><span class="model-info"><b>'+escapeHtml(name)+'</b><small>'+escapeHtml(failed?code:(r.status||"success"))+(r.duration_ms!=null?" · "+fmt(r.duration_ms)+" ms":"")+'</small>'+(failed?'<em class="model-error-message">'+escapeHtml(detail)+'</em>':"")+'</span><span class="signal-pill '+signalClass(sig)+(failed?" provider-error":"")+'">'+escapeHtml(failed?code:sig.replace("_"," "))+'</span></div>';
 }).join("");
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
async function loadHistory(){const body=$("history-body");try{const res=await fetch("/api/history?limit=20");if(!res.ok)throw Error("HTTP "+res.status);const data=await res.json();const items=data.items||[];if(!items.length){body.innerHTML='<tr><td colspan="6" class="table-empty">Belum ada riwayat analisis.</td></tr>';return}body.innerHTML=items.map(r=>'<tr><td class="id-cell">'+escapeHtml(r.id)+'</td><td>'+escapeHtml(date(r.created_at))+'</td><td>BTCUSDT</td><td><span class="signal-pill '+signalClass(r.majority_signal)+'">'+escapeHtml(r.majority_signal||"—")+'</span></td><td>'+escapeHtml((r.success_count??0)+"/"+(r.total_models??0))+'</td><td><button class="open-detail" data-id="'+escapeHtml(r.id)+'">Detail ↗</button></td></tr>').join("");body.querySelectorAll("[data-id]").forEach(b=>b.addEventListener("click",()=>showDetail(b.dataset.id)))}catch(e){body.innerHTML='<tr><td colspan="6" class="table-empty">Riwayat tidak dapat dimuat.</td></tr>'}}
async function showDetail(id){const wrap=document.createElement("div");wrap.className="detail-modal";wrap.innerHTML='<section class="detail-card"><div class="detail-head"><h2>Analysis detail</h2><button class="detail-close">Close ×</button></div><div class="detail-pre">Loading…</div></section>';document.body.append(wrap);const close=()=>wrap.remove();wrap.querySelector(".detail-close").addEventListener("click",close);wrap.addEventListener("click",e=>{if(e.target===wrap)close()});try{const res=await fetch("/api/analysis/"+encodeURIComponent(id));const d=await res.json();wrap.querySelector(".detail-pre").textContent=JSON.stringify(d,null,2)}catch(e){wrap.querySelector(".detail-pre").textContent="Detail tidak dapat dimuat."}}
$("logout-btn").addEventListener("click",async()=>{try{await fetch("/api/logout",{method:"POST"})}finally{window.location.href="/login"}});
$("analyze-btn").addEventListener("click",async()=>{const btn=$("analyze-btn"),label=$("analyze-label"),msg=$("run-message");btn.disabled=true;label.textContent="Menganalisis…";msg.className="run-message";msg.textContent="Mengambil data market dan meminta respons model AI.";try{const res=await fetch("/api/analyze",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});const d=await res.json();if(!res.ok){const e=new Error(d.error||d.error_code||"Analisis gagal");e.data=d;throw e}renderAnalysis(d);msg.className="run-message success";msg.textContent="Analisis selesai dan hasil diterima.";await loadHistory()}catch(e){msg.className="run-message error";msg.textContent=e.data?.error||e.data?.error_code||e.message||"Analisis gagal."}finally{btn.disabled=false;label.textContent="Mulai Analisis"}});
$("refresh-history").addEventListener("click",loadHistory);
$("clock").textContent=new Date().toLocaleString("id-ID",{dateStyle:"medium",timeStyle:"short"});
loadHistory();