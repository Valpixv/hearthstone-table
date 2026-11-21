// Fallback hand ray in the style of Meta's system pointer, for browsers that give a tracked hand no target ray.
// The ray starts at an estimated shoulder and passes through a point between the thumb and index knuckles. That point
// barely moves when you pinch, so the ray stays still while you click (the old wrist→knuckle ray jumped).
import { sub, add, scale, norm } from './gestures.js';

/** Body offsets (metres) from the eyes to the shoulders. */
export const RAY_CFG = { shoulderDown: 0.17, shoulderSide: 0.16, shoulderBack: 0.06 };

/**
 * @param {object} joints WebXR joint map ({ name: { p } })
 * @param {{ p: number[], right: number[], fwd: number[] }} head eye position, unit right and forward (level)
 * @param {'left'|'right'} handedness
 * @returns {{ origin: number[], dir: number[] } | null} origin at the pinch point
 */
export function shoulderRay(joints, head, handedness = 'right', C = RAY_CFG) {
  const a = joints?.['thumb-phalanx-proximal']?.p || joints?.['thumb-metacarpal']?.p, b = joints?.['index-finger-phalanx-proximal']?.p;
  if (!a || !b || !head?.p) return null;
  const s = handedness === 'left' ? -1 : 1;
  const shoulder = add(add(add(head.p, [0, -C.shoulderDown, 0]), scale(head.right, s * C.shoulderSide)), scale(head.fwd || [0, 0, -1], -C.shoulderBack));
  const through = scale(add(a, b), 0.5), d = sub(through, shoulder);
  if (Math.hypot(...d) < 0.05) return null; // hand at the shoulder: no sensible direction
  return { origin: through, dir: norm(d) };
}

/** Pinch strength 0..1 from the thumb–index tip gap (for the cursor that shrinks as you pinch). */
export function pinchStrength(joints, open = 0.06, closed = 0.015) {
  const t = joints?.['thumb-tip']?.p, i = joints?.['index-finger-tip']?.p; if (!t || !i) return 0;
  const d = Math.hypot(t[0] - i[0], t[1] - i[1], t[2] - i[2]);
  return Math.max(0, Math.min(1, (open - d) / (open - closed)));
}
