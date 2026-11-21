// Pure logic added by design/completion-plan.md: rooms and codes, seats, the 2024 sheet, the builder,
// the call → roll → confirm → gesture loop, the arena, and the multiplayer helpers.
import { describe, it, expect } from 'vitest';
import { Room, Rooms, makeCode, normalizeCode, SYNC_CFG } from '../../server/sync.js';
import { seatLayout, trayToWorld, MAP, TABLE_SIZE } from '../../src/table/layout.js';
import { normalizeSheet, defaultSheet, applyClass, applySpecies, applyBackground, suggestedAC, slotsFor, spellSaveDC, spellAttackBonus, rollAbilityScores,
  pointBuyCost, POINT_BUY, completeness, longRest, CLASS_IDS, STANDARD_ARRAY } from '../../src/party/sheet.js';
import { newDraft, autoAssign, buildCharacter, quickDraft, draftScores } from '../../src/party/SheetBuilder.js';
import { makeCalls, answerCall, judge, makeStrike, canRelease, defaultEffect, adjustDamage, impactDelay, callDice } from '../../src/combat/strikes.js';
import { nearestFree, isFree, autoSlot, formation, boardToArena, arenaToBoard, obstacles, ARENA } from '../../src/table/arena.js';
import { validateBag, BAG_EXECUTORS } from '../../src/party/bagActions.js';
import { validateRequest } from '../../src/net/Requests.js';
import { packHand, unpackHand, validHead } from '../../src/net/Avatars.js';
import { isPolite, levelOf } from '../../src/net/Voice.js';
import { handRay } from '../../src/ui/vr/XRPointer.js';
import { JOINTS } from '../../src/input/gestures.js';
import KIT from '../../src/data/kit.json';
import EFFECTS from '../../src/data/effects.json';
import MONSTERS from '../../src/data/monsters.json';
import CLASSES from '../../src/data/classes.json';

const seq = (list) => { let i = 0; return () => list[i++ % list.length]; };

describe('rooms and invite codes', () => {
  it('makes a 6-character code without look-alike characters', () => {
    const code = makeCode(seq([0, 5, 10, 15, 20, 25]));
    expect(code).toHaveLength(SYNC_CFG.codeLength);
    expect(code).not.toMatch(/[0O1I]/);
  });
  it('reads a typed code whatever its case or spacing', () => { expect(normalizeCode(' ab-c 12 ')).toBe('ABC12'); });
  it('keeps tables apart and refuses an unknown code', () => {
    const rooms = new Rooms(), a = rooms.create(), b = rooms.create();
    expect(a.code).not.toBe(b.code);
    expect(rooms.open(a.code)).toBe(a);
    expect(rooms.open('ZZZZZZ')).toBeNull();
    expect(rooms.open(null).code).toBe(SYNC_CFG.defaultCode); // the shared test table
  });
  it('lets a player keep their id and seat when they rejoin from another device', () => {
    const room = new Room('ABCDEF');
    room.clients.set('c1', { conn: 'c1', id: 'c1', seat: room.freeSeat() });
    expect(room.hello('c1', { role: 'player', name: 'Aria' }).ok).toBe(true);
    const rejoin = room.clients.get('c1').rejoin;
    room.clients.set('c2', { conn: 'c2', id: 'c2', seat: room.freeSeat() });
    const r = room.hello('c2', { role: 'player', rejoin });
    expect(r).toMatchObject({ ok: true, replaced: 'c1' });
    expect(room.clients.get('c2')).toMatchObject({ id: 'c1', seat: 0, name: 'Aria' });
  });
  it('refuses a wrong rejoin number and a second Dungeon Master', () => {
    const room = new Room('ABCDEF');
    room.clients.set('d', { conn: 'd', id: 'd', seat: 0 }); room.hello('d', { role: 'dm' });
    room.clients.set('x', { conn: 'x', id: 'x', seat: 1 });
    expect(room.hello('x', { role: 'dm' }).ok).toBe(false);
    expect(room.hello('x', { role: 'player', rejoin: '0000' }).ok).toBe(false);
  });
  it('drops an empty room only after its time is up', () => {
    const rooms = new Rooms(), r = rooms.create();
    r.clients.set('a', { conn: 'a', id: 'a', seat: 0 }); r.leave('a', 1000);
    rooms.sweep(1000 + SYNC_CFG.emptyRoomTtlMs - 1); expect(rooms.get(r.code)).toBe(r);
    rooms.sweep(1000 + SYNC_CFG.emptyRoomTtlMs + 1); expect(rooms.get(r.code)).toBeNull();
  });
});

describe('seats', () => {
  it('keeps the original layout for unit tests and replays', () => { expect(seatLayout(0).tray).toMatchObject({ x: 0.42, z: 0.05 }); });
  it('turns a tray-local offset by the tray yaw', () => {
    const [x, z] = trayToWorld({ x: 1, z: 2, yaw: Math.PI / 2 }, 0.1, 0);
    expect(x).toBeCloseTo(1); expect(z).toBeCloseTo(1.9);
  });
  it('keeps the mat inside the table', () => { expect(MAP.w).toBeLessThan(TABLE_SIZE.w); expect(MAP.d).toBeLessThan(TABLE_SIZE.d); });
});

describe('2024 character sheet', () => {
  it('migrates a first-version sheet (hit dice as text, spell text) without losing it', () => {
    const s = normalizeSheet({ level: 3, cls: 'Wizard', hitDice: '3d6', spells: [{ name: 'Shield', level: 1, text: 'reaction' }] });
    expect(s.hitDice).toEqual({ die: 6, spent: 0 });
    expect(s.spells[0]).toMatchObject({ name: 'Shield', notes: 'reaction', prepared: true });
  });
  it('is idempotent', () => { const s = normalizeSheet({ level: 5, cls: 'Cleric' }); expect(normalizeSheet(s)).toEqual(s); });
  it('applies every class: saves, training, features, slots for casters', () => {
    for (const id of CLASS_IDS) {
      const r = applyClass(defaultSheet(), id, { scores: true });
      expect(Object.keys(r.sheet.saves), id).toHaveLength(2);
      expect(r.sheet.features.length, id).toBeGreaterThan(0);
      expect(r.sheet.castBindings, id).toHaveLength(4);
      for (const b of r.sheet.castBindings) expect(EFFECTS.effects[b.effectId], `${id} ${b.effectId}`).toBeTruthy();
      expect(!!Object.keys(r.sheet.slots).length, id).toBe(!!CLASSES[id].caster);
    }
  });
  it('derives spell DC and attack from the casting ability', () => {
    const s = applyClass(normalizeSheet({ abilities: { int: 16 } }), 'wizard').sheet;
    expect(spellSaveDC(s)).toBe(13); expect(spellAttackBonus(s)).toBe(5);
    expect(spellSaveDC(defaultSheet())).toBeNull();
  });
  it('gives a level 5 full caster 4/3/2 slots and a warlock two 3rd-level slots', () => {
    expect(slotsFor('Wizard', 5)).toEqual({ 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } });
    expect(slotsFor('Warlock', 5)).toEqual({ 3: { max: 2, used: 0 } });
    expect(slotsFor('Fighter', 5)).toEqual({});
  });
  it('suggests AC from equipped armor, a shield, and unarmored class rules', () => {
    const s = normalizeSheet({ cls: 'Fighter', abilities: { dex: 14 } });
    expect(suggestedAC(s, [{ ref: 'chain-mail', equipped: true }])).toBe(16);
    expect(suggestedAC(s, [{ ref: 'chain-shirt', equipped: true }, { ref: 'shield', equipped: true }])).toBe(17);
    expect(suggestedAC(normalizeSheet({ cls: 'Barbarian', abilities: { dex: 14, con: 16 } }), [])).toBe(15);
  });
  it('adds a background: two skills, a feat, +2 and +1 to its abilities', () => {
    const r = applyBackground(normalizeSheet({ abilities: { str: 15, dex: 14, con: 13 } }), 'soldier');
    expect(r.sheet.skills).toMatchObject({ athletics: 'prof', intimidation: 'prof' });
    expect(r.sheet.feats[0].name).toBe('Savage Attacker');
    expect(r.sheet.abilities).toMatchObject({ str: 17, dex: 15, con: 13 });
  });
  it('applies a species: size, speed and traits', () => { expect(applySpecies(defaultSheet(), 'goliath')).toMatchObject({ species: 'Goliath', speed: 35 }); });
  it('rolls 4d6 and drops the lowest', () => {
    const r = rollAbilityScores(seq([0, 0.2, 0.5, 0.99])); // 1, 2, 4, 6 each time
    expect(r).toHaveLength(6); expect(r[0]).toEqual({ dice: [1, 2, 4, 6], total: 12 });
  });
  it('prices point buy: the standard array costs exactly the 27 points', () => {
    expect(pointBuyCost({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 })).toBe(POINT_BUY.points);
    expect(pointBuyCost({ str: 16, dex: 8, con: 8, int: 8, wis: 8, cha: 8 })).toBe(Infinity);
  });
  it('a long rest restores slots, resources and half the hit dice', () => {
    const s = longRest(normalizeSheet({ level: 4, hitDice: { die: 8, spent: 4 }, slots: { 1: { max: 3, used: 3 } }, resources: [{ name: 'Rage', max: 2, used: 2 }], exhaustion: 2 }));
    expect(s.hitDice.spent).toBe(2); expect(s.slots[1].used).toBe(0); expect(s.resources[0].used).toBe(0); expect(s.exhaustion).toBe(1);
  });
});

describe('stage-1 builder', () => {
  it('places the best scores on the abilities the class cares about', () => {
    const d = autoAssign({ ...newDraft('Bo'), cls: 'wizard', pool: [...STANDARD_ARRAY] });
    expect(draftScores(d).int).toBe(15);
  });
  it('builds a whole character from a draft', () => {
    const d = autoAssign({ ...newDraft('Bo'), cls: 'fighter', species: 'dwarf', background: 'soldier', skills: ['perception', 'survival'] });
    const c = buildCharacter(d);
    expect(c.token).toMatchObject({ name: 'Bo', model: 'fighter' });
    expect(c.token.maxHp).toBeGreaterThanOrEqual(10);
    expect(c.sheet).toMatchObject({ cls: 'Fighter', species: 'Dwarf', background: 'Soldier' });
    expect(Object.keys(c.sheet.skills).sort()).toEqual(['athletics', 'intimidation', 'perception', 'survival']);
    expect(c.inventory.some((i) => i.ref === 'chain-mail' && i.equipped)).toBe(true);
    expect(c.token.ac).toBe(18); // chain mail 16 + shield 2
    expect(c.coins.gp).toBeGreaterThan(0);
  });
  it('quick build gives a complete sheet for every roll of the dice', () => {
    for (let i = 0; i < 12; i++) {
      const c = buildCharacter(quickDraft('Cy', seq([i / 12, (i * 7 % 12) / 12, (i * 5 % 12) / 12])));
      const comp = completeness({ name: c.token.name, maxHp: c.token.maxHp, sheet: c.sheet });
      expect(comp.missing, c.sheet.cls).toEqual([]);
    }
  });
  it('lets a player build freely only until they are ready and play has begun', () => {
    const tokens = [{ id: 't1', owner: 'p1', kind: 'pc' }];
    expect(validateBag('build', { id: 't1', token: { maxHp: 12 } }, 'p1', tokens, { session: { stage: 'lobby', ready: { t1: true } } }).ok).toBe(true);
    expect(validateBag('build', { id: 't1', token: { maxHp: 12 } }, 'p1', tokens, { session: { stage: 'play', ready: {} } }).ok).toBe(true);
    expect(validateBag('build', { id: 't1', token: { maxHp: 99 } }, 'p1', tokens, { session: { stage: 'play', ready: { t1: true } } }).ok).toBe(false);
    expect(validateBag('build', { id: 't1', token: { owner: 'x' } }, 'p1', tokens, { session: { stage: 'lobby', ready: {} } }).ok).toBe(false);
    expect(validateBag('build', { id: 't1', token: {} }, 'p2', tokens, { session: { stage: 'lobby', ready: {} } }).ok).toBe(false);
  });
  it('records Ready on the session', () => {
    const dm = { state: {}, emit() {} };
    BAG_EXECUTORS.ready(dm, { id: 't1', on: true }); expect(dm.state.session.ready).toEqual({ t1: true });
    BAG_EXECUTORS.ready(dm, { id: 't1', on: false }); expect(dm.state.session.ready).toEqual({});
  });
});

describe('call → roll → confirm → gesture', () => {
  const pc = { id: 'pc1', kind: 'pc', owner: 'p1', initBonus: 2, sheet: normalizeSheet({ level: 1, abilities: { str: 16, dex: 14 }, saves: { dex: true }, skills: { stealth: 'prof' }, weapons: [{ name: 'Longsword', bonus: '+5', damage: '1d8+3', type: 'slashing' }] }) };
  const gob = { id: 'g1', kind: 'monster', ac: 15 };
  const tokens = [pc, gob];
  it('takes the dice of a call from the sheet', () => {
    expect(callDice(pc, { kind: 'save', ability: 'dex' }).expr).toBe('1d20+4');
    expect(callDice(pc, { kind: 'check', skill: 'stealth' }).expr).toBe('1d20+4');
    expect(callDice(pc, { kind: 'attack', weapon: 0, adv: 'adv' }).expr).toBe('2d20kh1+5');
    expect(callDice(pc, { kind: 'damage', weapon: 0 }).expr).toBe('1d8+3');
    expect(callDice(pc, { kind: 'init' }).expr).toBe('1d20+2');
  });
  it('judges an attack against the target AC, with crits and fumbles', () => {
    const [c] = makeCalls(tokens, { to: ['pc1'], kind: 'attack', weapon: 0, targetId: 'g1' });
    expect(judge(c, { total: 15, nat: 10 }, tokens).success).toBe(true);
    expect(judge(c, { total: 14, nat: 9 }, tokens).success).toBe(false);
    expect(judge(c, { total: 6, nat: 20 }, tokens)).toMatchObject({ success: true, crit: true });
    expect(judge(c, { total: 30, nat: 1 }, tokens)).toMatchObject({ success: false, fumble: true });
    expect(judge(c, { total: 30, nat: 12 }, tokens, false).success).toBeNull(); // rules assist off: the DM decides
  });
  it('answers a call once', () => {
    let calls = makeCalls(tokens, { to: ['pc1'], kind: 'save', ability: 'dex', dc: 13 });
    calls = answerCall(calls, calls[0].id, { total: 12, nat: 8 }, tokens);
    expect(calls[0]).toMatchObject({ status: 'rolled', result: { total: 12, verdict: { success: false } } });
    const again = answerCall(calls, calls[0].id, { total: 20, nat: 16 }, tokens);
    expect(again[0].result.total).toBe(12);
  });
  it('only the owner of the called character may answer, and only while it is open', () => {
    const state = { calls: makeCalls(tokens, { to: ['pc1'], kind: 'check', ability: 'str' }), strikes: [] }, id = state.calls[0].id;
    expect(validateRequest('call.answer', { id, total: 11 }, 'p1', tokens, state).ok).toBe(true);
    expect(validateRequest('call.answer', { id, total: 11 }, 'p2', tokens, state).ok).toBe(false);
    state.calls = answerCall(state.calls, id, { total: 11 }, tokens);
    expect(validateRequest('call.answer', { id, total: 19 }, 'p1', tokens, state).ok).toBe(false);
  });
  it('arms a strike that only its attacker (or the DM) may release', () => {
    const s = makeStrike({ by: 'pc1', targets: [{ id: 'g1', amount: 9.7 }, { id: '', amount: 3 }], damageType: 'fire' });
    expect(s).toMatchObject({ status: 'armed', targets: [{ id: 'g1', amount: 9 }] });
    expect(canRelease(s, 'p1', false, tokens)).toBe(true);
    expect(canRelease(s, 'p2', false, tokens)).toBe(false);
    expect(canRelease(s, null, true, tokens)).toBe(true);
    expect(canRelease({ ...s, status: 'released' }, 'p1', false, tokens)).toBe(false);
    expect(validateRequest('strike.release', { id: s.id }, 'p2', tokens, { strikes: [s] }).ok).toBe(false);
    expect(makeStrike({ by: 'pc1', targets: [] })).toBeNull();
  });
  it('picks an effect by damage type when no gesture is bound', () => {
    expect(defaultEffect({ damageType: 'fire' })).toBe('fireball');
    expect(defaultEffect({ heal: true })).toBe('healing-light');
    expect(EFFECTS.effects[defaultEffect({ damageType: 'nonsense' })]).toBeTruthy();
  });
  it('suggests halved, doubled or no damage from the words on a sheet', () => {
    const t = { sheet: { resist: 'fire, cold', vulnerable: 'thunder', immune: 'poison' } };
    expect(adjustDamage(t, 9, 'fire')).toEqual({ amount: 4, note: 'resistant' });
    expect(adjustDamage(t, 9, 'thunder').amount).toBe(18);
    expect(adjustDamage(t, 9, 'poison').amount).toBe(0);
    expect(adjustDamage(t, 9, 'acid').amount).toBe(9);
  });
  it('waits for a projectile to arrive before damage lands', () => { expect(impactDelay('fireball', 7)).toBeCloseTo(1); expect(impactDelay('lightning-bolt', 7)).toBeLessThan(0.5); });
});

describe('arena', () => {
  it('never stacks creatures and keeps them outside the table', () => {
    const placed = [];
    for (let i = 0; i < 12; i++) { const [x, z] = autoSlot(0.5, [...obstacles([0, 1, 2]), ...placed]); expect(isFree(x, z, 0.5, [...obstacles([0, 1, 2]), ...placed]), `creature ${i}`).toBe(true); placed.push({ x, z, r: 0.5 }); }
    for (const p of placed) expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(ARENA.minRadius);
  });
  it('moves a drop off an occupied spot', () => {
    const others = [{ x: 3, z: 0, r: 0.5 }], [x, z] = nearestFree(3, 0, 0.5, others);
    expect(Math.hypot(x - 3, z)).toBeGreaterThanOrEqual(1 + ARENA.gap - 1e-6);
  });
  it('lays out every formation without overlaps', () => {
    for (const kind of ['line', 'arc', 'surround', 'scatter']) {
      const radii = [0.5, 0.5, 0.9, 0.4, 0.5], pts = formation(kind, radii, obstacles([0]), { rand: seq([0.1, 0.7, 0.4, 0.9]) });
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]), `${kind} ${i}-${j}`).toBeGreaterThanOrEqual(radii[i] + radii[j]);
    }
  });
  it('maps a square on the mat to a spot in the room and back', () => {
    const [ax, az] = boardToArena(MAP.x + 0.2, MAP.z - 0.1), [bx, bz] = arenaToBoard(ax, az);
    expect(Math.hypot(ax, az)).toBeGreaterThan(ARENA.minRadius);
    expect(bx).toBeCloseTo(MAP.x + 0.2, 1); expect(bz).toBeCloseTo(MAP.z - 0.1, 1);
  });
});

describe('seeing and hearing each other', () => {
  const hand = Object.fromEntries(JOINTS.map((n, i) => [n, { p: [0.1 + i * 0.001, 1.2, -0.3] }]));
  it('packs a hand to millimetres and back', () => {
    const packed = packHand(hand); expect(packed).toHaveLength(JOINTS.length * 3);
    expect(unpackHand(packed)[4][0]).toBeCloseTo(0.104, 3);
    expect(packHand(null)).toBeNull();
  });
  it('ignores malformed poses from the network', () => {
    expect(unpackHand([1, 2, 3])).toBeNull(); expect(unpackHand('x')).toBeNull();
    expect(validHead([0, 1.2, 0, 0, 0, 0, 1])).toBe(true); expect(validHead([0, 99, 0, 0, 0, 0, 1])).toBe(false); expect(validHead([0, 1, 0])).toBe(false);
  });
  it('picks exactly one polite side of every voice connection', () => { expect(isPolite('a', 'b')).toBe(false); expect(isPolite('b', 'a')).toBe(true); });
  it('measures silence as zero and a square wave as loud', () => {
    expect(levelOf(new Uint8Array(64).fill(128))).toBe(0);
    expect(levelOf(Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 255 : 0)))).toBeGreaterThan(0.9);
  });
  it('points a hand ray forward from the knuckles', () => {
    const r = handRay({ wrist: { p: [0, 1, 0] }, 'index-finger-phalanx-proximal': { p: [0, 1, -0.09] }, 'middle-finger-phalanx-proximal': { p: [0.02, 1, -0.09] } });
    expect(r.dir[2]).toBeLessThan(-0.9); expect(handRay({})).toBeNull();
  });
});

describe('painted kit coverage', () => {
  it('has a portrait for every monster template and an icon for every spell effect it ships', () => {
    for (const id of Object.keys(MONSTERS)) if (!id.startsWith('_')) expect(KIT[`creature/${id}`], id).toBeTruthy();
    for (const id of ['fireball', 'healing-light', 'misty-step', 'chain-lightning']) expect(KIT[`spell/${id}`], id).toBeTruthy();
  });
  it('uses no file name Windows cannot create (con, prn, aux, nul, com1…)', () => {
    const reserved = Object.keys(KIT).filter((k) => /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(k.split('/')[1]));
    expect(reserved).toEqual([]);
  });
  it('has the emblems the home screen and dock use', () => {
    for (const k of ['nav/hearthstone-table', 'session/host-table', 'session/join-table', 'nav/enter-vr', 'nav/desktop-mode', 'nav/webcam-hands', 'nav/table', 'nav/creatures', 'nav/dice', 'nav/world', 'nav/forge', 'nav/tools', 'ui/panel', 'ui/modal']) expect(KIT[k], k).toBeTruthy();
  });
});
