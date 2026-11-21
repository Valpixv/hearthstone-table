// Jab a resting die with the index fingertip.
import { hand } from '../hand.js';
import { onTable, setupDice } from '../scene.js';

export const description = 'Point and jab a resting d6 with the index fingertip from the front; it should slide away.';
export const DIE = onTable(0.0, 0.3);

export default function build() {
  return hand('right')
    .at([0.06, 1.0, 0.55], { anchor: 'palm', rot: [-18, 0, 0] })
    .poke([DIE[0], DIE[1] + 0.006, DIE[2]], { approach: [0, -0.32, -1] })
    .moveTo([0.1, 1.0, 0.55], 0.5, { anchor: 'palm' })
    .record({
      name: 'poke-die',
      description,
      setup: setupDice(['d6', DIE]),
      expect: { dieMoved: true, held: false },
    });
}
