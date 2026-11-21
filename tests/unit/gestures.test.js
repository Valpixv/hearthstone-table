import { describe, it, expect } from 'vitest';
import {
  isPinching, isFist, pinchDistance, grabPoint, palmUp, averageVelocity, PINCH_ON, PINCH_OFF,
} from '../../src/input/gestures.js';
import { handInPose, curledHand, withPinchDistance } from '../helpers/hands.js';
import { hand } from '../../harness/synth/hand.js';
import { mulberry32, gaussian } from '../../harness/rng.js';

/** Run isPinching over a sequence of hands the way InputManager does (state carried frame to frame). */
function pinchTrace(hands) {
  let was = false;
  return hands.map((h) => (was = isPinching(h, was)));
}
const transitions = (xs) => xs.slice(1).filter((x, i) => x !== xs[i]).length;
/** InputManager's grab rule: grabbing = pinching || (!pinching && isFist). */
const grabbing = (h, wasPinching = false) => isPinching(h, wasPinching) || isFist(h);

describe('pinch detection', () => {
  const open = handInPose('open');

  it('is true below the on-threshold and false above the off-threshold', () => {
    for (const d of [0.005, 0.01, 0.015, PINCH_ON - 0.001]) expect(isPinching(withPinchDistance(open, d), false)).toBe(true);
    for (const d of [PINCH_ON + 0.001, 0.03, 0.05]) expect(isPinching(withPinchDistance(open, d), false)).toBe(false);
    for (const d of [PINCH_OFF + 0.001, 0.06]) expect(isPinching(withPinchDistance(open, d), true)).toBe(false);
  });

  it('has hysteresis: a held pinch survives distances between the thresholds', () => {
    const mid = (PINCH_ON + PINCH_OFF) / 2;
    expect(isPinching(withPinchDistance(open, mid), true)).toBe(true);
    expect(isPinching(withPinchDistance(open, mid), false)).toBe(false);
    expect(PINCH_OFF).toBeGreaterThan(PINCH_ON);
  });

  it('does not flicker when the distance jitters around the on-threshold', () => {
    const rand = gaussian(mulberry32(1));
    // Close from 4 cm to the threshold, then hover at PINCH_ON ± 3 mm noise for 2 s.
    const ds = [0.04, 0.03, 0.025, ...Array.from({ length: 144 }, () => PINCH_ON + rand() * 0.003)];
    const trace = pinchTrace(ds.map((d) => withPinchDistance(open, Math.max(0.001, d))));
    expect(trace.at(-1)).toBe(true);
    expect(transitions(trace)).toBe(1); // turns on once, never back off
  });

  it('does not flicker when the distance jitters around the off-threshold', () => {
    const rand = gaussian(mulberry32(2));
    const ds = [0.005, 0.01, ...Array.from({ length: 144 }, (_, i) => (i < 72 ? 0.028 : PINCH_OFF + 0.004) + rand() * 0.002)];
    const trace = pinchTrace(ds.map((d) => withPinchDistance(open, d)));
    expect(transitions(trace)).toBe(1); // on at the start, off once released, no re-trigger
    expect(trace.at(-1)).toBe(false);
  });

  it('recognises the synthetic pinch gesture and its release', () => {
    const rec = hand('right').at([0, 1, 0.3]).pinch(0.25).wait(0.2).releasePinch(0.25).wait(0.1).record({ fps: 72 });
    const trace = pinchTrace(rec.frames.map((f) => f.right));
    expect(trace[0]).toBe(false);
    expect(trace.some(Boolean)).toBe(true);
    expect(trace.at(-1)).toBe(false);
    expect(transitions(trace)).toBe(2);
    expect(pinchDistance(handInPose('pinch'))).toBeLessThan(PINCH_ON);
  });
});

describe('grab (fist) detection', () => {
  it('fist = grab, open hand = none', () => {
    expect(isFist(handInPose('fist'))).toBe(true);
    expect(grabbing(handInPose('fist'))).toBe(true);
    expect(isFist(handInPose('open'))).toBe(false);
    expect(grabbing(handInPose('open'))).toBe(false);
  });

  it('works for the left hand and any wrist orientation', () => {
    for (const handedness of ['left', 'right']) {
      for (const rot of [[0, 0, 0], [0, 90, 0], [-60, 30, 180], [45, -120, 90]]) {
        expect(isFist(handInPose('fist', { handedness, rot }))).toBe(true);
        expect(isFist(handInPose('open', { handedness, rot }))).toBe(false);
      }
    }
  });

  it('half-curl sits at the boundary: one clean transition from open to fist', () => {
    const ks = Array.from({ length: 101 }, (_, i) => i / 100);
    const fist = ks.map((k) => isFist(curledHand(k)));
    expect(fist[0]).toBe(false);
    expect(fist.at(-1)).toBe(true);
    expect(transitions(fist)).toBe(1);
    const boundary = ks[fist.indexOf(true)];
    // A half-curled hand (k = 0.5) is not yet a grab; the boundary is in the upper half of the curl.
    expect(isFist(curledHand(0.5))).toBe(false);
    expect(boundary).toBeGreaterThan(0.55);
    expect(boundary).toBeLessThan(0.9);
  });

  it('pointing is not mistaken for a pinch-grab', () => {
    const point = handInPose('point');
    expect(isPinching(point, false)).toBe(false);
    expect(pinchDistance(point)).toBeGreaterThan(0.06); // grabPoint falls back to the palm, far from the fingertip
  });

  it('pointing (index straight, others curled) is not a fist, for either hand', () => {
    for (const handedness of ['left', 'right']) {
      const point = handInPose('point', { handedness });
      expect(isFist(point)).toBe(false);
      expect(grabbing(point)).toBe(false);
    }
    // ...but curling the index back in makes it one.
    expect(isFist(handInPose('fist'))).toBe(true);
  });

  it('a closed fist holds the die at the thumb/index midpoint, near the palm', () => {
    const fist = handInPose('fist');
    const gp = grabPoint(fist);
    const wrist = fist.wrist.p;
    const d = Math.hypot(gp[0] - wrist[0], gp[1] - wrist[1], gp[2] - wrist[2]);
    expect(d).toBeGreaterThan(0.04);
    expect(d).toBeLessThan(0.12);
  });
});

describe('palm orientation', () => {
  it('palmUp is true only when the palm faces the sky (both hands)', () => {
    for (const handedness of ['left', 'right']) {
      expect(palmUp(handInPose('open', { handedness }), handedness)).toBe(false); // palm down on the table
      expect(palmUp(handInPose('open', { handedness, rot: [0, 0, 180] }), handedness)).toBe(true); // rolled over
    }
  });
});

describe('throw velocity', () => {
  const history = (v, n, { t0 = 0, dt = 1 / 72, noise = 0, seed = 1 } = {}) => {
    const rand = gaussian(mulberry32(seed));
    return Array.from({ length: n }, (_, i) => ({
      t: t0 + i * dt,
      p: [i * dt * v[0] + rand() * noise, 1 + i * dt * v[1] + rand() * noise, i * dt * v[2] + rand() * noise],
    }));
  };

  it('averages the last 5 frame deltas into the expected vector', () => {
    const v = averageVelocity(history([1.2, 0.8, -2.0], 8), 5);
    expect(v[0]).toBeCloseTo(1.2, 6);
    expect(v[1]).toBeCloseTo(0.8, 6);
    expect(v[2]).toBeCloseTo(-2.0, 6);
  });

  it('only uses the newest frames (older motion is ignored)', () => {
    const slow = history([0, 0, 0], 4);
    const fast = history([3, 0, 0], 6, { t0: slow.at(-1).t + 1 / 72 }).map((h) => ({ ...h, p: [h.p[0] + 0, h.p[1], h.p[2]] }));
    const v = averageVelocity([...slow, ...fast], 5);
    expect(v[0]).toBeCloseTo(3, 4);
  });

  it('stays within tolerance under 2 mm tracking jitter', () => {
    const v = averageVelocity(history([2.5, 1.0, -1.5], 8, { noise: 0.002, seed: 9 }), 5);
    const err = Math.hypot(v[0] - 2.5, v[1] - 1.0, v[2] + 1.5);
    expect(err).toBeLessThan(0.25); // 2 mm noise over 5/72 s ≈ ±0.04 m/s per sample, well inside 10%
  });

  it('handles degenerate histories', () => {
    expect(averageVelocity([], 5)).toEqual([0, 0, 0]);
    expect(averageVelocity([{ p: [0, 0, 0], t: 0 }], 5)).toEqual([0, 0, 0]);
  });
});
