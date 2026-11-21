// Character sheet, inventory, item icons and pixel icons (design/feature-expansion-plan.md §2, §3).
import { describe, it, expect } from 'vitest';
import { normalizeSheet, abilityMod, profBonus, skillBonus, saveBonus, passivePerception, fromClassTemplate, normalizeBindings,
  addItem, changeQty, transferItem, toggleEquip, normalizeCoins, MAX_BINDINGS } from '../../src/party/sheet.js';
import { resolveItem, normalizeName, presetList, PRESETS } from '../../src/rules/itemIcon.js';
import KIT from '../../src/data/kit.json';
import { Requests, validateRequest } from '../../src/net/Requests.js';
import { TokenManager, makeToken } from '../../src/tokens/TokenManager.js';
import CLASSES from '../../src/data/classes.json';

const ROPE = { ref: 'rope', name: 'Rope', icon: { kind: 'preset', key: 'rope' } };

describe('sheet', () => {
  it('derives modifiers, proficiency, saves, skills', () => {
    const s = normalizeSheet({ level: 5, abilities: { wis: 14, dex: 17 }, saves: { dex: true }, skills: { perception: 'prof', stealth: 'exp' } });
    expect(abilityMod(8)).toBe(-1); expect(abilityMod(17)).toBe(3);
    expect(profBonus(1)).toBe(2); expect(profBonus(5)).toBe(3); expect(profBonus(17)).toBe(6);
    expect(saveBonus(s, 'dex')).toBe(6); expect(saveBonus(s, 'str')).toBe(0);
    expect(skillBonus(s, 'perception')).toBe(5); expect(skillBonus(s, 'stealth')).toBe(9);
    expect(passivePerception(s)).toBe(15);
  });
  it('normalizes junk safely and is idempotent', () => {
    const s = normalizeSheet({ level: 99, abilities: { str: 'x' }, skills: { flying: 'prof', arcana: 'maybe' }, resources: [{ name: 'Ki', max: 3, used: 9 }], hacker: 1 });
    expect(s.level).toBe(20); expect(s.abilities.str).toBe(10); expect(s.skills).toEqual({}); expect(s.resources[0].used).toBe(3); expect(s.hacker).toBeUndefined();
    expect(normalizeSheet(s)).toEqual(s);
  });
  it('fills from a class template', () => {
    const { sheet, ac, maxHp } = fromClassTemplate(CLASSES.wizard);
    expect(sheet.cls).toBe('Wizard'); expect(sheet.abilities.int).toBe(15); expect(sheet.saves.int).toBe(true); expect(ac).toBe(11); expect(maxHp).toBe(7);
  });
  it('keeps at most 4 gesture bindings, one per gesture', () => {
    const b = normalizeBindings([{ gesture: 'point', effectId: 'fireball' }, { gesture: 'point', effectId: 'ice' }, { gesture: 'gun', effectId: 'water-ball' },
      { gesture: 'nope', effectId: 'x' }, { gesture: 'palm', effectId: 'thunderwave' }, { gesture: 'horns', effectId: 'lightning-bolt' }]);
    expect(b.map((x) => x.gesture)).toEqual(['point', 'gun', 'palm', 'slash']); // an old 'horns' binding becomes 'slash' expect(b.length).toBe(MAX_BINDINGS); expect(b[0].effectId).toBe('fireball');
  });
});

describe('inventory', () => {
  it('stacks, uses up, equips, gives', () => {
    let inv = addItem([], ROPE, 1); inv = addItem(inv, ROPE, 2);
    expect(inv.length).toBe(1); expect(inv[0].qty).toBe(3);
    inv = toggleEquip(inv, inv[0].id); expect(inv[0].equipped).toBe(true);
    const r = transferItem(inv, [], inv[0].id, 2);
    expect(r.moved).toBe(2); expect(r.from[0].qty).toBe(1); expect(r.to[0].qty).toBe(2); expect(r.to[0].equipped).toBe(false);
    expect(changeQty(r.from, r.from[0].id, -1)).toEqual([]);
    expect(normalizeCoins({ gp: '12', pp: -3, zz: 4 })).toEqual({ cp: 0, sp: 0, ep: 0, gp: 12, pp: 0 });
  });
});

describe('item icons', () => {
  it('every preset has a painted kit icon', () => {
    for (const p of Object.values(PRESETS)) expect(KIT[`item/${p.icon}`], p.name).toBeTruthy();
    expect(presetList().length).toBe(Object.keys(PRESETS).length);
  });
  it('exact, fuzzy and unknown names', () => {
    expect(resolveItem('Longsword').ref).toBe('longsword');
    expect(resolveItem('potion of healing').ref).toBe('potion-healing');
    const fuzzy = resolveItem('Rusty Daggers of Doom');
    expect(fuzzy.ref).toBeNull(); expect(fuzzy.icon).toEqual({ kind: 'preset', key: PRESETS.dagger.icon });
    expect(resolveItem('Glowing troll tooth').icon).toEqual({ kind: 'preset', key: 'bone' }); // keyword hint, nothing generated
    expect(resolveItem('Zzyzx').icon).toEqual({ kind: 'preset', key: 'sack' });
    expect(normalizeName("Thieves' Tools")).toBe('thieve tool');
  });
});

/** A 64×64 white image with a two-tone gradient disc in the middle. */
describe('bag requests (DM machine)', () => {
  function setup() {
    const dm = { state: { tokens: [], settings: {}, combat: {}, narration: null }, emit() {}, logRoll() {} };
    const T = new TokenManager({ dm }), sent = [];
    const R = new Requests({ dm, executors: {}, isDM: () => true, me: () => 'dm', send: (m) => sent.push(m), toast: () => {} }).install();
    const aria = T.spawn({ name: 'Aria', kind: 'pc', owner: 'p1', inventory: [{ ...ROPE, qty: 2 }] })[0];
    const bram = T.spawn({ name: 'Bram', kind: 'pc', owner: 'p2' })[0];
    const chest = T.spawn({ name: 'Chest', kind: 'item', inventory: [{ name: 'Gold Bar', qty: 3 }] })[0];
    return { dm, T, R, sent, aria, bram, chest };
  }
  const req = (type, payload, from = 'p1') => ({ t: 'req', op: 'act', type, payload, rid: `r${Math.random()}`, from });

  it('own sheet and bag edits apply at once, no approval card', () => {
    const s = setup();
    s.R.receive(req('sheet', { id: s.aria.id, patch: { level: 3, cls: 'Rogue' } }));
    s.R.receive(req('inv', { id: s.aria.id, op: 'add', item: { name: 'Torch', icon: { kind: 'preset', key: 'torch' } }, qty: 2 }));
    expect(s.R.queue.length).toBe(0);
    expect(s.T.find(s.aria.id).sheet.level).toBe(3);
    expect(s.T.find(s.aria.id).inventory.map((x) => x.name)).toEqual(['Rope', 'Torch']);
    expect(s.sent.every((m) => m.status === 'approved')).toBe(true);
  });
  it('cannot edit someone else, can give to them, can loot a chest', () => {
    const s = setup();
    expect(validateRequest('inv', { id: s.bram.id, op: 'add', item: ROPE }, 'p1', s.T.list).ok).toBe(false);
    expect(validateRequest('sheet', { id: s.aria.id, patch: { hp: 99 } }, 'p1', s.T.list).ok).toBe(false);
    const rope = s.T.find(s.aria.id).inventory[0];
    s.R.receive(req('give', { id: s.aria.id, to: s.bram.id, itemId: rope.id, qty: 1 }));
    expect(s.T.find(s.aria.id).inventory[0].qty).toBe(1); expect(s.T.find(s.bram.id).inventory[0].qty).toBe(1);
    const bar = s.T.find(s.chest.id).inventory[0];
    s.R.receive(req('give', { id: s.chest.id, to: s.aria.id, itemId: bar.id, qty: 3 }));
    expect(s.T.find(s.chest.id).inventory).toEqual([]);
    expect(s.T.find(s.aria.id).inventory.find((x) => x.name === 'Gold Bar').qty).toBe(3);
  });
  it('icon generation is gone: the icon request type is refused', () => {
    expect(validateRequest('icon', { key: 'x', url: 'data:image/png;base64,AAAA' }, 'p1', []).ok).toBe(false);
  });
  it('tokens keep sheets through makeToken (save / load / snapshot)', () => {
    const t = makeToken({ kind: 'pc', sheet: { level: 4 }, inventory: [ROPE], coins: { gp: 5 } });
    expect(t.sheet.level).toBe(4); expect(t.inventory[0].name).toBe('Rope'); expect(t.coins.gp).toBe(5);
  });
});
