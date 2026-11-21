// Replays a HandRecording v1 file as if it were live hand tracking.
//
// Same interface as XRHandSource / WebcamHandSource: update(dt) -> { left?, right? } with the 25
// WebXR joints per hand in world metres, so InputManager, GrabSystem and the dice can't tell a
// replay from a headset.
//
// Determinism: the source advances by exactly the `dt` it is given (simulation time), never by
// wall-clock time. The app runs fixed 1/72 s ticks in replay mode and asks `ticksDue(wallDt)` how
// many to run per animation frame, so speed / pause / step change how fast you *watch* the run,
// never its outcome.
//
// URL params (read by main.js and here): ?replay=<url>&speed=1&seed=42[&loop=1][&paused=1]
//   [&replayEnd=hold|hide][&replayUi=0]
// Keys while replaying: K play/pause, . step one tick, [ / ] slower / faster, L toggle loop.

import { parseRecording } from '../../harness/format/recording.js';

export const REPLAY_DT = 1 / 72;
export const SPEEDS = [0.25, 0.5, 1, 2, 4];
const MAX_TICKS_PER_FRAME = 32;
// Frame times are stored to 1 µs; treat anything within 10 µs as "on" a frame so fixed ticks
// land exactly on recorded samples instead of interpolating float noise.
const EPS = 1e-5;

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function slerp(a, b, t) {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let wa = 1 - t, wb = t;
  if (cos < 0.9995) {
    const th = Math.acos(cos), s = Math.sin(th);
    wa = Math.sin((1 - t) * th) / s; wb = Math.sin(t * th) / s;
  }
  const q = [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
  const l = Math.hypot(...q) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

function lerpHand(a, b, t) {
  const out = {};
  for (const name in a) {
    const ja = a[name], jb = b[name];
    out[name] = jb ? { p: lerp(ja.p, jb.p, t), q: slerp(ja.q, jb.q, t), r: ja.r + (jb.r - ja.r) * t } : ja;
  }
  return out;
}

function readParams() {
  if (typeof location === 'undefined') return {};
  const q = new URLSearchParams(location.search);
  return {
    loop: q.get('loop') === '1' || q.get('loop') === 'true',
    paused: q.get('paused') === '1',
    endBehavior: q.get('replayEnd') || undefined,
    ui: q.get('replayUi') !== '0',
  };
}

export class ReplayInputSource {
  /**
   * @param {object} opts
   * @param {string} [opts.url] recording to fetch (packed or canonical JSON)
   * @param {object} [opts.recording] an already-loaded recording (skips fetch)
   * @param {number} [opts.speed=1] playback speed, clamped to 0.25..4
   * @param {number|string} [opts.seed] informational; the app seeds its own RNG from ?seed=
   * @param {boolean} [opts.loop=false]
   * @param {'hold'|'hide'} [opts.endBehavior='hold'] after the last frame: keep returning it, or no hands
   * @param {THREE.Scene} [opts.scene] if given, ghost hands are drawn into it
   * @param {boolean} [opts.ui] show the on-screen replay controls (default: true in a browser)
   */
  constructor(opts = {}) {
    const p = readParams();
    this.url = opts.url ?? null;
    this.recording = opts.recording ? parseRecording(opts.recording) : null;
    this.seed = opts.seed ?? null;
    this.loop = opts.loop ?? p.loop ?? false;
    this.paused = opts.paused ?? p.paused ?? false;
    this.endBehavior = opts.endBehavior ?? p.endBehavior ?? 'hold';
    this.wantUi = opts.ui ?? (p.ui !== false && typeof document !== 'undefined');
    this.setSpeed(opts.speed ?? 1);
    this.time = 0; // simulation seconds into the recording
    this.ticks = 0; // update() calls so far
    this.loops = 0;
    this.cursor = 0; // index of the frame at or before `time`
    this.lastFrame = {};
    this.accumulator = 0;
    this.pendingSteps = 0;
    this.ghosts = null;
    this.ui = null;
    this.listeners = new Set();
    if (opts.scene) this.attachGhosts(opts.scene);
    if (typeof window !== 'undefined') window.__hearthstoneReplay = this;
  }

  async load() {
    if (!this.recording) {
      if (!this.url) throw new Error('ReplayInputSource: no url or recording');
      const res = await fetch(this.url);
      if (!res.ok) throw new Error(`ReplayInputSource: ${this.url} -> HTTP ${res.status}`);
      this.recording = parseRecording(await res.text());
    }
    this.frames = this.recording.frames;
    this.fps = this.recording.fps;
    this.t0 = this.frames[0].t;
    this.duration = this.frames[this.frames.length - 1].t - this.t0;
    /** Scene setup requested by the recording (dice placement); main.js applies it. */
    this.setup = this.recording.meta?.setup ?? null;
    this.meta = this.recording.meta ?? {};
    if (this.wantUi && !this.ui) this.mountUi();
    this.emit();
    return this;
  }

  // ---- InputManager joint-source interface -------------------------------------

  /**
   * Return the frame at the current replay time, then advance by exactly `dt` (simulation
   * seconds). Speed and pause never apply here — they only change how many ticks the app runs
   * (see ticksDue) — so the same number of ticks always produces the same run.
   */
  update(dt) {
    if (!this.frames) return {};
    const frame = this.sample(this.time);
    this.lastFrame = frame;
    this.ghosts?.update(frame);
    this.time += dt;
    this.ticks++;
    if (this.loop && this.time > this.duration + EPS) {
      this.time = 0;
      this.cursor = 0;
      this.loops++;
    }
    if (this.ticks % 6 === 0) this.emit();
    return frame;
  }

  dispose() {
    this.ghosts?.dispose();
    this.ui?.remove();
    if (typeof window !== 'undefined' && window.__hearthstoneReplay === this) delete window.__hearthstoneReplay;
  }

  // ---- sampling ---------------------------------------------------------------

  /** Frame at simulation time t (seconds from the start), linearly interpolated between samples. */
  sample(t) {
    const frames = this.frames;
    const at = this.t0 + t;
    const last = frames[frames.length - 1];
    if (at >= last.t - EPS) {
      if (at > last.t + EPS && this.endBehavior === 'hide') return {};
      this.cursor = frames.length - 1;
      return pick(last);
    }
    if (frames[this.cursor].t > at) this.cursor = 0;
    while (this.cursor < frames.length - 1 && frames[this.cursor + 1].t <= at + EPS) this.cursor++;
    const a = frames[this.cursor];
    const b = frames[this.cursor + 1];
    const u = (at - a.t) / (b.t - a.t);
    if (at - a.t <= EPS) return pick(a);
    const out = {};
    for (const h of ['left', 'right']) {
      if (a[h] && b[h]) out[h] = lerpHand(a[h], b[h], u);
      else if (a[h] && u < 0.5) out[h] = a[h];
      else if (b[h] && u >= 0.5) out[h] = b[h];
    }
    return out;
  }

  get frameIndex() {
    return this.cursor;
  }

  get frameCount() {
    return this.frames?.length ?? 0;
  }

  /** True once playback has passed the last frame (never true while looping). */
  get done() {
    return !!this.frames && !this.loop && this.time > this.duration + EPS;
  }

  // ---- playback control ---------------------------------------------------------

  /**
   * How many fixed REPLAY_DT ticks the app should run this animation frame.
   * @param {number} wallDt real seconds since the last animation frame
   */
  ticksDue(wallDt) {
    if (this.paused) {
      const n = this.pendingSteps;
      this.pendingSteps = 0;
      return n;
    }
    this.accumulator += Math.min(Math.max(wallDt, 0), 0.25) * this.speed;
    let n = Math.floor(this.accumulator / REPLAY_DT + 1e-9);
    this.accumulator -= n * REPLAY_DT;
    if (n > MAX_TICKS_PER_FRAME) n = MAX_TICKS_PER_FRAME;
    return n;
  }

  play() { this.paused = false; this.emit(); }
  pause() { this.paused = true; this.emit(); }
  toggle() { this.paused ? this.play() : this.pause(); }
  /** Advance `n` ticks while paused (pauses if playing). */
  step(n = 1) { this.paused = true; this.pendingSteps += n; this.emit(); }
  setSpeed(s) { this.speed = Math.min(4, Math.max(0.25, Number(s) || 1)); this.emit?.(); }
  setLoop(on) { this.loop = !!on; this.emit(); }
  faster() { this.setSpeed(SPEEDS.find((s) => s > this.speed) ?? 4); }
  slower() { this.setSpeed([...SPEEDS].reverse().find((s) => s < this.speed) ?? 0.25); }

  /** Subscribe to state changes (UI). Returns an unsubscribe function. */
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { if (this.listeners) for (const fn of this.listeners) fn(this); }

  // ---- visuals ------------------------------------------------------------------

  /** Draw semi-transparent ghost hands (joint spheres + bones) for each replayed frame. */
  async attachGhosts(scene) {
    const { GhostHands } = await import('./GhostHands.js');
    this.ghosts = new GhostHands(scene);
    this.ghosts.update(this.lastFrame);
  }

  mountUi() {
    import('./replayControls.js').then(({ mountReplayControls }) => (this.ui = mountReplayControls(this))).catch((e) => console.warn('replay UI unavailable', e));
  }
}

function pick(f) {
  const out = {};
  if (f.left) out.left = f.left;
  if (f.right) out.right = f.right;
  return out;
}
