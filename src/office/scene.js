import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildOffice, updateScreens } from './assets.js';
import { createCharacter, updateCharacter } from './character.js';
import { TEAM, QUALITY, initialQuality, adaptiveQuality, meetingRoute, returnRoute, ambientRoute, advanceActors } from './choreography.js';

const $ = id => document.getElementById(id);
const container = $('office-canvas');
const choice = $('quality');
const phaseCopy = {
  idle:['Analis di meja kerja', 'Siap untuk meeting berikutnya'],
  gathering:['Menuju ruang meeting', 'Seluruh analis dan bos sedang berkumpul'],
  waiting:['Meeting berlangsung', 'Menunggu respons provider AI'],
  discussing:['Pembahasan hasil', 'Vote dan alasan dari respons AI'],
  returning:['Kembali ke meja kerja', 'Meeting selesai']
};
let renderer, controls, scene, camera, actors, office, raf, observer;
let phase = 'idle', generation = 0, resolveGather, qualityMode = 'auto', level = 'medium', dynamicScale = 1, stableWindows = 0;
let lastFrame = 0, lastDraw = 0, windowStart = 0, samples = [], frameAverage = 0;
let hidden = document.hidden, speaking = null, speechUntil = 0, speechQueue = [], queueIndex = 0, discussionDone;
let cameraMotion = null, ready = false, contextLost = false;
let cameraMode = 'auto', autoCameraAngle = Math.atan2(22.1,14.5), autoCameraBob = 0;
const AMBIENT_INTERVAL_MS = 5 * 60 * 1000;
let ambientNextAt = performance.now() + AMBIENT_INTERVAL_MS, ambientRemaining = AMBIENT_INTERVAL_MS, ambientBatch = null;
const speech = document.createElement('div');
speech.className = 'office-speech'; speech.hidden = true; $('speech-layer').append(speech);
const projected = new THREE.Vector3(), speakerPosition = new THREE.Vector3();
const participant = actor => actor.member.boss || actor.member.id < 8;

function status(next) {
  phase = next;
  $('phase-title').textContent = phaseCopy[next][0];
  $('phase-subtitle').textContent = phaseCopy[next][1];
  window.dispatchEvent(new CustomEvent('office:phase', { detail:next }));
}
function setQuality(mode, persist = true) {
  qualityMode = Object.hasOwn(QUALITY, mode) || mode === 'auto' ? mode : 'auto';
  dynamicScale = 1; stableWindows = 0;
  if (qualityMode !== 'auto') level = qualityMode;
  else level = initialQuality({
    width:container.clientWidth,
    memory:navigator.deviceMemory,
    cores:navigator.hardwareConcurrency,
    dpr:window.devicePixelRatio || 1,
    saveData:navigator.connection?.saveData === true
  });
  choice.value = qualityMode;
  if (persist) try { localStorage.setItem('byga-office-quality', qualityMode); } catch { /* Storage may be unavailable in private browsers. */ }
  applyQuality();
}
function applyQuality() {
  if (!renderer) return;
  const q = QUALITY[level];
  const dpr = Math.min(window.devicePixelRatio || 1, q.maxDpr || 2);
  const scale = q.scale * (qualityMode === 'auto' ? dynamicScale : 1);
  renderer.setPixelRatio(Math.max(.5, dpr * scale));
  renderer.shadowMap.enabled = q.shadows;
  const nextShadowType = q.shadowType === 'soft' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  if (renderer.shadowMap.type !== nextShadowType) {
    renderer.shadowMap.type = nextShadowType;
    scene.traverse(object => {
      for (const mat of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (mat) mat.needsUpdate = true;
      }
    });
  }
  let lampIndex = 0;
  scene.traverse(object => { if(object.isPointLight) object.visible = lampIndex++ < q.lights; });
  const sun = scene.getObjectByName('sun');
  if (sun) {
    sun.castShadow = q.shadows;
    sun.shadow.mapSize.set(q.mapSize, q.mapSize);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  renderer.shadowMap.needsUpdate = true;
  const scalePct = Math.round(scale * 100);
  $('render-info').textContent = qualityMode === 'auto' ? 'AUTO ' + level.toUpperCase() + ' · ' + scalePct + '%' : scalePct + '%';
  samples = []; windowStart = performance.now();
  resize();
}
function resize() {
  if (!renderer || !camera) return;
  const width = container.clientWidth, height = container.clientHeight;
  if (!width || !height) return;
  const aspect = width / height;
  const vertical = Math.max(8.8, 10.8 / aspect);
  camera.left = -vertical * aspect; camera.right = vertical * aspect;
  camera.top = vertical; camera.bottom = -vertical;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
function setCameraMode(mode) {
  cameraMode = mode === 'manual' ? 'manual' : 'auto';
  const button = $('auto-camera');
  if (button) {
    button.setAttribute('aria-pressed', String(cameraMode === 'auto'));
    button.classList.toggle('active', cameraMode === 'auto');
  }
  if (cameraMode === 'auto' && camera && controls) {
    autoCameraAngle = Math.atan2(camera.position.z - controls.target.z, camera.position.x - controls.target.x);
  }
}
function cameraView(view = 'office', manual = false) {
  if (manual) setCameraMode('manual');
  const target = view === 'meeting' ? new THREE.Vector3(4.0, .75, -3.2) : new THREE.Vector3(0, .4, .1);
  const offset = new THREE.Vector3(14.5, 18, 22);
  const zoom = view === 'meeting' ? (container.clientWidth < 600 ? 1.85 : 2.25) : 1;
  cameraMotion = { from:camera.position.clone(), to:target.clone().add(offset), targetFrom:controls.target.clone(), targetTo:target, zoomFrom:camera.zoom, zoomTo:zoom, elapsed:0 };
}
function say(id, name, text, seconds = 4) {
  speaking = id; speechUntil = performance.now() + seconds * 1000;
  speech.replaceChildren();
  const title = document.createElement('b'); title.textContent = name;
  const content = document.createElement('span'); content.textContent = String(text).slice(0, 210);
  speech.append(title, content); speech.hidden = false;
}
function setRoute(actor, path, delay, angle, sitOnArrival = 1) {
  actor.path = path.map(([x,z]) => new THREE.Vector3(x, .015, z));
  actor.delay = delay; actor.targetSit = 0; actor.walking = false;
  actor.arrived = false; actor.destinationAngle = angle; actor.sitOnArrival = sitOnArrival;
}
function actorName(actor) {
  return actor.member.boss ? 'Bos' : 'Analis ' + (actor.member.id + 1);
}
function resetAmbientClock(now = performance.now(), delay = AMBIENT_INTERVAL_MS) {
  ambientRemaining = delay;
  ambientNextAt = now + delay;
}
function pauseAmbientClock(now = performance.now()) {
  ambientRemaining = Number.isFinite(ambientNextAt) ? Math.max(1000, ambientNextAt - now) : AMBIENT_INTERVAL_MS;
  ambientNextAt = Infinity;
  ambientBatch = null;
}
function resumeAmbientClock(now = performance.now()) {
  ambientNextAt = now + Math.max(1000, ambientRemaining || AMBIENT_INTERVAL_MS);
}
function startAmbientEvent(now = performance.now()) {
  if (!ready || phase !== 'idle' || ambientBatch) return false;
  const pool = actors.filter(participant).sort(() => Math.random() - .5);
  const count = Math.min(pool.length, 1 + Math.floor(Math.random() * 3));
  const selected = pool.slice(0, count);
  const stationaryAnalysts=actors.filter(actor=>!actor.member.boss && !selected.includes(actor));
  const allAnalysts=actors.filter(actor=>!actor.member.boss);
  const visitPool=stationaryAnalysts.length ? stationaryAnalysts : allAnalysts;
  const bossVisitTarget=visitPool[Math.floor(Math.random()*visitPool.length)] || null;
  selected.forEach((actor, index) => {
    const preferred = actor.member.boss ? index : actor.member.id % 2;
    const variant = Math.random() < .72 ? preferred : Math.floor(Math.random() * 4);
    const target=actor.member.boss && Math.abs(variant)%4===0 ? bossVisitTarget?.member : null;
    actor.ambientPlan = ambientRoute(actor.member, variant, target);
    setRoute(actor, actor.ambientPlan.path, index * .32, actor.ambientPlan.angle, 0);
  });
  ambientBatch = { actors:selected, stage:'out', dwellUntil:0 };
  resetAmbientClock(now);
  const first = selected[0];
  say(first.member.id, actorName(first), first.ambientPlan.label, 3.5);
  window.dispatchEvent(new CustomEvent('office:activity',{detail:selected.map(actor=>({id:actor.member.id,activity:actor.ambientPlan.label}))}));
  return true;
}
function updateAmbient(now) {
  if (phase !== 'idle') return;
  if (!ambientBatch && now >= ambientNextAt) startAmbientEvent(now);
  if (!ambientBatch) return;
  if (ambientBatch.stage === 'out' && ambientBatch.actors.every(actor => actor.arrived)) {
    if (!ambientBatch.dwellUntil) {
      ambientBatch.dwellUntil = now + 3500;
      const first = ambientBatch.actors[0];
      say(first.member.id, actorName(first), first.ambientPlan.label, 3.5);
    } else if (now >= ambientBatch.dwellUntil) {
      ambientBatch.stage = 'back';
      ambientBatch.actors.forEach((actor,index)=>setRoute(actor, actor.ambientPlan.back, index * .22, actor.member.homeAngle, 1));
    }
  } else if (ambientBatch.stage === 'back' && ambientBatch.actors.every(actor => actor.arrived && actor.sit > .97)) {
    ambientBatch = null;
  }
}
function beginMeeting() {
  if (!ready || phase !== 'idle') return Promise.reject(new Error('Kantor belum siap untuk meeting.'));
  generation++;
  pauseAmbientClock();
  status('gathering'); speech.hidden = true; speaking = null;
  updateScreens(office.screens, null, 'MEETING');
  actors.filter(participant).forEach((actor, index) => setRoute(actor, meetingRoute(actor.member), index * .45, actor.member.seatAngle));
  return new Promise(resolve => { resolveGather = resolve; });
}
function discuss(data, error) {
  status('discussing');
  cameraView('meeting');
  updateScreens(office.screens, data, error ? 'ERROR' : 'READY');
  const results = Array.isArray(data?.results) ? data.results : [];
  const voteTotal=data?.voting?.total_models||8,voteRequired=data?.voting?.required||4;
  speechQueue = error ? [{ id:8, name:'Bos', text:error, seconds:5 }] : [
    { id:8, name:'Bos', text:'Respons AI sudah diterima. Kita tinjau vote dan alasannya.', seconds:3 },
    ...results.map((r, index) => ({
      id:Math.max(0,Math.min(7,['smc_ict_1','smc_ict_2','indicators_1','indicators_2','volume_1','volume_2','derivatives_1','derivatives_2'].indexOf(r.analyst_id))), name:r.analyst_name || r.provider_label || r.provider || 'Analis',
      text:r.status === 'success' ? [r.signal, r.reason || 'Vote diterima.'].filter(Boolean).join(' · ') : 'Respons gagal: ' + (r.error || r.error_code || r.status),
      seconds:4
    })),
    { id:8, name:'Bos', text:data?.voting?.approved ? 'Disetujui: '+data.majority_signal+'. '+data.voting.support+'/'+voteTotal+' mendukung arah awal. Discord mengikuti pengaturan.' : 'Dukungan '+(data?.voting?.support||0)+'/'+voteTotal+'. Syarat minimal '+voteRequired+' vote searah belum terpenuhi; tidak dikirim ke Discord.', seconds:5 }
  ];
  queueIndex = 0; speechUntil = 0; speech.hidden = true; speaking = null;
  return new Promise(resolve => { discussionDone = resolve; });
}
function discussPublic(data) {
  status('discussing');
  cameraView('meeting');
  updateScreens(office.screens, null, 'MEETING');
  const signal = ['BUY','SELL'].includes(data?.signal) ? data.signal : '—';
  speechQueue = [
    { id:8, name:'Bos', text:'Meeting dimulai. Tim meninjau hasil analisis terbaru.', seconds:3 },
    { id:0, name:'Analis 1', text:'Memeriksa struktur market dan area penting.', seconds:3 },
    { id:2, name:'Analis 3', text:'Membandingkan indikator lintas timeframe.', seconds:3 },
    { id:4, name:'Analis 5', text:'Meninjau volume dan kekuatan pergerakan.', seconds:3 },
    { id:6, name:'Analis 7', text:'Meninjau open interest, funding, positioning, dan liquidation.', seconds:3 },
    { id:8, name:'Bos', text:'Hasil terbaru: '+signal+'.', seconds:4 }
  ];
  queueIndex = 0; speechUntil = 0; speech.hidden = true; speaking = null;
  return new Promise(resolve => { discussionDone = resolve; });
}
function goHome() {
  speech.hidden = true; speaking = null;
  status('returning'); cameraView('office');
  actors.filter(participant).forEach((actor, index) => setRoute(actor, returnRoute(actor.member), (8 - index) * .5, actor.member.homeAngle));
}
function updateSpeech(now) {
  if (phase === 'discussing' && now >= speechUntil) {
    const next = speechQueue[queueIndex++];
    if (next) say(next.id, next.name, next.text, next.seconds);
    else { const done = discussionDone; discussionDone = null; goHome(); done?.(); }
  } else if (phase !== 'discussing' && now >= speechUntil) { speech.hidden = true; speaking = null; }
  if (speech.hidden || speaking == null) return;
  actors[speaking].root.getWorldPosition(speakerPosition);
  speakerPosition.y = 2.05;
  projected.copy(speakerPosition).project(camera);
  if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1.2 || Math.abs(projected.y) > 1.2) { speech.style.visibility = 'hidden'; return; }
  speech.style.visibility = 'visible';
  const width = container.clientWidth, height = container.clientHeight, half = Math.min(speech.offsetWidth / 2 + 8, width / 2);
  speech.style.left = THREE.MathUtils.clamp((projected.x + 1) * width / 2, half, width - half) + 'px';
  speech.style.top = THREE.MathUtils.clamp((1 - projected.y) * height / 2, speech.offsetHeight + 16, height - 25) + 'px';
}
function tick(now) {
  raf = requestAnimationFrame(tick);
  if (hidden || contextLost) { lastFrame = now; lastDraw = now; return; }
  const interval = 1000 / QUALITY[level].fps;
  if (now - lastDraw < interval - 1) return;
  const rawDt = lastFrame ? now - lastFrame : interval;
  const dt = Math.min(rawDt / 1000, .25);
  lastFrame = now; lastDraw = now;
  const steps = Math.max(1, Math.ceil(dt * 60));
  for (let step = 0; step < steps; step++) {
    advanceActors(actors, dt / steps);
    for (const actor of actors) updateCharacter(actor, dt / steps, now / 1000, actor.member.id === speaking);
  }
  for (const door of office.doors) {
    const near = actors.some(a => a.path.length && Math.hypot(a.root.position.x - door.x, a.root.position.z - door.z) < 1.45);
    door.hinge.rotation.y = THREE.MathUtils.damp(door.hinge.rotation.y, near ? -Math.PI * .49 : 0, 5, dt);
  }
  updateAmbient(now);
  if (cameraMode === 'auto' && !cameraMotion && phase === 'idle') {
    autoCameraAngle += dt * .035;
    autoCameraBob += dt * .18;
    const target = new THREE.Vector3(0,.4,.1);
    const radius = container.clientWidth < 600 ? 25 : 26.5;
    camera.position.set(target.x + Math.cos(autoCameraAngle) * radius, 18.2 + Math.sin(autoCameraBob) * .65, target.z + Math.sin(autoCameraAngle) * radius);
    controls.target.lerp(target, 1 - Math.exp(-dt * 2));
  }
  if (cameraMotion) {
    cameraMotion.elapsed += dt;
    const t = Math.min(1, cameraMotion.elapsed / 1.4), smooth = t * t * (3 - 2 * t);
    camera.position.lerpVectors(cameraMotion.from, cameraMotion.to, smooth);
    controls.target.lerpVectors(cameraMotion.targetFrom, cameraMotion.targetTo, smooth);
    camera.zoom = THREE.MathUtils.lerp(cameraMotion.zoomFrom, cameraMotion.zoomTo, smooth);
    camera.updateProjectionMatrix();
    if (t === 1) cameraMotion = null;
  }
  controls.update();
  if (phase === 'gathering' && actors.filter(participant).every(a => a.arrived && a.sit > .97)) {
    status('waiting');
    say(8, 'Bos', 'Seluruh analis sudah hadir. Menunggu respons provider AI.', 6);
    const resolve = resolveGather; resolveGather = null; resolve?.();
  }
  if (phase === 'returning' && actors.filter(participant).every(a => a.arrived && a.sit > .97)) {
    status('idle'); resumeAmbientClock(now); window.dispatchEvent(new Event('office:idle'));
  }
  updateSpeech(now);
  const drawStart = performance.now();
  renderer.render(scene, camera);
  samples.push({ frame:rawDt, draw:performance.now() - drawStart });
  if (now - windowStart > 4500 && samples.length) {
    frameAverage = samples.reduce((sum,s) => sum + s.frame, 0) / samples.length;
    const drawAverage = samples.reduce((sum,s) => sum + s.draw, 0) / samples.length;
    const q = QUALITY[level], frameBudget = 1000 / q.fps;
    const fps = Math.min(q.fps, Math.round(1000 / frameAverage));
    const scalePct = Math.round(q.scale * (qualityMode === 'auto' ? dynamicScale : 1) * 100);
    $('render-info').textContent = (qualityMode === 'auto' ? 'AUTO ' + level.toUpperCase() : scalePct + '%') + ' · ' + fps + ' FPS';
    if (qualityMode === 'auto') {
      const overrun = frameAverage - frameBudget;
      const stressed = overrun > (q.fps === 60 ? 5 : 9) || drawAverage > frameBudget * .80;
      const headroom = overrun < 2.5 && drawAverage < frameBudget * .45;
      if (stressed) {
        stableWindows = 0;
        if (dynamicScale > .73) {
          dynamicScale = Math.max(.72, Math.round((dynamicScale - .08) * 100) / 100);
          applyQuality();
        } else {
          const pressure = frameAverage > frameBudget + 4 ? frameAverage : drawAverage + (q.fps === 60 ? 8 : 10);
          const next = adaptiveQuality(level, pressure);
          if (next !== level) { level = next; dynamicScale = .90; applyQuality(); }
        }
      } else if (headroom) {
        stableWindows++;
        if (stableWindows >= 2) {
          stableWindows = 0;
          if (dynamicScale < .99) {
            dynamicScale = Math.min(1, Math.round((dynamicScale + .06) * 100) / 100);
            applyQuality();
          } else {
            const next = adaptiveQuality(level, drawAverage + (q.fps === 60 ? 6 : 8));
            if (next !== level) { level = next; dynamicScale = .88; applyQuality(); }
          }
        }
      } else stableWindows = 0;
    }
    samples = []; windowStart = now;
  }
}
function fail(error) {
  $('scene-loading').hidden = true; $('scene-error').hidden = false;
  $('scene-error-message').textContent = error?.message || 'WebGL tidak tersedia pada perangkat ini.';
  ready = false;
  window.dispatchEvent(new CustomEvent('office:error', { detail:error?.message }));
}
function init() {
  scene = new THREE.Scene(); scene.background = new THREE.Color('#dfe2d8');
  renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false, powerPreference:'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.replaceChildren(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'Kantor miniatur 3D interaktif');
  camera = new THREE.OrthographicCamera(-12, 12, 10, -10, .1, 150);
  camera.position.set(14.5, 18.4, 22.1);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, .4, .1); controls.enableDamping = true;
  controls.minPolarAngle = .24; controls.maxPolarAngle = Math.PI * .46;
  controls.minZoom = .65; controls.maxZoom = 3.5; controls.enablePan = false;
  controls.addEventListener('start', () => { cameraMotion = null; setCameraMode('manual'); });
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture; scene.environmentIntensity = .33;
  room.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight('#fff8e8', '#9ca58b', .95));
  const sun = new THREE.DirectionalLight('#fff1d9', 3.2);
  sun.name = 'sun'; sun.position.set(-3, 12, 8); sun.castShadow = true;
  sun.shadow.camera.left = -12; sun.shadow.camera.right = 12; sun.shadow.camera.top = 10; sun.shadow.camera.bottom = -10;
  sun.shadow.camera.near = .5; sun.shadow.camera.far = 35;
  sun.shadow.bias = -.0003; sun.shadow.normalBias = .027; sun.shadow.radius = 3;
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#e7f2ea', .65); fill.position.set(8, 7, -6); scene.add(fill);
  office = buildOffice(scene); actors = TEAM.map(member => createCharacter(scene, member));
  actors.forEach(a => updateCharacter(a, 1, 0, false));
  let saved = 'auto'; try { saved = localStorage.getItem('byga-office-quality') || 'auto'; } catch {}
  setQuality(saved, false);
  observer = new ResizeObserver(resize); observer.observe(container);
  choice.addEventListener('change', () => setQuality(choice.value));
  $('view-office').addEventListener('click', () => cameraView('office', true));
  $('view-meeting').addEventListener('click', () => cameraView('meeting', true));
  $('auto-camera').addEventListener('click', () => setCameraMode('auto'));
  setCameraMode('auto');
  const zoom = factor => { cameraMotion = null; setCameraMode('manual'); camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, .65, 3.5); camera.updateProjectionMatrix(); };
  $('zoom-in').addEventListener('click', () => zoom(1.2)); $('zoom-out').addEventListener('click', () => zoom(1 / 1.2));
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let pointerStart = null;
  renderer.domElement.addEventListener('pointerdown', e => { pointerStart = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!pointerStart || Math.hypot(e.clientX - pointerStart[0], e.clientY - pointerStart[1]) > 7) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(actors.map(a => a.pickBox))[0];
    if (hit) {
      const id = hit.object.userData.memberId;
      window.dispatchEvent(new CustomEvent('office:select', { detail:id }));
      if (phase === 'idle') say(id, id === 8 ? 'Bos' : 'Analis ' + (id + 1), id === 8 ? 'Siap memimpin meeting analisis.' : 'Siap untuk tugas analisis berikutnya.', 4);
    }
  });
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden; lastFrame = 0; samples = []; windowStart = performance.now();
    if (hidden) window.__officePauseAt = performance.now();
    else if (window.__officePauseAt) { speechUntil += performance.now() - window.__officePauseAt; window.__officePauseAt = null; }
  });
  renderer.domElement.addEventListener('webglcontextlost', e => {
    e.preventDefault(); contextLost = true;
    $('scene-error').hidden = false; $('scene-error-message').textContent = 'Konteks grafis terputus. Menunggu pemulihan…';
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => { contextLost = false; $('scene-error').hidden = true; applyQuality(); });
  controls.update(); renderer.render(scene, camera);
  $('scene-loading').hidden = true; ready = true;
  window.bygaOffice = {
    beginMeeting, discuss, discussPublic,
    triggerAmbient() { return startAmbientEvent(performance.now()); },
    get busy() { return phase !== 'idle'; },
    get state() { return { phase, generation, level, qualityMode, dynamicScale, pixelRatio:renderer.getPixelRatio(), cameraMode, ambientActive:!!ambientBatch, ambientDueInMs:Number.isFinite(ambientNextAt)?Math.max(0,ambientNextAt-performance.now()):null, frameAverage, drawCalls:renderer.info.render.calls, triangles:renderer.info.render.triangles, actors:actors.map(a => ({ id:a.member.id, x:a.root.position.x, z:a.root.position.z, sitting:a.sit, arrived:a.arrived, path:a.path.length })) }; }
  };
  window.dispatchEvent(new Event('office:ready'));
  windowStart = performance.now(); raf = requestAnimationFrame(tick);
  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(raf); observer.disconnect(); controls.dispose(); environment.dispose();
    const geometries = new Set(), materials = new Set(), textures = new Set();
    scene.traverse(o => { if(o.geometry) geometries.add(o.geometry); for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if(m) { materials.add(m); for (const v of Object.values(m)) if(v?.isTexture) textures.add(v); } });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); renderer.dispose();
  }, { once:true });
}
$('scene-retry').addEventListener('click', () => location.reload());
try { init(); } catch (error) { fail(error); }
