// VR hands (design/vr-hands-plan.md): filtering, the fallback hand ray, who owns a hand, poking panels,
// strike target lock, per-hand tuning and the Gesture Lab sample format.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OneEuro, OneEuroVec3 } from '../../src/input/OneEuro.js';
import { shoulderRay, pinchStrength } from '../../src/input/handRay.js';
import { handOwner, stepPoke, POKE_CFG, BLOCKS_GESTURES } from '../../src/ui/vr/arbiter.js';
import { lockTarget } from '../../src/input/Caster.js';
import { scaledConfig, CAST_CFG, REF_HAND, handLength } from '../../src/input/castGestures.js';
import { validSamples } from '../../server/gesture-samples.js';
import { packJoints, unpackJoints } from '../../src/ui/vr/GestureLab.js';
import { normalizeBindings } from '../../src/party/sheet.js';

describe('One Euro filter', () => {
  it('smooths jitter on a still signal', () => {
    const f = new OneEuro({ minCutoff: 1, beta: 0.5 }); let out = 0;
    for (let i = 0; i < 200; i++) out = f.filter(i % 2 ? 1.01 : 0.99, 1 / 72);
    expect(Math.abs(out - 1)).toBeLessThan(0.005);
  });
  it('follows a fast move closely', () => {
    const f = new OneEuro({ minCutoff: 1, beta: 1.6 }); let out = 0;
    for (let i = 0; i < 36; i++) out = f.filter(i * 0.05, 1 / 72); // 3.6 m/s
    expect(35 * 0.05 - out).toBeLessThan(0.12);
  });
  it('keeps a filtered direction unit length', () => {
    const f = new OneEuroVec3({}, true); const d = f.filter([0, 0, -2], 1 / 72);
    expect(Math.hypot(...d)).toBeCloseTo(1, 6);
  });
});

/** A right hand in front of the chest: knuckles 40 cm ahead of the eyes and 30 cm below. */
const handAt = (x, y, z, s = 1) => ({ 'thumb-phalanx-proximal': { p: [x - 0.02 * s, y, z] }, 'index-finger-phalanx-proximal': { p: [x, y, z - 0.01] }, 'thumb-tip': { p: [x - 0.07 * s, y, z - 0.03] }, 'index-finger-tip': { p: [x, y, z - 0.09] } });
const head = { p: [0, 1.6, 0], right: [1, 0, 0], fwd: [0, 0, -1] };

describe('fallback hand ray (shoulder → pinch point)', () => {
  it('points forward and a little down from a hand held at chest height', () => {
    const r = shoulderRay(handAt(0.18, 1.3, -0.4), head, 'right');
    expect(r.dir[2]).toBeLessThan(-0.8); expect(r.dir[1]).toBeLessThan(0);
  });
  it('barely moves when the fingertips close into a pinch', () => {
    const open = handAt(0.18, 1.3, -0.4), pinched = { ...open, 'thumb-tip': { p: [0.18, 1.3, -0.49] } };
    const a = shoulderRay(open, head, 'right'), b = shoulderRay(pinched, head, 'right');
    expect(a.dir).toEqual(b.dir); // the ray is built from knuckles, not tips
  });
  it('mirrors the shoulder for the left hand and refuses a hand at the shoulder', () => {
    const l = shoulderRay(handAt(-0.18, 1.3, -0.4, -1), head, 'left'); // a mirrored hand (thumb on the other side)
    expect(l.dir[0]).toBeCloseTo(-shoulderRay(handAt(0.18, 1.3, -0.4), head, 'right').dir[0], 6);
    expect(shoulderRay(handAt(0.17, 1.43, 0.065), head, 'right')).toBeNull(); // pinch point right at the shoulder
    expect(shoulderRay({}, head)).toBeNull();
  });
  it('pinch strength runs 0 (open) → 1 (closed)', () => {
    const h = handAt(0, 1, 0);
    expect(pinchStrength(h)).toBe(0);
    expect(pinchStrength({ ...h, 'thumb-tip': { p: [0, 1, -0.09] } })).toBe(1);
  });
});

describe('hand ownership (Touch > Grab > Ray)', () => {
  it('a fingertip at a panel beats holding and the ray; an ongoing drag beats everything', () => {
    expect(handOwner({ tipNear: true, holding: true, rayOnPanel: true })).toBe('touch');
    expect(handOwner({ holding: true, rayOnPanel: true })).toBe('grab');
    expect(handOwner({ rayOnPanel: true, rayOnWorld: true })).toBe('ui');
    expect(handOwner({ dragging: true, tipNear: true })).toBe('drag');
    expect(handOwner({})).toBeNull();
  });
  it('battle gestures wait while a hand works a panel or holds something, not while it points at the room', () => {
    for (const o of ['drag', 'grab', 'touch', 'ui']) expect(BLOCKS_GESTURES.has(o)).toBe(true);
    expect(BLOCKS_GESTURES.has('world')).toBe(false);
  });
});

describe('poking a panel', () => {
  const C = POKE_CFG;
  const walk = (zs, x = 100, y = 100) => { const st = {}; return zs.map((z) => stepPoke(st, z == null ? null : { x, y: typeof y === 'function' ? y(z) : y, z })?.type ?? null); };
  it('hover → contact → lift is a tap at the contact point', () => {
    const ev = walk([0.05, 0.02, 0.003, 0.0, 0.02]);
    expect(ev).toEqual([null, 'hover', 'contact', null, 'tap']);
  });
  it('does not tap again until the finger pulls back past the release distance', () => {
    const st = {}, at = (z) => stepPoke(st, { x: 5, y: 5, z })?.type ?? null;
    expect(at(0.0)).toBe('contact'); expect(at(0.01)).toBeNull(); expect(at(0.0)).toBeNull(); // jitter while touching: one press
    expect(at(0.02)).toBe('tap'); expect(at(C.press - 0.001)).toBe('contact');
  });
  it('dragging a touching finger up the panel scrolls instead of tapping', () => {
    const st = {}, ev = [];
    ev.push(stepPoke(st, { x: 100, y: 300, z: 0 })?.type);
    for (let y = 290; y >= 200; y -= 10) ev.push(stepPoke(st, { x: 100, y, z: 0 })?.type);
    ev.push(stepPoke(st, { x: 100, y: 200, z: 0.03 })?.type);
    expect(ev[0]).toBe('contact'); expect(ev).toContain('scroll'); expect(ev.at(-1)).toBe('lift');
  });
  it('leaving the panel while touching is a lift, not a tap', () => {
    const st = {}; stepPoke(st, { x: 1, y: 1, z: 0 });
    expect(stepPoke(st, null)?.type).toBe('lift');
  });
});

describe('strike target lock', () => {
  const o = new THREE.Vector3(0, 1.4, 0), fwd = new THREE.Vector3(0, 0, -1);
  it('locks the target the hand points closest to', () => {
    const pts = [new THREE.Vector3(-1, 1, -3), new THREE.Vector3(0.2, 1, -3)];
    expect(lockTarget(pts, o, fwd).idx).toBe(1);
  });
  it('with several targets, refuses a hand pointing well away from all of them', () => {
    const pts = [new THREE.Vector3(-3, 1, -1), new THREE.Vector3(3, 1, -1)];
    expect(lockTarget(pts, o, fwd)).toBeNull();
  });
  it('with one target, roughly forward is enough', () => {
    expect(lockTarget([new THREE.Vector3(2, 1, -2.5)], o, fwd)?.idx).toBe(0);
    expect(lockTarget([new THREE.Vector3(0, 1, 3)], o, fwd)).toBeNull(); // behind you
  });
});

describe('per-hand tuning', () => {
  it('scales the distance thresholds with hand size, within limits', () => {
    const big = scaledConfig(CAST_CFG, REF_HAND * 1.2), huge = scaledConfig(CAST_CFG, REF_HAND * 3);
    expect(big.thumbOut).toBeCloseTo(CAST_CFG.thumbOut * 1.2, 6); expect(big.flickSpeed).toBe(CAST_CFG.flickSpeed);
    expect(huge.pinchGuard).toBeCloseTo(CAST_CFG.pinchGuard * 1.3, 6);
    expect(scaledConfig(CAST_CFG, null)).toBe(CAST_CFG);
  });
  it('measures a hand from wrist to middle knuckle', () => {
    expect(handLength({ wrist: { p: [0, 0, 0] }, 'middle-finger-phalanx-proximal': { p: [0, 0, -0.09] } })).toBeCloseTo(0.09, 6);
  });
});

describe('Gesture Lab samples', () => {
  it('round-trips joints at millimetre precision', () => {
    const j = { wrist: { p: [0.12345, 1.00049, -0.3] } };
    expect(unpackJoints(packJoints(j)).wrist.p).toEqual([0.123, 1, -0.3]);
  });
  it('the dev endpoint accepts lab files and rejects anything else', () => {
    expect(validSamples({ kind: 'gesture-samples', segments: [{ label: 'point', frames: [] }] })).toBe(true);
    expect(validSamples({ kind: 'gesture-samples', segments: [{ label: '../etc', frames: [] }] })).toBe(false);
    expect(validSamples({ kind: 'other', segments: [] })).toBe(false);
    expect(validSamples(null)).toBe(false);
  });
});

describe('renamed signs', () => {
  it('old saved sheets keep their horns binding, now as slash', () => {
    expect(normalizeBindings([{ gesture: 'horns', effectId: 'weapon-strike' }])).toEqual([{ gesture: 'slash', effectId: 'weapon-strike', label: '', roll: '' }]);
  });
});
