// Tokens (design/flexibility-plan.md §1, §3, §9 step 1): one spawn path, HP plates, HP expressions, save/load.
import { describe, it, expect, beforeAll } from 'vitest';
import { parseHpExpr, migrateState, platedTokens, makeToken } from '../../src/tokens/TokenManager.js';
import { CombatManager } from '../../src/combat/CombatManager.js';
import { DMController } from '../../src/dm/DMController.js';

beforeAll(() => { globalThis.window = globalThis.window || {}; });

/** A DM stand-in with no three.js: spawned "meshes" are plain objects so plates can be checked. */
function fakeDm() {
  const dm = { state: { party: [], lighting: {}, weather: {}, map: {}, dice: {} }, emits: 0, narrations: [], emit() { this.emits++; }, narrate(t) { this.narrations.push(t); }, audio: {},
    spawnCreature: () => ({ item: { id: 1, mesh: {} }, life: null }),
    makeTokenMeshes: (t) => ({ item: { id: t.id, mesh: { userData: {} } }, life: t.life ? { visible: true, userData: {} } : null }) };
  return dm;
}
const plated = (dm) => (dm.state.tokens || dm.state.combat.combatants).filter((t) => { const r = dm.combatMgr.refs[t.id]; return r && (r.item || r.life); });
const setup = () => { const dm = fakeDm(); const mgr = new CombatManager({ dm }); return { dm, mgr, T: dm.tokens }; };

describe('HP-bar regression (Spawn tab)', () => {
  it('a creature spawned from the Spawn tab gets a plate', () => {
    const dm = fakeDm(); new CombatManager({ dm });
    DMController.prototype.spawnCreature.call(dm, 'goblin');
    expect(plated(dm)).toHaveLength(1);
  });
});

describe('one spawn path: every source gives a plate-able token', () => {
  it('template (addMonster), register, party PC, AI Forge and sync-style spawns all plate', async () => {
    const { dm, mgr, T } = setup();
    mgr.addMonster('goblin'); mgr.register({ name: 'Bandit', statId: 'bandit' }); mgr.addFromClass('fighter', 'Ana');
    const { AIForge } = await import('../../src/ai/AIForge.js');
    const forge = Object.create(AIForge.prototype); Object.assign(forge, { dm, spawned: [] });
    await forge.spawn({ id: 'e1', kind: 'creature', prompt: 'moss troll', label: 'Moss troll' });
    T.spawn({ name: 'Remote', kind: 'monster' }, { id: 'remote-1', join: false });
    expect(T.list).toHaveLength(5);
    expect(platedTokens(T.list, T.refs)).toHaveLength(5);
    expect(T.find('remote-1')).toBeTruthy();
    expect(T.list.find((t) => t.forge === 'e1').statId).toBe('troll');
  });
  it('player characters and items do not default to life-size', () => {
    expect(makeToken({ kind: 'pc' }).life).toBe(false);
    expect(makeToken({ kind: 'item' }).life).toBe(false);
    expect(makeToken({ kind: 'monster', life: false }).life).toBe(false);
  });

  it('count > 1 auto-numbers; creatures default to life-size; shape defaults', () => {
    const { T } = setup();
    const out = T.spawn({ name: 'Goblin' }, { count: 3 });
    expect(out.map((t) => t.name)).toEqual(['Goblin 1', 'Goblin 2', 'Goblin 3']);
    expect(out[0]).toMatchObject({ life: true, hpVisibility: 'exact', custom: [], rolls: [], kind: 'monster', side: 'enemy', owner: null });
  });
});

describe('HP', () => {
  it('expressions: -7, +3, =25, +5 temp; temp absorbs first; clamps', () => {
    const { T } = setup();
    const [t] = T.spawn({ name: 'Ogre', hp: 30, maxHp: 30 });
    expect(T.applyHpExpr(t.id, '-7')).toBe(true); expect(t.hp).toBe(23);
    T.applyHpExpr(t.id, '+3'); expect(t.hp).toBe(26);
    T.applyHpExpr(t.id, '=25'); expect(t.hp).toBe(25);
    T.applyHpExpr(t.id, '+5 temp'); expect(t.tempHp).toBe(5);
    T.applyHp(t.id, -8); expect(t).toMatchObject({ tempHp: 0, hp: 22 });
    T.applyHp(t.id, 99); expect(t.hp).toBe(30);
    T.applyHp(t.id, -99); expect(t.hp).toBe(0);
    expect(parseHpExpr('7')).toBeNull(); expect(T.applyHpExpr(t.id, 'abc')).toBe(false);
  });
  it('PC tokens at 0 keep death saves; the party sheet follows', () => {
    const { mgr, T, dm } = setup();
    const ch = mgr.addFromClass('fighter', 'Ana'), t = T.byChar(ch.id);
    T.applyHp(t.id, -t.hp);
    expect(t.deathSaves).toMatchObject({ fail: 0, dead: false });
    expect(mgr.needsDeathSave(t)).toBe(true);
    expect(dm.state.party[0].hp).toBe(0);
  });
});

describe('remove / clear / duplicate / saveDef', () => {
  it('remove frees refs, drops it from the order and pending damage', () => {
    const { mgr, T, dm } = setup();
    const freed = []; dm.grab = { remove: (i) => freed.push(i) };
    const g = mgr.addMonster('goblin'); mgr.queueDamage(g.id, 3);
    T.remove(g.id);
    expect(T.refs[g.id]).toBeUndefined(); expect(freed).toHaveLength(1);
    expect(T.combat.order).not.toContain(g.id); expect(mgr.pending).toHaveLength(0);
  });
  it('clear by kind keeps PCs; duplicate and saveDef copy stats', () => {
    const { mgr, T, dm } = setup();
    mgr.addFromClass('wizard', 'Zed'); const g = mgr.addMonster('orc');
    T.update(g.id, { custom: [{ key: 'Rage', value: '3/3' }] });
    expect(T.duplicate(g.id).custom).toEqual([{ key: 'Rage', value: '3/3' }]);
    expect(T.saveDef(g.id).name).toBe('Orc'); expect(dm.state.savedDefs).toHaveLength(1);
    T.clear({ kind: ['monster'] }); expect(T.list.map((t) => t.kind)).toEqual(['pc']);
  });
});

describe('save / load', () => {
  const loader = (dm) => Object.assign(dm, { reset() {}, setScene() {}, setLighting() {}, setWeather() {}, spawnObject() {}, setFogOfWar() {}, setMusic() {} });
  it('round-trips tokens, combat, savedDefs and forge', () => {
    const { dm, mgr, T } = setup();
    mgr.addFromClass('fighter', 'Ana'); const g = mgr.addMonster('goblin'); mgr.damage(g.id, 3); T.saveDef(g.id);
    dm.state.forge = { library: [{ id: 'e1', kind: 'creature', label: 'Moss troll' }, { id: 'e2', kind: 'backdrop', label: 'Old ruins' }] };
    mgr.start(); mgr.next();
    const json = JSON.stringify(dm.state);
    const b = setup(); loader(b.dm); b.dm.state.map = { fogOfWar: false };
    expect(DMController.prototype.load.call(b.dm, json)).toBe(true);
    const s2 = JSON.parse(JSON.stringify(b.dm.state)), s1 = JSON.parse(json);
    expect(s2.tokens.map((t) => [t.id, t.hp])).toEqual(s1.tokens.map((t) => [t.id, t.hp]));
    expect(s2.combat).toMatchObject({ active: true, round: s1.combat.round, turn: s1.combat.turn, order: s1.combat.order });
    expect(s2.savedDefs).toHaveLength(1); expect(s2.forge.library).toHaveLength(1);
    expect(platedTokens(b.T.list, b.T.refs)).toHaveLength(2);
  });
  it('migrates an old save (combatants, Spawn-tab creatures, forge spawns)', () => {
    const old = { party: [{ id: 'p1', name: 'Ana', cls: 'rogue', hp: 9, maxHp: 9, ac: 14 }], creatures: [{ id: 5, type: 'wolf', mini: [0, 0] }, { id: 7, type: 'orc', mini: [1, 1] }],
      forge: { library: [{ id: 'e1', kind: 'item', label: 'Sword' }], spawned: [{ netId: 'n1', entryId: 'e1' }] },
      combat: { active: true, round: 2, turn: 1, combatants: [{ id: 'c1', name: 'Orc', side: 'monster', hp: 4, maxHp: 15, ac: 13, dexMod: 1, init: 12, conditions: [], miniId: 7, statId: 'orc' },
        { id: 'c2', name: 'Ana', side: 'pc', hp: 9, maxHp: 9, ac: 14, init: 10, conditions: [], charId: 'p1' }] } };
    const s = migrateState(old);
    expect(s.tokens.map((t) => t.kind)).toEqual(['monster', 'pc', 'monster']); // forged items no longer exist (creatures only)
    expect(s.tokens[0]).toMatchObject({ id: 'c1', hp: 4, statId: 'orc', initBonus: 1 });
    expect(s.combat).toMatchObject({ active: true, round: 2, turn: 1, order: ['c1', 'c2', s.tokens[2].id] });
    expect(s.creatures).toBeUndefined();
  });
});

describe('combat on tokens', () => {
  it('rulesAssist defaults on; the combatants view is legacy-shaped and not saved', () => {
    const { dm, mgr } = setup();
    expect(dm.state.settings.rulesAssist).toBe(true);
    mgr.addMonster('goblin'); mgr.addFromClass('fighter', 'Ana'); mgr.start();
    expect(dm.state.combat.combatants.map((c) => c.side).sort()).toEqual(['monster', 'pc']);
    expect(Object.keys(JSON.parse(JSON.stringify(dm.state.combat)))).not.toContain('combatants');
  });
});
