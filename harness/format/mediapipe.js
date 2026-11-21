// MediaPipe Hands (21 landmarks) -> WebXR hand (25 joints) mapper.
//
// MediaPipe has no metacarpal joints for the four fingers (its "MCP" landmark is the knuckle,
// i.e. WebXR's *-phalanx-proximal). We estimate each finger metacarpal joint by interpolating
// a fixed fraction along wrist -> knuckle, which matches where Quest reports them (~1/4 of the
// palm length out from the wrist). Orientations are derived from positions (see orient.js),
// radii come from typical Quest values.

import { lerp, add, scale } from '../math.js';
import { JOINT_NAMES, defaultRadius } from './joints.js';
import { orientFromPositions } from './orient.js';

export const MEDIAPIPE_LANDMARKS = [
  'WRIST',
  'THUMB_CMC', 'THUMB_MCP', 'THUMB_IP', 'THUMB_TIP',
  'INDEX_FINGER_MCP', 'INDEX_FINGER_PIP', 'INDEX_FINGER_DIP', 'INDEX_FINGER_TIP',
  'MIDDLE_FINGER_MCP', 'MIDDLE_FINGER_PIP', 'MIDDLE_FINGER_DIP', 'MIDDLE_FINGER_TIP',
  'RING_FINGER_MCP', 'RING_FINGER_PIP', 'RING_FINGER_DIP', 'RING_FINGER_TIP',
  'PINKY_MCP', 'PINKY_PIP', 'PINKY_DIP', 'PINKY_TIP',
];

/** WebXR joint -> MediaPipe landmark index (null = estimated). */
export const WEBXR_FROM_MEDIAPIPE = {
  wrist: 0,
  'thumb-metacarpal': 1,
  'thumb-phalanx-proximal': 2,
  'thumb-phalanx-distal': 3,
  'thumb-tip': 4,
  'index-finger-metacarpal': null,
  'index-finger-phalanx-proximal': 5,
  'index-finger-phalanx-intermediate': 6,
  'index-finger-phalanx-distal': 7,
  'index-finger-tip': 8,
  'middle-finger-metacarpal': null,
  'middle-finger-phalanx-proximal': 9,
  'middle-finger-phalanx-intermediate': 10,
  'middle-finger-phalanx-distal': 11,
  'middle-finger-tip': 12,
  'ring-finger-metacarpal': null,
  'ring-finger-phalanx-proximal': 13,
  'ring-finger-phalanx-intermediate': 14,
  'ring-finger-phalanx-distal': 15,
  'ring-finger-tip': 16,
  'pinky-finger-metacarpal': null,
  'pinky-finger-phalanx-proximal': 17,
  'pinky-finger-phalanx-intermediate': 18,
  'pinky-finger-phalanx-distal': 19,
  'pinky-finger-tip': 20,
};

/** Fraction along wrist -> knuckle where the estimated metacarpal joint sits. */
export const METACARPAL_FRACTION = 0.25;

const toArray = (l) => (Array.isArray(l) ? l : [l.x, l.y, l.z]);

/**
 * Convert one hand of MediaPipe landmarks to a HandRecording v1 hand.
 *
 * @param {Array<{x,y,z}|number[]>} landmarks 21 landmarks. Use MediaPipe *world* landmarks
 *   (metres, origin at the hand centre) for metric output; normalised image landmarks work
 *   too if you pass a `scale`.
 * @param {object} [opts]
 * @param {'left'|'right'} [opts.handedness='right'] the user's actual hand (note: MediaPipe
 *   labels assume a mirrored selfie image; flip its label if your video is not mirrored).
 * @param {number[]} [opts.axes=[1,-1,-1]] per-axis sign flip. MediaPipe is y-down and its z grows
 *   away from the camera; WebXR is y-up with -z forward.
 * @param {number} [opts.scale=1] multiplier applied after the axis flip (e.g. image -> metres).
 * @param {number[]} [opts.offset=[0,0,0]] world-space offset added last (e.g. where the hand is).
 */
export function mediapipeToWebXR(landmarks, opts = {}) {
  const { handedness = 'right', axes = [1, -1, -1], scale: s = 1, offset = [0, 0, 0] } = opts;
  if (!landmarks || landmarks.length !== 21) {
    throw new Error(`mediapipeToWebXR: expected 21 landmarks, got ${landmarks?.length}`);
  }
  const pts = landmarks.map((l) => {
    const [x, y, z] = toArray(l);
    return add(scale([x * axes[0], y * axes[1], z * axes[2]], s), offset);
  });

  const pos = {};
  for (const name of JOINT_NAMES) {
    const idx = WEBXR_FROM_MEDIAPIPE[name];
    if (idx !== null) pos[name] = pts[idx];
  }
  for (const f of ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger']) {
    pos[`${f}-metacarpal`] = lerp(pos.wrist, pos[`${f}-phalanx-proximal`], METACARPAL_FRACTION);
  }

  const rot = orientFromPositions(pos, handedness);
  const hand = {};
  for (const name of JOINT_NAMES) {
    hand[name] = { p: pos[name], q: rot[name], r: defaultRadius(name) };
  }
  return hand;
}

/** Inverse helper (lossy: drops the 4 estimated metacarpals) — handy for round-trip tests. */
export function webxrToMediapipe(hand, opts = {}) {
  const { axes = [1, -1, -1], scale: s = 1, offset = [0, 0, 0] } = opts;
  const out = new Array(21);
  for (const [name, idx] of Object.entries(WEBXR_FROM_MEDIAPIPE)) {
    if (idx === null) continue;
    const p = hand[name].p;
    out[idx] = [
      ((p[0] - offset[0]) / s) * axes[0],
      ((p[1] - offset[1]) / s) * axes[1],
      ((p[2] - offset[2]) / s) * axes[2],
    ];
  }
  return out;
}
