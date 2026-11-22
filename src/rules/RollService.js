import * as THREE from 'three';
import { parseDice, resolveD20, sumDamage, DIE_SIDES } from './roll.js';
import { TRAY, TABLE_TOP } from '../physics/Physics.js';
import { split, fromResults, roll as rollInstant, addDie } from './dicePool.js';
import { random } from '../core/random.js';

/**
 * '1d4+1+2d6' → { dice: [{ count: 1, sides: 4 }, { count: 2, sides: 6 }], mod: 1 }. A crit doubles every die count
 * (SRD 5.2: the dice, not the modifier). Used for monster riders (extraDmg) rolled together with the main dice.
 */
export function parseDamage(expr, crit = false) {
  const terms = String(expr).replace(/\s+/g, '').split(/(?=[+-])/).filter(Boolean);
  const dice = []; let mod = 0;
  for (const t of terms) {
    const neg = t.startsWith('-'), d = parseDice(t.replace(/^[+-]/, ''));
    if (d.count) dice.push({ count: (crit ? 2 : 1) * d.count, sides: d.sides });
    mod += (neg ? -1 : 1) * d.mod;
  }
  return { dice, mod };
}

/** Outcome words that do not rely on colour (UI 4). */
export function verdictText(kind, res) {
  if (kind === 'death') return res.nat20 ? '★ NAT 20: 1 HP' : res.nat1 ? '☠ NAT 1: TWO FAILS' : res.success ? '✔ SUCCESS' : '✖ FAIL';
  if (res.success == null) return '';
  if (kind === 'attack') return res.crit ? '★ CRIT' : res.fumble ? '☠ FUMBLE' : res.success ? '✔ HIT' : '✖ MISS';
  return res.success ? '✔ SUCCESS' : '✖ FAIL';
}

/**
 * Physical rolls with meaning. `roll(intent)` throws real dice; when every die of the group has
 * settled, it resolves the 5e outcome (d20 tests vs AC/DC, or damage) and reports it.
 *
 * intent: { kind: 'attack'|'check'|'save'|'damage'|'free'|'death'|'init', label, mod = 0, adv: 'adv'|'dis'|null,
 *           target: AC/DC|null, dice (damage only, e.g. '2d6+3' or '1d4+1+2d6'), crit (damage only),
 *           attackerId, targetId, damage: '1d8+3' (offered after a hit / failed target save), dmgType, source }
 *  - damage with a targetId becomes a pending chip for the DM (dm.damage(..., { pending: true }))
 *  - 'death': a DC 10 death save for combatant targetId; 'init': d20 + mod sets combatant targetId's initiative
 */
export class RollService {
  constructor({ dice, effects, dm, cinematic = null }) {
    Object.assign(this, { dice, effects, dm, cinematic });
    this.groups = new Map(); // die id → group
    this.onOutcome = null;   // (intent, result) → void
    this.poolDice = new Map(); // die id → { job, i } for dice-tray pool rolls
    this.loose = null;         // hand-thrown dice being grouped into one roll
    this.looseWindowMs = 2000; // dice settling within this of each other are one roll
    this.onLooseRoll = null;   // (roll) → void: the dice tray shows hand-thrown rolls
    this.onLooseDie = null;    // ({ sides, value }) → void: each hand-thrown die as it settles (a DM's call counts it)
    this.onAnnounce = null;    // ({ who, text, secret, roll }) → void: hook for table sync
    this.cleanupMs = 6000;     // tray dice are removed this long after they are read
    dm.rolls = this;         // the DM panel's "🎲 roll" initiative buttons use it
  }

  roll(intent) {
    if (this.dice.locked) return null;
    const isD20 = intent.kind !== 'damage';
    let types, mod = intent.mod || 0;
    if (intent.kind === 'death') { mod = 0; intent = { ...intent, adv: null, target: 10 }; }
    if (isD20) types = intent.adv ? ['d20', 'd20'] : ['d20'];
    else {
      const d = parseDamage(intent.dice, intent.crit);
      const bad = d.dice.find((x) => !DIE_SIDES[x.sides]);
      if (bad) throw new Error(`no physical d${bad.sides}`);
      types = d.dice.flatMap((x) => Array(x.count).fill(DIE_SIDES[x.sides])); mod += d.mod;
    }
    const group = { intent: { ...intent, mod }, faces: [], need: types.length, dice: [] };
    if (!types.length) { this.finish(group); return group; } // flat damage
    group.dice = this.dice.spawnGroup(types);
    group.dice.forEach((d) => this.groups.set(d.id, group));
    return group;
  }

  /**
   * Rolls a dicePool pool for the dice tray. Physical: real dice are thrown and read by die id when they settle
   * (d100 = two d10s; odd sizes roll digitally). Instant, or dice locked: a digital roll right away.
   * @param {object} pool dicePool pool
   * @param {{ physical?: boolean, secret?: boolean, onDone?: (roll: object) => void }} opts
   * @returns {object} the roll (instant) or the pending job (physical)
   */
  rollPool(pool, { physical = true, secret = false, onDone = null } = {}) {
    const sp = split(pool);
    if (!physical || this.dice.locked || !sp.physical.length) { const r = rollInstant(pool, random); onDone?.(r); return r; }
    const types = sp.physical.map((p) => `d${p.sides}`);
    const job = { pool, results: new Array(types.length), got: 0, onDone, dice: [] };
    job.dice = this.dice.spawnGroup(types);
    job.dice.forEach((d, i) => { d.secret = secret; this.poolDice.set(d.id, { job, i }); });
    return job;
  }

  finishPool(job) {
    let r;
    try { r = fromResults(job.pool, job.results, random); } catch (e) { console.warn('[rolls] unreadable dice, rolling instantly', e); r = rollInstant(job.pool, random); }
    setTimeout(() => job.dice.forEach((d) => { if (this.dice.dice.includes(d) && !this.dice.grab?.isHeld?.(d)) this.dice.remove(d); }), this.cleanupMs);
    job.onDone?.(r);
  }

  /** A loose (hand-thrown or clicked) die result: grouped with others settling within looseWindowMs into one roll. */
  collectLoose({ type, value }) {
    const sides = Number(String(type).slice(1));
    if (!sides) return;
    const face = sides === 10 && value === 0 ? 10 : value;
    try { this.onLooseDie?.({ sides, value: face }); } catch (e) { console.warn('[rolls] onLooseDie', e); }
    if (!this.onLooseRoll) return;
    const L = (this.loose ??= { faces: [] });
    L.faces.push({ sides, value: face });
    clearTimeout(L.timer);
    L.timer = setTimeout(() => this.flushLoose(), this.looseWindowMs);
  }

  flushLoose() {
    const L = this.loose; this.loose = null;
    if (!L?.faces.length) return;
    let r = rollInstant({ groups: [], mod: 0 }, random);
    for (const f of L.faces) r = addDie(r, f.sides, f.value, 'physical');
    const counts = {}; L.faces.forEach((f) => { counts[f.sides] = (counts[f.sides] || 0) + 1; });
    r = { ...r, label: 'Hand-thrown', expr: Object.entries(counts).map(([s, n]) => `${n}d${s}`).join(' + ') };
    this.onLooseRoll?.(r);
  }

  /** Removes this machine's loose dice from the tray: not part of a pending roll, not held in a hand. */
  clearLoose() {
    const D = this.dice;
    for (const d of [...(D.dice || [])]) if (!this.groups.has(d.id) && !this.poolDice.has(d.id) && !D.grab?.isHeld?.(d)) D.remove(d);
  }

  /**
   * A DM's call arrived: clears the loose dice and lays out the dice it needs, resting in the tray and unread
   * until they are thrown (grabbed and released, clicked, or Space). @param {string[]} types e.g. ['d6', 'd6']
   * @returns {object[]} the new dice
   */
  prepareHand(types) {
    if (this.dice.locked) return [];
    this.clearLoose();
    return types.map((t) => { const d = this.dice.spawn(t); d.rolling = false; return d; });
  }

  /** Called with every die result; returns true when it belonged to a tray roll or an intent group. Loose dice are grouped. */
  consume({ id, type, value }) {
    const pj = this.poolDice.get(id);
    if (pj) { this.poolDice.delete(id); pj.job.results[pj.i] = value; if (++pj.job.got === pj.job.results.length) this.finishPool(pj.job); return true; }
    const g = this.groups.get(id);
    if (!g) { this.collectLoose({ type, value }); return false; }
    this.groups.delete(id);
    g.faces.push(type === 'd10' && value === 0 ? 10 : value);
    if (g.faces.length === g.need) this.finish(g);
    return true;
  }

  finish(g) {
    const it = g.intent, sign = (n) => (n >= 0 ? `+ ${n}` : `− ${-n}`);
    let res, text;
    if (it.kind === 'damage') {
      const total = sumDamage(g.faces, it.mod);
      res = { total, crit: !!it.crit };
      text = `${it.label || 'Damage'}: ${g.faces.join('+') || '0'} ${sign(it.mod)} = ${total}${it.dmgType ? ` (${it.dmgType})` : ''}${it.crit ? ' ★ CRIT' : ''}${it.targetId != null ? ' → awaiting DM' : ''}`;
      // The DM decides: the roll becomes a pending chip (on a player's machine TableSync forwards it to the DM).
      if (it.targetId != null) this.dm.damage(it.targetId, total, { crit: !!it.crit, pending: true, type: it.dmgType ?? null, source: it.source ?? it.label ?? null });
    } else {
      const kind = it.kind === 'death' ? 'save' : it.kind === 'init' ? 'free' : it.kind;
      res = resolveD20({ faces: g.faces, mod: it.mod, adv: it.adv, target: it.target, kind });
      if ((it.kind === 'attack' || it.targetSaves) && it.attackerId != null) this.dm.combatMgr?.playAnim?.(it.attackerId, 'attack');
      const advTxt = it.adv ? ` [${g.faces.join(', ')} ${it.adv}]` : '';
      const verdict = verdictText(it.kind, res);
      text = `${it.label || it.kind}: ${res.kept} ${sign(it.mod)} = ${res.total}${it.target != null ? ` vs ${it.target}` : ''}${advTxt}${verdict ? ' ' + verdict : ''}`;
      const pos = this.labelPos(g);
      g.lastCrit = !!res.crit;
      if (res.crit && this.cinematic) this.cinematic.critMoment(pos);
      if (res.fumble) this.cinematic?.fumbleMoment?.(pos); // magma crack + shake
      if (it.kind === 'death' && it.targetId != null) this.dm.damage(it.targetId, 0, { deathSave: res.kept });
      if (it.kind === 'init' && it.targetId != null) this.dm.damage(it.targetId, 0, { initiative: res.total });
    }
    res.verdict = it.kind === 'damage' ? '' : verdictText(it.kind, res);
    const good = res.crit || res.success === true, bad = res.fumble || res.success === false;
    this.effects.label(text, this.labelPos(g).add(new THREE.Vector3(0, 0.08, 0)), { scale: 0.045, life: 4, glow: res.crit ? '#f3d58a' : good ? '#4fd17a' : bad ? '#c4321a' : '#ff8a3d' });
    this.dm.logRoll?.(text);
    this.onOutcome?.(it, res);
    it.onDone?.(res);
  }

  labelPos(g) {
    const d = g.dice.find((x) => x.mesh?.parent);
    return d ? d.mesh.position.clone() : new THREE.Vector3(TRAY.x, TABLE_TOP + 0.05, TRAY.z);
  }
}
