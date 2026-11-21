// Gesture spells (design/feature-expansion-plan.md §6): shape classifier and the casting state machine,
// on hands from the harness skeleton (the same forward kinematics the replay tests use).
import { describe, it, expect } from 'vitest';
import { fingerStates, classify, GestureTracker, CAST_CFG } from '../../src/input/castGestures.js';
import { POSE_SPECS, resolvePose } from '../../harness/synth/skeleton.js';
import { handInPose, withPinchDistance } from '../helpers/hands.js';

const FIST = [85, 100, 60], STRAIGHT = [0, 0, 0];
const SPECS = {
  point: POSE_SPECS.point,
  gun: { flex: { ...POSE_SPECS.point.flex }, spread: POSE_SPECS.point.spread, thumb: { mode: 'rest' } },
  palm: POSE_SPECS.open,
  horns: { flex: { 'index-finger': STRAIGHT, 'middle-finger': FIST, 'ring-finger': FIST, 'pinky-finger': STRAIGHT }, spread: POSE_SPECS.point.spread, thumb: { mode: 'wrap', over: ['middle-finger', 'ring-finger'] } },
  fist: POSE_SPECS.fist,
  pinch: POSE_SPECS.pinch,
};
const pose = (name, opts) => handInPose(resolvePose(SPECS[name]), opts);
const shapeOf = (h) => classify(fingerStates(h));
const moved = (h, d) => Object.fromEntries(Object.entries(h).map(([k, j]) => [k, { ...j, p: [j.p[0] + d[0], j.p[1] + d[1], j.p[2] + d[2]] }]));

describe('shape classifier', () => {
  it('recognises the three cast shapes (the open hand fires as palm or slash)', () => {
    for (const s of ['point', 'gun', 'palm']) expect(shapeOf(pose(s))).toBe(s);
  });
  it('no longer casts from the old horns sign (unreliable on Quest tracking)', () => {
    expect(shapeOf(pose('horns'))).toBeNull();
  });
  it('never casts from a fist or a pinch (those grab dice)', () => {
    expect(shapeOf(pose('fist'))).toBeNull();
    expect(shapeOf(pose('pinch'))).toBeNull();
    expect(shapeOf(withPinchDistance(pose('palm'), 0.01))).toBeNull();
  });
  it('works for the left hand too', () => {
    for (const s of ['point', 'gun', 'palm']) expect(shapeOf(pose(s, { handedness: 'left' }))).toBe(s);
  });
});

/** Feeds frames at 72 fps; returns the first fire event (or null). */
function run(tracker, frames) {
  for (const h of frames) { const r = tracker.update(h, 1 / 72); if (r.fire) return r.fire; }
  return null;
}
const hold = (h, s) => Array.from({ length: Math.ceil(s * 72) }, () => h);

describe('casting', () => {
  it('point: hold, then flick forward fires along the index', () => {
    const h = pose('point'), t = new GestureTracker('right');
    // The index points along -z for the default (palm-down, fingers forward) hand.
    const flick = Array.from({ length: 6 }, (_, i) => moved(h, [0, 0, -0.04 * (i + 1)]));
    const f = run(t, [...hold(h, CAST_CFG.hold + 0.05), ...flick]);
    expect(f?.gesture).toBe('point');
    expect(f.dir[2]).toBeLessThan(-0.5);
  });
  it('point held still never fires', () => {
    expect(run(new GestureTracker('right'), hold(pose('point'), 2))).toBeNull();
  });
  it('a quick pass through the shape (shorter than the hold) does not arm', () => {
    const h = pose('point'), flick = Array.from({ length: 6 }, (_, i) => moved(h, [0, 0, -0.04 * (i + 1)]));
    expect(run(new GestureTracker('right'), [...hold(h, CAST_CFG.hold * 0.5), ...flick])).toBeNull();
  });
  it('gun: dropping the thumb fires without moving the hand', () => {
    const f = run(new GestureTracker('right'), [...hold(pose('gun'), CAST_CFG.hold + 0.05), ...hold(pose('point'), 0.1)]);
    expect(f?.gesture).toBe('gun');
  });
  it('palm: pushing the open palm toward where it faces fires', () => {
    // Palm-down hand: the palm faces -y, so a push is a downward shove.
    const h = pose('palm'), push = Array.from({ length: 6 }, (_, i) => moved(h, [0, -0.03 * (i + 1), 0]));
    const f = run(new GestureTracker('right'), [...hold(h, CAST_CFG.hold + 0.05), ...push]);
    expect(f?.gesture).toBe('palm'); expect(f.dir[1]).toBeLessThan(-0.5);
  });
  it('slash: swiping the open hand edge-first fires a slash, not a push', () => {
    // Palm-down right hand: the knuckle line (index → pinky) runs along +x, so a slash is a fast sideways swipe.
    const h = pose('palm'), swipe = Array.from({ length: 6 }, (_, i) => moved(h, [0.035 * (i + 1), 0, 0]));
    expect(run(new GestureTracker('right'), [...hold(h, CAST_CFG.hold + 0.05), ...swipe])?.gesture).toBe('slash');
  });
  it('a slow sideways drift of the open hand fires nothing', () => {
    const h = pose('palm'), drift = Array.from({ length: 30 }, (_, i) => moved(h, [0.004 * (i + 1), 0, 0]));
    expect(run(new GestureTracker('right'), [...hold(h, CAST_CFG.hold + 0.05), ...drift])).toBeNull();
  });
  it('blocked (holding a die / cast mode off) never fires, and cools down after a cast', () => {
    const h = pose('gun'), t = new GestureTracker('right');
    for (const fr of [...hold(h, 1), ...hold(pose('point'), 0.1)]) expect(t.update(fr, 1 / 72, { blocked: true }).fire).toBeNull();
    expect(run(t, [...hold(h, CAST_CFG.hold + 0.05), ...hold(pose('point'), 0.05)])?.gesture).toBe('gun');
    expect(run(t, [...hold(h, CAST_CFG.cooldown * 0.3), ...hold(pose('point'), 0.05)])).toBeNull();
  });
});
