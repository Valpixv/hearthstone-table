// Pick a die up, hold it still over the tray and let go: it should fall in and report a roll.
import { hand } from '../hand.js';
import { onTable, above, setupDice, TRAY_CENTER, GRIP_CLEARANCE } from '../scene.js';

export const description = 'Grab a d6, carry it over the tray, stop, open the hand slowly so it drops in.';
export const DIE = onTable(0.0, 0.32);

export default function build() {
  return hand('right')
    .at([0.06, 1.0, 0.52], { anchor: 'palm' })
    .moveTo(above(DIE, 0.15), 0.5)
    .moveTo(above(DIE, GRIP_CLEARANCE), 0.35, { ease: 'outCubic' })
    .grab(0.2)
    .wait(0.15)
    .moveTo(above(TRAY_CENTER, 0.14), 0.9, { lift: 0.05 })
    .wait(0.35)
    .open(0.35)
    .moveBy([0, 0.15, 0.15], 0.5, { anchor: 'palm' })
    .record({
      name: 'gentle-drop',
      description,
      setup: setupDice(['d6', DIE]),
      expect: { inTray: true, roll: true },
    });
}
