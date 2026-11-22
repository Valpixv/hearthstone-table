// Card and satchel never sit on the corner candles, the coins, the tray or each other, at any seat.
import { describe, it, expect } from 'vitest';
// The live game uses the centred layout (no ?legacyLayout), which needs a browser-like location before import.
globalThis.location ??= { search: '' };
const { seatLayout, LEGACY_LAYOUT } = await import('../../src/table/layout.js');
const { freeSpot } = await import('../../src/scene/SeatProps.js');
const { TABLE } = await import('../../src/physics/Physics.js');
const { MAP } = await import('../../src/table/layout.js');
const offMat = ([x, z], r) => !(Math.abs(x - MAP.x) < MAP.w / 2 + r && Math.abs(z - MAP.z) < MAP.d / 2 + r);

const CX = TABLE.w / 2 - 0.07, CZ = TABLE.d / 2 - 0.07;
const FIXED = [[-CX, -CZ, 0.12], [CX, -CZ, 0.12], [-CX, CZ, 0.08], [CX, CZ, 0.08], [-CX + 0.1, -CZ + 0.02, 0.12]];
const clear = ([x, z], r) => FIXED.every(([fx, fz, fr]) => Math.hypot(x - fx, z - fz) >= fr + r - 1e-9);

describe('seat props placement', () => {
  it('tests the live (centred) layout', () => expect(LEGACY_LAYOUT).toBe(false));
  for (let seat = 0; seat < 8; seat++) {
    it(`seat ${seat}: card and satchel clear of the dressing and each other`, () => {
      const L = seatLayout(seat);
      const card = freeSpot(L, [L.card.x, L.card.z], 0.1, []);
      const bag = freeSpot(L, [L.tray.x + L.right[0] * (L.tray.w / 2 + 0.1), L.tray.z + L.right[1] * (L.tray.w / 2 + 0.1)], 0.14, [[card[0], card[1], 0.1]]);
      expect(clear(card, 0.1)).toBe(true);
      expect(clear(bag, 0.14)).toBe(true);
      expect(offMat(card, 0.1) && offMat(bag, 0.14)).toBe(true);
      expect(Math.hypot(card[0] - bag[0], card[1] - bag[1])).toBeGreaterThanOrEqual(0.24 - 1e-9);
    });
  }
});

describe('seat props touch', async () => {
  const THREE = await import('three');
  const { SeatProps, SEAT_PROPS } = await import('../../src/scene/SeatProps.js');
  const at = (x, y, z) => ({ getWorldPosition: (v) => v.set(x, y, z) });
  const fake = () => { const opened = []; return { opened, root: { visible: true }, cool: 0, card: at(0, 0.78, 0.5), bag: at(0.4, 0.78, 0.45), onOpen: (k) => opened.push(k) }; };
  const finger = (x, y, z, source = 'xr') => [{ source, grabbing: false, joints: { 'index-finger-tip': { p: [x, y, z] } } }];
  const cardTip = () => finger(0, 0.78 + SEAT_PROPS.cardH * 0.4, 0.5);
  const run = (f, hands, seconds) => { for (let t = 0; t < seconds; t += 0.05) SeatProps.prototype.update.call(f, hands, 0.05); };

  it('a finger passing through the card does not open the sheet', () => {
    const f = fake(); run(f, cardTip(), 0.2); run(f, finger(1, 1, 1), 0.5); expect(f.opened).toEqual([]);
  });
  it('a finger resting on the card opens the sheet once', () => {
    const f = fake(); run(f, cardTip(), 2); expect(f.opened).toEqual(['sheet']);
  });
  it('webcam hands never open the card or satchel', () => {
    const f = fake(); run(f, finger(0, 0.78 + SEAT_PROPS.cardH * 0.4, 0.5, 'webcam'), 2); expect(f.opened).toEqual([]);
  });
  it('the finger must leave before the sheet can open again', () => {
    const f = fake(); run(f, cardTip(), 3); expect(f.opened).toEqual(['sheet']);
    run(f, finger(1, 1, 1), 0.2); run(f, cardTip(), 1); expect(f.opened).toEqual(['sheet', 'sheet']);
  });
  void THREE;
});
