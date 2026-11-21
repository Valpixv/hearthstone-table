// Unit tests for src/rules/dicePool.js (design/flexibility-plan.md §4a). Deterministic: seeded rng only.
import { describe, it, expect } from 'vitest';
import {
  parse, toExpr, add, removeDie, setMod, physicalSides, isPhysical, split, keep, roll, fromResults, d100From,
  rerollDie, dropDie, undropDie, setDie, addDie, setRollMod, total, parseHpExpr, verdict, natD20,
} from '../../src/rules/dicePool.js';

/** Seeded mulberry32: same seed, same sequence. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** An rng that yields exact faces: faces given as [value, sides] pairs, in call order. */
const scripted = (...pairs) => { let i = 0; return () => { const [v, s] = pairs[i++]; return (v - 0.5) / s; }; };

describe('parse', () => {
  it('reads dice groups and a flat modifier', () => {
    expect(parse('1d20 + 2d6 + 3')).toEqual({ groups: [{ count: 1, sides: 20, keep: null }, { count: 2, sides: 6, keep: null }], mod: 3 });
  });
  it('reads keep highest and keep lowest', () => {
    expect(parse('4d6kh3').groups[0].keep).toEqual({ mode: 'h', n: 3 });
    expect(parse('2d20kl1').groups[0].keep).toEqual({ mode: 'l', n: 1 });
    expect(parse('4d6k3').groups[0].keep).toEqual({ mode: 'h', n: 3 });
  });
  it('treats a missing count as one die, and d% as d100', () => {
    expect(parse('d100').groups).toEqual([{ count: 1, sides: 100, keep: null }]);
    expect(parse('d%').groups[0].sides).toBe(100);
    expect(parse('d3').groups[0].sides).toBe(3);
    expect(parse('d7').groups[0].sides).toBe(7);
  });
  it('subtracts a negative modifier and sums several modifiers', () => {
    expect(parse('3d4 - 1').mod).toBe(-1);
    expect(parse('1d8 + 3 + 1 - 2').mod).toBe(2);
  });
  it('ignores whitespace and case', () => {
    expect(parse('  2D6KH1  +  4 ')).toEqual(parse('2d6kh1+4'));
  });
  it('reads a lone number as a flat pool', () => {
    expect(parse('5')).toEqual({ groups: [], mod: 5 });
    expect(parse('-2')).toEqual({ groups: [], mod: -2 });
  });
  it.each([
    ['', /empty/], ['abc', /Can't read/], ['1d', /Can't read/], ['2d6 3', /Missing/], ['0d6', /count/],
    ['1d1', /sides/], ['5d6kh6', /impossible/], ['2d6kh0', /impossible/], ['1d20 - 1d4', /Subtracting/],
    ['1d20 ++ 2', /Can't read/], ['5000d6', /count/],
  ])('throws a clear error on bad input %j', (bad, msg) => {
    expect(() => parse(bad)).toThrow(msg);
  });
  it('throws when given a non-string', () => {
    expect(() => parse(42)).toThrow(/string/);
  });
});

describe('toExpr', () => {
  it('writes a canonical expression', () => {
    expect(toExpr(parse('d20+4d6kh3-1'))).toBe('1d20 + 4d6kh3 - 1');
    expect(toExpr(parse('2d20kl1'))).toBe('2d20kl1');
  });
  it('writes an empty pool as 0 and a flat pool as its number', () => {
    expect(toExpr({ groups: [], mod: 0 })).toBe('0');
    expect(toExpr({ groups: [], mod: -3 })).toBe('-3');
  });
  it.each(['1d20 + 2d6 + 3', '4d6kh3', '2d20kl1', 'd100', '3d4 - 1', 'd3', 'd7+2+2', '-4', '0', '1d6+1d6'])(
    'round-trips %j through parse', (e) => {
      const p = parse(e);
      expect(parse(toExpr(p))).toEqual(p);
    });
});

describe('click-to-build helpers', () => {
  it('adds a die to a new pool and to an existing group', () => {
    const p = add(add({ groups: [], mod: 0 }, 6), 6, 2);
    expect(toExpr(p)).toBe('3d6');
  });
  it('appends a new group instead of joining one with a keep rule', () => {
    expect(toExpr(add(parse('4d6kh3'), 6))).toBe('4d6kh3 + 1d6');
  });
  it('does not change the pool it was given', () => {
    const p = parse('1d20');
    add(p, 20);
    expect(toExpr(p)).toBe('1d20');
  });
  it('removes one die, then the whole group when it empties', () => {
    const p = removeDie(parse('1d20 + 2d6'), 6);
    expect(toExpr(p)).toBe('1d20 + 1d6');
    expect(toExpr(removeDie(p, 6))).toBe('1d20');
  });
  it('shrinks a keep rule that would keep more dice than remain', () => {
    expect(toExpr(removeDie(parse('3d6kh3'), 6))).toBe('2d6kh2');
  });
  it('leaves the pool unchanged when removing a size it lacks', () => {
    expect(toExpr(removeDie(parse('1d20'), 8))).toBe('1d20');
  });
  it('sets the modifier and keeps label and secret', () => {
    const p = setMod({ ...parse('1d8'), label: 'Axe', secret: true }, -2);
    expect(p).toMatchObject({ mod: -2, label: 'Axe', secret: true });
    expect(toExpr(p)).toBe('1d8 - 2');
  });
});

describe('physical vs digital dice', () => {
  it('lists the physical die sizes', () => {
    expect(physicalSides).toEqual([4, 6, 8, 10, 12, 20]);
  });
  it('treats d100 as physical and odd sizes as digital', () => {
    expect(isPhysical(20)).toBe(true);
    expect(isPhysical(100)).toBe(true);
    expect(isPhysical(3)).toBe(false);
    expect(isPhysical(7)).toBe(false);
  });
  it('splits a d100 into a tens and a ones d10, and odd dice to digital', () => {
    const { physical, digital } = split(parse('1d20 + d100 + 2d3'));
    expect(physical).toEqual([
      { group: 0, die: 0, sides: 20 },
      { group: 1, die: 0, sides: 10, part: 'tens' },
      { group: 1, die: 0, sides: 10, part: 'ones' },
    ]);
    expect(digital).toEqual([{ group: 2, die: 0, sides: 3 }, { group: 2, die: 1, sides: 3 }]);
  });
});

describe('roll', () => {
  it('rolls every die in range and totals with the modifier', () => {
    const r = roll(parse('10d6 + 3'), seeded(1));
    expect(r.dice).toHaveLength(10);
    for (const d of r.dice) { expect(d.value).toBeGreaterThanOrEqual(1); expect(d.value).toBeLessThanOrEqual(6); expect(d.source).toBe('digital'); }
    expect(r.total).toBe(r.dice.reduce((a, d) => a + d.value, 0) + 3);
  });
  it('gives the same result for the same seed', () => {
    expect(roll(parse('4d6kh3 + d7'), seeded(42))).toEqual(roll(parse('4d6kh3 + d7'), seeded(42)));
  });
  it('drops the lowest dice under keep highest', () => {
    const r = roll(parse('4d6kh3'), scripted([5, 6], [2, 6], [6, 6], [3, 6]));
    expect(r.dice.map((d) => d.dropped)).toEqual([false, true, false, false]);
    expect(r.total).toBe(14);
  });
  it('keeps the lowest under keep lowest, ties going to the earlier die', () => {
    const r = roll(parse('3d20kl1'), scripted([4, 20], [4, 20], [17, 20]));
    expect(r.dice.map((d) => d.dropped)).toEqual([false, true, true]);
    expect(r.total).toBe(4);
  });
  it('carries the label, the secret flag and the expression', () => {
    const r = roll({ ...parse('1d20+1'), label: 'Sneak', secret: true }, seeded(3));
    expect(r).toMatchObject({ label: 'Sneak', secret: true, expr: '1d20 + 1', mod: 1 });
  });
  it('can produce both ends of a die', () => {
    expect(roll(parse('d20'), () => 0).total).toBe(20 - 19);
    expect(roll(parse('d20'), () => 0.999999).total).toBe(20);
  });
  it('rejects a missing or broken rng', () => {
    expect(() => roll(parse('d6'))).toThrow(/rng/);
    expect(() => roll(parse('d6'), () => 1)).toThrow(/rng/);
  });
});

describe('fromResults', () => {
  it('builds a roll from physical results in split order', () => {
    const r = fromResults(parse('1d20 + 2d6 + 3'), [12, 4, 1]);
    expect(r.dice.map((d) => [d.sides, d.value, d.source])).toEqual([[20, 12, 'physical'], [6, 4, 'physical'], [6, 1, 'physical']]);
    expect(r.total).toBe(20);
  });
  it('combines the d100 tens and ones dice, with 00 + 0 as 100', () => {
    expect(fromResults(parse('d100'), [4, 7]).total).toBe(47);
    expect(fromResults(parse('d100'), [40, 7]).total).toBe(47);
    expect(fromResults(parse('d100'), [0, 5]).total).toBe(5);
    expect(fromResults(parse('d100'), [0, 0]).total).toBe(100);
    expect(fromResults(parse('d100'), [100, 10]).total).toBe(100);
    expect(fromResults(parse('d100'), [9, 9]).total).toBe(99);
  });
  it('reads a plain d10 showing 0 as 10', () => {
    expect(fromResults(parse('1d10'), [0]).total).toBe(10);
  });
  it('rolls digital dice from the rng alongside physical ones', () => {
    const r = fromResults(parse('1d20 + 1d3'), [{ value: 15 }], scripted([2, 3]));
    expect(r.dice.map((d) => d.source)).toEqual(['physical', 'digital']);
    expect(r.total).toBe(17);
  });
  it('applies keep rules to physical results', () => {
    expect(fromResults(parse('2d20kh1 + 5'), [3, 18]).total).toBe(23);
  });
  it('throws on a wrong result count, an impossible face, or a missing rng', () => {
    expect(() => fromResults(parse('2d6'), [3])).toThrow(/Expected 2/);
    expect(() => fromResults(parse('1d6'), [7])).toThrow(/1–6/);
    expect(() => fromResults(parse('d100'), [5, 11])).toThrow(/ones/);
    expect(() => fromResults(parse('d7'), [])).toThrow(/rng/);
  });
  it('d100From rejects a tens die that is not a multiple of ten', () => {
    expect(() => d100From(45, 3)).toThrow(/tens/);
  });
});

describe('editing a roll', () => {
  const base = () => fromResults(parse('4d6kh3 + 2'), [5, 2, 6, 3]); // drops the 2; total 16

  it('starts with the keep rule applied', () => {
    expect(base().total).toBe(16);
  });
  it('rerolling a die re-applies keep and returns a new roll', () => {
    const r0 = base();
    const r = rerollDie(r0, 0, 1);
    expect(r.dice.map((d) => d.dropped)).toEqual([true, false, false, false]);
    expect(r.total).toBe(13);
    expect(r.dice[0].source).toBe('digital');
    expect(r0.total).toBe(16);
  });
  it('setting a die by hand marks it manual', () => {
    const r = setDie(base(), 1, 6);
    expect(r.dice[1]).toMatchObject({ value: 6, source: 'manual', dropped: false });
    expect(r.total).toBe(6 + 6 + 5 + 2);
  });
  it('a manually dropped die stays dropped and keep picks from the rest', () => {
    const r = dropDie(base(), 2); // drop the 6: keep 5,3,2
    expect(r.dice.map((d) => d.dropped)).toEqual([false, false, true, false]);
    expect(r.total).toBe(12);
    const r2 = setDie(r, 2, 1);
    expect(r2.dice[2].dropped).toBe(true);
    expect(r2.total).toBe(12);
  });
  it('undropping returns the die to the keep rule', () => {
    expect(undropDie(dropDie(base(), 2), 2).total).toBe(16);
  });
  it('adds a bonus die outside every keep rule', () => {
    const r = addDie(base(), 4, 3);
    expect(r.dice.at(-1)).toMatchObject({ id: 4, sides: 4, value: 3, group: null, source: 'manual', dropped: false });
    expect(r.total).toBe(19);
  });
  it('changes the modifier after the roll', () => {
    expect(setRollMod(base(), -1).total).toBe(13);
  });
  it('total() sums kept dice plus the modifier', () => {
    expect(total({ dice: [{ value: 4, dropped: false }, { value: 6, dropped: true }], mod: 1 })).toBe(5);
  });
  it('throws on an unknown die or an impossible value', () => {
    expect(() => dropDie(base(), 99)).toThrow(/No die/);
    expect(() => setDie(base(), 0, 7)).toThrow(/1–6/);
    expect(() => addDie(base(), 1, 1)).toThrow(/size/);
  });
});

describe('keep helper', () => {
  it('returns the ids of the highest or lowest n dice', () => {
    const dice = [{ id: 0, value: 3 }, { id: 1, value: 9 }, { id: 2, value: 5 }];
    expect([...keep(dice, 'h', 2)].sort()).toEqual([1, 2]);
    expect([...keep(dice, 'l', 1)]).toEqual([0]);
  });
});

describe('parseHpExpr', () => {
  it.each([
    ['-7', { op: 'add', value: -7 }],
    ['+3', { op: 'add', value: 3 }],
    ['=25', { op: 'set', value: 25 }],
    ['+5 temp', { op: 'temp', value: 5 }],
    ['5temp', { op: 'temp', value: 5 }],
    ['12', { op: 'set', value: 12 }],
    ['  - 4 ', { op: 'add', value: -4 }],
    ['0', { op: 'set', value: 0 }],
  ])('reads %j', (s, want) => {
    expect(parseHpExpr(s)).toEqual(want);
  });
  it.each(['', 'abc', '-5 temp', '=', '1.5', '+-3'])('throws on %j', (bad) => {
    expect(() => parseHpExpr(bad)).toThrow(/HP entry/);
  });
});

describe('verdict (rules assist)', () => {
  const d20 = (face, mod = 0) => fromResults({ groups: [{ count: 1, sides: 20, keep: null }], mod }, [face]);

  it('attack: a nat 20 is a critical hit even against a huge Defense', () => {
    expect(verdict(d20(20), { tag: 'attack', target: 30 })).toMatchObject({ success: true, crit: true, text: 'Critical hit' });
  });
  it('attack: a nat 1 misses even with a big modifier', () => {
    expect(verdict(d20(1, 50), { tag: 'attack', target: 10 })).toMatchObject({ success: false, fumble: true });
  });
  it('attack: otherwise hits when the total meets the Defense', () => {
    expect(verdict(d20(10, 5), { tag: 'attack', target: 15 })).toMatchObject({ success: true, text: 'Hit' });
    expect(verdict(d20(9, 5), { tag: 'attack', target: 15 })).toMatchObject({ success: false, text: 'Miss' });
  });
  it('attack: uses the kept d20 under keep highest', () => {
    const r = fromResults(parse('2d20kh1 + 2'), [1, 20]);
    expect(natD20(r)).toBe(20);
    expect(verdict(r, { tag: 'attack', target: 25 }).crit).toBe(true);
  });
  it('save and check: total meets the DC, nat 20 and nat 1 not special', () => {
    expect(verdict(d20(12, 3), { tag: 'save', target: 15 }).success).toBe(true);
    expect(verdict(d20(20, 0), { tag: 'check', target: 25 }).success).toBe(false);
    expect(verdict(d20(1, 20), { tag: 'check', target: 15 }).success).toBe(true);
  });
  it('damage: the total, never below zero', () => {
    expect(verdict(fromResults(parse('1d4 - 5'), [2]), { tag: 'damage' }).amount).toBe(0);
    expect(verdict(fromResults(parse('2d6 + 1'), [3, 4]), { tag: 'damage' }).amount).toBe(8);
  });
  it('death: 10+ succeeds, below fails, nat 20 regains 1 HP, nat 1 is two failures', () => {
    expect(verdict(d20(10), { tag: 'death' })).toMatchObject({ outcome: 'success', successes: 1 });
    expect(verdict(d20(9), { tag: 'death' })).toMatchObject({ outcome: 'fail', failures: 1 });
    expect(verdict(d20(20), { tag: 'death' })).toMatchObject({ outcome: 'regain', hp: 1 });
    expect(verdict(d20(1), { tag: 'death' })).toMatchObject({ outcome: 'fail', failures: 2 });
  });
  it('a roll without a d20 compares its total and is never a crit', () => {
    expect(verdict(fromResults(parse('2d6'), [6, 6]), { tag: 'check', target: 12 })).toMatchObject({ success: true, crit: false });
  });
  it('throws on an unknown tag', () => {
    expect(() => verdict(d20(5), { tag: 'nope' })).toThrow(/Unknown/);
  });
});
