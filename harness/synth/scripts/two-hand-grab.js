// Both hands grab a die each at the same time, lift them and bring them together.
import { hand, recordHands } from '../hand.js';
import { onTable, above, setupDice, GRIP_CLEARANCE } from '../scene.js';

export const description = 'Left and right fists each grab a d6 simultaneously, lift both and bring them together; ends holding both.';
export const LEFT_DIE = onTable(-0.12, 0.3);
export const RIGHT_DIE = onTable(0.12, 0.3);

const grabAndLift = (side, die, meet) =>
  hand(side)
    .at([die[0], 1.0, 0.52], { anchor: 'palm' })
    .moveTo(above(die, 0.15), 0.5)
    .moveTo(above(die, GRIP_CLEARANCE), 0.35, { ease: 'outCubic' })
    .grab(0.2)
    .wait(0.15)
    .moveTo(above(die, 0.22), 0.5)
    .moveTo(meet, 0.6)
    .wait(0.5);

export default function build() {
  const y = LEFT_DIE[1] + 0.22;
  return recordHands([grabAndLift('left', LEFT_DIE, [-0.05, y, 0.28]), grabAndLift('right', RIGHT_DIE, [0.05, y, 0.28])], {
    name: 'two-hand-grab',
    description,
    setup: setupDice(['d6', LEFT_DIE], ['d6', RIGHT_DIE]),
    expect: { heldCount: 2 },
  });
}
