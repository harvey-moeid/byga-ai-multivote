const h=(tag,props={},...children)=>{
  const el=document.createElement(tag);
  for(const [k,v] of Object.entries(props)){if(k==='text')el.textContent=v;else if(k==='class')el.className=v;else if(k==='checked')el.checked=v;else if(k==='value')el.value=v;else el.setAttribute(k,v);}
  el.append(...children.flat());return el;
};
const descriptions={candleLimit:'Jumlah candle per timeframe',swing:'Radius pivot terkonfirmasi',range:'Rentang dealing range',eventWindow:'Jendela event terbaru',atrPeriod:'Periode ATR',displacement:'Displacement minimum × ATR',fvgAtr:'Ukuran FVG minimum × ATR',threshold:'Minimum konfirmasi searah',emaFast:'EMA cepat',emaSlow:'EMA lambat',rsiPeriod:'Periode RSI',rsiBuy:'RSI minimum BUY',rsiSell:'RSI maksimum SELL',macdFast:'MACD cepat',macdSlow:'MACD lambat',macdSignal:'MACD signal',bbPeriod:'Periode Bollinger',bbStd:'Deviasi Bollinger',adxPeriod:'Periode ADX',adxMin:'ADX minimum',period:'Periode CMF / baseline volume',rvolMin:'RVOL minimum',cmfMin:'CMF minimum absolut',obvLookback:'Jendela perubahan OBV',oiLookback:'Lookback Open Interest',oiChangeMinPct:'Δ Open Interest minimum %',priceMoveMinPct:'Pergerakan harga minimum %',fundingExtremePct:'Funding ekstrem %',longShortExtreme:'Rasio Long/Short ekstrem',liquidationImbalance:'Imbalance liquidation minimum',liquidationMinUsd:'Liquidation minimum USD'};
export async function openSettings(onSaved) {
  if(document.getElementById('pipeline-settings'))return;
  const body=h('div',{class:'pipeline-settings-body'},'Memuat pengaturan…'),close=h('button',{type:'button',class:'detail-close',text:'Tutup'});
  const wrap=h('div',{id:'pipeline-settings',class:'detail-modal'},h('section',{class:'detail-card pipeline-settings-card',role:'dialog','aria-modal':'true','aria-label':'Pengaturan pipeline'},h('div',{class:'detail-head'},h('h2',{text:'Pengaturan pipeline'}),close),body));
  const restore=document.activeElement;
  const dismiss=()=>{wrap.remove();restore?.focus();};close.addEventListener('click',dismiss);wrap.addEventListener('click',e=>{if(e.target===wrap)dismiss();});
  wrap.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();dismiss();}if(e.key==='Tab'){const els=[...wrap.querySelectorAll('button,input,select')].filter(el=>!el.disabled),first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
  document.body.append(wrap);close.focus();
  try {
    const res=await fetch('/api/settings'),data=await res.json();if(!res.ok)throw Error(data.error||'Pengaturan tidak tersedia.');
    const s=structuredClone(data.settings),fields=[];
    const healthByProvider=new Map((data.provider_health||[]).map(x=>[x.provider,x]));
    const healthText=x=>({HEALTHY:'Healthy',DEGRADED:'Degraded',DOWN:'Down',READY:'Ready',NOT_CONFIGURED:'Not configured'})[x?.state]||'Unknown';
    const healthTime=value=>value?new Date(value).toLocaleString('id-ID',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Jakarta'}):'Belum pernah dipakai';
    body.replaceChildren(h('p',{text:'BTCUSDT.P · candle tertutup · chart_db read only. AUTO memakai gate 2/4; MANUAL selalu menjalankan 8 AI. Provider Health dihitung dari hasil penggunaan nyata, tanpa ping berbayar tambahan.'}));
    const section=(title)=>{const details=h('details',{class:'settings-section',open:''},h('summary',{text:title}));body.append(details);return details;};
    const frameSection=section('Timeframe dan perhitungan');
    for(const [role,label] of [['trend','Tren'],['structure','Struktur'],['trigger','Pemicu']]) {
      const select=h('select',{'aria-label':'Timeframe '+label},...['H4','H1','M15','M5','D1'].map(tf=>h('option',{value:tf,text:tf})));select.value=s.calculation.frames[role];
      frameSection.append(h('label',{},h('span',{text:label}),select));fields.push(()=>{s.calculation.frames[role]=select.value;});
    }
    function numberField(parent,obj,key,prefix='') {
      const input=h('input',{type:'number',value:obj[key],step:Number.isInteger(obj[key])&&!['displacement','bbStd','rvolMin','fvgAtr','cmfMin','oiChangeMinPct','priceMoveMinPct','fundingExtremePct','longShortExtreme','liquidationImbalance'].includes(key)?'1':'0.01',required:'','aria-label':prefix+descriptions[key]});
      parent.append(h('label',{},h('span',{text:descriptions[key]}),input));fields.push(()=>{obj[key]=Number(input.value);});
    }
    numberField(frameSection,s.calculation,'candleLimit');
    for(const [key,label] of [['smc','SMC / ICT'],['indicators','Indikator'],['volume','Volume'],['derivatives','Derivatif / Market Positioning']]){const box=section(label);for(const k of Object.keys(s.calculation[key]))numberField(box,s.calculation[key],k,label+' ');}

    const healthSection=section('Provider Health');
    healthSection.append(h('p',{class:'settings-help',text:'Berdasarkan maksimal 12 panggilan terbaru per provider. Healthy ≥80% sukses dan panggilan terakhir sukses; 3 kegagalan beruntun atau success rate <50% (minimal 4 sampel) ditandai Down.'}));
    const healthGrid=h('div',{class:'provider-health-grid'});
    for(const p of data.providers){
      const x=healthByProvider.get(p.provider)||{state:p.configured?'READY':'NOT_CONFIGURED',samples:0,success_rate_pct:null,avg_latency_ms:null,last_checked_at:null,last_error_code:null};
      const metrics=x.samples?x.success_rate_pct+'% sukses · '+x.samples+' sampel'+(x.avg_latency_ms!=null?' · '+x.avg_latency_ms+' ms':''):'Belum ada histori panggilan';
      healthGrid.append(h('div',{class:'provider-health-card state-'+String(x.state||'UNKNOWN').toLowerCase()},
        h('div',{class:'provider-health-head'},h('b',{text:p.label}),h('span',{class:'provider-health-badge',text:healthText(x)})),
        h('small',{text:metrics}),
        h('small',{text:'Terakhir: '+healthTime(x.last_checked_at)+(x.last_error_code?' · '+x.last_error_code:'')})
      ));
    }
    healthSection.append(healthGrid);

    const team=section('Delapan karakter · provider dan model');
    s.analysts.forEach((a,i)=>{
      const name=h('input',{value:a.name,maxlength:'40','aria-label':'Nama analis '+(i+1)});
      const provider=h('select',{'aria-label':'Provider analis '+(i+1)},...data.providers.map(p=>{const x=healthByProvider.get(p.provider);return h('option',{value:p.provider,text:p.label+' · '+healthText(x||{state:p.configured?'READY':'NOT_CONFIGURED'})});}));provider.value=a.provider;
      const model=h('input',{value:a.model,'aria-label':'Model analis '+(i+1),maxlength:'120'});
      const row=h('div',{class:'analyst-settings'},h('b',{text:['SMC/ICT','Indikator','Volume','Derivatif'][Math.floor(i/2)]+' · '+(i%2+1)}),name,provider,model);
      provider.addEventListener('change',()=>{model.value=data.providers.find(p=>p.provider===provider.value).default_model;});team.append(row);
      fields.push(()=>{a.name=name.value;a.provider=provider.value;a.model=model.value;});
    });
    const automation=section('Cron dan Discord');
    for(const [key,label] of [['cronEnabled','Pemeriksaan otomatis setiap 5 menit'],['discordEnabled','Kirim hasil yang disetujui ke Discord']]) {
      const cb=h('input',{type:'checkbox',checked:s[key]});automation.append(h('label',{class:'settings-toggle'},cb,h('span',{text:label})));fields.push(()=>{s[key]=cb.checked;});
    }
    const webhook=h('input',{type:'password',autocomplete:'new-password',placeholder:data.webhook_configured?'Webhook tersimpan · kosongkan untuk mempertahankan':'https://discord.com/api/webhooks/…','aria-label':'Webhook Discord'});
    const clear=h('input',{type:'checkbox'});automation.append(h('p',{text:'Webhook disimpan terenkripsi dan tidak ditampilkan kembali.'}),webhook,h('label',{class:'settings-toggle'},clear,h('span',{text:'Hapus webhook yang disimpan dari web'})));
    const msg=h('p',{role:'status'}),save=h('button',{type:'button',class:'office-run',text:'Simpan pengaturan'});
    body.append(msg,save);
    save.addEventListener('click',async()=>{
      fields.forEach(fn=>fn());save.disabled=true;msg.textContent='Menyimpan…';
      try {
        const res=await fetch('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({settings:s,discord_webhook:webhook.value,clear_webhook:clear.checked})}),d=await res.json();
        if(!res.ok)throw Error(d.error||'Gagal menyimpan.');webhook.value='';msg.textContent='Tersimpan. Berlaku pada candle berikutnya.';await onSaved();
      }catch(e){msg.textContent=e.message;}finally{save.disabled=false;}
    });
  }catch(e){body.textContent=e.message;}
}
