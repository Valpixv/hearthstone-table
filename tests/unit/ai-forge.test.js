import { describe, it, expect } from 'vitest';
import { shapePrompt, pickProviders } from '../../server/ai-forge.js';
import { cutBackground } from '../../src/ai/forgeMeshes.js';

describe('AI Forge prompt shaping', () => {
  it('asks for one isolated subject on white for image-to-3D', () => {
    const p = shapePrompt('creature', 'a moss troll');
    expect(p.startsWith('a moss troll,')).toBe(true);
    expect(p).toContain('plain pure white background');
    expect(p).toContain('full body');
  });
  it('only ever shapes a creature prompt (no backdrops, items or icons)', () => {
    for (const k of ['backdrop', 'item', 'icon', 'avatar']) expect(shapePrompt(k, 'elven ruins')).toContain('a single fantasy creature');
  });
  it('caps prompt length', () => {
    expect(shapePrompt('item', 'x'.repeat(1000)).indexOf(',')).toBe(400);
  });
});

describe('AI Forge provider choice', () => {
  it('works with no keys: free images, standee models', () => {
    expect(pickProviders({})).toEqual({ image: 'pollinations', model: 'standee', rig: 'none' });
  });
  it('prefers fal when its key is set', () => {
    expect(pickProviders({ FAL_KEY: 'k', MESHY_API_KEY: 'm' })).toEqual({ image: 'fal', model: 'fal', rig: 'none' });
  });
  it('uses meshy for 3D when only its key is set', () => {
    expect(pickProviders({ MESHY_API_KEY: 'm' }).model).toBe('meshy');
  });
  it('honours explicit overrides', () => {
    expect(pickProviders({ FAL_KEY: 'k', AI_IMAGE: 'mock', AI_MODEL: 'mock' })).toEqual({ image: 'mock', model: 'mock', rig: 'none' });
  });
});

describe('cutBackground', () => {
  // 6x6 white image with a 2x2 red square at (2,2).
  const make = () => { const d = new Uint8ClampedArray(6 * 6 * 4).fill(255); for (const [x, y] of [[2, 2], [3, 2], [2, 3], [3, 3]]) d.set([200, 0, 0, 255], (y * 6 + x) * 4); return d; };
  it('clears the white border-connected background and keeps the subject', () => {
    const d = make(), box = cutBackground(d, 6, 6);
    expect(box).toEqual({ x: 2, y: 2, w: 2, h: 2 });
    expect(d[3]).toBe(0);                    // corner now transparent
    expect(d[(2 * 6 + 2) * 4 + 3]).toBe(255); // subject opaque
  });
  it('returns the whole image when nothing is left', () => {
    const d = new Uint8ClampedArray(4 * 4 * 4).fill(255);
    expect(cutBackground(d, 4, 4)).toEqual({ x: 0, y: 0, w: 4, h: 4 });
  });
});
