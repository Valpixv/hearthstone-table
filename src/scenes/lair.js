import * as THREE from 'three';
import { noiseTex, instanced, std, rng, makeFlame } from '../scene/util.js';

export function createLair(ctx) {
  const g = new THREE.Group(), r = rng(55), anim = [];
  // Cavern: displaced icosphere seen from the inside
  const cave = new THREE.IcosahedronGeometry(16, 4);
  const p = cave.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + 0.12 * Math.sin(v.x * 0.7) * Math.cos(v.z * 0.6) + 0.08 * Math.sin(v.y * 1.3 + v.x);
    v.multiplyScalar(n); if (v.y < 0) v.y *= 0.2; v.y *= 0.55; p.setXYZ(i, v.x, v.y, v.z);
  }
  cave.computeVertexNormals();
  g.add(new THREE.Mesh(cave, std('#fff', { map: noiseTex('#3a2a24', 50, { repeat: [6, 3], seed: 12 }), side: THREE.BackSide, flatShading: true })));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(17, 40), std('#fff', { map: noiseTex('#2a1d18', 40, { repeat: [10, 10] }) }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
  // Lava cracks: emissive strips that pulse
  const lavaMat = new THREE.MeshStandardMaterial({ color: '#ff4a00', emissive: '#ff3a00', emissiveIntensity: 2 });
  const cracks = [];
  for (let i = 0; i < 40; i++) { const a = r() * 6.28, d = 2 + r() * 11; cracks.push({ p: [Math.cos(a) * d, 0.01, Math.sin(a) * d], r: [0, r() * 6.28, 0], s: [0.06 + r() * 0.08, 0.02, 0.8 + r() * 2] }); }
  g.add(instanced(new THREE.BoxGeometry(1, 1, 1), lavaMat, cracks));
  const lavaLight = new THREE.PointLight('#ff5a10', 4, 14, 1.5); lavaLight.position.set(2, 0.6, -3); g.add(lavaLight);
  // Gold coin piles: thousands of instanced coins heaped into mounds
  const coins = [];
  for (const [cx, cz, R] of [[-4, -6, 2.2], [3.5, -7, 2.6], [0, -9.5, 3], [-6, 1, 1.5], [6, 0, 1.6]]) {
    for (let i = 0; i < 380; i++) {
      const a = r() * 6.28, d = Math.sqrt(r()) * R, h = (1 - d / R) * R * 0.45;
      coins.push({ p: [cx + Math.cos(a) * d, h * r() + 0.02, cz + Math.sin(a) * d], r: [r() * 1.2, r() * 6, r() * 1.2] });
    }
  }
  g.add(instanced(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 10), std('#ffcc33', { metalness: 1, roughness: 0.3, emissive: '#3a2600' }), coins));
  // Bones scattered around
  const bones = [], knobs = [];
  for (let i = 0; i < 30; i++) {
    const a = r() * 6.28, d = 2 + r() * 8, ry = r() * 6.28, x = Math.cos(a) * d, z = Math.sin(a) * d, L = 0.3 + r() * 0.4;
    bones.push({ p: [x, 0.04, z], r: [Math.PI / 2, 0, ry], s: [1, L, 1] });
    knobs.push({ p: [x + Math.cos(ry) * L / 2, 0.05, z - Math.sin(ry) * L / 2], s: 0.05 }, { p: [x - Math.cos(ry) * L / 2, 0.05, z + Math.sin(ry) * L / 2], s: 0.05 });
  }
  g.add(instanced(new THREE.CylinderGeometry(0.025, 0.025, 1, 6), std('#e0d6c0'), bones));
  g.add(instanced(new THREE.SphereGeometry(1, 8, 6), std('#e0d6c0'), knobs));
  // Sleeping dragon silhouette, breathing
  const dragon = new THREE.Group(); dragon.position.set(0, 0, -11); dragon.rotation.y = 0.3;
  const dm = std('#2a0d0d', { roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(2.4, 24, 16), dm); body.scale.set(1.6, 0.8, 1); body.position.y = 1.6; dragon.add(body);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 3.5, 12), dm); neck.position.set(-3.6, 1, 1.4); neck.rotation.set(0.3, 0, 1.3); dragon.add(neck);
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 0.9), dm); head.position.set(-5.4, 0.5, 2.2); head.rotation.y = 0.4; dragon.add(head);
  const horns = instanced(new THREE.ConeGeometry(0.12, 0.8, 6), std('#d8cdb0'), [{ p: [-5, 1.1, 1.9], r: [0, 0, 0.9] }, { p: [-5, 1.1, 2.6], r: [0, 0, 0.9] }]); dragon.add(horns);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffb000' })); eye.position.set(-5.9, 0.7, 2.7); eye.scale.y = 0.15; dragon.add(eye);
  const tail = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.45, 8, 20, Math.PI * 1.2), dm); tail.rotation.x = Math.PI / 2; tail.position.set(2.5, 0.4, 0.5); dragon.add(tail);
  const wingShape = new THREE.Shape(); wingShape.moveTo(0, 0); wingShape.lineTo(3.5, 2.6); wingShape.lineTo(4.2, 0.2); wingShape.lineTo(2.6, 0.6); wingShape.lineTo(1.8, -0.2); wingShape.closePath();
  const wing = new THREE.Mesh(new THREE.ShapeGeometry(wingShape), std('#3d1010', { side: THREE.DoubleSide }));
  wing.position.set(-1, 2.8, 0.5); wing.rotation.set(-0.6, 0.2, 0.1); dragon.add(wing);
  const smoke = makeFlame('#ff6020', { size: 0.4, light: false }); smoke.position.set(-6.2, 0.5, 2.4); dragon.add(smoke); anim.push(smoke);
  g.add(dragon);
  return {
    name: "Dragon's Lair", group: g, ambience: 'lair', music: 'eerie', dragon,
    light: { hemiSky: '#ff9a6a', hemiGround: '#200805', hemiInt: 0.35, keyColor: '#ff9050', keyInt: 1.0, keyPos: [2, 3.5, -1], fogColor: '#1a0703', fogDensity: 0.045, sky: '#120402' },
    update(t) {
      const b = 1 + Math.sin(t * 0.8) * 0.04; body.scale.set(1.6 * b, 0.8 * b * 1.05, 1 * b);
      lavaMat.emissiveIntensity = 1.6 + Math.sin(t * 1.7) * 0.6;
      lavaLight.intensity = (3.5 + Math.sin(t * 2.3) * 0.8) * ctx.torchMul;
      anim.forEach((a) => a.userData.update(t));
      smoke.visible = Math.sin(t * 0.8) > 0.3;
    },
  };
}
