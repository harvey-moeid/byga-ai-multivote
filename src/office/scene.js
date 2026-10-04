import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildOffice, updateScreens } from './assets.js';
import { createCharacter, updateCharacter } from './character.js';
import { TEAM, QUALITY, initialQuality, adaptiveQuality, meetingRoute, returnRoute, advanceActors } from './choreography.js';

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
let phase = 'idle', generation = 0, resolveGather, qualityMode = 'auto', level = 'medium';
let lastFrame = 0, lastDraw = 0, windowStart = 0, samples = [], frameAverage = 0;
let hidden = document.hidden, speaking = null, speechUntil = 0, speechQueue = [], queueIndex = 0, discussionDone;
let cameraMotion = null, ready = false, contextLost = false;
const speech = document.createElement('div');
speech.className = 'office-speech'; speech.hidden = true; $('speech-layer').append(speech);
const projected = new THREE.Vector3(), speakerPosition = new THREE.Vector3();

function status(next) {
  phase = next;
  $('phase-title').textContent = phaseCopy[next][0];
  $('phase-subtitle').textContent = phaseCopy[next][1];
  window.dispatchEvent(new CustomEvent('office:phase', { detail:next }));
}
function setQuality(mode, persist = true) {
  qualityMode = Object.hasOwn(QUALITY, mode) || mode === 'auto' ? mode : 'auto';
  if (qualityMode !== 'auto') level = qualityMode;
  else level = initialQuality({ width:container.clientWidth, memory:navigator.deviceMemory, cores:navigator.hardwareConcurrency });
  choice.value = qualityMode;
  if (persist) try { localStorage.setItem('byga-office-quality', qualityMode); } catch { /* Storage may be unavailable in private browsers. */ }
  applyQuality();
}
function applyQuality() {
  if (!renderer) return;
  const q = QUALITY[level];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * q.scale);
  renderer.shadowMap.enabled = q.shadows;
  let lampIndex = 0;
  scene.traverse(object => { if(object.isPointLight){ object.visible = level === 'high' || (level === 'medium' && lampIndex++ < 2); } });
  const sun = scene.getObjectByName('sun');
  sun.shadow.mapSize.set(q.mapSize, q.mapSize);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  renderer.shadowMap.needsUpdate = true;
  $('render-info').textContent = qualityMode === 'auto' ? 'AUTO' : Math.round(q.scale * 100) + '%';
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
function cameraView(view = 'office') {
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
function setRoute(actor, path, delay, angle) {
  actor.path = path.map(([x,z]) => new THREE.Vector3(x, .015, z));
  actor.delay = delay; actor.targetSit = 0; actor.walking = false;
  actor.arrived = false; actor.destinationAngle = angle;
}
function beginMeeting() {
  if (!ready || phase !== 'idle') return Promise.reject(new Error('Kantor belum siap untuk meeting.'));
  generation++;
  status('gathering'); speech.hidden = true; speaking = null;
  updateScreens(office.screens, null, 'MEETING');
  actors.forEach((actor, index) => setRoute(actor, meetingRoute(actor.member), index * .45, actor.member.seatAngle));
  return new Promise(resolve => { resolveGather = resolve; });
}
function discuss(data, error) {
  status('discussing');
  cameraView('meeting');
  updateScreens(office.screens, data, error ? 'ERROR' : 'READY');
  const results = Array.isArray(data?.results) ? data.results : [];
  speechQueue = error ? [{ id:8, name:'Bos', text:error, seconds:5 }] : [
    { id:8, name:'Bos', text:'Respons AI sudah diterima. Kita tinjau vote dan alasannya.', seconds:3 },
    ...results.map((r, index) => ({
      id:index % 8, name:r.provider_label || r.provider || 'Analis',
      text:r.status === 'success' ? [r.signal, r.reason || 'Vote diterima.'].filter(Boolean).join(' · ') : 'Respons gagal: ' + (r.error || r.error_code || r.status),
      seconds:4
    })),
    { id:8, name:'Bos', text:'Konsensus: ' + (data?.majority_signal || 'Belum tersedia') + '. ' + (data?.decision_reason || ''), seconds:5 }
  ];
  queueIndex = 0; speechUntil = 0; speech.hidden = true; speaking = null;
  return new Promise(resolve => { discussionDone = resolve; });
}
function goHome() {
  speech.hidden = true; speaking = null;
  status('returning'); cameraView('office');
  actors.forEach((actor, index) => setRoute(actor, returnRoute(actor.member), (8 - index) * .5, actor.member.homeAngle));
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
  if (phase === 'gathering' && actors.every(a => a.arrived && a.sit > .97)) {
    status('waiting');
    say(8, 'Bos', 'Seluruh analis sudah hadir. Menunggu respons provider AI.', 6);
    const resolve = resolveGather; resolveGather = null; resolve?.();
  }
  if (phase === 'returning' && actors.every(a => a.arrived && a.sit > .97)) {
    status('idle'); window.dispatchEvent(new Event('office:idle'));
  }
  updateSpeech(now);
  const drawStart = performance.now();
  renderer.render(scene, camera);
  samples.push({ frame:rawDt, draw:performance.now() - drawStart });
  if (now - windowStart > 4500) {
    frameAverage = samples.reduce((sum,s) => sum + s.frame, 0) / samples.length;
    const drawAverage = samples.reduce((sum,s) => sum + s.draw, 0) / samples.length;
    $('render-info').textContent = (qualityMode === 'auto' ? 'AUTO' : Math.round(QUALITY[level].scale * 100) + '%') + ' · ' + Math.min(QUALITY[level].fps, Math.round(1000 / frameAverage)) + ' FPS';
    if (qualityMode === 'auto') {
      // Draw time allows a 30 FPS tier to recover without oscillating at its cap.
      const next = adaptiveQuality(level, frameAverage > 43 ? frameAverage : drawAverage + 8);
      if (next !== level) { level = next; applyQuality(); }
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
  controls.minZoom = .65; controls.maxZoom = 3.5; controls.enablePan = true;
  controls.addEventListener('start', () => { cameraMotion = null; });
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
  $('view-office').addEventListener('click', () => cameraView('office'));
  $('view-meeting').addEventListener('click', () => cameraView('meeting'));
  const zoom = factor => { cameraMotion = null; camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, .65, 3.5); camera.updateProjectionMatrix(); };
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
    beginMeeting, discuss,
    get busy() { return phase !== 'idle'; },
    get state() { return { phase, generation, level, qualityMode, frameAverage, drawCalls:renderer.info.render.calls, triangles:renderer.info.render.triangles, actors:actors.map(a => ({ id:a.member.id, x:a.root.position.x, z:a.root.position.z, sitting:a.sit, arrived:a.arrived, path:a.path.length })) }; }
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
