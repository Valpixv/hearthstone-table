import * as THREE from 'three';
import { TABLE_TOP } from '../physics/Physics.js';

/**
 * Mouse fallback. Left-drag a die/mini to pick it up and fling it (it becomes a pointer
 * "hand" for GrabSystem). Click a die to toss it. Other tools (fog painting, poking
 * objects) register via addTool(). Right-drag orbits, wheel zooms (DesktopCamera).
 */
export class MouseInput {
  constructor({ dom, camera, grab }) {
    this.dom = dom; this.camera = camera; this.grab = grab;
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2();
    this.dragging = null; this.point = null; this.planeY = TABLE_TOP + 0.1;
    this.tools = []; this.activeTool = null; this.enabled = true;
    this.onClickGrabbable = null;
    dom.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
  }
  addTool(t) { this.tools.push(t); }

  setRay(e) {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
  }
  planePoint() {
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.planeY), p) ? p.toArray() : null;
  }

  down(e) {
    if (!this.enabled || e.button !== 0) return;
    this.setRay(e);
    // Tools that take priority (e.g. fog painting while enabled)
    for (const t of this.tools) {
      if (t.priority && t.enabled()) {
        const hit = this.ray.intersectObjects(t.targets(), true)[0];
        if (hit) { this.activeTool = t; t.onDown?.(hit); return; }
      }
    }
    const meshes = this.grab.items.map((i) => i.mesh);
    const hit = this.ray.intersectObjects(meshes, true)[0];
    if (hit) {
      let o = hit.object; while (o && !meshes.includes(o)) o = o.parent;
      const it = this.grab.items.find((i) => i.mesh === o);
      if (it && it.canGrab?.() !== false && this.grab.canTake?.(it) !== false) {
        this.planeY = Math.max(hit.point.y, TABLE_TOP) + 0.08;
        this.dragging = it; this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
        this.point = this.planePoint(); return;
      }
    }
    for (const t of this.tools) {
      if (!t.priority && t.enabled()) {
        const h = this.ray.intersectObjects(t.targets(), true)[0];
        if (h) { this.activeTool = t; t.onDown?.(h); return; }
      }
    }
  }
  move(e) {
    if (!this.dragging && !this.activeTool) return;
    this.setRay(e);
    if (this.dragging) this.point = this.planePoint() || this.point;
    if (this.activeTool?.onDrag) { const h = this.ray.intersectObjects(this.activeTool.targets(), true)[0]; if (h) this.activeTool.onDrag(h); }
  }
  up(e) {
    if (this.dragging && this.downAt) {
      const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
      if (moved < 5 && performance.now() - this.downAt.t < 300) this.clicked = this.dragging;
    }
    this.dragging = null; this.activeTool?.onUp?.(); this.activeTool = null;
  }

  update() {
    if (this.clicked) { const c = this.clicked; this.clicked = null; setTimeout(() => this.onClickGrabbable?.(c), 0); }
    if (!this.dragging && !this.grab.held.mouse) return [{ id: 'mouse', point: this.point, grabbing: false, tips: [] }];
    return [{ id: 'mouse', handedness: 'mouse', point: this.point, grabbing: !!this.dragging, pinching: !!this.dragging, tips: [], hint: this.dragging }];
  }
}

export class DesktopCamera {
  constructor(camera, dom) {
    this.camera = camera; this.yaw = 0; this.pitch = 0.42; this.dist = 1.35; this.target = new THREE.Vector3(0, 0.9, -0.1);
    this.enabled = true;
    let drag = false, lx = 0, ly = 0;
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => { if (e.button === 2) { drag = true; lx = e.clientX; ly = e.clientY; } });
    window.addEventListener('pointerup', () => (drag = false));
    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.yaw -= (e.clientX - lx) * 0.005; this.pitch = Math.min(1.4, Math.max(-0.3, this.pitch + (e.clientY - ly) * 0.004));
      lx = e.clientX; ly = e.clientY;
    });
    dom.addEventListener('wheel', (e) => { this.dist = Math.min(6, Math.max(0.5, this.dist * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: true });
    // Keyboard view control: arrows / A-D turn, W-S tilt, +/- (or Z-X) zoom.
    this.keys = new Set();
    window.addEventListener('keydown', (e) => { if (!/input|textarea|select/i.test(e.target?.tagName)) this.keys.add(e.key.toLowerCase()); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    this.lastT = performance.now();
  }
  update() {
    if (!this.enabled) return;
    const now = performance.now(), dt = Math.min((now - this.lastT) / 1000, 0.1); this.lastT = now;
    const k = this.keys, on = (...names) => names.some((n) => k.has(n));
    if (on('arrowleft', 'a')) this.yaw -= 1.6 * dt;
    if (on('arrowright', 'd')) this.yaw += 1.6 * dt;
    if (on('arrowup', 'w')) this.pitch = Math.min(1.4, this.pitch + 1.0 * dt);
    if (on('arrowdown', 's')) this.pitch = Math.max(-0.3, this.pitch - 1.0 * dt);
    if (on('=', '+', 'z')) this.dist = Math.max(0.5, this.dist * (1 - 1.2 * dt));
    if (on('-', '_', 'x')) this.dist = Math.min(6, this.dist * (1 + 1.2 * dt));
    const c = this.camera, d = this.dist;
    c.position.set(this.target.x + Math.sin(this.yaw) * Math.cos(this.pitch) * d, this.target.y + Math.sin(this.pitch) * d, this.target.z + Math.cos(this.yaw) * Math.cos(this.pitch) * d);
    c.lookAt(this.target);
  }
}
