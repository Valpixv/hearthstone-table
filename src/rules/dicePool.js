// Pure dice-pool logic for the free dice tray (design/flexibility-plan.md §4, §4a).
// No DOM, no three.js, no hidden randomness: every random draw comes from an injected rng() -> [0, 1).
// Every function is immutable: it returns a new pool / roll and never edits its input.
import { resolveD20 } from './roll.js';

/** Hard limits that keep a typo ("1000000d6") from freezing the tray. */
export const LIMITS = { maxCount: 1000, maxSides: 1000, minSides: 2 };

/** Die sizes that exist as physical dice in the tray. A d100 is thrown as two physical d10s. */
export const physicalSides = [4, 6, 8, 10, 12, 20];

/** True when a die of this size can be thrown physically (d4–d20, and d100 as two d10s). */
export const isPhysical = (sides) => physicalSides.includes(sides) || sides === 100;

const clonePool = (p) => {
  const out = { groups: p.groups.map((g) => ({ ...g, keep: g.keep ? { ...g.keep } : null })), mod: p.mod };
  if (p.label !== undefined) out.label = p.label;
  if (p.secret !== undefined) out.secret = p.secret;
  return out;
};

const TERM = /([+-])?(?:(\d*)d(\d+|%)(?:(k[hl]?)(\d+))?|(\d+))/y;

/**
 * Parse a dice expression into a pool.
 * Accepts '1d20 + 2d6 + 3', '4d6kh3', '2d20kl1' ('k3' = keep highest 3), 'd100' / 'd%', '3d4 - 1', 'd7',
 * several flat modifiers (summed), any whitespace and any case. A lone number is a flat pool ('0' = empty).
 * Subtracting dice ('-1d4') is not supported.
 * @param {string} expr
 * @returns {{groups: {count:number, sides:number, keep: null|{mode:'h'|'l', n:number}}[], mod:number}}
 * @throws {Error} with a message naming the problem.
 */
export function parse(expr) {
  if (typeof expr !== 'string') throw new Error('Dice expression must be a string');
  const s = expr.replace(/\s+/g, '').toLowerCase();
  if (!s) throw new Error('Dice expression is empty');
  // '2d6 3' must not silently become '2d63': two terms side by side need a sign between them.
  const gap = expr.match(/[0-9%]\s+([0-9d]\S*)/i);
  if (gap) throw new Error(`Missing + or - before "${gap[1]}" in "${expr}"`);
  const pool = { groups: [], mod: 0 };
  TERM.lastIndex = 0;
  let first = true;
  while (TERM.lastIndex < s.length) {
    const at = TERM.lastIndex;
    const m = TERM.exec(s);
    if (!m || m.index !== at || m[0] === '') throw new Error(`Can't read "${expr}" near "${s.slice(at)}"`);
    const [, sign, cnt, sides, kmode, kn, flat] = m;
    if (!first && !sign) throw new Error(`Missing + or - before "${m[0]}" in "${expr}"`);
    first = false;
    if (flat !== undefined) { pool.mod += (sign === '-' ? -1 : 1) * Number(flat); continue; }
    if (sign === '-') throw new Error(`Subtracting dice ("${m[0]}") is not supported`);
    const count = cnt === '' ? 1 : Number(cnt);
    const sd = sides === '%' ? 100 : Number(sides);
    if (count < 1 || count > LIMITS.maxCount) throw new Error(`Dice count must be 1–${LIMITS.maxCount} (got ${count})`);
    if (sd < LIMITS.minSides || sd > LIMITS.maxSides) throw new Error(`Die sides must be ${LIMITS.minSides}–${LIMITS.maxSides} (got d${sd})`);
    let keep = null;
    if (kmode) {
      const n = Number(kn);
      if (n < 1 || n > count) throw new Error(`Keep ${n} of ${count}d${sd} is impossible`);
      keep = { mode: kmode === 'kl' ? 'l' : 'h', n };
    }
    pool.groups.push({ count, sides: sd, keep });
  }
  return pool;
}

/**
 * Canonical expression for a pool: '1d20 + 4d6kh3 - 1'. Counts are always explicit; an empty pool is '0'.
 * parse(toExpr(p)) gives back the same groups and modifier.
 * @param {object} pool
 * @returns {string}
 */
export function toExpr(pool) {
  const parts = pool.groups.map((g) => `${g.count}d${g.sides}${g.keep ? `k${g.keep.mode}${g.keep.n}` : ''}`);
  let out = parts.join(' + ');
  if (pool.mod) out += out ? ` ${pool.mod < 0 ? '-' : '+'} ${Math.abs(pool.mod)}` : String(pool.mod);
  return out || '0';
}

/**
 * Click-to-build: add n dice of a size. Joins the last group of that size with no keep rule, otherwise
 * appends a new group.
 * @returns {object} a new pool
 */
export function add(pool, sides, n = 1) {
  if (!Number.isInteger(sides) || sides < LIMITS.minSides || sides > LIMITS.maxSides) throw new Error(`Bad die size: ${sides}`);
  const p = clonePool(pool);
  for (let i = p.groups.length - 1; i >= 0; i--) {
    const g = p.groups[i];
    if (g.sides === sides && !g.keep) { g.count = Math.min(LIMITS.maxCount, g.count + n); return p; }
  }
  p.groups.push({ count: n, sides, keep: null });
  return p;
}

/**
 * Click-to-build: remove one die of a size (from the last group of that size). An emptied group goes away;
 * a keep rule shrinks so it never keeps more dice than the group has. No die of that size: pool unchanged.
 * @returns {object} a new pool
 */
export function removeDie(pool, sides) {
  const p = clonePool(pool);
  for (let i = p.groups.length - 1; i >= 0; i--) {
    const g = p.groups[i];
    if (g.sides !== sides) continue;
    g.count -= 1;
    if (g.count <= 0) p.groups.splice(i, 1);
    else if (g.keep && g.keep.n > g.count) g.keep.n = g.count;
    return p;
  }
  return p;
}

/** Set the pool's flat modifier (rounded to an integer). @returns {object} a new pool */
export function setMod(pool, v) {
  const p = clonePool(pool);
  p.mod = Math.round(Number(v) || 0);
  return p;
}

/**
 * Split a pool into what the roller throws physically and what it rolls digitally.
 * A d100 becomes two physical d10 entries, part 'tens' then 'ones'. Odd sizes (d3, d7…) are digital.
 * @returns {{physical: {group:number, die:number, sides:number, part?:'tens'|'ones'}[], digital: {group:number, die:number, sides:number}[]}}
 */
export function split(pool) {
  const physical = [], digital = [];
  pool.groups.forEach((g, group) => {
    for (let die = 0; die < g.count; die++) {
      if (g.sides === 100) {
        physical.push({ group, die, sides: 10, part: 'tens' }, { group, die, sides: 10, part: 'ones' });
      } else if (physicalSides.includes(g.sides)) physical.push({ group, die, sides: g.sides });
      else digital.push({ group, die, sides: g.sides });
    }
  });
  return { physical, digital };
}

/**
 * Apply a keep rule to dice: returns the ids kept. Highest/lowest by value, ties go to the earlier die.
 * @param {{id:number, value:number}[]} dice
 * @param {'h'|'l'} mode
 * @param {number} n
 * @returns {Set<number>}
 */
export function keep(dice, mode, n) {
  const sorted = [...dice].sort((a, b) => (mode === 'l' ? a.value - b.value : b.value - a.value) || a.id - b.id);
  return new Set(sorted.slice(0, n).map((d) => d.id));
}

/** Total of a roll: kept dice plus the modifier. */
export function total(roll) {
  return roll.dice.reduce((a, d) => a + (d.dropped ? 0 : d.value), 0) + roll.mod;
}

/** Re-apply keep rules and recompute the total. Manually dropped dice stay dropped and don't count toward keep. */
function finalize(roll) {
  const dice = roll.dice.map((d) => ({ ...d, dropped: !!d.manualDrop }));
  roll.groups.forEach((g, gi) => {
    if (!g.keep) return;
    const live = dice.filter((d) => d.group === gi && !d.manualDrop);
    const kept = keep(live, g.keep.mode, g.keep.n);
    for (const d of live) d.dropped = !kept.has(d.id);
  });
  const out = { ...roll, dice };
  out.total = total(out);
  return out;
}

function baseRoll(pool) {
  return {
    dice: [], groups: pool.groups.map((g) => ({ ...g, keep: g.keep ? { ...g.keep } : null })),
    mod: pool.mod, total: 0, expr: toExpr(pool), label: pool.label ?? '', secret: !!pool.secret,
  };
}

const face = (rng, sides) => {
  const r = rng();
  if (typeof r !== 'number' || !(r >= 0 && r < 1)) throw new Error('rng() must return a number in [0, 1)');
  return 1 + Math.floor(r * sides);
};

/**
 * Roll a whole pool digitally ("instant"). Keep rules mark the losing dice as dropped.
 * @param {object} pool
 * @param {() => number} rng returns [0, 1)
 * @returns {{dice: {id:number, sides:number, value:number, dropped:boolean, group:number|null, source:'physical'|'digital'|'manual'}[], groups:object[], mod:number, total:number, expr:string, label:string, secret:boolean}}
 */
export function roll(pool, rng) {
  if (typeof rng !== 'function') throw new Error('roll() needs an rng function');
  const r = baseRoll(pool);
  let id = 0;
  pool.groups.forEach((g, group) => {
    for (let i = 0; i < g.count; i++) r.dice.push({ id: id++, sides: g.sides, value: face(rng, g.sides), dropped: false, group, source: 'digital' });
  });
  return finalize(r);
}

const checkFace = (v, sides) => {
  if (!Number.isInteger(v) || v < 1 || v > sides) throw new Error(`d${sides} result must be 1–${sides} (got ${v})`);
  return v;
};

/**
 * Combine a d100's two physical d10s. tens: 0–9 (face index, 0 = "00") or 10–90 (face label, 100 = "00");
 * ones: 0–9 (10 reads as 0). "00" + 0 = 100.
 */
export function d100From(tens, ones) {
  if (!Number.isInteger(tens) || !Number.isInteger(ones)) throw new Error('d100 parts must be integers');
  const t = tens < 10 ? tens * 10 : tens === 100 ? 0 : tens;
  if (t < 0 || t > 90 || t % 10) throw new Error(`Bad d100 tens die: ${tens}`);
  const o = ones === 10 ? 0 : ones;
  if (o < 0 || o > 9) throw new Error(`Bad d100 ones die: ${ones}`);
  return t + o || 100;
}

/**
 * Build a roll from physical die results. results follow split(pool).physical in order (a number, or
 * { value }); a d10 reading 0 counts as 10. Digital dice (d3, d7…) are drawn from rng.
 * @param {object} pool
 * @param {(number|{value:number})[]} results
 * @param {() => number} [rng] needed only if the pool has non-physical dice
 * @throws {Error} on a wrong number of results or an impossible face.
 */
export function fromResults(pool, results, rng) {
  const { physical, digital } = split(pool);
  if (results.length !== physical.length) throw new Error(`Expected ${physical.length} physical results, got ${results.length}`);
  if (digital.length && typeof rng !== 'function') throw new Error('This pool has non-physical dice: pass an rng');
  const vals = results.map((x) => (typeof x === 'object' && x ? x.value : x));
  const byKey = new Map();
  physical.forEach((p, i) => {
    const k = `${p.group}:${p.die}`;
    if (p.part === 'tens') byKey.set(k, { tens: vals[i] });
    else if (p.part === 'ones') byKey.set(k, d100From(byKey.get(k).tens, vals[i]));
    else byKey.set(k, checkFace(p.sides === 10 && vals[i] === 0 ? 10 : vals[i], p.sides));
  });
  const r = baseRoll(pool);
  let id = 0;
  pool.groups.forEach((g, group) => {
    for (let die = 0; die < g.count; die++) {
      const k = `${group}:${die}`;
      const phys = byKey.has(k);
      r.dice.push({ id: id++, sides: g.sides, value: phys ? byKey.get(k) : face(rng, g.sides), dropped: false, group, source: phys ? 'physical' : 'digital' });
    }
  });
  return finalize(r);
}

const findDie = (roll, id) => {
  const d = roll.dice.find((x) => x.id === id);
  if (!d) throw new Error(`No die with id ${id}`);
  return d;
};

const editDie = (roll, id, patch) => {
  findDie(roll, id);
  return finalize({ ...roll, dice: roll.dice.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
};

/** Reroll one die with a new value (thrown physically or digitally: pass the source). @returns a new roll */
export function rerollDie(roll, id, value, source = 'digital') {
  return editDie(roll, id, { value: checkFace(value, findDie(roll, id).sides), source });
}

/** Set one die's value by hand ("I rolled a 15 at home"); its source becomes 'manual'. @returns a new roll */
export function setDie(roll, id, value) {
  return editDie(roll, id, { value: checkFace(value, findDie(roll, id).sides), source: 'manual' });
}

/** Drop a die by hand. It stays dropped through later edits until undropDie. @returns a new roll */
export function dropDie(roll, id) { return editDie(roll, id, { manualDrop: true }); }

/** Undo a manual drop. A keep rule may still drop the die. @returns a new roll */
export function undropDie(roll, id) { return editDie(roll, id, { manualDrop: false }); }

/**
 * Append a die to an existing roll (the bonus d4 someone remembered). It belongs to no group, so no keep
 * rule touches it. @returns a new roll
 */
export function addDie(roll, sides, value, source = 'manual') {
  if (!Number.isInteger(sides) || sides < LIMITS.minSides || sides > LIMITS.maxSides) throw new Error(`Bad die size: ${sides}`);
  const id = roll.dice.reduce((m, d) => Math.max(m, d.id), -1) + 1;
  return finalize({ ...roll, dice: [...roll.dice, { id, sides, value: checkFace(value, sides), dropped: false, group: null, source }] });
}

/** Change a roll's flat modifier after the fact. @returns a new roll */
export function setRollMod(roll, v) {
  return finalize({ ...roll, mod: Math.round(Number(v) || 0) });
}

/**
 * Parse an HP field entry.
 *  '-7' → { op:'add', value:-7 } (damage)   '+3' → { op:'add', value:3 } (healing)
 *  '=25' → { op:'set', value:25 }            '+5 temp' → { op:'temp', value:5 }
 *  '12' (a bare number, no sign) → { op:'set', value:12 }: typing a number into an HP field sets it.
 * @throws {Error} on anything else.
 */
export function parseHpExpr(str) {
  const s = String(str ?? '').trim().toLowerCase();
  let m = s.match(/^\+?\s*(\d+)\s*(?:temp|tmp|thp)$/);
  if (m) return { op: 'temp', value: Number(m[1]) };
  m = s.match(/^=\s*(\d+)$/);
  if (m) return { op: 'set', value: Number(m[1]) };
  m = s.match(/^([+-])\s*(\d+)$/);
  if (m) return { op: 'add', value: (m[1] === '-' ? -1 : 1) * Number(m[2]) };
  m = s.match(/^(\d+)$/);
  if (m) return { op: 'set', value: Number(m[1]) };
  throw new Error(`Can't read HP entry "${str}" (try -7, +3, =25 or +5 temp)`);
}

/** The natural d20 of a roll: the first kept d20, or null. */
export function natD20(roll) {
  const d = roll.dice.find((x) => x.sides === 20 && !x.dropped);
  return d ? d.value : null;
}

/**
 * Rules-assist verdict (classic D&D). Advisory only: nothing is applied.
 *  attack: nat 20 = crit hit, nat 1 = miss, else total ≥ target (Defense).
 *  save / check: total ≥ target (DC).
 *  damage: amount = total, never below 0.
 *  death: nat 20 = regain 1 HP; nat 1 = two failures; else total ≥ 10 = one success, below = one failure.
 * @param {object} roll
 * @param {{tag:'attack'|'save'|'check'|'damage'|'death', target?:number}} opts
 */
export function verdict(roll, { tag, target = null } = {}) {
  const t = total(roll), nat = natD20(roll);
  if (tag === 'damage') return { tag, amount: Math.max(0, t), text: `${Math.max(0, t)} damage` };
  if (tag === 'death') {
    if (nat === 20) return { tag, nat, outcome: 'regain', successes: 0, failures: 0, hp: 1, text: 'Nat 20: regains 1 HP' };
    if (nat === 1) return { tag, nat, outcome: 'fail', successes: 0, failures: 2, text: 'Nat 1: two failures' };
    const ok = t >= 10;
    return { tag, nat, outcome: ok ? 'success' : 'fail', successes: ok ? 1 : 0, failures: ok ? 0 : 1, text: ok ? 'Success' : 'Failure' };
  }
  if (tag === 'attack' || tag === 'save' || tag === 'check') {
    if (nat == null) {
      const success = target == null ? null : t >= target;
      return { tag, nat, total: t, target, success, crit: false, fumble: false, text: success == null ? String(t) : success ? 'Success' : 'Fail' };
    }
    const r = resolveD20({ faces: [nat], mod: t - nat, target, kind: tag === 'attack' ? 'attack' : 'free' });
    const text = tag === 'attack'
      ? (r.crit ? 'Critical hit' : r.fumble ? 'Miss (nat 1)' : r.success == null ? String(t) : r.success ? 'Hit' : 'Miss')
      : (r.success == null ? String(t) : r.success ? 'Success' : 'Fail');
    return { tag, nat, total: t, target, success: r.success, crit: r.crit, fumble: r.fumble, text };
  }
  throw new Error(`Unknown verdict tag: ${tag}`);
}
