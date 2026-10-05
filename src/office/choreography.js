export const DESK_X = [-6.1, -4.4, -2.7, -1];
export const TEAM = Array.from({ length: 8 }, (_, index) => {
  const back = index >= 4;
  return {
    id: index, boss: false,
    home: [DESK_X[index % 4], back ? 4.2 : 1.3],
    homeAngle: Math.PI,
    seat: [3 + (index % 4) * 1.05, back ? -4.95 : -2.45],
    seatAngle: back ? 0 : Math.PI
  };
});
TEAM.push({ id: 8, boss: true, home: [-4.4, -4.5], homeAngle: 0, seat: [7.05, -3.7], seatAngle: -Math.PI / 2 });

// Shared corridors stay outside desk footprints and the meeting table.
export function meetingRoute(member) {
  const [x, z] = member.home;
  const [sx, sz] = member.seat;
  if (member.boss) return [[x + .5, z], [x + .5, -4.8], [-1, -4.8], [-1, -.6], [1.4, -.6], [1.4, -1.85], [7.2, -1.85], [7.2, sz], [sx, sz]];
  const corridorZ = z + .45;
  const insideZ = member.id >= 4 ? -5.6 : -1.85;
  return [[x + .5, z], [x + .5, corridorZ], [1.4, corridorZ], [1.4, -.6], [1.4, insideZ], [sx, insideZ], [sx, sz]];
}

export function returnRoute(member) {
  const [x,z] = member.seat;
  const route = meetingRoute(member).slice(0, -1).reverse();
  if(member.boss) return [[x,z+.55],[route[0][0],z+.55],...route.slice(1),[...member.home]];
  return [[x+.48,z],[x+.48,route[0][1]],...route,[...member.home]];
}

export function ambientRoute(member, variant = 0) {
  const [x,z]=member.home;
  const analystLabels=['Memeriksa chart','Membandingkan timeframe','Mengambil kopi','Mengecek monitor lain'];
  const bossLabels=['Mengunjungi meja analis','Memeriksa dashboard','Berjalan keliling kantor','Mengecek ruang kerja'];
  const labels=member.boss?bossLabels:analystLabels;
  const label=labels[Math.abs(variant)%labels.length];
  let destination;
  if (member.boss) {
    const points=[[-2.9,-4.55],[-1.05,-1.1],[-3.8,-3.7],[-.6,-4.65]];
    destination=points[Math.abs(variant)%points.length];
  } else {
    const points=[
      [Math.min(.2,x+1.0),z+.48],
      [Math.min(.4,x+1.45),z+(z>3?-.48:.48)],
      [-.15,5.05],
      [Math.max(-6.3,x-.75),z+.5]
    ];
    destination=points[Math.abs(variant)%points.length];
  }
  const corridorZ=member.boss?-4.8:z+.45;
  const path=member.boss
    ? [[x+.5,z],[x+.5,corridorZ],[destination[0],corridorZ],destination]
    : [[x+.5,z],[x+.5,corridorZ],[destination[0],corridorZ],destination];
  const back=path.slice(0,-1).reverse().concat([[x,z]]);
  return {label,path,back,angle:member.boss?0:Math.PI};
}

export function shortestAngle(current, target) {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

export function advanceActors(actors, dt) {
  for (const actor of actors) {
    actor.delay = Math.max(0, actor.delay - dt);
    if (!actor.path.length || actor.delay > 0 || actor.sit > .08) { actor.walking = false; continue; }
    const target = actor.path[0], position = actor.root.position;
    const direction = target.clone().sub(position), distance = direction.length();
    if (distance < .04) {
      position.copy(target); actor.path.shift();
      if (!actor.path.length) { actor.arrived = true; actor.walking = false; actor.targetSit = actor.sitOnArrival ?? 1; actor.angle = actor.destinationAngle; }
      continue;
    }
    direction.normalize();
    const next = position.clone().addScaledVector(direction, Math.min(distance, dt * 1.32));
    const blocker = actors.find(other => {
      if (other === actor || other.arrived || other.sit > .08) return false;
      const delta = other.root.position.clone().sub(position);
      if (delta.length() > .48 || delta.dot(direction) < -.05) return false;
      const heading = other.path[0]?.clone().sub(other.root.position).normalize();
      const following = heading && direction.dot(heading) > .8;
      return next.distanceTo(other.root.position) < position.distanceTo(other.root.position) && (other.member.id < actor.member.id || (following && delta.dot(direction) > .30));
    });
    actor.walking = !blocker;
    actor.angle = Math.atan2(direction.x, direction.z);
    if (!blocker) position.copy(next);
    else {
      const heading = blocker.path[0]?.clone().sub(blocker.root.position).normalize();
      if (heading && direction.dot(heading) < .8) {
        // A crossing participant takes a short yielding step; stopping in the
        // intersection would otherwise trap both agents at the doorway.
        const away = position.clone().sub(blocker.root.position).normalize();
        position.addScaledVector(away, dt * .65);
        actor.angle = Math.atan2(away.x, away.z); actor.walking = true;
      }
    }
  }
}

export const QUALITY = {
  low:    { scale: .50, fps: 30, shadows: false, mapSize: 512,  lights: 0, maxDpr: 1.35, shadowType: 'basic' },
  medium: { scale: .75, fps: 30, shadows: true,  mapSize: 1024, lights: 2, maxDpr: 1.55, shadowType: 'basic' },
  high:   { scale: 1.00, fps: 60, shadows: true,  mapSize: 1536, lights: 4, maxDpr: 1.85, shadowType: 'soft' },
  ultra:  { scale: 1.00, fps: 60, shadows: true,  mapSize: 2048, lights: 4, maxDpr: 2.25, shadowType: 'soft' }
};

export function initialQuality({ width, memory = 4, cores = 4, dpr = 1, saveData = false }) {
  if (saveData) return 'low';
  if (width <= 600 || memory < 4 || cores <= 4) return 'medium';
  // Start at High even on powerful desktop hardware. Auto mode promotes to
  // Ultra only after sustained measured headroom, avoiding a heavy first frame.
  if (width >= 1000 && memory >= 8 && cores >= 8 && dpr <= 2.5) return 'high';
  return memory >= 6 && cores >= 6 ? 'high' : 'medium';
}

export function adaptiveQuality(current, averageMs) {
  const order = ['low', 'medium', 'high', 'ultra'];
  const index = order.indexOf(current);
  const downThreshold = current === 'ultra' ? 23 : current === 'high' ? 27 : 43;
  const upThreshold = current === 'low' ? 19 : current === 'medium' ? 20 : 15.5;
  if (averageMs > downThreshold && index > 0) return order[index - 1];
  if (averageMs < upThreshold && index >= 0 && index < order.length - 1) return order[index + 1];
  return current;
}
