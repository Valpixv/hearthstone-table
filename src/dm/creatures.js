import * as THREE from 'three';
import { std } from '../scene/util.js';

// Primitive-built creatures, ~1 unit tall, base at y=0, facing +z. Scale for minis or life-size.
export const CREATURES = {
  goblin: { color: '#4caf50', life: 1.0, label: 'Goblin' },
  skeleton: { color: '#e8e2cf', life: 1.75, label: 'Skeleton' },
  wolf: { color: '#7d7f86', life: 0.9, label: 'Wolf' },
  orc: { color: '#5d6b2f', life: 2.0, label: 'Orc' },
  dragon: { color: '#b3261e', life: 5.0, label: 'Dragon' },
};

const M = (geo, mat, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => { const m = new THREE.Mesh(geo, mat); m.position.set(...p); m.rotation.set(...(r || [0, 0, 0])); m.scale.set(...s); m.castShadow = true; return m; };
const sph = new THREE.SphereGeometry(1, 14, 10), box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(1, 1, 1, 10), cone = new THREE.ConeGeometry(1, 1, 8);

export function buildCreature(type) {
  const c = CREATURES[type], g = new THREE.Group(), body = std(c.color), dark = std('#222'), eye = new THREE.MeshBasicMaterial({ color: type === 'skeleton' ? '#000' : '#ffdd33' });
  if (type === 'goblin' || type === 'orc') {
    const big = type === 'orc' ? 1.25 : 1;
    g.add(M(cyl, body, [-0.1, 0.18, 0], 0, [0.06 * big, 0.36, 0.06 * big]), M(cyl, body, [0.1, 0.18, 0], 0, [0.06 * big, 0.36, 0.06 * big]));
    g.add(M(box, std(type === 'orc' ? '#4a3020' : '#6b4a2a'), [0, 0.52, 0], 0, [0.36 * big, 0.36, 0.22 * big]));
    g.add(M(cyl, body, [-0.25 * big, 0.5, 0], [0, 0, 0.3], [0.05 * big, 0.34, 0.05 * big]), M(cyl, body, [0.25 * big, 0.5, 0.05], [0.5, 0, -0.3], [0.05 * big, 0.34, 0.05 * big]));
    g.add(M(sph, body, [0, 0.83, 0], 0, [0.17 * big, 0.17, 0.16 * big]));
    g.add(M(sph, eye, [-0.06, 0.86, 0.13], 0, [0.025, 0.025, 0.02]), M(sph, eye, [0.06, 0.86, 0.13], 0, [0.025, 0.025, 0.02]));
    if (type === 'goblin') { g.add(M(cone, body, [-0.2, 0.88, 0], [0, 0, 1.3], [0.05, 0.2, 0.03]), M(cone, body, [0.2, 0.88, 0], [0, 0, -1.3], [0.05, 0.2, 0.03])); g.add(M(box, std('#bbb', { metalness: 0.8 }), [0.32, 0.45, 0.18], [0.5, 0, 0], [0.03, 0.25, 0.02])); }
    else { g.add(M(cone, std('#fff8e0'), [-0.06, 0.76, 0.14], 0, [0.02, 0.07, 0.02]), M(cone, std('#fff8e0'), [0.06, 0.76, 0.14], 0, [0.02, 0.07, 0.02])); g.add(M(cyl, std('#4a3020'), [0.35, 0.55, 0.22], [0.5, 0, 0], [0.02, 0.6, 0.02]), M(box, std('#999', { metalness: 0.8 }), [0.35, 0.82, 0.38], [0.5, 0, 0], [0.03, 0.16, 0.14])); }
  } else if (type === 'skeleton') {
    const bone = body;
    g.add(M(cyl, bone, [-0.08, 0.22, 0], 0, [0.025, 0.44, 0.025]), M(cyl, bone, [0.08, 0.22, 0], 0, [0.025, 0.44, 0.025]));
    g.add(M(cyl, bone, [0, 0.6, 0], 0, [0.025, 0.36, 0.025]));
    for (let i = 0; i < 4; i++) g.add(M(new THREE.TorusGeometry(1, 0.15, 5, 12), bone, [0, 0.52 + i * 0.07, 0], [Math.PI / 2, 0, 0], [0.13 - i * 0.01, 0.1, 0.1]));
    g.add(M(cyl, bone, [-0.18, 0.58, 0], [0, 0, 0.2], [0.02, 0.36, 0.02]), M(cyl, bone, [0.18, 0.58, 0.05], [0.4, 0, -0.2], [0.02, 0.36, 0.02]));
    g.add(M(sph, bone, [0, 0.88, 0], 0, [0.12, 0.13, 0.12]), M(box, bone, [0, 0.78, 0.03], 0, [0.12, 0.05, 0.1]));
    g.add(M(sph, eye, [-0.045, 0.9, 0.1], 0, [0.03, 0.03, 0.02]), M(sph, eye, [0.045, 0.9, 0.1], 0, [0.03, 0.03, 0.02]));
    g.add(M(box, std('#888', { metalness: 0.7 }), [0.22, 0.45, 0.15], [0.4, 0, 0], [0.02, 0.4, 0.04]));
  } else if (type === 'wolf') {
    g.add(M(sph, body, [0, 0.55, 0], 0, [0.2, 0.2, 0.42]));
    for (const [x, z] of [[-0.11, 0.25], [0.11, 0.25], [-0.11, -0.25], [0.11, -0.25]]) g.add(M(cyl, body, [x, 0.22, z], 0, [0.04, 0.44, 0.04]));
    g.add(M(sph, body, [0, 0.75, 0.45], 0, [0.15, 0.14, 0.17]), M(box, body, [0, 0.7, 0.62], 0, [0.1, 0.08, 0.16]));
    g.add(M(cone, body, [-0.07, 0.9, 0.42], 0, [0.04, 0.12, 0.04]), M(cone, body, [0.07, 0.9, 0.42], 0, [0.04, 0.12, 0.04]));
    g.add(M(sph, eye, [-0.06, 0.79, 0.57], 0, [0.02, 0.02, 0.02]), M(sph, eye, [0.06, 0.79, 0.57], 0, [0.02, 0.02, 0.02]));
    g.add(M(cone, body, [0, 0.6, -0.5], [-1.9, 0, 0], [0.05, 0.35, 0.05]));
  } else if (type === 'dragon') {
    g.add(M(sph, body, [0, 0.4, 0], 0, [0.25, 0.22, 0.45]));
    for (const [x, z] of [[-0.15, 0.25], [0.15, 0.25], [-0.15, -0.25], [0.15, -0.25]]) g.add(M(cyl, body, [x, 0.15, z], 0, [0.05, 0.3, 0.05]));
    g.add(M(cyl, body, [0, 0.65, 0.42], [0.7, 0, 0], [0.07, 0.4, 0.07]), M(box, body, [0, 0.82, 0.6], 0, [0.14, 0.12, 0.24]));
    g.add(M(cone, std('#e8dcc0'), [-0.05, 0.94, 0.52], [-0.6, 0, 0], [0.025, 0.12, 0.025]), M(cone, std('#e8dcc0'), [0.05, 0.94, 0.52], [-0.6, 0, 0], [0.025, 0.12, 0.025]));
    g.add(M(sph, eye, [-0.06, 0.86, 0.68], 0, [0.02, 0.02, 0.02]), M(sph, eye, [0.06, 0.86, 0.68], 0, [0.02, 0.02, 0.02]));
    const wingG = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.6, 0.45), new THREE.Vector2(0.7, 0.05), new THREE.Vector2(0.4, 0.1)]));
    const wm = std('#7a1a14', { side: THREE.DoubleSide });
    const wl = M(wingG, wm, [-0.15, 0.55, 0], [0, 0, 0.3], [-1, 1, 1]), wr = M(wingG, wm, [0.15, 0.55, 0], [0, 0, -0.3]);
    wl.name = 'wingL'; wr.name = 'wingR'; g.add(wl, wr);
    g.add(M(cone, body, [0, 0.35, -0.6], [-1.7, 0, 0], [0.08, 0.5, 0.08]));
  }
  return g;
}

let ids = 1;
// A creature instance: mini on the table (grabbable via physics body) and/or life-size in the room.
export function makeCreatureMesh(type, scale) {
  const root = new THREE.Group(); const inner = buildCreature(type); inner.scale.setScalar(scale); root.add(inner);
  root.userData = { id: ids++, type, inner, phase: Math.random() * 6 };
  return root;
}

export function miniBase() {
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.006, 20), std('#1a1a1a')); b.position.y = 0.003; b.castShadow = true; return b;
}

export function animateCreature(root, t) {
  const { inner, phase } = root.userData, s = inner.scale.x;
  inner.position.y = (inner.userData.baseY || 0) + Math.abs(Math.sin(t * 2 + phase)) * 0.04 * s;
  inner.rotation.y = Math.sin(t * 0.7 + phase) * 0.15;
  const wl = inner.getObjectByName('wingL'), wr = inner.getObjectByName('wingR');
  if (wl) { wl.rotation.z = 0.3 + Math.sin(t * 3 + phase) * 0.4; wr.rotation.z = -0.3 - Math.sin(t * 3 + phase) * 0.4; }
}

/** models.json monster key for each built-in primitive type (Spawn tab and synced non-combat creatures). */
export const TYPE_MODEL = { goblin: 'goblin', skeleton: 'skeleton', wolf: 'wolf', orc: 'orc', dragon: 'young-red-dragon' };
/** Table-mini height for a model entry: 0.07 for Medium and smaller, up to 0.11 for Large+. */
export const miniModelHeight = (entry) => Math.min(0.11, 0.07 * Math.max(1, entry.scale || 1));
/** Life-size height in metres: models.json scale × 1.7 m (Medium humanoid). */
export const lifeModelHeight = (entry) => (entry.scale || 1) * 1.7;
