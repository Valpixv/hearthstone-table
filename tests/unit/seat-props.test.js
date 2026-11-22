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
