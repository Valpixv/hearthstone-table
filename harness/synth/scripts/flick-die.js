// Curl the index behind a die and snap it straight.
import { hand } from '../hand.js';
import { onTable, setupDice, D6_HALF } from '../scene.js';

export const description = 'Curl the index finger just behind a d6 and snap it straight, flicking the die away (-z).';
export const DIE = onTable(-0.1, 0.3);

export default function build() {
  // The curled index tip waits 3 mm behind the die's back face. The hand is pitched up 50 deg so
  // the finger unrolls forward into the die instead of down into the table, and the snap
  // accelerates (inCubic) so the first contact is shallow and the tip then drives through at
  // ~2.6 m/s. A fast start would teleport the 9 mm tip collider inside the die in one 1/72 s
  // tick, where cannon-es finds no contact (see DECISIONS.md).
  const ready = [DIE[0], DIE[1] + 0.005, DIE[2] + D6_HALF + 0.009 + 0.003];
  return hand('right')
    .at([-0.06, 1.0, 0.55], { anchor: 'palm', rot: [50, 0, 0] })
    .moveTo([ready[0], ready[1] + 0.12, ready[2]], 0.5, { anchor: 'index-finger-tip', pose: 'flickReady' })
    .moveTo(ready, 0.35, { anchor: 'index-finger-tip', ease: 'outCubic' })
    .wait(0.15)
    .flick([0, 0.05, -1], { distance: 0.05, duration: 0.18, readyDur: 0, ease: 'inCubic' })
    .moveTo([-0.05, 1.0, 0.55], 0.5, { anchor: 'palm', pose: 'open', rot: [0, 0, 0] })
    .record({
      name: 'flick-die',
      description,
      setup: setupDice(['d6', DIE]),
      expect: { dieMoved: true, held: false },
    });
}
