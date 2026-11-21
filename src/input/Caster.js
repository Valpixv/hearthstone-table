import * as THREE from 'three';
import { GestureTracker, FIRES_AS, CAST_CFG, scaledConfig, savedHandLength } from './castGestures.js';
import { GESTURES, GESTURE_LABELS } from '../party/sheet.js';
import { SPELL_EFFECTS } from '../fx/SpellFx.js';
import { TABLE_TOP } from '../physics/Physics.js';
import { parse, roll } from '../rules/dicePool.js';
import { random } from '../core/random.js';
import { esc } from '../ui/actions.js';
import { kitIcon } from '../ui/kit.js';
import { iconHTML } from '../ui/icons.js';
import { canRelease, defaultEffect, STRIKE_CFG } from '../combat/strikes.js';

const MODE_KEY = 'hearthstone-cast-mode';
const COS_ASSIST = Math.cos((STRIKE_CFG.aimAssistDeg * Math.PI) / 180);

/**
 * Target lock for a waiting strike: the target the ray points closest to, inside the assist cone. With a single
 * target, anywhere roughly in front of the hand locks it. Returns { idx, point } or null. Pure (three.js vectors).
 */
export function lockTarget(points, origin, dir) {
  let best = null;
  points.forEach((p, idx) => { const c = p.clone().sub(origin).normalize().dot(dir); if (!best || c > best.c) best = { idx, point: p, c }; });
  if (!best) return null;
  return best.c >= (points.length === 1 ? 0.2 : COS_ASSIST) ? { idx: best.idx, point: best.point } : null;
}

/**
 * Casting (design/completion-plan.md §7.4, §7.5). Hand tracking (XR or webcam): one GestureTracker per hand; a fired
 * gesture looks up the player's binding (token.sheet.castBindings).
 *  - When the DM has confirmed a strike for this player, the gesture RELEASES it: the bound effect flies at the
 *    confirmed targets and the damage lands on impact (aim only has to be roughly toward a target).
 *  - Otherwise it is a free cast: the effect plays where the hand points, an optional dice roll is shown, nothing is applied.
 * Desktop: a 4-slot spell bar (Shift+1…4 or click), then click a target; with a strike waiting, a big Unleash button.
 */
export class Caster {
  /** @param {{ dm, sync, spellFx, scene, camera, grab, dom, effects? }} deps */
  constructor(deps) {
    Object.assign(this, deps);
    const cfg = scaledConfig(CAST_CFG, savedHandLength()); // fitted to this player's hand by the Gesture Lab
    this.trackers = { left: new GestureTracker('left', cfg), right: new GestureTracker('right', cfg) };
    this.ray = new THREE.Raycaster(); this.armedSlot = null;
    let m = null; try { m = localStorage.getItem(MODE_KEY); } catch { /* storage unavailable */ }
    // Free casting (no strike waiting) is opt-in: by default hands only listen for signs when the DM has confirmed a
    // strike for you, so moving your hands around never fires anything (design/vr-hands-plan.md §4).
    this.castMode = m === 'on';
    this.lock = null; // the strike target the hand ray points closest to: { idx, point }
    this.aimLines = {};
    for (const side of ['left', 'right']) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
      const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: '#ffd34d', dashSize: 0.04, gapSize: 0.03, transparent: true, opacity: 0.8 }));
      l.visible = false; l.frustumCulled = false; this.scene.add(l); this.aimLines[side] = l;
    }
    // Target rings: a pulsing circle under every target of the strike waiting for this player.
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.8, 1, 40); this.ringGeo.rotateX(-Math.PI / 2);
    this.ringT = 0;
    this.sync?.on('cast', (msg) => this.onRemote(msg));
    this.buildBar();
  }

  /** The PC whose bindings this machine casts with: my own; on the DM / a single machine, the first PC that has any. */
  get caster() {
    const toks = this.dm.state.tokens || [], me = this.sync?.me?.id;
    return toks.find((t) => t.kind === 'pc' && me && t.owner === me) || (this.sync?.role !== 'player' ? toks.find((t) => t.kind === 'pc' && t.sheet?.castBindings?.length) : null) || null;
  }
  get bindings() { return this.caster?.sheet?.castBindings || []; }
  get isDM() { return this.sync?.role !== 'player'; }

  /**
   * The confirmed strike waiting for this machine's gesture: a player's own; for the DM, strikes of creatures no
   * connected player controls (monsters, NPCs, away characters).
   */
  armedStrike() {
    const toks = this.dm.state.tokens || [], me = this.sync?.me?.id ?? null, present = new Set((this.sync?.players || []).map((p) => p.id));
    for (const s of this.dm.state.strikes || []) {
      if (s.status !== 'armed') continue;
      const by = toks.find((t) => t.id === s.by);
      if (this.isDM) { if (!(by && by.kind === 'pc' && by.owner && present.has(by.owner) && by.owner !== me)) return s; }
      else if (canRelease(s, me, false, toks)) return s;
    }
    return null;
  }

  setCastMode(on) { this.castMode = !!on; try { localStorage.setItem(MODE_KEY, on ? 'on' : 'off'); } catch { /* ignore */ } this.renderBar(); }

  // ---------- hands ----------
  update(hands, dt) {
    const strike = this.armedStrike(), seen = new Set();
    this.updateRings(strike, dt);
    for (const h of hands || []) {
      const side = h.handedness === 'left' ? 'left' : h.handedness === 'right' ? 'right' : null;
      if (!side || !h.joints) continue;
      seen.add(side);
      // A waiting strike can always be released, even with cast mode off or no bindings (the default effect is used).
      const blocked = (!strike && (!this.castMode || !this.bindings.length)) || !!this.grab?.held?.[h.id] || this.blocked?.(side);
      const r = this.trackers[side].update(h.joints, dt, { blocked });
      const bound = r.armed && (strike || this.bindings.some((b) => (FIRES_AS[r.armed] || [r.armed]).includes(b.gesture)));
      // Aim with the hand's stable pointing ray (the Quest's own hand ray) rather than the shaky finger bones.
      const ray = !blocked && this.aimRay?.(side), aim = ray ? { origin: ray.origin.toArray(), dir: ray.dir.toArray() } : r.aim;
      this.showAim(side, bound ? aim : null, strike);
      if (r.fire) {
        const b = this.bindings.find((x) => x.gesture === r.fire.gesture), o = ray ? aim.origin : r.fire.origin, d = ray ? aim.dir : r.fire.dir; // the fired sign's own aim without a ray (a slash aims along the fingers)
        if (strike) this.tryRelease(strike, b, o, d);
        else if (b) this.castAlong(b, o, d);
      }
    }
    for (const side of ['left', 'right']) if (!seen.has(side)) { this.trackers[side].update(null, dt); this.showAim(side, null); }
  }

  /** Points of a strike's targets (life-size body first, else the mini). */
  strikePoints(strike) {
    const flow = this.dm.strikes;
    return (strike?.targets || []).map((t) => flow?.tokenPoint(t.id)).filter(Boolean);
  }

  showAim(side, aim, strike = null) {
    const l = this.aimLines[side]; l.visible = !!aim; if (!aim) { if (this.lock?.side === side) this.lock = null; return; }
    const o = new THREE.Vector3(...aim.origin), d = new THREE.Vector3(...aim.dir).normalize();
    // With a strike waiting, the line locks onto the target the hand points closest to, so you see what you'll hit.
    const lk = strike ? lockTarget(this.strikePoints(strike), o, d) : null;
    this.lock = lk ? { ...lk, side } : null;
    const hit = lk?.point || this.pick(o, d).point;
    l.material.color.set(lk ? '#ff5a1f' : '#ffd34d');
    l.geometry.setFromPoints([o, hit]); l.computeLineDistances();
  }

  updateRings(strike, dt) {
    const pts = strike ? this.strikePoints(strike) : [];
    while (this.rings.length < pts.length) {
      const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: '#ff5a1f', transparent: true, opacity: 0.85, depthWrite: false, fog: false, side: THREE.DoubleSide }));
      m.renderOrder = 8; this.scene.add(m); this.rings.push(m);
    }
    this.ringT += dt;
    this.rings.forEach((m, i) => {
      const p = pts[i]; m.visible = !!p; if (!p) return;
      const locked = this.lock?.idx === i, life = p.y > TABLE_TOP + 0.3, r = (life ? 0.55 : 0.035) * (locked ? 1.25 : 1) * (1 + Math.sin(this.ringT * (locked ? 9 : 5)) * 0.08);
      m.position.set(p.x, life ? 0.02 : TABLE_TOP + 0.006, p.z); m.scale.setScalar(r);
      m.material.color.set(locked ? '#ffe9a8' : strike.heal ? '#4fd17a' : '#ff5a1f');
    });
  }

  /** Objects a spell can hit: life-size bodies and board minis. */
  targets() {
    const refs = Object.values(this.dm.tokens?.refs || {});
    return refs.flatMap((r) => [r?.life, r?.item?.mesh]).filter(Boolean);
  }
  /** Token id of a scene object that belongs to a token (or null). */
  tokenOf(obj) {
    const refs = this.dm.tokens?.refs || {};
    for (let o = obj; o; o = o.parent) for (const [id, r] of Object.entries(refs)) if (r?.life === o || r?.item?.mesh === o) return id;
    return null;
  }

  /** First thing along the ray: { point, tokenId } for a creature, else the table top, the floor, or 4 m out. */
  pick(origin, dir) {
    this.ray.set(origin, dir.clone().normalize()); this.ray.far = 30;
    const hit = this.ray.intersectObjects(this.targets(), true)[0];
    if (hit) return { point: hit.point, tokenId: this.tokenOf(hit.object) };
    const p = new THREE.Vector3();
    for (const y of [TABLE_TOP, 0]) {
      if (this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p) && (y === 0 || (Math.abs(p.x) < 0.85 && Math.abs(p.z) < 0.65))) return { point: p.clone(), tokenId: null };
    }
    return { point: origin.clone().addScaledVector(dir.clone().normalize(), 4), tokenId: null };
  }

  /** A fired gesture with a strike waiting: releases it when the hand points roughly at a target (healing always goes). */
  tryRelease(strike, binding, origin, dir) {
    const o = new THREE.Vector3(...origin), d = new THREE.Vector3(...dir).normalize();
    const ok = strike.heal || !!lockTarget(this.strikePoints(strike), o, d);
    if (!ok) { this.hint?.('Point your hand at the glowing target.'); return false; }
    return this.releaseStrike(strike, binding?.effectId, origin);
  }

  /** Releases a strike with an effect (the DM executes; a player's machine asks the DM's). */
  releaseStrike(strike, effectId = null, origin = null) {
    if (!strike) return false;
    try { this.dm.act('strike.release', { id: strike.id, effectId: SPELL_EFFECTS[effectId] ? effectId : defaultEffect(strike), origin: origin ? [...origin] : this.cameraOrigin().toArray() }); return true; }
    catch (e) { console.warn('[cast] release failed', e); return false; }
  }

  castAlong(binding, origin, dir) {
    const o = new THREE.Vector3(...origin), hit = this.pick(o, new THREE.Vector3(...dir));
    this.cast(binding, o, hit.point, hit.tokenId);
  }

  /** A free cast: plays a binding locally, rolls its dice (shown only) and tells the table. Nothing is applied. */
  cast(binding, origin, target, targetId = null) {
    const e = SPELL_EFFECTS[binding.effectId]; if (!e) return;
    let text = `${this.caster?.name || 'Someone'}: ${binding.label || e.name}`;
    if (binding.roll) { try { const r = roll(parse(binding.roll), random); text += ` (${binding.roll} = ${r.total})`; } catch { text += ` (${binding.roll})`; } }
    const msg = { t: 'cast', effectId: binding.effectId, origin: origin.toArray(), target: target.toArray(), targetId, text };
    this.show(msg);
    this.sync?.send(msg);
  }

  show(m) {
    this.spellFx.play(m.effectId, { origin: m.origin, target: m.target });
    if (m.text) this.effects?.label?.(m.text, new THREE.Vector3(...m.target).add(new THREE.Vector3(0, 0.25, 0)), { scale: 0.05, life: 2.4 });
  }

  /** Remote casts are cosmetic; validate the shape before playing. */
  onRemote(m) {
    const ok = (a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
    if (!SPELL_EFFECTS[m.effectId] || !ok(m.origin) || !ok(m.target)) return;
    this.show({ ...m, text: String(m.text || '').slice(0, 80) });
  }

  /** Sheet "Test" button: plays an effect from in front of the camera at the table centre. */
  preview(effectId) {
    if (!SPELL_EFFECTS[effectId]) return;
    this.spellFx.play(effectId, { origin: this.cameraOrigin(), target: new THREE.Vector3(0, TABLE_TOP + 0.05, 0) });
  }

  cameraOrigin() {
    const c = this.camera, p = new THREE.Vector3(), f = new THREE.Vector3();
    c.getWorldPosition(p); c.getWorldDirection(f);
    return p.addScaledVector(f, 0.35).add(new THREE.Vector3(0, -0.15, 0));
  }

  // ---------- desktop spell bar ----------
  buildBar() {
    const doc = globalThis.document; if (!doc) return;
    this.bar = doc.createElement('div'); this.bar.id = 'spell-bar'; this.bar.hidden = true; doc.body.appendChild(this.bar);
    this.banner = doc.createElement('div'); this.banner.id = 'strike-banner'; this.banner.hidden = true; this.banner.setAttribute('role', 'status'); doc.body.appendChild(this.banner);
    this.banner.addEventListener('click', (e) => { if (e.target.closest('[data-unleash]')) this.unleash(); });
    this.bar.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.mode) return this.setCastMode(!this.castMode);
      this.arm(Number(b.dataset.slot));
    });
    // Capture on window so a targeting click never reaches the mouse grab.
    addEventListener('pointerdown', (e) => {
      if (this.armedSlot == null || e.button !== 0 || e.target !== this.dom) return;
      e.stopPropagation(); e.preventDefault();
      const b = this.bindings.find((x) => x.gesture === GESTURES[this.armedSlot]);
      const r = this.dom.getBoundingClientRect(), ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.ray.setFromCamera(ndc, this.camera);
      const hit = this.pick(this.ray.ray.origin.clone(), this.ray.ray.direction.clone());
      if (b) this.cast(b, this.cameraOrigin(), hit.point, hit.tokenId);
      this.arm(null);
    }, true);
    addEventListener('keydown', (e) => {
      if (e.target.matches?.('input,textarea,select')) return;
      if (e.key === 'Escape' && this.armedSlot != null) return this.arm(null);
      if (e.shiftKey && /^Digit[1-4]$/.test(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); this.arm(Number(e.code.slice(5)) - 1); }
      if ((e.key === 'Enter' || e.key === 'u') && this.armedStrike() && !e.target.closest?.('#dm-panel, #dice-tray, #char-sheet, #lobby')) { e.preventDefault(); this.unleash(); }
    }, true);
    this.dm.on(() => this.renderBar());
  }

  /** Desktop: releases the waiting strike with the readied slot's effect (or the first binding, or the default). */
  unleash() {
    const s = this.armedStrike(); if (!s) return false;
    const b = (this.armedSlot != null && this.bindings.find((x) => x.gesture === GESTURES[this.armedSlot])) || (this.isDM ? null : this.bindings[0]) || null;
    this.arm(null);
    return this.releaseStrike(s, b?.effectId, null);
  }

  /** With a strike waiting, readying a slot releases it with that slot's effect. */
  arm(slot) {
    const has = slot != null && this.bindings.some((b) => b.gesture === GESTURES[slot]);
    const strike = has ? this.armedStrike() : null;
    if (strike) { const b = this.bindings.find((x) => x.gesture === GESTURES[slot]); this.armedSlot = null; this.releaseStrike(strike, b.effectId, null); this.renderBar(); return; }
    this.armedSlot = has && this.armedSlot !== slot ? slot : null;
    globalThis.document?.body.classList.toggle('casting', this.armedSlot != null);
    this.renderBar();
  }

  renderBar() {
    if (!this.bar) return;
    const list = this.bindings, strike = this.armedStrike(), toks = this.dm.state.tokens || [];
    this.bar.hidden = !list.length || !this.sync?.role;
    if (!this.bar.hidden) {
      const html = GESTURES.map((g, i) => { const b = list.find((x) => x.gesture === g); if (!b) return '';
        const ic = kitIcon(`spell/${b.effectId}`, { cls: 'sb-ic' }) || iconHTML(SPELL_EFFECTS[b.effectId]?.damageType, 'gi-xl') || iconHTML('attack', 'gi-xl');
        return `<button data-slot="${i}" class="${this.armedSlot === i ? 'armed' : ''}" title="Shift+${i + 1}, then click a target">${ic}<span><b>${i + 1}. ${esc(b.label || SPELL_EFFECTS[b.effectId]?.name || b.effectId)}</b><small>${kitIcon(`gesture/${g}`, { cls: 'sb-g' })}${GESTURE_LABELS[g]}${b.roll ? ` · ${esc(b.roll)}` : ''}</small></span></button>`; }).join('')
        + `<button class="mode${this.castMode ? '' : ' off'}" data-mode="1" title="Hand-gesture casting on/off (a confirmed strike can always be released)">Gestures ${this.castMode ? 'on' : 'off'}</button>`;
      if (this.bar.dataset.sig !== html) { this.bar.innerHTML = html; this.bar.dataset.sig = html; }
    }
    if (this.banner) {
      this.banner.hidden = !strike;
      if (strike) {
        const names = strike.targets.map((t) => `${toks.find((x) => x.id === t.id)?.name || '?'} (${strike.heal ? '+' : ''}${t.amount})`).join(', ');
        const by = toks.find((x) => x.id === strike.by)?.name || 'A creature';
        const html = `<b>${strike.heal ? 'Heal' : 'Unleash it!'}</b><span>${esc(by)} → ${esc(names)}${strike.damageType ? ` · ${esc(strike.damageType)}` : ''}</span>
          <small>Make your hand sign at the glowing target${list.length ? ', or press 1–4 on the spell bar' : ''}.</small><button class="btn" data-unleash="1">Unleash (Enter)</button>`;
        if (this.banner.dataset.sig !== html) { this.banner.innerHTML = html; this.banner.dataset.sig = html; }
      }
    }
  }
}
