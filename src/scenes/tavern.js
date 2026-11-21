import * as THREE from 'three';
import { planksTex, stoneTex, makeFlame, instanced, std, rng } from '../scene/util.js';

export function createTavern(ctx) {
  const g = new THREE.Group(), r = rng(21), anim = [];
  const S = 12, H = 4.2;
  // Floor, walls, ceiling
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(S, S), std('#fff', { map: planksTex('#5a3a1e', { repeat: [6, 6] }) }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
  const wallMat = std('#fff', { map: planksTex('#6d4526', { repeat: [6, 2], seed: 9 }), side: THREE.BackSide });
  const room = new THREE.Mesh(new THREE.BoxGeometry(S, H, S), wallMat); room.position.y = H / 2; g.add(room);
  // Ceiling beams + posts (instanced)
  const beamT = [];
  for (let i = -2; i <= 2; i++) beamT.push({ p: [i * 2.4, H - 0.2, 0], s: [0.25, 0.3, S] });
  for (let i = -1; i <= 1; i += 2) beamT.push({ p: [0, H - 0.5, i * 2.6], s: [S, 0.25, 0.25] });
  for (const [x, z] of [[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5]]) beamT.push({ p: [x, H / 2, z], s: [0.3, H, 0.3] });
  g.add(instanced(new THREE.BoxGeometry(1, 1, 1), std('#3e2412'), beamT));
  // Hearth on the back wall
  const hearth = new THREE.Group(); hearth.position.set(0, 0, -S / 2 + 0.6);
  const stone = std('#fff', { map: stoneTex('#7a6f66', { repeat: [2, 2] }) });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 1), stone); body.position.y = 1.1; hearth.add(body);
  const opening = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 0.6), std('#120804')); opening.position.set(0, 0.6, 0.25); hearth.add(opening);
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2, 0.8), stone); chimney.position.set(0, 3.2, -0.1); hearth.add(chimney);
  const fire = makeFlame('#ff8a2a', { size: 0.7, intensity: 6, distance: 9, ctx }); fire.position.set(0, 0.45, 0.66); hearth.add(fire); anim.push(fire);
  const logs = instanced(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 8), std('#3b2210'), [{ p: [0, 0.2, 0.66], r: [0, 0.3, Math.PI / 2] }, { p: [0, 0.25, 0.7], r: [0, -0.4, Math.PI / 2] }]);
  hearth.add(logs); g.add(hearth);
  // Barrels along walls
  const bt = [];
  for (let i = 0; i < 14; i++) {
    const side = i % 4, k = -4.5 + (i / 4 | 0) * 1.1 + r() * 0.3;
    const p = side === 0 ? [-S / 2 + 0.5, 0.45, k] : side === 1 ? [S / 2 - 0.5, 0.45, k] : side === 2 ? [k, 0.45, S / 2 - 0.5] : [-S / 2 + 0.5, 1.35, k];
    bt.push({ p, r: [0, r() * 3, 0] });
  }
  g.add(instanced(new THREE.CylinderGeometry(0.35, 0.3, 0.9, 12), std('#7b4d27'), bt));
  g.add(instanced(new THREE.TorusGeometry(0.34, 0.02, 6, 16), std('#333', { metalness: 0.6 }), bt.flatMap((b) => [{ p: [b.p[0], b.p[1] + 0.25, b.p[2]], r: [Math.PI / 2, 0, 0] }, { p: [b.p[0], b.p[1] - 0.25, b.p[2]], r: [Math.PI / 2, 0, 0] }])));
  // Side tables with mugs
  const tt = [], mt = [];
  for (const [x, z] of [[-3.6, 0.5], [3.6, 0.5], [-3, 3.8], [2.6, 3.8], [-3.2, -3]]) {
    tt.push({ p: [x, 0.75, z], s: [1.2, 0.06, 0.8] });
    for (let k = 0; k < 3; k++) mt.push({ p: [x + (r() - 0.5) * 0.9, 0.85, z + (r() - 0.5) * 0.5] });
  }
  g.add(instanced(new THREE.BoxGeometry(1, 1, 1), std('#6b4423'), tt));
  g.add(instanced(new THREE.CylinderGeometry(0.05, 0.045, 0.14, 10), std('#9a9a9a', { metalness: 0.7, roughness: 0.4 }), mt));
  // Bard's stage (right side) with a lute
  const stage = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.4, 2), std('#fff', { map: planksTex('#7a4a26', { repeat: [2, 2] }) }));
  stage.position.set(S / 2 - 1.3, 0.2, -2.5); g.add(stage);
  const lute = new THREE.Group();
  const lb = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), std('#b06a2a')); lb.scale.set(1, 1.2, 0.4);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.6, 0.04), std('#3b2210')); neck.position.y = 0.5;
  lute.add(lb, neck); lute.position.set(S / 2 - 1.3, 0.75, -2.5); lute.rotation.z = 0.4; g.add(lute);
  const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.5, 12), std('#5a3a1e')); stool.position.set(S / 2 - 1.8, 0.65, -2.5); g.add(stool);
  // Wall torches + chandelier
  for (const [x, z, ry] of [[-S / 2 + 0.15, -1.5, 0], [S / 2 - 0.15, 1.5, 0], [-2, S / 2 - 0.15, 0], [2, S / 2 - 0.15, 0]]) {
    const holder = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.4, 6), std('#2a1a0a')); holder.position.set(x, 2, z); g.add(holder);
    const f = makeFlame('#ffa040', { size: 0.25, light: x < 0 && z < 0, intensity: 2, distance: 5, ctx }); f.position.set(x, 2.3, z); g.add(f); anim.push(f);
  }
  const chand = new THREE.Group(); chand.position.set(0, H - 0.2, 0);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.04, 6, 24), std('#2a1a0a')); ring.rotation.x = Math.PI / 2; ring.position.y = -1.2; chand.add(ring);
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.2, 4), std('#222')); chain.position.y = -0.6; chand.add(chain);
  for (let i = 0; i < 6; i++) { const f = makeFlame('#ffb050', { size: 0.12, light: i === 0, intensity: 2.5, distance: 6, ctx }); const a = (i / 6) * Math.PI * 2; f.position.set(Math.cos(a) * 0.6, -1.1, Math.sin(a) * 0.6); chand.add(f); anim.push(f); }
  g.add(chand);
  return {
    name: 'Tavern', group: g, ambience: 'tavern', music: 'tavern',
    light: { hemiSky: '#ffcf9a', hemiGround: '#3a2010', hemiInt: 0.55, keyColor: '#ffc890', keyInt: 1.3, keyPos: [1.5, 3.5, 1.2], fogColor: '#1a0f08', fogDensity: 0.04, sky: '#1a0f08' },
    update(t) { anim.forEach((a) => a.userData.update(t)); chand.rotation.z = Math.sin(t * 0.6) * 0.02; },
  };
}
