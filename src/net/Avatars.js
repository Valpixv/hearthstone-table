import * as THREE from 'three';
import { JOINTS } from '../input/gestures.js';
import { seatLayout, LAYOUT_CFG } from '../table/layout.js';
import { textSprite, updateTextSprite } from '../scene/util.js';
import { kitUrl, kitHas } from '../ui/kit.js';
import { classId } from '../party/sheet.js';
import CLASSES from '../data/classes.json';
import CFG from '../data/tableDefaults.json';

const POSE = CFG.poses;
const SEND_MS = 1000 / POSE.hz;
/** Bones drawn between joints (indexes into JOINTS) so remote hands read as hands, not dots. */
const BONES = [];
for (const base of [1, 5, 10, 15, 20]) { BONES.push([0, base]); for (let i = base; i < base + (base === 1 ? 3 : 4); i++) BONES.push([i, i + 1]); }
const mm = (v) => Math.round(v * 1000);
const r3 = (v) => Math.round(v * 1000) / 1000;

/** Packs a hand's joints as millimetre integers [x0, y0, z0, x1, …] (null when the hand is not tracked). Pure. */
export function packHand(joints) {
  if (!joints?.wrist) return null;
  const out = [];
  for (const n of JOINTS) { const p = joints[n]?.p || joints.wrist.p; out.push(mm(p[0]), mm(p[1]), mm(p[2])); }
  return out;
}
/** Unpacks packHand() into an array of [x, y, z] metres, or null when the data is not a whole hand. Pure. */
export function unpackHand(a) {
  if (!Array.isArray(a) || a.length !== JOINTS.length * 3 || !a.every(Number.isFinite)) return null;
  const out = []; for (let i = 0; i < a.length; i += 3) out.push([a[i] / 1000, a[i + 1] / 1000, a[i + 2] / 1000]);
  return out;
}
/** True for a well-formed head pose [x, y, z, qx, qy, qz, qw] inside the room. Pure. */
export function validHead(h) { return Array.isArray(h) && h.length === 7 && h.every(Number.isFinite) && Math.abs(h[0]) < 20 && Math.abs(h[2]) < 20 && h[1] > -1 && h[1] < 4; }

/**
 * The other people at the table (design/completion-plan.md §6.1). Everyone else is drawn seated at their seat: a cloaked
 * figure in their class colour, a head that follows their real head, hands that follow their real hands, a name plate
 * with their character's portrait, and a ring that lights while they speak. You never see your own body.
 * This machine's own head and hands are sent 15 times a second as `pose` messages (relayed, never stored).
 */
export class Avatars {
  constructor({ scene, sync, dm, camera, renderer, input }) {
    Object.assign(this, { scene, sync, dm, camera, renderer, input });
    this.people = new Map(); this.sendT = 0; this.seat = seatLayout(0); this.loader = new THREE.TextureLoader();
    this.handGeo = new THREE.SphereGeometry(1, 8, 6); this.boneGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
    sync.on('pose', (m) => this.onPose(m));
    sync.onPlayers = (players) => this.reconcile(players);
    dm.on(() => this.refreshLabels());
  }

  setSeat(L) { this.seat = L; }
  /** The object a voice should come from (their head), or null. */
  headOf(id) { return this.people.get(id)?.head || null; }
  /** Lights the speaking ring of a person (level 0..1). */
  setSpeaking(id, level) { const p = this.people.get(id); if (p) p.speak = Math.max(p.speak * 0.8, level); }

  /** Adds / removes figures so there is one for every other person present. */
  reconcile(players) {
    const me = this.sync.me?.id, ids = new Set(players.filter((p) => p.id !== me).map((p) => p.id));
    for (const [id, p] of this.people) if (!ids.has(id)) { this.scene.remove(p.root); this.dispose(p); this.people.delete(id); }
    for (const pl of players) {
      if (pl.id === me) continue;
      let p = this.people.get(pl.id);
      if (!p) { p = this.build(pl); this.people.set(pl.id, p); }
      if (p.seat !== pl.seat) this.sit(p, pl.seat);
      p.info = pl;
    }
    this.refreshLabels();
  }

  token(id) { return (this.dm.state.tokens || []).find((t) => t.kind === 'pc' && t.owner === id) || null; }

  build(pl) {
    const root = new THREE.Group(); root.name = `avatar:${pl.id}`;
    const cloak = new THREE.MeshStandardMaterial({ color: '#6b4a2a', roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: '#e9b796', roughness: 0.7 });
    // Seated body: a cloak from the chair to the shoulders. It turns to follow the head a little.
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.24, 0.62, 14), cloak); body.castShadow = true;
    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), cloak); shoulders.scale.set(1, 0.5, 0.75);
    const head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 14), skin); skull.castShadow = true;
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.125, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), cloak); hood.rotation.x = -0.35;
    const eyeM = new THREE.MeshBasicMaterial({ color: '#1a0f08' });
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), eyeM); e.position.set(s * 0.038, 0.012, -0.096); head.add(e); }
    head.add(skull, hood);
    // Speaking ring around the head.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.008, 6, 32), new THREE.MeshBasicMaterial({ color: '#4fd17a', transparent: true, opacity: 0, fog: false }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.16; head.add(ring);
    // Name plate with a portrait badge.
    const name = textSprite(pl.name, { w: 512, h: 128, font: 'bold 60px Cinzel, Georgia', color: '#f3d58a', glow: '#3a1a08', scale: 0.085 });
    const badge = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false })); badge.scale.set(0.16, 0.16, 1); badge.visible = false;
    root.add(body, shoulders, head, name, badge);
    const hands = {};
    for (const side of ['L', 'R']) {
      const g = new THREE.Group(); g.visible = false;
      const joints = new THREE.InstancedMesh(this.handGeo, skin, JOINTS.length); joints.frustumCulled = false;
      const bones = new THREE.InstancedMesh(this.boneGeo, skin, BONES.length); bones.frustumCulled = false;
      g.add(joints, bones); this.scene.add(g);
      hands[side] = { group: g, joints, bones, cur: null, to: null };
    }
    this.scene.add(root);
    const p = { root, body, shoulders, head, ring, name, badge, hands, cloak, seat: -1, info: pl, at: 0, to: null, cur: null, speak: 0, labelSig: '' };
    this.sit(p, pl.seat);
    return p;
  }

  dispose(p) {
    for (const h of Object.values(p.hands)) this.scene.remove(h.group);
    p.root.traverse((o) => { if (o.material?.map) o.material.map.dispose(); if (o.isSprite) o.material.dispose(); });
  }

  /** Puts a figure on its chair, facing the table (the pose a desktop player keeps). */
  sit(p, seat) {
    p.seat = seat; const L = seatLayout(seat);
    p.rest = { x: L.pos[0], z: L.pos[1], yaw: L.yaw, eye: LAYOUT_CFG.eye };
    p.cur = null; this.pose(p, [L.pos[0], LAYOUT_CFG.eye, L.pos[1]], new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.25, L.yaw, 0, 'YXZ')));
  }

  /** Places body, head and name plate for a head position + rotation. */
  pose(p, pos, quat) {
    p.head.position.set(pos[0], pos[1], pos[2]); p.head.quaternion.copy(quat);
    const yaw = new THREE.Euler().setFromQuaternion(quat, 'YXZ').y;
    p.body.position.set(pos[0], Math.max(0.5, pos[1] - 0.52), pos[2]); p.body.rotation.y = yaw;
    p.shoulders.position.set(pos[0], Math.max(0.8, pos[1] - 0.24), pos[2]); p.shoulders.rotation.y = yaw;
    p.name.position.set(pos[0], pos[1] + 0.3, pos[2]); p.badge.position.set(pos[0], pos[1] + 0.47, pos[2]);
  }

  /** Name, class colour and portrait from the person's character. */
  refreshLabels() {
    for (const [id, p] of this.people) {
      const t = this.token(id), dmRole = p.info?.role === 'dm', cls = classId(t?.sheet?.cls);
      const label = `${dmRole ? 'DM · ' : ''}${t?.name || p.info?.name || '?'}${p.info?.muted ? ' (muted)' : ''}`;
      const key = dmRole ? 'creature/dungeon-master' : kitHas(`creature/${cls}`) ? `creature/${cls}` : cls ? `creature/${CLASSES[cls].model}` : null;
      const sig = `${label}|${key}|${cls}`;
      if (sig === p.labelSig) continue; p.labelSig = sig;
      updateTextSprite(p.name, label);
      p.cloak.color.set(dmRole ? '#5a1014' : CLASSES[cls]?.color || '#6b4a2a');
      if (key) this.loader.load(kitUrl(key), (tex) => { tex.colorSpace = THREE.SRGBColorSpace; p.badge.material.map = tex; p.badge.material.needsUpdate = true; p.badge.visible = true; });
      else p.badge.visible = false;
    }
  }

  /** A remote pose. Only well-formed data moves anything. */
  onPose(m) {
    const p = this.people.get(m.from); if (!p) return;
    if (validHead(m.hd)) p.to = { pos: m.hd.slice(0, 3), quat: new THREE.Quaternion(m.hd[3], m.hd[4], m.hd[5], m.hd[6]).normalize() };
    else p.to = null;
    for (const side of ['L', 'R']) p.hands[side].to = unpackHand(m[side]);
    p.at = performance.now();
  }

  /** Per frame: send my pose (in a headset or with webcam hands), ease everyone else toward their latest pose. */
  update(dt, hands = [], xr = false) {
    this.sendT += dt * 1000;
    if (this.sendT >= SEND_MS && this.sync.role) { this.sendT = 0; this.sendPose(hands, xr); }
    const k = 1 - Math.exp(-dt * 18), now = performance.now(), _q = new THREE.Quaternion();
    for (const p of this.people.values()) {
      const fresh = now - p.at < POSE.staleMs;
      if (fresh && p.to) {
        p.cur ||= { pos: [...p.to.pos], quat: p.to.quat.clone() };
        for (let i = 0; i < 3; i++) p.cur.pos[i] += (p.to.pos[i] - p.cur.pos[i]) * k;
        p.cur.quat.slerp(p.to.quat, k);
        this.pose(p, p.cur.pos, p.cur.quat);
      } else if (p.cur) { p.cur = null; this.sit(p, p.seat); }
      for (const side of ['L', 'R']) this.drawHand(p.hands[side], fresh ? p.hands[side].to : null, k);
      p.speak *= Math.exp(-dt * 6);
      p.ring.material.opacity = Math.min(1, p.speak * 3); p.ring.scale.setScalar(1 + Math.min(0.25, p.speak));
      // Name plates turn to the viewer's side of the table without flipping.
      p.name.material.rotation = 0; void _q;
    }
  }

  drawHand(h, pts, k) {
    if (!pts) { h.group.visible = false; h.cur = null; return; }
    if (!h.cur) h.cur = pts.map((p) => [...p]);
    else for (let i = 0; i < pts.length; i++) for (let a = 0; a < 3; a++) h.cur[i][a] += (pts[i][a] - h.cur[i][a]) * Math.min(1, k * 1.6);
    const o = new THREE.Object3D(), a = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    h.cur.forEach((p, i) => { o.position.set(p[0], p[1], p[2]); o.quaternion.identity(); o.scale.setScalar(i === 0 ? 0.016 : JOINTS[i].endsWith('tip') ? 0.0075 : 0.0095); o.updateMatrix(); h.joints.setMatrixAt(i, o.matrix); });
    BONES.forEach(([i, j], n) => {
      a.set(...h.cur[i]); b.set(...h.cur[j]); const len = a.distanceTo(b);
      o.position.copy(a).add(b).multiplyScalar(0.5); o.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize()); o.scale.set(i === 0 ? 0.011 : 0.008, len, i === 0 ? 0.011 : 0.008); o.updateMatrix(); h.bones.setMatrixAt(n, o.matrix);
    });
    h.joints.instanceMatrix.needsUpdate = true; h.bones.instanceMatrix.needsUpdate = true; h.group.visible = true;
  }

  sendPose(hands, xr) {
    const L = hands.find((h) => h.handedness === 'left')?.joints, R = hands.find((h) => h.handedness === 'right')?.joints;
    if (!xr && !L && !R) { if (this.sentIdle) return; this.sentIdle = true; this.sync.send({ t: 'pose', hd: null, L: null, R: null }); return; }
    this.sentIdle = false;
    let hd = null;
    if (xr) {
      const cam = this.renderer.xr.getCamera(), p = new THREE.Vector3(), q = new THREE.Quaternion();
      cam.getWorldPosition(p); cam.getWorldQuaternion(q);
      hd = [r3(p.x), r3(p.y), r3(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w)];
    }
    this.sync.send({ t: 'pose', hd, L: packHand(L), R: packHand(R) });
  }
}
