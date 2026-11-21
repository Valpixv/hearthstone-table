// Pure combat-flow rules (initiative, turns, HP, conditions, death saves). No mutation of inputs.
// Rules from the System Reference Document 5.2 (CC-BY-4.0). Unit-tested in tests/unit/rules.test.js.

/** SRD 5.2 conditions with ring colours for the table. */
export const CONDITIONS = {
  blinded: '#9e9e9e', charmed: '#ff6fb5', deafened: '#8d6e63', exhaustion: '#795548', frightened: '#9c27b0',
  grappled: '#ff9800', incapacitated: '#607d8b', invisible: '#e0f7fa', paralyzed: '#ffeb3b', petrified: '#bdbdbd',
  poisoned: '#4caf50', prone: '#a1887f', restrained: '#ff5722', stunned: '#ffd54f', unconscious: '#263238',
  concentrating: '#40c4ff',
};

/**
 * Highest initiative first. Ties keep their current relative order (a stable sort).
 * SRD 5.2 has no DEX tiebreak: on a tie the DM decides between monsters and the players between PCs,
 * so the DM settles ties by dragging (see reorder).
 */
export function sortInitiative(list) {
  return [...list].sort((a, b) => (b.init ?? -99) - (a.init ?? -99));
}

/** Ticks timed conditions down for one creature; removes those that reach 0. (Legacy: ignores sourceId/ends.) */
export function tickConditions(c) {
  return { ...c, conditions: c.conditions.map((k) => (k.rounds == null ? k : { ...k, rounds: k.rounds - 1 })).filter((k) => k.rounds == null || k.rounds > 0) };
}

/**
 * Ticks condition durations at the start or end of actorId's turn (phase: 'start' | 'end').
 * SRD 5.2 "Durations": an effect lasting N rounds is counted on the turn of the creature that created it,
 * often "until the start/end of its next turn". A condition { name, rounds, sourceId, ends } is decremented
 * (and removed at 0) when phase === ends on sourceId's turn. With no sourceId it counts on its own creature's
 * turn, and with no ends it defaults to 'end', so a 1-round stun lasts through the creature's next turn.
 */
export function tickConditionsFor(combatants, actorId, phase) {
  return combatants.map((c) => {
    let changed = false;
    const conditions = [];
    for (const k of c.conditions ?? []) {
      if (k.rounds == null || (k.sourceId ?? c.id) !== actorId || (k.ends ?? 'end') !== phase) { conditions.push(k); continue; }
      changed = true;
      if (k.rounds - 1 > 0) conditions.push({ ...k, rounds: k.rounds - 1 });
    }
    return changed ? { ...c, conditions } : c;
  });
}

/**
 * Moves to the next creature that is not down (hp > 0); downed PCs still take their turn (death saves).
 * Wrapping past the last one starts a new round. Ends the old actor's turn ('end' tick), then starts the new one ('start' tick).
 */
export function advanceTurn(combat) {
  const list = combat.combatants, n = list.length;
  if (!n) return combat;
  const oldId = list[combat.turn]?.id;
  let turn = combat.turn, round = combat.round;
  for (let i = 0; i < n; i++) {
    turn += 1;
    if (turn >= n) { turn = 0; round += 1; }
    if (!isDown(list[turn]) || list[turn].side === 'pc') break;
  }
  let combatants = oldId != null ? tickConditionsFor(list, oldId, 'end') : list;
  combatants = tickConditionsFor(combatants, combatants[turn].id, 'start');
  return { ...combat, turn, round, combatants };
}

/** Index of the creature with the given id in a new list, or a fallback. */
const keepActiveIn = (list, id, fallback = 0) => { const i = list.findIndex((c) => c.id === id); return i >= 0 ? i : fallback; };

/** Removes a combatant and keeps the same creature active; if the active one is removed, the next in order is active. Round unchanged. */
export function removeAndKeepTurn(combat, id) {
  const list = combat.combatants, idx = list.findIndex((c) => c.id === id);
  if (idx < 0) return combat;
  const combatants = list.filter((_, i) => i !== idx);
  let turn = combat.turn;
  if (idx < turn) turn -= 1;
  if (turn >= combatants.length) turn = 0;
  return { ...combat, turn, combatants };
}

/** Sets a creature's initiative (typed or physically rolled), re-sorts, and keeps the active creature. */
export function setInitiative(combat, id, value) {
  const activeId = combat.combatants[combat.turn]?.id;
  // Move the changed creature to the end first so on a tie it lands after the existing creatures.
  const others = combat.combatants.filter((c) => c.id !== id), me = combat.combatants.find((c) => c.id === id);
  if (!me) return combat;
  const combatants = sortInitiative([...others, { ...me, init: value }]);
  return { ...combat, combatants, turn: keepActiveIn(combatants, activeId, combat.turn) };
}

/** Moves the creature at fromIdx to toIdx (DM drag), keeping the active creature. */
export function reorder(combat, fromIdx, toIdx) {
  const list = combat.combatants, n = list.length;
  if (fromIdx < 0 || fromIdx >= n || toIdx < 0 || toIdx >= n || fromIdx === toIdx) return combat;
  const activeId = list[combat.turn]?.id;
  const combatants = [...list];
  const [moved] = combatants.splice(fromIdx, 1);
  combatants.splice(toIdx, 0, moved);
  return { ...combat, combatants, turn: keepActiveIn(combatants, activeId, combat.turn) };
}

/** A fresh death-save track. */
export const freshDeathSaves = () => ({ success: 0, fail: 0, stable: false, dead: false });

const withFails = (c, ds, n) => {
  const fail = Math.min(3, ds.fail + n);
  return { ...c, deathSaves: { ...ds, fail, stable: false, dead: fail >= 3 } };
};

/**
 * SRD 5.2 "Dropping to 0 Hit Points" death saving throw: DC 10, no modifier. Nat 20 → 1 hp and saves reset;
 * nat 1 → two failures; three successes → stable; three failures → dead. Stable or dead PCs do not roll.
 */
export function rollDeathSave(c, d20) {
  const ds = c.deathSaves ?? freshDeathSaves();
  if (ds.dead || ds.stable || c.hp > 0) return c;
  if (d20 === 20) return { ...c, hp: 1, deathSaves: freshDeathSaves() };
  if (d20 === 1) return withFails(c, ds, 2);
  if (d20 < 10) return withFails(c, ds, 1);
  const success = Math.min(3, ds.success + 1);
  return { ...c, deathSaves: { ...ds, success, stable: success >= 3 } };
}

/** Damage to a PC already at 0 hp: one failure (two on a crit); a hit of at least max hp kills. Ends stability. */
export function damageAtZero(c, amount, crit = false) {
  const ds = c.deathSaves ?? freshDeathSaves();
  if (ds.dead || amount <= 0) return c;
  if (amount >= (c.maxHp ?? Infinity)) return { ...c, hp: 0, deathSaves: { ...ds, stable: false, dead: true } };
  return withFails({ ...c, hp: 0 }, ds, crit ? 2 : 1);
}

/**
 * Positive amounts damage, negative amounts heal; hp is kept within 0..maxHp.
 * PCs (side 'pc'): dropping to 0 starts death saves; massive damage (overflow past 0 >= maxHp) kills;
 * damage at 0 adds failures (opts.crit → two); healing above 0 resets the saves; the dead are not healed.
 * Monsters at 0 are just down.
 */
export function applyDamage(c, amount, opts = {}) {
  const hp = Math.min(c.maxHp ?? Infinity, Math.max(0, c.hp - amount));
  if (c.side !== 'pc') return { ...c, hp };
  if (c.deathSaves?.dead) return c;
  if (amount > 0 && c.hp <= 0) return damageAtZero(c, amount, !!opts.crit);
  if (amount > 0 && hp === 0) {
    const dead = amount - c.hp >= (c.maxHp ?? Infinity);
    return { ...c, hp, deathSaves: { ...freshDeathSaves(), dead } };
  }
  if (hp > 0 && c.deathSaves) return { ...c, hp, deathSaves: freshDeathSaves() };
  return { ...c, hp };
}

export const isDown = (c) => c.hp <= 0;

/** Adds a condition, or replaces the same condition with the new duration. extra: optional { sourceId, ends }. */
export function addCondition(c, name, rounds = null, extra = null) {
  return { ...c, conditions: [...c.conditions.filter((k) => k.name !== name), { name, rounds, ...(extra ?? {}) }] };
}
export function removeCondition(c, name) { return { ...c, conditions: c.conditions.filter((k) => k.name !== name) }; }

/** A damage roll waiting for the DM: { targetId, amount, type, crit, source }. */
export function makePendingDamage({ targetId, amount, type = null, crit = false, source = null }) {
  return { targetId, amount, type, crit: !!crit, source };
}

/** Final damage for a pending roll: override if given, else amount × multiplier (0.5 resistance, 2 vulnerability), floored, never below 0. */
export function resolvePending(pending, { multiplier = 1, override = null } = {}) {
  const v = override != null ? override : pending.amount * multiplier;
  return Math.max(0, Math.floor(v));
}
