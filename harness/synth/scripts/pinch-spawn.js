// Pinch inside the dice pouch to pull out a new d20, carry it over the tray and drop it.
import { hand } from '../hand.js';
import { above, setupDice, POUCH_CENTER, TRAY_CENTER, onTable } from '../scene.js';

export const description = 'Pinch inside the dice pouch to spawn a d20 into the hand, carry it over the tray and release.';
// One unrelated die well away (>6 cm) from the pouch so the pinch hits the pouch, not a die.
export const OTHER_DIE = onTable(-0.3, 0.3);

export default function build() {
  return hand('right')
    .at([0.45, 1.0, 0.55], { anchor: 'palm' })
    .moveTo(above(POUCH_CENTER, 0.12), 0.5, { anchor: 'pinch-grip' })
    .moveTo(POUCH_CENTER, 0.35, { anchor: 'pinch-grip', ease: 'outCubic' })
    .pinch(0.2)
    .wait(0.2)
    .moveTo(above(POUCH_CENTER, 0.18), 0.45, { anchor: 'pinch-grip' })
    .moveTo(above(TRAY_CENTER, 0.15), 0.7, { anchor: 'pinch-grip' })
    .wait(0.3)
    .releasePinch(0.25)
    .moveBy([0, 0.12, 0.12], 0.5, { anchor: 'palm' })
    .record({
      name: 'pinch-spawn',
      description,
      setup: setupDice(['d6', OTHER_DIE]),
      expect: { diceCountDelta: 1, roll: true },
    });
}
