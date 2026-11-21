// Gesture spells (design/feature-expansion-plan.md §6): pure classifier + per-hand casting state machine.
// Works on the shared WebXR joint names, so XR hands and MediaPipe webcam hands use the same code.
// Signs (design/vr-hands-plan.md §4): point (index out, flick fires), gun (index + thumb out, thumb drop fires),
// and the open hand, which fires as palm (pushed toward where the palm faces) or slash (swiped edge-first, like a
// sword cut). Pinch and fist are left to grabbing and never cast. (The old "horns" sign was dropped: Quest tracking
// often misreads the hidden middle and ring fingers.)
import { dist, sub, norm, scale, add, palmNormal, pinchDistance } from './gestures.js';
import TUNING from '../data/gestures.json';

/**
 * Tuning (metres, seconds, m/s), from src/data/gestures.json:
 * extendRatio / curlRatio: tip-to-wrist ÷ proximal-to-wrist above / below which a finger is out / curled;
 * thumbOut / thumbIn: thumb tip clear of / resting on the curled fingers; pinchGuard: a pinch never casts;
 * hold: a shape held this long arms; flickSpeed: point tip speed along the aim; pushSpeed: palm speed along its
 * normal; slashSpeed: open-hand speed along its edge (index→pinky line), which must also beat the push by slashBias;
 * aimKeep: a flick only counts while the finger still points within ~60° of where it was aimed when armed;
 * triggerWindow: gun thumb-drop window; cooldown between casts; historyN: frames for velocity.
 */
export const CAST_CFG = Object.fromEntries(Object.entries(TUNING).filter(([k]) => !k.startsWith('_')));

const FINGERS = { index: 'index-finger', middle: 'middle-finger', ring: 'ring-finger', pinky: 'pinky-finger' };
const P = (h, n) => h?.[n]?.p;
const THUMB_REST_JOINTS = ['index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'pinky-finger-phalanx-intermediate'];

/**
 * Finger states for a hand: { index, middle, ring, pinky: 'out'|'in'|null, thumb: 'out'|'in'|null, pinch: bool }.
 * @param {object} hand joints
 * @param {object} [prev] previous states (hysteresis for the in-between band)
 */
export function fingerStates(hand, prev = {}, C = CAST_CFG) {
  const w = P(hand, 'wrist'), out = { pinch: pinchDistance(hand) < C.pinchGuard };
  for (const [k, f] of Object.entries(FINGERS)) {
    const tip = P(hand, `${f}-tip`), base = P(hand, `${f}-phalanx-proximal`);
    if (!w || !tip || !base) { out[k] = null; continue; }
    const r = dist(w, tip) / Math.max(dist(w, base), 1e-4);
    out[k] = r > C.extendRatio ? 'out' : r < C.curlRatio ? 'in' : (prev[k] ?? null);
  }
  // Thumb: tucked when its tip rests on any curled finger (or the index's side), out when clear of them all.
  const tt = P(hand, 'thumb-tip'), near = THUMB_REST_JOINTS.map((n) => P(hand, n)).filter(Boolean);
  if (tt && near.length) { const d = Math.min(...near.map((q) => dist(tt, q))); out.thumb = d > C.thumbOut ? 'out' : d < C.thumbIn ? 'in' : (prev.thumb ?? null); } else out.thumb = null;
  return out;
}

/** Shape from finger states: 'point' | 'gun' | 'palm' (open hand: fires as palm or slash) | null. */
export function classify(s) {
  if (!s || s.pinch) return null;
  const { index: i, middle: m, ring: r, pinky: p, thumb: t } = s;
  if (i === 'out' && m === 'out' && r === 'out' && p === 'out') return 'palm';
  if (i === 'out' && m === 'in' && r === 'in' && p === 'in') return t === 'out' ? 'gun' : t === 'in' ? 'point' : null;
  return null;
}

/** Aim ray for a shape: { origin, dir } (world). */
export function aimOf(shape, hand, handedness = 'right') {
  const w = P(hand, 'wrist'), it = P(hand, 'index-finger-tip'), ip = P(hand, 'index-finger-phalanx-proximal');
  if (!w || !it) return null;
  if (shape === 'palm') {
    const n = palmNormal(hand, handedness), m = P(hand, 'middle-finger-phalanx-proximal') || it;
    return n ? { origin: scale(add(w, m), 0.5), dir: n } : null; // palmNormal points out of the palm face: the push direction
  }
  if (shape === 'slash') { const m = P(hand, 'middle-finger-tip') || it; return { origin: scale(add(w, m), 0.5), dir: norm(sub(m, w)) }; }
  return { origin: it, dir: norm(sub(it, ip || w)) };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Unit vector along the hand's knuckle line (index → pinky): the edge a slash leads with. */
export function edgeOf(hand) { const a = P(hand, 'index-finger-phalanx-proximal'), b = P(hand, 'pinky-finger-phalanx-proximal'); return a && b ? norm(sub(b, a)) : null; }
/** The gestures an armed shape can fire as (bindings for any of them make the shape worth arming). */
export const FIRES_AS = { point: ['point'], gun: ['gun'], palm: ['palm', 'slash'] };

/**
 * One hand's casting state machine. update() returns { armed, shape, aim, fire } every frame; fire is
 * { gesture, origin, dir } on the frame a cast goes off.
 */
export class GestureTracker {
  constructor(handedness = 'right', cfg = CAST_CFG) {
    this.handedness = handedness; this.C = cfg; this.states = {}; this.shape = null; this.since = 0; this.armed = null;
    this.left = null; this.cool = 0; this.hist = []; this.t = 0;
  }

  reset() { this.shape = null; this.armed = null; this.left = null; this.hist = []; }

  /**
   * @param {object|null} hand joints (null when not tracked)
   * @param {number} dt seconds
   * @param {{ blocked?: boolean }} [o] blocked: holding something / cast mode off
   */
  update(hand, dt, { blocked = false } = {}) {
    const C = this.C; this.t += dt; this.cool -= dt;
    if (!hand || blocked) { this.reset(); return { armed: null, shape: null, aim: null, fire: null }; }
    this.states = fingerStates(hand, this.states, C);
    const shape = classify(this.states);
    if (shape !== this.shape) { this.shape = shape; this.since = this.t; }
    const it = P(hand, 'index-finger-tip'), w = P(hand, 'wrist');
    this.hist.push({ tip: it, wrist: w, t: this.t }); if (this.hist.length > C.historyN + 1) this.hist.shift();
    let fire = null;
    if (!this.armed && shape && this.cool <= 0 && this.t - this.since >= C.hold) { this.armed = shape; this.armDir = aimOf(shape, hand, this.handedness)?.dir || null; }
    const aim = this.armed ? aimOf(this.armed, hand, this.handedness) : null;
    // A flick must keep pointing roughly where the sign was aimed: curling the finger away fast is not a flick.
    const steady = !this.armDir || !aim || dot(aim.dir, this.armDir) > C.aimKeep;
    if (this.armed && aim) {
      const vel = this.velocity(this.armed === 'palm' ? 'wrist' : 'tip');
      if (this.armed === 'gun') {
        if (shape === 'gun') this.left = null;
        else if (shape === 'point' || (this.states.thumb === 'in' && this.states.index === 'out')) fire = this.fire('gun', aim);
        else if (!this.left) this.left = this.t;
        else if (this.t - this.left > C.triggerWindow) this.armed = null;
      } else if (shape && shape !== this.armed) this.armed = null; // changed shape: re-arm by holding the new one
      else if (this.armed === 'palm') {
        const push = dot(vel, aim.dir), e = edgeOf(hand), swipe = e ? Math.abs(dot(vel, e)) : 0;
        if (push > C.pushSpeed && push >= swipe) fire = this.fire('palm', aim);
        else if (swipe > C.slashSpeed && swipe > Math.max(0, push) * C.slashBias) fire = this.fire('slash', aimOf('slash', hand, this.handedness) || aim);
      } else if (steady && dot(vel, aim.dir) > C.flickSpeed) fire = this.fire(this.armed, aim);
    } else if (this.armed && !shape) this.armed = null;
    return { armed: this.armed, shape, aim, fire };
  }

  velocity(key) {
    const h = this.hist; if (h.length < 2) return [0, 0, 0];
    const a = h[0], b = h[h.length - 1], dt = b.t - a.t;
    return dt > 1e-6 && a[key] && b[key] ? scale(sub(b[key], a[key]), 1 / dt) : [0, 0, 0];
  }

  fire(gesture, aim) { this.armed = null; this.left = null; this.cool = this.C.cooldown; this.hist = []; return { gesture, origin: aim.origin, dir: aim.dir }; }
}

/** Typical wrist → middle-knuckle length (metres) the distance thresholds were set for. */
export const REF_HAND = 0.095;
/** Hand length from joints (wrist → middle-finger knuckle), or null. */
export function handLength(hand) { const w = P(hand, 'wrist'), m = P(hand, 'middle-finger-phalanx-proximal'); return w && m ? dist(w, m) : null; }
/**
 * Tuning scaled to a player's hand: the distance thresholds (thumb clearances, pinch guard) grow or shrink with the
 * hand; ratios and speeds stay. The factor is clamped so a bad measurement cannot break recognition.
 */
export function scaledConfig(cfg, len) {
  if (!(len > 0)) return cfg;
  const k = Math.max(0.75, Math.min(1.3, len / REF_HAND));
  return { ...cfg, thumbOut: cfg.thumbOut * k, thumbIn: cfg.thumbIn * k, pinchGuard: cfg.pinchGuard * k };
}

/** Where the Gesture Lab keeps the measured hand length on this device. */
export const HAND_KEY = 'hearthstone-hand-length';
/** The player's saved hand length (metres), or null. */
export function savedHandLength() { try { const v = Number(globalThis.localStorage?.getItem(HAND_KEY)); return v > 0.05 && v < 0.15 ? v : null; } catch { return null; } }
