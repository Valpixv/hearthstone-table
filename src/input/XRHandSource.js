import * as THREE from 'three';
import { JOINTS } from './gestures.js';

// WebXR Hand Input API -> { left, right } joint maps in world space.
export class XRHandSource {
  constructor(renderer, rig) {
    this.hands = [0, 1].map((i) => {
      const h = renderer.xr.getHand(i);
      h.userData.handedness = null;
      h.addEventListener('connected', (e) => { h.userData.handedness = e.data.handedness; });
      h.addEventListener('disconnected', () => { h.userData.handedness = null; });
      rig.add(h);
      return h;
    });
    this.rig = rig;
    this._p = new THREE.Vector3(); this._q = new THREE.Quaternion();
  }
  update() {
    const out = {};
    this.rig.updateMatrixWorld(true);
    for (const h of this.hands) {
      const hd = h.userData.handedness;
      if (!hd || !h.joints || !h.joints.wrist || !h.joints.wrist.visible) continue;
      const j = {};
      for (const name of JOINTS) {
        const jt = h.joints[name]; if (!jt) continue;
        jt.getWorldPosition(this._p); jt.getWorldQuaternion(this._q);
        j[name] = { p: this._p.toArray(), q: this._q.toArray(), r: jt.jointRadius || 0.008 };
      }
      out[hd] = j;
    }
    return out;
  }
}
