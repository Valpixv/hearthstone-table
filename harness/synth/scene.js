// Table layout used by the canned gesture scripts. Read from the app's physics module so the
// recordings follow the real table; fall back to the values the app shipped with.

import * as Physics from '../../src/physics/Physics.js';

export const TABLE_TOP = Physics.TABLE_TOP ?? 0.78;
export const TRAY = Physics.TRAY ?? { x: 0.42, z: 0.05, w: 0.56, d: 0.5, rim: 0.05, t: 0.02 };
export const FELT_TOP = TABLE_TOP + 0.01;
export const TRAY_CENTER = [TRAY.x, FELT_TOP, TRAY.z];

/** Pinch-to-spawn pouch (see DECISIONS.md). */
export const DICE_POUCH = Physics.DICE_POUCH ?? { x: 0.62, y: TABLE_TOP + 0.06, z: 0.36, r: 0.06, type: 'd20' };
export const POUCH_CENTER = [DICE_POUCH.x, DICE_POUCH.y, DICE_POUCH.z];

/** Half-height of a resting d6 (DiceFactory: box edge R * 1.45, R = 0.022). */
export const D6_HALF = (0.022 * 1.45) / 2;

/** Centre of a d6 resting on the bare table at (x, z). */
export const onTable = (x, z) => [x, TABLE_TOP + D6_HALF + 0.001, z];
/** Centre of a d6 resting on the tray felt at (x, z). */
export const onFelt = (x, z) => [x, FELT_TOP + D6_HALF + 0.001, z];

/** Scene setup block stored in recording meta; the app applies it when replaying. */
export const setupDice = (...dice) => ({ clearDice: true, dice: dice.map(([type, pos, rot]) => (rot ? { type, pos, rot } : { type, pos })) });

/** Above a point by `h` metres. */
export const above = (p, h) => [p[0], p[1] + h, p[2]];

/**
 * How far above a die's centre to put the 'grip' anchor before closing the fist. The app's
 * fingertips are physics colliders; closing lower than this sweeps them through the die and
 * knocks it away before the grab registers. Fist grabs reach 9 cm, so 6 cm is safe.
 */
export const GRIP_CLEARANCE = 0.06;
