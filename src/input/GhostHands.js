import * as THREE from 'three';
import { JOINT_NAMES, BONES } from '../../harness/format/joints.js';

const COLORS = { left: '#6fb7ff', right: '#ffae5c' };

/**
 * Semi-transparent "ghost" hands (joint spheres + bone lines) for watching replays and recordings.
 * Drawn on top of the app's own hand visuals so you can see exactly what the recording contains.
 */
export class GhostHands {
  constructor(scene, { opacity = 0.35 } = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'ghost-hands';
    this.hands = {};
    for (const side of ['left', 'right']) {
      const mat = new THREE.MeshBasicMaterial({ color: COLORS[side], transparent: true, opacity, depthWrite: false });
      const spheres = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), mat, JOINT_NAMES.length);
      spheres.frustumCulled = false;
      spheres.count = 0;
      spheres.renderOrder = 10;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BONES.length * 6), 3));
      const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: COLORS[side], transparent: true, opacity: Math.min(1, opacity * 2), depthWrite: false }));
      lines.frustumCulled = false;
      lines.visible = false;
      lines.renderOrder = 11;
      this.group.add(spheres, lines);
      this.hands[side] = { spheres, lines };
    }
    scene.add(this.group);
    this._o = new THREE.Object3D();
  }

  update(frame = {}) {
    for (const side of ['left', 'right']) {
      const j = frame[side];
      const { spheres, lines } = this.hands[side];
      if (!j) {
        spheres.count = 0;
        lines.visible = false;
        continue;
      }
      let n = 0;
      for (const name of JOINT_NAMES) {
        const jt = j[name];
        if (!jt) continue;
        this._o.position.fromArray(jt.p);
        this._o.scale.setScalar(Math.max(0.005, (jt.r || 0.009) * 0.9));
        this._o.updateMatrix();
        spheres.setMatrixAt(n++, this._o.matrix);
      }
      spheres.count = n;
      spheres.instanceMatrix.needsUpdate = true;
      const pos = lines.geometry.attributes.position;
      BONES.forEach(([a, b], i) => {
        const pa = j[a]?.p ?? [0, 0, 0];
        const pb = j[b]?.p ?? pa;
        pos.setXYZ(i * 2, pa[0], pa[1], pa[2]);
        pos.setXYZ(i * 2 + 1, pb[0], pb[1], pb[2]);
      });
      pos.needsUpdate = true;
      lines.visible = true;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
  }
}
