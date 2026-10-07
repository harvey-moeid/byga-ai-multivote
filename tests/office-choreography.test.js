import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { TEAM, meetingRoute, returnRoute, ambientRoute, shortestAngle, adaptiveQuality, initialQuality, QUALITY, advanceActors } from '../src/office/choreography.js';

describe('office meeting routes', () => {
  it('seats eight analysts and the boss at unique destinations facing the table', () => {
    expect(TEAM.filter(m => !m.boss)).toHaveLength(8);
    expect(TEAM.filter(m => m.boss)).toHaveLength(1);
    expect(new Set(TEAM.map(m => m.seat.join(','))).size).toBe(9);
    for (const member of TEAM) {
      const facing = [Math.sin(member.seatAngle), Math.cos(member.seatAngle)];
      const towardTable = [4.6 - member.seat[0], -3.7 - member.seat[1]];
      expect(facing[0] * towardTable[0] + facing[1] * towardTable[1]).toBeGreaterThan(0);
    }
  });
  it('all routes cross the meeting door and avoid the table footprint', () => {
    for (const member of TEAM) {
      const path = [member.home, ...meetingRoute(member)];
      expect(path).toContainEqual([1.4, -.6]);
      expect(path.at(-1)).toEqual(member.seat);
      for (let i = 1; i < path.length; i++) {
        for (let step = 0; step <= 20; step++) {
          const t = step / 20, x = path[i-1][0] * (1-t) + path[i][0] * t, z = path[i-1][1] * (1-t) + path[i][1] * t;
          expect(x > 2.45 && x < 6.75 && z > -4.61 && z < -2.78).toBe(false);
          expect(x).toBeGreaterThan(-7.7); expect(x).toBeLessThan(7.7);
          expect(z).toBeGreaterThan(-5.8); expect(z).toBeLessThan(5.5);
        }
      }
    }
  });
  it('reverses the walking route to each original desk', () => {
    for (const member of TEAM) {
      expect(returnRoute(member).at(-1)).toEqual(member.home);
      if(!member.boss) expect(returnRoute(member).slice(2,-1)).toEqual(meetingRoute(member).slice(0,-1).reverse());
    }
  });
  it('turns along the shortest arc instead of spinning a full turn', () => {
    expect(Math.abs(shortestAngle(Math.PI-.1, -Math.PI+.1))).toBeCloseTo(.2);
  });
  it.each([1/60,1/30,.075])('resolves doorway traffic and returns everyone without teleporting at dt=%s', dt => {
    const actors=TEAM.map((member,i)=>({
      member,root:{position:new Vector3(member.home[0],.015,member.home[1])},
      path:meetingRoute(member).map(([x,z])=>new Vector3(x,.015,z)),
      sit:1,targetSit:0,delay:i*.45,arrived:false
    }));
    const simulate=()=>{
      for(let frame=0;frame<Math.ceil(60/dt);frame++){
        const previous=actors.map(a=>a.root.position.clone());
        advanceActors(actors,dt);
        actors.forEach((actor,i)=>{
          expect(actor.root.position.distanceTo(previous[i])).toBeLessThanOrEqual(dt*1.32+.041);
          actor.sit=actor.targetSit+(actor.sit-actor.targetSit)*Math.exp(-7*dt);
        });
      }
      expect(actors.every(a=>a.arrived&&a.sit>.97)).toBe(true);
    };
    simulate();
    actors.forEach((a,i)=>{
      expect([a.root.position.x,a.root.position.z]).toEqual(a.member.seat);
      a.path=returnRoute(a.member).map(([x,z])=>new Vector3(x,.015,z));
      a.delay=(8-i)*.5;a.arrived=false;a.targetSit=0;
    });
    simulate();
    actors.forEach(a=>expect([a.root.position.x,a.root.position.z]).toEqual(a.member.home));
  });
});

describe('office ambient routes', () => {
  it('routes boss visits to every analyst workstation through a clear aisle', () => {
    const boss=TEAM.find(member=>member.boss);
    const analysts=TEAM.filter(member=>!member.boss);
    for (const analyst of analysts) {
      const plan=ambientRoute(boss,0,analyst);
      const destination=plan.path.at(-1);
      expect(plan.label).toBe('Mengunjungi meja Analis '+(analyst.id+1));
      expect(plan.targetId).toBe(analyst.id);
      expect(plan.path).toContainEqual([-1,-.6]);
      expect(plan.path).toContainEqual([.35,-.6]);
      expect(destination).toEqual([analyst.home[0],analyst.home[1]+.72]);
      expect(plan.angle).toBe(Math.PI);
      expect(plan.back.at(-1)).toEqual(boss.home);
      expect(Math.hypot(destination[0]-analyst.home[0],destination[1]-analyst.home[1])).toBeCloseTo(.72);

      const route=[boss.home,...plan.path];
      for(let i=1;i<route.length;i++){
        for(let step=0;step<=20;step++){
          const t=step/20;
          const x=route[i-1][0]*(1-t)+route[i][0]*t;
          const z=route[i-1][1]*(1-t)+route[i][1]*t;
          for(const deskX of [-6.1,-4.4,-2.7,-1]){
            for(const deskZ of [.45,3.35]){
              const insideDesk=x>deskX-.82&&x<deskX+.82&&z>deskZ-.56&&z<deskZ+.56;
              expect(insideDesk).toBe(false);
            }
          }
        }
      }
    }
  });

  it('falls back to a real analyst when no explicit visit target is supplied', () => {
    const boss=TEAM.find(member=>member.boss);
    const plan=ambientRoute(boss,0);
    expect(plan.targetId).toBe(0);
    expect(plan.path.at(-1)).toEqual([TEAM[0].home[0],TEAM[0].home[1]+.72]);
  });
});

describe('office quality', () => {
  it('starts phones and constrained devices at a capped tier', () => {
    expect(initialQuality({width:390,memory:8,cores:8})).toBe('medium');
    expect(initialQuality({width:1400,memory:2,cores:8})).toBe('medium');
    expect(initialQuality({width:1400,memory:8,cores:8})).toBe('high');
    expect(QUALITY.low.scale).toBe(.5); expect(QUALITY.medium.scale).toBe(.75); expect(QUALITY.high.scale).toBe(1);
  });
  it('reduces detail under load without going outside the supported tiers', () => {
    expect(adaptiveQuality('high',55)).toBe('medium');
    expect(adaptiveQuality('medium',55)).toBe('low');
    expect(adaptiveQuality('low',55)).toBe('low');
    expect(adaptiveQuality('low',18)).toBe('medium');
    expect(adaptiveQuality('high',18)).toBe('high');
    expect(adaptiveQuality('medium',30)).toBe('medium');
  });
});
