import * as THREE from 'three';
import { FT } from './Tactics.js';
import { MAP } from '../scene/Table.js';
import { TABLE_TOP } from '../physics/Physics.js';

/**
 * Radius on the battle mat of how far a creature can move this turn (pure): its speed in feet as metres on the mat,
 * plus half a square so a mini standing on the line counts as inside. Unknown or zero speed → 0 (no ring).
 */
export function moveRadius(speedFt, ft = FT) { const s = Number(speedFt); return Number.isFinite(s) && s > 0 ? s * ft + 2.5 * ft : 0; }

/**
 * Speed ring (design/completion-plan.md §10): while combat runs, a ring on the mat around where the acting creature
 * started its turn shows how far its speed carries it. A reminder only: nothing stops a mini from leaving it.
 */
export class SpeedRing {
  /** @param {{ scene: THREE.Scene, dm: object }} deps */
  constructor({ scene, dm }) {
    this.dm = dm; this.key = '';
    const g = new THREE.RingGeometry(0.985, 1, 96); g.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#39c2b6', transparent: true, opacity: 0.8, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    this.ring.visible = false; this.ring.renderOrder = 6; scene.add(this.ring);
    // Clip to the mat so the ring never spills onto the wood or a dice tray.
    const hw = MAP.w / 2, hd = MAP.d / 2;
    this.ring.material.clippingPlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), -(MAP.x - hw)), new THREE.Plane(new THREE.Vector3(-1, 0, 0), MAP.x + hw), new THREE.Plane(new THREE.Vector3(0, 0, 1), -(MAP.z - hd)), new THREE.Plane(new THREE.Vector3(0, 0, -1), MAP.z + hd)];
    dm.on(() => this.refresh());
  }

  /** Shows the ring for the creature whose turn it is (re-centred only when the turn changes). */
  refresh() {
    const C = this.dm.state.combat, T = this.dm.tokens;
    const id = C?.active ? C.order[C.turn] : null, t = id ? T.find(id) : null, body = t && T.refs[id]?.item?.body;
    const r = t ? moveRadius(t.sheet?.speed ?? t.speed) : 0;
    if (!body || !r || t.hp <= 0) { this.ring.visible = false; this.key = ''; return; }
    const key = `${id}:${C.round}:${C.turn}`;
    if (key !== this.key) { this.key = key; this.ring.position.set(body.position.x, TABLE_TOP + 0.0045, body.position.z); }
    this.ring.scale.setScalar(r); this.ring.visible = true;
    this.ring.material.color.set(t.side === 'enemy' ? '#d2452f' : '#39c2b6');
  }
}
