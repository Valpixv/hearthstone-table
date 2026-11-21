import * as CANNON from 'cannon-es';
import { averageVelocity, clampLength, dist } from './gestures.js';
import { random } from '../core/random.js';

export const DROPOUT_GRACE = 0.15; // s a tracked hand may vanish before its held object drops
export const TIP_COOLDOWN = 0.2;   // s fingertip colliders stay off after a release

/**
 * Grabbables: { id, kind:'die'|'mini', mesh, body, holdOffsetY?, canGrab?():bool, onGrab?(), onRelease?(speed) }
 * While held the body is KINEMATIC and follows the hand; on release it becomes DYNAMIC with
 * the hand velocity averaged over the last 5 frames.
 * onEmptyGrab(hand) -> grabbable|null is called when a grab starts with nothing in reach
 * (used by the dice pouch to pull a new die straight into the hand).
 */
export class GrabSystem {
  constructor() { this.items = []; this.held = {}; this.hist = {}; this.time = 0; this.wasGrabbing = {}; this.lastSeen = {}; this.releasedAt = {}; this.holdTarget = {}; this.onEmptyGrab = null; }
  add(item) { this.items.push(item); }
  remove(item) { this.items = this.items.filter((i) => i !== item); for (const k in this.held) if (this.held[k] === item) delete this.held[k]; }
  isHeld(item) { return Object.values(this.held).includes(item); }
  heldObject() { return Object.values(this.held)[0] || null; }
  // Fingertip colliders of a hand that is holding, or just released, would kick the object.
  tipsSuppressed(id) { return !!this.held[id] || this.time - (this.releasedAt[id] ?? -1) < TIP_COOLDOWN; }

  nearest(point, radius) {
    let best = null, bd = radius;
    for (const it of this.items) {
      if (this.isHeld(it) || it.canGrab?.() === false || this.canTake?.(it) === false) continue;
      const p = it.body.position, d = dist(point, [p.x, p.y + (it.grabOffsetY || 0), p.z]);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  take(id, it) { this.held[id] = it; it.body.type = CANNON.Body.KINEMATIC; it.body.wakeUp(); it.onGrab?.(); }

  update(hands, dt) {
    this.time += dt;
    for (const h of hands) {
      if (!h.point) continue;
      this.lastSeen[h.id] = this.time;
      const hist = (this.hist[h.id] ||= []);
      hist.push({ p: h.point.slice(), t: this.time }); if (hist.length > 8) hist.shift();
      const was = this.wasGrabbing[h.id];
      if (h.grabbing && !was && !this.held[h.id]) {
        let it = (h.hint && !this.isHeld(h.hint) && h.hint.canGrab?.() !== false && this.canTake?.(h.hint) !== false && h.hint) || this.nearest(h.point, h.fist ? 0.09 : 0.06);
        if (!it && h.pinching && this.onEmptyGrab) it = this.onEmptyGrab(h);
        if (it) this.take(h.id, it);
      }
      const it = this.held[h.id];
      if (it && h.grabbing) {
        const tgt = [h.point[0], h.point[1] - (it.holdOffsetY || 0), h.point[2]];
        // Velocity from the previous hold target (the body was already integrated by v*dt).
        const b = it.body, k = 1 / Math.max(dt, 1 / 240), prev = this.holdTarget[h.id] || tgt;
        b.velocity.set((tgt[0] - prev[0]) * k, (tgt[1] - prev[1]) * k, (tgt[2] - prev[2]) * k);
        b.position.set(...tgt); b.previousPosition.set(...tgt);
        this.holdTarget[h.id] = tgt;
        if (it.kind === 'die') b.angularVelocity.set(2, 3, 1.5); else b.angularVelocity.set(0, 0, 0);
      }
      if (!h.grabbing && it) this.release(h.id, it, hist);
      this.wasGrabbing[h.id] = h.grabbing;
    }
    // Tracking dropout: keep holding for a short grace period, then drop with the last known velocity.
    for (const id of Object.keys(this.held)) {
      if (this.time - (this.lastSeen[id] ?? 0) > DROPOUT_GRACE) { this.release(id, this.held[id], this.hist[id] || []); this.wasGrabbing[id] = false; }
      else if (this.time - this.lastSeen[id] > 0) { const b = this.held[id].body; b.velocity.set(0, 0, 0); }
    }
  }

  release(id, it, hist) {
    delete this.held[id]; delete this.holdTarget[id]; this.releasedAt[id] = this.time;
    const v = clampLength(averageVelocity(hist, 5), 4);
    const b = it.body;
    b.type = CANNON.Body.DYNAMIC; b.updateMassProperties();
    b.velocity.set(...v);
    const sp = Math.hypot(...v);
    if (it.kind === 'die') b.angularVelocity.set((random() - 0.5) * 20 * (0.3 + sp), (random() - 0.5) * 20, (random() - 0.5) * 20 * (0.3 + sp));
    b.wakeUp();
    it.onRelease?.(sp);
  }
}
