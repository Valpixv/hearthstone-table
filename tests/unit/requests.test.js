// Player requests (design/flexibility-plan.md §5, §5b, §8): validation, the queue, approve / edit / deny, auto-approve, auto-join.
import { describe, it, expect, beforeEach } from 'vitest';
import { Requests, validateRequest, describeRequest, claimPlayerToken, markAway, hpBand } from '../../src/net/Requests.js';
import { TokenManager } from '../../src/tokens/TokenManager.js';
import { publicState } from '../../src/net/TableSync.js';

/** A DM stand-in: no scene, a data-only TokenManager, and a captured outbox. */
function setup({ role = 'dm' } = {}) {
  const dm = { state: { tokens: [], settings: {}, combat: {}, narration: null }, emit() {}, narrate(t) { this.state.narration = t; }, setMusic(m) { this.state.music = m; } };
  const T = new TokenManager({ dm }), sent = [], toasts = [];
  let clock = 1000;
  const R = new Requests({ dm, executors: {}, isDM: () => role === 'dm', me: () => 'me', send: (m) => sent.push(m), toast: (t) => toasts.push(t), now: () => clock }).install();
  const aria = T.spawn({ name: 'Aria', kind: 'pc', owner: 'p1', hp: 12, maxHp: 12 })[0];
  const bram = T.spawn({ name: 'Bram', kind: 'pc', owner: 'p2' })[0];
  const gob = T.spawn({ name: 'Goblin 2', kind: 'monster', hp: 7, maxHp: 7 })[0];
  return { dm, T, R, sent, toasts, aria, bram, gob, tick: (ms) => { clock += ms; } };
}
const req = (type, payload, from = 'p1', rid = `r${Math.random()}`) => ({ t: 'req', op: 'act', type, payload, rid, from, roll: '1d8+4 = 12' });

describe('validation (on the DM machine)', () => {
  let s; beforeEach(() => { s = setup(); });
  it('sheet edits and initiative: own token only', () => {
    expect(validateRequest('update', { id: s.aria.id, patch: { name: 'Ari' } }, 'p1', s.T.list).ok).toBe(true);
    expect(validateRequest('update', { id: s.bram.id, patch: { name: 'X' } }, 'p1', s.T.list).ok).toBe(false);
    expect(validateRequest('initiative', { id: s.gob.id, value: 15 }, 'p1', s.T.list).ok).toBe(false);
    expect(validateRequest('initiative', { id: s.aria.id, value: 15 }, 'p1', s.T.list).ok).toBe(true);
  });
  it('players cannot touch their own HP through the sheet', () => {
    expect(validateRequest('update', { id: s.aria.id, patch: { hp: 99 } }, 'p1', s.T.list).ok).toBe(false);
    expect(validateRequest('update', { id: s.aria.id, patch: { model: 'goblin' } }, 'p1', s.T.list).ok).toBe(false);
  });
  it('hp / condition / stat / spawn / narrate may target anything', () => {
    expect(validateRequest('hp', { id: s.gob.id, expr: '-12' }, 'p1', s.T.list).ok).toBe(true);
    expect(validateRequest('condition', { id: s.bram.id, name: 'prone', on: true }, 'p1', s.T.list).ok).toBe(true);
    expect(validateRequest('stat', { id: s.gob.id, key: 'ac', value: 9 }, 'p1', s.T.list).ok).toBe(true);
    expect(validateRequest('narrate', { text: 'Hi' }, 'p1', s.T.list).ok).toBe(true);
  });
  it('DM-only types and removing another player are refused', () => {
    for (const t of ['combat.start', 'combat.next', 'setup.save', 'setup.load', 'settings', 'kick']) expect(validateRequest(t, {}, 'p1', s.T.list).ok).toBe(false);
    expect(validateRequest('remove', { id: s.bram.id }, 'p1', s.T.list).ok).toBe(false);
    expect(validateRequest('remove', { id: s.gob.id }, 'p1', s.T.list).ok).toBe(true);
  });
  it('describes a damage request for the card', () => {
    expect(describeRequest('hp', { id: s.gob.id, expr: '-12' }, s.T.list)).toBe('Damage 12 → Goblin 2');
  });
});

describe('queue: approve, edit & approve, deny', () => {
  it('a player changing their own hit points waits for the DM, then applies directly (no self-strike)', () => {
    const s = setup(); const before = s.aria.hp;
    s.dm.strikes = s.dm.strikes || {}; s.dm.state.settings = { ...(s.dm.state.settings || {}), gestureRelease: true }; // the strike path is live
    s.R.receive(req('hp', { id: s.aria.id, expr: '-2' }, 'p1', 'own'), { name: 'Aria' });
    expect(s.R.queue).toHaveLength(1); expect(s.aria.hp).toBe(before);
    s.R.approve('own'); expect(s.aria.hp).toBe(before - 2);
  });
  it('a player healing themselves waits for the DM too', () => {
    const s = setup(); s.aria.hp = 5;
    s.R.receive(req('hp', { id: s.aria.id, expr: '+4' }, 'p1', 'heal'), { name: 'Aria' });
    expect(s.R.queue).toHaveLength(1); expect(s.aria.hp).toBe(5);
    s.R.approve('heal'); expect(s.aria.hp).toBe(9);
  });
  it('queues, then approve executes and notifies', () => {
    const s = setup(); s.R.receive(req('hp', { id: s.gob.id, expr: '-5' }, 'p1', 'a'), { name: 'Aria' });
    expect(s.R.queue).toHaveLength(1); expect(s.gob.hp).toBe(7); expect(s.toasts[0]).toMatch(/Aria asks: Damage 5 → Goblin 2/);
    s.R.approve('a');
    expect(s.gob.hp).toBe(2); expect(s.R.queue).toHaveLength(0);
    expect(s.sent.at(-1)).toMatchObject({ t: 'reqResult', to: 'p1', rid: 'a', status: 'approved' });
  });
  it('edit & approve changes amount and target', () => {
    const s = setup(); s.R.receive(req('hp', { id: s.gob.id, expr: '-5' }, 'p1', 'b'));
    s.R.approve('b', { id: s.bram.id, expr: '-3' });
    expect(s.gob.hp).toBe(7); expect(s.bram.hp).toBe(7);
    expect(s.sent.at(-1)).toMatchObject({ status: 'edited', label: 'Damage 3 → Bram' });
  });
  it('deny leaves the table untouched', () => {
    const s = setup(); s.R.receive(req('update', { id: s.aria.id, patch: { name: 'Ari' } }, 'p1', 'c'));
    s.R.deny('c'); expect(s.aria.name).toBe('Aria'); expect(s.sent.at(-1).status).toBe('denied');
  });
  it('invalid requests are denied at once, never queued', () => {
    const s = setup(); s.R.receive(req('update', { id: s.bram.id, patch: { name: 'X' } }, 'p1', 'd'));
    expect(s.R.queue).toHaveLength(0); expect(s.sent.at(-1)).toMatchObject({ rid: 'd', status: 'denied' });
  });
});

describe('auto-approve and approve-all', () => {
  it('per-type switch (off by default)', () => {
    const s = setup(); s.R.receive(req('initiative', { id: s.aria.id, value: 17 }, 'p1', 'e')); expect(s.R.queue).toHaveLength(1);
    s.R.setAutoApprove('initiative', true); s.R.receive(req('initiative', { id: s.aria.id, value: 18 }, 'p1', 'f'));
    expect(s.aria.init).toBe(18); expect(s.R.queue).toHaveLength(1);
    expect(s.dm.state.settings.autoApprove.initiative).toBe(true);
  });
  it('approve all from a player lasts until the turn changes', () => {
    const s = setup(); s.dm.state.combat.active = true; s.dm.state.combat.round = 1; s.dm.state.combat.turn = 0;
    s.R.receive(req('narrate', { text: 'A' }, 'p1', 'g')); s.R.receive(req('narrate', { text: 'B' }, 'p2', 'h'));
    s.R.approveAllFrom('p1');
    expect(s.dm.state.narration).toBe('A'); expect(s.R.queue.map((r) => r.rid)).toEqual(['h']);
    s.R.receive(req('music', { name: 'battle' }, 'p1', 'i')); expect(s.dm.state.music).toBe('battle');
    s.dm.state.combat.turn = 1; s.R.receive(req('music', { name: 'tavern' }, 'p1', 'j')); expect(s.R.find('j')).toBeTruthy();
  });
});

describe('player side', () => {
  it('dm.act sends a req and nothing applies locally; the result updates the pending entry', () => {
    const s = setup({ role: 'player' });
    const rid = s.dm.act('update', { id: s.aria.id, patch: { name: 'Ari' } });
    expect(s.aria.name).toBe('Aria');
    expect(s.sent[0]).toMatchObject({ t: 'req', op: 'act', type: 'update', rid, from: 'me' });
    expect(s.R.mine.get(rid).status).toBe('pending');
    s.R.onResult({ rid, status: 'denied', reason: 'no' }); expect(s.R.mine.get(rid).status).toBe('denied');
  });
});

describe('auto-join, away, hp visibility', () => {
  it('creates a PC once, reclaims by name on rejoin, marks away on leave', () => {
    const s = setup(), before = s.T.list.length;
    const t = claimPlayerToken(s.T, { id: 'p9', name: 'Cyra', seat: 2 });
    expect(t).toMatchObject({ kind: 'pc', owner: 'p9', name: 'Cyra', hp: 10, maxHp: 10 }); expect(s.T.list).toHaveLength(before + 1);
    claimPlayerToken(s.T, { id: 'p9', name: 'Cyra' }); expect(s.T.list).toHaveLength(before + 1);
    markAway(s.T, new Set(['p1', 'p2'])); expect(t.away).toBe(true);
    const back = claimPlayerToken(s.T, { id: 'p10', name: 'cyra' }, new Set(['p10']));
    expect(back).toBe(t); expect(t.owner).toBe('p10'); expect(t.away).toBe(false); expect(s.T.list).toHaveLength(before + 1);
  });
  it('publicState: exact by default, approx → band, hidden → stripped; secret rolls gone', () => {
    const s = setup(); s.gob.hp = 1; s.gob.hpVisibility = 'approx'; s.bram.hpVisibility = 'hidden'; s.dm.state.secretRolls = [{ value: 20 }];
    const p = publicState(s.dm.state), byName = (n) => p.tokens.find((t) => t.name === n);
    expect(byName('Aria').hp).toBe(12);
    expect(byName('Goblin 2')).toMatchObject({ hpBand: 'critical' }); expect(byName('Goblin 2').hp).toBeUndefined();
    expect(byName('Bram').hp).toBeUndefined(); expect(byName('Bram').maxHp).toBeUndefined();
    expect(p.secretRolls).toBeUndefined();
    expect(hpBand({ hp: 6, maxHp: 10 })).toBe('healthy');
  });
});
