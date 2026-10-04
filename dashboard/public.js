const $=id=>document.getElementById(id);
const date=v=>v?new Date(v).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}):'Belum ada hasil';
let initialized=false,lastUpdate=null,sceneReady=!!window.bygaOffice,pending=null,playing=false;
function render(status){
  $('public-symbol').textContent=status.symbol||'BTCUSDT.P';
  $('public-timeframe').textContent=String(status.timeframe||'H1 / M15 / M5').replaceAll('/',' / ');
  const signal=['BUY','SELL'].includes(status.signal)?status.signal:'—';
  $('public-signal').textContent=signal;
  $('public-signal').className=signal==='BUY'?'signal-buy':signal==='SELL'?'signal-sell':'';
  $('public-updated').textContent=date(status.updated_at);
}
async function play(status){
  if(!sceneReady||playing||window.bygaOffice?.busy){pending=status;return;}
  playing=true;
  try{
    await window.bygaOffice.beginMeeting();
    await window.bygaOffice.discussPublic(status);
  }catch{/* Scene can recover on the next public status update. */}
  finally{playing=false;}
}
async function poll(){
  if(document.hidden)return;
  try{
    const response=await fetch('/api/public-status',{cache:'no-store'});
    if(!response.ok)return;
    const status=await response.json();
    render(status);
    if(!initialized){initialized=true;lastUpdate=status.updated_at||null;return;}
    if(!status.updated_at||status.updated_at===lastUpdate)return;
    lastUpdate=status.updated_at;
    if(['BUY','SELL'].includes(status.signal))await play(status);
  }catch{/* Public view stays usable even when status is temporarily unavailable. */}
}
window.addEventListener('office:ready',()=>{sceneReady=true;if(pending){const next=pending;pending=null;void play(next);}});
window.addEventListener('office:error',()=>{sceneReady=false;});
window.addEventListener('office:idle',()=>{if(pending){const next=pending;pending=null;void play(next);}});
void poll();setInterval(poll,30000);
