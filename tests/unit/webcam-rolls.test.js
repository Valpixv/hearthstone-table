import { expect, it, vi } from 'vitest';
import { CallCards } from '../../src/ui/CallCards.js';
import { WebcamHandSource } from '../../src/input/WebcamHandSource.js';
import { TABLE_TOP, TRAY, trayPoint } from '../../src/physics/Physics.js';

function request(expr) {
  const dm = { act: vi.fn(), state: {
    calls: [{ id: 'request', to: 'hero', status: 'open', expr }],
    tokens: [{ id: 'hero', owner: 'player' }],
  } };
  const tray = {};
  const cards = new CallCards({ dm, sync: { role: 'player', me: { id: 'player' } }, tray, doc: null });
  const throwDice = (sides, ...values) => tray.onResult({
    label: 'Hand-thrown', roll: { dice: values.map((value) => ({ sides, value })) },
  });
  return { cards, dm, throwDice };
}

it('waits for the requested physical dice and applies the damage modifier', () => {
  const { dm, throwDice } = request('2d6+3');
  throwDice(20, 14);
  throwDice(6, 4);
  expect(dm.act).not.toHaveBeenCalled();
  throwDice(6, 4, 5);
  expect(dm.act).toHaveBeenCalledWith('call.answer', { id: 'request', total: 12, nat: null, text: '4 + 5 + 3' });
});

it.each([['kh', 20, 22], ['kl', 1, 3]])('uses the kept d20 for %s and the critical result', (rule, nat, total) => {
  const { dm, throwDice } = request(`2d20${rule}1+2`);
  throwDice(20, rule === 'kh' ? 1 : 20, nat);
  expect(dm.act).toHaveBeenCalledWith('call.answer', { id: 'request', total, nat, text: `${nat} + 2` });
});

it('ignores a result for a cancelled request while another request is open', () => {
  const { dm, cards } = request('1d20');
  cards.onRoll({ callId: 'cancelled', roll: { dice: [], total: 0 } });
  expect(dm.act).not.toHaveBeenCalled();
});

it('maps the webcam hand to the current seat as the tray rotates', () => {
  const original = { ...TRAY };
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  landmarks[9].y = 0.4;
  try {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      Object.assign(TRAY, { x: 0.5, z: -0.15, yaw });
      const joints = new WebcamHandSource().toJoints(landmarks);
      expect(joints.wrist.p).toEqual([TRAY.x, TABLE_TOP + 0.08, TRAY.z]);
      const [x, z] = trayPoint(0, -0.09);
      expect(joints['middle-finger-phalanx-proximal'].p[0]).toBeCloseTo(x);
      expect(joints['middle-finger-phalanx-proximal'].p[2]).toBeCloseTo(z);
    }
  } finally { Object.assign(TRAY, original); }
});
