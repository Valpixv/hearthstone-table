// Pure D&D 5e (SRD 5.2) roll maths. No three.js; unit-tested in tests/unit/rules.test.js.

/** Ability modifier: floor((score - 10) / 2). */
export const abilityMod = (score) => Math.floor((score - 10) / 2);

/** '2d6+3' → { count: 2, sides: 6, mod: 3 }. A bare number is a flat modifier. */
export function parseDice(str) {
  const s = String(str).replace(/\s+/g, '').toLowerCase();
  const m = s.match(/^(\d*)d(\d+)([+-]\d+)?$/);
  if (m) return { count: m[1] ? +m[1] : 1, sides: +m[2], mod: m[3] ? +m[3] : 0 };
  if (/^[+-]?\d+$/.test(s)) return { count: 0, sides: 0, mod: +s };
  throw new Error(`bad dice expression: ${str}`);
}

/**
 * A d20 test. faces: one d20, or two with advantage/disadvantage.
 * Attacks: a nat 20 always hits and crits, and a nat 1 always misses. Checks and saves: total >= DC.
 */
export function resolveD20({ faces, mod = 0, adv = null, target = null, kind = 'free' }) {
  // Two faces with no adv/dis (e.g. both cancelled) is a straight roll: keep the first face.
  const kept = faces.length > 1 && adv === 'dis' ? Math.min(...faces)
    : faces.length > 1 && adv === 'adv' ? Math.max(...faces) : faces[0];
  const total = kept + mod;
  const crit = kind === 'attack' && kept === 20, fumble = kind === 'attack' && kept === 1;
  let success = null;
  if (target != null) success = crit ? true : fumble ? false : total >= target;
  return { kept, total, crit, fumble, success, nat20: kept === 20, nat1: kept === 1 };
}

/** Damage dice for a hit. A critical hit doubles the dice, not the modifier. */
export function damageDiceFor(dice, crit = false) {
  const d = typeof dice === 'string' ? parseDice(dice) : dice;
  return { ...d, count: crit ? d.count * 2 : d.count };
}

/** Damage total; never below 0. */
export const sumDamage = (faces, mod = 0) => Math.max(0, faces.reduce((a, b) => a + b, 0) + mod);

/** Die type names the physical dice support. */
export const DIE_SIDES = { 4: 'd4', 6: 'd6', 8: 'd8', 10: 'd10', 12: 'd12', 20: 'd20' };

/**
 * Damage expression for a PC attack: the dice plus the ability modifier, unless attack.addMod === false
 * (SRD 5.2 cantrips such as Fire Bolt deal their dice only). '1d8' with STR 16 → '1d8+3'.
 */
export function attackDamageExpr(attack, abilityScore) {
  if (attack.addMod === false) return attack.dmg;
  const d = parseDice(attack.dmg), mod = d.mod + abilityMod(abilityScore);
  const base = d.count ? `${d.count}d${d.sides}` : '';
  if (!base) return String(mod);
  return mod ? `${base}${mod > 0 ? '+' : ''}${mod}` : base;
}

/** Damage parts of a monster action: the main damage, then the optional rider (extraDmg/extraType). → [{ dice, type }] */
export function actionDamageExprs(action) {
  const out = [{ dice: action.dmg, type: action.dmgType }];
  if (action.extraDmg) out.push({ dice: action.extraDmg, type: action.extraType ?? action.dmgType });
  return out;
}
