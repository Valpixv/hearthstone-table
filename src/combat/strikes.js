// The table's action loop (design/completion-plan.md §7). Pure: no three.js, no DOM.
//   1. The DM calls for a roll            → a `call` on a character            (state.calls)
//   2. The player throws dice              → the call is answered with a result
//   3. The DM confirms what it does        → a `strike`: damage or healing, armed (state.strikes)
//   4. The attacker makes a hand gesture   → the strike is released: the effect flies, and on impact the HP changes
// Nothing changes anyone's hit points before step 4. Every number stays editable by the DM on the way.
import CFG from '../data/tableDefaults.json';
import EFFECTS from '../data/effects.json';
import { ABILITY_NAMES, SKILLS, abilityMod, saveBonus, skillBonus, profBonus, spellAttackBonus, defaultSheet } from '../party/sheet.js';

export const STRIKE_CFG = CFG.strikes;
export const CALL_KINDS = { attack: 'Attack', save: 'Saving throw', check: 'Ability check', damage: 'Damage', init: 'Initiative', death: 'Death save', custom: 'Roll' };
const cap = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());
let seq = 0;
const uid = (p) => `${p}${Date.now().toString(36)}${(++seq).toString(36)}`;
const signed = (n) => (n ? (n > 0 ? `+${n}` : `${n}`) : '');

/**
 * The dice a call asks for, from the character's sheet: { expr, mod, label }.
 * @param {object} token the character
 * @param {{ kind: string, ability?: string, skill?: string, weapon?: number, expr?: string, adv?: 'adv'|'dis'|null }} c
 */
export function callDice(token, c) {
  const s = token?.sheet || defaultSheet(), d20 = c.adv === 'adv' ? '2d20kh1' : c.adv === 'dis' ? '2d20kl1' : '1d20';
  const w = c.weapon != null ? s.weapons?.[c.weapon] : null;
  let mod = 0, label = CALL_KINDS[c.kind] || 'Roll';
  switch (c.kind) {
    case 'save': mod = c.ability ? saveBonus(s, c.ability) : 0; label = `${ABILITY_NAMES[c.ability] || ''} save`.trim(); break;
    case 'check':
      if (c.skill && SKILLS[c.skill]) { mod = skillBonus(s, c.skill); label = cap(c.skill); }
      else { mod = c.ability ? abilityMod(s.abilities[c.ability]) : 0; label = `${ABILITY_NAMES[c.ability] || 'Ability'} check`; }
      break;
    case 'attack':
      if (w) { const m = String(w.bonus).match(/^[+-]?\d+$/); mod = m ? Number(w.bonus) : 0; label = `${w.name} attack`; }
      else if (c.ability === 'spell') { mod = spellAttackBonus(s) ?? 0; label = 'Spell attack'; }
      else { mod = (c.ability ? abilityMod(s.abilities[c.ability]) : Math.max(abilityMod(s.abilities.str), abilityMod(s.abilities.dex))) + profBonus(s.level); label = 'Attack'; }
      break;
    case 'init': mod = Number(token?.initBonus) || 0; label = 'Initiative'; break;
    case 'death': mod = 0; label = 'Death save'; break;
    case 'damage': return { expr: c.expr || w?.damage || '1d6', mod: 0, label: w ? `${w.name} damage` : 'Damage' };
    default: return { expr: c.expr || d20, mod: 0, label: c.label || 'Roll' };
  }
  return { expr: `${d20}${signed(mod)}`, mod, label };
}

/**
 * New calls, one per character asked.
 * @param {object[]} tokens every token (to find the characters)
 * @param {{ to: string[], kind: string, ability?: string, skill?: string, weapon?: number, expr?: string, dc?: number|null, showDc?: boolean,
 *   adv?: string|null, targetId?: string|null, label?: string, damageType?: string }} p
 * @returns {object[]}
 */
export function makeCalls(tokens, p, now = Date.now()) {
  const out = [];
  for (const id of [].concat(p.to || [])) {
    const t = tokens.find((x) => x.id === id); if (!t) continue;
    const dice = callDice(t, p);
    out.push({ id: uid('c'), to: id, kind: CALL_KINDS[p.kind] ? p.kind : 'custom', ability: p.ability || null, skill: p.skill || null, weapon: p.weapon ?? null,
      dc: p.dc === '' || p.dc == null ? null : Number(p.dc), showDc: !!p.showDc, adv: p.adv || null, targetId: p.targetId || null,
      damageType: p.damageType || null, expr: dice.expr, mod: dice.mod, label: p.label || dice.label, concentration: !!p.concentration, status: 'open', result: null, at: now });
  }
  return out;
}

/**
 * The verdict of an answered call with Rules assist: vs the target's AC (attack) or the DC (save / check).
 * @returns {{ success: boolean|null, crit: boolean, fumble: boolean, text: string }}
 */
export function judge(call, result, tokens = [], rulesAssist = true) {
  const nat = result.nat ?? null, total = Number(result.total) || 0;
  if (!rulesAssist) return { success: null, crit: false, fumble: false, text: '' };
  if (call.kind === 'attack') {
    const ac = tokens.find((t) => t.id === call.targetId)?.ac ?? null;
    if (nat === 20) return { success: true, crit: true, fumble: false, text: 'Critical hit' };
    if (nat === 1) return { success: false, crit: false, fumble: true, text: 'Miss (natural 1)' };
    if (ac == null) return { success: null, crit: false, fumble: false, text: '' };
    return total >= ac ? { success: true, crit: false, fumble: false, text: `Hit (AC ${ac})` } : { success: false, crit: false, fumble: false, text: `Miss (AC ${ac})` };
  }
  if (call.kind === 'death') {
    if (nat === 20) return { success: true, crit: true, fumble: false, text: 'Natural 20: back up with 1 HP' };
    if (nat === 1) return { success: false, crit: false, fumble: true, text: 'Natural 1: two failures' };
    return total >= 10 ? { success: true, crit: false, fumble: false, text: 'Success' } : { success: false, crit: false, fumble: false, text: 'Failure' };
  }
  if ((call.kind === 'save' || call.kind === 'check') && call.dc != null) {
    return total >= call.dc ? { success: true, crit: false, fumble: false, text: `Success (DC ${call.dc})` } : { success: false, crit: false, fumble: false, text: `Failure (DC ${call.dc})` };
  }
  return { success: null, crit: false, fumble: false, text: '' };
}

/**
 * Records a player's roll on a call. Returns the new calls list (unchanged when the call is unknown or already answered).
 * @param {{ total: number, nat?: number|null, text?: string }} result nat: the kept d20 face, when there was one
 */
export function answerCall(calls, id, result, tokens = [], rulesAssist = true) {
  return calls.map((c) => {
    if (c.id !== id || c.status !== 'open') return c;
    const r = { total: Number(result.total) || 0, nat: result.nat ?? null, text: String(result.text || '').slice(0, 200) };
    return { ...c, status: 'rolled', result: { ...r, verdict: judge(c, r, tokens, rulesAssist) } };
  });
}

/** Damage after resistance / vulnerability / immunity words on a token's sheet ("fire, cold"). @returns {{ amount, note }} */
export function adjustDamage(token, amount, damageType) {
  const s = token?.sheet, has = (list) => !!damageType && String(list || '').toLowerCase().split(/[,;]\s*/).map((x) => x.trim()).includes(String(damageType).toLowerCase());
  if (!s) return { amount, note: '' };
  if (has(s.immune)) return { amount: 0, note: 'immune' };
  if (has(s.resist)) return { amount: Math.floor(amount / 2), note: 'resistant' };
  if (has(s.vulnerable)) return { amount: amount * 2, note: 'vulnerable' };
  return { amount, note: '' };
}

/**
 * A confirmed strike, armed and waiting for the attacker's gesture.
 * @param {{ by: string|null, targets: { id: string, amount: number }[], damageType?: string|null, heal?: boolean, label?: string, crit?: boolean }} p
 */
export function makeStrike(p, now = Date.now()) {
  const targets = (p.targets || []).map((t) => ({ id: String(t.id), amount: Math.max(0, Math.floor(Number(t.amount)) || 0) })).filter((t) => t.id);
  if (!targets.length) return null;
  return { id: uid('s'), by: p.by || null, targets, damageType: p.damageType || null, heal: !!p.heal, crit: !!p.crit, label: String(p.label || '').slice(0, 60), status: 'armed', at: now };
}

/**
 * May this person release this strike? The owner of the attacking character, or the DM for anything.
 * @param {object} strike @param {string|null} clientId @param {boolean} isDM @param {object[]} tokens
 */
export function canRelease(strike, clientId, isDM, tokens = []) {
  if (!strike || strike.status !== 'armed') return false;
  if (isDM) return true;
  const by = tokens.find((t) => t.id === strike.by);
  return !!by && !!clientId && by.owner === clientId;
}

/** The effect a strike uses when the attacker has no gesture bound: by damage type (data), else the default. */
export function defaultEffect(strike) {
  if (strike?.heal) return STRIKE_CFG.healEffect;
  const id = STRIKE_CFG.byDamageType[strike?.damageType] || STRIKE_CFG.defaultEffect;
  return EFFECTS.effects[id] ? id : STRIKE_CFG.defaultEffect;
}

/** Seconds from release until the effect lands, so damage numbers appear with the impact. */
export function impactDelay(effectId, distance) {
  const e = EFFECTS.effects[effectId]; if (!e) return STRIKE_CFG.minImpactDelay;
  if (e.archetype === 'projectile') return Math.max(STRIKE_CFG.minImpactDelay, distance / (e.speed || 6) + ((e.count || 1) - 1) * 0.07);
  if (e.archetype === 'burst' && e.shape === 'meteor') return 0.7;
  return STRIKE_CFG.minImpactDelay;
}

/** Strikes that have waited longer than the timeout (the DM is offered "resolve now"). */
export const staleStrikes = (strikes, now = Date.now()) => (strikes || []).filter((s) => s.status === 'armed' && now - s.at > STRIKE_CFG.timeoutMs);
