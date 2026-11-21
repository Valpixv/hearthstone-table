// Where life-size creatures stand around the table (design/completion-plan.md §8.1). Pure: no three.js, no DOM.
// The arena is a ring on the floor outside the table and the seats. Creatures never overlap each other, never stand
// on a seated player and keep clear of the campfire. The same code places new spawns, resolves a DM's drag, lays out
// formations, and maps a mini's square on the battle mat to a spot in the room.
import CFG from '../data/tableDefaults.json';
import { MAP, seatLayout, LAYOUT_CFG } from './layout.js';

export const ARENA = CFG.arena;

/** Floor radius of a creature from its token (SRD size word in notes/statId is not reliable, so by model scale hint). */
export function creatureRadius(token = {}) {
  const k = /dragon|giant|huge/i.test(`${token.model} ${token.name}`) ? 'huge' : /ogre|troll|owlbear|minotaur|large|dire/i.test(`${token.model} ${token.name}`) ? 'large'
    : /goblin|kobold|rat|small/i.test(`${token.model} ${token.name}`) ? 'small' : 'medium';
  return ARENA.radiusBySize[k];
}

/** Things creatures must keep clear of: the campfire and every seat in use. @param {number[]} seats seat indexes in use */
export function obstacles(seats = []) {
  const out = [{ x: ARENA.firePos[0], z: ARENA.firePos[1], r: ARENA.fireClearance }];
  for (const s of seats) { const [x, z] = seatLayout(s).pos; out.push({ x, z, r: ARENA.seatClearance }); }
  return out;
}

/** Clamps a floor point into the ring (outside the table, inside the far limit). */
export function clampToRing(x, z, { minRadius = ARENA.minRadius, maxRadius = ARENA.maxRadius } = {}) {
  const r = Math.hypot(x, z) || 1e-6, k = Math.min(maxRadius, Math.max(minRadius, r)) / r;
  return [x * k, z * k];
}

/** True when a circle at (x, z) with radius r is inside the ring and clear of every other circle. */
export function isFree(x, z, r, others = [], { gap = ARENA.gap, minRadius = ARENA.minRadius, maxRadius = ARENA.maxRadius } = {}) {
  const d = Math.hypot(x, z);
  if (d < minRadius - 1e-6 || d > maxRadius + 1e-6) return false;
  return others.every((o) => Math.hypot(o.x - x, o.z - z) >= o.r + r + gap - 1e-6);
}

/**
 * The free spot nearest to where something was dropped: the point itself when free, else a spiral search around it.
 * @param {number} x @param {number} z wanted floor point
 * @param {number} r radius of the creature
 * @param {{x:number,z:number,r:number}[]} others creatures already standing plus obstacles()
 * @returns {[number, number]}
 */
export function nearestFree(x, z, r, others = [], opts = {}) {
  [x, z] = clampToRing(x, z, opts);
  if (isFree(x, z, r, others, opts)) return [x, z];
  const step = Math.max(0.15, r * 0.5);
  for (let ring = 1; ring <= 60; ring++) {
    const rad = ring * step, n = Math.max(8, Math.round((2 * Math.PI * rad) / step));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.37, [px, pz] = clampToRing(x + Math.cos(a) * rad, z + Math.sin(a) * rad, opts);
      if (isFree(px, pz, r, others, opts)) return [px, pz];
    }
  }
  return [x, z];
}

/**
 * A spot for a new creature when nobody chose one: the far side of the table from the local viewer first, spreading out.
 * @param {number} r @param {object[]} others @param {number} [facing] angle (radians, atan2(x, z)) creatures gather around
 */
export function autoSlot(r, others = [], facing = Math.PI, opts = {}) {
  const base = (opts.minRadius ?? ARENA.minRadius) + r + 0.5;
  for (let ring = 0; ring < 6; ring++) {
    const rad = base + ring * (r * 2 + 0.4), n = Math.max(6, Math.round((2 * Math.PI * rad) / (r * 2 + ARENA.gap + 0.3)));
    for (let k = 0; k < n; k++) {
      // fan out left/right from the facing direction: 0, +1, -1, +2, -2 …
      const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2), a = facing + (off / n) * Math.PI * 2;
      const x = Math.sin(a) * rad, z = Math.cos(a) * rad;
      if (isFree(x, z, r, others, opts)) return [x, z];
    }
  }
  return nearestFree(Math.sin(facing) * base, Math.cos(facing) * base, r, others, opts);
}

/**
 * Lays several creatures out together. kind: 'line' | 'arc' | 'surround' | 'scatter'.
 * @param {string} kind @param {number[]} radii one per creature @param {object[]} others obstacles and creatures not being moved
 * @param {{ facing?: number, rand?: () => number }} [o] facing: the direction (atan2(x, z)) the group stands in
 * @returns {[number, number][]} positions, in the order of radii
 */
export function formation(kind, radii, others = [], { facing = Math.PI, rand = Math.random } = {}) {
  const n = radii.length, placed = [], out = [];
  const widest = Math.max(0.4, ...radii), space = widest * 2 + ARENA.gap + 0.15, dist = ARENA.minRadius + widest + 0.9;
  const cx = Math.sin(facing) * dist, cz = Math.cos(facing) * dist, tx = Math.cos(facing), tz = -Math.sin(facing); // tangent
  for (let i = 0; i < n; i++) {
    let x, z;
    if (kind === 'line') { const k = i - (n - 1) / 2; x = cx + tx * k * space; z = cz + tz * k * space; }
    else if (kind === 'arc') { const span = Math.min(Math.PI * 0.9, (n - 1) * (space / dist)), a = facing + (n > 1 ? (i / (n - 1) - 0.5) * span : 0); x = Math.sin(a) * dist; z = Math.cos(a) * dist; }
    else if (kind === 'surround') { const a = facing + (i / n) * Math.PI * 2, rad = Math.max(dist, (n * space) / (2 * Math.PI)); x = Math.sin(a) * rad; z = Math.cos(a) * rad; }
    else { const a = facing + (rand() - 0.5) * Math.PI * 1.2, rad = dist + rand() * 2.5; x = Math.sin(a) * rad; z = Math.cos(a) * rad; }
    const p = nearestFree(x, z, radii[i], [...others, ...placed]);
    placed.push({ x: p[0], z: p[1], r: radii[i] }); out.push(p);
  }
  return out;
}
export const FORMATIONS = ['line', 'arc', 'surround', 'scatter'];

/**
 * A square on the battle mat as a spot in the room: the mat's centre is the table, its edges reach out into the arena,
 * so creatures stand around the players the way their minis stand around the map's middle.
 * @param {number} x @param {number} z a mini's table position
 */
export function boardToArena(x, z) {
  const u = (x - MAP.x) / (MAP.w / 2), v = (z - MAP.z) / (MAP.d / 2); // -1..1 across the mat
  const a = Math.atan2(u, v), k = Math.min(1, Math.hypot(u, v) / Math.SQRT2);
  const rad = ARENA.minRadius + 0.6 + k * (ARENA.boardToArena - ARENA.minRadius - 0.6);
  return [Math.sin(a) * rad, Math.cos(a) * rad];
}

/** The inverse of boardToArena: where on the mat a creature standing at a floor point belongs. */
export function arenaToBoard(x, z) {
  const a = Math.atan2(x, z), rad = Math.hypot(x, z);
  const k = Math.max(0, Math.min(1, (rad - ARENA.minRadius - 0.6) / (ARENA.boardToArena - ARENA.minRadius - 0.6))) * Math.SQRT2;
  const u = Math.max(-0.94, Math.min(0.94, Math.sin(a) * k)), v = Math.max(-0.94, Math.min(0.94, Math.cos(a) * k));
  return [MAP.x + u * (MAP.w / 2), MAP.z + v * (MAP.d / 2)];
}

/** Seats a list of players may be using (for obstacles()): every seat index below the cap that someone holds. */
export const seatsInUse = (players = []) => [...new Set(players.map((p) => p.seat).filter((s) => Number.isInteger(s) && s < LAYOUT_CFG.maxSeats))];
