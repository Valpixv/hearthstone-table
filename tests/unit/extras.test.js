// Level-up, loot split, handouts, the speed ring, scenery sets and the seat card (design/completion-plan.md §10, phase 12).
import { describe, it, expect } from 'vitest';
import { normalizeSheet, levelUp, canLevelUp, splitCoins, applyClass, defaultSheet } from '../../src/party/sheet.js';
import { normalizeHandout, HANDOUT_MAX } from '../../src/ui/Handouts.js';
import { validateRequest } from '../../src/net/Requests.js';
import { seatLayout, LAYOUT_CFG } from '../../src/table/layout.js';
import SETS from '../../src/data/sets.json';
import { BACKDROPS } from '../../src/scenes/hdriBackdrop.js';
import { existsSync } from 'node:fs';

describe('level up', () => {
  it('adds a level, the average hit die plus Constitution, and the next row of spell slots', () => {
    const base = applyClass(normalizeSheet({ level: 2, abilities: { con: 14 } }), 'wizard').sheet; // d6, con +2
    const r = levelUp({ ...base, slots: { 1: { max: 3, used: 2 } } });
    expect(r.hpGain).toBe(6); // 4 (average of a d6) + 2
    expect(r.sheet.level).toBe(3);
    expect(r.sheet.slots).toEqual({ 1: { max: 4, used: 2 }, 2: { max: 2, used: 0 } }); // used slots stay used
  });
  it('uses a rolled hit die when given one, and never gains less than 1', () => {
    expect(levelUp(normalizeSheet({ cls: 'Fighter', hitDice: { die: 10 }, abilities: { con: 10 } }), { rolled: 9 }).hpGain).toBe(9);
    expect(levelUp(normalizeSheet({ hitDice: { die: 6 }, abilities: { con: 3 } }), { rolled: 1 }).hpGain).toBe(1);
  });
  it('stops at level 20', () => { expect(levelUp(normalizeSheet({ level: 20 }))).toBeNull(); });
  it('knows when the experience is there', () => {
    expect(canLevelUp(normalizeSheet({ level: 1, xp: 299 }))).toBe(false);
    expect(canLevelUp(normalizeSheet({ level: 1, xp: 300 }))).toBe(true);
    expect(canLevelUp(normalizeSheet({ level: 20, xp: 999999 }))).toBe(false);
  });
  it('a player may ask to level only their own character', () => {
    const tokens = [{ id: 't1', owner: 'p1', kind: 'pc' }];
    expect(validateRequest('levelup', { id: 't1' }, 'p1', tokens).ok).toBe(true);
    expect(validateRequest('levelup', { id: 't1' }, 'p2', tokens).ok).toBe(false);
  });
});

describe('party loot', () => {
  it('splits each kind of coin evenly and reports what is left over', () => {
    expect(splitCoins({ gp: 100, sp: 7 }, 3)).toEqual({ share: { gp: 33, sp: 2 }, rest: { gp: 1, sp: 1 } });
    expect(splitCoins({ gp: 2 }, 4)).toEqual({ share: {}, rest: { gp: 2 } });
    expect(splitCoins({}, 4)).toEqual({ share: {}, rest: {} });
  });
});

describe('handouts', () => {
  it('trims a handout and drops an empty one', () => {
    expect(normalizeHandout({ title: '  A letter ', text: 'x'.repeat(5000) })).toMatchObject({ title: 'A letter', text: 'x'.repeat(HANDOUT_MAX.text) });
    expect(normalizeHandout({ text: 'Meet me at dusk' }).title).toBe('A note');
    expect(normalizeHandout({ title: ' ', text: '' })).toBeNull();
  });
});

describe('scenery sets', () => {
  it('has a set for every photographic backdrop, built only from models that are on disk', () => {
    for (const id of Object.keys(BACKDROPS)) expect(SETS.sets[id], id).toBeTruthy();
    const models = new Set(Object.values(SETS.sets).flatMap((s) => [...(s.scatter || []), ...(s.props || [])].map((x) => x.model)));
    for (const m of models) expect(existsSync(`public/assets/polyhaven/${m}/${m}.gltf`), m).toBe(true);
  });
  it('keeps every set to three lights and its fixed props off the table and the seats', () => {
    const seats = Array.from({ length: LAYOUT_CFG.maxSeats }, (_, i) => seatLayout(i).pos);
    for (const [id, s] of Object.entries(SETS.sets)) {
      expect((s.lights || []).length, id).toBeLessThanOrEqual(3);
      for (const p of s.props || []) {
        expect(Math.hypot(p.pos[0], p.pos[2]), `${id} ${p.model}`).toBeGreaterThan(SETS.clearance.arenaInner);
        for (const [x, z] of seats) expect(Math.hypot(p.pos[0] - x, p.pos[2] - z), `${id} ${p.model} seat`).toBeGreaterThan(SETS.clearance.seat);
      }
      for (const row of s.scatter || []) expect(row.rMin, `${id} ${row.model}`).toBeGreaterThanOrEqual(SETS.clearance.arenaInner); // creatures stand inside this ring
    }
  });
  it('stays inside the draw-call budget (one per placed model part, under 150 per set)', () => {
    for (const [id, s] of Object.entries(SETS.sets)) {
      const n = (s.scatter || []).reduce((a, r) => a + r.count, 0) + (s.props || []).length;
      expect(n, id).toBeLessThan(110);
    }
  });
});

describe('sheet defaults stay usable', () => { it('a blank sheet can level', () => { expect(levelUp(defaultSheet()).sheet.level).toBe(2); }); });
