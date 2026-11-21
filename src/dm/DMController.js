import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CREATURES, makeCreatureMesh, miniBase, animateCreature, TYPE_MODEL, miniModelHeight, lifeModelHeight } from './creatures.js';
import { attachAnimated, updateAnimations } from '../scene/AnimRegistry.js';
import MODELS from '../data/models.json';
import { makeObject } from './objects.js';
import { MAP } from '../scene/Table.js';
import { TABLE_TOP } from '../physics/Physics.js';
import { textSprite, updateTextSprite } from '../scene/util.js';
import { FONT } from '../scene/fonts.js';
import { random, randRange } from '../core/random.js';
import ENCOUNTER_DATA from '../data/encounters.json';
import { TOKEN_CFG, MESH_FOR, migrateState } from '../tokens/TokenManager.js';

/** A blank token def for a primitive creature type (Spawn tab / gallery "Models"): stats are left to the DM. */
export const creatureDef = (type, { life = true, model = null } = {}) => ({ name: CREATURES[type]?.label || type, kind: 'monster', side: 'enemy', model: model || TYPE_MODEL[type] || null, life });

export const NARRATION_PRESETS = []; // no canned lines: the DM narrates in their own words
/** Encounter setups are data (src/data/encounters.json): scene, lighting, music and monsters. */
export const ENCOUNTERS = Object.fromEntries(ENCOUNTER_DATA.map((e) => [e.id, e.label]));
const MUSIC = ['none', 'tavern', 'explore', 'combat', 'eerie'];

/**
 * Single source of truth for everything the Dungeon Master controls. Both the desktop
 * overlay and the in-VR panel call these methods; `state` is one plain serializable object
 * so saving / networked multiplayer can be layered on later.
 */
export class DMController {
  constructor(deps) {
    Object.assign(this, deps); // scene, sceneMgr, dice, table, weather, audio, grab, physics, effects
    this.state = {
      version: 1, role: 'player', scene: 'campfire',
      lighting: { ...this.sceneMgr.settings },
      weather: { rain: false, snow: false, embers: false, sparkles: false },
      tokens: [], savedDefs: [], settings: { rulesAssist: true }, objects: [],
      map: { fogOfWar: false, fogPaint: false },
      dice: { locked: false, secret: false },
      narration: null, music: 'tavern',
      initiative: { entries: [], turn: 0 },
      secretRolls: [], rollLog: [],
    };
    this.minis = []; this.lifes = []; this.props = []; this.listeners = [];
    this.narr = textSprite('', { w: 1024, h: 256, font: `bold 64px ${FONT.head}`, scale: 0.38, depthTest: false });
    this.narr.position.set(0, 1.5, -0.9); this.narr.renderOrder = 20; this.narr.visible = false; this.scene.add(this.narr);
    this.sceneMgr.onChange = (n) => { this.state.scene = n; if (this.sceneMgr.cache.lair) this.sceneMgr.cache.lair.dragon.visible = !this.lifes.some((l) => l.userData.type === 'dragon'); this.emit(); };
  }

  on(fn) { this.listeners.push(fn); }
  /** Notifies every listener; one failing listener (a UI redraw) must never stop the others (sync is last). */
  emit() { for (const f of this.listeners) { try { f(this.state); } catch (e) { console.error('[dm.emit] listener failed:', e); } } }
  get isDM() { return this.state.role === 'dm'; }

  setRole(role) { this.state.role = role; this.table.setFogVisible(this.state.map.fogOfWar, role === 'dm'); this.emit(); }

  // ---- Scenes & mood ----
  setScene(name) { this.sceneMgr.switchTo(name); this.audio.setMusic(this.state.music = this.sceneMgr.get(name).music); }
  setLighting(key, value) {
    if (key === 'torch') value = Math.min(2.5, Math.max(0, value));
    if (key === 'fog') value = Math.min(1, Math.max(0, value));
    this.state.lighting[key] = value; this.sceneMgr.set(key, value); this.emit();
  }
  setWeather(kind, on = !this.state.weather[kind]) { this.state.weather[kind] = on; this.weather.set(kind, on); this.emit(); }
  lightning() { this.sceneMgr.lightning(); setTimeout(() => this.audio.thunder(), 250 + random() * 600); }

  // ---- Creatures (tokens: src/tokens/TokenManager.js owns the records) ----
  /**
   * TokenManager factory: builds a token's scene objects, a grabbable table mini and (token.life) a life-size body.
   * PC tokens use their hero mini, AI Forge tokens their generated model (async). token.model is a models.json
   * monsters key; an unknown key falls back to the generic model. The primitive mesh shows until the model loads.
   * @returns {{ item: object|null, life: THREE.Object3D|null } | Promise}
   */
  makeTokenMeshes(token, place = null) {
    if (token.kind === 'pc' && this.heroMinis) return { item: this.heroMinis.make(token, place), life: null };
    if (token.forge && this.forge) { const e = this.forge.library.find((x) => x.id === token.forge); if (e) return this.forge.buildMeshes(e, { life: token.life, place, token }); }
    const key = MODELS.monsters[token.model] ? token.model : TOKEN_CFG.genericModel, type = MESH_FOR(key);
    const entry = MODELS.monsters[key] || null, out = { item: null, life: null };
    const s = type === 'dragon' ? 0.11 : 0.07, hy = 0.5 * s;
    const root = makeCreatureMesh(type, s); root.children[0].position.y = root.children[0].userData.baseY = -hy; const base = miniBase(); base.position.y = -hy + 0.003; root.add(base);
    root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const body = new CANNON.Body({ mass: 0.05, shape: new CANNON.Box(new CANNON.Vec3(0.022, hy, 0.022)), linearDamping: 0.6, angularDamping: 0.99, angularFactor: new CANNON.Vec3(0, 1, 0) });
    const px = place ? place.x : MAP.x + randRange(-MAP.w * 0.35, MAP.w * 0.35), pz = place ? place.z : MAP.z + randRange(-MAP.d * 0.35, MAP.d * 0.35);
    body.position.set(px, TABLE_TOP + hy + 0.03, pz); body.quaternion.setFromEuler(0, Math.PI + randRange(-0.5, 0.5), 0);
    this.physics.world.addBody(body); this.scene.add(root);
    const item = { id: root.userData.id, netKey: token.id, kind: 'mini', mesh: root, body, grabOffsetY: 0, holdOffsetY: hy * 0.5, record: { type } };
    this.grab.add(item); this.minis.push(item); out.item = item;
    this.cinematic?.summon(new THREE.Vector3(px, TABLE_TOP + 0.002, pz)); this.cinematic?.dissolveIn(root);
    if (entry) attachAnimated(root, entry, miniModelHeight(entry), { y: -hy + 0.006 });
    if (token.life) {
      const lr = makeCreatureMesh(type, CREATURES[type].life);
      // Where the DM last put it, else the nearest free spot around the table (src/table/arena.js through LifeDrag).
      const lp = token.lifePos || this.placeLife?.(token) || [0, -(type === 'dragon' ? 8 : 3)];
      lr.position.set(lp[0], 0, lp[1]);
      if (token.lifeYaw != null) lr.rotation.set(0, token.lifeYaw, 0); else lr.lookAt(0, 0, 0);
      lr.traverse((o) => { if (o.isMesh) o.castShadow = false; });
      this.scene.add(lr); this.lifes.push(lr); out.life = lr;
      if (entry) attachAnimated(lr, entry, lifeModelHeight(entry), { shadows: false });
      this.cinematic?.summon(lr.position.clone().setY(0.02), { radius: 0.8 }); this.cinematic?.dissolveIn(lr, 1.6);
      if (type === 'dragon' && this.sceneMgr.cache.lair) this.sceneMgr.cache.lair.dragon.visible = false;
      if (type === 'dragon') this.audio.roar();
    }
    return out;
  }
  /** Compat: spawns a blank token of a primitive creature type through the one spawn path. @returns {{ item, life }} */
  spawnCreature(type, { life = true, model = null } = {}) {
    const [t] = this.tokens.spawn(creatureDef(type, { life, model }));
    return this.tokens.refs[t.id] || { item: null, life: null };
  }
  /** Removes every non-PC token (monsters, NPCs, AI Forge creatures and items). */
  clearCreatures() {
    this.tokens?.clear({ kind: ['monster', 'npc', 'item'] });
    if (this.sceneMgr?.cache.lair) this.sceneMgr.cache.lair.dragon.visible = true;
  }

  // ---- Objects ----
  spawnObject(type) {
    const o = makeObject(type, this.audio, this.sceneMgr.ctx);
    const n = this.props.length, a = (n % 2 ? 1 : -1) * (0.5 + (n >> 1) * 0.4), d = type === 'door' ? 3.2 : 1.5 + randRange(0, 0.6);
    o.position.set(Math.sin(a) * d, 0, -Math.cos(a) * d); o.lookAt(0, 0, 0);
    this.scene.add(o); o.updateMatrixWorld(true);
    o.userData.box = new THREE.Box3().setFromObject(o).expandByScalar(0.03);
    o.userData.cool = 0;
    this.props.push(o); this.state.objects.push({ id: o.id, type, pos: [o.position.x, o.position.z] }); this.emit();
  }
  clearObjects() { this.props.forEach((p) => this.scene.remove(p)); this.props = []; this.state.objects = []; this.emit(); }
  pokeAt(p) { // fingertip poke
    for (const o of this.props) if (o.userData.cool <= 0 && o.userData.box.containsPoint(new THREE.Vector3(...p))) { o.userData.poke(); o.userData.cool = 1; }
  }

  // ---- Map ----
  setFogOfWar(on = !this.state.map.fogOfWar) { this.state.map.fogOfWar = on; this.table.setFogVisible(on, this.isDM); this.emit(); }
  toggleFogPaint() { this.state.map.fogPaint = !this.state.map.fogPaint; if (this.state.map.fogPaint && !this.state.map.fogOfWar) this.setFogOfWar(true); this.emit(); }

  // ---- Dice ----
  spawnDie(type) { if (!this.state.dice.locked) this.dice.toss(this.dice.spawn(type)); }
  clearDice() { this.dice.clear(); }
  setSecret(on = !this.state.dice.secret) { this.state.dice.secret = this.dice.secret = on; this.emit(); }
  setLocked(on = !this.state.dice.locked) { this.state.dice.locked = this.dice.locked = on; this.narrate(on ? 'The dice are stilled…' : 'Fate is yours once more.'); this.emit(); }
  secretRoll(sides = 20) { this.addSecret(`d${sides}`, 1 + Math.floor(random() * sides)); }
  addSecret(type, value) { this.state.secretRolls.unshift({ type, value, at: new Date().toLocaleTimeString() }); this.state.secretRolls.length = Math.min(this.state.secretRolls.length, 12); this.emit(); }
  onRoll({ type, value, secret }) {
    if (secret) return this.addSecret(type, value);
    const nat = type === 'd20' && (value === 20 || value === 1);
    this.state.rollLog.push({ text: `${type}: ${value}${type === 'd20' && value === 20 ? '  NAT 20!' : type === 'd20' && value === 1 ? '  nat 1…' : ''}`, color: nat ? (value === 20 ? '#a07800' : '#a01010') : null });
    if (this.state.rollLog.length > 30) this.state.rollLog.shift();
    this.table.setLog(this.state.rollLog); this.emit();
  }

  // ---- Narration ----
  narrate(text) {
    this.state.narration = { text, at: Date.now() };
    updateTextSprite(this.narr, text); this.narr.visible = true; this.narrT = 0;
    this.audio.tone(220, 1.5, { type: 'sine', gain: 0.06, attack: 0.3 }); this.emit();
  }

  // ---- Sound ----
  sfx(name) { this.audio[name]?.(); }
  setMusic(m) { this.state.music = m; this.audio.setMusic(m); this.emit(); }

  // ---- Initiative ----
  addCombatant(name, mod = 0, monster = false) {
    if (!name || !this.combatMgr) return;
    if (monster) this.combatMgr.register({ name, statId: 'bandit' });
    else this.combatMgr.addFromClass('fighter', name);
  }
  damage(id, n, o) { this.combatMgr?.damage(id, n, o); }
  logRoll(text) { this.state.rollLog.push({ text, color: null }); if (this.state.rollLog.length > 30) this.state.rollLog.shift(); this.table.setLog(this.state.rollLog); }
  rollInitiative() { this.combatMgr?.start(); }
  nextTurn() { this.combatMgr?.next(); }
  clearInitiative() { this.combatMgr?.end(); }
  // ---- Encounter presets ----
  reset() { this.forge?.clear(); this.clearCreatures(); this.clearObjects(); Object.keys(this.state.weather).forEach((k) => this.setWeather(k, false)); this.clearInitiative(); }
  /** Runs an encounter setup: scene, lighting, weather, map, SRD monsters and music. The DM does the talking. */
  encounter(id) {
    const e = ENCOUNTER_DATA.find((x) => x.id === id); if (!e) return;
    this.reset(); this.combatMgr?.clearMonsters();
    this.setScene(e.scene); this.setLighting('timeOfDay', e.timeOfDay); this.setLighting('mood', e.mood);
    (e.weather || []).forEach((w) => this.setWeather(w, true));
    this.setFogOfWar(!!e.fog);
    if (e.npc) this.spawnObject('npc');
    e.monsters.forEach((m, i) => setTimeout(() => this.combatMgr?.addMonster(m, { life: i < 3 }), 900 + i * 350));
    if (e.lightning) setTimeout(() => this.lightning(), 1400);
    this.setMusic(e.music);
  }

  // ---- Persistence ----
  /** The whole table as JSON. Tokens are the saved record (positions refreshed first); combat is { active, round, turn, order }. */
  serialize() {
    this.tokens?.capturePositions();
    return JSON.stringify(this.state);
  }
  save() { try { localStorage.setItem('hearthstone-dm', this.serialize()); this.narrate('Session saved.'); } catch { /* storage unavailable */ } }
  /**
   * Restores a save (localStorage, or `raw` JSON / object): scene, mood, map, objects, party, tokens, combat, saved
   * creatures, settings and the AI Forge library. Old saves (combat.combatants) are migrated to tokens.
   * @returns {boolean} true when something was loaded
   */
  load(raw = null) {
    let s; try { s = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : JSON.parse(localStorage.getItem('hearthstone-dm')); } catch { s = null; }
    if (!s) return false;
    s = migrateState(s);
    this.reset();
    if (s.forge) this.state.forge = { ...this.state.forge, ...s.forge, library: (s.forge.library || []).filter((e) => e.kind === 'creature'), spawned: [] };
    if (s.scene) this.setScene(s.scene.startsWith('ai-') ? 'campfire' : s.scene); // AI backdrops were removed
    Object.entries(s.lighting || {}).forEach(([k, v]) => this.setLighting(k, v));
    Object.entries(s.weather || {}).forEach(([k, v]) => this.setWeather(k, v));
    (s.objects || []).forEach((o) => this.spawnObject(o.type));
    if (s.map) this.setFogOfWar(!!s.map.fogOfWar);
    this.state.party = s.party || [];
    this.state.savedDefs = s.savedDefs || [];
    this.state.settings = { rulesAssist: true, ...(s.settings || {}) };
    this.tokens?.restore(s.tokens);
    const C = s.combat || {};
    if (this.tokens) Object.assign(this.tokens.combat, { active: !!C.active, round: C.round ?? 1, turn: C.turn ?? 0, acted: !!C.acted, order: (C.order || []).filter((id) => this.tokens.find(id)) });
    this.combatMgr?.ensurePartyTokens();
    if (s.music) this.setMusic(s.music);
    this.narrate('Session restored.');
    return true;
  }

  update(t, dt) {
    for (const m of this.minis) { m.mesh.position.copy(m.body.position); m.mesh.quaternion.copy(m.body.quaternion); if (!m.mesh.userData.model) animateCreature(m.mesh, t); if (m.body.position.y < 0.3) { m.body.position.set(MAP.x, TABLE_TOP + 0.1, MAP.z); m.body.velocity.setZero(); } }
    for (const l of this.lifes) if (!l.userData.model) animateCreature(l, t);
    updateAnimations(dt); // model mixers + hero-mini followers
    this.props.forEach((p) => { p.userData.update(t, dt); p.userData.cool -= dt; });
    if (this.narr.visible) {
      this.narrT += dt; const k = this.narrT;
      this.narr.material.opacity = k < 0.5 ? k * 2 : k > 4.5 ? Math.max(0, (5 - k) * 2) : 1;
      this.narr.position.y = 1.5 + Math.sin(t * 1.5) * 0.015;
      if (k > 5) this.narr.visible = false;
    }
  }

}
