// Fluent API for scripting synthetic hand animations.
//
//   hand('right').at([0, 1.0, -0.3]).open()
//     .moveTo(dicePos, 0.5).grab(0.2)
//     .arcThrow(dicePos, trayCenter, 2.5).open()
//     .record({ fps: 72 })
//
// Every call appends a timed segment to the hand's timeline; record() samples the timeline at a
// fixed fps, runs forward kinematics, applies optional tracking noise and returns a
// HandRecording v1. Positions are world-space metres. Most motions take an `anchor` saying which
// point of the hand should arrive at the target (default 'grip' = where the app holds a die).

import * as M from '../math.js';
import { ease } from './easing.js';
import { resolvePose, lerpPose, curlPose, poseWorld, anchorLocal, POSE_SPECS } from './skeleton.js';
import { createNoise } from './noise.js';
import { createRecording, roundRecording } from '../format/recording.js';

export const GRAVITY = 9.82; // matches the app's cannon-es world

const DEFAULT_ANCHOR = 'grip';
const START = { right: [0.18, 1.0, 0.4], left: [-0.18, 1.0, 0.4] };

const toQuat = (r) => (r.length === 4 ? M.qNormalize(r) : M.qFromEulerDeg(r));
const clone = (s) => ({ wrist: s.wrist.slice(), rot: s.rot.slice(), pose: s.pose, visible: s.visible });
const toPose = (p) => (typeof p === 'string' || !p.thumbTarget ? resolvePose(p) : p);

/**
 * Launch velocity that carries a projectile from `from` to `to` with the given speed.
 * Picks the low arc (or the high arc with arc: 'high'). If `speed` cannot reach, uses the
 * minimum speed that can. Returns { v, speed, angle, clamped }.
 */
export function ballisticVelocity(from, to, speed, { arc = 'low', g = GRAVITY } = {}) {
  const d = M.sub(to, from);
  const h = [d[0], 0, d[2]];
  const x = M.len(h);
  const y = d[1];
  if (x < 1e-6) return { v: [0, Math.sign(y) * speed, 0], speed, angle: Math.sign(y) * 90, clamped: false };
  let s2 = speed * speed;
  let disc = s2 * s2 - g * (g * x * x + 2 * y * s2);
  let clamped = false;
  if (disc < 0) {
    s2 = g * (y + Math.hypot(x, y));
    disc = 0;
    clamped = true;
  }
  const root = Math.sqrt(disc);
  const theta = Math.atan((s2 + (arc === 'high' ? root : -root)) / (g * x));
  const s = Math.sqrt(s2);
  const dirH = M.normalize(h);
  const v = M.add(M.scale(dirH, s * Math.cos(theta)), [0, s * Math.sin(theta), 0]);
  return { v, speed: s, angle: theta / M.DEG, clamped };
}

export class HandScript {
  constructor(handedness = 'right') {
    if (handedness !== 'left' && handedness !== 'right') throw new Error('hand must be "left" or "right"');
    this.handedness = handedness;
    this.segments = []; // { t0, dur, end, sample(u) }
    this.state = { wrist: null, rot: M.qIdentity(), pose: resolvePose('open'), visible: true };
    this.state.wrist = this._wristFor(START[handedness], 'palm', this.state.pose, this.state.rot);
    this.initial = clone(this.state);
    this.noiseOpts = null;
    this.notes = [];
  }

  // ---- internals ---------------------------------------------------------

  _wristFor(pos, anchor, pose, rot) {
    return M.sub(pos, M.qRotate(rot, anchorLocal(pose, anchor, this.handedness)));
  }

  /** World position of an anchor in a given state. */
  anchorAt(state, anchor = DEFAULT_ANCHOR) {
    return M.add(state.wrist, M.qRotate(state.rot, anchorLocal(state.pose, anchor, this.handedness)));
  }

  get duration() {
    const last = this.segments[this.segments.length - 1];
    return last ? last.t0 + last.dur : 0;
  }

  /** Append a segment. `sample(u, start)` maps u in [0,1] to a full state. */
  _push(dur, sample) {
    const start = clone(this.state);
    const fn = (u) => sample(u, start);
    const end = fn(1);
    this.segments.push({ t0: this.duration, dur: Math.max(0, dur), end, sample: fn });
    this.state = clone(end);
    return this;
  }

  _instant(mutate) {
    const next = clone(this.state);
    mutate(next);
    if (this.segments.length === 0) {
      this.initial = clone(next);
      this.state = next;
      return this;
    }
    return this._push(0, () => next);
  }

  stateAt(t) {
    let s = this.initial;
    for (const seg of this.segments) {
      if (t >= seg.t0 + seg.dur) s = seg.end;
      else if (t >= seg.t0) return seg.sample(seg.dur > 0 ? (t - seg.t0) / seg.dur : 1);
      else break;
    }
    return s;
  }

  /** HandRecording joints for time t (no noise), or undefined when hidden. */
  jointsAt(t) {
    const s = this.stateAt(t);
    return s.visible ? poseWorld(s.pose, s.wrist, s.rot, this.handedness) : undefined;
  }

  // ---- placement -----------------------------------------------------------

  /** Teleport so `anchor` sits at `pos`. Optional `rot`: quaternion or [pitch,yaw,roll] degrees. */
  at(pos, { anchor = 'palm', rot } = {}) {
    return this._instant((s) => {
      if (rot) s.rot = toQuat(rot);
      s.wrist = this._wristFor(pos, anchor, s.pose, s.rot);
    });
  }

  hide() {
    return this._instant((s) => (s.visible = false));
  }

  show() {
    return this._instant((s) => (s.visible = true));
  }

  wait(dur = 0.3) {
    return this._push(dur, (u, s) => s);
  }

  hold(dur = 0.3) {
    return this.wait(dur);
  }

  // ---- motion primitives ---------------------------------------------------

  /**
   * Move so `anchor` ends at `pos` after `dur` seconds.
   * opts: anchor ('grip'), ease ('inOutCubic'), pose (blend to this pose during the move),
   * rot (blend to this rotation), lift (m of extra height at mid-move, for arcing over things).
   */
  moveTo(pos, dur = 0.5, { anchor = DEFAULT_ANCHOR, ease: e = 'inOutCubic', pose, rot, lift = 0 } = {}) {
    const f = ease(e);
    const endPose = pose ? toPose(pose) : null;
    const endRot = rot ? toQuat(rot) : null;
    return this._push(dur, (u, s) => {
      const k = f(u);
      const pEnd = endPose ?? s.pose;
      const rEnd = endRot ?? s.rot;
      const wristEnd = this._wristFor(pos, anchor, pEnd, rEnd);
      const w = M.lerp(s.wrist, wristEnd, k);
      if (lift) w[1] += Math.sin(Math.PI * k) * lift;
      return {
        wrist: w,
        rot: endRot ? M.qSlerp(s.rot, endRot, k) : s.rot,
        pose: endPose ? lerpPose(s.pose, endPose, k) : s.pose,
        visible: s.visible,
      };
    });
  }

  moveBy(delta, dur = 0.5, opts = {}) {
    const anchor = opts.anchor ?? DEFAULT_ANCHOR;
    return this.moveTo(M.add(this.anchorAt(this.state, anchor), delta), dur, { ...opts, anchor });
  }

  /** Rotate the hand about `pivot` (an anchor that stays fixed in space). */
  rotateTo(rot, dur = 0.3, { pivot = DEFAULT_ANCHOR, ease: e = 'inOutSine' } = {}) {
    const f = ease(e);
    const target = toQuat(rot);
    return this._push(dur, (u, s) => {
      const pivotWorld = this.anchorAt(s, pivot);
      const r = M.qSlerp(s.rot, target, f(u));
      return { ...s, rot: r, wrist: this._wristFor(pivotWorld, pivot, s.pose, r) };
    });
  }

  // ---- gesture primitives --------------------------------------------------

  /** Blend to a pose (name from POSE_SPECS, a spec object, or a resolved pose). Wrist stays put. */
  pose(p, dur = 0.25, { ease: e = 'inOutSine' } = {}) {
    const f = ease(e);
    const target = toPose(p);
    return this._push(dur, (u, s) => ({ ...s, pose: lerpPose(s.pose, target, f(u)) }));
  }

  open(dur = 0.25) {
    return this.pose('open', dur);
  }

  fist(dur = 0.2) {
    return this.pose('fist', dur);
  }

  /** Close into a fist to grab (alias of fist, reads better in scripts). */
  grab(dur = 0.2) {
    return this.fist(dur);
  }

  pinch(dur = 0.2, { gap } = {}) {
    if (gap === undefined) return this.pose('pinch', dur);
    return this.pose({ ...POSE_SPECS.pinch, thumb: { mode: 'pinch', gap } }, dur);
  }

  releasePinch(dur = 0.2) {
    return this.pose('open', dur);
  }

  point(dur = 0.25) {
    return this.pose('point', dur);
  }

  /** Partial curl between open (0) and fist (1). */
  curl(amount, dur = 0.3) {
    return this.pose(curlPose(amount), dur);
  }

  // ---- compound motions ----------------------------------------------------

  /**
   * Throw whatever the hand holds so it flies from near `from` and lands at `to`.
   * The hand winds up, accelerates along the launch direction, carries at full speed for a few
   * frames (so a 5-frame velocity average sees the real speed), opens *while still moving*,
   * then follows through and decelerates.
   *
   * opts: speed is the release speed in m/s; arc 'low'|'high'; anchor ('grip');
   *       releaseHeight (m above `from` where the release happens); windup (m); carry (s);
   *       releaseDur (s the fingers take to open); followThrough (s); release (false keeps holding).
   */
  arcThrow(from, to, speed = 2.5, opts = {}) {
    const {
      arc = 'low', anchor = DEFAULT_ANCHOR, releaseHeight = 0.12, windup = 0.28,
      carry = 0.09, releaseDur = 0.06, followThrough = 0.22, approachDur = 0.35, release = true,
    } = opts;
    const dirH = M.normalize([to[0] - from[0], 0, to[2] - from[2]]);
    const R = M.add(M.add(from, [0, releaseHeight, 0]), M.scale(dirH, 0.04));
    // The grab ends a little after R (fingers take time to open); aim from there.
    let sol = ballisticVelocity(R, to, speed, { arc });
    for (let i = 0; i < 2; i++) sol = ballisticVelocity(M.add(R, M.scale(sol.v, releaseDur * 0.35)), to, speed, { arc });
    if (sol.clamped) this.notes.push(`arcThrow: ${speed} m/s cannot reach target; used ${sol.speed.toFixed(2)} m/s`);
    const v = sol.v;
    const s = sol.speed;
    const vhat = M.normalize(v);
    const R0 = M.sub(R, M.scale(v, carry));
    const W = M.sub(R0, M.scale(vhat, windup));
    const T = (2 * windup) / s; // constant acceleration from rest reaches speed s over `windup` metres

    this.moveTo(W, approachDur, { anchor, ease: 'inOutSine' });
    const along = (base, offset) => (u, st) => ({ ...st, wrist: this._wristFor(M.add(base, offset(u)), anchor, st.pose, st.rot) });
    this._push(T, along(W, (u) => M.scale(vhat, windup * u * u)));
    this._push(carry, along(R0, (u) => M.scale(v, carry * u)));
    const openPose = resolvePose('open');
    if (release) {
      this._push(releaseDur, (u, st) => ({
        ...st,
        pose: lerpPose(st.pose, openPose, u),
        wrist: this._wristFor(M.add(R, M.scale(v, releaseDur * u)), anchor, lerpPose(st.pose, openPose, u), st.rot),
      }));
    }
    const R1 = release ? M.add(R, M.scale(v, releaseDur)) : R;
    const tau = followThrough;
    return this._push(tau, along(R1, (u) => M.scale(v, tau * (u - (u * u) / 2))));
  }

  /**
   * Finger flick: curl the index behind the thumb, then snap it straight while the hand
   * jerks along `direction`. Place the hand first so the curled index tip sits just behind
   * the die (e.g. moveTo(p, 0.4, { anchor: 'index-finger-tip', pose: 'flickReady' })).
   */
  flick(direction, { distance = 0.08, duration = 0.1, readyDur = 0.25, hold = 0.25, ease: e = 'outQuad' } = {}) {
    const dir = M.normalize(direction);
    if (readyDur > 0) this.pose('flickReady', readyDur);
    const endPose = resolvePose('flickEnd');
    const f = ease(e);
    this._push(duration, (u, s) => {
      const k = f(u);
      return { ...s, pose: lerpPose(s.pose, endPose, k), wrist: M.add(s.wrist, M.scale(dir, distance * k)) };
    });
    return this.wait(hold);
  }

  /**
   * Poke `target` with the index fingertip: point, line up `standoff` metres short of the target
   * along `approach`, jab `depth` metres past the target centre, then retract.
   */
  poke(target, { approach = [0, -0.35, -1], standoff = 0.07, depth = 0.025, approachDur = 0.5, jabDur = 0.14, retractDur = 0.3 } = {}) {
    const dir = M.normalize(approach);
    const pre = M.sub(target, M.scale(dir, standoff));
    const anchor = 'index-finger-tip';
    this.moveTo(pre, approachDur, { anchor, pose: 'point', ease: 'inOutCubic' });
    this.moveTo(M.add(target, M.scale(dir, depth)), jabDur, { anchor, ease: 'inQuad' });
    return this.moveTo(pre, retractDur, { anchor, ease: 'inOutSine' });
  }

  // ---- output ----------------------------------------------------------------

  /** Simulated tracking error, applied at record time. See noise.js for fields. */
  noise(opts = {}) {
    this.noiseOpts = { ...(this.noiseOpts ?? {}), ...opts };
    return this;
  }

  record(opts = {}) {
    return recordHands([this], opts);
  }
}

export const hand = (handedness = 'right') => new HandScript(handedness);

/**
 * Sample one or more hand scripts into a HandRecording v1.
 * opts: fps (72), tail (s to hold the final state, default 0.25), name, description,
 *       setup (scene setup for the app, e.g. dice placement), decimals (4), expect (free-form).
 */
export function recordHands(scripts, opts = {}) {
  const { fps = 72, tail = 0.25, name, description, setup, decimals = 4, expect } = opts;
  const byHand = {};
  for (const s of scripts) {
    if (byHand[s.handedness]) throw new Error(`two scripts for the ${s.handedness} hand`);
    byHand[s.handedness] = s;
  }
  const duration = Math.max(...scripts.map((s) => s.duration)) + tail;
  const count = Math.floor(duration * fps + 1e-9) + 1;
  const noisers = Object.fromEntries(scripts.map((s) => [s.handedness, s.noiseOpts ? createNoise(s.noiseOpts) : null]));
  const frames = [];
  for (let i = 0; i < count; i++) {
    const t = i / fps;
    const f = { t };
    for (const s of scripts) {
      let j = s.jointsAt(t);
      const nz = noisers[s.handedness];
      if (nz) j = nz(j, 1 / fps);
      if (j) f[s.handedness] = j;
    }
    frames.push(f);
  }
  const meta = { generator: 'harness/synth', duration: +duration.toFixed(4) };
  if (name) meta.name = name;
  if (description) meta.description = description;
  if (setup) meta.setup = setup;
  if (expect) meta.expect = expect;
  const noise = scripts.filter((s) => s.noiseOpts).map((s) => ({ hand: s.handedness, ...s.noiseOpts }));
  if (noise.length) meta.noise = noise;
  const notes = scripts.flatMap((s) => s.notes);
  if (notes.length) meta.notes = notes;
  return roundRecording(createRecording({ source: 'synthetic', fps, frames, meta }), decimals);
}
