// Parametric adult hand skeleton (~18.6 cm wrist -> middle fingertip) with forward kinematics
// for the four fingers and CCD inverse kinematics for the thumb.
//
// Hand-local frame (right hand): wrist at the origin, fingers along -Z, back of the hand +Y,
// thumb on the -X side. The left hand is the mirror image (x -> -x). In this frame a joint
// with identity rotation already follows the WebXR convention (-Z along the bone toward the
// tip, +Y out of the back of the hand), so finger joint rotations come straight from FK.

import {
  add, sub, scale, normalize, dist, lerp, len, cross,
  qMul, qFromAxisAngle, qRotate, qFromUnitVectors, DEG,
} from '../math.js';
import { JOINT_NAMES, defaultRadius } from '../format/joints.js';
import { frameFromDirection } from '../format/orient.js';

const X = [1, 0, 0];
const Y = [0, 1, 0];

export const FINGER_NAMES = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];

export const REST = {
  thumb: {
    cmc: [-0.022, -0.018, -0.028],
    dirs: [normalize([-0.6, -0.2, -0.78]), normalize([-0.42, -0.14, -0.9]), normalize([-0.3, -0.1, -0.95])],
    lengths: [0.045, 0.032, 0.027],
  },
  fingers: {
    'index-finger': { meta: [-0.011, -0.004, -0.0235], knuckle: [-0.022, 0, -0.09], lengths: [0.04, 0.023, 0.02], spread: 5 },
    'middle-finger': { meta: [0, -0.004, -0.0245], knuckle: [-0.002, 0, -0.093], lengths: [0.045, 0.027, 0.021], spread: 1 },
    'ring-finger': { meta: [0.01, -0.004, -0.0235], knuckle: [0.017, -0.002, -0.088], lengths: [0.042, 0.026, 0.021], spread: -3 },
    'pinky-finger': { meta: [0.018, -0.005, -0.021], knuckle: [0.033, -0.006, -0.08], lengths: [0.033, 0.018, 0.018], spread: -8 },
  },
};

/** Named local anchor points (right hand; mirrored for the left). Pose-dependent ones are computed. */
export const STATIC_ANCHORS = {
  wrist: [0, 0, 0],
  // Centre of the palm, ~3 cm below the back-of-hand joint plane: where a held die sits.
  palm: [-0.004, -0.03, -0.055],
};

// ---- finger forward kinematics -----------------------------------------

function fingerYaw(f) {
  const d = sub(REST.fingers[f].knuckle, REST.fingers[f].meta);
  return Math.atan2(-d[0], -d[2]);
}
const YAW = Object.fromEntries(FINGER_NAMES.map((f) => [f, fingerYaw(f)]));

/**
 * @param {string} f finger name
 * @param {number[]} flex [mcp, pip, dip] flexion in degrees (positive curls toward the palm)
 * @param {number} spreadDeg abduction in degrees (positive toward the thumb side)
 * @returns {{ p: number[][], q: number[][] }} 5 joints: metacarpal, proximal, intermediate, distal, tip
 */
export function fingerFK(f, flex, spreadDeg) {
  const rest = REST.fingers[f];
  const qBase = qFromAxisAngle(Y, YAW[f] + spreadDeg * DEG);
  const p = [rest.meta, rest.knuckle];
  const q = [frameFromDirection(sub(rest.knuckle, rest.meta), X, Y)];
  let cum = 0;
  let cur = rest.knuckle;
  for (let i = 0; i < 3; i++) {
    cum += flex[i];
    const qi = qMul(qBase, qFromAxisAngle(X, -cum * DEG));
    q.push(qi);
    cur = add(cur, qRotate(qi, [0, 0, -rest.lengths[i]]));
    p.push(cur);
  }
  q.push(q[3]); // tip shares the distal phalanx orientation
  return { p, q };
}

// ---- thumb ----------------------------------------------------------------

export function thumbRestChain() {
  const { cmc, dirs, lengths } = REST.thumb;
  const pts = [cmc];
  for (let i = 0; i < 3; i++) pts.push(add(pts[i], scale(dirs[i], lengths[i])));
  return pts;
}
const THUMB_REST = thumbRestChain();
export const THUMB_REST_TIP = THUMB_REST[3];

/** CCD IK for the 3-bone thumb chain, always solved from the rest pose (deterministic, smooth). */
export function solveThumb(target, iterations = 16) {
  const pts = THUMB_REST.map((p) => p.slice());
  if (dist(pts[3], target) < 1e-5) return pts;
  for (let it = 0; it < iterations; it++) {
    for (let i = 2; i >= 0; i--) {
      const toTip = normalize(sub(pts[3], pts[i]));
      const toTarget = normalize(sub(target, pts[i]));
      if (len(toTip) === 0 || len(toTarget) === 0) continue;
      const q = qFromUnitVectors(toTip, toTarget);
      for (let k = i + 1; k < 4; k++) pts[k] = add(pts[i], qRotate(q, sub(pts[k], pts[i])));
    }
    if (dist(pts[3], target) < 1e-4) break;
  }
  return pts;
}

// ---- poses ------------------------------------------------------------------

const FIST_FLEX = [85, 100, 60];
const fingersAll = (flex) => Object.fromEntries(FINGER_NAMES.map((f) => [f, flex.slice()]));
const restSpread = () => Object.fromEntries(FINGER_NAMES.map((f) => [f, REST.fingers[f].spread]));
const zeroSpread = () => Object.fromEntries(FINGER_NAMES.map((f) => [f, 0]));

/** Pose specs: finger flex (deg), spread (deg) and how to place the thumb tip. */
export const POSE_SPECS = {
  open: { flex: fingersAll([4, 6, 3]), spread: restSpread(), thumb: { mode: 'rest' } },
  fist: { flex: fingersAll(FIST_FLEX), spread: zeroSpread(), thumb: { mode: 'wrap' } },
  pinch: {
    flex: {
      'index-finger': [40, 50, 25],
      'middle-finger': [18, 25, 12],
      'ring-finger': [24, 30, 15],
      'pinky-finger': [30, 35, 18],
    },
    spread: restSpread(),
    thumb: { mode: 'pinch', gap: 0.008 },
  },
  // Index straight, other fingers curled, thumb tucked over ring/pinky (kept >6 cm from the
  // index tip so the app never mistakes a point for a pinch-grab).
  point: {
    flex: { ...fingersAll(FIST_FLEX), 'index-finger': [0, 0, 0] },
    spread: zeroSpread(),
    thumb: { mode: 'wrap', over: ['ring-finger', 'pinky-finger'] },
  },
  // Index curled tight, other fingers relaxed and the thumb out of the way, ready to snap the
  // index straight. (A thumb-held flick would read as a pinch, and curled middle/ring as a fist.)
  flickReady: {
    flex: { ...fingersAll([10, 14, 8]), 'index-finger': [75, 100, 55] },
    spread: restSpread(),
    thumb: { mode: 'rest' },
  },
};
// End of a flick: index straight, the rest still relaxed (never a fist, so the app won't grab).
POSE_SPECS.flickEnd = { ...POSE_SPECS.flickReady, flex: { ...POSE_SPECS.flickReady.flex, 'index-finger': [0, 0, 0] } };

function thumbTargetFor(spec, flex) {
  const t = spec.thumb ?? { mode: 'rest' };
  if (t.mode === 'rest') return THUMB_REST_TIP;
  if (t.mode === 'pinch') {
    const indexTip = fingerFK('index-finger', flex['index-finger'], 0).p[4];
    const towardThumb = normalize(sub(REST.thumb.cmc, indexTip));
    return add(indexTip, scale(towardThumb, t.gap ?? 0.008));
  }
  if (t.mode === 'wrap') {
    // Thumb lies across the outside of the curled index/middle intermediate phalanges.
    const [fa, fb] = t.over ?? ['index-finger', 'middle-finger'];
    const a = fingerFK(fa, flex[fa], 0).p;
    const b = fingerFK(fb, flex[fb], 0).p;
    const mid = lerp(lerp(a[2], a[3], 0.5), lerp(b[2], b[3], 0.5), 0.35);
    return add(mid, [0.004, -0.016, -0.004]);
  }
  if (t.mode === 'target') return t.target;
  throw new Error(`unknown thumb mode ${t.mode}`);
}

/**
 * Resolve a pose name/spec into interpolatable numbers. Resolved poses lerp linearly
 * (including the thumb-tip target), which gives smooth transitions between any two poses.
 */
export function resolvePose(spec) {
  const s = typeof spec === 'string' ? POSE_SPECS[spec] : spec;
  if (!s) throw new Error(`unknown pose "${spec}"`);
  const flex = Object.fromEntries(FINGER_NAMES.map((f) => [f, (s.flex?.[f] ?? [0, 0, 0]).slice()]));
  const spread = Object.fromEntries(FINGER_NAMES.map((f) => [f, s.spread?.[f] ?? 0]));
  return { flex, spread, thumbTarget: thumbTargetFor(s, flex) };
}

export function lerpPose(a, b, t) {
  return {
    flex: Object.fromEntries(FINGER_NAMES.map((f) => [f, a.flex[f].map((v, i) => v + (b.flex[f][i] - v) * t)])),
    spread: Object.fromEntries(FINGER_NAMES.map((f) => [f, a.spread[f] + (b.spread[f] - a.spread[f]) * t])),
    thumbTarget: lerp(a.thumbTarget, b.thumbTarget, t),
  };
}

/** A partial curl between open (0) and fist (1) — for boundary tests. */
export function curlPose(k) {
  return lerpPose(resolvePose('open'), resolvePose('fist'), k);
}

// ---- whole hand ---------------------------------------------------------------

/** Local (right-handed) joint positions + rotations for a resolved pose. */
export function poseLocal(pose) {
  const p = { wrist: [0, 0, 0] };
  const q = { wrist: [0, 0, 0, 1] };
  for (const f of FINGER_NAMES) {
    const fk = fingerFK(f, pose.flex[f], pose.spread[f]);
    const names = [`${f}-metacarpal`, `${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`];
    names.forEach((n, i) => {
      p[n] = fk.p[i];
      q[n] = fk.q[i];
    });
  }
  const thumb = solveThumb(pose.thumbTarget);
  const tn = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'];
  tn.forEach((n, i) => {
    p[n] = thumb[i];
    const dir = i < 3 ? sub(thumb[i + 1], thumb[i]) : sub(thumb[3], thumb[2]);
    // Thumb's flex axis is roughly perpendicular to its bone and the palm normal.
    const lateral = normalize(cross(dir, [0, -1, 0]));
    q[n] = frameFromDirection(dir, len(lateral) > 1e-3 ? lateral : X, Y);
  });
  return { p, q };
}

const mirrorP = (v) => [-v[0], v[1], v[2]];
const mirrorQ = (q) => [q[0], -q[1], -q[2], q[3]];

const tipMidpoint = (L) => lerp(L.p['thumb-tip'], L.p['index-finger-tip'], 0.5);
let cachedGrips = null;
/** Where the app's grabPoint() lands for a closed fist / a pinch (thumb-index midpoint). */
export function gripAnchors() {
  cachedGrips ??= {
    grip: tipMidpoint(poseLocal(resolvePose('fist'))),
    'pinch-grip': tipMidpoint(poseLocal(resolvePose('pinch'))),
  };
  return cachedGrips;
}

/**
 * Local anchor point for a pose (handles mirroring). Anchors: 'wrist', 'palm', 'grip' (fist
 * grab point), 'pinch-grip' (closed-pinch grab point), 'pinch' (current thumb-index midpoint),
 * any joint name, or a literal local [x,y,z].
 */
export function anchorLocal(pose, anchor, handedness, local = null) {
  let a;
  if (Array.isArray(anchor)) a = anchor;
  else if (STATIC_ANCHORS[anchor]) a = STATIC_ANCHORS[anchor];
  else if (anchor === 'grip' || anchor === 'pinch-grip') a = gripAnchors()[anchor];
  else {
    const L = local ?? poseLocal(pose);
    if (anchor === 'pinch') a = lerp(L.p['thumb-tip'], L.p['index-finger-tip'], 0.5);
    else if (L.p[anchor]) a = L.p[anchor];
    else throw new Error(`unknown anchor "${anchor}"`);
  }
  return handedness === 'left' ? mirrorP(a) : a;
}

/** World-space HandRecording hand for wrist position, wrist rotation and resolved pose. */
export function poseWorld(pose, wrist, rot, handedness) {
  const L = poseLocal(pose);
  const left = handedness === 'left';
  const hand = {};
  for (const name of JOINT_NAMES) {
    const lp = left ? mirrorP(L.p[name]) : L.p[name];
    const lq = left ? mirrorQ(L.q[name]) : L.q[name];
    hand[name] = { p: add(wrist, qRotate(rot, lp)), q: qMul(rot, lq), r: defaultRadius(name) };
  }
  return hand;
}
