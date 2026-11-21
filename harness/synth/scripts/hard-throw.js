// The canonical example from the brief: grab, wind up and throw into the tray.
import { hand } from '../hand.js';
import { onTable, above, setupDice, TRAY_CENTER, GRIP_CLEARANCE } from '../scene.js';

export const description = 'Fist-grab a d20 from the table and throw it hard (3 m/s release) into the dice tray.';
export const DIE = onTable(0.0, 0.33);

export default function build() {
  return hand('right')
    .at([0.06, 1.0, 0.52], { anchor: 'palm' })
    .moveTo(above(DIE, 0.15), 0.5)
    .moveTo(above(DIE, GRIP_CLEARANCE), 0.35, { ease: 'outCubic' })
    .grab(0.2)
    .wait(0.1)
    .arcThrow(DIE, TRAY_CENTER, 3.0)
    .open(0.2)
    .moveTo([0.1, 1.05, 0.5], 0.6, { anchor: 'palm' })
    .record({
      name: 'hard-throw',
      description,
      setup: setupDice(['d20', [DIE[0], DIE[1] + 0.006, DIE[2]]]),
      expect: { inTray: true, roll: true },
    });
}
