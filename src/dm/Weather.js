import * as THREE from 'three';
import { dotTex, pixelScale } from '../fx/FxPool.js';

// Counts kept modest for Quest; all motion is computed in the vertex shader from time + per-particle seed.
const CFG = {
  rain: { n: 900, color: '#9fb8ff', size: 0, vy: -7, spread: 0.2, opacity: 0.55 },
  snow: { n: 900, color: '#ffffff', size: 0.06, vy: -0.5, spread: 0.4, opacity: 0.9 },
  embers: { n: 320, color: '#ff7a20', size: 0.05, vy: 0.6, spread: 0.3, opacity: 1 },
  sparkles: { n: 300, color: '#c9a0ff', size: 0.06, vy: 0.1, spread: 0.2, opacity: 1 },
};
const BOX = { w: 14, h: 7 };
const MODE = { rain: 0, snow: 1, embers: 2, sparkles: 3 };

const VERT = /* glsl */`
attribute vec4 aSeed;  // x0, y0, z0, phase
attribute float aEnd;  // rain streaks: 0 = head, 1 = tail
uniform float uTime, uVy, uSpread, uPx, uSize, uH;
uniform int uMode;
varying float vA; varying float vTint;
void main(){
  float ph = aSeed.w, sp = 0.7 + fract(ph) * 0.6;
  float y = mod(aSeed.y + uVy * uTime * sp, uH);
  vec3 p = vec3(aSeed.x + sin(uTime + ph) * uSpread, y, aSeed.z + cos(uTime * 0.7 + ph) * uSpread);
  vA = 1.0; vTint = fract(ph * 7.31);
  if (uMode == 0) {               // rain: slanted streak; tail trails above the head
    p.x += 0.35 * (y / uH);
    p += aEnd * vec3(-0.012, 0.22, 0.0) * sp;
    vA = mix(0.9, 0.0, aEnd) * smoothstep(0.0, 0.3, y);
  } else if (uMode == 2) {        // embers: curl-ish wobble + flicker, fade near the top
    p.x += sin(uTime * 1.7 + ph * 3.0) * 0.12; p.z += cos(uTime * 1.3 + ph * 5.0) * 0.12;
    float f = 0.55 + 0.45 * sin(uTime * (6.0 + fract(ph * 3.3) * 9.0) + ph * 11.0);
    vA = f * f * (1.0 - smoothstep(uH * 0.7, uH, y));
  } else if (uMode == 3) {        // sparkles: sharp twinkle peaks
    float tw = max(0.0, sin(uTime * (1.5 + fract(ph * 5.1) * 2.5) + ph * 6.283));
    vA = 0.08 + pow(tw, 10.0) * 1.4;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float s = uSize * (uMode == 3 ? (0.5 + vA * 0.6) : 1.0);
  gl_PointSize = s * uPx / max(-mv.z, 0.05);
}`;

const FRAG = /* glsl */`
uniform sampler2D uMap; uniform vec3 uColor, uColor2; uniform float uOpacity; uniform int uMode, uPoints;
varying float vA; varying float vTint;
void main(){
  float m = uPoints == 1 ? texture2D(uMap, gl_PointCoord).a : 1.0;
  float a = m * vA * uOpacity;
  if (a < 0.003) discard;
  vec3 c = mix(uColor, uColor2, vTint);
  if (uMode == 2 || uMode == 3) c *= 1.0 + vA; // hot flicker peaks push into bloom
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SECOND = { rain: '#cfe0ff', snow: '#dfe9ff', embers: '#f3d58a', sparkles: '#6fb7ff' };

/**
 * Particle weather in a 14 x 7 x 14 m box around the origin.
 * GPU-animated: update() only writes one time uniform per active system (no buffer uploads, no allocation).
 * Rain draws as line streaks; snow, embers and sparkles as point sprites.
 */
export class Weather {
  constructor(scene) { this.scene = scene; this.systems = {}; }

  /** Turns a weather layer ('rain' | 'snow' | 'embers' | 'sparkles') on or off. */
  set(name, on) {
    if (on && !this.systems[name]) {
      const c = CFG[name]; if (!c) return;
      const rain = name === 'rain', per = rain ? 2 : 1, n = c.n * per;
      const seed = new Float32Array(n * 4), end = new Float32Array(n), pos = new Float32Array(n * 3);
      for (let i = 0; i < c.n; i++) {
        const x = (Math.random() - 0.5) * BOX.w, y = Math.random() * BOX.h, z = (Math.random() - 0.5) * BOX.w, ph = Math.random() * 10;
        for (let j = 0; j < per; j++) { seed.set([x, y, z, ph], (i * per + j) * 4); end[i * per + j] = j; }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
      geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 }, uVy: { value: c.vy }, uSpread: { value: c.spread }, uPx: { value: pixelScale() }, uSize: { value: c.size },
          uH: { value: BOX.h }, uMode: { value: MODE[name] }, uPoints: { value: rain ? 0 : 1 }, uMap: { value: dotTex() },
          uColor: { value: new THREE.Color(c.color) }, uColor2: { value: new THREE.Color(SECOND[name]) }, uOpacity: { value: c.opacity },
        },
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
        blending: rain || name === 'snow' ? THREE.NormalBlending : THREE.AdditiveBlending,
      });
      const obj = rain ? new THREE.LineSegments(geo, mat) : new THREE.Points(geo, mat);
      obj.frustumCulled = false; this.scene.add(obj);
      this.systems[name] = { pts: obj, c };
    } else if (!on && this.systems[name]) {
      const s = this.systems[name]; this.scene.remove(s.pts); s.pts.geometry.dispose(); s.pts.material.dispose(); delete this.systems[name];
    }
  }

  /** @param {number} t elapsed seconds @param {number} dt frame delta (unused; motion is time-based) */
  update(t, dt) { // eslint-disable-line no-unused-vars
    for (const name in this.systems) this.systems[name].pts.material.uniforms.uTime.value = t;
  }
}
