import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { JOINT_NAMES } from '../../harness/format/joints.js';
import { orientFromPositions } from '../../harness/format/orient.js';

// Skinned hand meshes driven by joint data from ANY source (WebXR, webcam, replay).
// Meshes: the WebXR "generic-hand" models from github.com/immersive-web/webxr-input-profiles
// (W3C Software and Document License), whose bones are named after the 25 WebXR joints —
// the same rigging three.js' XRHandMeshModel uses, but fed from plain joint data.

const URL = (side) => `${import.meta.env.BASE_URL}assets/hands/${side}.glb`;
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
const isIdentity = (q) => !q || (Math.abs(q[0]) < 1e-6 && Math.abs(q[1]) < 1e-6 && Math.abs(q[2]) < 1e-6);

export class HandMeshes {
  constructor(scene, { color = '#e9b796' } = {}) {
    this.hands = {};
    this.ready = false;
    const loader = new GLTFLoader();
    Promise.all(['left', 'right'].map((side) => loader.loadAsync(URL(side)).then((g) => {
      const root = g.scene;
      root.visible = false;
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.frustumCulled = false;
        o.castShadow = true;
        o.material = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0 });
      });
      const bones = JOINT_NAMES.map((n) => root.getObjectByName(n) ?? null);
      scene.add(root);
      this.hands[side] = { root, bones };
    }))).then(() => { this.ready = true; }).catch((e) => console.warn('hand meshes unavailable', e.message));
  }

  hide(side) {
    if (this.hands[side]) this.hands[side].root.visible = false;
  }

  /** Pose a hand from joint data { name: { p, q } } in world space. */
  update(side, joints) {
    const h = this.hands[side];
    if (!h) return;
    // Webcam landmarks carry no rotations: derive them from bone directions.
    const needRot = isIdentity(joints.wrist?.q) && isIdentity(joints['index-finger-phalanx-proximal']?.q);
    const rot = needRot && JOINT_NAMES.every((n) => joints[n])
      ? orientFromPositions(Object.fromEntries(JOINT_NAMES.map((n) => [n, joints[n].p])), side) : null;
    h.root.visible = true;
    h.root.updateMatrixWorld(true);
    // Bones are visited wrist-first, so each parent's world matrix is final before its children.
    JOINT_NAMES.forEach((name, i) => {
      const bone = h.bones[i], j = joints[name];
      if (!bone || !j) return;
      _p.fromArray(j.p);
      _q.fromArray(rot ? rot[name] : j.q);
      _m.compose(_p, _q, _s);
      if (bone.parent) _m.premultiply(new THREE.Matrix4().copy(bone.parent.matrixWorld).invert());
      _m.decompose(bone.position, bone.quaternion, bone.scale);
      bone.updateMatrixWorld(true);
    });
  }
}
