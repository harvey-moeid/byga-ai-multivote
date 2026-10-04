import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DESK_X, TEAM } from './choreography.js';

const meshes = new Map();
function cached(key, create) {
  if (!meshes.has(key)) meshes.set(key, create());
  return meshes.get(key);
}
export function material(color, roughness = .65, metalness = 0, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}
export function box(parent, x, y, z, w, h, d, mat, radius = 0) {
  const key = ['box', w, h, d, radius].join(':');
  const geo = cached(key, () => radius ? new RoundedBoxGeometry(w, h, d, 2, radius) : new THREE.BoxGeometry(w, h, d));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = !mat.transparent;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
export function ellipsoid(parent, x, y, z, sx, sy, sz, mat) {
  const mesh = new THREE.Mesh(cached('sphere', () => new THREE.SphereGeometry(1, 14, 10)), mat);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}
export function cylinder(parent, x, y, z, top, bottom, height, mat, segments = 16) {
  const geo = cached(['cyl', top, bottom, height, segments].join(':'), () => new THREE.CylinderGeometry(top, bottom, height, segments));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
export function canvasTexture(w, h, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  paint(canvas.getContext('2d'), w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function woodTexture() {
  let seed = 27;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const texture = canvasTexture(512, 512, (c, w, h) => {
    c.fillStyle = '#b99770'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 1900; i++) {
      c.strokeStyle = rand() > .5 ? 'rgba(58,33,14,.055)' : 'rgba(255,243,218,.10)';
      c.lineWidth = .4 + rand() * 1.2;
      const y = rand() * h;
      c.beginPath(); c.moveTo(0, y);
      c.bezierCurveTo(w * .3, y + rand() * 6, w * .7, y - rand() * 6, w, y + rand() * 3); c.stroke();
    }
    for (let row = 0; row < 8; row++) {
      c.fillStyle = row % 2 ? '#52362118' : '#fff4d210'; c.fillRect(0, row * 64, w, 64);
      c.strokeStyle = '#53392145'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, row * 64); c.lineTo(w, row * 64); c.stroke();
      const joint = row % 2 ? 170 : 350;
      c.beginPath(); c.moveTo(joint, row * 64); c.lineTo(joint, (row + 1) * 64); c.stroke();
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 3);
  return texture;
}
function plaque(parent, text, x, y, z, w, h, facing = 0, dark = true) {
  const tex = canvasTexture(512, 128, c => {
    c.fillStyle = dark ? '#202b26' : '#edeee5'; c.fillRect(0, 0, 512, 128);
    c.fillStyle = dark ? '#eedabc' : '#234439'; c.font = '600 48px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 256, 64, 475);
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: .65 }));
  mesh.position.set(x, y, z); mesh.rotation.y = facing; parent.add(mesh); return mesh;
}
function screenTexture(title) {
  const tex = canvasTexture(512, 288, (c, w, h) => {
    c.fillStyle = '#101c22'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#aac4b7'; c.font = 'bold 26px Arial'; c.fillText(title, 24, 40);
    c.strokeStyle = '#253a41'; c.lineWidth = 1;
    for (let y = 72; y < 230; y += 30) { c.beginPath(); c.moveTo(24, y); c.lineTo(488, y); c.stroke(); }
    for (let x = 24; x < 490; x += 58) { c.beginPath(); c.moveTo(x, 72); c.lineTo(x, 230); c.stroke(); }
    c.fillStyle = '#c6d8cb'; c.font = '18px Arial'; c.fillText('WAITING FOR ANALYSIS', 24, 264);
  });
  return tex;
}
export function buildOffice(scene) {
  const world = new THREE.Group(); scene.add(world);
  const wood = material('#c8b08a', .56, 0, { map: woodTexture() });
  const walnut = material('#68503c', .44, 0, { map: wood.map });
  const wall = material('#eee8db', .83), trim = material('#29342d', .4, .45);
  const ivory = material('#dddcd0', .78), leather = material('#303735', .8), brass = material('#baab78', .3, .75);
  const glass = new THREE.MeshPhysicalMaterial({ color: '#bdd6cf', roughness: .1, metalness: .05, transparent: true, opacity: .16, side: THREE.DoubleSide, depthWrite: false });
  const lightMat = material('#fff3ce', .35, 0, { emissive: '#ffe3a6', emissiveIntensity: 1.3 });
  const screens = [];
  box(world, 0, -.48, 0, 16.7, .55, 12.8, walnut, .1);
  box(world, 0, -.075, 0, 16.3, .15, 12.4, wood);
  box(world, 0, -1.01, 0, 100, .3, 100, material('#d5d8ce', .9));
  // Rear and side walls are tall; front cutaway walls preserve the dollhouse view.
  box(world, 0, 1.55, -6, 16.2, 3.2, .16, wall);
  box(world, -8, 1.55, 0, .16, 3.2, 12, wall);
  box(world, 8, .62, 0, .16, 1.3, 12, wall);
  box(world, 0, .30, 6, 16.2, .65, .16, wall);
  for (const x of [-8, 8]) box(world, x, .09, 0, .19, .14, 12, trim);
  box(world, 0, .09, -5.88, 16, .14, .08, trim);
  box(world, 0, 3.17, -6, 16.3, .1, .25, trim);
  box(world, -8, 3.17, 0, .25, .1, 12.1, trim);
  // Ribbed wood panels, framed plaques and wall sconces.
  for (let x = -7.6; x < -.25; x += .19) box(world, x, 1.57, -5.85, .075, 2.9, .09, walnut);
  plaque(world, 'BOSS', -4.3, 2.7, -5.73, 2.0, .44);
  plaque(world, 'MEETING', 4.5, 2.73, -5.89, 2.55, .44);
  for (const x of [-6.7, -2.2, 1.2, 7.25]) {
    box(world, x, 1.85, -5.76, .15, .42, .14, brass, .025);
    box(world, x, 1.88, -5.66, .09, .27, .07, lightMat, .02);
    const lamp = new THREE.PointLight('#ffdca3', 3.0, 3, 2); lamp.position.set(x, 1.8, -5.25); world.add(lamp);
  }
  const pane = (x, z, width, parent = world) => {
    box(parent, x, 1.35, z, width, 2.6, .03, glass);
    for (const y of [.05, 2.7]) box(parent, x, y, z, width, .07, .08, trim);
    for (const dx of [-width / 2, width / 2]) box(parent, x + dx, 1.37, z, .055, 2.7, .08, trim);
    box(parent, x, .98, z, width, .035, .05, trim);
  };
  pane(-4.9, -1.5, 5.7); pane(-.15, -1.5, .3);
  pane(4.85, -1.5, 5.8); pane(.5, -1.5, .2);
  // Glass partitions separate the boss and meeting rooms.
  const divider = new THREE.Group(); world.add(divider);
  pane(0, 0, 4.4, divider);
  divider.rotation.y = Math.PI / 2; divider.position.set(0, 0, -3.75);
  const doors = [];
  const door = (x, z, width) => {
    const hinge = new THREE.Group(); hinge.userData.dynamic = true; hinge.position.set(x - width / 2, 0, z); world.add(hinge);
    box(hinge, width / 2, 1.35, 0, width, 2.6, .035, glass);
    for (const y of [.05, 2.7]) box(hinge, width / 2, y, 0, width, .06, .07, trim);
    for (const dx of [0, width]) box(hinge, dx, 1.35, 0, .055, 2.7, .07, trim);
    box(hinge, width - .16, 1.15, .05, .045, .45, .04, brass, .015);
    doors.push({ hinge, x, z }); return hinge;
  };
  door(-1, -1.5, 1.6); door(1.4, -1.5, 1.6);
  const monitor = (parent, x, y, z, title, width = .70, height = .44, angle = 0) => {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = angle; parent.add(g);
    box(g, 0, height / 2 + .11, 0, width + .045, height + .04, .055, trim, .015);
    cylinder(g, 0, .06, -.01, .018, .023, .15, trim);
    box(g, 0, -.015, .02, .25, .022, .16, trim, .01);
    const tex = screenTexture(title);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: tex }));
    face.position.set(0, height / 2 + .11, .030); g.add(face);
    screens.push({ texture: tex, canvas: tex.image, title });
    return g;
  };
  const keyboard = (parent, x, y, z, angle = 0) => {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = angle; parent.add(g);
    box(g, 0, 0, 0, .46, .025, .17, trim, .008);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 11; col++) box(g, -.20 + col * .04, .015, -.055 + row * .045, .025, .006, .026, ivory);
  };
  const mug = (parent, x, y, z) => {
    cylinder(parent, x, y + .065, z, .06, .055, .12, ivory);
    cylinder(parent, x, y + .127, z, .044, .044, .003, material('#372923', .95));
    const handle = new THREE.Mesh(cached('mug-handle', () => new THREE.TorusGeometry(.035, .009, 6, 12)), ivory);
    handle.position.set(x + .065, y + .07, z); parent.add(handle);
  };
  const chair = (x, z, angle, boss = false) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = angle; world.add(g);
    const upholstery = boss ? material('#795d44', .68) : leather;
    cylinder(g, 0, .22, 0, .032, .045, .30, trim);
    for (let i = 0; i < 5; i++) {
      const spoke = box(g, 0, .11, 0, .50, .035, .04, trim);
      spoke.rotation.y = i * Math.PI * .4;
      ellipsoid(g, Math.cos(i * Math.PI * .4) * .26, .04, Math.sin(i * Math.PI * .4) * .26, .04, .04, .03, trim);
    }
    box(g, 0, .38, 0, .52, .14, .48, upholstery, .045);
    box(g, 0, boss ? .79 : .71, -.24, .50, boss ? .77 : .60, .095, upholstery, .04);
    for (const dx of [-.31, .31]) {
      box(g, dx, .51, -.08, .035, .28, .04, trim);
      box(g, dx, .64, -.015, .09, .045, .35, upholstery, .018);
    }
  };
  for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) {
    const x = DESK_X[col], z = row ? 3.35 : .45, index = row * 4 + col;
    box(world, x, .92, z, 1.57, .075, 1.02, wood, .025);
    for (const dx of [-.62, .62]) box(world, x + dx, .46, z, .045, .90, .76, trim);
    box(world, x - .48, .48, z, .30, .78, .57, ivory, .02);
    for (let i = 0; i < 3; i++) { box(world, x - .48, .25 + i * .22, z + .29, .27, .014, .012, trim); box(world, x - .48, .35 + i * .22, z + .305, .10, .014, .024, brass); }
    monitor(world, x - .36, .97, z - .29, 'BTCUSDT', .68);
    monitor(world, x + .36, .97, z - .28, 'ANALYST ' + (index + 1), .68, .44, -.1);
    keyboard(world, x - .1, .975, z + .22);
    ellipsoid(world, x + .33, .991, z + .23, .045, .024, .07, trim);
    box(world, x + .55, .98, z + .25, .16, .015, .24, ivory);
    mug(world, x - .57, .96, z + .25);
    chair(x, TEAM[index].home[1], Math.PI);
  }
  // Boss desk, notebook, laptop, guest chairs, shelving and ornaments.
  box(world, -4.4, .94, -3.6, 2.6, .1, 1.15, walnut, .03);
  for (const x of [-5.42, -3.38]) box(world, x, .45, -3.6, .35, .90, 1.00, walnut, .02);
  monitor(world, -4.55, 1.0, -3.43, 'DIRECTOR', .8, .48, Math.PI);
  keyboard(world, -4.55, 1.01, -3.83);
  box(world, -3.52, 1.0, -3.75, .4, .08, .35, ivory, .012);
  mug(world, -5.35, 1.0, -3.55);
  chair(-4.4, -4.5, 0, true);
  chair(-5.0, -2.65, Math.PI); chair(-3.8, -2.65, Math.PI);
  box(world, -7.2, 1.35, -4.3, .85, 2.65, 1.85, walnut);
  const bookMats = ['#dcd3b6', '#4f6258', '#394d60', '#c7a080'].map(c => material(c));
  for (let shelf = 0; shelf < 4; shelf++) {
    box(world, -6.73, .38 + shelf * .62, -4.3, .10, .07, 1.82, brass);
    for (let i = 0; i < 7; i++) box(world, -6.75, .58 + shelf * .62, -4.95 + i * .18, .35, .33 + (i % 3) * .045, .105, bookMats[(i + shelf) % 4], .01);
  }
  // Meeting table and eight chairs plus the director seat.
  box(world, 4.6, .94, -3.7, 4.15, .09, 1.55, wood, .10);
  for (const x of [3.3, 5.8]) box(world, x, .46, -3.7, .15, .9, .92, trim, .025);
  for (const member of TEAM) { if (!member.boss) chair(...member.seat, member.seatAngle); }
  chair(7.05, -3.7, -Math.PI / 2, true);
  for (let i = 0; i < 4; i++) {
    box(world, 3 + i * 1.05, 1.00, -3.25, .4, .015, .26, ivory);
    box(world, 3 + i * 1.05, 1.00, -4.16, .4, .015, .26, ivory);
    mug(world, 3.2 + i * 1.05, .995, -3.45);
  }
  monitor(world, 4.3, 1.16, -5.77, 'BTCUSDT · MEETING', 3.3, 1.50);
  plaque(world, 'TRADING  /  BTC · GOLD · FX', -7.88, 2.44, 2.0, 2.8, .40, Math.PI / 2);
  // Lounge, sofa, coffee table, rug and drinks station.
  box(world, 5.55, .018, 3.35, 3.7, .03, 3.5, material('#aaa99a', .95), .05);
  const sofa = material('#bfc5b8', .93);
  box(world, 6.55, .27, 3.55, 1.0, .40, 2.55, trim, .08);
  box(world, 6.65, .73, 3.55, .32, .92, 2.6, sofa, .07);
  for (const z of [2.77, 3.55, 4.33]) box(world, 6.15, .51, z, .91, .30, .76, sofa, .065);
  for (const z of [2.21, 4.89]) box(world, 6.24, .65, z, .9, .62, .20, sofa, .06);
  cylinder(world, 4.4, .52, 3.55, .83, .83, .08, ivory, 32);
  cylinder(world, 4.4, .25, 3.55, .09, .23, .5, trim);
  mug(world, 4.73, .58, 3.68);
  box(world, 4.08, .58, 3.40, .4, .03, .5, bookMats[1]);
  box(world, 7.1, .60, .05, .60, 1.18, .63, ivory, .04);
  cylinder(world, 7.1, 1.42, .05, .23, .23, .44, material('#90b8c3', .18, .1, { transparent: true, opacity: .75 }));
  box(world, 7.1, .86, .38, .4, .14, .03, trim);
  // Entrance cutaway and raised facade lettering.
  box(world, -1.5, .68, 5.97, 4.7, 1.4, .20, wall);
  plaque(world, 'BYGA CENTER', -1.5, .94, 6.08, 3.75, .50, 0, false);
  plaque(world, 'TRADING · BTC · GOLD · FX', -1.5, .52, 6.085, 3.30, .18, 0, false);
  box(world, -1.5, .20, 6.11, 3.80, .05, .055, lightMat);
  const leafMat = material('#3c683e', .72), leafLight = material('#76945b', .72), potMat = material('#e0dcca', .85);
  const plant = (x, z, size = 1) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(size); world.add(g);
    cylinder(g, 0, .25, 0, .24, .18, .48, potMat);
    cylinder(g, 0, .49, 0, .21, .21, .015, material('#493c2a', 1));
    for (let i = 0; i < 15; i++) {
      const a = i * 2.399, height = .62 + (i % 5) * .14, distance = .15 + (i % 3) * .1;
      const leaf = ellipsoid(g, Math.cos(a) * distance, height, Math.sin(a) * distance, .09, .31, .035, i % 2 ? leafMat : leafLight);
      leaf.rotation.set(Math.sin(a) * .7, -a, Math.cos(a) * .6);
      const stem = cylinder(g, Math.cos(a) * distance * .45, .70, Math.sin(a) * distance * .45, .01, .014, .48, leafMat, 5);
      stem.rotation.z = Math.cos(a) * .28;
    }
  };
  for (const [x, z, size] of [[-7.3,-2,1],[-1.1,-5.3,1],[.7,-5.5,.8],[7.2,-5.25,.9],[2.5,-.6,.85],[-7.25,5.05,.9],[.7,5.1,1],[7.4,5.3,1],[3.0,1.7,.9],[4.4,3.55,.35]]) plant(x, z, size);
  batchStatic(world);
  return { world, doors, screens };
}

// Combine furniture by material. Thousands of tiny props become tens of draws.
function batchStatic(world) {
  world.updateMatrixWorld(true);
  const batches = new Map(), originals = [];
  world.traverse(object => {
    if (!object.isMesh) return;
    for (let parent = object.parent; parent && parent !== world; parent = parent.parent) if (parent.userData.dynamic) return;
    const key = object.material.uuid;
    if (!batches.has(key)) batches.set(key, { mat:object.material, geometries:[], cast:object.castShadow });
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    batches.get(key).geometries.push(geometry); originals.push(object);
  });
  for (const batch of batches.values()) {
    const geometry = mergeGeometries(batch.geometries, false);
    if (!geometry) throw new Error('Office geometry could not be batched.');
    const mesh = new THREE.Mesh(geometry, batch.mat); mesh.castShadow = batch.cast; mesh.receiveShadow = true;
    world.add(mesh); batch.geometries.forEach(g => g.dispose());
  }
  originals.forEach(object => object.removeFromParent());
}

export function batchRigidParts(root) {
  const parents = [];
  root.traverse(object => { if(object.children.some(child => child.isMesh)) parents.push(object); });
  for (const parent of parents) {
    const batches = new Map();
    for (const object of [...parent.children]) {
      if (!object.isMesh || object.material.visible === false) continue;
      const key = object.material.uuid;
      if (!batches.has(key)) batches.set(key, { mat:object.material, geometries:[], originals:[] });
      object.updateMatrix();
      const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
      geometry.applyMatrix4(object.matrix);
      batches.get(key).geometries.push(geometry); batches.get(key).originals.push(object);
    }
    for (const batch of batches.values()) {
      if (batch.originals.length < 2) { batch.geometries.forEach(g => g.dispose()); continue; }
      const mesh = new THREE.Mesh(mergeGeometries(batch.geometries, false), batch.mat);
      mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
      batch.originals.forEach(o => o.removeFromParent()); batch.geometries.forEach(g => g.dispose());
    }
  }
}

export function updateScreens(screens, data, phase = 'READY') {
  for (const screen of screens) {
    const c = screen.canvas.getContext('2d'), w = screen.canvas.width, h = screen.canvas.height;
    c.fillStyle = '#101c22'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#abc5b6'; c.font = 'bold 23px Arial'; c.fillText(screen.title, 24, 40);
    c.strokeStyle = '#283a40';
    for (let y = 65; y < 235; y += 32) { c.beginPath(); c.moveTo(24, y); c.lineTo(w - 24, y); c.stroke(); }
    const signal = data?.majority_signal;
    c.fillStyle = signal === 'BUY' ? '#62d6a8' : signal === 'SELL' ? '#ef9c99' : '#ccdbc9';
    c.font = 'bold 62px Arial'; c.fillText(signal || phase, 24, 150, 460);
    c.font = '22px Arial';
    c.fillText(data?.last_price != null ? '$ ' + Number(data.last_price).toLocaleString('en-US') : 'AI MULTI-VOTE', 24, 206);
    c.fillStyle = '#a9bcb6'; c.font = '17px Arial';
    c.fillText(data ? (data.voting?.buy ?? data.buy_votes ?? 0) + ' BUY  /  ' + (data.voting?.sell ?? data.sell_votes ?? 0) + ' SELL' : 'WAITING FOR ANALYSIS', 24, 264);
    screen.texture.needsUpdate = true;
  }
}
