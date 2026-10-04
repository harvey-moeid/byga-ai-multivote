import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { server } from './preview-office.mjs';

const output = process.env.OFFICE_TEST_OUTPUT || '/tmp/byga-office-qa';
await mkdir(output, { recursive:true });
const browser = await chromium.launch({
  headless:true,
  executablePath:process.env.CHROME_PATH || undefined,
  args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']
});
const providers = ['google-gemini','groq','openrouter','mistral','huggingface','cohere','nvidia'].map(provider => ({ provider,label:provider,enabled:true,key_configured:true,model:'test-model' }));
const result = {
  id:'TEST-OFFICE', created_at:'2026-10-04T15:00:00Z', majority_signal:'BUY', decision_reason:'MAJORITY',last_price:67890,duration_ms:1800,
  voting:{buy:8,sell:4,no_trade:0,total_models:12,success:12},
  results:Array.from({length:12},(_,i)=>({provider:providers[i%6].provider,provider_label:providers[i%6].label,status:'success',signal:i<8?'BUY':'SELL',reason:'Respons uji integrasi — bukan analisis pasar live.',vote_index:i<6?1:2,duration_ms:500}))
};
let calls = [], mode = 'success';
const errors = [];
async function setup(viewport) {
  const page = await browser.newPage({viewport,deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if(path==='/api/models') return route.fulfill({json:{items:providers}});
    if(path==='/api/history') return route.fulfill({json:{items:[]}});
    if(path==='/api/analyze'){
      calls.push(request.postDataJSON());
      return mode==='success' ? route.fulfill({json:result}) : route.fulfill({status:429,json:{error_code:'COOLDOWN_ACTIVE',retry_after_seconds:60}});
    }
    return route.fulfill({json:{}});
  });
  await page.goto('http://localhost:'+(process.env.PORT||4173));
  await page.waitForFunction(()=>!!window.bygaOffice,{timeout:30000});
  return page;
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
  const screenshot=await desktop.screenshot({path:output+'/desktop.png'});
  const png=PNG.sync.read(screenshot),pixels=new Set();
  for(let y=png.height/2-24;y<png.height/2+24;y++)for(let x=png.width/2-24;x<png.width/2+24;x++){
    const i=(Math.floor(y)*png.width+Math.floor(x))*4;pixels.add(png.data.slice(i,i+3).join(','));
  }
  const colors=pixels.size;
  assert(colors>20,'3D scene must have nonblank canvas pixels');
  console.log('Desktop canvas colors:',colors,'State:',await desktop.evaluate(()=>({calls:window.bygaOffice.state.drawCalls,triangles:window.bygaOffice.state.triangles})));
  await desktop.click('[data-panel="providers"]');
  assert.equal(await desktop.locator('.office-providers input:checked').count(),6);
  await desktop.locator('.office-providers input').last().click();
  assert.equal(await desktop.locator('.office-providers input:checked').count(),6);
  await desktop.click('#panel-close');
  assert.equal(await desktop.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await desktop.close();

  const mobile = await setup({width:390,height:844});
  await mobile.selectOption('#quality','low');
  await mobile.waitForTimeout(800);
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const canvasBox=await mobile.locator('#office-canvas canvas').boundingBox();
  assert(canvasBox.width>300 && canvasBox.height>400);
  await mobile.screenshot({path:output+'/mobile.png'});
  const before=await mobile.evaluate(()=>window.bygaOffice.state.actors.map(a=>[a.x,a.z]));
  await mobile.click('#analyze-btn');
  console.log('Mobile analysis started.');
  await phase(mobile,'gathering');
  assert.equal(calls.length,1);
  assert.equal(calls[0].models.length,6);
  await mobile.waitForTimeout(2000);
  const moving=await mobile.evaluate(()=>window.bygaOffice.state.actors.map(a=>[a.x,a.z]));
  assert(moving.some((position,i)=>Math.hypot(position[0]-before[i][0],position[1]-before[i][1])>.1),'Characters must walk');
  assert.equal(await mobile.locator('#analyze-btn').isDisabled(),true);
  await phase(mobile,'discussing');
  const gathered=await mobile.evaluate(()=>window.bygaOffice.state);
  assert(gathered.actors.every(a=>a.arrived&&a.sitting>.95),'All nine participants must sit before discussion');
  assert.equal(await mobile.locator('#consensus').textContent(),'BUY');
  await mobile.waitForTimeout(1600);
  await mobile.screenshot({path:output+'/meeting.png'});
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
  await phase(mobile,'discussing');
  assert.match(await mobile.locator('#run-message').textContent(),/60 detik/);
  await phase(mobile,'idle');
  assert.equal(await mobile.locator('#analyze-btn').isDisabled(),false);
  await mobile.selectOption('#quality','medium');
  await mobile.reload();
  await mobile.waitForFunction(()=>!!window.bygaOffice);
  assert.equal(await mobile.locator('#quality').inputValue(),'medium');
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await mobile.close();
  assert.deepEqual(errors,[]);
  console.log('PASS: desktop/mobile, provider selection, walk/meeting/return, API error recovery, quality persistence.');
} finally {
  await browser.close(); server.close();
}
