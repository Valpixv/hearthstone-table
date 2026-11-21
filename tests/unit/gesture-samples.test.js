// Replays Gesture Lab sample files through the battle-gesture tracker (design/vr-hands-plan.md §5).
// A synthetic file built from the harness skeleton always runs; real recordings in recordings/gestures/ run too
// when present, so a change that breaks recognition on recorded hands fails here.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CAST_CFG } from '../../src/input/castGestures.js';
import { scoreTuning, replaySegment, tune } from '../../src/input/gestureScore.js';
import { packJoints } from '../../src/ui/vr/GestureLab.js';
import { POSE_SPECS, resolvePose } from '../../harness/synth/skeleton.js';
import { handInPose } from '../helpers/hands.js';

const RATE = 36, REPS = 8;
const SPECS = { point: POSE_SPECS.point, gun: { flex: { ...POSE_SPECS.point.flex }, spread: POSE_SPECS.point.spread, thumb: { mode: 'rest' } }, open: POSE_SPECS.open, fist: POSE_SPECS.fist, pinch: POSE_SPECS.pinch };
const pose = (n) => handInPose(resolvePose(SPECS[n]));
const moved = (h, d) => Object.fromEntries(Object.entries(h).map(([k, j]) => [k, { ...j, p: [j.p[0] + d[0], j.p[1] + d[1], j.p[2] + d[2]] }]));

/** Builds a segment: a list of [hand, seconds] holds and [hand, [dx,dy,dz] per frame, frames] moves, sampled at 36 Hz. */
function segment(label, parts) {
  const frames = []; let t = 0;
  for (const part of parts) {
    if (part.move) for (let i = 1; i <= part.frames; i++) { t += 1 / RATE; frames.push({ t: +t.toFixed(3), right: packJoints(moved(part.hand, part.move.map((v) => v * i))) }); }
    else for (let i = 0; i < Math.round(part.secs * RATE); i++) { t += 1 / RATE; frames.push({ t: +t.toFixed(3), right: packJoints(part.hand) }); }
  }
  return { label, frames, fires: [] };
}
const rest = { hand: pose('fist'), secs: 0.7 };
function synthetic() {
  const P = pose('point'), G = pose('gun'), O = pose('open');
  const reps = (fn) => Array.from({ length: REPS }, fn).flat();
  return { kind: 'gesture-samples', version: 1, segments: [
    segment('point', reps(() => [{ hand: P, secs: 0.4 }, { hand: P, move: [0, 0, -0.04], frames: 4 }, rest])),
    segment('gun', reps(() => [{ hand: G, secs: 0.4 }, { hand: P, secs: 0.15 }, rest])),
    segment('palm', reps(() => [{ hand: O, secs: 0.4 }, { hand: O, move: [0, -0.04, 0], frames: 4 }, rest])),
    segment('slash', reps(() => [{ hand: O, secs: 0.4 }, { hand: O, move: [0.05, 0, 0], frames: 4 }, rest])),
    // Ordinary movement: reaching with a fist, pinching dice, an open hand drifting about slowly.
    segment('idle', [{ hand: pose('fist'), move: [0.01, 0, -0.01], frames: 40 }, { hand: pose('pinch'), secs: 1 }, { hand: pose('pinch'), move: [0, 0, -0.04], frames: 6 },
      { hand: O, move: [0.004, 0.002, 0], frames: 60 }, { hand: P, move: [0, 0.003, 0], frames: 40 }, rest]),
  ] };
}

describe('gesture replay (synthetic hands)', () => {
  const file = synthetic();
  it('catches every sign and fires nothing during ordinary movement', () => {
    const s = scoreTuning([file], CAST_CFG, { reps: REPS });
    for (const g of ['point', 'gun', 'palm', 'slash']) expect(s.per[g].hits).toBeGreaterThanOrEqual(REPS - 1);
    expect(s.wrong).toBe(0); expect(s.idle).toBe(0);
  });
  it('a slash segment never reads as a palm push (and the other way round)', () => {
    expect(replaySegment(file.segments[3], CAST_CFG)).not.toContain('palm');
    expect(replaySegment(file.segments[2], CAST_CFG)).not.toContain('slash');
  });
  it('the tuner never makes the score worse', () => {
    const r = tune([file], CAST_CFG, { passes: 1 });
    expect(r.after.score).toBeGreaterThanOrEqual(r.before.score);
  });
});

const DIR = resolve(process.cwd(), 'recordings/gestures');
const real = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')) : [];
describe.skipIf(!real.length)('gesture replay (recorded hands)', () => {
  it('the current tuning catches most recorded signs with few false fires', () => {
    const files = real.map((f) => JSON.parse(readFileSync(resolve(DIR, f), 'utf8')));
    const s = scoreTuning(files, CAST_CFG);
    expect(s.hits / Math.max(1, s.wanted)).toBeGreaterThanOrEqual(0.6);
    expect(s.idle).toBeLessThanOrEqual(2 * files.length);
  });
});
