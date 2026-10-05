import { describe, expect, it } from 'vitest';
import { QUALITY, adaptiveQuality, initialQuality } from '../src/office/choreography.js';

describe('adaptive 3D quality', () => {
  it('exposes low, medium, high and ultra tiers', () => {
    expect(Object.keys(QUALITY)).toEqual(['low','medium','high','ultra']);
    expect(QUALITY.ultra.maxDpr).toBeGreaterThan(QUALITY.high.maxDpr);
  });

  it('starts conservatively on phones and constrained devices', () => {
    expect(initialQuality({width:390,memory:8,cores:8,dpr:2})).toBe('medium');
    expect(initialQuality({width:1440,memory:3,cores:8,dpr:2})).toBe('medium');
    expect(initialQuality({width:1440,memory:16,cores:12,dpr:2,saveData:true})).toBe('low');
  });

  it('starts capable desktops at high and lets Auto earn Ultra', () => {
    expect(initialQuality({width:1440,memory:8,cores:8,dpr:2})).toBe('high');
    expect(adaptiveQuality('high',12)).toBe('ultra');
  });

  it('moves down under pressure and recovers with headroom', () => {
    expect(adaptiveQuality('ultra',30)).toBe('high');
    expect(adaptiveQuality('high',35)).toBe('medium');
    expect(adaptiveQuality('medium',12)).toBe('high');
    expect(adaptiveQuality('low',18)).toBe('medium');
  });
});
