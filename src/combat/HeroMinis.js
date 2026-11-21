import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { miniBase } from '../dm/creatures.js';
import { attachAnimated, track } from '../scene/AnimRegistry.js';
import { MAP } from '../scene/Table.js';
import { TABLE_TOP } from '../physics/Physics.js';
import { std } from '../scene/util.js';
import MODELS from '../data/models.json';

const HY = 0.035, HEIGHT = 0.07, SLOTS = 6;
const pawnGeo = new THREE.CapsuleGeometry(0.012, 0.03, 4, 8); // fallback if the hero model fails

/**
 * Hero minis for PC tokens (models.json heroes[cls]), placed along the players' (+z) map edge. A factory used by
 * DMController.makeTokenMeshes, so PCs go through TokenManager.spawn like every other creature; the grab item's
 * netKey is the token id (set by TokenManager), so TableSync's mini moves carry them between machines.
 */
export class HeroMinis {
  /** @param {{ dm: import('../dm/DMController.js').DMController }} deps */
  constructor({ dm }) {
    this.dm = dm; this.byChar = new Map(); this.items = [];
    dm.heroMinis = this;
    track(null, { update: () => this.follow() });
  }

  /** Scene root of a character's hero mini (for animations), or null. */
  root(charId) { return this.byChar.get(charId)?.mesh ?? null; }

  /**
   * Builds the hero mini of a PC token. The class comes from token.model (or the party sheet), the colour from the sheet.
   * @returns {object} the grab item
   */
  make(token, place = null) {
    const { dm } = this, ch = dm.state.party?.find((p) => p.id === token.charId) || {};
    const entry = MODELS.heroes[token.model] || MODELS.heroes[ch.cls] || MODELS.heroes.fighter;
    const root = new THREE.Group(), pawn = new THREE.Mesh(pawnGeo, std(ch.color || '#c9a66b'));
    pawn.position.y = -HY + 0.006 + 0.027; pawn.castShadow = true;
    const inner = new THREE.Group(); inner.add(pawn); root.add(inner); root.userData = { inner, type: 'hero' };
    const base = miniBase(); base.position.y = -HY + 0.003; root.add(base);
    const body = new CANNON.Body({ mass: 0.05, shape: new CANNON.Box(new CANNON.Vec3(0.022, HY, 0.022)), linearDamping: 0.6, angularDamping: 0.99, angularFactor: new CANNON.Vec3(0, 1, 0) });
    const slot = this.items.length % SLOTS;
    const x = place ? place.x : MAP.x - MAP.w * 0.4 + slot * (MAP.w * 0.8 / (SLOTS - 1)), z = place ? place.z : MAP.z + MAP.d / 2 - 0.035;
    body.position.set(x, TABLE_TOP + HY + 0.03, z); body.quaternion.setFromEuler(0, Math.PI, 0); // face into the map
    root.position.copy(body.position);
    dm.physics.world.addBody(body); dm.scene.add(root);
    const item = { id: `pc:${token.id}`, netKey: token.id, kind: 'mini', mesh: root, body, grabOffsetY: 0, holdOffsetY: HY * 0.5, record: null, charId: token.charId };
    dm.grab.add(item); this.items.push(item); if (token.charId) this.byChar.set(token.charId, item);
    attachAnimated(root, entry, HEIGHT, { y: -HY + 0.006 });
    return item;
  }

  /** Drops a removed item from the follower list (TokenManager.disposeRefs frees the rest). */
  forget(item) {
    if (!this.items.includes(item)) return;
    this.items = this.items.filter((x) => x !== item);
    if (this.byChar.get(item.charId) === item) this.byChar.delete(item.charId);
  }

  /** Per frame: meshes follow their bodies; a mini knocked off the table returns to the map. */
  follow() {
    for (const it of this.items) {
      const b = it.body; it.mesh.position.copy(b.position); it.mesh.quaternion.copy(b.quaternion);
      if (b.position.y < 0.3) { b.position.set(MAP.x, TABLE_TOP + 0.1, MAP.z); b.velocity.setZero(); }
    }
  }
}
