// Shared helpers for unit tests: quick synthetic hands without going through a timeline.
import { resolvePose, curlPose, poseWorld } from '../../harness/synth/skeleton.js';
import { qFromEulerDeg, add, sub, scale, normalize } from '../../harness/math.js';

export const WRIST = [0, 1.0, 0.3];

/** World-space hand for a pose name / resolved pose, palm down by default. */
export function handInPose(pose, { handedness = 'right', wrist = WRIST, rot = [0, 0, 0] } = {}) {
  const p = typeof pose === 'string' ? resolvePose(pose) : pose;
  return poseWorld(p, wrist, rot.length === 4 ? rot : qFromEulerDeg(rot), handedness);
}

export const curledHand = (k, opts) => handInPose(curlPose(k), opts);

/** Copy of `hand` with the thumb tip placed exactly `d` metres from the index tip. */
export function withPinchDistance(hand, d) {
  const out = structuredClone(hand);
  const idx = out['index-finger-tip'].p;
  const dir = normalize(sub(out['thumb-tip'].p, idx));
  out['thumb-tip'].p = add(idx, scale(dir, d));
  return out;
}
