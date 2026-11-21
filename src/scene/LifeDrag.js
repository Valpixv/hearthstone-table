import * as THREE from 'three';
import { ARENA, creatureRadius, obstacles, nearestFree, autoSlot, isFree, formation, boardToArena, arenaToBoard, seatsInUse, clampToRing } from '../table/arena.js';
import { MAP } from '../table/layout.js';
import { TABLE_TOP } from '../physics/Physics.js';

/** Tuning. */
export const LIFE_DRAG = { glide: 10, wheelTurn: 0.26, ghostOpacity: 0.55 };
export { clampToRing };

/**
 * The DM arranges life-size creatures in the room (design/completion-plan.md §8).
 *  - Drag a creature that is already standing: mouse on desktop, a hand ray or controller ray in VR (src/ui/vr).
 *    It slides along the floor, cannot overlap another creature, a seat or the fire, and is saved on the token
 *    (lifePos, lifeYaw) so every player sees it glide to the new spot.
 *  - Drag a creature OUT of the gallery: a footprint follows the pointer; letting go on the floor spawns it there
 *    life-size (with its mini on the matching square of the battle mat); letting go on the table spawns only the mini.
 *  - New creatures nobody placed get the nearest free spot (no more stacking).
 *  - Optional link: moving a mini on the mat moves its body to the matching spot in the room, and the reverse.
 * Pointer-agnostic: begin / moveTo / turn / end are called by the mouse here and by the XR pointer.
 */
export class LifeDrag {
  constructor({ dm, mouse, camera, dom, sync = null, scene }) {
    Object.assign(this, { dm, camera, dom, sync, scene });
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2(); this.floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.hit = new THREE.Vector3(); this.drag = null; this.ghost = null; this.dragDef = null;
    // Footprint ring: gold where the creature can stand, red where it cannot.
    const g = new THREE.RingGeometry(0.86, 1, 48); g.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#f3d58a', transparent: true, opacity: 0.9, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    this.ring.visible = false; this.ring.renderOrder = 7; scene?.add(this.ring);
    dm.placeLife = (token) => this.slotFor(token);
    mouse?.addTool({
      priority: true,
      enabled: () => dm.isDM && !dm.state?.map?.fogPaint,
      targets: () => this.lifeRoots(),
      onDown: (h) => { const id = this.idOf(h.object); if (id) { this.begin(id); this.startMouse(); } },
    });
    this.onMove = (e) => { const p = this.floorAt(e.clientX, e.clientY); if (p) this.moveTo(p.x, p.z); };
    this.onUp = () => { this.stopMouse(); this.end(); };
    this.onWheel = (e) => { if (this.drag) { e.preventDefault(); this.turn(Math.sign(e.deltaY) * LIFE_DRAG.wheelTurn); } };
    // Desktop: a gallery tile dragged onto the 3D view.
    dom?.addEventListener('dragover', (e) => { if (!this.dragDef) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!this.ghost) this.beginGhost(this.dragDef.def, this.dragDef.count); const p = this.pointAt(e.clientX, e.clientY); if (p) this.moveGhost(p); });
    dom?.addEventListener('dragleave', () => this.cancelGhost());
    dom?.addEventListener('drop', (e) => { if (!this.ghost) return; e.preventDefault(); const p = this.pointAt(e.clientX, e.clientY); if (p) this.moveGhost(p); this.endGhost(); this.dragDef = null; });
    // Players' mini moves reach the DM as `move` messages: the body follows when the link is on.
    sync?.on('move', (m) => { if (m.qy == null && sync.role === 'dm') this.onMiniMoved(m.key, m.x, m.z); });
    if (sync) sync.onMiniMoved = (it) => { if (sync.role !== 'player') this.onMiniMoved(it.netKey, it.body.position.x, it.body.position.z); };
  }

  // ---------- lookups ----------
  lifeRoots() { return Object.values(this.dm.tokens?.refs || {}).map((r) => r?.life).filter(Boolean); }
  /** Token id of a life-size body (any object inside it), or null. */
  idOf(obj) {
    const refs = this.dm.tokens?.refs || {};
    for (let o = obj; o; o = o.parent) { const id = Object.keys(refs).find((k) => refs[k]?.life === o); if (id) return id; }
    return null;
  }
  /** Circles a creature must keep clear of: every other standing creature, the seats in use and the fire. */
  others(except = null) {
    const T = this.dm.tokens, out = obstacles(seatsInUse(this.sync?.players || [])), skip = except instanceof Set ? except : new Set(except ? [except] : []);
    for (const t of T?.list || []) { const L = T.refs[t.id]?.life; if (L && !skip.has(t.id)) out.push({ x: L.position.x, z: L.position.z, r: creatureRadius(t) }); }
    return out;
  }
  /** A free spot for a creature nobody placed (and remembers it on the token so every table uses the same one). */
  slotFor(token) {
    const r = creatureRadius(token), p = autoSlot(r, this.others(token.id));
    token.lifePos = [+p[0].toFixed(3), +p[1].toFixed(3)];
    return token.lifePos;
  }

  floorAt(cx, cy) {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.ray.ray.intersectPlane(this.floor, this.hit) ? this.hit.clone() : null;
  }
  /** Where a screen point lands: on the battle mat ({ onMap: true }) or on the floor. */
  pointAt(cx, cy) {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.pointOnRay(this.ray.ray);
  }
  /** Same for any ray (the XR pointer). */
  pointOnRay(ray) {
    const p = new THREE.Vector3();
    if (ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE_TOP), p) && Math.abs(p.x - MAP.x) <= MAP.w / 2 && Math.abs(p.z - MAP.z) <= MAP.d / 2) return { x: p.x, z: p.z, onMap: true };
    return ray.intersectPlane(this.floor, p) ? { x: p.x, z: p.z, onMap: false } : null;
  }

  showRing(x, z, r, ok, y = 0.02) {
    this.ring.visible = true; this.ring.position.set(x, y, z); this.ring.scale.setScalar(r);
    this.ring.material.color.set(ok ? '#f3d58a' : '#ff3a2a');
  }

  // ---------- dragging a standing creature ----------
  startMouse() { window.addEventListener('pointermove', this.onMove); window.addEventListener('pointerup', this.onUp, { once: true }); this.dom.addEventListener('wheel', this.onWheel, { passive: false }); this.dom.style.cursor = 'grabbing'; }
  stopMouse() { window.removeEventListener('pointermove', this.onMove); this.dom.removeEventListener('wheel', this.onWheel); this.dom.style.cursor = ''; }

  /** Starts dragging a token's life-size body. @returns {boolean} */
  begin(id) {
    const obj = this.dm.tokens?.refs[id]?.life, t = this.dm.tokens?.find(id); if (!obj || !t || !this.dm.isDM) return false;
    this.drag = { id, obj, r: creatureRadius(t), from: [obj.position.x, obj.position.z], yaw: t.lifeYaw ?? null };
    delete obj.userData.glideTo;
    return true;
  }
  /** Slides the dragged creature toward a floor point. */
  moveTo(x, z) {
    const d = this.drag; if (!d) return;
    [x, z] = clampToRing(x, z);
    const ok = isFree(x, z, d.r, this.others(d.id));
    d.obj.position.x = x; d.obj.position.z = z; d.ok = ok;
    this.face(d.obj, d.yaw);
    this.showRing(x, z, d.r, ok);
  }
  /** Turns the dragged creature (radians). The first turn stops it from auto-facing the table. */
  turn(dYaw) { const d = this.drag; if (!d) return; d.yaw = (d.yaw ?? d.obj.rotation.y) + dYaw; this.face(d.obj, d.yaw); }
  /** Lets go: the creature settles on the nearest free spot and the table is told. */
  end() {
    const d = this.drag; this.drag = null; this.ring.visible = false;
    if (!d) return;
    const [x, z] = nearestFree(d.obj.position.x, d.obj.position.z, d.r, this.others(d.id));
    d.obj.position.x = x; d.obj.position.z = z; this.face(d.obj, d.yaw);
    this.commit(d.id, x, z, d.yaw, true);
  }
  face(obj, yaw) { if (yaw == null) obj.lookAt(0, obj.position.y, 0); else obj.rotation.set(0, yaw, 0); }

  /** Saves a body's spot on its token (synced, saved) and, when linked, moves its mini to the matching square. */
  commit(id, x, z, yaw = null, moveMini = false) {
    const t = this.dm.tokens?.find(id); if (!t) return;
    const patch = { lifePos: [+x.toFixed(3), +z.toFixed(3)] };
    if (yaw != null) patch.lifeYaw = +yaw.toFixed(3);
    Object.assign(t, patch);
    if (this.dm.act) this.dm.act('update', { id, patch }); else this.dm.emit();
    if (moveMini && this.dm.state.settings?.linkMiniToBody && this.dm.tokens.refs[id]?.item) {
      const [mx, mz] = arenaToBoard(x, z);
      if (this.sync?.moveToken) this.sync.moveToken(id, mx, mz); else { const b = this.dm.tokens.refs[id].item.body; b.position.x = mx; b.position.z = mz; }
    }
  }

  /** A mini settled on the mat: with the link on, its life-size body walks to the matching spot in the room. */
  onMiniMoved(id, x, z) {
    const T = this.dm.tokens, t = T?.find(id), L = T?.refs[id]?.life;
    if (!t || !L || !this.dm.state.settings?.linkMiniToBody || this.drag?.id === id) return;
    if (Math.abs(x - MAP.x) > MAP.w / 2 || Math.abs(z - MAP.z) > MAP.d / 2) return; // off the mat: leave the body alone
    const [ax, az] = boardToArena(x, z), [fx, fz] = nearestFree(ax, az, creatureRadius(t), this.others(id));
    if (Math.hypot(fx - L.position.x, fz - L.position.z) < 0.15) return;
    L.userData.glideTo = [fx, fz];
    this.commit(id, fx, fz, t.lifeYaw ?? null, false);
  }

  /** Arranges creatures together: 'line' | 'arc' | 'surround' | 'scatter'. ids default to every enemy standing in the room. */
  arrange(kind, ids = null) {
    const T = this.dm.tokens, list = (ids ? ids.map((id) => T.find(id)) : T.list.filter((t) => t.side === 'enemy')).filter((t) => t && T.refs[t.id]?.life);
    if (!list.length) return 0;
    const moving = new Set(list.map((t) => t.id));
    const pts = formation(kind, list.map(creatureRadius), this.others(moving));
    list.forEach((t, i) => { T.refs[t.id].life.userData.glideTo = pts[i]; this.commit(t.id, pts[i][0], pts[i][1], null, true); });
    return moving.size;
  }

  // ---------- dragging a creature out of the gallery ----------
  /** The gallery tells us what is being dragged (desktop HTML drag, or the VR panel's tile pull). */
  setDragDef(def, count = 1) { this.dragDef = def ? { def, count } : null; if (!def) this.cancelGhost(); }
  beginGhost(def, count = 1) { this.ghost = { def, count: Math.max(1, count | 0), r: creatureRadius(def), x: 0, z: 0, onMap: false, ok: false }; }
  /** Moves the footprint to a point from pointAt() / pointOnRay(). */
  moveGhost(p) {
    const g = this.ghost; if (!g || !p) return;
    g.onMap = !!p.onMap;
    if (g.onMap) { g.x = p.x; g.z = p.z; g.ok = true; this.showRing(p.x, p.z, 0.03, true, TABLE_TOP + 0.006); return; }
    [g.x, g.z] = clampToRing(p.x, p.z); g.ok = isFree(g.x, g.z, g.r, this.others());
    this.showRing(g.x, g.z, g.r, g.ok);
  }
  cancelGhost() { this.ghost = null; this.ring.visible = false; }
  /**
   * Drops the dragged gallery creature: life-size on the floor (plus its mini on the matching square), or mini-only on the mat.
   * @returns {object[]|null} the spawned tokens
   */
  endGhost() {
    const g = this.ghost; this.cancelGhost(); if (!g || !this.dm.isDM) return null;
    const out = [], others = this.others();
    for (let i = 0; i < g.count; i++) {
      const def = { ...g.def, name: g.count > 1 ? `${g.def.name || 'Creature'} ${i + 1}` : g.def.name };
      if (g.onMap) { def.life = false; def.pos = [g.x + (i % 3) * 0.045, g.z + Math.floor(i / 3) * 0.045]; }
      else {
        const [x, z] = nearestFree(g.x, g.z, g.r, others); others.push({ x, z, r: g.r });
        def.life = true; def.lifePos = [+x.toFixed(3), +z.toFixed(3)]; def.pos = arenaToBoard(x, z);
      }
      const made = this.dm.act ? this.dm.act('spawn', { def }) : this.dm.tokens.spawn(def);
      if (Array.isArray(made)) out.push(...made);
    }
    return out;
  }

  /** Per frame: bodies glide to spots that arrived from the DM (players) or from a formation / link. */
  update(dt = 1 / 60) {
    const k = 1 - Math.exp(-dt * LIFE_DRAG.glide), T = this.dm.tokens;
    for (const [id, r] of Object.entries(T?.refs || {})) {
      const L = r?.life, to = L?.userData.glideTo; if (!to || this.drag?.obj === L) continue;
      L.position.x += (to[0] - L.position.x) * k; L.position.z += (to[1] - L.position.z) * k;
      this.face(L, T.find(id)?.lifeYaw ?? null);
      if (Math.hypot(to[0] - L.position.x, to[1] - L.position.z) < 0.005) { L.position.x = to[0]; L.position.z = to[1]; delete L.userData.glideTo; }
    }
  }
}

export { ARENA };
