// grab-and-hold with realistic Quest-style tracking error layered on top.
import { script, DIE } from './grab-and-hold.js';
import { setupDice } from '../scene.js';

export const description =
  'grab-and-hold with tracking noise: 3 mm joint jitter, 5 mm drift, 2 deg rotation noise and occasional 1 cm single-joint spikes.';
export const NOISE = { jitter: 0.003, drift: 0.005, rotJitter: 2, spikeProb: 0.01, spikeSize: 0.01, seed: 7 };

export default function build() {
  return script()
    .noise(NOISE)
    .record({
      name: 'jitter-grab',
      description,
      setup: setupDice(['d6', DIE]),
      expect: { held: 'die must not be dropped by tracking noise' },
    });
}
