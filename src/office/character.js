import * as THREE from 'three';
import { box, ellipsoid, cylinder, material, batchRigidParts } from './assets.js';
import { shortestAngle } from './choreography.js';

const eyeMat = material('#24251f', .42);
const shoeMat = material('#262a27', .38);
const shirtMat = material('#eeefe6', .9);
const palette = ['#344640', '#c9cbc1', '#434d59', '#babbb3', '#344740', '#46535e', '#b9c4ba', '#454a48', '#303b37'];

function limb(parent, x, y, z, length, radius, mat) {
  const joint = new THREE.Group(); joint.position.set(x, y, z); parent.add(joint);
  cylinder(joint, 0, -length / 2, 0, radius * .85, radius, length, mat, 12);
  ellipsoid(joint, 0, -.025, 0, radius, radius * 1.2, radius, mat);
  return joint;
}
function jacket(parent, mat) {
  const profile = [[.125,0],[.17,.055],[.185,.19],[.225,.36],[.235,.43],[.17,.49]];
  const geometry = new THREE.LatheGeometry(profile.map(([r,y]) => new THREE.Vector2(r,y)), 20);
  const mesh = new THREE.Mesh(geometry, mat); mesh.scale.z = .68; mesh.castShadow = true; parent.add(mesh);
}

export function createCharacter(scene, member) {
  const root = new THREE.Group(); root.position.set(member.home[0], .015, member.home[1]); root.rotation.y = member.homeAngle; scene.add(root);
  const hip = new THREE.Group(); root.add(hip);
  const outfit = material(palette[member.id], .87);
  const skin = material(['#c69a77','#d3ae8b','#b68866','#d4ad90'][member.id % 4], .87);
  const hair = material(member.id % 3 === 1 ? '#423c2c' : '#282a23', .92);
  const female = [1,4,6].includes(member.id);
  ellipsoid(hip, 0, -.025, 0, .15, .11, .115, outfit);
  const torso = new THREE.Group(); hip.add(torso); jacket(torso, female ? shirtMat : outfit);
  // Shirtfront, lapels, tie, buttons and collar add detail at miniature scale.
  const front = box(torso, 0, .30, .135, .105, .32, .02, shirtMat, .006);
  front.rotation.x = -.08;
  for (const sign of [-1,1]) {
    const lapel = box(torso, sign * .07, .31, .149, .055, .25, .014, outfit);
    lapel.rotation.z = sign * -.23;
  }
  if (!female) {
    const tie = box(torso, 0, .26, .16, .028, .22, .014, material(member.boss ? '#976b51' : '#566c5b'));
    tie.rotation.z = -.03;
  }
  for (let i = 0; i < 2; i++) ellipsoid(torso, .025, .075 + i * .07, .146, .009, .009, .005, shoeMat);
  cylinder(torso, 0, .53, 0, .055, .064, .10, skin);
  const head = new THREE.Group(); head.position.set(0, .69, .018); torso.add(head);
  ellipsoid(head, 0, .015, 0, .115, .152, .103, skin);
  ellipsoid(head, 0, -.071, .025, .077, .071, .084, skin);
  for (const side of [-1,1]) {
    ellipsoid(head, side * .112, -.007, -.01, .027, .042, .02, skin);
    ellipsoid(head, side * .046, .022, .088, .027, .014, .008, shirtMat);
    ellipsoid(head, side * .046, .022, .094, .011, .011, .004, eyeMat);
    const brow = box(head, side * .044, .047, .089, .044, .009, .007, hair, .003); brow.rotation.z = side * -.06;
  }
  ellipsoid(head, 0, -.015, .103, .018, .031, .025, skin);
  box(head, 0, -.064, .100, .047, .006, .009, material('#896251'), .002);
  ellipsoid(head, 0, .105, -.02, .123, .079, .112, hair);
  ellipsoid(head, -.033, .114, .019, .095, .047, .094, hair);
  if (female) {
    ellipsoid(head, 0, -.026, -.087, .104, .139, .047, hair);
    ellipsoid(head, 0, -.068, -.14, .047, .083, .050, hair);
  }
  const arms = [-1,1].map(sign => {
    const upper = limb(torso, sign * .227, .43, 0, .265, .064, female ? shirtMat : outfit);
    upper.rotation.z = sign * .10;
    const lower = limb(upper, 0, -.265, 0, .245, .047, female ? shirtMat : outfit);
    cylinder(lower, 0, -.22, 0, .043, .043, .035, shirtMat);
    const hand = ellipsoid(lower, 0, -.27, .006, .042, .062, .027, skin);
    for (let i = 0; i < 3; i++) box(lower, -.022 + i * .018, -.303, .026, .008, .043, .01, skin, .002);
    return { upper, lower, hand };
  });
  const legs = [-1,1].map(sign => {
    const upper = limb(hip, sign * .088, -.08, 0, .42, .081, outfit);
    const lower = limb(upper, 0, -.42, 0, .49, .058, outfit);
    box(lower, 0, -.485, .055, .116, .085, .235, shoeMat, .03);
    return { upper, lower };
  });
  const pickBox = box(root, 0, 1, 0, .6, 1.8, .6, new THREE.MeshBasicMaterial({ visible:false }));
  pickBox.userData.memberId = member.id;
  batchRigidParts(root);
  return { member, root, hip, torso, head, arms, legs, pickBox, sit:1, targetSit:1, walking:false, path:[], angle:member.homeAngle, delay:0, gait:0, arrived:true };
}

export function updateCharacter(character, dt, time, speaking) {
  const { hip, torso, head, arms, legs } = character;
  character.sit = THREE.MathUtils.damp(character.sit, character.targetSit, 7, dt);
  const sit = character.sit, walking = character.walking && sit < .08;
  character.gait += walking ? dt * 8.5 : 0;
  const stride = walking ? Math.sin(character.gait) * .43 : 0;
  hip.position.y = 1.03 - sit * .42 + (walking ? Math.abs(Math.cos(character.gait)) * .025 : 0);
  torso.rotation.x = sit * .04;
  head.rotation.y = THREE.MathUtils.damp(head.rotation.y, speaking ? Math.sin(time * .75) * .18 : Math.sin(time * .30 + character.member.id) * .065, 3, dt);
  head.rotation.x = speaking ? Math.sin(time * 2.1) * .045 : sit * .07;
  for (let i = 0; i < 2; i++) {
    const sign = i ? 1 : -1;
    legs[i].upper.rotation.x = -sit * Math.PI / 2 + stride * sign;
    legs[i].lower.rotation.x = sit * Math.PI / 2 + (walking ? Math.max(0, -stride * sign) * .8 : 0);
    arms[i].upper.rotation.x = -sit * 1.10 - stride * sign * .65 + (speaking && i === 1 ? -.36 : 0);
    arms[i].lower.rotation.x = -sit * .55 + (speaking ? Math.sin(time * 2 + i) * .18 : sit * Math.sin(time * 3.5 + i) * .045);
  }
  const angle = shortestAngle(character.root.rotation.y, character.angle);
  character.root.rotation.y += angle * (1 - Math.exp(-dt * 9));
}
