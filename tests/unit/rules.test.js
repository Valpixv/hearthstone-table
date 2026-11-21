import { describe, it, expect } from 'vitest';
import { abilityMod, parseDice, resolveD20, damageDiceFor, sumDamage, DIE_SIDES, attackDamageExpr, actionDamageExprs } from '../../src/rules/roll.js';
import { sortInitiative, advanceTurn, applyDamage, isDown, addCondition, removeCondition, tickConditions, CONDITIONS,
  tickConditionsFor, removeAndKeepTurn, rollDeathSave, damageAtZero, freshDeathSaves, makePendingDamage, resolvePending,
  setInitiative, reorder } from '../../src/rules/combat.js';
import { conditionReminders, CONDITION_REMINDERS } from '../../src/rules/reminders.js';
import monsters from '../../src/data/monsters.json';
import classes from '../../src/data/classes.json';

const mk = (o = {}) => ({ id: 'x', name: 'X', side: 'monster', ac: 12, hp: 10, maxHp: 10, dexMod: 0, init: 10, conditions: [], ...o });

describe('abilityMod', () => {
  it('follows floor((score - 10) / 2)', () => {
    expect([1, 8, 9, 10, 11, 12, 15, 20, 30].map(abilityMod)).toEqual([-5, -1, -1, 0, 0, 1, 2, 5, 10]);
  });
});

describe('parseDice', () => {
  it('parses NdM+K, dM and flat numbers', () => {
    expect(parseDice('2d6+3')).toEqual({ count: 2, sides: 6, mod: 3 });
    expect(parseDice('d20')).toEqual({ count: 1, sides: 20, mod: 0 });
    expect(parseDice('3d6-3')).toEqual({ count: 3, sides: 6, mod: -3 });
    expect(parseDice(' 1d8 + 2 ')).toEqual({ count: 1, sides: 8, mod: 2 });
    expect(parseDice('5')).toEqual({ count: 0, sides: 0, mod: 5 });
  });
  it('throws on garbage', () => { expect(() => parseDice('fireball')).toThrow(); });
});

describe('resolveD20', () => {
  it('advantage keeps the higher, disadvantage the lower', () => {
    expect(resolveD20({ faces: [4, 17], adv: 'adv' }).kept).toBe(17);
    expect(resolveD20({ faces: [4, 17], adv: 'dis' }).kept).toBe(4);
  });
  it('two faces with no adv/dis is a straight roll on the first face', () => {
    expect(resolveD20({ faces: [4, 17], adv: null }).kept).toBe(4);
  });
  it('attack: nat 20 always hits and crits, nat 1 always misses', () => {
    const hit = resolveD20({ faces: [20], mod: -5, target: 30, kind: 'attack' });
    expect(hit).toMatchObject({ crit: true, success: true, total: 15 });
    const miss = resolveD20({ faces: [1], mod: 30, target: 5, kind: 'attack' });
    expect(miss).toMatchObject({ fumble: true, success: false });
    expect(resolveD20({ faces: [12], mod: 3, target: 15, kind: 'attack' }).success).toBe(true);
    expect(resolveD20({ faces: [11], mod: 3, target: 15, kind: 'attack' }).success).toBe(false);
  });
  it('checks and saves: nat 20 / nat 1 are not automatic', () => {
    const save = resolveD20({ faces: [20], mod: 0, target: 25, kind: 'save' });
    expect(save).toMatchObject({ crit: false, success: false, nat20: true });
    const check = resolveD20({ faces: [1], mod: 10, target: 10, kind: 'check' });
    expect(check).toMatchObject({ fumble: false, success: true, nat1: true });
  });
  it('crit uses the kept die under disadvantage', () => {
    expect(resolveD20({ faces: [20, 3], adv: 'dis', kind: 'attack', target: 10 }).crit).toBe(false);
  });
  it('no target → success null', () => { expect(resolveD20({ faces: [10] }).success).toBeNull(); });
});

describe('damage', () => {
  it('crit doubles dice count, not the modifier', () => {
    expect(damageDiceFor('2d6+3', true)).toEqual({ count: 4, sides: 6, mod: 3 });
    expect(damageDiceFor('2d6+3', false)).toEqual({ count: 2, sides: 6, mod: 3 });
  });
  it('sumDamage never drops below 0', () => {
    expect(sumDamage([3, 4], 2)).toBe(9);
    expect(sumDamage([1], -3)).toBe(0);
  });
});

describe('combat flow', () => {
  it('sorts by init, highest first, and ties keep their current order with no DEX tiebreak', () => {
    const order = sortInitiative([
      mk({ id: 'm1', init: 12, dexMod: 1 }), mk({ id: 'p1', side: 'pc', init: 12, dexMod: 1 }),
      mk({ id: 'm2', init: 12, dexMod: 3 }), mk({ id: 'm3', init: 18 }), mk({ id: 'n', init: null }),
    ]).map((c) => c.id);
    expect(order).toEqual(['m3', 'm1', 'p1', 'm2', 'n']);
  });
  it('does not mutate its input', () => {
    const list = [mk({ id: 'a', init: 1 }), mk({ id: 'b', init: 2 })];
    sortInitiative(list);
    expect(list.map((c) => c.id)).toEqual(['a', 'b']);
  });
  it('advanceTurn wraps and increments the round, skipping downed monsters but not downed PCs', () => {
    const combat = { round: 1, turn: 0, active: true, combatants: [mk({ id: 'a' }), mk({ id: 'b', hp: 0 }), mk({ id: 'c', side: 'pc', hp: 0 })] };
    const t1 = advanceTurn(combat);
    expect([t1.turn, t1.round]).toEqual([2, 1]);
    const t2 = advanceTurn(t1);
    expect([t2.turn, t2.round]).toEqual([0, 2]);
  });
  it('a 1-round stun with no source lasts through the creature\'s next turn, then ends', () => {
    // Arrange: b stuns a during b's turn.
    let combat = { round: 1, turn: 1, combatants: [mk({ id: 'a' }), addCondition(mk({ id: 'b' }), 'prone')] };
    combat.combatants[0] = addCondition(combat.combatants[0], 'stunned', 1);
    // Act: b ends, a starts. Assert: still stunned for its turn.
    combat = advanceTurn(combat);
    expect(combat.turn).toBe(0);
    expect(combat.combatants[0].conditions).toEqual([{ name: 'stunned', rounds: 1 }]);
    // Act: a's turn ends. Assert: the stun is gone; untimed prone stays.
    combat = advanceTurn(combat);
    expect(combat.combatants[0].conditions).toEqual([]);
    expect(combat.combatants[1].conditions).toEqual([{ name: 'prone', rounds: null }]);
  });
  it('a 2-round poison drops after the creature\'s second turn ends', () => {
    let combat = { round: 1, turn: 1, combatants: [addCondition(mk({ id: 'a' }), 'poisoned', 2), mk({ id: 'b' })] };
    combat = advanceTurn(advanceTurn(combat));
    expect(combat.combatants[0].conditions).toEqual([{ name: 'poisoned', rounds: 1 }]);
    combat = advanceTurn(advanceTurn(combat));
    expect(combat.combatants[0].conditions).toEqual([]);
  });
  it('tickConditions leaves untimed conditions alone; add replaces, remove removes', () => {
    const c = addCondition(addCondition(mk(), 'stunned', 1), 'stunned', 3);
    expect(c.conditions).toEqual([{ name: 'stunned', rounds: 3 }]);
    expect(tickConditions(c).conditions).toEqual([{ name: 'stunned', rounds: 2 }]);
    expect(removeCondition(c, 'stunned').conditions).toEqual([]);
  });
  it('applyDamage clamps to 0..maxHp, heals with negatives, isDown at 0', () => {
    const c = mk({ hp: 5, maxHp: 10 });
    expect(applyDamage(c, 8).hp).toBe(0);
    expect(isDown(applyDamage(c, 8))).toBe(true);
    expect(applyDamage(c, -20).hp).toBe(10);
    expect(c.hp).toBe(5);
    expect(applyDamage({ hp: 5, conditions: [] }, -3).hp).toBe(8);
  });
  it('CONDITIONS lists the SRD 5.2 conditions', () => {
    for (const k of ['blinded', 'charmed', 'deafened', 'exhaustion', 'frightened', 'grappled', 'incapacitated', 'invisible',
      'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious']) expect(CONDITIONS[k]).toMatch(/^#/);
  });
});

describe('condition durations (tickConditionsFor)', () => {
  it('ticks a sourced condition on the source\'s matching phase only', () => {
    // Arrange: w holds a until the end of w's next turn; b frightens a until the start of b's next turn.
    const a = { ...mk({ id: 'a' }), conditions: [
      { name: 'restrained', rounds: 1, sourceId: 'w', ends: 'end' },
      { name: 'frightened', rounds: 1, sourceId: 'b', ends: 'start' },
    ] };
    const list = [a, mk({ id: 'w' }), mk({ id: 'b' })];
    // Act / Assert
    expect(tickConditionsFor(list, 'a', 'end')[0].conditions).toHaveLength(2);
    expect(tickConditionsFor(list, 'w', 'start')[0].conditions).toHaveLength(2);
    expect(tickConditionsFor(list, 'w', 'end')[0].conditions.map((k) => k.name)).toEqual(['frightened']);
    expect(tickConditionsFor(list, 'b', 'start')[0].conditions.map((k) => k.name)).toEqual(['restrained']);
  });
  it('leaves untimed conditions alone and does not mutate its input', () => {
    const list = [addCondition(mk({ id: 'a' }), 'prone')];
    const out = tickConditionsFor(list, 'a', 'end');
    expect(out[0].conditions).toEqual([{ name: 'prone', rounds: null }]);
    expect(out).not.toBe(list);
  });
  it('advanceTurn ends a condition another creature imposed when that creature\'s turn ends', () => {
    const a = { ...mk({ id: 'a' }), conditions: [{ name: 'restrained', rounds: 1, sourceId: 'b', ends: 'end' }] };
    const combat = advanceTurn({ round: 1, turn: 1, combatants: [a, mk({ id: 'b' })] });
    expect(combat.combatants[0].conditions).toEqual([]);
  });
});

describe('removeAndKeepTurn', () => {
  const combat = () => ({ round: 3, turn: 2, combatants: ['a', 'b', 'c', 'd'].map((id) => mk({ id })) });
  const active = (c) => c.combatants[c.turn].id;
  it('removing a creature earlier in the order keeps the same creature active', () => {
    const out = removeAndKeepTurn(combat(), 'a');
    expect([active(out), out.round]).toEqual(['c', 3]);
  });
  it('removing a creature later in the order keeps the same creature active', () => {
    expect(active(removeAndKeepTurn(combat(), 'd'))).toBe('c');
  });
  it('removing the active creature passes the turn to the next one in the same round', () => {
    const out = removeAndKeepTurn(combat(), 'c');
    expect([active(out), out.round]).toEqual(['d', 3]);
  });
  it('removing the active last creature wraps to the first without changing the round', () => {
    const out = removeAndKeepTurn({ ...combat(), turn: 3 }, 'd');
    expect([active(out), out.round]).toEqual(['a', 3]);
  });
  it('removing an unknown id or the only creature is safe', () => {
    expect(removeAndKeepTurn(combat(), 'zz').combatants).toHaveLength(4);
    expect(removeAndKeepTurn({ round: 1, turn: 0, combatants: [mk({ id: 'a' })] }, 'a')).toMatchObject({ turn: 0, combatants: [] });
  });
});

describe('initiative with real dice', () => {
  const combat = () => ({ round: 1, turn: 1, combatants: [mk({ id: 'a', init: 18 }), mk({ id: 'b', init: 12 }), mk({ id: 'c', init: 5 })] });
  const active = (c) => c.combatants[c.turn].id;
  it('setInitiative re-sorts and keeps the active creature', () => {
    const out = setInitiative(combat(), 'c', 20);
    expect(out.combatants.map((c) => c.id)).toEqual(['c', 'a', 'b']);
    expect(out.combatants[0].init).toBe(20);
    expect(active(out)).toBe('b');
  });
  it('setInitiative into a tie keeps the existing relative order', () => {
    expect(setInitiative(combat(), 'c', 18).combatants.map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });
  it('reorder moves a creature (DM drag) and keeps the active creature', () => {
    const out = reorder(combat(), 2, 0);
    expect(out.combatants.map((c) => c.id)).toEqual(['c', 'a', 'b']);
    expect(active(out)).toBe('b');
  });
  it('reorder with an out-of-range index changes nothing', () => {
    expect(reorder(combat(), 5, 0).combatants.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('death saves', () => {
  const downed = (o = {}) => mk({ id: 'p', side: 'pc', hp: 0, maxHp: 12, deathSaves: freshDeathSaves(), ...o });
  it('a roll of 10 or more is a success; below 10 is a failure', () => {
    expect(rollDeathSave(downed(), 10).deathSaves).toMatchObject({ success: 1, fail: 0 });
    expect(rollDeathSave(downed(), 9).deathSaves).toMatchObject({ success: 0, fail: 1 });
  });
  it('a nat 20 brings the PC back with 1 hp and resets the saves', () => {
    const out = rollDeathSave(downed({ deathSaves: { success: 1, fail: 2, stable: false, dead: false } }), 20);
    expect(out.hp).toBe(1);
    expect(out.deathSaves).toEqual(freshDeathSaves());
  });
  it('a nat 1 counts as two failures', () => {
    expect(rollDeathSave(downed(), 1).deathSaves.fail).toBe(2);
  });
  it('three successes make the PC stable; three failures kill', () => {
    let c = downed();
    for (let i = 0; i < 3; i++) c = rollDeathSave(c, 15);
    expect(c.deathSaves.stable).toBe(true);
    let d = downed();
    for (let i = 0; i < 3; i++) d = rollDeathSave(d, 5);
    expect(d.deathSaves.dead).toBe(true);
  });
  it('a stable or dead PC does not roll', () => {
    const s = downed({ deathSaves: { success: 3, fail: 0, stable: true, dead: false } });
    expect(rollDeathSave(s, 5)).toEqual(s);
  });
  it('damage at 0 is one failure, two on a crit, and ends stability', () => {
    expect(damageAtZero(downed(), 3, false).deathSaves.fail).toBe(1);
    expect(damageAtZero(downed(), 3, true).deathSaves.fail).toBe(2);
    const s = damageAtZero(downed({ deathSaves: { success: 3, fail: 0, stable: true, dead: false } }), 1, false);
    expect(s.deathSaves).toMatchObject({ stable: false, fail: 1 });
  });
  it('damage at 0 equal to max hp kills outright', () => {
    expect(damageAtZero(downed(), 12, false).deathSaves.dead).toBe(true);
  });
  it('applyDamage: massive damage (overflow at least max hp) kills a PC', () => {
    const p = mk({ id: 'p', side: 'pc', hp: 5, maxHp: 12 });
    expect(applyDamage(p, 17).deathSaves.dead).toBe(true);
    const alive = applyDamage(p, 16);
    expect(alive.hp).toBe(0);
    expect(alive.deathSaves).toEqual(freshDeathSaves());
  });
  it('applyDamage on a PC already at 0 adds failures (two with the crit option)', () => {
    expect(applyDamage(downed(), 2).deathSaves.fail).toBe(1);
    expect(applyDamage(downed(), 2, { crit: true }).deathSaves.fail).toBe(2);
  });
  it('healing above 0 resets the saves', () => {
    const out = applyDamage(downed({ deathSaves: { success: 2, fail: 2, stable: false, dead: false } }), -4);
    expect(out.hp).toBe(4);
    expect(out.deathSaves).toEqual(freshDeathSaves());
  });
  it('a dead PC is not healed', () => {
    const dead = downed({ deathSaves: { success: 0, fail: 3, stable: false, dead: true } });
    expect(applyDamage(dead, -10).hp).toBe(0);
  });
  it('monsters at 0 are just down, with no death saves', () => {
    const m = applyDamage(mk({ hp: 5, maxHp: 10 }), 100);
    expect(m.hp).toBe(0);
    expect(m.deathSaves).toBeUndefined();
  });
});

describe('pending damage', () => {
  const p = () => makePendingDamage({ targetId: 'g1', amount: 9, type: 'fire', crit: true, source: 'w' });
  it('makePendingDamage keeps the fields', () => {
    expect(p()).toEqual({ targetId: 'g1', amount: 9, type: 'fire', crit: true, source: 'w' });
  });
  it('resolvePending applies the DM multiplier and rounds down', () => {
    expect(resolvePending(p())).toBe(9);
    expect(resolvePending(p(), { multiplier: 0.5 })).toBe(4);
    expect(resolvePending(p(), { multiplier: 2 })).toBe(18);
    expect(resolvePending(p(), { multiplier: 0 })).toBe(0);
  });
  it('an override wins over the multiplier', () => {
    expect(resolvePending(p(), { multiplier: 2, override: 3 })).toBe(3);
  });
});

describe('damage expressions', () => {
  it('weapon attacks add the ability modifier', () => {
    expect(attackDamageExpr({ dmg: '1d8' }, 16)).toBe('1d8+3');
    expect(attackDamageExpr({ dmg: '1d4' }, 8)).toBe('1d4-1');
    expect(attackDamageExpr({ dmg: '1d6' }, 10)).toBe('1d6');
  });
  it('cantrips with addMod false do not add the modifier', () => {
    expect(attackDamageExpr({ dmg: '1d10', addMod: false }, 18)).toBe('1d10');
  });
  it('Fire Bolt from classes.json does not add the modifier', () => {
    const fb = classes.wizard.attacks.find((a) => a.name === 'Fire Bolt');
    expect(attackDamageExpr(fb, classes.wizard.abilities.int)).toBe('1d10');
  });
  it('actionDamageExprs lists the main damage, then any rider', () => {
    expect(actionDamageExprs({ dmg: '1d8+3', dmgType: 'piercing', extraDmg: '2d6', extraType: 'poison' }))
      .toEqual([{ dice: '1d8+3', type: 'piercing' }, { dice: '2d6', type: 'poison' }]);
    expect(actionDamageExprs({ dmg: '1d6+2', dmgType: 'slashing' })).toEqual([{ dice: '1d6+2', type: 'slashing' }]);
  });
  it('the Giant Spider bite carries a poison rider', () => {
    expect(actionDamageExprs(monsters['giant-spider'].actions[0]).map((d) => d.type)).toEqual(['piercing', 'poison']);
  });
});

describe('condition reminders', () => {
  it('returns a short reminder for each known condition and skips unknown ones', () => {
    const out = conditionReminders(['prone', 'nonsense', 'poisoned']);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/Advantage/);
  });
  it('covers every SRD 5.2 condition', () => {
    for (const k of Object.keys(CONDITIONS).filter((k) => k !== 'concentrating')) expect(CONDITION_REMINDERS[k]).toBeTruthy();
  });
  it('accepts condition objects as well as names', () => {
    expect(conditionReminders([{ name: 'stunned', rounds: 1 }])).toHaveLength(1);
  });
});

describe('data files', () => {
  const physical = new Set(Object.keys(DIE_SIDES).map(Number));
  const checkDice = (s) => { const d = parseDice(s); expect(d.count).toBeGreaterThan(0); expect(physical.has(d.sides)).toBe(true); };

  it('every monster has the contract shape and parseable physical-dice damage', () => {
    const ids = Object.keys(monsters).filter((k) => !k.startsWith('_'));
    expect(ids.length).toBeGreaterThanOrEqual(20);
    expect(monsters._attribution).toMatch(/CC-BY-4.0/);
    for (const id of ids) {
      const m = monsters[id];
      expect(m).toMatchObject({ name: expect.any(String), ac: expect.any(Number), hp: expect.any(Number), speed: expect.any(Number), cr: expect.any(String) });
      checkDice(m.hpDice);
      expect(Object.keys(m.abilities).sort()).toEqual(['cha', 'con', 'dex', 'int', 'str', 'wis']);
      expect(m.actions.length).toBeGreaterThan(0);
      expect(m.actions.length).toBeLessThanOrEqual(2);
      for (const a of m.actions) {
        expect(typeof a.toHit).toBe('number'); checkDice(a.dmg); expect(a.dmgType).toBeTruthy();
        if (a.extraDmg) { expect(() => parseDice(a.extraDmg)).not.toThrow(); expect(a.extraType).toBeTruthy(); }
      }
      if (m.source) expect(m.source).toMatch(/CC-BY-4.0/);
    }
  });

  it('every class has the contract shape and parseable physical-dice damage', () => {
    const ids = Object.keys(classes).filter((k) => !k.startsWith('_'));
    expect(ids.sort()).toEqual(['barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk', 'paladin', 'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard']); // all 12 SRD classes
    for (const id of ids) {
      const c = classes[id];
      expect([6, 8, 10, 12]).toContain(c.hitDie);
      expect(Object.values(c.abilities).sort((a, b) => a - b)).toEqual([8, 10, 12, 13, 14, 15]);
      expect(c.hitDie + abilityMod(c.abilities.con)).toBeGreaterThan(0);
      for (const a of c.attacks) { expect(c.abilities[a.ability]).toBeDefined(); checkDice(a.dmg); }
    }
    for (const [cls, name] of [['wizard', 'Fire Bolt'], ['cleric', 'Sacred Flame'], ['bard', 'Vicious Mockery']]) {
      expect(classes[cls].attacks.find((a) => a.name === name)?.addMod).toBe(false);
    }
  });
});
