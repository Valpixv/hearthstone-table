import * as THREE from 'three';

let dotTexCache = null;
/** Shared soft round sprite (white core, smooth falloff). */
export function dotTex() {
  if (dotTexCache) return dotTexCache;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  dotTexCache = new THREE.CanvasTexture(c);
  return dotTexCache;
}

/** Pixel scale matching PointsMaterial's size attenuation (half the drawing-buffer height). */
export const pixelScale = () => (typeof innerHeight === 'number' ? innerHeight * Math.min(globalThis.devicePixelRatio || 1, 2) * 0.5 : 540);

const VERT = /* glsl */`
attribute vec4 aP0;   // spawn xyz, spawn time
attribute vec4 aV;    // velocity xyz, gravity (y accel)
attribute vec4 aC;    // linear rgb (may exceed 1 for bloom), life
attribute vec4 aS;    // size, drag, end-size multiplier, seed
uniform float uTime, uPx;
varying vec3 vColor; varying float vAlpha;
void main(){
  float age = uTime - aP0.w;
  float k = age / max(aC.w, 1e-4);
  if (aC.w <= 0.0 || k < 0.0 || k > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float s = aS.y > 0.001 ? (1.0 - exp(-aS.y * age)) / aS.y : age;
  vec3 p = aP0.xyz + aV.xyz * s;
  p.y += 0.5 * aV.w * age * age;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aS.x * mix(1.0, aS.z, k) * uPx / max(-mv.z, 0.01);
  float flick = 0.8 + 0.2 * sin(age * 38.0 + aS.w * 6.283);
  vColor = aC.rgb * flick;
  vAlpha = (1.0 - k) * (1.0 - k * 0.5) * smoothstep(0.0, 0.06, k + 0.02);
}`;

const FRAG = /* glsl */`
uniform sampler2D uMap;
varying vec3 vColor; varying float vAlpha;
void main(){
  float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * GPU-simulated particle pool: one Points draw call, fixed capacity ring buffer.
 * Motion (ballistic + drag + gravity), fade, size-over-life and flicker are evaluated in the vertex shader,
 * so update() only advances a uniform — zero per-particle CPU work and zero allocations per frame.
 * Buffers are re-uploaded only on frames where spawn() was called.
 */
export class FxPool {
  /** @param {THREE.Object3D} parent @param {{capacity?: number, blending?: THREE.Blending}} opts */
  constructor(parent, { capacity = 1024, blending = THREE.AdditiveBlending } = {}) {
    this.parent = parent; this.capacity = capacity; this.time = 0; this.head = 0; this.dirty = false; this.aliveUntil = -1;
    const geo = new THREE.BufferGeometry();
    const mk = (name) => { const a = new THREE.BufferAttribute(new Float32Array(capacity * 4), 4); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name, a); return a; };
    this.aP0 = mk('aP0'); this.aV = mk('aV'); this.aC = mk('aC'); this.aS = mk('aS');
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPx: { value: pixelScale() }, uMap: { value: dotTex() } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false; this.points.visible = false; this.points.renderOrder = 5;
    parent.add(this.points);
    this._onResize = () => { this.mat.uniforms.uPx.value = pixelScale(); };
    globalThis.addEventListener?.('resize', this._onResize);
  }

  /**
   * Spawns one particle. Colour components are linear and may exceed 1 to drive bloom.
   * @returns {void}
   */
  spawn(x, y, z, vx, vy, vz, gravity, r, g, b, life, size, drag = 0, grow = 0.4) {
    const i = this.head * 4; this.head = (this.head + 1) % this.capacity;
    const P = this.aP0.array, V = this.aV.array, C = this.aC.array, S = this.aS.array;
    P[i] = x; P[i + 1] = y; P[i + 2] = z; P[i + 3] = this.time;
    V[i] = vx; V[i + 1] = vy; V[i + 2] = vz; V[i + 3] = gravity;
    C[i] = r; C[i + 1] = g; C[i + 2] = b; C[i + 3] = life;
    S[i] = size; S[i + 1] = drag; S[i + 2] = grow; S[i + 3] = Math.random();
    this.dirty = true;
    if (this.time + life > this.aliveUntil) this.aliveUntil = this.time + life;
    this.points.visible = true;
  }

  /** Advances the simulation clock; uploads buffers only if something spawned. */
  update(dt) {
    this.time += dt; this.mat.uniforms.uTime.value = this.time;
    if (this.dirty) { this.aP0.needsUpdate = this.aV.needsUpdate = this.aC.needsUpdate = this.aS.needsUpdate = true; this.dirty = false; }
    if (this.points.visible && this.time > this.aliveUntil) this.points.visible = false; // skip the draw call when idle
  }

  dispose() {
    globalThis.removeEventListener?.('resize', this._onResize);
    this.parent.remove(this.points); this.points.geometry.dispose(); this.mat.dispose();
  }
}
