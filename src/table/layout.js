// Where things sit on and around the table (design/completion-plan.md §5.3). Pure: no three.js, no DOM.
// The table is the fixed centre of the world. The battle mat lies in its middle; every person has a seat around it
// and a personal dice tray on the table edge in front of them. Dice are local to each player, so only your own tray
// exists on your machine.
//
// `?replay` (recorded-hand tests) and Node (unit tests) keep the original layout: mat on the left, tray on the right,
// one viewer at +z. Recordings were captured against those coordinates.

/** True when the original single-viewer layout is in use. */
export const LEGACY_LAYOUT = typeof location === 'undefined' || /[?&](replay|legacyLayout)\b/.test(location.search);

/** Table top size (metres). Mirrors Physics.TABLE. */
export const TABLE_SIZE = { w: 1.7, d: 1.3 };
/** The battle mat: centre and size on the table top (metres). 70 ft × ~49 ft at 5 ft per square. */
export const MAP = LEGACY_LAYOUT ? { x: -0.42, z: 0.05, w: 0.74, d: 0.52 } : { x: 0, z: 0, w: 0.74, d: 0.52 };

/** Personal dice tray size (metres): w across the player, d away from them. */
export const TRAY_SIZE = LEGACY_LAYOUT ? { w: 0.56, d: 0.5 } : { w: 0.42, d: 0.28 };
/** Gap between the mat and a tray, and how far a person sits from the table edge. */
export const LAYOUT_CFG = { gap: 0.035, sitBack: 0.32, eye: 1.2, maxSeats: 8 };

/**
 * Seat anchors: side of the table and position along that side (-1..1). Seat 0 is the head of the table (the first
 * person in, normally the DM); the next seats alternate around it so a small party spreads out.
 */
const ANCHORS = [
  ['front', 0], ['right', 0], ['left', 0], ['back', 0],
  ['front', 0.72], ['front', -0.72], ['back', 0.72], ['back', -0.72],
];

/**
 * Everything about one seat.
 * @param {number} seat seat index from the server (wraps after LAYOUT_CFG.maxSeats)
 * @returns {{ seat: number, side: string, pos: [number, number], yaw: number, fwd: [number, number], right: [number, number],
 *   tray: { x: number, z: number, yaw: number, w: number, d: number }, pouch: { x: number, z: number }, card: { x: number, z: number, yaw: number } }}
 *   pos: where the person is (floor x, z). yaw: rotation about +y that turns "-z" into the person's forward.
 *   fwd / right: unit vectors (x, z) toward the table and to the person's right.
 */
export function seatLayout(seat = 0) {
  const i = ((Math.floor(seat) % ANCHORS.length) + ANCHORS.length) % ANCHORS.length;
  if (LEGACY_LAYOUT) {
    return { seat: i, side: 'front', pos: [0, 0.75], yaw: 0, fwd: [0, -1], right: [1, 0],
      tray: { x: 0.42, z: 0.05, yaw: 0, w: TRAY_SIZE.w, d: TRAY_SIZE.d }, pouch: { x: 0.62, z: 0.36 }, card: { x: -0.2, z: 0.5, yaw: 0 } };
  }
  const [side, along] = ANCHORS[i], hw = TABLE_SIZE.w / 2, hd = TABLE_SIZE.d / 2, { gap, sitBack } = LAYOUT_CFG;
  // fwd points from the person to the table; right is fwd rotated clockwise seen from above.
  const fwd = side === 'front' ? [0, -1] : side === 'back' ? [0, 1] : side === 'right' ? [-1, 0] : [1, 0];
  const right = [-fwd[1], fwd[0]];
  const edge = side === 'front' || side === 'back' ? hd : hw;             // table edge distance along -fwd
  const span = side === 'front' || side === 'back' ? hw : hd;             // half-length of that side
  const matHalf = side === 'front' || side === 'back' ? MAP.d / 2 : MAP.w / 2;
  const lat = along * (span - 0.24);                                      // offset along the side
  const at = (dist, off) => [-fwd[0] * dist + right[0] * off, -fwd[1] * dist + right[1] * off];
  const pos = at(edge + sitBack, lat);
  const trayDist = Math.min(matHalf + gap + TRAY_SIZE.d / 2, edge - TRAY_SIZE.d / 2 - 0.02);
  const trayLat = clamp(lat + 0.05, -(span - TRAY_SIZE.w / 2 - 0.03), span - TRAY_SIZE.w / 2 - 0.03);
  const [tx, tz] = at(trayDist, trayLat);
  const yaw = Math.atan2(-fwd[0], -fwd[1]);
  const [px, pz] = at(trayDist + 0.02, clamp(trayLat + TRAY_SIZE.w / 2 + 0.09, -(span - 0.08), span - 0.08));
  const [cx, cz] = at(edge - 0.11, clamp(trayLat - TRAY_SIZE.w / 2 - 0.16, -(span - 0.12), span - 0.12));
  return { seat: i, side, pos, yaw, fwd, right, tray: { x: tx, z: tz, yaw, w: TRAY_SIZE.w, d: TRAY_SIZE.d }, pouch: { x: px, z: pz }, card: { x: cx, z: cz, yaw } };
}

/** Rotates a tray-local offset (x to the player's right, z toward the player) into table x/z. */
export function trayToWorld(tray, lx, lz) {
  const c = Math.cos(tray.yaw), s = Math.sin(tray.yaw);
  return [tray.x + lx * c + lz * s, tray.z - lx * s + lz * c];
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
