// grab-and-hold where tracking drops out for a few frames at a time (real Quest behaviour).
import { script, DIE } from './grab-and-hold.js';
import { setupDice } from '../scene.js';

export const description = 'grab-and-hold where the hand vanishes for 2-frame tracking dropouts (~3% of frames).';
export const NOISE = { jitter: 0.001, dropoutProb: 0.03, dropoutFrames: 2, seed: 11 };

export default function build() {
  return script()
    .noise(NOISE)
    .record({
      name: 'dropout-grab',
      description,
      setup: setupDice(['d6', DIE]),
      expect: { held: 'die must survive brief tracking loss' },
    });
}
