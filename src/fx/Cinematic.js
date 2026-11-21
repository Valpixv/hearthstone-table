import * as THREE from 'three';
import { FxPool } from './FxPool.js';
import { runeTex, innerRuneTex, ringTex, flashTex, pillarTex, crackTex } from './cinematicTextures.js';

// Dragonfire palette (design/dragon-ui-moodboard.html).
const GOLD = '#ffcf4d';
const PAL = { ember: '#ff5a1f', emberHi: '#ff8a3d', gold: '#d9a441', goldHi: '#f3d58a', magma: '#8e1b0e', arcane: '#6fb7ff' };

const NOISE_GLSL = `
float dHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float dNoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dHash(i), dHash(i + vec3(1,0,0)), f.x), mix(dHash(i + vec3(0,1,0)), dHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(dHash(i + vec3(0,0,1)), dHash(i + vec3(1,0,1)), f.x), mix(dHash(i + vec3(0,1,1)), dHash(i + vec3(1,1,1)), f.x), f.y), f.z); }
`;

const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const easeOut3 = (k) => 1 - Math.pow(1 - k, 3);
const _c = new THREE.Color(), _c2 = new THREE.Color(), _v = new THREE.Vector3();

// Shared unit geometries (never disposed per effect).
let flatQuad = null, pillarGeo = null;
const getFlatQuad = () => flatQuad || (flatQuad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
const getPillarGeo = () => pillarGeo || (pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true).translate(0, 0.5, 0));

/** Draws a damage number with optional outline into a reusable canvas. */
function drawNumber(g, w, h, text, { fill, glow, outline, px }) {
  g.clearRect(0, 0, w, h);
  g.font = `900 ${px}px Georgia`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.shadowColor = glow; g.shadowBlur = 28;
  g.lineWidth = px * 0.16; g.strokeStyle = outline || 'rgba(10,6,4,0.95)'; g.strokeText(text, w / 2, h / 2);
  g.shadowBlur = 0;
  if (outline) { g.lineWidth = px * 0.06; g.strokeStyle = '#1a0d04'; g.strokeText(text, w / 2, h / 2); }
  const gr = g.createLinearGradient(0, h / 2 - px / 2, 0, h / 2 + px / 2);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, fill); gr.addColorStop(1, fill);
  g.fillStyle = gr; g.fillText(text, w / 2, h / 2);
}

/**
 * Cinematic FX layer: summons, dissolves, damage numbers, slow-mo crits, fumbles, camera shake, letterbox.
 * main.js multiplies the simulation dt by `timeScale`, adds `shakeOffset` to the desktop camera,
 * and eases the camera toward `focus` when non-null. Call `update(realDt)` once per frame.
 * Respects prefers-reduced-motion: no slow-mo and no shake when set.
 */
export class Cinematic {
  /** @param {{scene: THREE.Scene, camera: THREE.Camera, effects?: object, audio?: object}} deps */
  constructor({ scene, camera, effects = null, audio = null }) {
    Object.assign(this, { scene, camera, effects, audio });
    this.items = [];
    /** Simulation time multiplier (1 = normal). */
    this.timeScale = 1;
    /** Camera offset to add to the desktop camera position. */
    this.shakeOffset = new THREE.Vector3();
    /** Point the desktop camera should ease toward, or null. */
    this.focus = null;
    this.cinematic = false;
    this._slow = null; this._shake = null;
    this._quadFree = []; this._numFree = [];
    /** Additive sparks/motes (GPU-simulated, one draw call, no draw when idle). */
    this.sparks = new FxPool(scene, { capacity: 1024 });
    /** Normal-blended smoke. */
    this.smoke = new FxPool(scene, { capacity: 128, blending: THREE.NormalBlending });
    this.bars = ['top', 'bottom'].map((side) => {
      const d = document.createElement('div');
      d.style.cssText = `position:fixed;left:0;width:100%;height:0;${side}:0;background:#000;z-index:50;pointer-events:none;transition:height 0.6s ease;`;
      document.body.appendChild(d);
      return d;
    });
  }

  _sfx(name) { try { const a = this.audio; (a?.sfx || a?.play)?.call(a, name); } catch { /* audio optional */ } }

  /** Registers a timed item: step(k, realDt) runs each frame with k in [0,1]; done() runs at the end. */
  _add(life, step, done) { this.items.push({ t: 0, life, step, done }); }

  /** Pooled textured mesh (shared unit geometry, own material). Return it with `_release`. */
  _quad(map, color, { geo = getFlatQuad(), blending = THREE.AdditiveBlending, side = THREE.DoubleSide, order = 6 } = {}) {
    let m = this._quadFree.pop();
    if (!m) m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false }));
    m.geometry = geo;
    const mat = m.material;
    mat.map = map; mat.color.set(color); mat.blending = blending; mat.side = side; mat.opacity = 0;
    m.renderOrder = order; m.rotation.set(0, 0, 0); m.scale.setScalar(1); m.visible = true;
    this.scene.add(m);
    return m;
  }

  _release(...meshes) { for (const m of meshes) { this.scene.remove(m); if (this._quadFree.length < 24) this._quadFree.push(m); else m.material.dispose(); } }

  /** Emits `n` particles into `pool` at `pos`; `fn(i, o)` fills the reusable param object (no allocation). */
  _emit(pool, n, pos, fn) {
    const o = this._eo || (this._eo = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, color: new THREE.Color(), life: 1, size: 0.01, drag: 0, grow: 0.4 });
    for (let i = 0; i < n; i++) {
      o.x = pos.x; o.y = pos.y; o.z = pos.z; o.drag = 0; o.grow = 0.4;
      fn(i, o);
      pool.spawn(o.x, o.y, o.z, o.vx, o.vy, o.vz, o.g, o.color.r, o.color.g, o.color.b, o.life, o.size, o.drag, o.grow);
    }
  }

  /**
   * Summoning: rune circle with counter-rotating outer/inner rings, rising arcane/ember motes and a
   * vertical light pillar that flares then fades (~1.9 s).
   */
  summon(pos, { radius = 0.06, color = '#7fd4ff' } = {}) {
    const R = radius, y = pos.y + 0.002;
    const outer = this._quad(runeTex(), color);
    const inner = this._quad(innerRuneTex(), PAL.emberHi);
    const glow = this._quad(ringTex(), color);
    const pillar = this._quad(pillarTex(), color, { geo: getPillarGeo(), order: 7 });
    for (const m of [outer, inner, glow, pillar]) m.position.set(pos.x, y, pos.z);
    inner.position.y += 0.001; glow.position.y -= 0.001;
    const tint = new THREE.Color(color), ember = new THREE.Color(PAL.emberHi), arc = new THREE.Color(PAL.arcane);
    this._emit(this.sparks, 90, pos, (i, o) => {
      const a = Math.random() * Math.PI * 2, r = R * (0.2 + Math.random() * 0.85);
      o.x = pos.x + Math.cos(a) * r; o.z = pos.z + Math.sin(a) * r; o.y = pos.y + 0.01;
      o.vx = Math.cos(a) * R * 0.25; o.vz = Math.sin(a) * R * 0.25; o.vy = R * (1.2 + Math.random() * 2.2); o.g = R * 0.6;
      o.color.copy(i % 3 === 0 ? ember : i % 3 === 1 ? tint : arc).multiplyScalar(2.2);
      o.life = 1.1 + Math.random() * 0.9; o.size = R * (0.05 + Math.random() * 0.06); o.drag = 0.6; o.grow = 0.2;
    });
    this._sfx('summon');
    this._add(1.9, (k) => {
      const open = easeOut3(Math.min(1, k * 2.2));
      const fade = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      outer.scale.setScalar(R * 2 * (0.3 + 0.75 * open)); outer.rotation.y = k * Math.PI * 1.2;
      outer.material.opacity = fade * 0.95;
      inner.scale.setScalar(R * 1.35 * (0.2 + 0.8 * open)); inner.rotation.y = -k * Math.PI * 2.2;
      inner.material.opacity = fade * 0.85;
      glow.scale.setScalar(R * 2.6 * open); glow.material.opacity = fade * 0.5 * (0.8 + 0.2 * Math.sin(k * 40));
      const p = k < 0.18 ? k / 0.18 : 1 - Math.min(1, (k - 0.18) / 0.6);
      const pr = R * 0.75 * (0.6 + 0.4 * p);
      pillar.scale.set(pr, R * 6 * (0.4 + 0.6 * easeOut3(Math.min(1, k * 4))), pr);
      pillar.material.opacity = Math.max(0, p) * 0.75;
    }, () => this._release(outer, inner, glow, pillar));
  }

  _dissolve(object3d, duration, reverse, { edge = PAL.ember, hot = PAL.goldHi, scale = 40 } = {}, cb = null) {
    const uT = { value: reverse ? 1 : 0 }, uEdge = { value: new THREE.Color(edge).multiplyScalar(4) };
    const uHot = { value: new THREE.Color(hot).multiplyScalar(6) }, uScale = { value: scale };
    const saved = [], clones = [];
    const patch = (src) => {
      const m = src.clone();
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, { uDT: uT, uDEdge: uEdge, uDHot: uHot, uDScale: uScale });
        sh.vertexShader = 'varying vec3 vDWorld;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
          vec4 dw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
          dw = instanceMatrix * dw;
          #endif
          vDWorld = (modelMatrix * dw).xyz;`);
        sh.fragmentShader = 'varying vec3 vDWorld;\nuniform float uDT;\nuniform vec3 uDEdge;\nuniform vec3 uDHot;\nuniform float uDScale;\n' + NOISE_GLSL +
          sh.fragmentShader
            .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
              vec3 dp = vDWorld * uDScale;
              float dN = dNoise(dp) * 0.55 + dNoise(dp * 2.7 + 3.1) * 0.3 + dNoise(dp * 7.3 + 1.7) * 0.15;
              float dTh = uDT * 1.08 - 0.04;
              if (dN > dTh) discard;
              float dD = dTh - dN;
              float dEdge = (1.0 - smoothstep(0.0, 0.1, dD)) * (1.0 - smoothstep(0.9, 1.0, uDT)) * smoothstep(0.0, 0.03, uDT);
              float dHotK = 1.0 - smoothstep(0.0, 0.025, dD);`)
            .replace('#include <opaque_fragment>', `outgoingLight = mix(outgoingLight, outgoingLight * 0.25, dEdge);
              outgoingLight += mix(uDEdge, uDHot, dHotK) * dEdge;
              #include <opaque_fragment>`);
      };
      m.customProgramCacheKey = () => 'dissolve-v2';
      clones.push(m);
      return m;
    };
    object3d.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      saved.push([o, o.material]);
      o.material = Array.isArray(o.material) ? o.material.map(patch) : patch(o.material);
    });
    if (reverse) {
      // Ember flakes peel off the burning body.
      const b = new THREE.Box3().setFromObject(object3d);
      if (!b.isEmpty()) {
        const c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3());
        const e = new THREE.Color(PAL.emberHi), gd = new THREE.Color(PAL.goldHi);
        this._emit(this.sparks, 60, c, (i, o) => {
          o.x = c.x + (Math.random() - 0.5) * sz.x; o.y = b.min.y + Math.random() * sz.y; o.z = c.z + (Math.random() - 0.5) * sz.z;
          o.vx = (Math.random() - 0.5) * sz.y * 0.2; o.vz = (Math.random() - 0.5) * sz.y * 0.2; o.vy = sz.y * (0.15 + Math.random() * 0.35); o.g = sz.y * 0.1;
          o.color.copy(i & 1 ? e : gd).multiplyScalar(2); o.life = 0.8 + Math.random() * duration; o.size = Math.max(0.004, sz.y * 0.025); o.drag = 1;
        });
      }
    }
    this._sfx('dissolve');
    this._add(duration, (k) => { uT.value = reverse ? 1 - k : k; }, () => {
      if (reverse) object3d.visible = false;
      for (const [o, mat] of saved) o.material = mat;
      clones.forEach((c) => c.dispose());
      cb?.(object3d);
    });
  }

  /**
   * Dissolves `object3d` in with a world-space noise threshold (0 -> 1) and a burning ember-to-gold edge.
   * Original materials are restored when done. Works with any built-in lit/unlit material, incl. map + alphaTest.
   * @param {{edge?: string, hot?: string, scale?: number}} [opts] edge = outer burn colour, hot = colour at the burn line
   */
  dissolveIn(object3d, duration = 1.2, opts = {}) { this._dissolve(object3d, duration, false, opts); }

  /**
   * Reverse dissolve for deaths: burns `object3d` away (1 -> 0) shedding embers, then sets
   * `object3d.visible = false`, restores its materials and calls `cb(object3d)`.
   */
  dissolveOut(object3d, cb = null, duration = 1.4, opts = {}) { this._dissolve(object3d, duration, true, opts, cb); }

  _numSprite() {
    let s = this._numFree.pop();
    if (!s) {
      const c = document.createElement('canvas'); c.width = 512; c.height = 256;
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
      s.userData.ctx = c.getContext('2d'); s.renderOrder = 999;
    }
    return s;
  }

  /**
   * Floating number: elastic scale-pop then an arc (up and off to one side) with fade.
   * Red damage, green heal; crits are larger, gold with a gold outline and a wobble.
   */
  damageNumber(pos, amount, { crit = false, heal = false } = {}) {
    const fill = heal ? '#7dff8a' : crit ? GOLD : '#ff4a3a';
    const glow = heal ? '#0a5a14' : crit ? '#ff7a00' : '#5a0000';
    const text = (heal ? '+' : '') + amount + (crit ? '!' : '');
    const s = this._numSprite();
    drawNumber(s.userData.ctx, 512, 256, text, { fill, glow, outline: crit ? PAL.goldHi : null, px: crit ? 160 : 124 });
    s.material.map.needsUpdate = true; s.material.opacity = 1; s.material.rotation = 0;
    const sc = crit ? 0.1 : 0.065, life = crit ? 1.6 : 1.3;
    const sx = pos.x, sy = pos.y, sz = pos.z;
    // Sideways direction in camera space so the arc reads on screen.
    _v.setFromMatrixColumn(this.camera.matrixWorld, 0).setY(0);
    if (_v.lengthSq() < 1e-6) _v.set(1, 0, 0);
    _v.normalize().multiplyScalar((Math.random() < 0.5 ? -1 : 1) * (0.03 + Math.random() * 0.03));
    const dx = _v.x, dz = _v.z, up = crit ? 0.28 : 0.22;
    s.position.set(sx, sy, sz); this.scene.add(s);
    this._add(life, (k) => {
      const pop = k < 0.1 ? 0.2 + (crit ? 1.6 : 1.35) * easeOut3(k / 0.1)
        : 1 + (crit ? 0.8 : 0.55) * Math.exp(-(k - 0.1) * 14) * Math.cos((k - 0.1) * 40);
      s.scale.set(sc * 2 * pop, sc * pop, 1);
      s.position.set(sx + dx * k, sy + up * k - up * 0.7 * k * k, sz + dz * k);
      if (crit) s.material.rotation = 0.12 * Math.exp(-k * 5) * Math.sin(k * 50);
      s.material.opacity = k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35;
    }, () => { this.scene.remove(s); if (this._numFree.length < 12) this._numFree.push(s); else { s.material.map.dispose(); s.material.dispose(); } });
  }

  _flash(pos, color, size, life) {
    const f = this._quad(flashTex(), color, { order: 8 });
    f.position.copy(pos);
    this._add(life, (k) => {
      f.quaternion.copy(this.camera.quaternion); f.rotateX(Math.PI / 2); // flat XZ quad -> face the camera
      f.scale.setScalar(size * (0.6 + 0.8 * easeOut3(k)));
      f.material.opacity = k < 0.15 ? k / 0.15 : Math.pow(1 - (k - 0.15) / 0.85, 2);
    }, () => this._release(f));
  }

  /**
   * Nat-20: slow-mo (timeScale 0.25 for 0.8 s real time, then eased back), gold + ember shockwave rings,
   * an additive flash and radial ember sparks with gravity. Slow-mo and shake are skipped under reduced motion.
   */
  critMoment(pos, { radius = 0.05 } = {}) {
    if (!reducedMotion()) { this._slow = { t: 0, hold: 0.8, ease: 0.5 }; this.timeScale = 0.25; this.shake(0.012, 0.35); }
    const R = radius, y = pos.y + 0.003;
    const ring1 = this._quad(ringTex(), _c.set(PAL.goldHi).multiplyScalar(2.5));
    const ring2 = this._quad(ringTex(), _c.set(PAL.ember).multiplyScalar(2));
    ring1.position.set(pos.x, y, pos.z); ring2.position.set(pos.x, y + 0.001, pos.z);
    this._add(1.0, (k) => {
      ring1.scale.setScalar(R * 2 * (1 + 10 * easeOut3(k))); ring1.material.opacity = Math.pow(1 - k, 1.5);
      const k2 = Math.max(0, (k - 0.12) / 0.88);
      ring2.scale.setScalar(R * 2 * (0.5 + 6.5 * easeOut3(k2))); ring2.material.opacity = k2 > 0 ? (1 - k2) * 0.9 : 0;
    }, () => this._release(ring1, ring2));
    this._flash(_v.set(pos.x, pos.y + R * 0.8, pos.z), _c.set('#fff2c0').multiplyScalar(3), R * 9, 0.35);
    const gold = _c.set(PAL.goldHi), ember = _c2.set(PAL.emberHi);
    this._emit(this.sparks, 110, pos, (i, o) => {
      const a = Math.random() * Math.PI * 2, el = 0.25 + Math.random() * 1.0, sp = R * (8 + Math.random() * 14);
      o.y = pos.y + R * 0.3;
      o.vx = Math.cos(a) * Math.cos(el) * sp; o.vz = Math.sin(a) * Math.cos(el) * sp; o.vy = Math.sin(el) * sp;
      o.g = -R * 70; o.drag = 1.8; o.grow = 0.15;
      o.color.copy(i % 3 ? gold : ember).multiplyScalar(2.5 + Math.random() * 1.5);
      o.life = 0.6 + Math.random() * 0.8; o.size = R * (0.12 + Math.random() * 0.14);
    });
    this._emit(this.sparks, 24, pos, (i, o) => { // lazy rising glitter column
      o.x += (Math.random() - 0.5) * R * 2; o.z += (Math.random() - 0.5) * R * 2;
      o.vx = 0; o.vz = 0; o.vy = R * (3 + Math.random() * 5); o.g = 0; o.drag = 1.2;
      o.color.copy(gold).multiplyScalar(2); o.life = 1.2 + Math.random() * 0.8; o.size = R * 0.12;
    });
    this._sfx('crit');
  }

  /**
   * Nat-1: a cracked magma ground decal that glows, pulses and cools over ~3 s, plus a smoke puff
   * and a few sputtering cinders. Shake is skipped under reduced motion.
   */
  fumbleMoment(pos, { radius = 0.05 } = {}) {
    const R = radius, rot = Math.random() * Math.PI * 2, y = pos.y + 0.0025;
    const dark = this._quad(crackTex(), '#ffffff', { blending: THREE.NormalBlending });
    const hot = this._quad(crackTex(), _c.set(PAL.ember).multiplyScalar(2.2));
    dark.position.set(pos.x, y, pos.z); hot.position.set(pos.x, y + 0.0007, pos.z);
    dark.rotation.y = hot.rotation.y = rot;
    this._add(3.2, (k) => {
      const grow = easeOut3(Math.min(1, k * 8));
      dark.scale.setScalar(R * 6 * (0.4 + 0.6 * grow)); hot.scale.copy(dark.scale);
      dark.material.opacity = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      const heat = Math.min(1, k * 10) * Math.pow(1 - k, 1.4);
      hot.material.opacity = heat * (0.75 + 0.25 * Math.sin(k * 30));
      hot.material.color.set(PAL.ember).lerp(_c2.set(PAL.magma), k).multiplyScalar(2.2);
    }, () => this._release(dark, hot));
    this._emit(this.smoke, 22, pos, (i, o) => {
      const a = Math.random() * Math.PI * 2;
      o.x += Math.cos(a) * R * 0.6; o.z += Math.sin(a) * R * 0.6;
      o.vx = Math.cos(a) * R * 2; o.vz = Math.sin(a) * R * 2; o.vy = R * (3 + Math.random() * 4); o.g = R * 0.5; o.drag = 2;
      const v = 0.05 + Math.random() * 0.06; o.color.setRGB(v, v * 0.9, v * 0.85);
      o.life = 1.4 + Math.random() * 1.2; o.size = R * (0.9 + Math.random() * 0.6); o.grow = 3.5;
    });
    this._emit(this.sparks, 26, pos, (i, o) => {
      const a = Math.random() * Math.PI * 2, sp = R * (2 + Math.random() * 5);
      o.vx = Math.cos(a) * sp; o.vz = Math.sin(a) * sp; o.vy = R * (3 + Math.random() * 6); o.g = -R * 60; o.drag = 1;
      o.color.set(PAL.ember).multiplyScalar(2.5); o.life = 0.4 + Math.random() * 0.6; o.size = R * 0.1;
    });
    this.shake(0.02, 0.4);
    this._sfx('fumble');
  }

  /** Decaying random camera shake; read `shakeOffset` each frame. No-op under prefers-reduced-motion. */
  shake(strength = 0.02, duration = 0.4) { if (!reducedMotion()) this._shake = { t: 0, strength, duration }; }

  /** Toggles letterbox bars and sets `focus` (Vector3 or null) for the desktop camera to ease toward. */
  setCinematic(on, focus = null) {
    this.cinematic = !!on;
    this.focus = on && focus ? focus.clone() : null;
    for (const b of this.bars) b.style.height = on ? '11vh' : '0';
  }

  /** Advances all effects using real (unscaled) time in seconds. Particles partially follow `timeScale` (slow-mo). */
  update(realDt) {
    let w = 0;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      it.t += realDt;
      const k = Math.min(1, it.t / it.life);
      it.step(k, realDt);
      if (k >= 1) it.done?.(); else this.items[w++] = it;
    }
    this.items.length = w;
    if (this._slow) {
      const s = this._slow; s.t += realDt;
      if (s.t <= s.hold) this.timeScale = 0.25;
      else if (s.t < s.hold + s.ease) { const e = (s.t - s.hold) / s.ease; this.timeScale = 0.25 + 0.75 * e * e * (3 - 2 * e); }
      else { this.timeScale = 1; this._slow = null; }
    }
    const pdt = realDt * (0.35 + 0.65 * this.timeScale);
    this.sparks.update(pdt); this.smoke.update(pdt);
    if (this._shake) {
      const s = this._shake; s.t += realDt;
      const a = s.strength * Math.max(0, 1 - s.t / s.duration);
      this.shakeOffset.set((Math.random() - 0.5) * 2 * a, (Math.random() - 0.5) * 2 * a, (Math.random() - 0.5) * 2 * a);
      if (s.t >= s.duration) { this._shake = null; this.shakeOffset.set(0, 0, 0); }
    }
  }

  /** Removes the letterbox bars, ends all running effects immediately and frees GPU resources. */
  dispose() {
    this.items.forEach((it) => it.done?.()); this.items = [];
    this.bars.forEach((b) => b.remove());
    this.sparks.dispose(); this.smoke.dispose();
    for (const m of this._quadFree) m.material.dispose();
    for (const s of this._numFree) { s.material.map.dispose(); s.material.dispose(); }
    this._quadFree = []; this._numFree = [];
    this.timeScale = 1; this.shakeOffset.set(0, 0, 0);
  }
}
