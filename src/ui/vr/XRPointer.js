import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { OneEuroVec3 } from '../../input/OneEuro.js';
import { shoulderRay, pinchStrength } from '../../input/handRay.js';

/** Where the controller profiles live (copied from @webxr-input-profiles/assets by tools/copy-xr-profiles.mjs). */
const PROFILES_PATH = `${import.meta.env?.BASE_URL ?? '/'}assets/xr-profiles`;

/**
 * Tuning for pointing in VR (design/vr-hands-plan.md §3).
 * freeze: seconds the ray direction is held when a pinch starts (pinching moves the hand; the click must not move).
 * filter: One Euro settings for the fallback ray (the Quest's own hand ray is already filtered by the system).
 */
export const POINTER_CFG = { rayLength: 6, stick: 0.5, freeze: 0.12, rayStart: 0.07, filter: { minCutoff: 1.0, beta: 1.6, dCutoff: 1.0 } };

/**
 * Legacy wrist→knuckle ray, kept only for webcam hands on a desktop preview. In the headset the Quest's own
 * hand ray (inputSource.targetRaySpace) or shoulderRay() is used.
 */
export function handRay(joints) {
  const w = joints?.wrist?.p, k = joints?.['index-finger-phalanx-proximal']?.p, m = joints?.['middle-finger-phalanx-proximal']?.p;
  if (!w || !k) return null;
  const base = m ? [(k[0] + m[0]) / 2, (k[1] + m[1]) / 2, (k[2] + m[2]) / 2] : k;
  let d = [base[0] - w[0], base[1] - w[1], base[2] - w[2]];
  const len = Math.hypot(...d) || 1; d = d.map((v) => v / len);
  d[1] -= 0.35 * Math.max(0, d[1]);
  const l2 = Math.hypot(...d) || 1;
  return { origin: k, dir: d.map((v) => v / l2) };
}

/**
 * One pointer abstraction for the headset: every frame it yields a list of pointers, each with a ray, a pressed
 * state with edges, and (for bare hands) the index fingertip for poking.
 *   - bare hands:  the Quest's system hand ray and system pinch (select events), the same ones the Quest home menu
 *                  uses; fallback: a shoulder→pinch-point ray, One-Euro filtered, with our own pinch detection
 *   - controllers: the target ray, trigger = press, grip = grab, thumbstick y scrolls, x turns what is dragged
 */
export class XRPointer {
  constructor({ renderer, rig }) {
    this.renderer = renderer; this.rig = rig; this.state = {}; this.pointers = []; this.t = 0;
    let factory = null; try { factory = new XRControllerModelFactory(); factory.setPath(PROFILES_PATH); } catch (e) { console.warn('[xr] controller models unavailable', e); }
    this.ctl = [0, 1].map((i) => {
      const ray = renderer.xr.getController(i), grip = renderer.xr.getControllerGrip(i);
      const c = { ray, grip, hand: null, connected: false, isHand: false, sysSelect: false, select: false, squeeze: false, source: null };
      ray.addEventListener('connected', (e) => { c.source = e.data; c.hand = e.data.handedness; c.isHand = !!e.data.hand; c.connected = !e.data.hand && e.data.targetRayMode === 'tracked-pointer'; });
      ray.addEventListener('disconnected', () => { c.connected = false; c.sysSelect = false; c.isHand = false; c.select = c.squeeze = false; c.source = null; });
      ray.addEventListener('selectstart', () => { c.select = true; if (c.isHand) c.sysSelect = true; }); ray.addEventListener('selectend', () => { c.select = false; });
      ray.addEventListener('squeezestart', () => { c.squeeze = true; }); ray.addEventListener('squeezeend', () => { c.squeeze = false; });
      const wand = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.12, 10), new THREE.MeshStandardMaterial({ color: '#5b3418', roughness: 0.6 }));
      wand.rotation.x = Math.PI / 2; wand.position.z = 0.03; wand.visible = false; grip.add(wand); c.wand = wand;
      if (factory) { try { const model = factory.createControllerModel(grip); model.addEventListener?.('motionconnected', () => { c.hasModel = true; }); grip.add(model); c.model = model; } catch (e) { console.warn('[xr] controller model failed', e); } }
      rig.add(ray, grip);
      c.vis = this.makeVisual();
      return c;
    });
    this.handVis = { left: this.makeVisual(), right: this.makeVisual() };
  }

  /** A Meta-style pointer: a ray that fades in from the hand and a round cursor that shrinks as you pinch. */
  makeVisual() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array([1, 1, 1, 0, 1, 1, 1, 0.85]), 4));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, fog: false, depthTest: false, toneMapped: false }));
    line.frustumCulled = false; line.visible = false; line.renderOrder = 30;
    const cursor = new THREE.Mesh(new THREE.RingGeometry(0.62, 1, 32), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, fog: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide }));
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.0, fog: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide }));
    cursor.add(dot); cursor.frustumCulled = false; cursor.visible = false; cursor.renderOrder = 31; dot.renderOrder = 31;
    const parent = this.rig.parent || this.rig; parent.add(line, cursor);
    return { line, cursor, dot };
  }

  /** Controllers as grabbing hands for GrabSystem (grip = grab). Registered as an InputManager pointer source. */
  controllerHands() {
    const out = [], p = new THREE.Vector3();
    for (const c of this.ctl) {
      c.wand.visible = c.connected && !(c.model && c.model.children.length);
      if (!c.connected || !this.renderer.xr.isPresenting) continue;
      c.grip.getWorldPosition(p);
      out.push({ id: `ctl-${c.hand}`, handedness: `ctl-${c.hand}`, point: p.toArray(), grabbing: c.squeeze, pinching: c.squeeze, fist: false, palmUp: false, tips: [], controller: true });
    }
    return out;
  }

  axes(hand) { const c = this.ctl.find((x) => x.connected && x.hand === hand), ax = c?.source?.gamepad?.axes; if (!ax) return [0, 0]; return ax.length >= 4 ? [ax[2] || 0, ax[3] || 0] : [ax[0] || 0, ax[1] || 0]; }
  /** Thumbstick x of a controller hand (-1..1), 0 with bare hands. */
  stickX(hand) { const x = this.axes(hand)[0]; return Math.abs(x) > POINTER_CFG.stick ? x : 0; }
  /** Thumbstick y (-1 up … 1 down), 0 with bare hands. */
  stickY(hand) { const y = this.axes(hand)[1]; return Math.abs(y) > POINTER_CFG.stick ? y : 0; }
  /** Is the menu / secondary button of the left controller down? (opens the hand menu) */
  menuButton() {
    const c = this.ctl.find((x) => x.connected && x.hand === 'left'), b = c?.source?.gamepad?.buttons;
    return !!(b && (b[4]?.pressed || b[5]?.pressed || b[3]?.pressed));
  }
  /** B / Y button of a controller (closes the panel under its ray). */
  backButton(hand) { const c = this.ctl.find((x) => x.connected && x.hand === hand), b = c?.source?.gamepad?.buttons; return !!(b && b[5]?.pressed); }
  /** A short buzz on a controller (no-op for bare hands). */
  pulse(id, strength = 0.4, ms = 30) {
    const c = this.ctl.find((x) => `ctl-${x.hand}` === id);
    try { c?.source?.gamepad?.hapticActuators?.[0]?.pulse(strength, ms); } catch { /* no haptics */ }
  }

  /** The Quest's own ray for a tracked hand: { origin, dir } in world space, or null when the system gives none. */
  systemHandRay(handedness) {
    const c = this.ctl.find((x) => x.isHand && x.hand === handedness && x.source);
    if (!c || !c.ray.visible) return null;
    const o = new THREE.Vector3(), q = new THREE.Quaternion(); c.ray.getWorldPosition(o); c.ray.getWorldQuaternion(q);
    if (!Number.isFinite(o.x) || (o.lengthSq() === 0 && q.w === 1)) return null;
    return { origin: o, dir: new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize(), ctl: c };
  }

  /**
   * Builds this frame's pointers from tracked hands and controllers.
   * @param {object[]} hands HandState[] from InputManager
   * @param {number} [dt] seconds
   * @param {{ p: THREE.Vector3, f: THREE.Vector3 }} [head] eye position and view direction (for the fallback ray)
   */
  update(hands = [], dt = 1 / 72, head = null) {
    this.t += dt;
    const out = [], seen = new Set(), q = new THREE.Quaternion();
    for (const h of hands) {
      if (!h.joints || (h.handedness !== 'left' && h.handedness !== 'right')) continue;
      const st = (this.state[h.id] ||= { down: false, filt: new OneEuroVec3(POINTER_CFG.filter, true), ofilt: new OneEuroVec3(POINTER_CFG.filter), frozen: null });
      const sys = this.systemHandRay(h.handedness);
      let origin, dir, source;
      if (sys) { origin = sys.origin; dir = sys.dir; source = 'system'; st.filt.reset(); st.ofilt.reset(); }
      else {
        let r = null;
        if (head) { const f = head.f.clone(); f.y = 0; if (f.lengthSq() < 1e-6) f.set(0, 0, -1); f.normalize(); r = shoulderRay(h.joints, { p: head.p.toArray(), right: [-f.z, 0, f.x], fwd: f.toArray() }, h.handedness); }
        r ||= handRay(h.joints); if (!r) continue;
        origin = new THREE.Vector3(...st.ofilt.filter(r.origin, dt)); dir = new THREE.Vector3(...st.filt.filter(r.dir, dt)); source = 'fallback';
      }
      // Press: the system pinch once the system has shown it sends one for this hand, else our own pinch detection.
      const down = sys?.ctl?.sysSelect ? !!sys.ctl.select : !!h.pinching;
      // Freeze the direction for a moment when the pinch starts, so the click lands where the cursor was.
      if (down && !st.down) st.frozen = { dir: (st.hoverDir || dir).clone(), until: this.t + POINTER_CFG.freeze };
      if (st.frozen && this.t < st.frozen.until) dir = st.frozen.dir.clone(); else if (!down) st.frozen = null;
      if (!down) (st.hoverDir ||= new THREE.Vector3()).copy(dir);
      const tip = h.joints['index-finger-tip']?.p;
      const p = this.make(h.id, h.handedness, 'hand', origin, dir, down, tip ? new THREE.Vector3(...tip) : null, this.handVis[h.handedness], !!h.palmUp);
      p.joints = h.joints; p.source = source; p.strength = down ? 1 : pinchStrength(h.joints);
      out.push(p); seen.add(h.id);
    }
    for (const c of this.ctl) {
      if (!c.connected) continue;
      const id = `ctl-${c.hand}`, o = new THREE.Vector3(), d = new THREE.Vector3(0, 0, -1);
      c.ray.getWorldPosition(o); c.ray.getWorldQuaternion(q); d.applyQuaternion(q).normalize();
      const p = this.make(id, c.hand, 'controller', o, d, c.select, null, c.vis, false);
      p.strength = c.select ? 1 : (c.source?.gamepad?.buttons?.[0]?.value || 0); p.source = 'controller';
      out.push(p); seen.add(id);
    }
    for (const id of Object.keys(this.state)) if (!seen.has(id)) delete this.state[id];
    for (const v of [...Object.values(this.handVis), ...this.ctl.map((c) => c.vis)]) if (!out.some((p) => p.line === v)) this.hide(v);
    this.pointers = out;
    return out;
  }

  make(id, hand, kind, origin, dir, down, tip, line, palmUp) {
    const st = (this.state[id] ||= { down: false });
    const p = { id, hand, kind, origin, dir, down, pressed: down && !st.down, released: !down && st.down, tip, line, palmUp };
    st.down = down;
    return p;
  }

  hide(v) { v.line.visible = false; v.cursor.visible = false; }

  /**
   * Draws a pointer's ray to a hit point (hidden when it points at nothing it can use).
   * @param {object} p pointer @param {THREE.Vector3|null} hitPoint @param {boolean} [active] pressing / dragging
   * @param {THREE.Vector3} [normal] surface normal at the hit (the cursor lies flat on it)
   */
  show(p, hitPoint, active = false, normal = null) {
    const v = p.line; if (!v) return;
    if (!hitPoint) { this.hide(v); return; }
    const d = hitPoint.distanceTo(p.origin), start = p.origin.clone().addScaledVector(p.dir, Math.min(POINTER_CFG.rayStart, d * 0.5));
    const pos = v.line.geometry.attributes.position; pos.setXYZ(0, start.x, start.y, start.z); pos.setXYZ(1, hitPoint.x, hitPoint.y, hitPoint.z); pos.needsUpdate = true;
    const col = active ? [1, 0.6, 0.25] : [1, 0.93, 0.75], ca = v.line.geometry.attributes.color;
    ca.setXYZW(0, ...col, 0); ca.setXYZW(1, ...col, active ? 0.95 : 0.7); ca.needsUpdate = true;
    v.line.visible = true;
    // Cursor: bigger far away so it reads the same size; shrinks and fills as the pinch closes.
    const s = Math.max(0.006, d * 0.011) * (1 - 0.35 * (p.strength || 0));
    v.cursor.position.copy(hitPoint).addScaledVector(p.dir, -0.002); v.cursor.scale.setScalar(s);
    if (normal) v.cursor.lookAt(v.cursor.position.clone().add(normal)); else v.cursor.lookAt(p.origin);
    v.cursor.material.color.setRGB(...col); v.dot.material.color.setRGB(...col); v.dot.material.opacity = active ? 0.95 : 0.25 + 0.6 * (p.strength || 0);
    v.cursor.visible = true;
  }
  /** Hides a pointer's ray (the fingertip owns the hand). */
  hideRay(p) { if (p.line) this.hide(p.line); }
}
