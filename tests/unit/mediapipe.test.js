import { describe, it, expect } from 'vitest';
import { mediapipeToWebXR, webxrToMediapipe, WEBXR_FROM_MEDIAPIPE } from '../../harness/format/mediapipe.js';
import { JOINT_NAMES, BONES, NEXT_JOINT } from '../../harness/format/joints.js';
import { validateRecording, createRecording } from '../../harness/format/recording.js';
import { dist, qRotate, normalize, sub, dot } from '../../harness/math.js';
import { handInPose } from '../helpers/hands.js';
import { isFist, isPinching } from '../../src/input/gestures.js';

// Typical adult bone lengths (m) with generous bounds: [min, max].
const BONE_RANGE = {
  metacarpalToKnuckle: [0.035, 0.09],
  wristToMetacarpal: [0.005, 0.06],
  phalanx: [0.012, 0.06],
};
function boneKind([a, b]) {
  if (a === 'wrist') return b.startsWith('thumb') ? 'wristToMetacarpal' : 'wristToMetacarpal';
  if (a.endsWith('metacarpal')) return b.startsWith('thumb') ? 'phalanx' : 'metacarpalToKnuckle';
  return 'phalanx';
}

/** MediaPipe world landmarks (y down, z away from camera) for a synthetic hand pose. */
const landmarksFor = (pose, handedness = 'right') => webxrToMediapipe(handInPose(pose, { handedness }));

describe('MediaPipe -> WebXR mapper', () => {
  it('maps all 21 landmarks and estimates the 4 missing metacarpals', () => {
    expect(Object.values(WEBXR_FROM_MEDIAPIPE).filter((v) => v === null)).toHaveLength(4);
    const hand = mediapipeToWebXR(landmarksFor('open'));
    expect(Object.keys(hand).sort()).toEqual([...JOINT_NAMES].sort());
    for (const n of JOINT_NAMES) {
      expect(hand[n].p).toHaveLength(3);
      expect(Math.hypot(...hand[n].q)).toBeCloseTo(1, 6);
      expect(hand[n].r).toBeGreaterThan(0);
    }
  });

  it.each(['open', 'fist', 'pinch', 'point'])('produces plausible bone lengths for a %s pose', (pose) => {
    const hand = mediapipeToWebXR(landmarksFor(pose));
    for (const bone of BONES) {
      const [lo, hi] = BONE_RANGE[boneKind(bone)];
      const l = dist(hand[bone[0]].p, hand[bone[1]].p);
      expect(l, `${bone.join('->')}`).toBeGreaterThan(lo);
      expect(l, `${bone.join('->')}`).toBeLessThan(hi);
    }
  });

  it('round-trips the 21 shared joints exactly and the metacarpals within 2.5 cm', () => {
    for (const handedness of ['left', 'right']) {
      const truth = handInPose('open', { handedness });
      const mapped = mediapipeToWebXR(webxrToMediapipe(truth), { handedness });
      for (const n of JOINT_NAMES) {
        const tol = WEBXR_FROM_MEDIAPIPE[n] === null ? 0.025 : 1e-9;
        expect(dist(mapped[n].p, truth[n].p), n).toBeLessThanOrEqual(tol);
      }
    }
  });

  it('orients each joint with -Z toward the next joint (WebXR convention)', () => {
    const hand = mediapipeToWebXR(landmarksFor('fist'));
    for (const n of JOINT_NAMES) {
      const next = NEXT_JOINT[n];
      if (!next) continue;
      const negZ = qRotate(hand[n].q, [0, 0, -1]);
      expect(dot(negZ, normalize(sub(hand[next].p, hand[n].p))), n).toBeGreaterThan(0.999);
    }
  });

  it('keeps gestures intact so the app recognises webcam pinches and fists', () => {
    expect(isFist(mediapipeToWebXR(landmarksFor('fist')))).toBe(true);
    expect(isPinching(mediapipeToWebXR(landmarksFor('pinch')), false)).toBe(true);
    expect(isFist(mediapipeToWebXR(landmarksFor('open')))).toBe(false);
  });

  it('accepts {x,y,z} objects, applies scale/offset, and yields a valid recording', () => {
    const lms = landmarksFor('open').map(([x, y, z]) => ({ x: x * 10, y: y * 10, z: z * 10 }));
    const hand = mediapipeToWebXR(lms, { scale: 0.1, offset: [0, 1, 0] });
    expect(hand.wrist.p[1]).toBeCloseTo(handInPose('open').wrist.p[1] + 1, 6);
    expect(validateRecording(createRecording({ source: 'mediapipe', fps: 30, frames: [{ t: 0, right: hand }] })).ok).toBe(true);
  });

  it('rejects the wrong landmark count', () => {
    expect(() => mediapipeToWebXR(new Array(20).fill([0, 0, 0]))).toThrow(/21 landmarks/);
  });
});
