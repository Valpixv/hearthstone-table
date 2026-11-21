import * as THREE from 'three';
import { noiseTex, instanced, std, rng, glowTex } from '../scene/util.js';

export function createForest(ctx) {
  const g = new THREE.Group(), r = rng(44);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 48), std('#fff', { map: noiseTex('#2c3f1f', 40, { repeat: [20, 20], seed: 8 }) }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; g.add(ground);
  // Trees: instanced trunks + 3 stacked cones each; cones sway via a tiny shader patch.
  const trunks = [], cones = [];
  for (let i = 0; i < 90; i++) {
    const a = r() * Math.PI * 2, d = 4.5 + r() * 22, s = 0.8 + r() * 0.9;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    trunks.push({ p: [x, 1.2 * s, z], s: [s, s, s] });
    for (let k = 0; k < 3; k++) cones.push({ p: [x, (2.2 + k * 1.1) * s, z], s: [s * (1.6 - k * 0.4), s * 1.6, s * (1.6 - k * 0.4)], r: [0, r() * 6, 0], c: new THREE.Color().setHSL(0.3 + r() * 0.05, 0.45, 0.14 + r() * 0.08) });
  }
  g.add(instanced(new THREE.CylinderGeometry(0.15, 0.25, 2.4, 7), std('#3b2a1a'), trunks));
  const time = { value: 0 };
  const coneMat = std('#ffffff', { flatShading: true });
  coneMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>
       float sway = max(position.y + 0.5, 0.0);
       transformed.x += sin(uTime * 1.2 + instanceMatrix[3].x * 0.5) * 0.06 * sway;
       transformed.z += cos(uTime * 0.9 + instanceMatrix[3].z * 0.5) * 0.04 * sway;`);
  };
  g.add(instanced(new THREE.ConeGeometry(1, 1.4, 8), coneMat, cones));
  // Mossy rocks
  const rocks = [];
  for (let i = 0; i < 26; i++) { const a = r() * 6.28, d = 2.2 + r() * 10; rocks.push({ p: [Math.cos(a) * d, 0.1, Math.sin(a) * d], r: [r(), r() * 6, r()], s: [0.3 + r() * 0.5, 0.2 + r() * 0.3, 0.3 + r() * 0.5] }); }
  g.add(instanced(new THREE.DodecahedronGeometry(1, 0), std('#4d5a3a', { flatShading: true }), rocks, { receive: true }));
  // Grass tufts
  const tufts = [];
  for (let i = 0; i < 300; i++) { const a = r() * 6.28, d = 1.6 + r() * 14; tufts.push({ p: [Math.cos(a) * d, 0.1, Math.sin(a) * d], r: [0, r() * 6, 0], s: [0.08, 0.2 + r() * 0.2, 0.08] }); }
  g.add(instanced(new THREE.ConeGeometry(1, 1, 4), std('#3d5a2a'), tufts));
  // Moon
  const moon = new THREE.Mesh(new THREE.SphereGeometry(2, 24, 16), new THREE.MeshBasicMaterial({ color: '#e8ecff', fog: false }));
  moon.position.set(-20, 25, -35); g.add(moon);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(200,210,255,0.8)', 'rgba(100,120,255,0)'), fog: false, transparent: true, depthWrite: false }));
  halo.scale.setScalar(14); halo.position.copy(moon.position); g.add(halo);
  // Fireflies
  const N = 160, pos = new Float32Array(N * 3), seeds = [];
  for (let i = 0; i < N; i++) { const a = r() * 6.28, d = 1.5 + r() * 9; seeds.push([Math.cos(a) * d, 0.4 + r() * 2.2, Math.sin(a) * d, r() * 10]); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const flies = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#d8ff6a', size: 0.08, map: glowTex('rgba(255,255,200,1)', 'rgba(200,255,80,0)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flies.frustumCulled = false; g.add(flies);
  return {
    name: 'Forest Clearing', group: g, ambience: 'forest', music: 'explore',
    light: { hemiSky: '#5a6ea8', hemiGround: '#1a2410', hemiInt: 0.75, keyColor: '#9fb4ff', keyInt: 1.4, keyPos: [-2, 4, -2.5], fogColor: '#0b1426', fogDensity: 0.05, sky: '#0b1426' },
    update(t) {
      time.value = t;
      for (let i = 0; i < N; i++) { const s = seeds[i]; pos[i * 3] = s[0] + Math.sin(t * 0.4 + s[3]) * 0.6; pos[i * 3 + 1] = s[1] + Math.sin(t * 0.9 + s[3] * 2) * 0.25; pos[i * 3 + 2] = s[2] + Math.cos(t * 0.35 + s[3]) * 0.6; }
      geo.attributes.position.needsUpdate = true;
      flies.material.opacity = 0.7 + Math.sin(t * 3) * 0.3;
    },
  };
}
