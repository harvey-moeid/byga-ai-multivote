import { calculateSnapshot } from '../src/pipeline/calculate.js';
import { openSettings } from './models.js';
const $=id=>document.getElementById(id);
const fmt=n=>n!=null&&Number.isFinite(Number(n))?Number(n).toLocaleString('en-US',{maximumFractionDigits:2}):'—';
const date=v=>v?new Date(v).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}):'—';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={smc_ict:'SMC / ICT',indicators:'Indikator',volume:'Volume'};
let running=false,sceneReady=!!window.bygaOffice,settings=null,lastSeen=null,statusInitialized=false,pendingResult=null;
function updateButton(){$('analyze-btn').disabled=running||!sceneReady||!settings;}
function message(text,type=''){$('run-message').textContent=text;$('run-message').className='office-message '+type;}
async function api(path,options) {
  const res=await fetch(path,options);
  if(res.status===401){location.href='/login';throw new Error('Silakan login kembali.');}
  const d=await res.json();if(!res.ok)throw new Error(d.error||d.error_code||'HTTP '+res.status);return d;
}
function openPanel(name) {
  document.querySelectorAll('[data-panel-content]').forEach(el=>el.hidden=el.dataset.panelContent!==name);
  $('panel-title').textContent=({providers:'Tim analis',results:'Snapshot dan vote',history:'Riwayat'})[name];
  if(!$('office-panel').open)$('office-panel').show();$('panel-close').focus();
}
function renderSnapshot(snapshot) {
  const gate=snapshot.gate;
  $('gate-note').textContent=gate.meeting?'Pemicu meeting: '+gate.direction+' · minimal 2 dari 3 kelompok sepakat.':'Belum ada dua kelompok sepakat BUY/SELL. Analis tetap di meja.';
  $('snapshot-groups').innerHTML=Object.entries(snapshot.groups).map(([key,g])=>{
    const frames=Object.entries(g.frames).map(([tf,f])=>{
      const m=f.measurements;
      const detail=key==='smc_ict'?'Struktur '+(m.bias||'NETRAL')+' · '+m.structure.length+' event · '+m.fvg.length+' FVG':key==='indicators'?'RSI '+fmt(m.rsi)+' · ADX '+fmt(m.adx)+' · EMA '+fmt(m.emaFast)+' / '+fmt(m.emaSlow):'RVOL '+fmt(m.relativeVolume)+' · CMF '+fmt(m.cmf)+' · '+(m.source||'—');
      return '<tr><td>'+escape(tf)+'</td><td>'+escape(f.signal==='NEUTRAL'?'NETRAL':f.signal)+'</td><td>'+escape(detail)+'</td></tr>';
    }).join('');
    return '<details class="snapshot-card"><summary><b>'+labels[key]+'</b><span class="signal-pill '+g.signal.toLowerCase()+'">'+(g.signal==='NEUTRAL'?'NETRAL':g.signal)+'</span></summary><table><tbody>'+frames+'</tbody></table>'+(key==='volume'?'<small>OHLCV: CMF/OBV adalah proksi, bukan delta transaksi.</small>':'')+'</details>';
  }).join('');
  $('price').textContent=fmt(snapshot.last_price);$('price-change').textContent='H1 / M15 / M5 · candle tertutup';
}
function renderAnalysis(d) {
  if(d.snapshot)renderSnapshot(d.snapshot);
  const v=d.voting||{buy:d.buy_votes,sell:d.sell_votes,success:d.success_count,total_models:d.total_models,error:d.error_count},signal=d.majority_signal||'—';
  $('consensus').textContent=signal;$('consensus').className='metric-value signal-'+signal.toLowerCase();
  $('consensus-note').textContent=d.status==='approved'?'Disetujui: '+v.support+'/6 mendukung arah awal '+d.initial_direction:d.status==='filtered'?'Tersaring sebelum AI: dua kelompok belum sepakat.':d.status==='rejected'?'Meeting selesai: dukungan '+v.support+'/6, belum mencapai 4.':!d.voting?'Histori alur sebelumnya.':'Menunggu hasil.';
  $('responses').textContent=v.success||0;$('responses-total').textContent=' / '+(v.total_models??6)+' vote';
  $('buy-count').textContent=v.buy||0;$('sell-count').textContent=v.sell||0;$('neutral-count').textContent=v.error||0;$('vote-total').textContent=v.total_models||0;
  $('buy-bar').style.width=((v.buy||0)/(v.total_models||6)*100)+'%';$('sell-bar').style.width=((v.sell||0)/(v.total_models||6)*100)+'%';
  $('duration').textContent=fmt((d.duration_ms||0)/1000);$('duration-unit').textContent=' sec';
  $('last-updated').textContent='WIB · '+date(d.created_at);$('result-status').textContent=({approved:'DISETUJUI',rejected:'BELUM DISETUJUI',filtered:'TERSARING'})[d.status]||'MEMPROSES';
  $('result-empty').classList.toggle('hidden',!!d.results?.length);
  $('result-empty').textContent=d.meeting?'Menunggu vote analis.':'Tidak ada panggilan AI pada pemeriksaan ini.';
  const delivery=d.delivery?.state;
  $('discord-status').textContent=!d.voting?'':!v.approved?'Discord: tidak dikirim; syarat 4/6 belum terpenuhi.':delivery==='sent'?'Discord: terkirim.':delivery==='not_configured'?'Discord: webhook belum diatur.':delivery==='disabled'?'Discord: dinonaktifkan.':delivery==='expired'?'Discord: sinyal kedaluwarsa sebelum terkirim.':delivery==='failed'?'Discord: pengiriman gagal; periksa webhook.':delivery==='pending'?'Discord: menunggu percobaan ulang.':'Discord: lihat status antrean.';
  $('model-results').innerHTML=(d.results||[]).map(r=>'<div class="model-row"><span class="model-avatar">'+escape((r.analyst_name||r.provider).slice(0,2))+'</span><span class="model-info"><b>'+escape(r.analyst_name||r.provider_label)+'</b><small>'+escape(labels[r.role]||r.role)+' · '+escape(r.provider_label)+' · '+escape(r.model||'')+'</small><em>'+escape(r.reason||r.error||'')+'</em></span><span class="signal-pill '+(r.signal||'error').toLowerCase()+'">'+escape(r.status==='success'?r.signal:'ERROR')+'</span></div>').join('');
}
async function loadSettings() {
  const d=await api('/api/settings');settings=d.settings;
  $('provider-options').innerHTML=settings.analysts.map(a=>{
    const p=d.providers.find(p=>p.provider===a.provider);
    return '<div class="provider-option"><span class="provider-mark">'+escape(a.id.at(-1))+'</span><span class="provider-name"><b>'+escape(a.name)+'</b><small>'+escape(labels[a.group])+' · '+escape(p?.label||a.provider)+'</small><small>'+escape(a.model)+'</small></span><span class="provider-key '+(p?.configured?'':'error')+'">'+(p?.configured?'Siap':'Belum aktif')+'</span></div>';
  }).join('');
  $('cron-status').textContent='Cron setiap 5 menit: '+(settings.cronEnabled?'aktif':'nonaktif')+' · Discord '+(d.webhook_configured?'terkonfigurasi':'belum diatur');
  document.querySelector('.office-brand small').textContent='BTCUSDT.P · '+Object.values(settings.calculation.frames).join(' / ');
  updateButton();
}
async function previewCalculation() {
  const d=await api('/api/market');const snapshot=calculateSnapshot(d.market,d.settings);
  renderSnapshot(snapshot);window.bygaCalculation=snapshot;return snapshot;
}
async function loadHistory() {
  try {
    const d=await api('/api/history?limit=20');
    $('history-body').innerHTML=d.items.length?d.items.map(r=>'<tr><td>'+escape(r.id.slice(0,16))+'</td><td>'+escape(date(r.created_at))+'</td><td>BTCUSDT.P</td><td>'+escape(r.majority_signal||({filtered:'Tersaring',rejected:'Ditolak'})[r.status]||r.status)+'</td><td>'+r.success_count+'/'+r.total_models+'</td><td><button data-id="'+escape(r.id)+'">Detail</button></td></tr>').join(''):'<tr><td colspan="6">Belum ada pemeriksaan.</td></tr>';
    $('history-body').querySelectorAll('[data-id]').forEach(el=>el.addEventListener('click',async()=>{try{renderAnalysis(await api('/api/analysis/'+encodeURIComponent(el.dataset.id)));openPanel('results');}catch(e){message(e.message,'error');}}));
  }catch(e){$('history-body').innerHTML='<tr><td colspan="6">Riwayat belum tersedia.</td></tr>';}
}
async function playMeeting(result) {
  running=true;updateButton();$('office-panel').close();$('analyze-label').textContent='Meeting berlangsung';
  message('Dua kelompok sepakat '+result.initial_direction+'. Enam analis dan bos menuju ruang meeting.');
  await window.bygaOffice.beginMeeting();renderAnalysis(result);await window.bygaOffice.discuss(result);
  $('analyze-label').textContent='Kembali ke meja';
}
async function runManual() {
  if(running||!sceneReady||!settings)return;
  running=true;updateButton();$('analyze-label').textContent='Menghitung…';message('Membaca chart_db dan menghitung snapshot di web tanpa AI.');
  try {
    const snapshot=await previewCalculation();
    message(snapshot.gate.meeting?'Pemicu '+snapshot.gate.direction+' terdeteksi. Meminta enam vote AI.':'Belum ada pemicu. Menyimpan hasil pemeriksaan tanpa panggilan AI.');
    const result=await api('/api/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({candle_times:snapshot.candle_times}),signal:AbortSignal.timeout(150000)});
    if(result.snapshot){lastSeen=result.id;renderAnalysis(result);}void loadHistory();
    if(result.duplicate)message(result.status==='running'?'Candle ini sedang diproses cron. Hasil akan muncul otomatis.':'Candle ini sudah diperiksa. Tidak ada panggilan AI atau pengiriman Discord ulang.');
    else if(result.meeting){await playMeeting(result);return;}
    else message('Tidak ada dua kelompok sepakat. Analis tetap di meja.');
  }catch(e){message(e.name==='TimeoutError'?'Permintaan melewati batas waktu. Periksa histori sebelum mencoba lagi.':e.message,'error');}
  if(!window.bygaOffice?.busy){running=false;updateButton();$('analyze-label').textContent='Mulai Analisis';}
}
async function pollStatus() {
  if(document.hidden)return;
  try {
    const d=await api('/api/status'),latest=d.latest,r=latest?.result;
    if(latest?.state==='running'&&!running)message('Cron sedang memproses candle terbaru.');
    if(!statusInitialized){statusInitialized=true;if(r){lastSeen=r.id;if(!running)renderAnalysis(r);}return;}
    if(!r)return;
    if(r.id===lastSeen)return;
    lastSeen=r.id;
    if(running){pendingResult=r;return;}
    renderAnalysis(r);void loadHistory();
    if(r.meeting&&sceneReady)await playMeeting(r);
    else message('Cron selesai: dua kelompok belum sepakat.');
  }catch{/* Next poll retries without disturbing the current meeting. */}
}
window.addEventListener('office:ready',()=>{sceneReady=true;updateButton();});
window.addEventListener('office:error',()=>{sceneReady=false;updateButton();});
window.addEventListener('office:idle',()=>{
  running=false;updateButton();$('analyze-label').textContent='Mulai Analisis';
  if(pendingResult){const r=pendingResult;pendingResult=null;renderAnalysis(r);if(r.meeting)void playMeeting(r);}
});
window.addEventListener('office:select',()=>openPanel('providers'));
document.querySelectorAll('[data-panel]').forEach(el=>el.addEventListener('click',()=>openPanel(el.dataset.panel)));
$('result-shortcut').addEventListener('click',()=>openPanel('results'));
$('panel-close').addEventListener('click',()=>$('office-panel').close());
document.addEventListener('keydown',e=>{if(e.key==='Escape')$('office-panel').close();});
const configure=()=>openSettings(async()=>{await loadSettings();await previewCalculation();message('Pengaturan tersimpan. Berlaku pada candle berikutnya.');});
$('settings-btn').addEventListener('click',configure);$('edit-analysts').addEventListener('click',configure);
$('analyze-btn').addEventListener('click',runManual);$('refresh-history').addEventListener('click',loadHistory);
$('logout-btn').addEventListener('click',async()=>{try{await fetch('/api/logout',{method:'POST'});}finally{location.href='/login';}});
async function init(){try{await loadSettings();await previewCalculation();message('Siap. Pemeriksaan otomatis setiap 5 menit.');}catch(e){message(e.message,'error');}await pollStatus();void loadHistory();}
void init();setInterval(pollStatus,30000);
