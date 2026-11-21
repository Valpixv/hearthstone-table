// Pure gesture maths (no three.js) so it can be unit-tested in Node.
// A "hand" is { [jointName]: { p:[x,y,z], q?:[x,y,z,w], r? } } in world metres,
// using the WebXR Hand Input joint names.

export const JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];

export const TIP_JOINTS = ['thumb-tip', 'index-finger-tip', 'middle-finger-tip'];

export const PINCH_ON = 0.02;   // metres – spec: thumb tip to index tip under 2 cm
export const PINCH_OFF = 0.035; // hysteresis so a held die is not dropped by jitter

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

const P = (hand, name) => hand && hand[name] && hand[name].p;

export function pinchDistance(hand) {
  const t = P(hand, 'thumb-tip'), i = P(hand, 'index-finger-tip');
  return t && i ? dist(t, i) : Infinity;
}

export function isPinching(hand, wasPinching = false) {
  const d = pinchDistance(hand);
  return wasPinching ? d < PINCH_OFF : d < PINCH_ON;
}

// Fist: index, middle and ring tips all curled close to the wrist. Requiring the index
// means a pointing hand (index extended to poke) never counts as a grab.
export function isFist(hand) {
  const w = P(hand, 'wrist'), i = P(hand, 'index-finger-tip'), m = P(hand, 'middle-finger-tip'), r = P(hand, 'ring-finger-tip');
  if (!w || !i || !m || !r) return false;
  return dist(w, i) < 0.1 && dist(w, m) < 0.095 && dist(w, r) < 0.09;
}

// Point used to pick/hold objects: pinch midpoint, or palm centre for a fist.
export function grabPoint(hand) {
  const t = P(hand, 'thumb-tip'), i = P(hand, 'index-finger-tip');
  if (t && i && pinchDistance(hand) < 0.06) return scale(add(t, i), 0.5);
  const w = P(hand, 'wrist'), m = P(hand, 'middle-finger-metacarpal') || P(hand, 'middle-finger-phalanx-proximal');
  if (w && m) return scale(add(w, m), 0.5);
  return w || null;
}

export function palmNormal(hand, handedness = 'left') {
  const w = P(hand, 'wrist'), i = P(hand, 'index-finger-metacarpal') || P(hand, 'index-finger-phalanx-proximal');
  const p = P(hand, 'pinky-finger-metacarpal') || P(hand, 'pinky-finger-phalanx-proximal');
  if (!w || !i || !p) return null;
  const n = norm(cross(sub(i, w), sub(p, w)));
  // Palm-down right hand (index -x, pinky +x, fingers -z) gives cross = -Y, so flip for left.
  return handedness === 'left' ? scale(n, -1) : n;
}

export function palmUp(hand, handedness = 'left', threshold = 0.7) {
  const n = palmNormal(hand, handedness);
  return !!n && n[1] > threshold;
}

// history: [{ p:[x,y,z], t:seconds }] newest last. Average of the last n frame-to-frame velocities.
export function averageVelocity(history, n = 5) {
  if (!history || history.length < 2) return [0, 0, 0];
  const start = Math.max(0, history.length - 1 - n);
  const a = history[start], b = history[history.length - 1];
  const dt = b.t - a.t;
  if (dt <= 1e-6) return [0, 0, 0];
  return scale(sub(b.p, a.p), 1 / dt);
}

export function clampLength(v, max) {
  const l = Math.hypot(...v);
  return l > max ? scale(v, max / l) : v;
}
