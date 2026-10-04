const $=id=>document.getElementById(id);
const fmt=n=>Number.isFinite(Number(n))?Number(n).toLocaleString("en-US",{maximumFractionDigits:2}):"\u2014";
const date=v=>v?new Date(v).toLocaleString("id-ID",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Jakarta"}):"\u2014";
function signalClass(s){return String(s||"").toLowerCase().replace(/[^a-z_]/g,"")}
function setSignal(el,s){el.textContent=s||"\u2014";el.className="metric-value"+(s?" signal-"+signalClass(s):"")}
function errorLabel(r){
  const code=String(r?.error_code||"PROVIDER_ERROR");
  const status=Number(r?.http_status||0);
  return status ? status+" \u00B7 "+code : code;
}
function renderAnalysis(d){
 const v=d.voting||{};setSignal($("consensus"),d.majority_signal);$("consensus-note").textContent="Hasil mayoritas model";
 $("responses").textContent=v.success??d.success_count??"\u2014";$("responses-total").textContent="/ "+(v.total_models??d.total_models??"\u2014")+" vote";
 $("vote-total").textContent=v.total_models??"\u2014";$("buy-count").textContent=v.buy??d.buy_votes??0;$("sell-count").textContent=v.sell??d.sell_votes??0;$("neutral-count").textContent=v.no_trade??d.no_trade_votes??0;
 const total=Number(v.total_models||d.total_models||0);for(const [id,n] of [["buy-bar",v.buy],["sell-bar",v.sell]])$(id).style.width=(total?Math.max(0,Number(n||0)/total*100):0)+"%";
 const dur=Number(d.duration_ms);$("duration").textContent=Number.isFinite(dur)?(dur>=1000?(dur/1000).toFixed(1):String(dur)):"\u2014";$("duration-unit").textContent=Number.isFinite(dur)?(dur>=1000?" sec":" ms"):"";
 $("price").textContent=d.last_price!=null?fmt(d.last_price):"\u2014";const pct=Number(d.price_change_pct_24h);const ch=$("price-change");if(d.price_change_pct_24h!=null&&Number.isFinite(pct)){ch.textContent=(pct>0?"+":"")+pct.toFixed(2)+"% / 24H";ch.className="change "+(pct>0?"positive":pct<0?"negative":"")}else{ch.textContent="Last analyzed snapshot";ch.className="change"}
 $("last-updated").textContent="UPDATED "+date(d.created_at).toUpperCase();$("result-status").textContent="RESULT READY";$("result-status").className="result-status ready";$("result-empty").classList.add("hidden");
 const rows=Array.isArray(d.results)?d.results:[];$("model-results").innerHTML=rows.map(r=>{
   const name=r.provider_label||r.provider||"Model";
   const voteLabel=r.role ? (r.role+" \u00B7 Vote "+(r.vote_index||"?")) : "";
   const failed=r.status!=="success";
   const sig=failed?(r.status==="timeout"?"TIMEOUT":"ERROR"):(r.signal||"ERROR");
   const code=failed?errorLabel(r):"";
   const detail=failed?((r.error||"").slice(0,180)):(r.status||"success");
   return '<div class="model-row '+(failed?"model-row-error":"")+'"><span class="model-avatar">'+escapeHtml(name.slice(0,2).toUpperCase())+'</span><span class="model-info"><b>'+escapeHtml(name)+'</b><small>'+escapeHtml(voteLabel ? voteLabel+" \u00B7 " : "")+escapeHtml(failed?code:(r.status||"success"))+(r.duration_ms!=null?" \u00B7 "+fmt(r.duration_ms)+" ms":"")+'</small>'+(failed?'<em class="model-error-message">'+escapeHtml(detail)+'</em>':"")+'</span><span class="signal-pill '+signalClass(sig)+(failed?" provider-error":"")+'">'+escapeHtml(failed?code:sig.replace("_"," "))+'</span></div>';
 }).join("");
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
const REQUIRED_PROVIDERS=6;
let running=false;
let sceneReady=false;
function updateRunButton(){ $("analyze-btn").disabled=running||!sceneReady||taskProviders.length!==REQUIRED_PROVIDERS; }
function openPanel(name){
  const panel=$("office-panel");
  document.querySelectorAll('[data-panel-content]').forEach(el=>el.hidden=el.dataset.panelContent!==name);
  $("panel-title").textContent=({providers:"Tim analis",results:"Hasil analisis",history:"Riwayat analisis"})[name]||"Workspace";
  if(!panel.open)panel.show();
  $("panel-close").focus();
}
window.addEventListener("office:ready",()=>{sceneReady=true;updateRunButton()});
window.addEventListener("office:error",()=>{sceneReady=false;updateRunButton();$("run-message").textContent="Kantor 3D tidak tersedia. Gunakan Coba lagi untuk memulihkan."});
window.addEventListener("office:idle",()=>{running=false;updateRunButton();$("analyze-label").textContent="Mulai Analisis";$("provider-options").querySelectorAll('input').forEach(el=>el.disabled=false)});
window.addEventListener("office:select",()=>openPanel("providers"));
document.querySelectorAll('[data-panel]').forEach(el=>el.addEventListener("click",()=>openPanel(el.dataset.panel)));
$("result-shortcut").addEventListener("click",()=>openPanel("results"));
$("panel-close").addEventListener("click",()=>$("office-panel").close());
document.addEventListener("keydown",e=>{if(e.key==="Escape")$("office-panel").close()});
window.addEventListener("models:updated",loadProviders);
let taskProviders=[];
function renderProviderPicker(items){
  const wrap=$("provider-options"); const count=$("provider-count");
  const usable=(items||[]).filter(x=>x.key_configured&&x.enabled!==false);
  taskProviders=usable.slice(0,REQUIRED_PROVIDERS).map(x=>x.provider);
  wrap.innerHTML=usable.length?usable.map((x,i)=>'<label class="provider-option '+(taskProviders.includes(x.provider)?'selected':'')+'"><input type="checkbox" value="'+escapeHtml(x.provider)+'" '+(taskProviders.includes(x.provider)?'checked':'')+'><span class="provider-mark">'+escapeHtml(x.label.slice(0,2).toUpperCase())+'</span><span class="provider-name"><b>'+escapeHtml(x.label)+'</b><small>'+escapeHtml(x.model||x.default_model)+'</small></span><span class="provider-check">\u2713</span></label>').join(''):'<span class="provider-loading">Tidak ada provider dengan API key.</span>';
  const update=(event)=>{
    let checked=[...wrap.querySelectorAll('input:checked')].map(x=>x.value);
    if(checked.length>REQUIRED_PROVIDERS){event.target.checked=false;checked=[...wrap.querySelectorAll('input:checked')].map(x=>x.value)}
    taskProviders=checked;count.textContent=checked.length+'/'+REQUIRED_PROVIDERS+' dipilih';
    wrap.querySelectorAll('.provider-option').forEach(el=>el.classList.toggle('selected',el.querySelector('input').checked));
    $("provider-help").textContent=checked.length===REQUIRED_PROVIDERS?'Siap. Setiap provider akan menjalankan 2 vote (total 12 vote).':'Pilih tepat '+REQUIRED_PROVIDERS+' provider yang memiliki API key.';
    if(!running){$("run-message").textContent=checked.length===REQUIRED_PROVIDERS?'Tim siap. Mulai analisis untuk mengadakan meeting.':'Pilih 6 provider melalui panel Analis.'}
    updateRunButton();
  };
  wrap.querySelectorAll('input').forEach(i=>i.addEventListener('change',update)); update();
}
async function loadProviders(){if(running)return;try{const res=await fetch('/api/models');const d=await res.json();if(!res.ok)throw new Error(d.error||'Gagal memuat provider');renderProviderPicker(d.items||[])}catch(e){taskProviders=[];$("provider-options").innerHTML='<span class="provider-loading error">Provider tidak dapat dimuat.</span>';$("run-message").textContent=e.message;updateRunButton()}}
async function loadHistory(){const body=$("history-body");try{const res=await fetch("/api/history?limit=20");if(!res.ok)throw Error("HTTP "+res.status);const data=await res.json();const items=data.items||[];if(!items.length){body.innerHTML='<tr><td colspan="6" class="table-empty">Belum ada riwayat analisis.</td></tr>';return}body.innerHTML=items.map(r=>'<tr><td class="id-cell">'+escapeHtml(r.id)+'</td><td>'+escapeHtml(date(r.created_at))+'</td><td>BTCUSDT</td><td><span class="signal-pill '+signalClass(r.majority_signal)+'">'+escapeHtml(r.majority_signal||"\u2014")+'</span></td><td>'+escapeHtml((r.success_count??0)+"/"+(r.total_models??0))+'</td><td><button class="open-detail" data-id="'+escapeHtml(r.id)+'">Detail \u2192</button></td></tr>').join("");body.querySelectorAll("[data-id]").forEach(b=>b.addEventListener("click",()=>showDetail(b.dataset.id)))}catch(e){body.innerHTML='<tr><td colspan="6" class="table-empty">Riwayat tidak dapat dimuat.</td></tr>'}}
async function showDetail(id){const wrap=document.createElement("div");wrap.className="detail-modal";wrap.innerHTML='<section class="detail-card"><div class="detail-head"><h2>Analysis detail</h2><button class="detail-close">Close \u2715</button></div><div class="detail-pre">Loading\u2026</div></section>';document.body.append(wrap);const close=()=>wrap.remove();wrap.querySelector(".detail-close").addEventListener("click",close);wrap.addEventListener("click",e=>{if(e.target===wrap)close()});try{const res=await fetch("/api/analysis/"+encodeURIComponent(id));const d=await res.json();wrap.querySelector(".detail-pre").textContent=JSON.stringify(d,null,2)}catch(e){wrap.querySelector(".detail-pre").textContent="Detail tidak dapat dimuat."}}
$("logout-btn").addEventListener("click",async()=>{try{await fetch("/api/logout",{method:"POST"})}finally{window.location.href="/login"}});
$("analyze-btn").addEventListener("click",async()=>{
  if(running||!sceneReady||taskProviders.length!==REQUIRED_PROVIDERS)return;
  running=true;updateRunButton();
  const label=$("analyze-label"),msg=$("run-message"),selected=[...taskProviders];
  label.textContent="Meeting berlangsung";msg.className="office-message";msg.textContent="Analis menuju meeting. Meminta 12 vote dari 6 provider AI.";
  $("office-panel").close();
  $("provider-options").querySelectorAll('input').forEach(el=>el.disabled=true);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),150000);
  try{
    const gather=window.bygaOffice.beginMeeting();
    // Capture failures immediately while characters finish walking to the room.
    const request=(async()=>{
      try{
        const res=await fetch("/api/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({models:selected}),signal:controller.signal});
        const data=await res.json();
        if(!res.ok)throw new Error(data.error||(data.retry_after_seconds?'Tunggu '+data.retry_after_seconds+' detik sebelum analisis berikutnya.':data.error_code)||"Analisis gagal");
        return {data};
      }catch(error){return {error}}
      finally{clearTimeout(timeout)}
    })();
    const [outcome]=await Promise.all([request,gather]);
    if(outcome.error){
      const message=outcome.error.name==="AbortError"?"Permintaan melewati batas waktu. Periksa riwayat sebelum mencoba ulang.":outcome.error.message;
      msg.className="office-message error";msg.textContent=message;
      await window.bygaOffice.discuss(null,message);
    }else{
      renderAnalysis(outcome.data);
      msg.className="office-message success";msg.textContent="Hasil diterima. Analis sedang membahas vote.";
      void loadHistory();
      await window.bygaOffice.discuss(outcome.data);
    }
    label.textContent="Kembali ke meja";
  }catch(error){
    controller.abort();clearTimeout(timeout);
    msg.className="office-message error";msg.textContent=error.message||"Meeting gagal dimulai.";
    if(!window.bygaOffice?.busy){running=false;updateRunButton();label.textContent="Mulai Analisis";$("provider-options").querySelectorAll('input').forEach(el=>el.disabled=false)}
  }
});
$("refresh-history").addEventListener("click",loadHistory);
loadProviders();loadHistory();
