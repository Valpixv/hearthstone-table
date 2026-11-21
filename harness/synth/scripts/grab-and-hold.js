// Close a fist on a d6, lift it and carry it around. Ends still holding it.
import { hand } from '../hand.js';
import { onTable, above, setupDice, GRIP_CLEARANCE } from '../scene.js';

export const description = 'Fist-grab a d6 from the table, lift it and carry it left then right; ends holding it.';
export const DIE = onTable(0.0, 0.32);

export function script() {
  return hand('right')
    .at([0.06, 1.0, 0.52], { anchor: 'palm' })
    .moveTo(above(DIE, 0.15), 0.5)
    .moveTo(above(DIE, GRIP_CLEARANCE), 0.35, { ease: 'outCubic' })
    .grab(0.2)
    .wait(0.15)
    .moveTo(above(DIE, 0.2), 0.5)
    .moveTo([-0.15, DIE[1] + 0.25, 0.3], 0.7)
    .moveTo([0.1, DIE[1] + 0.22, 0.25], 0.7)
    .wait(0.4);
}

export default function build() {
  return script().record({
    name: 'grab-and-hold',
    description,
    setup: setupDice(['d6', DIE]),
    expect: { held: 'd6 stays attached to the right hand after the grab' },
  });
}
