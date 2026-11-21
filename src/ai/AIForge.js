import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { loadModel, makeStandee } from './forgeMeshes.js';
import { MAP } from '../scene/Table.js';
import { TABLE_TOP } from '../physics/Physics.js';
import { randRange } from '../core/random.js';
import { templateDef } from '../tokens/TokenManager.js';
import { guessStat } from '../combat/CombatManager.js';

/** Sizes (metres) for spawned AI content. Tune here. */
export const FORGE_SIZES = { creatureMini: 0.09, creatureLife: 1.7 };
/** The Forge makes creatures only (design/completion-plan.md C2): no items, props or backdrops. */
export const FORGE_KINDS = { creature: 'Creature' };

/**
 * The DM's AI pipeline, client side: prompt → image draft → DM approves → 3D model (or standee)
 * spawned on the board and life-size in the room. Creatures only. Approved results go into a library
 * (dm.state.forge) so the DM can re-spawn them without paying for another generation.
 */
export class AIForge {
  constructor({ dm, scene, physics, grab, sceneMgr, renderer, fetchFn = (...a) => fetch(...a) }) {
    Object.assign(this, { dm, scene, physics, grab, sceneMgr, renderer, fetchFn });
    this.spawned = []; this.meshCache = new Map(); this.busy = false;
    dm.state.forge = dm.state.forge || { library: [] };
    dm.state.forge.spawned = dm.state.forge.spawned || []; // [{ netId, entryId }] what is on the table, for sync
    dm.forge = this;
  }

  get library() { return this.dm.state.forge.library; }

  async status() {
    try { const r = await this.fetchFn('/api/ai/status'); if (!r.ok) throw new Error(r.status); return (await r.json()).providers; } catch { return null; }
  }

  async post(path, body) {
    const r = await this.fetchFn(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  /** Step 1: an image draft for the DM to approve. */
  async draft(kind, prompt) {
    if (!FORGE_KINDS[kind] || !prompt.trim()) throw new Error('Describe the creature');
    const { url, provider } = await this.post('/api/ai/image', { kind, prompt });
    return { kind, prompt: prompt.trim(), image: url, imageProvider: provider };
  }

  /** Step 2: the DM approved the image. Builds the 3D asset, adds it to the library and spawns it. */
  async approve(draft, onProgress = () => {}) {
    const entry = { id: `ai${Date.now().toString(36)}`, kind: draft.kind, prompt: draft.prompt, label: draft.prompt.slice(0, 28), image: draft.image, model: null };
    onProgress('Sculpting a 3D model…');
    const { url, provider } = await this.post('/api/ai/model', { image: draft.image });
    entry.model = url; entry.modelProvider = provider;
    this.library.unshift(entry); this.dm.emit();
    onProgress('Summoning…');
    await this.spawn(entry);
    return entry;
  }

  async mesh(entry) {
    if (!this.meshCache.has(entry.id)) this.meshCache.set(entry.id, entry.model ? loadModel(entry.model) : makeStandee(entry.image));
    return (await this.meshCache.get(entry.id)).clone(true);
  }

  /**
   * Spawns a library creature as a token through TokenManager.spawn (it starts from the closest SRD stat block, editable).
   * opts.netId keeps a given token id; opts.place puts its life-size body at a floor point.
   * @returns {Promise<object|undefined>} the token
   */
  async spawn(entry, { netId = null, lifePos = null } = {}) {
    if (entry.kind !== 'creature') return undefined;
    const def = { ...templateDef(guessStat(entry.prompt)), name: entry.label, model: null, forge: entry.id, life: true };
    if (lifePos) def.lifePos = lifePos;
    const [t] = this.dm.tokens.spawn(def, { id: netId });
    this.dm.narrate(`${entry.label} appears!`);
    return t;
  }

  /**
   * TokenManager factory for AI Forge tokens: a grabbable board mini and, when `life`, a life-size body.
   * @returns {Promise<{ item: object, life: THREE.Object3D|null }>}
   */
  async buildMeshes(entry, { life = false, place = null, token = null } = {}) {
    const h = FORGE_SIZES.creatureMini;
    const model = await this.mesh(entry); model.scale.multiplyScalar(h);
    const hy = h / 2, hw = Math.min(Math.max((model.userData.footprint || 0.6) * h / 2, 0.012), 0.05);
    model.position.y = -hy;
    const root = new THREE.Group(); root.add(model); this.scene.add(root);
    const body = new CANNON.Body({ mass: 0.05, shape: new CANNON.Box(new CANNON.Vec3(hw, hy, hw)), linearDamping: 0.6, angularDamping: 0.99, angularFactor: new CANNON.Vec3(0, 1, 0) });
    body.position.set(place ? place.x : MAP.x + randRange(-MAP.w * 0.3, MAP.w * 0.3), TABLE_TOP + hy + 0.06, place ? place.z : MAP.z + randRange(-MAP.d * 0.3, MAP.d * 0.3));
    body.quaternion.setFromEuler(0, Math.PI + randRange(-0.4, 0.4), 0);
    this.physics.world.addBody(body);
    const item = { id: root.id, netKey: null, kind: 'mini', mesh: root, body, grabOffsetY: 0, holdOffsetY: hy * 0.5, record: { type: entry.label } };
    this.grab.add(item);
    const rec = { entry, item, life: null };
    if (life) {
      const l = await this.mesh(entry); l.scale.multiplyScalar(FORGE_SIZES.creatureLife);
      const lp = token?.lifePos || (token && this.dm.placeLife?.(token)) || [0, -2.6]; // a free spot around the table
      l.position.set(lp[0], 0, lp[1]);
      if (token?.lifeYaw != null) l.rotation.set(0, token.lifeYaw, 0); else l.lookAt(0, 0, 0);
      l.userData.baseScale = l.scale.y; l.userData.phase = randRange(0, 6);
      this.scene.add(l); rec.life = l;
      this.dm.audio.roar?.();
    }
    this.spawned.push(rec);
    this.dm.cinematic?.summon(item.mesh.position.clone().setY(TABLE_TOP + 0.002)); this.dm.cinematic?.dissolveIn(root);
    if (rec.life) { this.dm.cinematic?.summon(rec.life.position.clone().setY(0.02), { radius: 0.8 }); this.dm.cinematic?.dissolveIn(rec.life, 1.6); }
    return { item, life: rec.life };
  }

  /** Drops a removed mini from the per-frame list (TokenManager.disposeRefs frees it). */
  forget(item) { this.spawned = this.spawned.filter((x) => x.item !== item); }

  spawnById(id) { const e = this.library.find((x) => x.id === id); return e ? this.spawn(e) : null; }

  /** Removes every AI Forge creature from the table. */
  clear() {
    this.dm.tokens?.clear({ where: (t) => !!t.forge });
    this.spawned = []; this.dm.state.forge.spawned = [];
  }

  update(t) {
    this.spawned = this.spawned.filter((x) => x.item.mesh.parent);
    for (const { item, life } of this.spawned) {
      item.mesh.position.copy(item.body.position); item.mesh.quaternion.copy(item.body.quaternion);
      if (item.body.position.y < 0.3) { item.body.position.set(MAP.x, TABLE_TOP + 0.1, MAP.z); item.body.velocity.setZero(); }
      if (life) { const k = 1 + Math.sin(t * 1.8 + life.userData.phase) * 0.015; life.scale.y = life.userData.baseScale * k; } // breathing idle
    }
  }
}
