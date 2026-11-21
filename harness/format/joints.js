// The 25 WebXR hand joints (https://www.w3.org/TR/webxr-hand-input-1/#skeleton-joints-section),
// in spec order. HandRecording v1 stores each hand as an object keyed by these names.

export const FINGERS = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];

export const JOINT_NAMES = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
];

export const JOINT_COUNT = JOINT_NAMES.length; // 25
export const JOINT_INDEX = Object.fromEntries(JOINT_NAMES.map((n, i) => [n, i]));

/** Joint chains from the wrist outwards, one per finger. */
export const CHAINS = {
  thumb: ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  ...Object.fromEntries(
    FINGERS.slice(1).map((f) => [
      f,
      [`${f}-metacarpal`, `${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`],
    ]),
  ),
};

/** Parent -> child bone pairs (24 bones), used for rendering and bone-length checks. */
export const BONES = Object.values(CHAINS).flatMap((chain) => [
  ['wrist', chain[0]],
  ...chain.slice(1).map((name, i) => [chain[i], name]),
]);

/** For each joint, the joint it points toward (-Z of its frame). Tips point away from their parent. */
export const NEXT_JOINT = Object.fromEntries(
  Object.values(CHAINS).flatMap((chain) => chain.map((name, i) => [name, chain[i + 1] ?? null])),
);
NEXT_JOINT.wrist = 'middle-finger-metacarpal';

export const PARENT_JOINT = Object.fromEntries(BONES.map(([p, c]) => [c, p]));

/** Typical Quest joint radii in metres (used by synth + MediaPipe mapper, which have no radius data). */
export function defaultRadius(name) {
  if (name === 'wrist') return 0.02;
  const pinky = name.startsWith('pinky') ? 0.85 : 1;
  if (name.endsWith('metacarpal')) return (name.startsWith('thumb') ? 0.019 : 0.017) * pinky;
  if (name.endsWith('proximal')) return 0.0105 * pinky;
  if (name.endsWith('intermediate')) return 0.0095 * pinky;
  if (name.endsWith('distal')) return 0.009 * pinky;
  if (name.endsWith('tip')) return 0.0078 * pinky;
  return 0.01;
}
