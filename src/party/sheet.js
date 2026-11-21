// Character sheet + inventory data (design/completion-plan.md §4). Pure: no three.js, no DOM.
// The sheet mirrors the D&D 2024 character sheet block for block. It lives on the PC token (token.sheet), the bag on
// token.inventory / token.coins; HP, AC and initiative bonus stay on the token itself (every creature has those).
// Every number is typed (or rolled) by the player; the app derives display values (modifiers, proficiency bonus, skill
// totals, spell DC) and suggests, never enforces.
import { random } from '../core/random.js';
import CLASSES from '../data/classes.json';
import ORIGINS from '../data/origins.json';

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
/** SRD 5.2 skills → their ability. */
export const SKILLS = {
  acrobatics: 'dex', 'animal handling': 'wis', arcana: 'int', athletics: 'str', deception: 'cha', history: 'int',
  insight: 'wis', intimidation: 'cha', investigation: 'int', medicine: 'wis', nature: 'int', perception: 'wis',
  performance: 'cha', persuasion: 'cha', religion: 'int', 'sleight of hand': 'dex', stealth: 'dex', survival: 'wis',
};
export const COINS = ['cp', 'sp', 'ep', 'gp', 'pp'];
/** Painted coin art for each coin (kit keys). */
export const COIN_ART = { cp: 'item/copper-coin', sp: 'item/silver-coin', ep: 'item/electrum-coin', gp: 'item/gold-coin', pp: 'item/platinum-coin' };
/** Max gesture → effect pairs per character. */
export const MAX_BINDINGS = 4;
export const MAX_ITEMS = 200;
export const MAX_ATTUNED = 3;
export const SIZES = ['Tiny', 'Small', 'Medium', 'Large'];
export const CLASS_IDS = Object.keys(CLASSES).filter((k) => !k.startsWith('_'));
export const SPECIES_IDS = Object.keys(ORIGINS.species);
export const BACKGROUND_IDS = Object.keys(ORIGINS.backgrounds);

const int = (v, d = 0, lo = -Infinity, hi = Infinity) => { const n = Math.round(Number(v)); return Number.isFinite(n) && v !== '' && v != null ? Math.min(hi, Math.max(lo, n)) : d; };
const str = (v, max = 400) => String(v ?? '').slice(0, max);
const list = (v, max, f) => (Array.isArray(v) ? v.slice(0, max).map(f) : []);
export const newId = (p = 'i') => `${p}${Math.floor(random() * 1e9).toString(36)}${Math.floor(random() * 1e4).toString(36)}`;

/** Ability modifier from a score. */
export const abilityMod = (score) => Math.floor((int(score, 10) - 10) / 2);
/** "+3" / "-1" / "+0". */
export const fmtMod = (n) => (n >= 0 ? `+${n}` : `${n}`);
/** Proficiency bonus by level (SRD: +2 at 1, +6 at 17). */
export const profBonus = (level) => 2 + Math.floor((int(level, 1, 1, 20) - 1) / 4);
/** Class id for a typed class name ("Wizard" → "wizard"), or null. */
export const classId = (name) => { const k = String(name ?? '').trim().toLowerCase(); return CLASS_IDS.find((id) => id === k || CLASSES[id].name.toLowerCase() === k) || null; };

/** A blank sheet (every field of the 2024 character sheet that is not already on the token). */
export function defaultSheet() {
  return {
    // header
    level: 1, xp: 0, cls: '', subclass: '', species: '', background: '', size: 'Medium', alignment: '',
    // core numbers
    speed: 30, abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, saves: {}, skills: {},
    heroicInspiration: false, shield: false, hitDice: { die: 8, spent: 0 },
    // page 1 boxes
    weapons: [], features: [], speciesTraits: [], feats: [],
    training: { light: false, medium: false, heavy: false, shields: false, weapons: '', tools: '' },
    // page 2
    castAbility: '', slots: {}, spells: [],
    appearance: '', backstory: '', languages: '', attuned: [],
    // table extras
    resources: [], exhaustion: 0, resist: '', vulnerable: '', immune: '', castBindings: [], portrait: null,
  };
}

const feat = (f) => ({ name: str(f?.name, 60), text: str(f?.text, 2000) });

/**
 * Cleans any sheet-like object into a sheet (unknown keys dropped, numbers clamped, lists capped). Idempotent.
 * Sheets from the first version (hitDice as "3d8", features only) are migrated.
 * @param {object} s
 */
export function normalizeSheet(s = {}) {
  const d = defaultSheet(), a = s.abilities || {}, tr = s.training || {};
  const level = int(s.level, d.level, 1, 20);
  // hitDice: { die, spent } (v2) or "3d8" (v1)
  let hd = s.hitDice;
  if (typeof hd === 'string') { const m = hd.match(/d(\d+)/i); hd = { die: m ? Number(m[1]) : d.hitDice.die, spent: 0 }; }
  const die = [6, 8, 10, 12].includes(int(hd?.die, 0)) ? int(hd.die) : (CLASSES[classId(s.cls)]?.hitDie || d.hitDice.die);
  const slots = {};
  for (let l = 1; l <= 9; l++) { const x = s.slots?.[l]; if (x && int(x.max, 0, 0, 9) > 0) { const max = int(x.max, 0, 0, 9); slots[l] = { max, used: int(x.used, 0, 0, max) }; } }
  return {
    level, xp: int(s.xp, 0, 0, 9999999), cls: str(s.cls, 40), subclass: str(s.subclass, 40), species: str(s.species, 40), background: str(s.background, 40),
    size: SIZES.includes(s.size) ? s.size : d.size, alignment: str(s.alignment, 30),
    speed: int(s.speed, d.speed, 0, 300),
    abilities: Object.fromEntries(ABILITIES.map((k) => [k, int(a[k], 10, 1, 30)])),
    saves: Object.fromEntries(ABILITIES.filter((k) => s.saves?.[k]).map((k) => [k, true])),
    skills: Object.fromEntries(Object.entries(s.skills || {}).filter(([k, v]) => SKILLS[k] && (v === 'prof' || v === 'exp'))),
    heroicInspiration: !!s.heroicInspiration, shield: !!s.shield,
    hitDice: { die, spent: int(hd?.spent, 0, 0, level) },
    weapons: list(s.weapons, 12, (w) => ({ name: str(w?.name, 40), bonus: str(w?.bonus, 12), damage: str(w?.damage, 24), type: str(w?.type, 20), notes: str(w?.notes, 120) })),
    features: list(s.features, 40, feat), speciesTraits: list(s.speciesTraits, 20, feat), feats: list(s.feats, 20, feat),
    training: { light: !!tr.light, medium: !!tr.medium, heavy: !!tr.heavy, shields: !!tr.shields, weapons: str(tr.weapons, 200), tools: str(tr.tools, 200) },
    castAbility: ABILITIES.includes(s.castAbility) ? s.castAbility : '',
    slots,
    spells: list(s.spells, 80, (f) => ({ name: str(f?.name, 60), level: int(f?.level, 0, 0, 9), castingTime: str(f?.castingTime, 24), range: str(f?.range, 24),
      conc: !!f?.conc, ritual: !!f?.ritual, material: !!f?.material, prepared: f?.prepared !== false, notes: str(f?.notes ?? f?.text, 2000) })),
    appearance: str(s.appearance, 1500), backstory: str(s.backstory, 4000), languages: str(s.languages, 300),
    attuned: list(s.attuned, MAX_ATTUNED, (x) => str(x, 60)).filter(Boolean),
    resources: list(s.resources, 20, (r) => { const max = int(r?.max, 1, 0, 999); return { name: str(r?.name, 40), max, used: int(r?.used, 0, 0, max) }; }),
    exhaustion: int(s.exhaustion, 0, 0, 6), resist: str(s.resist, 200), vulnerable: str(s.vulnerable, 200), immune: str(s.immune, 200),
    castBindings: normalizeBindings(s.castBindings),
    portrait: typeof s.portrait === 'string' && s.portrait.length < 300000 ? s.portrait : null,
  };
}

// ---------- derived numbers (display and dice modifiers; never enforced) ----------
/** Save bonus: ability mod (+ proficiency when proficient). */
export function saveBonus(sheet, ab) { return abilityMod(sheet.abilities[ab]) + (sheet.saves[ab] ? profBonus(sheet.level) : 0); }
/** Skill bonus: ability mod + proficiency (×2 for expertise). */
export function skillBonus(sheet, skill) {
  const p = sheet.skills[skill], pb = profBonus(sheet.level);
  return abilityMod(sheet.abilities[SKILLS[skill]]) + (p === 'exp' ? pb * 2 : p === 'prof' ? pb : 0);
}
export const passivePerception = (sheet) => 10 + skillBonus(sheet, 'perception');
/** Initiative bonus suggested by the sheet (Dexterity modifier). */
export const initiativeBonus = (sheet) => abilityMod(sheet.abilities.dex);
/** Spell save DC: 8 + proficiency + casting ability modifier (null without a casting ability). */
export const spellSaveDC = (sheet) => (sheet.castAbility ? 8 + profBonus(sheet.level) + abilityMod(sheet.abilities[sheet.castAbility]) : null);
/** Spell attack bonus: proficiency + casting ability modifier (null without a casting ability). */
export const spellAttackBonus = (sheet) => (sheet.castAbility ? profBonus(sheet.level) + abilityMod(sheet.abilities[sheet.castAbility]) : null);
/** Hit dice left to spend. */
export const hitDiceLeft = (sheet) => Math.max(0, sheet.level - sheet.hitDice.spent);
/** XP needed for the next level (null at 20). */
export const nextLevelXp = (level) => ORIGINS.xpByLevel[int(level, 1, 1, 20)] ?? null;

/**
 * AC the sheet suggests from equipped armor and the shield box: armor base + capped Dexterity, +2 with a shield;
 * unarmored 10 + Dexterity (Barbarian adds Constitution, Monk adds Wisdom). The typed AC on the token always wins.
 * @param {object} sheet @param {object[]} [inventory]
 */
export function suggestedAC(sheet, inventory = []) {
  const dex = abilityMod(sheet.abilities.dex), worn = inventory.find((x) => x.equipped && ORIGINS.armorAC[x.ref]);
  const shield = sheet.shield || inventory.some((x) => x.equipped && x.ref === 'shield');
  let ac;
  if (worn) { const a = ORIGINS.armorAC[worn.ref]; ac = a.base + Math.min(dex, a.dex); }
  else {
    const id = classId(sheet.cls);
    ac = 10 + dex + (id === 'barbarian' ? abilityMod(sheet.abilities.con) : id === 'monk' && !shield ? abilityMod(sheet.abilities.wis) : 0);
  }
  return ac + (shield ? 2 : 0);
}

/** Spell slots for a class and level from the SRD tables: { 1: { max, used: 0 }, … } ({} for non-casters). */
export function slotsFor(cls, level) {
  const row = ORIGINS.spellSlots[CLASSES[classId(cls)]?.caster]?.[int(level, 1, 1, 20) - 1] || [];
  const out = {}; row.forEach((n, i) => { if (n > 0) out[i + 1] = { max: n, used: 0 }; });
  return out;
}

/** The weapon row a weapon preset gives a character (attack bonus and damage from their scores). */
export function weaponRow(itemId, name, sheet) {
  const w = ORIGINS.weapons[itemId]; if (!w) return null;
  const [dice, type, ab] = w, s = abilityMod(sheet.abilities.str), dx = abilityMod(sheet.abilities.dex);
  const mod = ab === 'dex' ? dx : ab === 'fin' ? Math.max(s, dx) : s;
  return { name, bonus: fmtMod(mod + profBonus(sheet.level)), damage: mod ? `${dice}${mod > 0 ? '+' : ''}${mod}` : dice, type, notes: '' };
}

// ---------- building a character (stage 1) ----------
const bySkillList = (c) => (c.skills === 'any' ? Object.keys(SKILLS) : c.skills);

/**
 * Applies a class to a sheet: hit die, save proficiencies, training, level-1 features, resources, casting ability and slots.
 * Keeps the player's scores unless `scores` is true (then the class's suggested standard array is used).
 * @returns {{ sheet: object, ac: number, maxHp: number, gear: [string, number][], gold: number, model: string, skillPick: number, skillChoices: string[] }}
 */
export function applyClass(sheet, id, { scores = false } = {}) {
  const c = CLASSES[id]; if (!c) return null;
  const s = normalizeSheet({ ...sheet, cls: c.name, hitDice: { die: c.hitDie, spent: 0 }, abilities: scores ? c.abilities : sheet.abilities });
  s.saves = Object.fromEntries(c.saves.map((k) => [k, true]));
  s.training = { ...c.armor, weapons: c.weapons, tools: c.tools || '' };
  s.features = c.features.map((f) => ({ ...f }));
  s.resources = (c.resources || []).map((r) => ({ name: r.name, max: r.max, used: 0 }));
  s.castAbility = c.castAbility || '';
  s.slots = slotsFor(id, s.level);
  s.castBindings = normalizeBindings(Object.entries(c.gestures || {}).map(([gesture, effectId]) => ({ gesture, effectId })));
  s.weapons = c.attacks.map((a) => {
    const mod = abilityMod(s.abilities[a.ability]), add = a.addMod === false ? 0 : mod;
    return { name: a.name, bonus: a.save ? `DC ${8 + profBonus(s.level) + mod} ${a.save.toUpperCase()}` : fmtMod(mod + profBonus(s.level)), damage: add ? `${a.dmg}${add > 0 ? '+' : ''}${add}` : a.dmg, type: a.dmgType, notes: '' };
  });
  return { sheet: s, ac: c.ac, maxHp: Math.max(1, c.hitDie + abilityMod(s.abilities.con)), gear: c.gear || [], gold: c.gold || 0, model: c.model || 'fighter',
    skillPick: c.skillPick || 2, skillChoices: bySkillList(c) };
}

/** Applies a species: size, speed, languages and traits. */
export function applySpecies(sheet, id) {
  const sp = ORIGINS.species[id]; if (!sp) return null;
  return normalizeSheet({ ...sheet, species: sp.name, size: sp.size, speed: sp.speed, languages: sp.languages, speciesTraits: sp.traits.map((t) => ({ ...t })) });
}

/**
 * Applies a background: its two skills, its tool, its origin feat, and ability boosts (+2 to the listed ability the
 * player has highest, +1 to the next; pass `boosts` { ab: n } to choose).
 * @returns {{ sheet: object, gear: [string, number][], gold: number }}
 */
export function applyBackground(sheet, id, { boosts = null } = {}) {
  const b = ORIGINS.backgrounds[id]; if (!b) return null;
  const s = normalizeSheet({ ...sheet, background: b.name });
  for (const k of b.skills) if (!s.skills[k]) s.skills[k] = 'prof';
  if (!s.training.tools.includes(b.tool)) s.training = { ...s.training, tools: s.training.tools ? `${s.training.tools}, ${b.tool}` : b.tool };
  const f = ORIGINS.feats[b.feat]; if (f && !s.feats.some((x) => x.name === f.name)) s.feats = [...s.feats, { ...f }];
  const order = [...b.abilities].sort((x, y) => s.abilities[y] - s.abilities[x]);
  const add = boosts || { [order[0]]: 2, [order[1]]: 1 };
  for (const [k, n] of Object.entries(add)) if (b.abilities.includes(k)) s.abilities[k] = Math.min(20, s.abilities[k] + int(n, 0, 0, 2));
  return { sheet: s, gear: b.gear || [], gold: b.gold || 0 };
}

/** Six ability scores rolled as 4d6 drop lowest. rand() → [0,1). @returns {{ total: number, dice: number[] }[]} */
export function rollAbilityScores(rand = random) {
  return Array.from({ length: 6 }, () => {
    const dice = Array.from({ length: 4 }, () => 1 + Math.floor(rand() * 6));
    return { dice, total: dice.reduce((a, b) => a + b, 0) - Math.min(...dice) };
  });
}

/** Point-buy cost of a set of scores (Infinity when a score is outside 8–15). */
export function pointBuyCost(abilities) {
  const pb = ORIGINS.abilityMethods.pointBuy;
  return ABILITIES.reduce((n, k) => n + (pb.cost[abilities[k]] ?? Infinity), 0);
}
export const POINT_BUY = ORIGINS.abilityMethods.pointBuy;
export const STANDARD_ARRAY = ORIGINS.abilityMethods.standardArray;

/**
 * How finished a sheet is, for the DM's roster: { done, total, missing: [labels] }.
 * @param {object} token PC token (name, maxHp) with token.sheet
 */
export function completeness(token) {
  const s = token?.sheet || defaultSheet(), checks = [
    ['Name', !!String(token?.name || '').trim() && !/^adventurer$/i.test(token.name)],
    ['Class', !!s.cls], ['Species', !!s.species], ['Background', !!s.background],
    ['Ability scores', ABILITIES.some((k) => s.abilities[k] !== 10)],
    ['Skills', Object.keys(s.skills).length > 0],
    ['Hit points', (token?.maxHp ?? 0) > 0 && !!s.cls],
    ['Gestures', s.castBindings.length > 0],
  ];
  return { done: checks.filter((c) => c[1]).length, total: checks.length, missing: checks.filter((c) => !c[1]).map((c) => c[0]) };
}

/**
 * A long rest's changes to a sheet: hit dice back (up to half the level, at least 1), slots and resources restored,
 * exhaustion down by one. Pure; HP is restored by the caller on the token.
 */
export function longRest(sheet) {
  const s = normalizeSheet(sheet), back = Math.max(1, Math.floor(s.level / 2));
  s.hitDice = { ...s.hitDice, spent: Math.max(0, s.hitDice.spent - back) };
  for (const l of Object.keys(s.slots)) s.slots[l] = { ...s.slots[l], used: 0 };
  s.resources = s.resources.map((r) => ({ ...r, used: 0 }));
  s.exhaustion = Math.max(0, s.exhaustion - 1);
  return s;
}

/**
 * One level up (SRD): level + 1, hit points up by the hit die's average + Constitution modifier (at least 1; pass
 * `rolled` to use a rolled hit die instead), spell slots from the class table (used slots kept). Pure.
 * @returns {{ sheet: object, hpGain: number } | null} null at level 20
 */
export function levelUp(sheet, { rolled = null } = {}) {
  const s = normalizeSheet(sheet); if (s.level >= 20) return null;
  const con = abilityMod(s.abilities.con), die = s.hitDice.die;
  const hpGain = Math.max(1, (rolled != null ? int(rolled, 1, 1, die) : Math.floor(die / 2) + 1) + con);
  const fresh = slotsFor(s.cls, s.level + 1), slots = {};
  for (const [l, x] of Object.entries(fresh)) slots[l] = { max: x.max, used: Math.min(x.max, s.slots[l]?.used || 0) };
  return { sheet: normalizeSheet({ ...s, level: s.level + 1, slots: Object.keys(fresh).length ? slots : s.slots }), hpGain };
}
/** True when a character has the experience for the next level. */
export const canLevelUp = (sheet) => { const n = nextLevelXp(sheet?.level); return n != null && (sheet?.xp || 0) >= n; };

/**
 * Splits a pile of coins evenly among `n` people, denomination by denomination. Pure.
 * @returns {{ share: object, rest: object }} share: what each person gets; rest: what does not divide
 */
export function splitCoins(coins = {}, n = 1) {
  const share = {}, rest = {}, k = Math.max(1, Math.floor(n));
  for (const c of COINS) { const v = int(coins[c], 0, 0, 1e9); if (!v) continue; if (Math.floor(v / k)) share[c] = Math.floor(v / k); if (v % k) rest[c] = v % k; }
  return { share, rest };
}

/** Compat: fills a sheet from a classes.json entry. Returns { sheet, ac, maxHp }. */
export function fromClassTemplate(tpl, base = defaultSheet()) {
  const id = classId(tpl?.name) || CLASS_IDS.find((k) => CLASSES[k] === tpl);
  const r = applyClass(normalizeSheet(base), id, { scores: true });
  return r ? { sheet: r.sheet, ac: r.ac, maxHp: r.maxHp } : { sheet: normalizeSheet(base), ac: 10, maxHp: 10 };
}

// ---------- gesture bindings ----------
export const GESTURES = ['point', 'gun', 'palm', 'slash'];
export const GESTURE_LABELS = { point: 'Point & flick', gun: 'Finger gun', palm: 'Open palm push', slash: 'Slash' };
/** Signs that were renamed: old saved sheets keep their bindings. */
const GESTURE_RENAMED = { horns: 'slash' };

/** Up to 4 { gesture, effectId, label, roll } pairs, one per gesture (later duplicates dropped). */
export function normalizeBindings(list = []) {
  const seen = new Set(), out = [];
  for (const b0 of list || []) {
    const b = b0 && GESTURE_RENAMED[b0.gesture] ? { ...b0, gesture: GESTURE_RENAMED[b0.gesture] } : b0;
    if (!b || !GESTURES.includes(b.gesture) || seen.has(b.gesture) || !b.effectId) continue;
    seen.add(b.gesture);
    out.push({ gesture: b.gesture, effectId: str(b.effectId, 40), label: str(b.label, 40), roll: str(b.roll, 40) });
    if (out.length >= MAX_BINDINGS) break;
  }
  return out;
}

// ---------- inventory ----------
/** One inventory row. icon: { kind: 'preset', key } where key is a kit item slug (public/assets/kit/item/<key>.webp). */
export function normalizeItem(it = {}) {
  const icon = { kind: 'preset', key: str(it.icon?.key, 120) };
  return { id: str(it.id, 40) || newId(), ref: it.ref ? str(it.ref, 40) : null, name: str(it.name, 60) || 'Item', qty: int(it.qty, 1, 0, 9999),
    equipped: !!it.equipped, notes: str(it.notes, 500), icon };
}
export const normalizeInventory = (list = []) => (Array.isArray(list) ? list.slice(0, MAX_ITEMS).map(normalizeItem) : []);
export const normalizeCoins = (c = {}) => Object.fromEntries(COINS.map((k) => [k, int(c?.[k], 0, 0, 1e7)]));

/**
 * Adds an item; stacks onto a row with the same ref (or same name when there is no ref) and no notes.
 * @returns {object[]} new inventory
 */
export function addItem(inv, item, qty = 1) {
  const n = normalizeItem({ ...item, qty });
  const key = (x) => (x.ref || x.name.trim().toLowerCase());
  const i = inv.findIndex((x) => key(x) === key(n) && !x.notes && !n.notes);
  if (i >= 0) return inv.map((x, j) => (j === i ? { ...x, qty: x.qty + n.qty } : x));
  return [...inv, n];
}
/** Changes a row's qty by delta; a row at 0 is removed. */
export function changeQty(inv, id, delta) {
  return inv.map((x) => (x.id === id ? { ...x, qty: Math.max(0, x.qty + int(delta, 0)) } : x)).filter((x) => x.qty > 0);
}
export const removeItem = (inv, id) => inv.filter((x) => x.id !== id);
export const toggleEquip = (inv, id) => inv.map((x) => (x.id === id ? { ...x, equipped: !x.equipped } : x));
/** Edits a row's name / notes / icon / qty. */
export const editItem = (inv, id, patch) => inv.map((x) => (x.id === id ? normalizeItem({ ...x, ...patch, id: x.id }) : x));

/**
 * Moves qty of one row from one bag to another (give / loot). Unequips the moved copy.
 * @returns {{ from: object[], to: object[], moved: number }}
 */
export function transferItem(fromInv, toInv, id, qty = 1) {
  const src = fromInv.find((x) => x.id === id);
  if (!src) return { from: fromInv, to: toInv, moved: 0 };
  const moved = Math.min(src.qty, Math.max(1, int(qty, 1)));
  const copy = { ...src, id: newId(), equipped: false };
  return { from: changeQty(fromInv, id, -moved), to: addItem(toInv, copy, moved), moved };
}
