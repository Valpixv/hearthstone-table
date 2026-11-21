// Who owns a hand this frame (design/vr-hands-plan.md §3), Meta's rule: Touch > Grab > Ray.
//  - 'drag'  : the hand is already dragging something with its ray (a window, a creature, a pull) — it keeps it
//  - 'grab'  : the hand holds a die / mini / prop
//  - 'touch' : the index fingertip is close in front of a panel — the ray hides, the finger works the panel
//  - 'ui'    : the ray is on a panel
//  - 'world' : the ray is on something in the room it can act on (DM creatures, the table with a tool)
//  - null    : free — battle gestures may listen
// Pure, so it is unit-tested.

/** @param {{ dragging?: boolean, holding?: boolean, tipNear?: boolean, rayOnPanel?: boolean, rayOnWorld?: boolean }} s */
export function handOwner(s = {}) {
  if (s.dragging) return 'drag';
  if (s.tipNear) return 'touch';
  if (s.holding) return 'grab';
  if (s.rayOnPanel) return 'ui';
  if (s.rayOnWorld) return 'world';
  return null;
}

/** Owners during which battle gestures must not listen. */
export const BLOCKS_GESTURES = new Set(['drag', 'grab', 'touch', 'ui']);

/**
 * Poke state machine for one fingertip on one panel (hover → contact → lift), with hysteresis and a tap/scroll split.
 * Distances are metres in front of the panel (negative = behind it).
 */
export const POKE_CFG = { near: 0.08, hover: 0.03, press: 0.006, release: 0.015, scrollPx: 28, tapMovePx: 34 };

/**
 * Steps a poke. st is mutable state ({} to start). Returns an event:
 *   { type: 'hover' } | { type: 'contact' } | { type: 'scroll', dy } | { type: 'tap', x, y } | { type: 'lift' } | null
 * @param {object} st
 * @param {{ x: number, y: number, z: number } | null} c fingertip in panel coordinates (null: outside the panel)
 */
export function stepPoke(st, c, C = POKE_CFG) {
  if (!c) { const was = st.down; st.down = false; st.hover = false; return was ? { type: 'lift' } : null; }
  if (!st.down) {
    st.hover = c.z < C.hover && c.z > -C.release;
    if (c.z < C.press && c.z > -0.05 && st.armed !== false) { st.down = true; st.armed = false; st.x0 = c.x; st.y0 = c.y; st.lastY = c.y; st.scrolling = false; return { type: 'contact' }; }
    if (c.z > C.release) st.armed = true;
    return st.hover ? { type: 'hover' } : null;
  }
  if (c.z > C.release || c.z < -0.06) { // lifted (or pushed far through: treat as a lift)
    st.down = false; st.armed = c.z > C.release; // pulled back: ready for the next press
    const moved = Math.hypot(c.x - st.x0, c.y - st.y0);
    return !st.scrolling && moved < C.tapMovePx ? { type: 'tap', x: st.x0, y: st.y0 } : { type: 'lift' };
  }
  if (!st.scrolling && Math.abs(c.y - st.y0) > C.scrollPx) st.scrolling = true;
  if (st.scrolling) { const dy = c.y - st.lastY; st.lastY = c.y; return { type: 'scroll', dy }; }
  return null;
}
