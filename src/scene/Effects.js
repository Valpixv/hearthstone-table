import * as THREE from 'three';
import { textSprite } from './util.js';
import { FxPool } from '../fx/FxPool.js';

const _col = new THREE.Color();

/**
 * Short-lived particle bursts and floating labels.
 * Bursts and puffs share two GPU-simulated particle pools (one additive, one smoke) — no per-burst
 * geometry, no per-particle CPU work, and no draw call when idle.
 */
export class Effects {
  constructor(scene) {
    this.scene = scene; this.items = [];
    this.sparks = new FxPool(scene, { capacity: 2048 });
    this.smoke = new FxPool(scene, { capacity: 128, blending: THREE.NormalBlending });
  }

  /** Radial upward burst of glowing particles at `pos` (options keep their original meaning). */
  burst(pos, color = '#ffd34d', { count = 120, speed = 1.2, life = 1.4, size = 0.03, gravity = -2.5 } = {}) {
    _col.set(color);
    const r = _col.r * 1.6, g = _col.g * 1.6, b = _col.b * 1.6; // >1 so bloom catches the hot core
    for (let i = 0; i < count; i++) {
      // Random direction (hemisphere-biased upward, as before) without allocating vectors.
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, q = Math.sqrt(1 - u * u);
      const s = speed * (0.3 + Math.random());
      const hot = Math.random() < 0.25 ? 1.6 : 1;
      this.sparks.spawn(pos.x, pos.y, pos.z, q * Math.cos(a) * s, Math.abs(u) * 1.2 * s, q * Math.sin(a) * s, gravity,
        r * hot, g * hot, b * hot, life * (0.6 + Math.random() * 0.4), size * (0.7 + Math.random() * 0.6), 0.4, 0.3);
    }
  }

  /** Coloured flash + dark smoke puff + sparks (used for nat-1s). */
  puff(pos, color = '#ff2a2a') {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.08 + Math.random() * 0.12, v = 0.05 + Math.random() * 0.06;
      this.smoke.spawn(pos.x, pos.y, pos.z, Math.cos(a) * s, 0.15 + Math.random() * 0.2, Math.sin(a) * s, 0.05,
        v, v * 0.9, v * 0.85, 1.2 + Math.random() * 0.8, 0.06 + Math.random() * 0.04, 2, 3.5);
    }
    this.burst(pos, color, { count: 50, speed: 0.4, gravity: 0.5, life: 1.0, size: 0.04 });
  }

  label(text, pos, { color = '#fff4d6', glow = '#ffae00', life = 2.6, scale = 0.06 } = {}) {
    const w = Math.min(2048, Math.max(256, 64 + String(text).length * 46)); // wide enough for roll outcomes
    const s = textSprite(text, { w, h: 128, font: 'bold 84px Georgia', color, glow, scale, bg: 'rgba(20,12,4,0.75)' });
    s.position.copy(pos); s.renderOrder = 10; this.scene.add(s);
    const y0 = pos.y;
    this.items.push({ obj: s, t: 0, life, update: (dt, k) => { s.position.y = y0 + k * 0.05; s.material.opacity = k > 0.8 ? (1 - k) * 5 : 1; } });
    return s;
  }

  update(dt) {
    this.sparks.update(dt); this.smoke.update(dt);
    let w = 0;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      it.t += dt; const k = Math.min(1, it.t / it.life);
      it.update(dt, k);
      if (k >= 1) { this.scene.remove(it.obj); if (it.obj.isSprite) it.obj.material.map.dispose(); else it.obj.geometry?.dispose(); it.obj.material?.dispose(); }
      else this.items[w++] = it;
    }
    this.items.length = w;
  }
}
