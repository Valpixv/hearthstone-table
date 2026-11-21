// Tokens: every creature on the table is one plain record with an HP bar (design/flexibility-plan.md §1, §3, §9 step 1).
// dm.state.tokens is the single saved and synced record; scene objects live in `refs` by token id.
import MONSTERS from '../data/monsters.json';
import MODELS from '../data/models.json';
import CFG from './tokenConfig.json';
import { random } from '../core/random.js';
import { normalizeSheet, normalizeInventory, normalizeCoins } from '../party/sheet.js';
import { applyDamage, rollDeathSave, freshDeathSaves, removeAndKeepTurn, setInitiative, sortInitiative } from '../rules/combat.js';

export const TOKEN_CFG = CFG;
const abilityMod = (s) => Math.floor((s - 10) / 2);
const uid = () => `t${Math.floor(random() * 1e9).toString(36)}${Math.floor(random() * 1e4).toString(36)}`;
const num = (v, d) => (v === '' || v == null || !Number.isFinite(Number(v)) ? d : Number(v));

/** Which primitive creature mesh stands in for a model key (until real minis exist for it). */
export const MESH_FOR = (id) => (/dragon/.test(id) ? 'dragon' : /skeleton|zombie|ghoul|wight|mummy/.test(id) ? 'skeleton'
  : /wolf|owlbear|spider|rat/.test(id) ? 'wolf' : /goblin|kobold/.test(id) ? 'goblin' : 'orc');

/** Fields that live on the token record (everything else in a def is ignored). */
const FIELDS = ['name', 'kind', 'side', 'model', 'life', 'hp', 'maxHp', 'tempHp', 'ac', 'initBonus', 'speed', 'custom', 'abilities', 'rolls', 'notes',
  'hpVisibility', 'conditions', 'init', 'owner', 'away', 'deathSaves', 'netId', 'statId', 'charId', 'forge', 'pos', 'lifePos', 'lifeYaw',
  'sheet', 'inventory', 'coins', 'avatar'];

/**
 * Normalises a def (from the gallery, a template, a save or a snapshot) into a token.
 * @param {object} def partial token
 * @param {string} [id] keep this id (load, sync); otherwise a new one
 */
export function makeToken(def = {}, id = null) {
  const d = CFG.defaults, kind = def.kind || 'monster';
  const maxHp = num(def.maxHp, num(def.hp, d.maxHp));
  const t = {
    id: id || def.id || uid(), name: String(def.name || 'Creature'), kind,
    side: def.side || (kind === 'pc' ? 'ally' : kind === 'monster' ? 'enemy' : 'neutral'),
    model: def.model || null, life: def.life ?? (kind === 'monster' || kind === 'npc'), // creatures stand life-size around the table by default
    hp: Math.min(maxHp, num(def.hp, maxHp)), maxHp, tempHp: Math.max(0, num(def.tempHp, 0)),
    ac: num(def.ac, d.ac), initBonus: num(def.initBonus, d.initBonus), speed: num(def.speed, d.speed),
    custom: (def.custom || []).map((c) => ({ key: String(c.key ?? ''), value: c.value ?? '' })),
    rolls: (def.rolls || []).map((r) => ({ name: String(r.name ?? ''), expr: String(r.expr ?? '') })),
    notes: def.notes || '', hpVisibility: def.hpVisibility || 'exact',
    conditions: (def.conditions || []).map((k) => ({ ...k })), init: def.init ?? null, owner: def.owner ?? null,
    deathSaves: def.deathSaves ? { ...def.deathSaves } : null, netId: def.netId ?? null,
  };
  if (def.abilities) t.abilities = { ...def.abilities };
  // Character sheet + bag (design/feature-expansion-plan.md §2, §3): optional, PCs and loot containers.
  if (def.sheet) t.sheet = normalizeSheet(def.sheet);
  if (def.inventory) t.inventory = normalizeInventory(def.inventory);
  if (def.coins) t.coins = normalizeCoins(def.coins);
  if (def.avatar && typeof def.avatar === 'object') t.avatar = { ...def.avatar };
  for (const k of ['statId', 'charId', 'forge', 'pos', 'lifePos', 'lifeYaw', 'away']) if (def[k] != null) t[k] = Array.isArray(def[k]) ? [...def[k]] : def[k];
  return t;
}

/** A def from an SRD stat block (optional starting point). */
export function templateDef(statId) {
  const s = MONSTERS[statId]; if (!s) return null;
  return { name: s.name, kind: 'monster', side: 'enemy', model: statId, statId, hp: s.hp, maxHp: s.hp, ac: s.ac,
    initBonus: abilityMod(s.abilities.dex), speed: parseInt(s.speed, 10) || CFG.defaults.speed, abilities: { ...s.abilities } };
}

/** Plain def of a token (no id, runtime state or position), for duplicate / saveDef. */
export function defOf(t) {
  const d = JSON.parse(JSON.stringify(t));
  for (const k of ['id', 'init', 'deathSaves', 'netId', 'pos', 'lifePos', 'lifeYaw', 'owner', 'charId', 'away']) delete d[k];
  d.conditions = []; return d;
}

/**
 * Parses an HP expression: '-7' damage, '+3' heal, '=25' set, '+5 temp' / '5 temp' temp HP. Null when unreadable.
 * @returns {{ op: 'delta'|'set'|'temp', value: number } | null}
 */
export function parseHpExpr(expr) {
  const m = String(expr).trim().toLowerCase().match(/^([+=-]?)\s*(\d+)\s*(temp|thp)?$/);
  if (!m) return null;
  const v = Number(m[2]);
  if (m[3]) return { op: 'temp', value: v };
  if (m[1] === '=') return { op: 'set', value: v };
  if (!m[1]) return null; // a bare number is ambiguous: damage or heal?
  return { op: 'delta', value: m[1] === '-' ? -v : v };
}

/** Pre-token saves: combat.combatants (+ Spawn-tab creatures and Forge spawns) → tokens. Returns a new state. */
export function migrateState(s) {
  if (!s || Array.isArray(s.tokens)) return s;
  const out = { ...s }, old = s.combat?.combatants || [], tokens = [];
  const forgeEntry = (netId) => s.forge?.spawned?.find((x) => x.netId === netId)?.entryId ?? null;
  const miniIds = new Set(old.map((c) => c.miniId).filter((x) => x != null));
  for (const c of old) {
    const pc = c.side === 'pc' || !!c.charId;
    const cls = pc ? s.party?.find((p) => p.id === c.charId)?.cls : null;
    tokens.push(makeToken({ name: c.name, kind: pc ? 'pc' : 'monster', side: pc ? 'ally' : 'enemy', model: pc ? cls || 'fighter' : c.statId || null,
      hp: c.hp, maxHp: c.maxHp, ac: c.ac, initBonus: c.dexMod ?? 0, init: c.init, conditions: c.conditions, deathSaves: c.deathSaves,
      statId: c.statId, charId: c.charId, forge: c.forgeNetId ? forgeEntry(c.forgeNetId) : null }, c.id));
  }
  for (const r of s.creatures || []) if (!miniIds.has(r.id)) {
    const model = r.type === 'dragon' ? 'young-red-dragon' : r.type;
    tokens.push(makeToken({ name: r.type[0].toUpperCase() + r.type.slice(1), kind: 'monster', model, life: false, pos: r.mini || null }));
  }
  const forgeLinked = new Set(old.map((c) => c.forgeNetId).filter(Boolean));
  for (const sp of s.forge?.spawned || []) if (!forgeLinked.has(sp.netId)) {
    const e = s.forge?.library?.find((x) => x.id === sp.entryId);
    if (e && e.kind === 'creature') tokens.push(makeToken({ name: e.label, kind: 'monster', forge: e.id }));
  }
  for (const p of s.party || []) if (!tokens.some((t) => t.charId === p.id)) tokens.push(pcDef(p, true));
  out.tokens = tokens;
  const C = s.combat || {};
  out.combat = { active: !!C.active, round: C.round ?? 1, turn: C.turn ?? 0, acted: !!C.acted, order: old.length ? old.map((c) => c.id) : tokens.filter((t) => t.kind !== 'item').map((t) => t.id) };
  for (const t of tokens) if (t.kind !== 'item' && !out.combat.order.includes(t.id)) out.combat.order.push(t.id);
  out.savedDefs = s.savedDefs || []; out.settings = { rulesAssist: true, ...(s.settings || {}) };
  delete out.creatures;
  if (out.forge) out.forge = { ...out.forge, spawned: [] };
  return out;
}

/** The PC token def for a party character (sheet in dm.state.party). */
export function pcDef(ch, asToken = false) {
  const d = { name: ch.name, kind: 'pc', side: 'ally', model: ch.cls || 'fighter', charId: ch.id, hp: ch.hp, maxHp: ch.maxHp, ac: ch.ac,
    initBonus: ch.abilities ? abilityMod(ch.abilities.dex) : 0, abilities: ch.abilities ? { ...ch.abilities } : undefined, deathSaves: ch.hp <= 0 ? freshDeathSaves() : null };
  return asToken ? makeToken(d) : d;
}

/** Legacy combatant view of a token (side 'pc' | 'monster', dexMod) for the not-yet-migrated UI and the pure rules. */
export const legacyView = (t) => ({ ...t, faction: t.side, side: t.kind === 'pc' ? 'pc' : 'monster', dexMod: t.initBonus });

/**
 * Makes state.combat the slim { active, round, turn, acted, order } and adds a read-only, non-saved `combatants`
 * getter (legacy views in initiative order) so UI code that still reads combat.combatants keeps working.
 */
export function ensureCombat(state) {
  const C = state.combat && typeof state.combat === 'object' ? state.combat : {};
  if (!Array.isArray(C.order)) C.order = Array.isArray(C.combatants) ? C.combatants.map((c) => c.id) : [];
  const d = Object.getOwnPropertyDescriptor(C, 'combatants');
  if (!d || d.enumerable || !d.get) {
    delete C.combatants;
    Object.defineProperty(C, 'combatants', { enumerable: false, configurable: true,
      get: () => C.order.map((id) => (state.tokens || []).find((t) => t.id === id)).filter(Boolean).map(legacyView) });
  }
  C.active = !!C.active; C.round = C.round ?? 1; C.turn = C.turn ?? 0; C.acted = !!C.acted;
  state.combat = C; return C;
}

/** Tokens that get a name plate and HP bar: every non-item token with a mini or a life-size body. */
export function platedTokens(tokens, refs) {
  return tokens.filter((t) => t.kind !== 'item' && (refs[t.id]?.item || refs[t.id]?.life));
}

/** Frees a scene subtree: animation mixers and geometry / material / texture GPU memory. */
export function disposeObject(root) {
  if (!root) return;
  root.removeFromParent?.();
  const anim = root.userData?.anim;
  if (anim?.mixer) { anim.mixer.stopAllAction(); anim.mixer.uncacheRoot?.(anim.root || root); }
  root.traverse?.((o) => {
    if (o.geometry) o.geometry.dispose();
    for (const m of [].concat(o.material || [])) {
      for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
      m.dispose();
    }
  });
}

/**
 * Owns dm.state.tokens. Every spawn source (gallery / Spawn tab, SRD templates, AI Forge, party PCs, sync) calls spawn().
 * Scene objects come from `factory(token, place)` → { item, life } (or a Promise of it); without one, tokens are data only.
 */
export class TokenManager {
  /** @param {{ dm: object, factory?: Function }} deps */
  constructor({ dm, factory = null }) {
    this.dm = dm; this.factory = factory; this.refs = {}; this.onRemove = [];
    const s = dm.state;
    s.tokens = s.tokens || []; s.savedDefs = s.savedDefs || [];
    s.settings = { rulesAssist: true, ...(s.settings || {}) };
    ensureCombat(s);
    dm.tokens = this;
  }

  get list() { return this.dm.state.tokens; }
  get combat() { return ensureCombat(this.dm.state); }
  get rulesAssist() { return this.dm.state.settings?.rulesAssist !== false; }
  find(id) { return this.list.find((t) => t.id === id) || null; }
  byChar(charId) { return this.list.find((t) => t.charId === charId) || null; }
  lifeCount() { return Object.values(this.refs).filter((r) => r.life).length; }
  warn(msg) { if (this.dm.toast) this.dm.toast(msg); else this.dm.narrate?.(msg); }

  /**
   * Spawns `count` tokens from a def (auto-numbered "Goblin 1..n" when count > 1).
   * @param {object} def token fields
   * @param {{ count?: number, place?: {x:number,z:number}|null, id?: string, refs?: {item, life}, emit?: boolean, join?: boolean }} opts
 *   join: false skips joining a running initiative (load, sync)
   * @returns {object[]} the new tokens
   */
  spawn(def, { count = 1, place = null, id = null, refs = null, emit = true, join = true } = {}) {
    const out = [], n = Math.max(1, Math.floor(count) || 1);
    for (let i = 0; i < n; i++) {
      const t = makeToken({ ...def, name: n > 1 ? `${def.name || 'Creature'} ${i + 1}` : def.name }, n === 1 ? id : null);
      if (this.find(t.id)) { out.push(this.find(t.id)); continue; }
      if (t.life && !refs && this.lifeCount() >= CFG.lifeCap) { t.life = false; this.warn(`Life-size limit (${CFG.lifeCap}) reached: ${t.name} stays a mini.`); }
      this.list.push(t);
      if (t.kind !== 'item' && !this.combat.order.includes(t.id)) this.combat.order.push(t.id);
      this.attach(t, refs, place || (t.pos ? { x: t.pos[0], z: t.pos[1] } : null));
      if (join && this.combat.active && t.kind !== 'item' && t.init == null) this.joinInitiative(t);
      out.push(t);
    }
    if (emit) this.dm.emit();
    return out;
  }

  /** Builds (or takes) the scene objects of a token. Async factories fill refs when ready. */
  attach(t, refs = null, place = null) {
    const set = (r) => {
      r = { item: r?.item || null, life: r?.life || null };
      if (r.item) { r.item.netKey = t.id; r.item.tokenId = t.id; }
      this.refs[t.id] = r;
    };
    if (refs) return set(refs);
    const made = this.factory ? this.factory(t, place) : null;
    if (made && typeof made.then === 'function') {
      set(null);
      made.then((r) => { if (this.find(t.id) && this.refs[t.id]) { set(r); this.dm.emit(); } else this.disposeRefs(r); })
        .catch((e) => console.warn('[tokens] model failed', e));
    } else set(made);
  }

  /** Mid-combat newcomers join their group's initiative (same template), or roll d20 + bonus with Rules assist. */
  joinInitiative(t) {
    const kin = this.list.find((x) => x.id !== t.id && x.init != null && x.kind !== 'pc' && (t.statId ? x.statId === t.statId : x.name === t.name));
    const v = kin ? kin.init : this.rulesAssist && t.kind !== 'pc' ? 1 + Math.floor(random() * 20) + t.initBonus : null;
    if (v != null) this.combatOp((v0) => setInitiative(v0, t.id, v));
  }

  /** Runs a pure rules/combat.js function on the ordered tokens and writes the result back (order, turn, round, per-token fields). */
  combatOp(fn) {
    const C = this.combat, toks = C.order.map((id) => this.find(id)).filter(Boolean);
    const view = { round: C.round, turn: C.turn, combatants: toks.map((t) => (t.kind === 'pc' ? { ...t, side: 'pc' } : t)) };
    const r = fn(view);
    C.round = r.round; C.turn = r.turn; C.order = r.combatants.map((c) => c.id);
    for (const c of r.combatants) { const t = this.find(c.id); if (t && c !== t) Object.assign(t, { init: c.init, conditions: c.conditions, hp: c.hp, deathSaves: c.deathSaves }); }
    return r;
  }

  /** Sorts the order by initiative (stable). */
  sortOrder() { this.combatOp((v) => ({ ...v, combatants: sortInitiative(v.combatants) })); }

  /**
   * Edits a token. A changed model or life-size toggle rebuilds its scene objects (the mini keeps its place).
   * @returns {object|null} the token
   */
  update(id, patch = {}) {
    const t = this.find(id); if (!t) return null;
    const rebuild = ('model' in patch && patch.model !== t.model) || ('life' in patch && !!patch.life !== t.life) || ('forge' in patch && patch.forge !== t.forge);
    const clean = makeToken({ ...t, ...patch }, t.id);
    for (const k of FIELDS) if (k in patch) t[k] = clean[k];
    if ('maxHp' in patch || 'hp' in patch) t.hp = Math.min(t.maxHp, Math.max(0, t.hp));
    if (rebuild) {
      if (t.life && !this.refs[id]?.life && this.lifeCount() >= CFG.lifeCap) { t.life = false; this.warn(`Life-size limit (${CFG.lifeCap}) reached.`); }
      const p = this.refs[id]?.item?.body?.position;
      this.disposeRefs(this.refs[id]); delete this.refs[id];
      this.attach(t, null, p ? { x: p.x, z: p.z } : null);
    }
    this.syncChar(t); this.dm.emit(); return t;
  }

  /** Removes a token and frees its mini, physics body, grab entry, mixer, geometry/material clones and life-size body. */
  remove(id, { emit = true } = {}) {
    const t = this.find(id); if (!t) return;
    this.disposeRefs(this.refs[id]); delete this.refs[id];
    const C = this.combat;
    if (C.order.includes(id)) {
      const r = removeAndKeepTurn({ turn: C.turn, combatants: C.order.map((x) => ({ id: x })) }, id);
      C.turn = r.turn; C.order = r.combatants.map((c) => c.id);
    }
    this.dm.state.tokens = this.list.filter((x) => x.id !== id);
    for (const f of this.onRemove) f(id, t);
    if (emit) this.dm.emit();
  }

  /** Frees the scene side of one token. */
  disposeRefs(r) {
    if (!r) return;
    const dm = this.dm;
    if (r.item) {
      dm.grab?.remove?.(r.item); if (r.item.body) dm.physics?.world?.removeBody(r.item.body);
      if (dm.minis) dm.minis = dm.minis.filter((m) => m !== r.item);
      dm.heroMinis?.forget?.(r.item); dm.forge?.forget?.(r.item);
      disposeObject(r.item.mesh);
    }
    if (r.life) { if (dm.lifes) dm.lifes = dm.lifes.filter((l) => l !== r.life); disposeObject(r.life); }
  }

  /** Copies a PC token's HP back to its party sheet (the cards read the sheet). */
  syncChar(t) { if (t?.charId) { const ch = this.dm.state.party?.find((p) => p.id === t.charId); if (ch) { ch.hp = t.hp; ch.maxHp = t.maxHp; ch.ac = t.ac; ch.name = t.name; } } }

  /** Sets HP (clamped 0..max). */
  setHp(id, v) { return this.update(id, { hp: Math.max(0, Math.min(this.find(id)?.maxHp ?? 0, num(v, 0))) }); }
  /** Sets temp HP (>= 0). */
  setTempHp(id, v) { return this.update(id, { tempHp: Math.max(0, num(v, 0)) }); }

  /**
   * Adds HP: negative = damage (temp HP absorbs first), positive = heal; clamped 0..max.
   * PCs keep the SRD 0-HP rules (death saves, massive damage) while Rules assist is on.
   * @returns {{ before: object, after: object } | null}
   */
  applyHp(id, delta, { crit = false, emit = true } = {}) {
    const t = this.find(id); if (!t || !delta) return t ? { before: { ...t }, after: t } : null;
    const before = { ...t };
    let dmg = -delta;
    if (dmg > 0 && t.tempHp > 0) { const a = Math.min(t.tempHp, dmg); t.tempHp -= a; dmg -= a; }
    if (dmg !== 0) {
      const pcRules = t.kind === 'pc' && this.rulesAssist;
      const r = applyDamage({ ...t, side: pcRules ? 'pc' : 'monster' }, dmg, { crit });
      t.hp = r.hp; if (pcRules) t.deathSaves = r.deathSaves ?? t.deathSaves;
    }
    this.syncChar(t); if (emit) this.dm.emit();
    return { before, after: t };
  }

  /** Applies '-7' | '+3' | '=25' | '+5 temp'. Returns false when the expression is unreadable. */
  applyHpExpr(id, expr) {
    const p = parseHpExpr(expr); if (!p || !this.find(id)) return false;
    if (p.op === 'temp') this.setTempHp(id, p.value);
    else if (p.op === 'set') this.setHp(id, p.value);
    else this.applyHp(id, p.value);
    return true;
  }

  /** A death save for a PC token (SRD 5.2). */
  deathSave(id, d20) {
    const t = this.find(id); if (!t) return null;
    const r = rollDeathSave({ ...t, side: 'pc', deathSaves: t.deathSaves ?? freshDeathSaves() }, d20);
    t.hp = r.hp; t.deathSaves = r.deathSaves; this.syncChar(t); return t;
  }

  /** A copy next to the original (same stats, fresh HP state kept). */
  duplicate(id) { const t = this.find(id); return t ? this.spawn({ ...defOf(t), hp: t.hp })[0] : null; }

  /**
   * Removes many tokens. kind: one kind ('monster', 'pc', ...) or an array; where: a predicate. No filter = everything.
   */
  clear({ kind = null, where = null } = {}) {
    const kinds = kind == null ? null : [].concat(kind);
    for (const t of [...this.list]) if ((!kinds || kinds.includes(t.kind)) && (!where || where(t))) this.remove(t.id, { emit: false });
    this.dm.emit();
  }

  /** Saves a token's stats to "My creatures" (dm.state.savedDefs). */
  saveDef(id) {
    const t = this.find(id); if (!t) return null;
    const d = { ...defOf(t), defId: uid() };
    this.dm.state.savedDefs.push(d); this.dm.emit(); return d;
  }

  /** Current positions of minis into token.pos (before save / snapshot). */
  capturePositions() {
    for (const t of this.list) { const b = this.refs[t.id]?.item?.body; if (b) t.pos = [b.position.x, b.position.z]; }
  }

  /** Replaces every token with a saved list (load). Combat state is set by the caller. */
  restore(tokens) {
    this.clear();
    this.dm.state.tokens = [];
    Object.assign(this.combat, { order: [], active: false, round: 1, turn: 0 }); // the caller restores combat after
    for (const t of tokens || []) this.spawn(t, { id: t.id, emit: false, join: false });
  }
}
