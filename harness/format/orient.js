// Derive WebXR-style joint orientations from joint positions alone.
// Used by the MediaPipe mapper (landmarks carry no rotation) and by the synth thumb IK.
//
// Convention (WebXR Hand Input): each joint's -Z axis points along its bone toward the
// fingertip, and +Y points out of the back of the hand (-Y out of the palm).
// The X axis is the hand's lateral axis (index -> pinky on a right hand), which stays
// constant while a finger flexes, so the frame never degenerates for curled fingers.

import { cross, dot, normalize, scale, sub, len, qFromBasis } from '../math.js';
import { JOINT_NAMES, NEXT_JOINT, PARENT_JOINT } from './joints.js';

export function handAxes(pos, handedness) {
  const wrist = pos.wrist;
  const indexK = pos['index-finger-phalanx-proximal'];
  const pinkyK = pos['pinky-finger-phalanx-proximal'];
  const toIndex = sub(indexK, wrist);
  const toPinky = sub(pinkyK, wrist);
  const right = handedness !== 'left';
  const up = normalize(right ? cross(toPinky, toIndex) : cross(toIndex, toPinky));
  const lateral = normalize(right ? sub(pinkyK, indexK) : sub(indexK, pinkyK));
  return { up, lateral };
}

/** Build a quaternion whose -Z is `dir`, using `lateral` as the preferred X and `up` as fallback Y. */
export function frameFromDirection(dir, lateral, up) {
  const z = normalize(scale(dir, -1));
  let y = cross(z, lateral);
  if (len(y) < 1e-4) {
    y = sub(up, scale(z, dot(up, z)));
  }
  y = normalize(y);
  const x = cross(y, z);
  return qFromBasis(x, y, z);
}

/**
 * @param {Record<string, number[]>} pos joint name -> [x,y,z]
 * @param {'left'|'right'} handedness
 * @returns {Record<string, number[]>} joint name -> quaternion [x,y,z,w]
 */
export function orientFromPositions(pos, handedness) {
  const { up, lateral } = handAxes(pos, handedness);
  const out = {};
  for (const name of JOINT_NAMES) {
    const next = NEXT_JOINT[name];
    let dir;
    if (next) dir = sub(pos[next], pos[name]);
    else dir = sub(pos[name], pos[PARENT_JOINT[name]]);
    out[name] = frameFromDirection(dir, lateral, up);
  }
  return out;
}
