import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {server} from './preview-office.mjs';
import {defaultSettings} from '../src/pipeline/config.js';
import {candles} from '../tests/helpers/pipeline-db.js';

let settings=defaultSettings({AI:{run(){}}});
const market={symbol:'BTCUSDT.P',series:Object.fromEntries(['H1','M15','M5'].map(tf=>[tf,candles(tf,250,'flat')]))};
const providers=[
  {provider:'workers-ai',label:'Workers AI',configured:true,default_model:'@cf/meta/llama-3.3-70b-instruct-fp8-fast'},
  {provider:'groq',label:'Groq',configured:true,default_model:'openai/gpt-oss-120b'},
  {provider:'openrouter',label:'OpenRouter',configured:false,default_model:'nvidia/nemotron-3-super-120b-a12b:free'}
];
const provider_health=[
  {provider:'workers-ai',state:'HEALTHY',samples:8,success_rate_pct:100,avg_latency_ms:620,last_checked_at:new Date().toISOString(),last_error_code:null},
  {provider:'groq',state:'READY',samples:0,success_rate_pct:null,avg_latency_ms:null,last_checked_at:null,last_error_code:null},
  {provider:'openrouter',state:'NOT_CONFIGURED',samples:0,success_rate_pct:null,avg_latency_ms:null,last_checked_at:null,last_error_code:'MISSING_API_KEY'}
];

const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined,args:['--no-sandbox']});
try{
  const page=await browser.newPage({viewport:{width:360,height:780}});
  await page.route('**/office.bundle.js',r=>r.fulfill({contentType:'text/javascript',body:`window.bygaOffice={busy:false,state:{phase:'idle'},async beginMeeting(){},async discuss(){}};window.dispatchEvent(new Event('office:ready'));`}));
  await page.route('**/api/**',async r=>{
    const request=r.request(),path=new URL(request.url()).pathname;
    if(path==='/api/settings'&&request.method()==='GET')return r.fulfill({json:{settings,providers,provider_health,webhook_configured:true,cron:'*/5 * * * *'}});
    if(path==='/api/settings'&&request.method()==='PUT'){
      const body=request.postDataJSON();
      settings=body.settings;
      return r.fulfill({json:{ok:true,settings,webhook_configured:!body.clear_webhook}});
    }
    if(path==='/api/market')return r.fulfill({json:{settings,market}});
    if(path==='/api/status')return r.fulfill({json:{latest:null,discord:[]}});
    if(path==='/api/history')return r.fulfill({json:{items:[]}});
    return r.fulfill({status:404,json:{error:'not found'}});
  });

  await page.goto('http://localhost:'+(process.env.PORT||4173)+'/admin.html');
  await page.waitForFunction(()=>!document.querySelector('#analyze-btn').disabled);
  await page.click('#settings-btn');
  await page.waitForSelector('#pipeline-settings');

  assert.equal(await page.locator('.analyst-settings').count(),8,'Settings must render all eight analyst cards');
  assert.equal(await page.locator('.provider-health-card').count(),3,'Provider Health must render every provider');
  assert.equal(await page.locator('.analyst-settings .settings-field-label').count(),40,'Every analyst control must have a visible label');
  assert.equal(await page.locator('.settings-section[open]').count(),2,'Only the two primary settings sections should start expanded');

  const geometry=await page.evaluate(()=>{
    const card=document.querySelector('.pipeline-settings-card').getBoundingClientRect();
    return {viewport:innerWidth,cardLeft:card.left,cardRight:card.right,bodyWidth:document.documentElement.scrollWidth};
  });
  assert(geometry.cardLeft>=0&&geometry.cardRight<=geometry.viewport+1,'Settings card must stay inside the mobile viewport');
  assert(geometry.bodyWidth<=geometry.viewport+1,'Settings must not cause horizontal page overflow');

  const firstName=page.locator('.analyst-settings input[aria-label^="Nama analis"]').first();
  await firstName.fill('SMC Lead');
  assert.match(await page.locator('.settings-save-status').textContent(),/belum disimpan/i);

  const put=page.waitForRequest(req=>new URL(req.url()).pathname==='/api/settings'&&req.method()==='PUT');
  await page.click('.settings-save');
  const request=await put;
  const payload=request.postDataJSON();
  assert.equal(payload.settings.analysts[0].name,'SMC Lead','Edited analyst name must be sent to Settings API');
  await page.waitForFunction(()=>/Tersimpan|Pengaturan sudah tersimpan/.test(document.querySelector('.settings-save-status').textContent));
  await page.waitForFunction(()=>!document.querySelector('.settings-save').disabled,null,{timeout:10000});
  assert.equal(await page.locator('.settings-save').isDisabled(),false,'Save button must recover after successful save');

  console.log('PASS: settings UI is mobile-safe, labelled, health-aware, and saves the full analyst configuration.');
}finally{
  await browser.close();
  server.close();
}
