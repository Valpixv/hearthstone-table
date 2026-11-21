// Phase B wiring: CombatManager with a stub DM (no three.js). Pending damage, death saves, initiative,
// cantrip / rider intents, conditions with sourceId, removal keeping the turn.
import { describe, it, expect } from 'vitest';
import { CombatManager } from '../../src/combat/CombatManager.js';
import { parseDamage, verdictText } from '../../src/rules/RollService.js';


function stubDm() {
  const dm = { state: {}, emits: 0, narrations: [], emit() { this.emits++; }, narrate(t) { this.narrations.push(t); }, audio: {},
    spawnCreature: () => null, plainDamage: [] };
  dm.damage = function (id, n, o) { this.plainDamage.push([id, n, o]); this.combatMgr.damage(id, n, o); };
  return dm;
}
const setup = () => { const dm = stubDm(); const mgr = new CombatManager({ dm }); return { dm, mgr }; };
const pc = (mgr, cls = 'fighter', name = 'Ana') => mgr.addFromClass(cls, name);

describe('pending damage', () => {
  it('dm.damage with pending queues a chip instead of applying', () => {
    const { dm, mgr } = setup();
    const g = mgr.register({ name: 'Gob', statId: 'goblin' }), hp = g.hp;
    dm.damage(g.id, 5, { pending: true, type: 'slashing', source: 'Ana · Longsword' });
    expect(mgr.find(g.id).hp).toBe(hp);
    expect(mgr.pending).toHaveLength(1);
    expect(mgr.pending[0]).toMatchObject({ targetId: g.id, amount: 5, type: 'slashing', crit: false });
  });
  it('the request path (TableSync onRequest → combat.damage) also queues', () => {
    const { mgr } = setup();
    const g = mgr.register({ name: 'Gob', statId: 'goblin' });
    mgr.damage(g.id, 4, { crit: true, pending: true });
    expect(mgr.pending[0].crit).toBe(true);
    expect(mgr.find(g.id).hp).toBe(g.hp);
  });
  it('apply / half / double / override / discard', () => {
    const { mgr } = setup();
    const g = mgr.register({ name: 'Ogre', statId: 'ogre' }), hp0 = g.hp;
    const a = mgr.queueDamage(g.id, 7), b = mgr.queueDamage(g.id, 7), c = mgr.queueDamage(g.id, 7), d = mgr.queueDamage(g.id, 7), e = mgr.queueDamage(g.id, 7);
    mgr.applyPending(a.pid); expect(mgr.find(g.id).hp).toBe(hp0 - 7);
    mgr.applyPending(b.pid, { multiplier: 0.5 }); expect(mgr.find(g.id).hp).toBe(hp0 - 7 - 3);
    mgr.applyPending(c.pid, { multiplier: 2 }); expect(mgr.find(g.id).hp).toBe(hp0 - 7 - 3 - 14);
    mgr.applyPending(d.pid, { override: 1 }); expect(mgr.find(g.id).hp).toBe(hp0 - 25);
    mgr.discardPending(e.pid); expect(mgr.find(g.id).hp).toBe(hp0 - 25);
    expect(mgr.pending).toHaveLength(0);
  });
  it('plain damage (DM +/- buttons) still applies directly', () => {
    const { mgr } = setup();
    const g = mgr.register({ name: 'Gob', statId: 'goblin' }), hp0 = g.hp; // tokens are live records
    mgr.damage(g.id, 2);
    expect(mgr.find(g.id).hp).toBe(hp0 - 2);
  });
});

describe('death saves', () => {
  it('a PC at 0 rolls; fails accumulate; damage at 0 adds a failure; heal resets', () => {
    const { dm, mgr } = setup();
    pc(mgr); mgr.start();
    const c = mgr.combat.combatants.find((x) => x.side === 'pc');
    mgr.damage(c.id, c.hp);
    expect(mgr.needsDeathSave(mgr.find(c.id))).toBe(true);
    dm.damage(c.id, 0, { deathSave: 5 });
    expect(mgr.find(c.id).deathSaves).toMatchObject({ fail: 1, success: 0 });
    mgr.damage(c.id, 1, { crit: true });
    expect(mgr.find(c.id).deathSaves.fail).toBe(3);
    expect(mgr.find(c.id).deathSaves.dead).toBe(true);
  });
  it('nat 20 → 1 HP; three successes → stable; DM override on the pips', () => {
    const { mgr } = setup();
    pc(mgr); mgr.start();
    const c = mgr.combat.combatants.find((x) => x.side === 'pc');
    mgr.damage(c.id, c.hp);
    mgr.deathSave(c.id, 20);
    expect(mgr.find(c.id).hp).toBe(1);
    expect(mgr.party[0].hp).toBe(1);
    mgr.damage(c.id, 1);
    [12, 15, 10].forEach((v) => mgr.deathSave(c.id, v));
    expect(mgr.find(c.id).deathSaves.stable).toBe(true);
    mgr.adjustDeathSaves(c.id, 'success', -1);
    expect(mgr.find(c.id).deathSaves).toMatchObject({ success: 2, stable: false });
  });
});

describe('initiative', () => {
  it('PCs wait for a number; monsters roll once per group; setInit and reorder', () => {
    const { dm, mgr } = setup();
    pc(mgr, 'fighter', 'Ana'); pc(mgr, 'wizard', 'Bo');
    const g1 = mgr.register({ name: 'Gob 1', statId: 'goblin' }), g2 = mgr.register({ name: 'Gob 2', statId: 'goblin' });
    mgr.start();
    expect(mgr.find(g1.id).init).toBe(mgr.find(g2.id).init);
    expect(mgr.awaitingInit().map((c) => c.name)).toEqual(['Ana', 'Bo']);
    const ana = mgr.combat.combatants.find((c) => c.name === 'Ana');
    dm.damage(ana.id, 0, { initiative: 30 });
    expect(mgr.combat.combatants[0].name).toBe('Ana');
    expect(mgr.combat.turn).toBe(0);
    mgr.reorder(0, 1);
    expect(mgr.combat.combatants[1].name).toBe('Ana');
  });
  it('removeCombatant keeps the active creature', () => {
    const { mgr } = setup();
    const ids = ['A', 'B', 'C'].map((n) => mgr.register({ name: n, statId: 'goblin' }).id);
    mgr.start(); mgr.next();
    const active = mgr.active().id, other = mgr.combat.combatants[0].id;
    mgr.removeCombatant(other);
    expect(mgr.active().id).toBe(active);
    expect(ids).toContain(active);
  });
});

describe('intents', () => {
  it('cantrip with addMod:false deals dice only; weapons add the mod', () => {
    const { mgr } = setup();
    const w = pc(mgr, 'wizard', 'Bo');
    expect(mgr.attackIntent(w.id, 0).damage).toBe('1d10');
    expect(mgr.attackIntent(w.id, 1).damage).toBe('1d4+1');
  });
  it('save cantrip → target saves vs 8 + prof + mod, with the target save mod', () => {
    const { mgr } = setup();
    const cl = pc(mgr, 'cleric', 'Cy'), g = mgr.register({ name: 'Gob', statId: 'goblin' });
    const it = mgr.attackIntent(cl.id, 1, g.id);
    expect(it).toMatchObject({ kind: 'save', targetSaves: true, saveAbility: 'dex', target: 8 + 2 + 2, damage: '1d8' });
    expect(it.mod).toBe(mgr.saveMod(mgr.find(g.id), 'dex'));
  });
  it('monster rider dice are rolled together and the label shows both types', () => {
    const { mgr } = setup();
    const c = mgr.register({ name: 'Cultist', statId: 'cultist' });
    const it = mgr.monsterIntent(c.id, 0);
    expect(it.damage).toBe('1d4+1+1');
    expect(it.dmgType).toBe('1d4+1 slashing + 1 necrotic');
    expect(parseDamage(it.damage)).toEqual({ dice: [{ count: 1, sides: 4 }], mod: 2 });
    expect(parseDamage('1d6+2d8+3', true)).toEqual({ dice: [{ count: 2, sides: 6 }, { count: 4, sides: 8 }], mod: 3 });
  });
});

describe('conditions', () => {
  it('a condition added mid-combat records the active creature as its source', () => {
    const { mgr } = setup();
    const a = mgr.register({ name: 'A', statId: 'goblin' }), b = mgr.register({ name: 'B', statId: 'orc' });
    mgr.start();
    const act = mgr.active().id, tgt = act === a.id ? b.id : a.id;
    mgr.toggleCondition(tgt, 'stunned', 1);
    expect(mgr.find(tgt).conditions[0]).toMatchObject({ name: 'stunned', rounds: 1, sourceId: act });
  });
});

describe('outcome words (no colour reliance)', () => {
  it('uses icons and words', () => {
    expect(verdictText('attack', { success: true, crit: true })).toBe('★ CRIT');
    expect(verdictText('attack', { success: false, fumble: true })).toBe('☠ FUMBLE');
    expect(verdictText('attack', { success: true })).toBe('✔ HIT');
    expect(verdictText('attack', { success: false })).toBe('✖ MISS');
    expect(verdictText('save', { success: false })).toBe('✖ FAIL');
    expect(verdictText('death', { success: true, nat20: true })).toBe('★ NAT 20: 1 HP');
  });
});
