const h=(tag,props={},...children)=>{
  const el=document.createElement(tag);
  for(const [k,v] of Object.entries(props)){if(k==='text')el.textContent=v;else if(k==='class')el.className=v;else if(k==='checked')el.checked=v;else if(k==='value')el.value=v;else el.setAttribute(k,v);}
  el.append(...children.flat());return el;
};
const descriptions={candleLimit:'Jumlah candle per timeframe',swing:'Radius pivot terkonfirmasi',range:'Rentang dealing range',eventWindow:'Jendela event terbaru',atrPeriod:'Periode ATR',displacement:'Displacement minimum × ATR',fvgAtr:'Ukuran FVG minimum × ATR',threshold:'Minimum konfirmasi searah',emaFast:'EMA cepat',emaSlow:'EMA lambat',rsiPeriod:'Periode RSI',rsiBuy:'RSI minimum BUY',rsiSell:'RSI maksimum SELL',macdFast:'MACD cepat',macdSlow:'MACD lambat',macdSignal:'MACD signal',bbPeriod:'Periode Bollinger',bbStd:'Deviasi Bollinger',adxPeriod:'Periode ADX',adxMin:'ADX minimum',period:'Periode CMF / baseline volume',rvolMin:'RVOL minimum',cmfMin:'CMF minimum absolut',obvLookback:'Jendela perubahan OBV',oiLookback:'Lookback Open Interest',oiChangeMinPct:'Δ Open Interest minimum %',priceMoveMinPct:'Pergerakan harga minimum %',fundingExtremePct:'Funding ekstrem %',longShortExtreme:'Rasio Long/Short ekstrem',liquidationImbalance:'Imbalance liquidation minimum',liquidationMinUsd:'Liquidation minimum USD'};
const numberRules={
  candleLimit:[100,1000,1],
  smc:{swing:[1,10,1],range:[20,200,1],eventWindow:[1,50,1],atrPeriod:[5,50,1],displacement:[.1,5,.01],fvgAtr:[0,2,.01],threshold:[1,5,1]},
  indicators:{emaFast:[2,100,1],emaSlow:[3,200,1],rsiPeriod:[2,50,1],rsiBuy:[50,90,.01],rsiSell:[10,50,.01],macdFast:[2,50,1],macdSlow:[3,100,1],macdSignal:[2,50,1],bbPeriod:[5,100,1],bbStd:[.5,4,.01],adxPeriod:[5,50,1],adxMin:[0,60,.01],threshold:[1,5,1]},
  volume:{period:[5,100,1],rvolMin:[.1,5,.01],cmfMin:[.001,.5,.001],obvLookback:[2,100,1]},
  derivatives:{oiLookback:[1,20,1],oiChangeMinPct:[0,20,.01],priceMoveMinPct:[0,10,.01],fundingExtremePct:[.001,1,.001],longShortExtreme:[1.01,5,.01],liquidationImbalance:[1,10,.01],liquidationMinUsd:[0,1000000000,1],threshold:[1,4,1]}
};
const frameMs={M5:300000,M15:900000,H1:3600000,H4:14400000,D1:86400000};
const groupLabels=['SMC/ICT','Indikator','Volume','Derivatif'];
async function requestJson(path,options){
  let res;
  try{res=await fetch(path,options);}catch{throw new Error('Tidak dapat terhubung ke server. Periksa koneksi lalu coba lagi.');}
  if(res.status===401){location.href='/login';throw new Error('Sesi berakhir. Silakan login kembali.');}
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||data.error_code||('HTTP '+res.status));
  return data;
}
export async function openSettings(onSaved) {
  if(document.getElementById('pipeline-settings'))return;
  const titleBlock=h('div',{class:'settings-title'},h('small',{class:'settings-kicker',text:'BYGA PIPELINE'}),h('h2',{text:'Pengaturan'}),h('p',{text:'Atur scanner, analis AI, provider fallback, cron, dan Discord.'}));
  const body=h('div',{class:'pipeline-settings-body'},h('div',{class:'settings-loading'},'Memuat pengaturan…'));
  const close=h('button',{type:'button',class:'detail-close',text:'Tutup','aria-label':'Tutup pengaturan'});
  const card=h('section',{class:'detail-card pipeline-settings-card',role:'dialog','aria-modal':'true','aria-labelledby':'settings-title'},h('div',{class:'detail-head'},titleBlock,close),body);
  titleBlock.querySelector('h2').id='settings-title';
  const wrap=h('div',{id:'pipeline-settings',class:'detail-modal'},card);
  const restore=document.activeElement;
  let dirty=false,save=null,msg=null;
  const dismiss=()=>{
    if(dirty&&!window.confirm('Perubahan belum disimpan. Tutup tanpa menyimpan?'))return;
    wrap.remove();restore?.focus();
  };
  close.addEventListener('click',dismiss);
  wrap.addEventListener('click',e=>{if(e.target===wrap)dismiss();});
  wrap.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.stopPropagation();dismiss();return;}
    if(e.key==='Tab'){
      const els=[...wrap.querySelectorAll('button,input,select,summary,[href]')].filter(el=>!el.disabled&&el.offsetParent!==null),first=els[0],last=els.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  });
  document.body.append(wrap);close.focus();
  try {
    const data=await requestJson('/api/settings');
    const s=structuredClone(data.settings),fields=[];
    const healthByProvider=new Map((data.provider_health||[]).map(x=>[x.provider,x]));
    const healthText=x=>({HEALTHY:'Healthy',DEGRADED:'Degraded',DOWN:'Down',READY:'Ready',NOT_CONFIGURED:'Belum dikonfigurasi'})[x?.state]||'Unknown';
    const healthReasonLabels={
      AUTH_ERROR:'API key ditolak',
      AUTH_FORBIDDEN:'Akses API ditolak',
      BILLING_REQUIRED:'Billing diperlukan',
      MODEL_TIER_RESTRICTED:'Model tidak tersedia di paket akun',
      RATE_LIMITED:'Rate limit',
      MODEL_NOT_FOUND:'Model tidak ditemukan',
      LOCATION_UNSUPPORTED:'Lokasi tidak didukung',
      PROVIDER_SERVER_ERROR:'Server provider bermasalah',
      PROVIDER_HTTP_ERROR:'HTTP error provider',
      AI_TIMEOUT:'Timeout',
      EMPTY_AI_RESPONSE:'Respons AI kosong',
      INVALID_AI_RESPONSE:'Format respons AI tidak valid',
      MISSING_API_KEY:'API key belum tersedia',
      MISSING_AI_BINDING:'Workers AI binding belum tersedia',
      PROVIDER_NOT_CONFIGURED:'Provider belum dikonfigurasi',
      PROVIDER_ERROR:'Provider error'
    };
    const healthReason=x=>x?.last_error_code?(healthReasonLabels[x.last_error_code]||String(x.last_error_code).replaceAll('_',' ').toLowerCase()):'';
    const healthStatusText=x=>{
      const status=healthText(x),reason=healthReason(x);
      return reason&&['DOWN','DEGRADED'].includes(x?.state)?status+' — '+reason:status;
    };
    const healthTime=value=>value?new Date(value).toLocaleString('id-ID',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Jakarta'}):'Belum pernah dipakai';
    const providerHealth=p=>healthByProvider.get(p.provider)||{state:p.configured?'READY':'NOT_CONFIGURED',samples:0,success_rate_pct:null,avg_latency_ms:null,last_checked_at:null,last_error_code:null};
    const configuredCount=data.providers.filter(p=>p.configured).length;
    const healthyCount=data.providers.filter(p=>['HEALTHY','READY'].includes(providerHealth(p).state)).length;
    const chip=(label,value,state='')=>h('div',{class:'settings-chip '+state},h('small',{text:label}),h('b',{text:value}));
    body.replaceChildren(
      h('div',{class:'settings-intro'},
        h('p',{text:'BTCUSDT.P · candle tertutup · chart_db read only. AUTO memakai gate 2/4; MANUAL tetap menjalankan 8 AI independen.'}),
        h('div',{class:'settings-chips'},
          chip('Provider aktif',configuredCount+'/'+data.providers.length,configuredCount?'ok':'warn'),
          chip('Health siap',healthyCount+'/'+data.providers.length,healthyCount?'ok':'warn'),
          chip('Cron',s.cronEnabled?'5 menit':'Nonaktif',s.cronEnabled?'ok':'warn'),
          chip('Discord',data.webhook_configured?'Tersimpan':'Belum diatur',data.webhook_configured?'ok':'')
        )
      )
    );
    const section=(title,hint='',open=false)=>{
      const copy=h('span',{class:'settings-summary-copy'},h('b',{text:title}));
      if(hint)copy.append(h('small',{text:hint}));
      const details=h('details',{class:'settings-section'},h('summary',{},copy,h('span',{class:'settings-chevron','aria-hidden':'true',text:'›'})));
      details.open=open;body.append(details);return details;
    };
    const field=(label,control,help='')=>{
      const box=h('label',{class:'settings-field'},h('span',{class:'settings-field-label',text:label}),control);
      if(help)box.append(h('small',{class:'settings-field-help',text:help}));
      return box;
    };
    const frameSection=section('Timeframe dan perhitungan','Urutan harus tren > struktur > pemicu.',true);
    for(const [role,label] of [['trend','Tren'],['structure','Struktur'],['trigger','Pemicu']]) {
      const select=h('select',{'aria-label':'Timeframe '+label},...['D1','H4','H1','M15','M5'].map(tf=>h('option',{value:tf,text:tf})));select.value=s.calculation.frames[role];
      frameSection.append(field(label,select));fields.push(()=>{s.calculation.frames[role]=select.value;});
    }
    function numberField(parent,obj,key,sectionKey='candleLimit',prefix='') {
      const rule=sectionKey==='candleLimit'?numberRules.candleLimit:numberRules[sectionKey]?.[key];
      const props={type:'number',value:obj[key],required:'','aria-label':prefix+descriptions[key],inputmode:'decimal'};
      if(rule){props.min=String(rule[0]);props.max=String(rule[1]);props.step=String(rule[2]);}
      const input=h('input',props);
      parent.append(field(descriptions[key],input,rule?'Rentang '+rule[0]+'–'+rule[1]:''));
      fields.push(()=>{obj[key]=Number(input.value);});
    }
    numberField(frameSection,s.calculation,'candleLimit','candleLimit');
    for(const [key,label,hint] of [
      ['smc','SMC / ICT','Struktur, FVG, displacement, dan dealing range.'],
      ['indicators','Indikator','EMA, RSI, MACD, Bollinger, dan ADX.'],
      ['volume','Volume','RVOL, CMF, dan OBV dari OHLCV.'],
      ['derivatives','Derivatif / Market Positioning','OI, funding, long/short, dan liquidation.']
    ]){
      const box=section(label,hint,false);
      for(const k of Object.keys(s.calculation[key]))numberField(box,s.calculation[key],k,key,label+' ');
    }

    const healthSection=section('Provider Health','Status nyata dari panggilan terakhir, tanpa ping berbayar.',false);
    healthSection.append(h('p',{class:'settings-help',text:'Maksimal 12 panggilan terbaru per provider. Healthy ≥80% sukses dan panggilan terakhir sukses; 3 kegagalan beruntun atau success rate <50% (minimal 4 sampel) ditandai Down.'}));
    const healthGrid=h('div',{class:'provider-health-grid'});
    for(const p of data.providers){
      const x=providerHealth(p);
      const metrics=x.samples?x.success_rate_pct+'% sukses · '+x.samples+' sampel'+(x.avg_latency_ms!=null?' · '+x.avg_latency_ms+' ms':''):'Belum ada histori panggilan';
      const reason=healthReason(x);
      healthGrid.append(h('div',{class:'provider-health-card state-'+String(x.state||'UNKNOWN').toLowerCase()},
        h('div',{class:'provider-health-head'},h('b',{text:p.label}),h('span',{class:'provider-health-badge',text:healthStatusText(x)})),
        h('small',{text:metrics}),
        h('small',{text:'Pemeriksaan terakhir: '+healthTime(x.last_checked_at)}),
        ...(x.last_error_code?[h('small',{text:'Error terakhir: '+reason+' ('+x.last_error_code+')'})]:[])
      ));
    }
    healthSection.append(healthGrid);

    const team=section('Delapan karakter · provider dan model','Provider utama dan fallback per karakter. Satu karakter tetap satu vote.',true);
    s.analysts.forEach((a,i)=>{
      const name=h('input',{value:a.name,maxlength:'40',required:'','aria-label':'Nama analis '+(i+1),autocomplete:'off'});
      const provider=h('select',{'aria-label':'Provider utama analis '+(i+1)},...data.providers.map(p=>{const x=providerHealth(p);return h('option',{value:p.provider,text:p.label+' · '+healthStatusText(x)});}));provider.value=a.provider;
      const model=h('input',{value:a.model,'aria-label':'Model utama analis '+(i+1),maxlength:'120',required:'',autocomplete:'off',spellcheck:'false'});
      const fallbackProvider=h('select',{'aria-label':'Provider fallback analis '+(i+1)},
        h('option',{value:'',text:'Nonaktif'}),
        ...data.providers.map(p=>{const x=providerHealth(p);return h('option',{value:p.provider,text:p.label+' · '+healthStatusText(x)});})
      );
      fallbackProvider.value=a.fallback?.provider||'';
      const fallbackModel=h('input',{value:a.fallback?.model||'','aria-label':'Model fallback analis '+(i+1),maxlength:'120',placeholder:'Model fallback',autocomplete:'off',spellcheck:'false'});
      const healthBadge=h('span',{class:'analyst-health'});
      const syncHealthBadge=()=>{
        const p=data.providers.find(p=>p.provider===provider.value),x=p?providerHealth(p):{state:'UNKNOWN'};
        healthBadge.className='analyst-health state-'+String(x.state||'UNKNOWN').toLowerCase();
        healthBadge.textContent=p?healthStatusText(x):'Unknown';
      };
      const syncFallback=()=>{
        for(const option of fallbackProvider.options)if(option.value)option.disabled=option.value===provider.value;
        if(fallbackProvider.value===provider.value){fallbackProvider.value='';fallbackModel.value='';}
        fallbackModel.disabled=!fallbackProvider.value;
        fallbackModel.required=!!fallbackProvider.value;
      };
      provider.addEventListener('change',()=>{
        const selected=data.providers.find(p=>p.provider===provider.value);
        if(selected)model.value=selected.default_model;
        syncFallback();syncHealthBadge();
      });
      fallbackProvider.addEventListener('change',()=>{
        const selected=data.providers.find(p=>p.provider===fallbackProvider.value);
        fallbackModel.value=selected?selected.default_model:'';
        syncFallback();
      });
      syncFallback();syncHealthBadge();
      const row=h('article',{class:'analyst-settings'},
        h('div',{class:'analyst-settings-head'},
          h('div',{},h('b',{text:groupLabels[Math.floor(i/2)]+' · '+(i%2+1)}),h('small',{text:a.id})),
          healthBadge
        ),
        field('Nama karakter',name),
        field('Provider utama',provider),
        field('Model utama',model),
        field('Provider fallback',fallbackProvider),
        field('Model fallback',fallbackModel),
        h('small',{class:'settings-help analyst-note',text:'Fallback dipakai oleh karakter yang sama hanya ketika provider/model utama gagal. Jumlah vote tetap satu.'})
      );
      team.append(row);
      fields.push(()=>{
        a.name=name.value;a.provider=provider.value;a.model=model.value;
        a.fallback=fallbackProvider.value?{provider:fallbackProvider.value,model:fallbackModel.value}:null;
      });
    });

    const automation=section('Cron dan Discord','Otomasi analisis dan pengiriman hasil yang sudah disetujui.',false);
    for(const [key,label] of [['cronEnabled','Pemeriksaan otomatis setiap 5 menit'],['discordEnabled','Kirim hasil yang disetujui ke Discord']]) {
      const cb=h('input',{type:'checkbox',checked:s[key]});
      automation.append(h('label',{class:'settings-toggle'},cb,h('span',{text:label})));fields.push(()=>{s[key]=cb.checked;});
    }
    const webhook=h('input',{type:'password',autocomplete:'new-password',placeholder:data.webhook_configured?'Webhook tersimpan · isi hanya untuk mengganti':'https://discord.com/api/webhooks/…','aria-label':'Webhook Discord',inputmode:'url',spellcheck:'false'});
    const clear=h('input',{type:'checkbox','aria-label':'Hapus webhook yang tersimpan'});
    automation.append(
      field('Webhook Discord',webhook,'Nilai tersimpan tetap tersembunyi. Kosongkan jika tidak ingin mengganti.'),
      h('label',{class:'settings-toggle danger-toggle'},clear,h('span',{text:'Hapus webhook yang tersimpan'}))
    );
    clear.addEventListener('change',()=>{webhook.disabled=clear.checked;if(clear.checked)webhook.value='';});
    webhook.addEventListener('input',()=>{if(webhook.value&&clear.checked){clear.checked=false;webhook.disabled=false;}});

    const validateUi=()=>{
      const invalid=[...wrap.querySelectorAll('input,select')].find(el=>!el.disabled&&!el.checkValidity());
      if(invalid){invalid.focus();invalid.reportValidity?.();return 'Lengkapi nilai yang belum valid.';}
      const f=s.calculation.frames;
      if(!(frameMs[f.trend]>frameMs[f.structure]&&frameMs[f.structure]>frameMs[f.trigger]))return 'Timeframe harus berurutan: tren > struktur > pemicu.';
      return '';
    };
    msg=h('p',{class:'settings-save-status',role:'status','aria-live':'polite',text:'Belum ada perubahan.'});
    save=h('button',{type:'button',class:'office-run settings-save',text:'Simpan pengaturan'});
    const actions=h('div',{class:'settings-actions'},msg,save);
    body.append(actions);
    const markDirty=()=>{
      if(!save)return;
      dirty=true;save.textContent='Simpan perubahan';msg.className='settings-save-status';msg.textContent='Perubahan belum disimpan.';
    };
    wrap.addEventListener('input',markDirty);
    wrap.addEventListener('change',markDirty);
    save.addEventListener('click',async()=>{
      fields.forEach(fn=>fn());
      const invalidMessage=validateUi();
      if(invalidMessage){msg.className='settings-save-status error';msg.textContent=invalidMessage;return;}
      save.disabled=true;msg.className='settings-save-status';msg.textContent='Menyimpan…';
      try {
        const d=await requestJson('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({settings:s,discord_webhook:webhook.value,clear_webhook:clear.checked})});
        dirty=false;webhook.value='';webhook.disabled=false;clear.checked=false;
        webhook.placeholder=d.webhook_configured?'Webhook tersimpan · isi hanya untuk mengganti':'https://discord.com/api/webhooks/…';
        msg.className='settings-save-status success';msg.textContent='Tersimpan. Berlaku pada candle berikutnya.';
        save.textContent='Tersimpan';
        try{if(onSaved)await onSaved();}catch{
          msg.className='settings-save-status warning';
          msg.textContent='Pengaturan sudah tersimpan, tetapi tampilan utama gagal dimuat ulang. Muat ulang halaman bila data belum berubah.';
        }
        setTimeout(()=>{if(save.isConnected&&!dirty){save.textContent='Simpan pengaturan';}},1200);
      }catch(e){
        msg.className='settings-save-status error';msg.textContent=e.message;
      }finally{save.disabled=false;}
    });
  }catch(e){
    body.replaceChildren(h('div',{class:'settings-error'},h('b',{text:'Pengaturan tidak dapat dimuat'}),h('p',{text:e.message}),h('button',{type:'button',class:'detail-close',text:'Tutup'})));
    body.querySelector('button')?.addEventListener('click',dismiss);
  }
}
