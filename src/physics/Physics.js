import * as CANNON from 'cannon-es';
import { seatLayout, trayToWorld, LEGACY_LAYOUT, TABLE_SIZE } from '../table/layout.js';

export const TABLE_TOP = 0.78;
export const TABLE = TABLE_SIZE;
const L0 = seatLayout(0);
/**
 * The local player's dice tray. Mutable: Physics.setTray() moves it in front of the player's seat, and everything that
 * reads TRAY (dice spawn points, the roll label fallback) follows. x/z: centre; yaw: rotation about +y; w × d: felt size.
 */
export const TRAY = { x: L0.tray.x, z: L0.tray.z, yaw: L0.tray.yaw, w: L0.tray.w, d: L0.tray.d, rim: 0.05, t: 0.02 };
/** Pinch inside the pouch to pull out a fresh die straight into your hand. Mutable with the tray. */
export const DICE_POUCH = { x: L0.pouch.x, y: TABLE_TOP + 0.06, z: L0.pouch.z, r: 0.06, type: 'd20' };

/** A point in tray space (x to the player's right, z toward the player) as world [x, z]. */
export const trayPoint = (lx, lz) => trayToWorld(TRAY, lx, lz);

export class Physics {
  // deterministic: one fixed step per frame regardless of wall-clock dt (replay/test mode).
  constructor({ fixedStep = 1 / 120, deterministic = false } = {}) {
    this.fixedStep = fixedStep; this.deterministic = deterministic;
    const w = (this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) }));
    w.allowSleep = true;
    w.broadphase = new CANNON.SAPBroadphase(w);
    w.solver.iterations = 12;
    this.mDice = new CANNON.Material('dice');
    this.mFelt = new CANNON.Material('felt');
    this.mWood = new CANNON.Material('wood');
    w.addContactMaterial(new CANNON.ContactMaterial(this.mDice, this.mFelt, { friction: 0.35, restitution: 0.25 }));
    w.addContactMaterial(new CANNON.ContactMaterial(this.mDice, this.mWood, { friction: 0.25, restitution: 0.4 }));
    w.addContactMaterial(new CANNON.ContactMaterial(this.mDice, this.mDice, { friction: 0.2, restitution: 0.35 }));
    this.trayBodies = [];
    this.buildStatic();
  }

  addBox(hx, hy, hz, x, y, z, mat) {
    const b = new CANNON.Body({ mass: 0, material: mat, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)) });
    b.position.set(x, y, z); this.world.addBody(b); return b;
  }

  buildStatic() {
    // Floor
    const floor = new CANNON.Body({ mass: 0, material: this.mWood, shape: new CANNON.Plane() });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0); this.world.addBody(floor);
    // Table top
    this.addBox(TABLE.w / 2, 0.025, TABLE.d / 2, 0, TABLE_TOP - 0.025, 0, this.mWood);
    // Felt tray floor (slightly raised) and rim walls, kept as tray-local boxes so the tray can move to any seat.
    const { w: tw, d, rim } = TRAY;
    // Physics walls are 8 cm thick (extending outward from the visible 2 cm rim) so fast throws can't tunnel through.
    // The far wall (and the sides, except in the original layout where only the right one is) is taller and invisible above the rim.
    const T = 0.08, o = (T - TRAY.t) / 2, y = TABLE_TOP + rim / 2, hi = 0.1, sideHi = LEGACY_LAYOUT ? 0 : hi;
    const local = [
      [tw / 2, 0.005, d / 2, 0, TABLE_TOP + 0.005, 0, this.mFelt],
      [tw / 2 + T, rim / 2 + hi, T / 2, 0, y + hi, -d / 2 - o, this.mWood],
      [tw / 2 + T, rim / 2, T / 2, 0, y, d / 2 + o, this.mWood],
      [T / 2, rim / 2 + sideHi, d / 2, -tw / 2 - o, y + sideHi, 0, this.mWood],
      [T / 2, rim / 2 + hi, d / 2, tw / 2 + o, y + hi, 0, this.mWood],
    ];
    this.trayBodies = local.map(([hx, hy, hz, lx, ly, lz, mat]) => ({ body: this.addBox(hx, hy, hz, 0, ly, 0, mat), lx, ly, lz }));
    this.setTray(TRAY);
  }

  /**
   * Moves the dice tray (its felt and rim colliders) and the pouch in front of a seat.
   * @param {{ x: number, z: number, yaw: number }} tray from seatLayout(seat).tray
   * @param {{ x: number, z: number }} [pouch]
   */
  setTray(tray, pouch = null) {
    TRAY.x = tray.x; TRAY.z = tray.z; TRAY.yaw = tray.yaw || 0;
    if (pouch) { DICE_POUCH.x = pouch.x; DICE_POUCH.z = pouch.z; }
    for (const t of this.trayBodies) {
      const [x, z] = trayPoint(t.lx, t.lz);
      t.body.position.set(x, t.ly, z); t.body.quaternion.setFromEuler(0, TRAY.yaw, 0);
      t.body.aabbNeedsUpdate = true; t.body.updateAABB?.();
    }
  }

  step(dt) {
    if (this.deterministic) this.world.step(this.fixedStep);
    else this.world.step(this.fixedStep, Math.min(dt, 0.1), 6);
  }
}
