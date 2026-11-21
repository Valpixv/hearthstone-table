import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { stoneTex, makeFlame, instanced, std, rng } from '../scene/util.js';

export function createDungeon(ctx) {
  const g = new THREE.Group(), r = rng(33), anim = [];
  const W = 3.2, L = 30, H = 3.4; // cross-shaped corridors stretching into darkness
  const floorMat = std('#fff', { map: stoneTex('#4a4a48', { repeat: [3, 30], seed: 4 }) });
  for (const rot of [0, Math.PI / 2]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, L * 2), floorMat); f.rotation.set(-Math.PI / 2, 0, rot); f.receiveShadow = true; g.add(f);
    const c = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, L * 2), std('#222')); c.rotation.set(Math.PI / 2, 0, rot); c.position.y = H; g.add(c);
  }
  // Walls: 4 corridors x 2 sides, merged into one static mesh
  const wallGeos = [];
  for (let k = 0; k < 4; k++) {
    for (const side of [-1, 1]) {
      const geo = new THREE.BoxGeometry(0.4, H, L - W);
      const m = new THREE.Matrix4().makeRotationY((k * Math.PI) / 2).multiply(new THREE.Matrix4().makeTranslation(side * W, H / 2, -(W + (L - W) / 2)));
      geo.applyMatrix4(m); wallGeos.push(geo);
    }
  }
  const walls = new THREE.Mesh(mergeGeometries(wallGeos), std('#fff', { map: stoneTex('#5b5a55', { repeat: [12, 2] }) }));
  walls.receiveShadow = true; g.add(walls);
  // Pillars at the intersection corners
  g.add(instanced(new THREE.BoxGeometry(0.7, H, 0.7), std('#fff', { map: stoneTex('#6a6862', { repeat: [1, 3] }) }), [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => ({ p: [x * W, H / 2, z * W] }))));
  // Iron gates across each corridor
  const bars = [];
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2, d = 7 + k;
    for (let i = -7; i <= 7; i++) {
      const lx = i * 0.2; // local (lx, -d) rotated about Y by a
      bars.push({ p: [lx * Math.cos(a) - d * Math.sin(a), H / 2 - 0.2, -lx * Math.sin(a) - d * Math.cos(a)] });
    }
  }
  g.add(instanced(new THREE.CylinderGeometry(0.025, 0.025, H - 0.4, 6), std('#2b2b2b', { metalness: 0.8, roughness: 0.5 }), bars));
  // Chains hanging from the ceiling (swaying)
  const chains = new THREE.Group(); const link = new THREE.TorusGeometry(0.05, 0.012, 5, 10); const lm = std('#3a3a3a', { metalness: 0.8 });
  const chainList = [];
  for (const [x, z] of [[-2.2, -1.8], [2.4, -2.5], [-1.6, 2.6], [2.8, 2.2], [0, -5]]) {
    const ch = new THREE.Group(); ch.position.set(x, H, z);
    const n = 8 + (r() * 8 | 0);
    ch.add(instanced(link, lm, Array.from({ length: n }, (_, i) => ({ p: [0, -i * 0.085, 0], r: [0, (i % 2) * Math.PI / 2, 0] }))));
    chains.add(ch); chainList.push(ch);
  }
  g.add(chains);
  // Skull piles (sphere + jaw), instanced
  const skulls = [], jaws = [];
  for (const [cx, cz] of [[-2.4, -2.4], [2.4, 2.6], [-2.5, 5], [2.2, -6]]) {
    for (let i = 0; i < 14; i++) {
      const a = r() * 6.28, rr = r() * 0.45, y = 0.12 + (0.45 - rr) * 0.6 * r();
      skulls.push({ p: [cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr], r: [r(), r() * 6, r()], s: 0.12 });
      jaws.push({ p: [cx + Math.cos(a) * rr, y - 0.08, cz + Math.sin(a) * rr + 0.04], s: [0.14, 0.05, 0.1] });
    }
  }
  g.add(instanced(new THREE.SphereGeometry(1, 10, 8), std('#d8d0b8'), skulls));
  g.add(instanced(new THREE.BoxGeometry(1, 1, 1), std('#c8c0a8'), jaws));
  // Green torches
  const torchPos = [[-W + 0.25, -2.5, true], [W - 0.25, -2.5, true], [-W + 0.25, 3, false], [W - 0.25, 3, false], [-W + 0.25, -9, false], [W - 0.25, -15, false], [-W + 0.25, 9, false]];
  for (const [x, z, light] of torchPos) {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.4, 6), std('#1a1a1a')); h.position.set(x, 1.9, z); g.add(h);
    const f = makeFlame('#3dff6a', { size: 0.28, light, intensity: 3, distance: 7, ctx }); f.position.set(x, 2.2, z); g.add(f); anim.push(f);
  }
  return {
    name: 'Dungeon', group: g, ambience: 'dungeon', music: 'eerie',
    light: { hemiSky: '#6a8a70', hemiGround: '#0a0a0a', hemiInt: 0.3, keyColor: '#b8ffc8', keyInt: 0.8, keyPos: [0.5, 3, 1], fogColor: '#030604', fogDensity: 0.09, sky: '#000' },
    update(t) { anim.forEach((a) => a.userData.update(t)); chainList.forEach((c, i) => { c.rotation.z = Math.sin(t * 0.7 + i) * 0.05; c.rotation.x = Math.cos(t * 0.5 + i) * 0.04; }); },
  };
}
