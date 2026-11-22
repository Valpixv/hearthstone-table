// A player's hand-thrown dice answer the DM's call die by die (design/completion-plan.md §7, the action loop):
// the call's dice are laid out in the tray, each required die fills a slot, a re-throw of a die whose slots are
// full replaces the earlier throw (the last one counts), other dice are ignored, and the call is answered once,
// the moment every required die has settled.
// Story type: Logic · Gate: BLOCKING
import { expect, it, vi } from 'vitest';
import { CallCards } from '../../src/ui/CallCards.js';
import { RollService } from '../../src/rules/RollService.js';

const PLAYER = 'player';

/** A player's machine with one open call, a real RollService and a fake dice manager. */
function table(expr, extraCalls = []) {
  const dm = { act: vi.fn(), state: {
    calls: [{ id: 'call', to: 'hero', status: 'open', expr }, ...extraCalls],
    tokens: [{ id: 'hero', owner: PLAYER }],
  } };
  let nextId = 1;
  const dice = {
    locked: false, dice: [], grab: { isHeld: () => false },
    spawn(type) { const d = { id: nextId++, type, rolling: true }; this.dice.push(d); return d; },
    remove(d) { this.dice = this.dice.filter((x) => x !== d); },
  };
  const rolls = new RollService({ dice, effects: {}, dm });
  rolls.onLooseRoll = () => {};
  const tray = { rolls };
  const cards = new CallCards({ dm, sync: { role: 'player', me: { id: PLAYER } }, tray, doc: null });
  const throwDie = (type, value) => rolls.collectLoose({ type, value });
  return { cards, dm, dice, rolls, throwDie };
}

it('lays out exactly the dice the call needs and clears the old loose dice', () => {
  const { cards, dice } = table('2d6+3');
  dice.spawn('d20'); // an old die left on the tray
  cards.syncHand();
  expect(dice.dice.map((d) => d.type)).toEqual(['d6', 'd6']);
  expect(dice.dice.every((d) => d.rolling === false)).toBe(true); // ready to throw, not read until thrown
});

it('resolves 2d6 once, right after the second die settles', () => {
  const { dm, throwDie, cards } = table('2d6+3');
  throwDie('d6', 4);
  expect(dm.act).not.toHaveBeenCalled();
  expect(cards.handProgress('call')).toBe('1 of 2 d6');
  throwDie('d6', 5);
  expect(dm.act).toHaveBeenCalledTimes(1);
  expect(dm.act).toHaveBeenCalledWith('call.answer', { id: 'call', total: 12, nat: null, text: '4 + 5 + 3' });
  throwDie('d6', 6); // after the answer: nothing more
  cards.onRoll({ label: 'Hand-thrown', roll: { dice: [{ sides: 6, value: 4 }, { sides: 6, value: 5 }], total: 9 } });
  expect(dm.act).toHaveBeenCalledTimes(1);
  expect(cards.myCalls()).toEqual([]); // the prompt closes at once
});

it('counts the last throw when a die is re-thrown before the call is complete', () => {
  const { dm, throwDie } = table('1d20+1d6+2');
  throwDie('d6', 1);
  throwDie('d6', 6); // re-thrown: replaces the 1
  expect(dm.act).not.toHaveBeenCalled();
  throwDie('d20', 10);
  expect(dm.act).toHaveBeenCalledTimes(1);
  expect(dm.act).toHaveBeenCalledWith('call.answer', { id: 'call', total: 18, nat: 10, text: '10 + 6 + 2' });
});

it('ignores dice of a type the call does not need', () => {
  const { dm, throwDie, cards } = table('1d6+2');
  throwDie('d20', 20);
  throwDie('d8', 3);
  expect(dm.act).not.toHaveBeenCalled();
  expect(cards.myCalls()).toHaveLength(1);
  throwDie('d6', 4);
  expect(dm.act).toHaveBeenCalledWith('call.answer', { id: 'call', total: 6, nat: null, text: '4 + 2' });
});

it('needs both d20s for advantage and keeps the higher', () => {
  const { dm, throwDie, cards } = table('2d20kh1+5');
  throwDie('d20', 3);
  expect(dm.act).not.toHaveBeenCalled();
  expect(cards.handProgress('call')).toBe('1 of 2 d20');
  throwDie('d20', 17);
  expect(dm.act).toHaveBeenCalledTimes(1);
  expect(dm.act).toHaveBeenCalledWith('call.answer', { id: 'call', total: 22, nat: 17, text: '17 + 5' });
});

it('moves on to the next call and lays out its dice', () => {
  const { dm, throwDie, dice } = table('1d6', [{ id: 'next', to: 'hero', status: 'open', expr: '1d8' }]);
  throwDie('d6', 2);
  expect(dm.act).toHaveBeenCalledWith('call.answer', expect.objectContaining({ id: 'call', total: 2 }));
  expect(dice.dice.map((d) => d.type)).toEqual(['d8']);
  throwDie('d8', 7);
  expect(dm.act).toHaveBeenLastCalledWith('call.answer', expect.objectContaining({ id: 'next', total: 7 }));
});

it('answers once when the Roll button and the hand dice both finish', () => {
  const { dm, throwDie, cards } = table('1d6');
  cards.onRoll({ callId: 'call', roll: { dice: [{ sides: 6, value: 3 }], mod: 0, total: 3 } });
  throwDie('d6', 5);
  expect(dm.act).toHaveBeenCalledTimes(1);
  expect(dm.act).toHaveBeenCalledWith('call.answer', expect.objectContaining({ id: 'call', total: 3 }));
});
