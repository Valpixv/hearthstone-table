import { describe, it, expect } from 'vitest';
import { hand, recordHands, ballisticVelocity, GRAVITY } from '../../harness/synth/hand.js';
import { anchorLocal, resolvePose } from '../../harness/synth/skeleton.js';
import { SCRIPTS } from '../../harness/synth/scripts/index.js';
import { validateRecording } from '../../harness/format/recording.js';
import { BONES } from '../../harness/format/joints.js';
import { add, dist, qRotate } from '../../harness/math.js';
import { isPinching, isFist, grabPoint, averageVelocity, clampLength } from '../../src/input/gestures.js';

const anchorWorld = (rec, frameIdx, anchor, side = 'right') => {
  const j = rec.frames[frameIdx][side];
  // grip / pinch-grip are what the app's grabPoint() returns for the closed hand
  if (anchor === 'grip' || anchor === 'pinch-grip') return grabPoint(j);
  return j[anchor].p;
};

describe('synthetic hand skeleton', () => {
  it('is an adult-sized hand (~18-19 cm wrist to middle fingertip)', () => {
    const rec = hand('right').at([0, 1, 0]).record({ fps: 10, tail: 0 });
    const j = rec.frames[0].right;
    const len = dist(j.wrist.p, j['middle-finger-tip'].p);
    expect(len).toBeGreaterThan(0.175);
    expect(len).toBeLessThan(0.2);
  });

  it('keeps bone lengths constant through every gesture', () => {
    const rec = hand('right').at([0, 1, 0]).fist(0.2).pinch(0.2).point(0.2).curl(0.5, 0.2).open(0.2).record({ fps: 30 });
    const ref = rec.frames[0].right;
    for (const f of rec.frames) {
      for (const [a, b] of BONES) {
        expect(Math.abs(dist(f.right[a].p, f.right[b].p) - dist(ref[a].p, ref[b].p)), `${a}->${b}`).toBeLessThan(0.0015);
      }
    }
  });

  it('gesture primitives produce the poses the app recognises', () => {
    const at = (fn) => fn(hand('right').at([0, 1, 0])).record({ fps: 30, tail: 0 }).frames.at(-1).right;
    expect(isPinching(at((h) => h.pinch()), false)).toBe(true);
    expect(isFist(at((h) => h.fist()))).toBe(true);
    expect(isFist(at((h) => h.grab()))).toBe(true);
    expect(isFist(at((h) => h.fist().open()))).toBe(false);
    expect(isPinching(at((h) => h.pinch().releasePinch()), false)).toBe(false);
  });

  it('mirrors cleanly for the left hand', () => {
    const r = hand('right').at([0, 1, 0]).pinch().record({ fps: 30, tail: 0 }).frames.at(-1).right;
    const l = hand('left').at([0, 1, 0]).pinch().record({ fps: 30, tail: 0 }).frames.at(-1).left;
    expect(l['thumb-tip'].p[0]).toBeCloseTo(-r['thumb-tip'].p[0], 4);
    expect(l['thumb-tip'].p[1]).toBeCloseTo(r['thumb-tip'].p[1], 4);
    expect(isPinching(l, false)).toBe(true);
  });
});

describe('motion primitives', () => {
  it('moveTo lands the chosen anchor on the target', () => {
    const target = [0.2, 0.9, 0.1];
    for (const anchor of ['palm', 'wrist', 'index-finger-tip', 'grip']) {
      const h = hand('right').at([0, 1, 0.4]).moveTo(target, 0.4, { anchor, pose: anchor === 'grip' ? 'fist' : undefined });
      const s = h.stateAt(h.duration);
      const p = add(s.wrist, qRotate(s.rot, anchorLocal(s.pose, anchor, 'right')));
      expect(dist(p, target), anchor).toBeLessThan(1e-9);
    }
  });

  it('moves smoothly (no teleports between frames)', () => {
    const rec = hand('right').at([0, 1, 0.4]).moveTo([0.3, 0.9, 0], 0.5).arcThrow([0.3, 0.9, 0], [0.5, 0.8, -0.3], 2.5).record({ fps: 72 });
    for (let i = 1; i < rec.frames.length; i++) {
      // 4 m/s hand speed limit => < 6 cm per frame
      expect(dist(rec.frames[i].right.wrist.p, rec.frames[i - 1].right.wrist.p)).toBeLessThan(0.06);
    }
  });

  it('ballisticVelocity hits the target (checked by integrating the flight)', () => {
    for (const [from, to, speed, arc] of [
      [[0, 1, 0.3], [0.42, 0.79, 0.05], 3, 'low'],
      [[0, 1, 0.3], [0.42, 0.79, 0.05], 3, 'high'],
      [[0, 0.9, 0.3], [0.5, 0.8, -0.2], 2.8, 'low'],
    ]) {
      const { v } = ballisticVelocity(from, to, speed, { arc });
      expect(Math.hypot(...v)).toBeCloseTo(speed, 6);
      const horiz = Math.hypot(to[0] - from[0], to[2] - from[2]);
      const T = horiz / Math.hypot(v[0], v[2]);
      const land = [from[0] + v[0] * T, from[1] + v[1] * T - 0.5 * GRAVITY * T * T, from[2] + v[2] * T];
      expect(dist(land, to)).toBeLessThan(1e-6);
    }
    expect(ballisticVelocity([0, 1, 0], [5, 1, 0], 1).clamped).toBe(true);
  });

  it('arcThrow releases at the planned velocity as measured by the app (5-frame average)', () => {
    const die = [0, 0.797, 0.33];
    const tray = [0.42, 0.79, 0.05];
    const rec = hand('right').at([0, 0.857, 0.33], { anchor: 'grip' }).grab(0.2).arcThrow(die, tray, 3.0).record({ fps: 72 });
    // Replay the app's own grab logic on the frames.
    let was = false, pinching = false, released = null;
    const hist = [];
    rec.frames.forEach((f, i) => {
      const j = f.right;
      pinching = isPinching(j, pinching);
      const g = pinching || isFist(j);
      hist.push({ p: grabPoint(j), t: i / 72 });
      if (hist.length > 8) hist.shift();
      if (was && !g && !released) released = { v: clampLength(averageVelocity(hist, 5), 4), p: grabPoint(j) };
      was = g;
    });
    expect(released).not.toBeNull();
    const speed = Math.hypot(...released.v);
    expect(speed).toBeGreaterThan(2.6);
    expect(speed).toBeLessThan(3.4);
    // Integrate the flight from the actual release point: should land within the tray (±20 cm).
    const v = released.v, p0 = released.p;
    const a = 0.5 * GRAVITY, b = -v[1], c = tray[1] - p0[1];
    const T = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
    const land = [p0[0] + v[0] * T, tray[1], p0[2] + v[2] * T];
    expect(Math.abs(land[0] - tray[0])).toBeLessThan(0.2);
    expect(Math.abs(land[2] - tray[2])).toBeLessThan(0.2);
  });

  it('poke drives the index tip through the target and back', () => {
    const target = [0, 0.8, 0.3];
    const h = hand('right').at([0, 1, 0.6], { rot: [-18, 0, 0] }).poke(target);
    const rec = h.record({ fps: 72 });
    const d = rec.frames.map((f) => dist(f.right['index-finger-tip'].p, target));
    expect(Math.min(...d)).toBeLessThan(0.03);
    expect(d.at(-1)).toBeGreaterThan(0.05);
    rec.frames.forEach((f) => expect(grabPoint(f.right) && isPinching(f.right, false)).toBe(false));
  });
});

describe('noise', () => {
  const base = () => hand('right').at([0, 1, 0]).fist().wait(1);
  it('is deterministic for a seed and different across seeds', () => {
    const a = base().noise({ jitter: 0.003, seed: 1 }).record();
    const b = base().noise({ jitter: 0.003, seed: 1 }).record();
    const c = base().noise({ jitter: 0.003, seed: 2 }).record();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('has roughly the requested magnitude', () => {
    const clean = base().record();
    const noisy = base().noise({ jitter: 0.003, seed: 3 }).record();
    const errs = noisy.frames.flatMap((f, i) => [dist(f.right['index-finger-tip'].p, clean.frames[i].right['index-finger-tip'].p)]);
    const rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
    expect(rms).toBeGreaterThan(0.003); // 3-D error of 3 mm/axis ≈ 5.2 mm
    expect(rms).toBeLessThan(0.008);
  });

  it('dropouts remove the hand for whole frames', () => {
    const rec = base().noise({ dropoutProb: 0.1, dropoutFrames: 2, seed: 4 }).record();
    const missing = rec.frames.filter((f) => !f.right).length;
    expect(missing).toBeGreaterThan(4);
    expect(validateRecording(rec).ok).toBe(true);
  });
});

describe('canned scripts', () => {
  it.each(Object.keys(SCRIPTS))('%s builds a valid, deterministic recording', async (name) => {
    const mod = await SCRIPTS[name]();
    const a = mod.default();
    expect(validateRecording(a).errors).toEqual([]);
    expect(a.meta.name).toBe(name);
    expect(a.frames.length).toBeGreaterThan(60);
    expect(JSON.stringify(mod.default())).toBe(JSON.stringify(a));
  });

  it('two-hand-grab drives both hands', async () => {
    const rec = (await SCRIPTS['two-hand-grab']()).default();
    expect(rec.frames.every((f) => f.left && f.right)).toBe(true);
  });

  it('point/poke and flick never look like a grab to the app near the die', async () => {
    for (const name of ['poke-die', 'flick-die']) {
      const rec = (await SCRIPTS[name]()).default();
      const die = rec.meta.setup.dice[0].pos;
      let pinching = false;
      rec.frames.forEach((f, i) => {
        pinching = isPinching(f.right, pinching);
        const grabbing = pinching || isFist(f.right);
        if (grabbing) expect(dist(grabPoint(f.right), die), `${name} frame ${i}`).toBeGreaterThan(0.09);
      });
    }
  });
});

describe('pose resolution', () => {
  it('rejects unknown poses and anchors', () => {
    expect(() => resolvePose('jazz-hands')).toThrow(/unknown pose/);
    expect(() => anchorLocal(resolvePose('open'), 'elbow', 'right')).toThrow(/unknown anchor/);
  });
  it('recordHands rejects two scripts for the same hand', () => {
    expect(() => recordHands([hand('right'), hand('right')])).toThrow(/two scripts/);
  });
});
