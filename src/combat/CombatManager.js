import MONSTERS from '../data/monsters.json';
import CLASSES from '../data/classes.json';
import { abilityMod, attackDamageExpr, actionDamageExprs } from '../rules/roll.js';
import { advanceTurn, isDown, addCondition, removeCondition, setInitiative,
  reorder, freshDeathSaves, makePendingDamage, resolvePending } from '../rules/combat.js';
import { random } from '../core/random.js';
import { playRole } from '../scene/AnimRegistry.js';
import { HeroMinis } from './HeroMinis.js';
import { TokenManager, templateDef, pcDef, MESH_FOR } from '../tokens/TokenManager.js';

export const MONSTER_IDS = Object.keys(MONSTERS).filter((k) => !k.startsWith('_'));
export const CLASS_IDS = Object.keys(CLASSES).filter((k) => !k.startsWith('_'));
export { MONSTERS, CLASSES, MESH_FOR };

/** Closest SRD stat block for a free-text prompt (AI Forge creatures). Falls back by keywords, then to 'bandit'. */
export function guessStat(prompt) {
  const p = String(prompt).toLowerCase();
  const direct = MONSTER_IDS.find((id) => p.includes(id.replace(/-/g, ' ')) || p.includes(MONSTERS[id].name.toLowerCase()));
  if (direct) return direct;
  const rules = [[/dragon|wyrm|drake/, 'young-red-dragon'], [/undead|bone|lich|ghost|corpse/, 'wight'], [/giant|brute|hulk|troll/, 'troll'],
    [/beast|bear|wolf|hound/, 'dire-wolf'], [/spider|insect/, 'giant-spider'], [/bull|minotaur/, 'minotaur'], [/cult|priest|mage|witch/, 'cultist'],
    [/small|imp|gremlin/, 'kobold'], [/orc|warrior|knight|soldier/, 'orc']];
  return (rules.find(([re]) => re.test(p)) || [null, 'bandit'])[1];
}

const uid = () => `c${Math.floor(random() * 1e9).toString(36)}`;

/**
 * Party, turn order and combat flow on top of tokens (design/flexibility-plan.md §3). Creatures are tokens in
 * dm.state.tokens (TokenManager); combat keeps only { active, round, turn, acted, order: [tokenId] }. Party sheets
 * (dm.state.party) carry class data; each character also has a 'pc' token.
 * Product rule: the DM decides, the app keeps the books. Rolled damage waits in `pending` until the DM confirms it.
 * SRD help (hit vs Defense, auto initiative, death saves) runs while dm.state.settings.rulesAssist is on (default).
 */
export class CombatManager {
  constructor({ dm, cinematic = null }) {
    Object.assign(this, { dm, cinematic });
    dm.state.party = dm.state.party || [];
    this.tokens = dm.tokens || new TokenManager({ dm, factory: typeof dm.makeTokenMeshes === 'function' ? (t, p) => dm.makeTokenMeshes(t, p) : null });
    this.pending = []; // damage rolls waiting for the DM: makePendingDamage(...) + { pid }
    this.tokens.onRemove.push((id) => { this.pending = this.pending.filter((p) => p.targetId !== id); });
    dm.combatMgr = this;
    if (dm.scene && dm.physics && dm.grab && typeof dm.on === 'function') this.heroes = new HeroMinis({ dm }); // PC token minis
    // Requests (pending damage, death saves, initiative) ride on dm.damage's opts. On a player's machine TableSync
    // replaces dm.damage with a request to the DM, whose onRequest calls combat.damage(...) with the same opts.
    const orig = typeof dm.damage === 'function' ? dm.damage.bind(dm) : null;
    dm.damage = (id, n, o) => (!orig || isRequest(o) ? this.damage(id, n, o) : orig(id, n, o));
  }

  get combat() { return this.tokens.combat; }
  get party() { return this.dm.state.party; }
  /** Scene objects by token id: { item, life }. */
  get refs() { return this.tokens.refs; }
  get rulesAssist() { return this.tokens.rulesAssist; }
  /** A token by id (or a PC token by its character id). */
  find(id) { return this.tokens.find(id) || (id != null ? this.tokens.byChar(id) : null); }
  /** Ordered combat tokens. */
  ordered() { return this.combat.order.map((id) => this.tokens.find(id)).filter(Boolean); }
  /** Makes sure every party character has a PC token (old saves, snapshots). */
  ensurePartyTokens() { for (const ch of this.party) if (!this.tokens.byChar(ch.id)) this.tokens.spawn(pcDef(ch), { emit: false }); }

  // ---- Party ----
  /** Creates a level-1 character from a class template (SRD 5.2) and its PC token. */
  addFromClass(cls, name) {
    const t = CLASSES[cls]; if (!t) return null;
    const maxHp = t.hitDie + abilityMod(t.abilities.con);
    const ch = { id: uid(), name: name || t.name, cls, level: 1, ac: t.ac, hp: maxHp, maxHp, abilities: { ...t.abilities }, prof: t.prof, attacks: t.attacks.map((a) => ({ ...a })), color: t.color, portrait: null };
    this.party.push(ch); this.tokens.spawn(pcDef(ch)); return ch;
  }
  removeChar(id) { const t = this.tokens.byChar(id); this.dm.state.party = this.party.filter((c) => c.id !== id); if (t) this.tokens.remove(t.id); else this.dm.emit(); }
  /** Changes a character's HP (positive heals). */
  hpChar(id, delta) {
    const t = this.tokens.byChar(id); if (t) return this.damage(t.id, -delta);
    const ch = this.party.find((c) => c.id === id); if (!ch) return;
    ch.hp = Math.min(ch.maxHp, Math.max(0, ch.hp + delta)); this.dm.emit();
  }

  /** Save modifier of a token for an ability. */
  saveMod(c, ability) {
    const ch = c?.charId ? this.party.find((p) => p.id === c.charId) : null;
    const score = ch?.abilities?.[ability] ?? c?.abilities?.[ability] ?? MONSTERS[c?.statId]?.abilities?.[ability];
    return score != null ? abilityMod(score) : 0;
  }

  /**
   * A roll intent for a character's attack against a token (or none). With Rules assist the target's Defense is the
   * hit threshold and save cantrips (attack.save) become a "Target saves" intent; without it the DM reads the roll.
   */
  attackIntent(charId, i, targetId = null) {
    const ch = this.party.find((c) => c.id === charId), a = ch?.attacks[i]; if (!a) return null;
    const m = abilityMod(ch.abilities[a.ability]), tgt = targetId ? this.find(targetId) : null, rules = this.rulesAssist;
    const damage = attackDamageExpr(a, ch.abilities[a.ability]), dmgType = a.dmgType || null;
    if (a.save && rules) {
      const dc = 8 + ch.prof + m;
      return { kind: 'save', targetSaves: true, saveAbility: a.save, label: `${tgt ? tgt.name : 'Target'} ${a.save.toUpperCase()} save vs ${ch.name} · ${a.name} (DC ${dc})`,
        mod: this.saveMod(tgt, a.save), target: dc, targetId, attackerId: charId, damage, dmgType, source: `${ch.name} · ${a.name}` };
    }
    return { kind: 'attack', label: `${ch.name} · ${a.name}`, mod: m + ch.prof, target: tgt && rules ? tgt.ac : null, targetId, attackerId: charId, damage, dmgType, source: `${ch.name} · ${a.name}` };
  }

  /** A roll intent for a templated monster's action against a token. A rider (extraDmg) is rolled with the main dice. */
  monsterIntent(id, i, targetId = null) {
    const c = this.find(id), s = MONSTERS[c?.statId], a = s?.actions[i]; if (!a) return null;
    const tgt = targetId ? this.find(targetId) : null, parts = actionDamageExprs(a);
    return { kind: 'attack', label: `${c.name} · ${a.name}`, mod: a.toHit, target: tgt && this.rulesAssist ? tgt.ac : null, targetId, attackerId: id,
      damage: parts.map((p) => p.dice).join('+'), dmgType: parts.map((p) => `${p.dice} ${p.type}`).join(' + '), source: `${c.name} · ${a.name}` };
  }

  monsterActions(c) { return MONSTERS[c?.statId]?.actions || []; }

  // ---- Monsters ----
  /** Spawns token(s) from an SRD template (an optional starting point). Life-size is off unless asked. */
  addMonster(statId, { life = true, name = null, count = 1 } = {}) {
    const d = templateDef(statId); if (!d) return null;
    const n = this.tokens.list.filter((t) => t.statId === statId).length;
    const out = this.tokens.spawn({ ...d, life, name: name || (n && count === 1 ? `${d.name} ${n + 1}` : d.name) }, { count });
    return count === 1 ? out[0] : out;
  }

  /** Compat: adds a token from an SRD stat block, optionally around already-built scene objects. */
  register({ name, statId, item = null, life = null, id = null }) {
    const d = templateDef(statId) || templateDef('bandit');
    return this.tokens.spawn({ ...d, statId, name, life: !!life }, { id, refs: item || life ? { item, life } : null })[0];
  }

  // ---- Combat flow ----
  d20() { return 1 + Math.floor(random() * 20); }

  /**
   * Starts round 1 with every non-item token. PCs roll their own initiative with physical dice (or the DM types it),
   * so they start at null. With Rules assist the rest roll one d20 + bonus per group (same template); otherwise null.
   */
  start() {
    this.ensurePartyTokens();
    const C = this.combat;
    for (const t of this.tokens.list) if (t.kind !== 'item' && !C.order.includes(t.id)) C.order.push(t.id);
    const groups = {};
    for (const t of this.ordered()) {
      if (t.kind === 'pc' && t.hp <= 0 && !t.deathSaves) t.deathSaves = freshDeathSaves();
      t.init = t.kind === 'pc' || !this.rulesAssist ? null : (groups[t.statId || t.name] ??= this.d20() + t.initBonus);
    }
    Object.assign(C, { active: true, round: 1, turn: 0, acted: false });
    this.tokens.sortOrder();
    this.dm.audio?.swordClash?.(); this.dm.narrate('Roll for initiative!');
    this.focusActive(); this.dm.emit();
  }
  /** Sets a creature's initiative (typed, or physically rolled). Until the first turn passes, the top of the order is active. */
  setInit(id, value) {
    const v = Number(value), t = this.find(id); if (!t || value === '' || value == null || !Number.isFinite(v)) return;
    this.tokens.combatOp((c) => setInitiative(c, t.id, v));
    if (!this.combat.acted) this.combat.turn = 0;
    this.dm.emit();
  }
  /** DM drag or ▲▼: moves a row, keeping the active creature. */
  reorder(fromIdx, toIdx) {
    this.tokens.combatOp((c) => reorder(c, fromIdx, toIdx));
    if (!this.combat.acted) this.combat.turn = 0;
    this.dm.emit();
  }
  /** PCs still waiting for an initiative number. */
  awaitingInit() { return this.combat.active ? this.ordered().filter((c) => c.kind === 'pc' && c.init == null) : []; }
  next() { if (!this.combat.active) return; this.tokens.combatOp((c) => advanceTurn(c)); this.combat.acted = true; this.focusActive(); this.dm.emit(); }
  end() { Object.assign(this.combat, { active: false, round: 1, turn: 0, acted: false }); this.tokens.list.forEach((c) => { c.init = null; }); this.cinematic?.setCinematic(false); this.dm.emit(); }
  active() { return this.combat.active ? this.tokens.find(this.combat.order[this.combat.turn]) : null; }
  /** In cinematic mode the camera eases to the active creature's life-size body. */
  focusActive() { if (!this.cineOn || !this.cinematic) return; const r = this.refs[this.active()?.id]; this.cinematic.setCinematic(true, r?.life ? r.life.position.clone().setY(1.2) : null); }
  setCinematic(on) { this.cineOn = on; if (on) this.focusActive(); else this.cinematic?.setCinematic(false); this.dm.emit(); }

  /**
   * Damage (or a negative heal) to a token; temp HP absorbs first, it topples at 0 HP and stands back up when healed.
   * The opts also carry requests on the same channel (TableSync forwards a player's dm.damage calls here):
   *  - pending: true → a pending damage chip for the DM instead of applying (with type, source)
   *  - deathSave: d20 face → a death saving throw for a PC at 0 HP
   *  - initiative: total → a physically rolled initiative
   */
  damage(id, amount, { crit = false, pending = false, type = null, source = null, deathSave = null, initiative = null } = {}) {
    if (deathSave != null) return this.deathSave(id, deathSave);
    if (initiative != null) return this.setInit(id, initiative);
    if (pending) return this.queueDamage(id, amount, { crit, type, source });
    const t = this.find(id); if (!t) return;
    const res = this.tokens.applyHp(t.id, -amount, { crit, emit: false }), c = res.before, now = res.after;
    const r = this.refs[t.id], pos = r?.item?.mesh?.position?.clone() || r?.life?.position?.clone().setY(1.8);
    if (pos && this.cinematic && amount) this.cinematic.damageNumber(pos.setY(pos.y + 0.08), Math.abs(amount), { crit, heal: amount < 0 });
    if (isDown(now) && !isDown(c)) this.down(now);
    else if (!isDown(now) && isDown(c)) this.standUp(now);
    else if (amount > 0 && !isDown(now)) this.playAnim(t.id, 'hit');
    if (now.deathSaves?.dead && !c.deathSaves?.dead) this.dm.narrate(`${now.name} is dead.`);
    this.dm.emit();
  }
  syncChar(c) { this.tokens.syncChar(c); }

  // ---- Pending damage: every rolled hit waits for the DM ----
  /** Queues a pending damage chip (Apply / Half / Double / Edit / Discard). */
  queueDamage(targetId, amount, { crit = false, type = null, source = null } = {}) {
    const p = { ...makePendingDamage({ targetId, amount, type, crit, source }), pid: uid() };
    this.pending.push(p); this.dm.emit(); return p;
  }
  /** Applies a pending roll: { multiplier: 0.5 resistance | 2 vulnerability } or { override: n }. */
  applyPending(pid, opts = {}) {
    const p = this.pending.find((x) => x.pid === pid); if (!p) return;
    this.pending = this.pending.filter((x) => x !== p);
    if (this.find(p.targetId)) this.damage(p.targetId, resolvePending(p, opts), { crit: p.crit });
    else this.dm.emit();
  }
  discardPending(pid) { this.pending = this.pending.filter((x) => x.pid !== pid); this.dm.emit(); }

  // ---- Death saves (SRD 5.2 "Dropping to 0 Hit Points") ----
  /** Applies a physical d20 death save to a PC at 0 HP; the result lives in token.deathSaves. */
  deathSave(id, d20) {
    const c = this.find(id); if (!this.needsDeathSave(c)) return;
    const now = this.tokens.deathSave(c.id, d20), ds = now.deathSaves;
    if (now.hp > 0) { this.standUp(now); this.dm.narrate(`${now.name} rallies with 1 HP!`); }
    else if (ds.dead) this.dm.narrate(`${now.name} is dead.`);
    else if (ds.stable) this.dm.narrate(`${now.name} is stable.`);
    this.dm.emit();
  }
  /** DM override on the pips: kind 'success' | 'fail', delta ±1. Three of either sets stable / dead. */
  adjustDeathSaves(id, kind, delta) {
    const t = this.find(id); if (!t || (kind !== 'success' && kind !== 'fail')) return;
    const ds = { ...(t.deathSaves ?? freshDeathSaves()) };
    ds[kind] = Math.max(0, Math.min(3, ds[kind] + delta));
    t.deathSaves = { ...ds, stable: ds.success >= 3 && ds.fail < 3, dead: ds.fail >= 3 };
    this.dm.emit();
  }
  /** True for a PC at 0 HP that must roll (not stable, not dead), while Rules assist is on. */
  needsDeathSave(c) { return !!c && c.kind === 'pc' && this.rulesAssist && c.hp <= 0 && !c.deathSaves?.stable && !c.deathSaves?.dead; }

  /** Scene roots that carry an animated model for a token: its mini and its life-size body. */
  animRoots(c) { const r = this.refs[c.id]; return [r?.item?.mesh, r?.life]; }
  /** Plays an animation role on a token (by token id, or a PC's charId as RollService intents carry). */
  playAnim(id, role) { const c = this.find(id); if (c) for (const root of this.animRoots(c)) playRole(root, role); }

  /** Puts a toppled mini back on its feet (upright, spinning only about Y) and shows its life-size body again. */
  standUp(c) {
    const r = this.refs[c.id];
    if (r?.item?.body) { const b = r.item.body; b.angularFactor.set(0, 1, 0); b.angularVelocity.set(0, 0, 0); b.quaternion.set(0, 0, 0, 1); b.wakeUp?.(); }
    if (r?.life) r.life.visible = true;
    this.playAnim(c.id, 'idle');
  }
  down(c) {
    const r = this.refs[c.id];
    // Model minis play their death clip; primitive minis topple. Model life-size bodies stay and die on screen.
    if (r?.item?.body && !r.item.mesh?.userData?.model) { r.item.body.angularFactor.set(1, 1, 1); r.item.body.angularVelocity.set(6, 0, 3); r.item.body.wakeUp(); }
    if (r?.life && !r.life.userData?.model) r.life.visible = false;
    this.playAnim(c.id, 'death');
    this.dm.narrate(c.kind !== 'pc' ? `${c.name} falls!` : `${c.name} is down!`);
  }
  /** Toggles a condition. Its duration counts on the turn of the active creature that applied it (SRD 5.2 "Durations"). */
  toggleCondition(id, name, rounds = null) {
    const c = this.find(id); if (!c) return;
    const sourceId = this.active()?.id ?? null;
    c.conditions = (c.conditions.some((k) => k.name === name) ? removeCondition(c, name) : addCondition(c, name, rounds, sourceId ? { sourceId } : null)).conditions;
    this.dm.emit();
  }
  removeCombatant(id) { const t = this.find(id); if (t) this.tokens.remove(t.id); }
  clearMonsters() { this.tokens.clear({ kind: ['monster', 'npc'] }); }
}

/** dm.damage opts that are requests for CombatManager rather than plain damage. */
const isRequest = (o) => !!o && (o.pending || o.deathSave != null || o.initiative != null);
