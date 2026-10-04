import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { server } from './preview-office.mjs';
import { candles } from '../tests/helpers/pipeline-db.js';
import { defaultSettings } from '../src/pipeline/config.js';
import { calculateSnapshot } from '../src/pipeline/calculate.js';

const output = process.env.OFFICE_TEST_OUTPUT || '/tmp/byga-office-qa';
await mkdir(output, { recursive:true });
const browser = await chromium.launch({
  headless:true,
  executablePath:process.env.CHROME_PATH || undefined,
  args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']
});
const providers = [{provider:'workers-ai',label:'Workers AI',configured:true,default_model:'@cf/test/default'}];
let settings=defaultSettings({AI:{run(){}}});
const market=(mode='up')=>({symbol:'BTCUSDT.P',series:Object.fromEntries(['H1','M15','M5'].map(tf=>[tf,candles(tf,250,mode)]))});
const snapshot=calculateSnapshot(market(),settings);
const result = {
  id:'TEST-OFFICE', created_at:'2026-10-04T15:00:00Z', majority_signal:'BUY', decision_reason:'MAJORITY',last_price:67890,duration_ms:1800,
  status:'approved',meeting:true,initial_direction:'BUY',snapshot,delivery:{state:'not_configured'},
  voting:{buy:4,sell:2,no_trade:0,total_models:6,success:6,support:4,approved:true},
  results:settings.analysts.map((a,i)=>({analyst_id:a.id,analyst_name:a.name,provider:a.provider,provider_label:'Workers AI',model:a.model,role:a.group,status:'success',signal:i<4?'BUY':'SELL',reason:'Respons uji integrasi — bukan analisis pasar live.',vote_index:i%2+1,duration_ms:500}))
};
let calls = [], mode = 'success';
const errors = [];
async function setup(viewport) {
  const page = await browser.newPage({viewport,deviceScaleFactor:1});
  page.setDefaultTimeout(60000);
  page.on('pageerror',e=>{errors.push(e.message);console.log('Browser error:',e.message);});
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if(path==='/api/settings') {
      if(request.method()==='PUT'){settings=request.postDataJSON().settings;return route.fulfill({json:{ok:true,settings,webhook_configured:false}});}
      return route.fulfill({json:{settings,providers,webhook_configured:false,cron:'*/5 * * * *'}});
    }
    if(path==='/api/market') return route.fulfill({json:{settings,market:market(mode==='neutral'?'flat':'up')}});
    if(path==='/api/status') return route.fulfill({json:{latest:null,discord:[]}});
    if(path==='/api/history') return route.fulfill({json:{items:[]}});
    if(path==='/api/analyze'){
      calls.push(request.postDataJSON());
      if(mode==='error')return route.fulfill({status:503,json:{error_code:'CHART_DATA_ERROR',error:'Data chart_db terlalu lama.'}});
      if(mode==='neutral')return route.fulfill({json:{...result,id:'TEST-NEUTRAL',status:'filtered',meeting:false,majority_signal:null,results:[],voting:{buy:0,sell:0,error:0,success:0,total_models:0,approved:false},snapshot:calculateSnapshot(market('flat'),settings)}});
      return route.fulfill({json:result});
    }
    return route.fulfill({json:{}});
  });
  await page.goto('http://localhost:'+(process.env.PORT||4173)+'/admin.html');
  await page.waitForFunction(()=>!!window.bygaOffice,{timeout:30000});
  await page.waitForFunction(()=>!document.querySelector('#analyze-btn').disabled,{timeout:60000});
  return page;
}
async function capture(page, filename) {
  // Exercise the existing background-tab pause while the software GPU flushes
  // a screenshot. Resume the same poses afterward; do not skip any movement.
  const poses = await page.evaluate(() => {
    Object.defineProperty(document,'hidden',{ configurable:true,get:()=>true });
    document.dispatchEvent(new Event('visibilitychange'));
    return window.bygaOffice.state.actors.map(a=>[a.x,a.z]);
  });
  try {
    const image = await page.screenshot({path:output+'/'+filename,timeout:120000});
    assert.deepEqual(await page.evaluate(()=>window.bygaOffice.state.actors.map(a=>[a.x,a.z])),poses);
    return image;
  } finally {
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }
}
async function phase(page, next, timeout=90000) {
  const trace=setInterval(async()=>{try{console.log('Waiting for',next,await page.evaluate(()=>window.bygaOffice.state))}catch{}},30000);
  try{await page.waitForFunction(p=>window.bygaOffice.state.phase===p,next,{timeout})}
  catch(error){console.log('State on failure:',await page.evaluate(()=>window.bygaOffice.state));throw error}
  finally{clearInterval(trace)}
}
try {
  const desktop = await setup({width:1440,height:1000});
  await desktop.selectOption('#quality','high');
  await desktop.waitForTimeout(1500);
  assert.equal(await desktop.evaluate(()=>window.bygaOffice.state.actors.length),9);
  assert.equal(await desktop.evaluate(()=>window.bygaOffice.state.cameraMode),'auto');
  const ambientStarted=await desktop.evaluate(()=>window.bygaOffice.triggerAmbient());
  assert.equal(ambientStarted,true);
  await desktop.waitForTimeout(900);
  assert.equal(await desktop.evaluate(()=>window.bygaOffice.state.ambientActive),true);
  assert((await desktop.evaluate(()=>window.bygaOffice.state.actors)).some(actor=>actor.path>0||!actor.arrived),'Ambient office event must move at least one participant');
  const screenshot=await capture(desktop,'desktop.png');
  const png=PNG.sync.read(screenshot),pixels=new Set();
  for(let y=png.height/2-24;y<png.height/2+24;y++)for(let x=png.width/2-24;x<png.width/2+24;x++){
    const i=(Math.floor(y)*png.width+Math.floor(x))*4;pixels.add(png.data.slice(i,i+3).join(','));
  }
  const colors=pixels.size;
  assert(colors>20,'3D scene must have nonblank canvas pixels');
  console.log('Desktop canvas colors:',colors,'State:',await desktop.evaluate(()=>({calls:window.bygaOffice.state.drawCalls,triangles:window.bygaOffice.state.triangles})));
  await desktop.click('[data-panel="providers"]');
  assert.equal(await desktop.locator('.office-providers .provider-option').count(),6);
  await desktop.click('#edit-analysts');
  await desktop.locator('[aria-label="Provider analis 1"]').waitFor();
  assert.equal(await desktop.locator('[aria-label^="Provider analis"]').count(),6);
  await desktop.fill('[aria-label="Model analis 1"]','@cf/test/custom-model');
  await desktop.getByRole('button',{name:'Simpan pengaturan',exact:true}).click();
  await desktop.waitForFunction(()=>document.querySelector('#pipeline-settings [role="status"]').textContent.includes('Tersimpan'));
  assert.equal(settings.analysts[0].model,'@cf/test/custom-model');
  assert.notEqual(settings.analysts[0].model,settings.analysts[1].model);
  await desktop.getByRole('button',{name:'Tutup',exact:true}).click();
  await desktop.click('#panel-close');
  assert.equal(await desktop.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await desktop.close();

  const mobile = await setup({width:390,height:844});
  await mobile.selectOption('#quality','low');
  await mobile.waitForTimeout(800);
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const canvasBox=await mobile.locator('#office-canvas canvas').boundingBox();
  assert(canvasBox.width>300 && canvasBox.height>400);
  await capture(mobile,'mobile.png');
  const before=await mobile.evaluate(()=>window.bygaOffice.state.actors.map(a=>[a.x,a.z]));
  await mobile.click('#analyze-btn');
  console.log('Mobile analysis started.');
  await phase(mobile,'gathering');
  assert.equal(calls.length,1);
  assert.deepEqual(Object.keys(calls[0].candle_times),['H1','M15','M5']);
  await mobile.waitForTimeout(2000);
  const moving=await mobile.evaluate(()=>window.bygaOffice.state.actors.map(a=>[a.x,a.z]));
  assert(moving.some((position,i)=>Math.hypot(position[0]-before[i][0],position[1]-before[i][1])>.1),'Characters must walk');
  assert.equal(await mobile.locator('#analyze-btn').isDisabled(),true);
  await phase(mobile,'discussing');
  const gathered=await mobile.evaluate(()=>window.bygaOffice.state);
  assert(gathered.actors.filter(a=>a.id<6||a.id===8).every(a=>a.arrived&&a.sitting>.95),'Six analysts and boss must sit before discussion');
  assert.deepEqual(gathered.actors.filter(a=>a.id===6||a.id===7).map(a=>[a.x,a.z]),before.slice(6,8),'Two support staff stay at their desks');
  assert.equal(await mobile.locator('#consensus').textContent(),'BUY');
  await mobile.waitForTimeout(1600);
  await capture(mobile,'meeting.png');
  assert.equal(await mobile.locator('.office-speech').isVisible(),true);
  console.log('Meeting: all analysts and boss seated, actual API result shown.');
  await phase(mobile,'returning');
  await phase(mobile,'idle');
  assert.equal(await mobile.locator('#analyze-btn').isDisabled(),false);
  const home=await mobile.evaluate(()=>window.bygaOffice.state.actors.map(a=>[a.x,a.z]));
  assert.deepEqual(home,before);
  console.log('Return: all nine participants returned to their desks.');

  mode='error';
  await mobile.click('#analyze-btn');
  await mobile.waitForFunction(()=>document.querySelector('#run-message').textContent.includes('terlalu lama'));
  assert.equal(await mobile.evaluate(()=>window.bygaOffice.state.phase),'idle');
  assert.equal(await mobile.locator('#analyze-btn').isDisabled(),false);
  mode='neutral';
  const generation=await mobile.evaluate(()=>window.bygaOffice.state.generation);
  await mobile.click('#analyze-btn');
  await mobile.waitForFunction(()=>document.querySelector('#run-message').textContent.includes('Analis tetap di meja'));
  assert.equal(await mobile.evaluate(()=>window.bygaOffice.state.generation),generation,'Neutral calculation must not start a meeting');
  await mobile.selectOption('#quality','medium');
  await mobile.reload();
  await mobile.waitForFunction(()=>!!window.bygaOffice);
  assert.equal(await mobile.locator('#quality').inputValue(),'medium');
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await mobile.close();
  assert.deepEqual(errors,[]);
  console.log('PASS: desktop/mobile, per-character shared provider settings, deterministic browser calculation, six-analyst meeting, neutral/error gates, return, quality persistence.');
} finally {
  await browser.close(); server.close();
}
