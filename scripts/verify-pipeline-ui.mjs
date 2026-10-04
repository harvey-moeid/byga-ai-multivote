// Browser regression for a manual request racing a running cron. Render the
// actual app bundle/DOM while stubbing only 3D movement (verified separately).
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {server} from './preview-office.mjs';
import {defaultSettings} from '../src/pipeline/config.js';
import {calculateSnapshot} from '../src/pipeline/calculate.js';
import {candles} from '../tests/helpers/pipeline-db.js';
const settings=defaultSettings({AI:{run(){}}});
const market={symbol:'BTCUSDT.P',series:Object.fromEntries(['H1','M15','M5'].map(tf=>[tf,candles(tf)]))};
const snapshot=calculateSnapshot(market,settings);
let latest=null,polls=0,manuals=0;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined,args:['--no-sandbox']});
try {
  const page=await browser.newPage();
  // Speed only the API polling interval, never requestAnimationFrame or walking.
  await page.addInitScript(()=>{const original=window.setInterval;window.setInterval=(fn,ms,...args)=>original(fn,ms===30000?250:ms,...args);});
  await page.route('**/office.bundle.js',r=>r.fulfill({contentType:'text/javascript',body:`window.mockMeetings=0;window.bygaOffice={busy:false,state:{phase:'idle'},async beginMeeting(){window.mockMeetings++;this.busy=true;},async discuss(){this.busy=false;window.dispatchEvent(new Event('office:idle'));}};window.dispatchEvent(new Event('office:ready'));`}));
  await page.route('**/api/**',r=>{
    const path=new URL(r.request().url()).pathname;
    if(path==='/api/settings')return r.fulfill({json:{settings,providers:[{provider:'workers-ai',label:'Workers AI',configured:true}],webhook_configured:false}});
    if(path==='/api/market')return r.fulfill({json:{settings,market}});
    if(path==='/api/status'){polls++;return r.fulfill({json:{latest:latest?{state:'completed',result:latest}:null,discord:[]}});}
    if(path==='/api/analyze'){manuals++;return r.fulfill({json:{id:'RUNNING-CRON',status:'running',meeting:false,duplicate:true}});}
    return r.fulfill({json:{items:[]}});
  });
  const initialStatus=page.waitForResponse('**/api/status');
  await page.goto('http://localhost:'+(process.env.PORT||4173));
  await initialStatus;
  await page.waitForFunction(()=>!document.querySelector('#analyze-btn').disabled);
  assert(polls>0,'Initial cron status must be loaded');
  await page.click('#analyze-btn');
  await page.waitForFunction(()=>document.querySelector('#run-message').textContent.includes('sedang diproses cron'));
  assert.equal(await page.evaluate(()=>window.mockMeetings),0);
  latest={id:'RUNNING-CRON',created_at:new Date().toISOString(),status:'approved',meeting:true,initial_direction:'BUY',majority_signal:'BUY',snapshot,results:[],voting:{approved:true,support:4,buy:4,sell:2,total_models:6,success:6},delivery:{state:'sent'}};
  await page.waitForFunction(()=>window.mockMeetings===1);
  await page.waitForFunction(()=>document.querySelector('#consensus').textContent==='BUY');
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(()=>window.mockMeetings),1,'Repeated polls must not replay the same meeting');
  assert.equal(manuals,1,'Polling completed cron results must not call AI again');
  assert.match(await page.locator('#discord-status').textContent(),/terkirim/);
  console.log('PASS: a manual/cron race displays and animates the completed result exactly once.');
}finally{await browser.close();server.close();}
