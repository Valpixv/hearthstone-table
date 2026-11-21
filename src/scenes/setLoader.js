import * as THREE from 'three';
import { place, loadTexture } from '../scene/assets.js';
import { rng } from '../scene/util.js';
import { seatLayout, LAYOUT_CFG } from '../table/layout.js';
import SETS from '../data/sets.json';

/** Set ids that have real geometry (src/data/sets.json). */
export const SET_IDS = Object.keys(SETS.sets);

/**
 * Positions for one scatter row (pure, deterministic for a seed): `count` points between rMin and rMax that keep clear of
 * the table, of every seat, and of each other. @returns {{ x, z, rotY, scale, part }[]}
 */
export function scatterPoints(row, clearance = SETS.clearance, rand = null) {
  const r = rand || rng(row.seed ?? 1), out = [], seats = Array.from({ length: LAYOUT_CFG.maxSeats }, (_, i) => seatLayout(i).pos);
  const [s0, s1] = row.scale || [1, 1], gap = row.gap ?? 0.5;
  for (let tries = 0; out.length < row.count && tries < row.count * 30; tries++) {
    const a = r() * Math.PI * 2, d = row.rMin + r() * (row.rMax - row.rMin), x = Math.cos(a) * d, z = Math.sin(a) * d;
    const p = { x, z, rotY: r() * Math.PI * 2, scale: s0 + r() * (s1 - s0), part: row.parts ? Math.floor(r() * row.parts) : undefined };
    if (d < clearance.table) continue;
    if (seats.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < clearance.seat)) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < gap)) continue;
    out.push(p);
  }
  return out;
}

/** A soft-edged floor disc so the set's ground fades into the projected sky instead of ending in a seam. */
function ground(spec) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 26, 64, 64, 64);
  grd.addColorStop(0, '#fff'); grd.addColorStop(1, '#000'); g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, alphaMap: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, color: spec.tint || spec.color || '#ffffff' });
  if (spec.texture) {
    const rep = Math.round((spec.radius || 9) * 2.6);
    mat.map = loadTexture(`${spec.texture}/${spec.texture}_Diffuse_1k.jpg`, { repeat: rep, srgb: true });
    mat.normalMap = loadTexture(`${spec.texture}/${spec.texture}_nor_gl_1k.jpg`, { repeat: rep });
    mat.roughnessMap = loadTexture(`${spec.texture}/${spec.texture}_Rough_1k.jpg`, { repeat: rep });
  }
  const m = new THREE.Mesh(new THREE.CircleGeometry(spec.radius || 9, 48), mat);
  m.rotation.x = -Math.PI / 2; m.position.y = 0.002; m.receiveShadow = true; m.name = 'set-ground';
  return m;
}

/**
 * Builds a scenery set into a scene group (design/completion-plan.md phase 12): ground, a ring of scattered models,
 * fixed props and up to three flickering lights. Models load in the background; the returned object's update(t)
 * flickers the lights. Unknown ids return null (the scene keeps its backdrop only).
 * @param {THREE.Group} group @param {string} id scene id
 * @returns {{ update: (t: number) => void, lights: THREE.PointLight[], ready: Promise<void>, count: number } | null}
 */
export function buildSet(group, id) {
  const set = SETS.sets[id]; if (!set) return null;
  const root = new THREE.Group(); root.name = `set:${id}`; group.add(root);
  if (set.ground) root.add(ground(set.ground));
  const jobs = [], add = (model, pos, o) => jobs.push(place(root, model, pos, o).catch((e) => console.warn('[set] asset failed', model, e.message)));
  let count = 0;
  for (const row of set.scatter || []) for (const p of scatterPoints(row)) { add(row.model, [p.x, 0, p.z], { part: p.part, rotY: p.rotY, scale: p.scale }); count++; }
  for (const p of set.props || []) { add(p.model, p.pos, { part: p.part, rotY: p.rotY || 0, scale: p.scale ?? 1 }); count++; }
  const lights = (set.lights || []).slice(0, 3).map((l, i) => {
    const pl = new THREE.PointLight(l.color, l.intensity, l.distance, 2); pl.position.set(...l.pos); pl.userData = { base: l.intensity, phase: i * 2.1 }; root.add(pl); return pl;
  });
  // Once placed, set dressing never moves: freeze matrices so it costs nothing per frame.
  const ready = Promise.all(jobs).then(() => { root.updateMatrixWorld(true); root.traverse((o) => { if (!o.isLight) o.matrixAutoUpdate = false; }); });
  return { root, lights, ready, count, update(t) { for (const l of lights) l.intensity = l.userData.base * (0.9 + Math.sin(t * 7 + l.userData.phase) * 0.06 + Math.sin(t * 13.3 + l.userData.phase) * 0.04); } };
}
