// Browser regression for no-gate manual analysis while cron status polling
// continues. Render the actual app bundle/DOM while stubbing only 3D movement
// (full walking/meeting choreography is verified in verify-office.mjs).
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {server} from './preview-office.mjs';
import {defaultSettings} from '../src/pipeline/config.js';
import {calculateSnapshot} from '../src/pipeline/calculate.js';
import {candles} from '../tests/helpers/pipeline-db.js';

const settings=defaultSettings({AI:{run(){}}});
const market={symbol:'BTCUSDT.P',series:Object.fromEntries(['H1','M15','M5'].map(tf=>[tf,candles(tf,250,'flat')]))};
const snapshot=calculateSnapshot(market,settings);
assert.equal(snapshot.gate.meeting,false,'Fixture must not pass the deterministic auto gate');

let latest=null,polls=0,manuals=0;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined,args:['--no-sandbox']});
try {
  const page=await browser.newPage();
  await page.addInitScript(()=>{const original=window.setInterval;window.setInterval=(fn,ms,...args)=>original(fn,ms===30000?250:ms,...args);});
  await page.route('**/office.bundle.js',r=>r.fulfill({contentType:'text/javascript',body:`window.mockMeetings=0;window.bygaOffice={busy:false,state:{phase:'idle'},async beginMeeting(){window.mockMeetings++;this.busy=true;},async discuss(){this.busy=false;window.dispatchEvent(new Event('office:idle'));}};window.dispatchEvent(new Event('office:ready'));`}));
  await page.route('**/api/**',r=>{
    const path=new URL(r.request().url()).pathname;
    if(path==='/api/settings')return r.fulfill({json:{settings,providers:[{provider:'workers-ai',label:'Workers AI',configured:true}],webhook_configured:false}});
    if(path==='/api/market')return r.fulfill({json:{settings,market}});
    if(path==='/api/status'){polls++;return r.fulfill({json:{latest:latest?{state:'completed',result:latest}:null,discord:[]}});}
    if(path==='/api/analyze'){
      manuals++;
      return r.fulfill({json:{
        id:'MANUAL-1',created_at:new Date().toISOString(),status:'manual_review',mode:'manual',
        meeting:true,gate_passed:false,initial_direction:'NEUTRAL',deterministic_direction:'NEUTRAL',
        majority_signal:'BUY',snapshot,results:[],
        voting:{approved:false,support:4,buy:4,sell:2,total_models:6,success:6,weighted_share_pct:66.67},
        delivery:{state:'idle',eligible:false,reason:'MANUAL_WITHOUT_DETERMINISTIC_GATE'}
      }});
    }
    return r.fulfill({json:{items:[]}});
  });

  const initialStatus=page.waitForResponse('**/api/status');
  await page.goto('http://localhost:'+(process.env.PORT||4173)+'/admin.html');
  await initialStatus;
  await page.waitForFunction(()=>!document.querySelector('#analyze-btn').disabled);
  assert(polls>0,'Initial cron status must be loaded');

  await page.click('#analyze-btn');
  await page.waitForFunction(()=>window.mockMeetings===1);
  await page.waitForFunction(()=>document.querySelector('#result-status').textContent==='MANUAL REVIEW');
  assert.equal(manuals,1,'Manual analysis must run even when deterministic consensus is absent');
  assert.match(await page.locator('#discord-status').textContent(),/tidak dikirim/);

  latest={
    id:'CRON-FILTERED',created_at:new Date().toISOString(),status:'filtered',mode:'auto',
    meeting:false,gate_passed:false,initial_direction:'NEUTRAL',deterministic_direction:'NEUTRAL',
    majority_signal:null,snapshot,results:[],
    voting:{approved:false,support:0,buy:0,sell:0,total_models:0,success:0,weighted_share_pct:0},
    delivery:{state:'idle',eligible:false,reason:'DECISION_NOT_APPROVED'}
  };
  await page.waitForFunction(()=>document.querySelector('#result-status').textContent==='TERSARING');
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>window.mockMeetings),1,'Filtered cron result must not replay or suppress the manual meeting');
  assert.equal(manuals,1,'Cron status polling must not call manual analysis again');
  console.log('PASS: no-gate manual analysis runs independently while filtered cron polling continues.');
}finally{await browser.close();server.close();}
