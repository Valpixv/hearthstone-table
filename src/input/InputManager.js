import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { HandMeshes } from './HandMeshes.js';
import { isPinching, isFist, grabPoint, palmUp, TIP_JOINTS, JOINTS } from './gestures.js';

/**
 * One interface for every input mode.
 *  - Joint sources (WebXR hands, MediaPipe webcam, test replay): update(dt) -> { left?, right? }
 *    where each hand = { [webxrJointName]: { p:[x,y,z], q?:[x,y,z,w], r? } } in world metres.
 *  - Pointer sources (mouse): update(dt) -> HandState[] directly.
 * Output every frame: HandState[] = { id, handedness, joints?, point:[x,y,z]|null, grabbing, pinching,
 *   fist, palmUp, tips:[[x,y,z]], hint? } consumed by GrabSystem, DM panel and pokeables.
 */
export class InputManager {
  constructor({ scene, physics }) {
    this.scene = scene; this.physics = physics;
    this.jointSource = null; this.pointerSources = [];
    this.prev = {}; this.hands = [];
    this.tipBodies = {};
    this.visuals = { left: makeHandMesh('#f2c9a0'), right: makeHandMesh('#f2c9a0') };
    scene.add(this.visuals.left, this.visuals.right);
    this.handMeshes = new HandMeshes(scene); // skinned hands; the joint spheres are the fallback
    this.tipsEnabled = true;
  }

  async setJointSource(src) {
    if (this.jointSource?.dispose) this.jointSource.dispose();
    this.jointSource = src;
    if (src?.load) await src.load();
  }
  addPointerSource(src) { this.pointerSources.push(src); }

  update(dt) {
    const out = [];
    if (this.jointSource) {
      const frame = this.jointSource.update(dt) || {};
      for (const hd of ['left', 'right']) {
        const j = frame[hd];
        const vis = this.visuals[hd];
        if (!j || !j.wrist) { vis.count = 0; this.handMeshes.hide(hd); continue; }
        const prev = this.prev[hd] || {};
        const pinching = isPinching(j, prev.pinching);
        const fist = !pinching && isFist(j);
        const st = {
          id: hd, handedness: hd, joints: j, pinching, fist, grabbing: pinching || fist,
          point: grabPoint(j), palmUp: palmUp(j, hd),
          tips: TIP_JOINTS.map((n) => j[n]?.p).filter(Boolean),
        };
        this.prev[hd] = st; out.push(st);
        const drawn = this.jointClamp ? this.jointClamp(hd, j) : j; // touch-limiting (VR panels)
        if (this.handMeshes.ready) { vis.count = 0; this.handMeshes.update(hd, drawn); } else drawHand(vis, drawn, pinching);
      }
    } else { this.visuals.left.count = 0; this.visuals.right.count = 0; this.handMeshes.hide('left'); this.handMeshes.hide('right'); }
    for (const s of this.pointerSources) out.push(...(s.update(dt) || []));
    this.hands = out;
    this.updateTips(dt);
    return out;
  }

  // Kinematic fingertip spheres so players can poke, flick and push dice and minis.
  updateTips(dt) {
    const seen = new Set();
    if (this.tipsEnabled) for (const h of this.hands) {
      if (this.tipFilter && !this.tipFilter(h.id)) continue; // e.g. hand is holding / just released
      h.tips.forEach((p, i) => {
        const key = h.id + i; seen.add(key);
        let b = this.tipBodies[key];
        if (!b) {
          b = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, shape: new CANNON.Sphere(0.009) });
          b.position.set(p[0], p[1], p[2]); this.physics.world.addBody(b); this.tipBodies[key] = b;
        }
        // Velocity from the previous *target*, not the body position: physics.step has already
        // integrated the kinematic body by v*dt, so using b.position would oscillate every tick.
        const k = 1 / Math.max(dt, 1 / 240), prev = b.prevTarget || p;
        b.velocity.set((p[0] - prev[0]) * k, (p[1] - prev[1]) * k, (p[2] - prev[2]) * k);
        b.position.set(p[0], p[1], p[2]); b.previousPosition.set(p[0], p[1], p[2]);
        b.prevTarget = p.slice();
      });
    }
    for (const [key, b] of Object.entries(this.tipBodies)) if (!seen.has(key)) { this.physics.world.removeBody(b); delete this.tipBodies[key]; }
  }
}

function makeHandMesh(color) {
  const m = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }), JOINTS.length);
  m.count = 0; m.frustumCulled = false; m.castShadow = true;
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(JOINTS.length * 3).fill(1), 3);
  return m;
}
const _o = new THREE.Object3D(), _c = new THREE.Color();
function drawHand(mesh, j, pinching) {
  let n = 0;
  JOINTS.forEach((name) => {
    const jt = j[name]; if (!jt) return;
    _o.position.fromArray(jt.p); _o.scale.setScalar(name.endsWith('tip') ? 0.008 : Math.max(0.006, Math.min(jt.r || 0.009, 0.012)));
    _o.updateMatrix(); mesh.setMatrixAt(n, _o.matrix);
    _c.set(pinching && (name === 'thumb-tip' || name === 'index-finger-tip') ? '#ffd34d' : '#ffffff');
    mesh.setColorAt(n, _c); n++;
  });
  mesh.count = n; mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
}
