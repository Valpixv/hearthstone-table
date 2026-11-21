// Simulated hand-tracking error, applied to world-space joints at record time.
// All randomness comes from a seeded PRNG, so a given seed always produces the same file.

import { add, normalize, qMul, qFromAxisAngle, DEG } from '../math.js';
import { JOINT_NAMES } from '../format/joints.js';
import { mulberry32, gaussian } from '../rng.js';

export const DEFAULT_NOISE = {
  jitter: 0, // m, per-joint white noise std-dev (Quest ~1-3 mm, webcam ~5-10 mm)
  drift: 0, // m, std-dev of a slow whole-hand wander (Ornstein–Uhlenbeck)
  driftTau: 0.5, // s, drift correlation time
  rotJitter: 0, // deg, per-joint rotation noise std-dev
  spikeProb: 0, // per-frame probability that one random joint jumps
  spikeSize: 0.015, // m, std-dev of that jump
  dropoutProb: 0, // per-frame probability that tracking is lost
  dropoutFrames: 2, // frames each dropout lasts
  seed: 1,
};

/** Returns apply(hand, dt) -> noisy hand, or undefined while tracking is "lost". */
export function createNoise(opts = {}) {
  const o = { ...DEFAULT_NOISE, ...opts };
  const rand = mulberry32(o.seed);
  const n = gaussian(rand);
  let drift = [0, 0, 0];
  let dropLeft = 0;

  return function apply(hand, dt) {
    if (!hand) return hand;
    const a = Math.exp(-dt / o.driftTau);
    const sd = o.drift * Math.sqrt(1 - a * a);
    drift = drift.map((v) => v * a + n() * sd);

    if (dropLeft > 0) {
      dropLeft--;
      return undefined;
    }
    if (o.dropoutProb > 0 && rand() < o.dropoutProb) {
      dropLeft = o.dropoutFrames - 1;
      return undefined;
    }
    const spikeJoint = o.spikeProb > 0 && rand() < o.spikeProb ? JOINT_NAMES[Math.floor(rand() * JOINT_NAMES.length)] : null;

    const out = {};
    for (const name of JOINT_NAMES) {
      const j = hand[name];
      let p = add(j.p, drift);
      if (o.jitter > 0) p = add(p, [n() * o.jitter, n() * o.jitter, n() * o.jitter]);
      if (name === spikeJoint) p = add(p, [n() * o.spikeSize, n() * o.spikeSize, n() * o.spikeSize]);
      let q = j.q;
      if (o.rotJitter > 0) {
        const axis = normalize([n(), n(), n()]);
        q = qMul(qFromAxisAngle(axis, n() * o.rotJitter * DEG), q);
      }
      out[name] = { p, q, r: j.r };
    }
    return out;
  };
}
