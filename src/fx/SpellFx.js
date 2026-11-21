import * as THREE from 'three';
import { FxPool } from './FxPool.js';
import EFFECTS from '../data/effects.json';

/** Effect rows by id (src/data/effects.json). */
export const SPELL_EFFECTS = EFFECTS.effects;
/** Tuning: particle budget and how bright effects drive the bloom. */
export const SPELL_CFG = { capacity: 8000, glow: 2.4, lightRange: 4, maxLive: 24, sizeScale: 0.45, impactSpeed: 0.45 };

const V = (a) => (a?.isVector3 ? a.clone() : new THREE.Vector3(...a));
const lin = (hex, k = SPELL_CFG.glow) => { const c = new THREE.Color(hex); return [c.r * k, c.g * k, c.b * k]; };
const rnd = (a = 1) => (Math.random() * 2 - 1) * a;
const SOUND = {
  whoosh: (a) => a.noise?.(0.45, { type: 'bandpass', freq: 900, freqEnd: 260, gain: 0.25, attack: 0.03 }),
  zap: (a) => a.tone?.(1400, 0.28, { type: 'sawtooth', freqEnd: 180, gain: 0.1, filter: 4000 }),
  boom: (a) => { a.noise?.(0.9, { type: 'lowpass', freq: 300, gain: 0.6, attack: 0.01 }); a.tone?.(60, 0.7, { gain: 0.35 }); },
  chime: (a) => a.chime?.(),
  hiss: (a) => a.noise?.(0.6, { type: 'highpass', freq: 2500, gain: 0.18, attack: 0.05 }),
  thud: (a) => { a.tone?.(85, 0.35, { gain: 0.4 }); a.noise?.(0.2, { type: 'lowpass', freq: 400, gain: 0.4 }); },
};

/**
 * Gesture-spell visuals (design/feature-expansion-plan.md §6). Six archetypes driven by data:
 * projectile, beam, cone, burst (explode / pillar / spikes / vines / meteor / ring), aura, blink.
 * One GPU particle pool (one draw call) plus one flash light. Cosmetic only: nothing here touches game state.
 */
export class SpellFx {
  /** @param {{ scene: THREE.Scene, audio?: object }} deps */
  constructor({ scene, audio = null }) {
    this.audio = audio; this.live = [];
    this.pool = new FxPool(scene, { capacity: SPELL_CFG.capacity });
    this.light = new THREE.PointLight('#ffffff', 0, SPELL_CFG.lightRange, 2); scene.add(this.light);
  }

  /**
   * Plays an effect from origin to target (world positions, arrays or Vector3). Unknown ids are ignored.
   * @returns {boolean} whether it played
   */
  play(id, { origin, target, chain = [] } = {}) {
    const row = SPELL_EFFECTS[id]; if (!row || !origin) return false;
    const e = { ...row, size: (row.size || 0.05) * SPELL_CFG.sizeScale };
    if (this.live.length >= SPELL_CFG.maxLive) this.live.shift();
    const o = V(origin), t = target ? V(target) : o.clone().add(new THREE.Vector3(0, 0, -2));
    const run = { e, o, t, age: 0, done: false, c1: lin(e.color), c2: lin(e.color2 || e.color, SPELL_CFG.glow * 1.3), chain: chain.map(V) };
    const start = { projectile: this.startProjectile, beam: this.startBeam, cone: this.startCone, burst: this.startBurst, aura: this.startAura, blink: this.startBlink }[e.archetype];
    if (!start) return false;
    start.call(this, run); this.live.push(run);
    if (this.audio && SOUND[e.sound]) try { SOUND[e.sound](this.audio); } catch { /* audio not started yet */ }
    return true;
  }

  // ---------- archetypes: each sets run.tick(dt) ----------
  startProjectile(r) {
    const { e } = r, n = e.count || 1, dist = r.o.distanceTo(r.t), dur = Math.max(0.15, dist / (e.speed || 6));
    const side = new THREE.Vector3().subVectors(r.t, r.o).cross(new THREE.Vector3(0, 1, 0)).normalize();
    r.bolts = Array.from({ length: n }, (_, i) => ({
      end: r.t.clone().add(n > 1 ? new THREE.Vector3(rnd(0.15), rnd(0.08), rnd(0.15)) : new THREE.Vector3()),
      bend: side.clone().multiplyScalar((e.curve || 0) * dist * (n > 1 ? (i / (n - 1) - 0.5) * 2 : 0)).add(new THREE.Vector3(0, (e.curve || 0) * dist * 0.3, 0)),
      delay: i * 0.07, hit: false,
    }));
    const p = new THREE.Vector3();
    r.tick = (dt) => {
      let all = true;
      for (const b of r.bolts) {
        const k = (r.age - b.delay) / dur; if (k < 0) { all = false; continue; }
        if (k >= 1) { if (!b.hit) { b.hit = true; this.impact(b.end, r, e.impact || 0.8); } continue; }
        all = false;
        p.lerpVectors(r.o, b.end, k).addScaledVector(b.bend, Math.sin(k * Math.PI));
        for (let i = 0; i < 3; i++) this.pool.spawn(p.x + rnd(0.01), p.y + rnd(0.01), p.z + rnd(0.01), rnd(0.05), rnd(0.05), rnd(0.05), 0, ...r.c2, 0.12, e.size, 0, 0.6);
        for (let i = 0; i < 2; i++) this.pool.spawn(p.x, p.y, p.z, rnd(0.25), rnd(0.25) + 0.1, rnd(0.25), 0, ...r.c1, 0.45, e.size * 0.7, 2, 0.2);
      }
      r.done = all;
    };
  }

  startBeam(r) {
    const { e } = r, pts = [r.o, r.t, ...r.chain];
    if (e.chain && r.chain.length === 0) for (let i = 1; i < e.chain; i++) pts.push(pts.at(-1).clone().add(new THREE.Vector3(rnd(0.9), rnd(0.15), rnd(0.9))));
    let flash = 0; const p = new THREE.Vector3();
    r.tick = (dt) => {
      if (r.age > (e.duration || 0.5)) { r.done = true; return; }
      for (let s = 0; s < pts.length - 1; s++) {
        const a = pts[s], b = pts[s + 1], n = Math.min(80, Math.ceil(a.distanceTo(b) / 0.03));
        for (let i = 0; i <= n; i++) {
          if (Math.random() > 0.55) continue;
          p.lerpVectors(a, b, i / n); const j = e.jitter || 0;
          this.pool.spawn(p.x + rnd(j), p.y + rnd(j), p.z + rnd(j), rnd(0.05), rnd(0.05), rnd(0.05), 0, ...(Math.random() < 0.5 ? r.c2 : r.c1), 0.09, e.size, 0, 0.5);
        }
      }
      if ((flash -= dt) <= 0) { flash = 0.12; for (const q of pts.slice(1)) this.flashAt(q, e.color, 2.5); }
    };
  }

  startCone(r) {
    const { e } = r, dir = new THREE.Vector3().subVectors(r.t, r.o).normalize(), v = new THREE.Vector3();
    r.tick = () => {
      if (r.age > (e.duration || 0.6)) { r.done = true; return; }
      for (let i = 0; i < 30; i++) {
        v.copy(dir).add(new THREE.Vector3(rnd(e.spread), rnd(e.spread * 0.6), rnd(e.spread))).normalize().multiplyScalar((e.speed || 3) * (0.6 + Math.random() * 0.6));
        this.pool.spawn(r.o.x, r.o.y, r.o.z, v.x, v.y, v.z, 0.3, ...(Math.random() < 0.4 ? r.c2 : r.c1), 0.7, e.size, 1.2, 2.2);
      }
      this.flashAt(r.o, e.color, 1.5);
    };
  }

  startBurst(r) {
    const { e } = r, R = e.radius || 0.6, t = r.t;
    const meteor = e.shape === 'meteor' ? { o: t.clone().add(new THREE.Vector3(0.8, 4.5, -0.6)), k: 0 } : null;
    let fired = false;
    r.tick = (dt) => {
      if (meteor && meteor.k < 1) {
        meteor.k = Math.min(1, meteor.k + dt * 3.2);
        const p = new THREE.Vector3().lerpVectors(meteor.o, t, meteor.k);
        for (let i = 0; i < 8; i++) this.pool.spawn(p.x + rnd(0.04), p.y + rnd(0.04), p.z + rnd(0.04), rnd(0.3), 0.6, rnd(0.3), 0, ...(i % 2 ? r.c1 : r.c2), 0.5, e.size, 1, 0.3);
        if (meteor.k < 1) return;
      }
      if (!fired) {
        fired = true; this.flashAt(t, e.color, 4);
        if (e.shape === 'explode' || e.shape === 'meteor') this.impact(t, r, R * 2);
      }
      const T = r.age, dur = 1.0;
      if (T > dur + (meteor ? 0.35 : 0)) { r.done = true; return; }
      const n = 18;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * R, x = t.x + Math.cos(a) * rr, z = t.z + Math.sin(a) * rr;
        if (e.shape === 'pillar') this.pool.spawn(x * 0.3 + t.x * 0.7, t.y, z * 0.3 + t.z * 0.7, rnd(0.05), 2.4 + Math.random() * 1.5, rnd(0.05), 0, ...(i % 3 ? r.c2 : r.c1), 0.9, e.size, 0.5, 0.4);
        else if (e.shape === 'spikes') { if (i % 3 === 0) this.pool.spawn(x, t.y, z, 0, 2.2, 0, -6, ...r.c1, 0.45, e.size * 1.4, 0, 0.1); }
        else if (e.shape === 'vines') this.pool.spawn(x, t.y, z, Math.cos(a + 1.6) * 0.3, 0.35 + Math.random() * 0.4, Math.sin(a + 1.6) * 0.3, -0.2, ...(i % 2 ? r.c1 : r.c2), 1.2, e.size, 0.8, 1.2);
        else if (e.shape === 'ring') { const k = Math.min(1, T / 0.5); this.pool.spawn(t.x + Math.cos(a) * R * k, t.y + 0.05, t.z + Math.sin(a) * R * k, Math.cos(a) * 1.5, 0.1, Math.sin(a) * 1.5, 0, ...r.c2, 0.35, e.size, 1.5, 1.6); }
        else if (T < 0.25) this.pool.spawn(x, t.y + 0.05, z, rnd(0.6), Math.random() * 1.2, rnd(0.6), -1.5, ...(i % 2 ? r.c1 : r.c2), 0.8, e.size, 1, 1.4);
      }
    };
  }

  startAura(r) {
    const { e } = r, c = r.t, R = e.radius || 0.35;
    r.tick = () => {
      if (r.age > (e.duration || 1.5)) { r.done = true; return; }
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2, h = Math.random() * 1.6;
        this.pool.spawn(c.x + Math.cos(a) * R, c.y + h * 0.2, c.z + Math.sin(a) * R, -Math.sin(a) * 0.6, 0.5 + Math.random() * 0.5, Math.cos(a) * 0.6, 0, ...(i % 2 ? r.c1 : r.c2), 0.9, e.size, 0.4, 0.8);
      }
      if (Math.random() < 0.15) this.flashAt(c, e.color, 1.2);
    };
  }

  startBlink(r) {
    let second = false;
    this.impact(r.o, r, 0.6);
    r.tick = () => { if (!second && r.age > 0.2) { second = true; this.impact(r.t, r, 0.6); } if (r.age > 0.6) r.done = true; };
  }

  /** Radial burst + flash at a point. */
  impact(p, r, strength = 1) {
    const { e } = r, n = Math.round(50 + 70 * strength);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(rnd(1), rnd(1) + 0.3, rnd(1)).normalize().multiplyScalar(SPELL_CFG.impactSpeed * strength * (0.6 + Math.random() * 1.4));
      this.pool.spawn(p.x, p.y, p.z, v.x, v.y, v.z, -1, ...(i % 3 ? r.c1 : r.c2), 0.35 + Math.random() * 0.4, e.size * 0.9, 3, 1.3);
    }
    this.flashAt(p, e.color, 3 * strength);
  }

  flashAt(p, color, intensity) { this.light.position.copy(p); this.light.color.set(color); this.light.intensity = Math.max(this.light.intensity, intensity); }

  update(dt) {
    for (const r of this.live) { r.age += dt; r.tick?.(dt); }
    this.live = this.live.filter((r) => !r.done);
    this.light.intensity *= Math.exp(-dt * 9);
    this.pool.update(dt);
  }

  /** True while anything is still animating (for tests). */
  get busy() { return this.live.length > 0; }
}
