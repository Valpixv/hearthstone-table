import * as THREE from 'three';
import { XRPointer } from './XRPointer.js';
import { drawFrame, drawKit, kitHas, kitImage, onKitLoad, symKey } from '../kit.js';
import { iconKey } from '../icons.js';
import { act } from '../actions.js';
import { tiles as galleryTiles } from '../panels/CreaturesPanel.js';
import { sceneKitKey } from '../panels/WorldPanel.js';
import { itemKitKey } from '../../party/itemIcons.js';
import { SCENE_LABELS } from '../../scene/SceneManager.js';
import { FONT, fontsReady } from '../../scene/fonts.js';
import { roundRect } from '../../scene/util.js';
import { ABILITIES, ABILITY_NAMES, SKILLS, GESTURES, GESTURE_LABELS, defaultSheet, abilityMod, fmtMod, saveBonus, skillBonus, hitDiceLeft, completeness } from '../../party/sheet.js';
import { SPELL_EFFECTS } from '../../fx/SpellFx.js';
import { FORMATIONS } from '../../table/arena.js';
import { TABLE_TOP, TRAY } from '../../physics/Physics.js';
import * as P from '../../rules/dicePool.js';
import { CONDITIONS } from '../../rules/combat.js';
import { palmNormal } from '../../input/gestures.js';
import { stepPoke, POKE_CFG, BLOCKS_GESTURES } from './arbiter.js';
import { GestureLab } from './GestureLab.js';
import CFG from '../../data/tableDefaults.json';

const VR = CFG.vr;
const W = 1000, TITLE = 96, PAD = 30, GAP = 12, SS = 1.25;
const C = { ink: '#f6ead0', dim: '#cbb994', gold: '#f3d58a', brass: '#c99a3b', wood: '#4a2414', woodHi: '#6b3a22', teal: '#1f8f86', tealHi: '#39c2b6', crimson: '#a8281e', crimsonHi: '#d2452f', green: '#3f8f45', dark: '#1c0d07' };
const cap = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());

/** Menu entries: [id, label, kit emblem, DM only]. */
export const VR_MENU = [
  ['dice', 'Dice', 'nav/dice', false], ['sheet', 'Character', 'session/my-sheet', false], ['bag', 'Bag', 'sheet/inventory', false], ['spells', 'Spells', 'sheet/spells', false],
  ['voice', 'Voice', 'voice/mic-on', false], ['creatures', 'Creatures', 'nav/creatures', true], ['combat', 'Combat', 'combat/attack', true], ['requests', 'Requests', 'filter/requests', true],
  ['world', 'World', 'nav/world', true], ['table', 'Table', 'nav/table', true], ['forge', 'Forge', 'nav/forge', true], ['tools', 'Tools', 'nav/tools', true],
  ['handouts', 'Handouts', 'voice/handout', false], ['lab', 'Practice', 'voice/gesture-practice', false],
];
/** Tuning for long presses and ray scrolling (canvas pixels, seconds, degrees). */
export const PRESS_CFG = { holdTime: 0.6, scrollPx: 28, slipDeg: 4, stickScroll: 900 };
const RAD = Math.PI / 180;

/**
 * Pure layout helper: splits a row of `n` cells into [x, w] pairs across `width` with a gap. Used by the painter and tests.
 */
export function cells(n, width, gap = GAP, x0 = 0) {
  const w = (width - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => [x0 + i * (w + gap), w]);
}

/** True when canvas point (x, y) is inside rect r. Pure. */
export const inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/**
 * A floating panel: a canvas texture in a kit frame, with a title bar to drag it by and a close button.
 * `paint(painter)` is called on every redraw (immediate mode); the painter records the rectangles that can be pressed.
 */
class VRWindow {
  constructor(ui, { id, title, w = 0.54, h = 0.42, paint, closable = true, icon = null }) {
    Object.assign(this, { ui, id, title, mw: w, mh: h, paint, closable, icon });
    this.H = Math.round((W * h) / w); this.rects = []; this.scroll = 0; this.contentH = 0; this.dirty = true; this.hover = null;
    this.canvas = document.createElement('canvas'); this.canvas.width = W * SS; this.canvas.height = this.H * SS;
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, fog: false, toneMapped: false }));
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.96, h * 0.94), new THREE.MeshBasicMaterial({ color: C.dark, side: THREE.BackSide, fog: false }));
    back.position.z = -0.002; this.mesh.add(back);
    this.mesh.visible = false; this.mesh.renderOrder = 20; ui.scene.add(this.mesh);
  }
  get visible() { return this.mesh.visible; }
  show(v = true) { this.mesh.visible = v; if (v) this.dirty = true; }

  /** Where a ray meets the panel: { dist, x, y, point } in canvas units, or null. */
  raycast(origin, dir) {
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion), denom = n.dot(dir);
    if (Math.abs(denom) < 1e-5) return null;
    const t = n.dot(this.mesh.position.clone().sub(origin)) / denom; if (t <= 0 || t > 8) return null;
    const point = origin.clone().addScaledVector(dir, t), xy = this.toCanvas(point);
    return xy ? { dist: t, point, ...xy } : null;
  }
  /** World point → canvas x, y (null when outside the panel). z: signed distance in front of the panel. */
  toCanvas(point) {
    const l = this.mesh.worldToLocal(point.clone());
    if (Math.abs(l.x) > this.mw / 2 || Math.abs(l.y) > this.mh / 2) return null;
    return { x: (l.x / this.mw + 0.5) * W, y: (0.5 - l.y / this.mh) * this.H, z: l.z };
  }
  rectAt(x, y) { for (let i = this.rects.length - 1; i >= 0; i--) if (inRect(this.rects[i], x, y)) return this.rects[i]; return null; }
  /** Largest scroll offset (0 when everything fits). */
  get maxScroll() { return Math.max(0, this.contentH - (this.H - TITLE - 10 - PAD)); }
  scrollBy(dy) { const m = this.maxScroll; if (!m) return false; const v = Math.max(0, Math.min(m, this.scroll + dy)); if (v !== this.scroll) { this.scroll = v; this.dirty = true; } return true; }

  redraw() {
    this.dirty = false; this.rects = [];
    const g = this.canvas.getContext('2d'), H = this.H;
    g.setTransform(SS, 0, 0, SS, 0, 0); g.clearRect(0, 0, W, H);
    if (!drawFrame(g, 'ui/panel', 0, 0, W, H, 0.3, 84)) { g.fillStyle = C.wood; roundRect(g, 4, 4, W - 8, H - 8, 30); g.fill(); g.strokeStyle = C.brass; g.lineWidth = 6; g.stroke(); }
    // Title bar: drag handle, emblem, title, close.
    g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = C.gold; g.font = `bold 44px ${FONT.deco}`;
    if (this.icon) drawKit(g, symKey(this.icon), PAD + 6, 14, 78, 78); // beside the live title: the picture, not its painted word
    g.fillText(this.title, PAD + (this.icon ? 96 : 14), TITLE / 2 + 8, W - 260);
    this.rects.push({ x: 0, y: 0, w: W - 130, h: TITLE, kind: 'title' });
    if (this.closable) { const r = { x: W - 118, y: 4, w: 104, h: 88, run: () => this.ui.close(this.id), key: 'close' }; if (!drawKit(g, 'ctl/close', r.x, r.y, r.w, r.h)) { g.fillStyle = C.crimson; roundRect(g, r.x, r.y, r.w, r.h, 16); g.fill(); } this.rects.push(r); }
    // Content, clipped and scrolled.
    const top = TITLE + 10, viewH = H - top - PAD;
    g.save(); g.beginPath(); g.rect(PAD, top, W - PAD * 2, viewH); g.clip();
    const p = new Painter(this, g, top - this.scroll, top, top + viewH);
    try { this.paint(p); } catch (e) { console.warn('[vr] paint', this.id, e); }
    g.restore();
    this.contentH = p.y + this.scroll - top; const max = Math.max(0, this.contentH - viewH);
    if (this.scroll > max) { this.scroll = max; this.dirty = true; }
    if (max > 0) { // scroll arrows on the right edge
      for (const [dy, key, y] of [[-1, 'ctl/up', top + 4], [1, 'ctl/down', H - PAD - 74]]) {
        const r = { x: W - PAD - 70, y, w: 70, h: 70, run: () => { this.scroll = Math.max(0, Math.min(max, this.scroll + dy * viewH * 0.6)); }, key: `scroll${dy}` };
        g.globalAlpha = (dy < 0 ? this.scroll > 0 : this.scroll < max) ? 1 : 0.3; if (!drawKit(g, key, r.x, r.y, r.w, r.h)) { g.fillStyle = C.brass; g.fillRect(r.x, r.y, r.w, r.h); } g.globalAlpha = 1; this.rects.push(r);
      }
    }
    if (this.hover && this.hover.kind !== 'title') { const h = this.rects.find((r) => r.key === this.hover.key && r.key != null); if (h) { g.strokeStyle = C.gold; g.lineWidth = 5; roundRect(g, h.x - 2, h.y - 2, h.w + 4, h.h + 4, 16); g.stroke(); } }
    // Press feedback: a short gold flash on what was pressed (hands have no haptics; Meta: always show the press).
    if (this.flash) { const h = this.rects.find((r) => r.key === this.flash.key && r.key != null); if (h) { g.fillStyle = 'rgba(255,214,120,0.38)'; roundRect(g, h.x, h.y, h.w, h.h, 16); g.fill(); } }
    g.setTransform(1, 0, 0, 1, 0, 0); this.tex.needsUpdate = true;
  }
}

/** Immediate-mode drawing of panel content. Every pressable thing records a rect { x, y, w, h, run, key, drag? }. */
class Painter {
  constructor(win, g, y, top, bottom) { this.win = win; this.g = g; this.y = y; this.top = top; this.bottom = bottom; this.x0 = PAD + 8; this.w = W - PAD * 2 - 16 - 78; this.n = 0; }
  on(r) { if (r.y + r.h > this.top && r.y < this.bottom) this.win.rects.push(r); }
  space(h = GAP) { this.y += h; }
  heading(text) { const g = this.g; this.y += 6; g.fillStyle = C.gold; g.font = `bold 34px ${FONT.head}`; g.textAlign = 'left'; g.fillText(text, this.x0, this.y + 20, this.w); g.strokeStyle = C.brass; g.lineWidth = 2; g.beginPath(); g.moveTo(this.x0, this.y + 44); g.lineTo(this.x0 + this.w, this.y + 44); g.stroke(); this.y += 56; }
  text(text, { size = 30, color = C.ink, align = 'left' } = {}) { const g = this.g; g.fillStyle = color; g.font = `${size}px ${FONT.body}`; g.textAlign = align; g.fillText(String(text), align === 'center' ? this.x0 + this.w / 2 : this.x0, this.y + size * 0.6, this.w); this.y += size * 1.35; }
  /** One button in a box. */
  button(x, y, w, h, b) {
    const g = this.g, key = b.key || `b${this.n++}:${b.label}`;
    // The same painted control family as the desktop (kit.css): default · primary (gold rim) · selected (teal) · disabled.
    const skin = b.disabled ? 'ui/button-disabled' : b.on ? 'ui/button-on' : b.primary ? 'ui/button-hover' : 'ui/button';
    if (!drawFrame(g, skin, x, y, w, h, 0.3, Math.min(26, h * 0.34))) {
      const col = b.disabled ? ['#3a2a22', '#2a1c16'] : b.on ? [C.tealHi, C.teal] : b.primary ? [C.crimsonHi, C.crimson] : [C.woodHi, C.wood];
      const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, col[0]); gr.addColorStop(1, col[1]);
      g.fillStyle = gr; roundRect(g, x, y, w, h, 16); g.fill(); g.strokeStyle = b.on ? C.gold : C.brass; g.lineWidth = b.on ? 4 : 2.5; g.stroke();
    }
    let tx = x + w / 2; let ik = b.icon && (kitHas(b.icon) ? b.icon : iconKey(b.icon)); if (ik && b.label) ik = symKey(ik); // no painted word beside the live label
    if (ik) { const s = Math.min(h - 12, 64); if (b.label) { drawKit(g, ik, x + 8, y + (h - s) / 2, s, s); tx = x + (w + s) / 2 + 4; } else drawKit(g, ik, x + (w - s) / 2, y + (h - s) / 2, s, s); }
    if (b.label) { g.fillStyle = b.disabled ? '#e8dccb' : C.ink; g.font = `bold ${b.size || 30}px ${FONT.head}`; g.textAlign = 'center'; g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowOffsetY = 2; g.fillText(b.label, tx, y + h / 2 + 2, w - (ik ? 76 : 30)); g.shadowColor = 'transparent'; g.shadowOffsetY = 0; }
    if (!b.disabled && (b.run || b.drag || b.hold)) this.on({ x, y, w, h, run: b.run, drag: b.drag, hold: b.hold, key });
  }
  /** A grid of buttons, `cols` per row. */
  buttons(list, { cols = 3, h = 76 } = {}) {
    list = list.filter(Boolean);
    for (let i = 0; i < list.length; i += cols) { const row = list.slice(i, i + cols); cells(cols, this.w, GAP, this.x0).slice(0, row.length).forEach(([x, w], j) => this.button(x, this.y, w, h, row[j])); this.y += h + GAP; }
  }
  /** Picture tiles (creatures, items, scenes): image, label, optional sub line; `drag` makes a tile pullable. */
  tiles(list, { cols = 4, label = true } = {}) {
    const g = this.g, cs = cells(cols, this.w, GAP, this.x0), s = cs[0][1], h = s + (label ? 62 : 0);
    list.forEach((t, i) => {
      const [x] = cs[i % cols], y = this.y + Math.floor(i / cols) * (h + GAP), key = t.key || `t${i}:${t.label}`;
      // Tiles: a parchment field in a wooden frame (selected: the teal button face), like the desktop gallery.
      if (!drawFrame(g, t.on ? 'ui/button-on' : 'ui/input', x, y, s, h, 0.3, 24)) { g.fillStyle = t.on ? C.teal : 'rgba(20,10,6,0.55)'; roundRect(g, x, y, s, h, 16); g.fill(); g.strokeStyle = t.on ? C.gold : C.brass; g.lineWidth = t.on ? 4 : 2; g.stroke(); }
      const im = t.kit && kitHas(t.kit) ? null : t.image ? this.win.ui.image(t.image) : null;
      if (t.kit && kitHas(t.kit)) drawKit(g, label && t.label ? symKey(t.kit) : t.kit, x + 8, y + 8, s - 16, s - 16);
      else if (im) { const k = Math.min((s - 16) / im.width, (s - 16) / im.height); g.drawImage(im, x + (s - im.width * k) / 2, y + 8 + (s - 16 - im.height * k) / 2, im.width * k, im.height * k); }
      else { g.fillStyle = C.dim; g.font = `bold 60px ${FONT.head}`; g.textAlign = 'center'; g.fillText((t.label || '?')[0], x + s / 2, y + s / 2); }
      if (t.badge != null) { g.fillStyle = C.crimson; g.beginPath(); g.arc(x + s - 22, y + 22, 20, 0, 7); g.fill(); g.fillStyle = C.ink; g.font = `bold 24px ${FONT.head}`; g.textAlign = 'center'; g.fillText(String(t.badge), x + s - 22, y + 24); }
      if (label) { g.fillStyle = t.on ? C.ink : '#3d1d10'; g.font = `bold 24px ${FONT.head}`; g.textAlign = 'center'; g.fillText(t.label || '', x + s / 2, y + s + 14, s - 40); 
        if (t.sub) { g.fillStyle = t.on ? C.dim : '#6b4a2a'; g.font = `22px ${FONT.body}`; g.fillText(t.sub, x + s / 2, y + s + 42, s - 10); } }
      if (t.run || t.drag) this.on({ x, y, w: s, h, run: t.run, drag: t.drag, key });
    });
    this.y += Math.ceil(list.length / cols) * (h + GAP);
  }
  /** A line of text with buttons on the right. */
  row({ icon = null, text, sub = '', buttons = [], color = C.ink, h = 84, run = null, hold = null, key = null, bw = 150 }) {
    const g = this.g, right = this.x0 + this.w, bx = right - buttons.length * (bw + GAP) + GAP;
    if (!drawFrame(g, 'ui/ribbon', this.x0, this.y, this.w, h, 0.3, Math.min(30, h * 0.36))) { g.fillStyle = 'rgba(20,10,6,0.45)'; roundRect(g, this.x0, this.y, this.w, h, 14); g.fill(); }
    // The row itself can be pressed (run) or long-pressed (hold); its buttons sit on top and win.
    if (run || hold) this.on({ x: this.x0, y: this.y, w: this.w, h, run, hold, key: key || `row${this.n++}:${text}` });
    let tx = this.x0 + 30; const ik = icon && symKey(kitHas(icon) ? icon : iconKey(icon));
    if (ik) { drawKit(g, ik, this.x0 + 22, this.y + 12, h - 24, h - 24); tx += h - 18; }
    // Text sits inside the plank's rims: two lines on tall rows, one line (label · value) on short ones.
    const room = bx - tx - 10; g.textAlign = 'left'; g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowOffsetY = 2;
    if (sub && h >= 84) {
      g.fillStyle = color; g.font = `bold 28px ${FONT.head}`; g.fillText(String(text), tx, this.y + h * 0.4, room);
      g.fillStyle = C.dim; g.font = `22px ${FONT.body}`; g.fillText(String(sub), tx, this.y + h * 0.68, room);
    } else {
      g.fillStyle = color; g.font = `bold 28px ${FONT.head}`; const t = String(text), tw = Math.min(room, g.measureText(t).width);
      g.fillText(t, tx, this.y + h / 2 + 1, room);
      if (sub && tw + 30 < room) { g.fillStyle = C.gold; g.font = `bold 28px ${FONT.body}`; g.fillText(String(sub), tx + tw + 18, this.y + h / 2 + 1, room - tw - 18); }
    }
    g.shadowColor = 'transparent'; g.shadowOffsetY = 0;
    buttons.forEach((b, i) => this.button(bx + i * (bw + GAP), this.y + 8, bw, h - 16, { size: 26, ...b }));
    this.y += h + GAP;
  }
  /** A filled bar (hit points). */
  bar(frac, color = C.crimsonHi, h = 26) {
    // The painted heart gauge: frame from ui/hp-empty, the fill drawn inside its trough.
    const g = this.g; h = Math.max(h, 48); const f = Math.max(0, Math.min(1, frac));
    const im = kitImage('ui/hp-empty'); // 392 × 176: heart cap 0–150, trough 150–345, end cap 345–392
    if (im) {
      const k = h / im.height, L = 150 * k, R = (im.width - 345) * k, mid = this.w - L - R;
      g.drawImage(im, 150, 0, 195, im.height, this.x0 + L, this.y, mid, h); // the trough, stretched
      g.fillStyle = color; roundRect(g, this.x0 + L - 4, this.y + h * 0.34, Math.max(0, (mid + 4) * f), h * 0.34, h * 0.17); g.fill();
      g.drawImage(im, 0, 0, 150, im.height, this.x0, this.y, L, h); g.drawImage(im, 345, 0, im.width - 345, im.height, this.x0 + L + mid, this.y, R, h);
    } else { g.fillStyle = '#1c0d07'; roundRect(g, this.x0, this.y, this.w, h, h / 2); g.fill(); g.fillStyle = color; roundRect(g, this.x0 + 3, this.y + 3, (this.w - 6) * f, h - 6, (h - 6) / 2); g.fill(); }
    this.y += h + GAP;
  }
}

/**
 * The interface inside the headset (design/completion-plan.md §5). Everything the desktop HUD and DM dock do is
 * available on floating panels opened from a hand menu:
 *   left palm up for half a second (or the left controller's menu button) → a ring of emblems → a panel per emblem.
 * Panels are pressed with a ray (pinch with bare hands, trigger on a controller) or poked with a fingertip, and
 * dragged by their title bar. The DM also grabs life-size creatures with the same ray and pulls new ones out of the
 * gallery onto the floor. Messages, roll prompts and "unleash" prompts appear on a ribbon low in view.
 */
export class VRUI {
  constructor(deps) {
    Object.assign(this, deps); // scene, camera, renderer, rig, dm, sync, audio, tray, rolls, dice, caster, calls, lifeDrag, voice, grab, input, combat, tactics, table
    this.active = false; this.windows = new Map(); this.images = new Map(); this.busy = {}; this.palmT = 0; this.palmLatch = false; this.menuLatch = false;
    this.ptr = new XRPointer({ renderer: this.renderer, rig: this.rig });
    this.input.addPointerSource({ update: () => (this.active ? this.ptr.controllerHands() : []) });
    this.sel = { gallery: 'templates', pc: null, target: null, kbd: null, count: 1, tokens: false };
    this.poke = {}; this.dragWin = {}; this.pull = {}; this.life = {}; this.rayPress = {}; this.toolDrag = {}; this.owner = {}; this.t = 0;
    this.wrist = false; this.wristAway = 0; this.backLatch = {};
    this.tool = { mode: null, shape: 'sphere', size: 15, last: null }; // VR table tools: 'ruler' | 'place'
    this.lab = new GestureLab(this);
    // Touch-limiting: the drawn index finger stops at a panel's glass instead of passing through it.
    if (this.input) this.input.jointClamp = (side, j) => (this.active ? this.clampToPanels(j) : j);
    this.toasts = []; this.buildRibbon();
    const dirty = () => { for (const w of this.windows.values()) w.dirty = true; };
    this.dm.on(dirty); onKitLoad(dirty); fontsReady().then(dirty);
    this.sync.requests?.onChange(dirty);
    const prev = this.tray.onResult;
    this.tray.onResult = (card) => { prev?.(card); if (this.active && card?.roll) this.toast(`${card.label || card.roll.label || 'Roll'}: ${card.roll.total}`); dirty(); };
    this.seat = null;
  }

  setSeat(L) { this.seat = L; }
  /** Called when the headset session starts or ends. */
  setActive(on) { this.active = !!on; if (!on) { this.voice?.pushToTalk(false); for (const w of this.windows.values()) w.show(false); this.ribbon.visible = false; this.lifeDrag?.cancelGhost(); this.wrist = false; } else this.toast('Look at your left palm to open the menu.'); }
  /** True while a hand is using a panel, holding or dragging something (battle gestures wait). */
  handBusy(side) { return !!this.busy[side] || BLOCKS_GESTURES.has(this.owner[side]); }
  /** The stable pointing ray of a hand (the Quest's own hand ray when there is one), for aiming strikes. */
  aimRay(side) { const p = this.ptr.pointers.find((x) => x.kind === 'hand' && x.hand === side); return p ? { origin: p.origin.clone(), dir: p.dir.clone() } : null; }

  /** A cached image for a URL (AI Forge pictures); null until loaded. */
  image(url) {
    if (this.images.has(url)) return this.images.get(url);
    this.images.set(url, null); const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => { this.images.set(url, im); for (const w of this.windows.values()) w.dirty = true; }; im.src = url;
    return null;
  }

  // ---------- ribbon: toasts and standing prompts, low in view ----------
  buildRibbon() {
    this.ribCanvas = document.createElement('canvas'); this.ribCanvas.width = 1024; this.ribCanvas.height = 160;
    this.ribTex = new THREE.CanvasTexture(this.ribCanvas); this.ribTex.colorSpace = THREE.SRGBColorSpace;
    this.ribbon = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.0875), new THREE.MeshBasicMaterial({ map: this.ribTex, transparent: true, fog: false, toneMapped: false, depthTest: false }));
    this.ribbon.renderOrder = 40; this.ribbon.visible = false; this.scene.add(this.ribbon); this.ribSig = '';
  }
  /** Shows a message on the ribbon for a few seconds (also used for request results and warnings). */
  toast(text, kind = 'join') { if (!text) return; this.toasts.push({ text: String(text), kind, until: performance.now() + 4200 }); if (this.toasts.length > 3) this.toasts.shift(); }
  /** What must stay on the ribbon: a roll the DM asked for, or a strike waiting for the gesture. */
  standing() {
    const s = this.caster?.armedStrike?.();
    if (s) { const toks = this.dm.state.tokens || []; return { text: `Unleash it at ${s.targets.map((t) => toks.find((x) => x.id === t.id)?.name || '?').join(', ')}! Make your hand sign.`, kind: 'strike' }; }
    const c = this.calls?.myCalls?.()[0];
    if (c) return { text: `The DM asks for ${c.label}: throw your dice (${c.expr}).`, kind: 'call' };
    return null;
  }
  drawRibbon(head, fwd, dt) {
    const now = performance.now(); this.toasts = this.toasts.filter((t) => t.until > now);
    const m = this.toasts[this.toasts.length - 1] || this.standing();
    this.ribbon.visible = !!m; if (!m) return;
    const target = head.clone().addScaledVector(fwd, 0.72).add(new THREE.Vector3(0, -0.3, 0));
    this.ribbon.position.lerp(target, this.ribbon.userData.init ? 1 - Math.exp(-dt * 6) : 1); this.ribbon.userData.init = true; this.ribbon.lookAt(head);
    const sig = `${m.kind}|${m.text}`; if (sig === this.ribSig) return; this.ribSig = sig;
    const g = this.ribCanvas.getContext('2d'); g.clearRect(0, 0, 1024, 160);
    if (!drawFrame(g, 'ui/ribbon', 0, 0, 1024, 160, 0.4, 70)) { g.fillStyle = C.wood; roundRect(g, 4, 4, 1016, 152, 30); g.fill(); }
    g.fillStyle = m.kind === 'warn' || m.kind === 'leave' ? '#ffd0c0' : m.kind === 'strike' ? '#ffe08a' : C.ink; g.font = `bold 38px ${FONT.head}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(m.text, 512, 82, 880); this.ribTex.needsUpdate = true;
  }

  // ---------- windows ----------
  head() { const cam = this.renderer.xr.getCamera(), p = new THREE.Vector3(), f = new THREE.Vector3(); cam.getWorldPosition(p); cam.getWorldDirection(f); return { p, f }; }
  win(id) {
    if (this.windows.has(id)) return this.windows.get(id);
    const defs = {
      menu: { title: 'Hearthstone Table', w: 0.46, h: 0.46, paint: (p) => this.paintMenu(p), icon: 'nav/hearthstone-table' },
      dice: { title: 'Dice', paint: (p) => this.paintDice(p), icon: 'nav/dice' },
      sheet: { title: 'Character', h: 0.5, paint: (p) => this.paintSheet(p), icon: 'session/my-sheet' },
      bag: { title: 'Bag', paint: (p) => this.paintBag(p), icon: 'sheet/inventory' },
      spells: { title: 'Spells', paint: (p) => this.paintSpells(p), icon: 'sheet/spells' },
      voice: { title: 'Voice', paint: (p) => this.paintVoice(p), icon: 'voice/mic-on' },
      creatures: { title: 'Creatures', w: 0.6, h: 0.5, paint: (p) => this.paintCreatures(p), icon: 'nav/creatures' },
      combat: { title: 'Combat', w: 0.6, h: 0.5, paint: (p) => this.paintCombat(p), icon: 'combat/attack' },
      requests: { title: 'Requests', paint: (p) => this.paintRequests(p), icon: 'filter/requests' },
      world: { title: 'World', w: 0.6, h: 0.5, paint: (p) => this.paintWorld(p), icon: 'nav/world' },
      table: { title: 'Table', paint: (p) => this.paintTable(p), icon: 'nav/table' },
      forge: { title: 'Forge', paint: (p) => this.paintForge(p), icon: 'nav/forge' },
      kbd: { title: 'Type', w: 0.62, h: 0.4, paint: (p) => this.paintKeyboard(p), icon: 'voice/text-entry' },
      edit: { title: 'Edit creature', w: 0.56, h: 0.5, paint: (p) => this.paintEdit(p), icon: 'nav/creatures' },
      tools: { title: 'Table tools', paint: (p) => this.paintTools(p), icon: 'nav/tools' },
      handouts: { title: 'Handouts', paint: (p) => this.paintHandouts(p), icon: 'voice/handout' },
      lab: { title: 'Gesture practice', w: 0.6, h: 0.5, paint: (p) => this.lab.paint(p), icon: 'voice/gesture-practice' },
    };
    const w = new VRWindow(this, { id, ...defs[id] }); this.windows.set(id, w); return w;
  }
  /** Opens (or brings back) a panel in front of the wearer; panels fan out so they do not stack. */
  open(id) {
    const w = this.win(id), { p, f } = this.head(); f.y = 0; f.normalize();
    const n = [...this.windows.values()].filter((x) => x.visible && x.id !== id && x.id !== 'menu').length, side = id === 'kbd' ? 0 : ((n % 3) - 1) * 0.5;
    const right = new THREE.Vector3(-f.z, 0, f.x);
    w.mesh.position.copy(p).addScaledVector(f, VR.panelDistance + (id === 'menu' ? -0.1 : 0.05)).addScaledVector(right, side).add(new THREE.Vector3(0, id === 'kbd' ? -0.32 : -0.1, 0));
    w.mesh.lookAt(p.x, w.mesh.position.y + 0.06, p.z); w.scroll = 0; w.show(true); this.audio?.chime?.();
    return w;
  }
  close(id) { const w = this.windows.get(id); if (!w?.visible) return; w.show(false); if (id === 'menu') { this.wrist = false; w.mesh.scale.setScalar(1); } if (id === 'lab') this.lab.stop(); this.audio?.click?.(); }
  toggle(id) { const w = this.windows.get(id); if (w?.visible) this.close(id); else this.open(id); }
  /** Asks for a line of text on the VR keyboard. */
  askText(title, initial, done) { this.sel.kbd = { title, text: initial || '', done, shift: false }; this.win('kbd').title = title; this.open('kbd'); }

  // ---------- per frame ----------
  /** Before the simulation tick (controllers must exist as hands before grabbing runs). */
  preUpdate() { /* controllerHands() is read by InputManager through the pointer source */ }

  update(hands, dt) {
    if (!this.active) return;
    this.t += dt;
    const { p: head, f: fwd } = this.head();
    this.drawRibbon(head, fwd, dt);
    this.updateWristMenu(hands, head, dt);
    const mb = this.ptr.menuButton(); if (mb && !this.menuLatch) { this.wrist = false; this.win('menu').mesh.scale.setScalar(1); this.toggle('menu'); } this.menuLatch = mb;

    this.busy = {}; this.owner = {};
    const wins = [...this.windows.values()].filter((w) => w.visible);
    const pointers = this.ptr.update(hands, dt, { p: head, f: fwd });
    // Tracking loss cancels an outstanding panel press before the hand can reappear.
    for (const id of Object.keys(this.rayPress)) if (!pointers.some(p => p.id === id)) delete this.rayPress[id];
    for (const id of Object.keys(this.poke)) if (!pointers.some(p => p.id === id)) delete this.poke[id];
    let talking = false;
    for (const p of pointers) {
      this.point(p, wins, head, dt);
      const ray = this.rayPress[p.id], touch = this.poke[p.id];
      if (this.windows.get('voice')?.visible && ((p.down && ray?.key === 'talk' && !ray.scrolled) ||
          (touch?.down && touch.rect?.key === 'talk' && !touch.scrolling))) talking = true;
    }
    if (this.voice?.ptt) this.voice.pushToTalk(talking);
    this.lab.update(hands, dt);
    const now = performance.now();
    for (const w of wins) { if (w.flash && now > w.flash.until) { w.flash = null; w.dirty = true; } if (w.dirty) w.redraw(); }
  }

  /**
   * Meta-style hand menu: look at your left palm (palm facing your eyes) for a moment and the menu appears beside the
   * hand, following it; turn the hand away and it goes. Pinching its title bar pulls it off the hand to float.
   */
  palmFacing(joints, head) {
    const n = palmNormal(joints, 'left'), w = joints?.wrist?.p, m = joints?.['middle-finger-phalanx-proximal']?.p;
    if (!n || !w || !m) return null;
    const c = new THREE.Vector3((w[0] + m[0]) / 2, (w[1] + m[1]) / 2, (w[2] + m[2]) / 2), to = head.clone().sub(c).normalize();
    return { c, facing: new THREE.Vector3(...n).dot(to) > VR.palmFacing };
  }
  updateWristMenu(hands, head, dt) {
    const left = hands.find((h) => h.handedness === 'left' && h.joints), pf = left && !this.grab.held?.left ? this.palmFacing(left.joints, head) : null;
    if (pf?.facing) this.palmT += dt; else this.palmT = 0;
    const menu = this.windows.get('menu');
    if (!this.wrist && this.palmT > VR.palmHold && !menu?.visible) { this.wrist = true; this.wristAway = 0; const w = this.open('menu'); w.mesh.scale.setScalar(VR.wristScale); }
    if (!this.wrist) return;
    if (!menu?.visible) { this.wrist = false; return; }
    if (pf?.facing) {
      this.wristAway = 0;
      const right = new THREE.Vector3().subVectors(head, pf.c).cross(new THREE.Vector3(0, 1, 0)).normalize();
      const target = pf.c.clone().add(new THREE.Vector3(0, VR.wristLift, 0)).addScaledVector(right, VR.wristSide);
      menu.mesh.position.lerp(target, 1 - Math.exp(-dt * 18)); menu.mesh.lookAt(head);
    } else if (!Object.values(this.owner).includes('touch')) {
      this.wristAway += dt; if (this.wristAway > VR.wristHide) this.close('menu');
    }
  }

  /** Touch-limiting for the drawn hand: index joints behind a panel's glass are pushed back onto it. */
  clampToPanels(j) {
    const wins = [...this.windows.values()].filter((w) => w.visible); if (!wins.length) return j;
    let out = j;
    for (const name of ['index-finger-tip', 'index-finger-phalanx-distal']) {
      const jt = j[name]; if (!jt) continue;
      for (const w of wins) {
        const c = w.toCanvas(new THREE.Vector3(...jt.p)); if (!c || c.z >= 0 || c.z < -0.05) continue;
        const n = new THREE.Vector3(0, 0, 1).applyQuaternion(w.mesh.getWorldQuaternion(new THREE.Quaternion())), d = -c.z + 0.001;
        if (out === j) out = { ...j };
        out[name] = { ...jt, p: [jt.p[0] + n.x * d, jt.p[1] + n.y * d, jt.p[2] + n.z * d] };
        break;
      }
    }
    return out;
  }

  /** One pointer for one frame. Order (design/vr-hands-plan.md §3): what it is already dragging, then Touch > Grab > Ray. */
  point(p, wins, head, dt) {
    const LD = this.lifeDrag, mark = (o) => { this.owner[p.hand] = o; if (o) this.busy[p.hand] = true; };
    if (this.ongoing(p, head, dt)) return mark('drag');
    // Touch: an index fingertip close in front of a panel owns the hand; its ray hides.
    const touch = p.tip ? this.touchTarget(p.tip, wins) : null;
    if (touch) { mark('touch'); this.ptr.hideRay(p); this.pokeStep(p, touch); return; }
    if (this.poke[p.id]?.down || this.poke[p.id]?.hover) this.pokeStep(p, null);
    if (this.grab.held?.[p.id]) { mark('grab'); this.ptr.hideRay(p); return; }
    // Ray on a panel.
    let best = null;
    for (const w of wins) { const h = w.raycast(p.origin, p.dir); if (h && (!best || h.dist < best.dist)) best = { ...h, win: w }; }
    if (best && best.dist < 3) {
      mark('ui');
      const r = best.win.rectAt(best.x, best.y), hov = r && r.kind !== 'title' ? r : null;
      if ((best.win.hover?.key ?? null) !== (hov?.key ?? null)) { best.win.hover = hov; best.win.dirty = true; if (hov) this.ptr.pulse(p.id, 0.15, 12); }
      this.ptr.show(p, best.point, p.down, new THREE.Vector3(0, 0, 1).applyQuaternion(best.win.mesh.quaternion));
      const sy = this.ptr.stickY(p.hand); if (sy) best.win.scrollBy(sy * dt * PRESS_CFG.stickScroll);
      const back = this.ptr.backButton(p.hand); if (back && !this.backLatch[p.id] && best.win.closable) this.close(best.win.id); this.backLatch[p.id] = back;
      if (p.pressed && r?.kind === 'title') {
        if (best.win.id === 'menu' && this.wrist) { this.wrist = false; best.win.mesh.scale.setScalar(1); best.win.mesh.updateMatrixWorld(); }
        // grab: where on the panel it was taken, so that spot (not the panel's middle) stays under the hand
        this.dragWin[p.id] = { win: best.win, dist: best.dist, vy: 0, lastY: best.win.mesh.position.y, grab: best.win.mesh.worldToLocal(best.point.clone()).multiply(best.win.mesh.scale) };
      }
      else if (p.pressed && r?.drag) this.pull[p.id] = { win: best.win, key: r.key, def: r.drag.def, count: r.drag.count || 1, click: r.run, moved: false };
      else if (p.pressed) this.rayPress[p.id] = { win: best.win, r: r || null, key: r?.key ?? null, y0: best.y, scroll0: best.win.scroll, dir0: p.dir.clone(), t0: this.t, scrolled: false, held: false, last: best };
      return;
    }
    if (!Object.values(this.owner).includes('touch')) for (const w of wins) if (w.hover) { w.hover = null; w.dirty = true; }
    // The room: table tools (ruler, templates) and, for the DM, life-size creatures.
    if (this.isDM && this.tool.mode && this.toolRay(p)) return mark('world');
    if (this.isDM && LD) {
      const ray = new THREE.Raycaster(p.origin, p.dir, 0, 14), hit = ray.intersectObjects(LD.lifeRoots(), true)[0];
      if (hit) {
        mark('world'); this.ptr.show(p, hit.point, p.down);
        if (p.pressed) { const id = LD.idOf(hit.object); if (id && LD.begin(id)) { this.life[p.id] = { id, roll: this.wristRoll(p) }; this.ptr.pulse(p.id, 0.5, 30); } }
        return;
      }
    }
    this.ptr.show(p, null);
  }

  /** Continues whatever this pointer is already dragging. Returns true while it owns the pointer. */
  ongoing(p, head, dt) {
    const LD = this.lifeDrag;
    const dw = this.dragWin[p.id];
    if (dw) {
      const m = dw.win.mesh;
      if (!p.down) { // released with the grabbed spot pulled down past the table edge → closed
        delete this.dragWin[p.id];
        if (dw.win.closable && dw.atY != null && dw.atY < TABLE_TOP - VR.tossBelow) this.close(dw.win.id); // pulled down past the table edge
        return true;
      }
      const at = p.origin.clone().addScaledVector(p.dir, dw.dist);
      dw.atY = at.y;
      m.position.copy(at); m.lookAt(head.x, m.position.y + 0.04, head.z);
      if (dw.grab) m.position.sub(dw.grab.clone().applyQuaternion(m.quaternion)); // the grabbed spot, not the middle, follows the hand
      dw.vy = (m.position.y - dw.lastY) / Math.max(dt, 1e-3); dw.lastY = m.position.y;
      this.ptr.show(p, at, true);
      return true;
    }
    const rp = this.rayPress[p.id];
    if (rp) {
      const hit = rp.win.visible ? rp.win.raycast(p.origin, p.dir) : null; if (hit) rp.last = hit;
      if (hit && !rp.scrolled && Math.abs(hit.y - rp.y0) > PRESS_CFG.scrollPx && rp.win.maxScroll > 0) { rp.scrolled = true; rp.held = true; }
      if (rp.scrolled && hit) { rp.win.scroll = Math.max(0, Math.min(rp.win.maxScroll, rp.scroll0 - (hit.y - rp.y0))); rp.win.dirty = true; }
      if (rp.win.visible && !rp.held && rp.r?.hold && this.t - rp.t0 > PRESS_CFG.holdTime) { rp.held = true; this.press(rp.win, { ...rp.r, run: rp.r.hold }, p); this.ptr.pulse(p.id, 0.6, 40); }
      this.ptr.show(p, (hit || rp.last).point, true);
      if (!p.down) {
        delete this.rayPress[p.id];
        // Click on release, locked to what the pinch started on: same button, or the ray barely slipped.
        if (rp.win.visible && !rp.held && rp.r?.run) {
          const now = hit && rp.win.rectAt(hit.x, hit.y), slip = p.dir.angleTo(rp.dir0) / RAD;
          if ((now && now.key === rp.key) || slip < PRESS_CFG.slipDeg) this.press(rp.win, rp.r, p);
        }
      }
      return true;
    }
    const pull = this.pull[p.id];
    if (pull) {
      const hit = pull.win.raycast(p.origin, p.dir), over = hit && pull.win.rectAt(hit.x, hit.y)?.key === pull.key;
      const pt = LD.pointOnRay(new THREE.Ray(p.origin, p.dir));
      if (!over && pt) { if (!LD.ghost) LD.beginGhost(pull.def, pull.count); LD.moveGhost(pt); this.ptr.show(p, new THREE.Vector3(pt.x, pt.onMap ? TABLE_TOP : 0, pt.z), true); pull.moved = true; }
      else if (over) { LD.cancelGhost(); this.ptr.show(p, hit.point, true); }
      if (!p.down) { delete this.pull[p.id]; if (LD.ghost) { LD.endGhost(); this.audio?.chime?.(); } else if (!pull.moved) pull.click?.(); }
      return true;
    }
    const life = this.life[p.id];
    if (life) {
      const pt = new THREE.Vector3(); if (new THREE.Ray(p.origin, p.dir).intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt)) { LD.moveTo(pt.x, pt.z); this.ptr.show(p, pt, true); }
      const sx = this.ptr.stickX(p.hand); if (sx) LD.turn(sx * dt * 2.5);
      // Bare hands: twist your wrist to turn the creature.
      const roll = this.wristRoll(p); if (roll != null && life.roll != null) { let d = roll - life.roll; d = Math.atan2(Math.sin(d), Math.cos(d)); if (Math.abs(d) > 0.004) LD.turn(-d * VR.twistGain); } life.roll = roll;
      if (!p.down) { delete this.life[p.id]; LD.end(); this.ptr.pulse(p.id, 0.5, 40); }
      return true;
    }
    if (this.toolDrag[p.id]) { this.toolRay(p); return true; }
    return false;
  }

  /** Roll of the hand around its pointing ray (radians), from the knuckle line; null for controllers. */
  wristRoll(p) {
    const a = p.joints?.['index-finger-phalanx-proximal']?.p, b = p.joints?.['pinky-finger-phalanx-proximal']?.p; if (!a || !b) return null;
    const v = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), d = p.dir;
    const rt = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)); if (rt.lengthSq() < 1e-6) return null; rt.normalize();
    const up = new THREE.Vector3().crossVectors(rt, d);
    return Math.atan2(v.dot(up), v.dot(rt));
  }

  /** The panel a fingertip is close in front of: { win, c } (nearest), or null. */
  touchTarget(tip, wins) {
    let best = null;
    for (const w of wins) { const c = w.toCanvas(tip); if (!c || c.z > POKE_CFG.near || c.z < -0.05) continue; if (!best || Math.abs(c.z) < Math.abs(best.c.z)) best = { win: w, c }; }
    return best;
  }

  /** Fingertip on a panel: hover glow, contact flash, drag to scroll, lift to tap (design/vr-hands-plan.md §3). */
  pokeStep(p, touch) {
    const st = (this.poke[p.id] ||= { armed: true });
    if (touch && st.win && st.win !== touch.win) { st.down = false; st.armed = true; }
    if (touch) st.win = touch.win;
    const w = st.win; if (!w) return;
    const ev = stepPoke(st, touch ? touch.c : null);
    if (!touch && w.hover) { w.hover = null; w.dirty = true; }
    if (!ev) return;
    const r = touch ? w.rectAt(touch.c.x, touch.c.y) : null;
    if (ev.type === 'hover' || ev.type === 'contact') { const hov = r && r.kind !== 'title' ? r : null; if ((w.hover?.key ?? null) !== (hov?.key ?? null)) { w.hover = hov; w.dirty = true; } }
    if (ev.type === 'contact') { (this.audio?.tick || this.audio?.click)?.call(this.audio); if (r?.key) { w.flash = { key: r.key, until: performance.now() + 140 }; w.dirty = true; } st.t0 = this.t; st.rect = r; st.held = false; }
    if (ev.type === 'scroll') w.scrollBy(-ev.dy);
    if (ev.type === 'tap' && !st.held) { const t = w.rectAt(ev.x, ev.y); if (t?.run) this.press(w, t, p); }
    // Long touch on something with a hold action.
    if (st.down && !st.held && !st.scrolling && st.rect?.hold && this.t - st.t0 > PRESS_CFG.holdTime) { st.held = true; this.press(w, { ...st.rect, run: st.rect.hold }, p); }
  }

  /** Table tools with the ray: ruler (pinch, drag, release) and placing area templates. Returns true when the ray is on the map. */
  toolRay(p) {
    const tac = this.tactics, pt = new THREE.Vector3();
    if (!tac || !new THREE.Ray(p.origin, p.dir).intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE_TOP), pt)) { delete this.toolDrag[p.id]; return false; }
    const onMap = Math.abs(pt.x) < 0.85 && Math.abs(pt.z) < 0.65;
    if (!onMap && !this.toolDrag[p.id]) return false;
    this.ptr.show(p, pt, p.down, new THREE.Vector3(0, 1, 0));
    const T = this.tool;
    if (T.mode === 'ruler') {
      if (p.pressed) { tac.rulerFrom = [pt.x, pt.z]; this.toolDrag[p.id] = true; }
      if (this.toolDrag[p.id] && tac.rulerFrom) tac.drawRuler(pt.x, pt.z);
      if (!p.down) delete this.toolDrag[p.id];
    } else if (T.mode === 'place' && p.pressed) {
      T.last = tac.placeTemplate(T.shape, T.size, [pt.x, TABLE_TOP, pt.z]); this.audio?.chime?.(); this.ptr.pulse(p.id, 0.5, 30);
    }
    return true;
  }

  press(win, r, p) {
    try { r.run(); } catch (e) { console.warn('[vr] press', e); }
    this.audio?.click?.(); this.ptr.pulse(p.id, 0.4, 25);
    if (r.key) win.flash = { key: r.key, until: performance.now() + 160 };
    for (const w of this.windows.values()) w.dirty = true;
  }
  /** Opens the creature editor on a token. */
  editToken(id) { this.sel.edit = id; this.open('edit'); }

  // ---------- who am I looking at ----------
  get isDM() { return this.dm.isDM; }
  get tokens() { return this.dm.state.tokens || []; }
  get pcs() { return this.tokens.filter((t) => t.kind === 'pc'); }
  /** The character a panel shows: my own; the DM cycles through the party. */
  get pc() {
    const me = this.sync.me?.id;
    const owned = me && this.pcs.find((t) => t.owner === me);
    if (!this.isDM) return owned || null;
    return this.pcs.find((t) => t.id === this.sel.pc) || owned || this.pcs[0] || null;
  }
  cycle(key, list) { if (!list.length) return; const i = list.findIndex((t) => t.id === this.sel[key]); this.sel[key] = list[(i + 1) % list.length].id; }
  do(type, payload) { return act(this.dm, type, payload); }

  // ---------- panels ----------
  paintMenu(p) {
    const list = VR_MENU.filter((m) => !m[3] || this.isDM), q = this.sync.requests?.queue.length || 0;
    p.tiles(list.map(([id, label, kit]) => ({ key: `m:${id}`, kit, label, on: this.windows.get(id)?.visible, badge: id === 'requests' && q ? q : id === 'combat' && (this.dm.state.calls || []).some((c) => c.status === 'rolled') ? '!' : null, run: () => this.toggle(id) })), { cols: 5 });
    const code = this.sync.code && this.sync.code !== 'TABLE' ? `Table ${this.sync.code}` : 'Test table';
    p.text(`${code} · ${(this.sync.players || []).length} at the table`, { size: 26, color: C.dim, align: 'center' });
  }

  paintDice(p) {
    const T = this.tray, counts = {}; for (const g of T.pool.groups) counts[g.sides] = (counts[g.sides] || 0) + g.count;
    for (const row of this.calls?.describePlayer?.() || []) p.row({ ...row, color: C.gold });
    p.tiles([4, 6, 8, 10, 12, 20, 100].map((s) => ({ key: `d${s}`, kit: `dice/d${s}`, label: `d${s}`, badge: counts[s] || null, on: !!counts[s], run: () => T.addDie(s) })), { cols: 7, label: false });
    const k = T.pool.groups[0]?.keep;
    p.buttons([
      { label: '−', key: 'mod-', run: () => T.setPool(P.setMod(T.pool, T.pool.mod - 1)) }, { label: `Mod ${fmtMod(T.pool.mod)}`, key: 'mod', disabled: true }, { label: '+', key: 'mod+', run: () => T.setPool(P.setMod(T.pool, T.pool.mod + 1)) },
      { label: 'Clear', icon: 'dice/clear-dice', key: 'clear', run: () => T.setPool({ groups: [], mod: 0 }) },
    ], { cols: 4 });
    const setKeep = (mode) => { if (!T.pool.groups.length) return; T.setPool({ ...T.pool, groups: T.pool.groups.map((g, i) => (i === 0 ? { ...g, count: mode ? Math.max(2, g.count) : g.count, keep: mode ? { mode, n: 1 } : null } : g)) }); };
    p.buttons([{ label: 'Advantage', icon: 'advantage', on: k?.mode === 'h', run: () => setKeep(k?.mode === 'h' ? null : 'h') }, { label: 'Disadvantage', icon: 'disadvantage', on: k?.mode === 'l', run: () => setKeep(k?.mode === 'l' ? null : 'l') },
      { label: T.physical ? 'Real dice' : 'Instant', icon: T.physical ? 'dice/physical-hand' : 'dice/instant-bolt', on: T.physical, run: () => { T.physical = !T.physical; } }], { cols: 3 });
    p.buttons([{ label: T.pool.groups.length ? `Roll ${P.toExpr(T.pool)}` : 'Pick dice, or throw them by hand', icon: 'dice/roll', primary: true, disabled: !T.pool.groups.length, key: 'roll', run: () => T.roll() }], { cols: 1, h: 96 });
    const c = T.card;
    if (c?.roll) { p.heading(`${c.label || c.roll.label || 'Result'}: ${c.roll.total}`); p.text(`${c.roll.dice.map((d) => (d.dropped ? `(${d.value})` : d.value)).join(' + ')}${c.roll.mod ? ` ${fmtMod(c.roll.mod)}` : ''}`, { color: C.dim }); }
    else if (c?.rolling) p.text('The dice are rolling…', { color: C.dim });
    const saved = [...(this.pc?.rolls || []).map((r) => ({ label: r.name, expr: r.expr })), ...(this.pc?.sheet?.weapons || []).filter((w) => w.damage).map((w) => ({ label: `${w.name} dmg`, expr: w.damage }))];
    if (saved.length) { p.heading('Saved rolls'); p.buttons(saved.map((r) => ({ label: `${r.label} ${r.expr}`, size: 24, run: () => { T.loadExpr(r.expr, r.label); if (!T.errMsg) T.roll(); } })), { cols: 2 }); }
  }

  paintSheet(p) {
    const t = this.pc; if (!t) return p.text('No character yet.', { color: C.dim });
    const s = t.sheet || defaultSheet(), T = this.tray, d20 = (label, mod) => { T.loadExpr(`1d20${mod ? (mod > 0 ? '+' : '') + mod : ''}`, `${t.name} · ${label}`); if (!T.errMsg) T.roll(); };
    if (this.isDM && this.pcs.length > 1) p.buttons([{ label: `${t.name} ▸ next character`, run: () => this.cycle('pc', this.pcs) }], { cols: 1, h: 64 });
    p.text(`${t.name} · level ${s.level} ${s.species} ${s.cls}`.replace(/\s+/g, ' '), { size: 32, color: C.gold });
    if (t.hp != null) { p.text(`Hit points ${t.hp} / ${t.maxHp}${t.tempHp ? ` (+${t.tempHp} temp)` : ''}   ·   AC ${t.ac}   ·   Speed ${s.speed}`, { size: 28 }); p.bar(t.maxHp ? t.hp / t.maxHp : 0); }
    if (this.isDM) p.buttons([[-5, '−5'], [-1, '−1'], [1, '+1'], [5, '+5']].map(([n, l]) => ({ label: l, key: `hp${n}`, run: () => this.do('hp', { id: t.id, expr: n < 0 ? `${n}` : `+${n}` }) })), { cols: 4, h: 64 });
    p.heading('Abilities · press to roll');
    p.buttons(ABILITIES.map((a) => ({ icon: a, label: `${a.toUpperCase()} ${fmtMod(abilityMod(s.abilities[a]))}`, key: `ab${a}`, run: () => d20(`${ABILITY_NAMES[a]} check`, abilityMod(s.abilities[a])) })), { cols: 3 });
    p.heading('Saving throws');
    p.buttons(ABILITIES.map((a) => ({ label: `${a.toUpperCase()} ${fmtMod(saveBonus(s, a))}`, on: !!s.saves[a], key: `sv${a}`, run: () => d20(`${ABILITY_NAMES[a]} save`, saveBonus(s, a)) })), { cols: 6, h: 64 });
    p.buttons([{ label: `Initiative ${fmtMod(Number(t.initBonus) || 0)}`, icon: 'initiative', run: () => d20('Initiative', Number(t.initBonus) || 0) }, { label: 'Death save', icon: 'death-save', run: () => d20('Death save', 0) }], { cols: 2 });
    if (s.weapons.length) { p.heading('Weapons'); for (const [i, w] of s.weapons.entries()) { const m = String(w.bonus).match(/^[+-]?\d+$/); p.row({ icon: w.type || 'attack', text: w.name, sub: `${w.bonus} · ${w.damage} ${w.type}`, key: `w${i}`,
      buttons: [{ label: 'Attack', key: `wa${i}`, run: () => d20(`${w.name} attack`, m ? Number(w.bonus) : 0) }, { label: 'Damage', key: `wd${i}`, run: () => { T.loadExpr(w.damage, `${t.name} · ${w.name} damage`); if (!T.errMsg) T.roll(); } }] }); } }
    const slots = Object.entries(s.slots);
    if (slots.length) { p.heading('Spell slots'); for (const [l, x] of slots) p.row({ text: `Level ${l}`, sub: `${x.max - x.used} of ${x.max} left`, h: 70,
      buttons: [{ label: 'Use', key: `su${l}`, disabled: x.used >= x.max, run: () => this.do('sheet', { id: t.id, patch: { slots: { ...s.slots, [l]: { ...x, used: x.used + 1 } } } }) }, { label: 'Back', key: `sb${l}`, disabled: x.used <= 0, run: () => this.do('sheet', { id: t.id, patch: { slots: { ...s.slots, [l]: { ...x, used: x.used - 1 } } } }) }] }); }
    if (s.resources.length) { p.heading('Resources'); s.resources.forEach((r, i) => p.row({ text: r.name, sub: `${r.max - r.used} of ${r.max} left`, h: 70,
      buttons: [{ label: 'Use', key: `ru${i}`, disabled: r.used >= r.max, run: () => this.do('sheet', { id: t.id, patch: { resources: s.resources.map((x, j) => (j === i ? { ...x, used: x.used + 1 } : x)) } }) }, { label: 'Back', key: `rb${i}`, disabled: r.used <= 0, run: () => this.do('sheet', { id: t.id, patch: { resources: s.resources.map((x, j) => (j === i ? { ...x, used: x.used - 1 } : x)) } }) }] })); }
    p.heading('Skills');
    p.buttons(Object.keys(SKILLS).map((k) => ({ label: `${cap(k)} ${fmtMod(skillBonus(s, k))}`, size: 24, on: !!s.skills[k], key: `sk${k}`, run: () => d20(cap(k), skillBonus(s, k)) })), { cols: 3, h: 62 });
    p.heading(`Rest · hit dice ${hitDiceLeft(s)} of ${s.level}`);
    if (s.level < 20 && this.isDM) p.buttons([{ label: `Level up to ${s.level + 1}`, icon: 'level', run: () => this.do('levelup', { id: t.id }) }], { cols: 1, h: 64 });
    const ho = this.handouts?.latest?.(); if (ho && !this.isDM) { p.heading(ho.title); p.text(ho.text.slice(0, 160), { size: 26, color: C.dim }); }
    p.buttons([{ label: 'Short rest', icon: 'sheet/rest', run: () => this.do('rest', { id: t.id, kind: 'short', heal: Math.max(1, 1 + Math.floor(Math.random() * s.hitDice.die) + abilityMod(s.abilities.con)) }) }, { label: 'Long rest', icon: 'sheet/rest', run: () => this.do('rest', { id: t.id, kind: 'long' }) }], { cols: 2 });
    if (s.features.length) { p.heading('Features'); for (const f of [...s.features, ...s.speciesTraits, ...s.feats]) p.text(`• ${f.name}`, { size: 26 }); }
  }

  paintBag(p) {
    const t = this.pc; if (!t) return p.text('No character yet.', { color: C.dim });
    const c = t.coins || {}, inv = t.inventory || [];
    p.text(['pp', 'gp', 'ep', 'sp', 'cp'].filter((k) => c[k]).map((k) => `${c[k]} ${k}`).join('   ') || 'No coins', { size: 30, color: C.gold });
    if (!inv.length) return p.text('Your bag is empty.', { color: C.dim });
    p.tiles(inv.map((it) => ({ key: `i${it.id}`, kit: itemKitKey(it), label: it.name, badge: it.qty > 1 ? it.qty : null, on: it.equipped, sub: it.equipped ? 'equipped' : '', run: () => { this.sel.item = this.sel.item === it.id ? null : it.id; } })), { cols: 5 });
    const it = inv.find((x) => x.id === this.sel.item);
    if (it) {
      p.heading(it.name); if (it.notes) p.text(it.notes, { size: 26, color: C.dim });
      p.buttons([{ label: it.equipped ? 'Unequip' : 'Equip', icon: it.equipped ? 'sheet/unequip' : 'sheet/equip', run: () => this.do('inv', { id: t.id, op: 'equip', itemId: it.id }) }, { label: 'Use one', icon: 'sheet/use', run: () => this.do('inv', { id: t.id, op: 'qty', itemId: it.id, qty: -1 }) }], { cols: 2 });
      const others = this.pcs.filter((x) => x.id !== t.id);
      if (others.length) p.buttons(others.map((o) => ({ label: `Give to ${o.name}`, icon: 'sheet/give', size: 24, run: () => this.do('give', { id: t.id, to: o.id, itemId: it.id, qty: 1 }) })), { cols: 2 });
    }
  }

  paintSpells(p) {
    const C2 = this.caster, list = C2?.bindings || [], strike = C2?.armedStrike?.();
    if (strike) p.buttons([{ label: 'Unleash it now', icon: 'combat/attack', primary: true, run: () => C2.unleash() }], { cols: 1, h: 96 });
    if (!list.length) p.text('No gesture spells yet: set them on your character sheet.', { color: C.dim });
    for (const g of GESTURES) { const b = list.find((x) => x.gesture === g); if (!b) continue; const e = SPELL_EFFECTS[b.effectId];
      p.row({ icon: `gesture/${g}`, text: b.label || e?.name || b.effectId, sub: `${GESTURE_LABELS[g]}${b.roll ? ` · ${b.roll}` : ''}`, h: 96,
        buttons: [{ label: strike ? 'Unleash' : 'Show', key: `sp${g}`, run: () => (strike ? C2.releaseStrike(strike, b.effectId) : C2.preview(b.effectId)) }] }); }
    p.buttons([{ label: C2?.castMode ? 'Gesture casting: on' : 'Gesture casting: off', on: !!C2?.castMode, run: () => C2.setCastMode(!C2.castMode) }], { cols: 1 });
    p.text('Point at the glowing target, hold the sign for a moment, then do its move. Point: flick. Finger gun: drop your thumb. Palm: push. Slash: flat hand, swipe across. Try them in Practice.', { size: 26, color: C.dim });
  }

  paintVoice(p) {
    const V = this.voice; if (!V) return;
    p.buttons([{ label: !V.enabled ? 'Turn microphone on' : V.muted ? 'Unmute' : 'Mute', icon: !V.enabled ? 'voice/mic-off' : V.muted ? 'voice/mic-muted' : 'voice/mic-on', on: V.enabled && !V.muted, primary: !V.enabled, run: () => V.toggle() },
      { label: V.ptt ? 'Push to talk: on' : 'Push to talk: off', icon: 'voice/push-to-talk', on: V.ptt, run: () => V.setPushToTalk(!V.ptt) }], { cols: 2 });
    if (V.ptt && V.enabled) p.buttons([{ key: 'talk', label: 'Hold to talk', icon: 'voice/push-to-talk', disabled: V.muted || V.forcedMute, run: () => {} }], { cols: 1 });
    if (this.isDM) p.buttons([{ label: V.narrator ? 'Narrator voice: on' : 'Narrator voice: off', on: V.narrator, run: () => V.setNarrator(!V.narrator) }], { cols: 1 });
    p.heading('At the table');
    for (const r of V.roster()) p.row({ text: `${r.name}${r.role === 'dm' ? ' (DM)' : ''}`, sub: r.connected ? `volume ${Math.round(r.volume * 100)}%` : 'connecting…', h: 76,
      buttons: [{ label: '−', key: `v-${r.id}`, run: () => V.setVolume(r.id, r.volume - 0.25) }, { label: '+', key: `v+${r.id}`, run: () => V.setVolume(r.id, r.volume + 0.25) }, ...(this.isDM && r.role !== 'dm' ? [{ label: 'Mute', key: `vm${r.id}`, run: () => V.muteOther(r.id, true) }] : [])] });
    if (!V.roster().length) p.text('Nobody else is here yet.', { color: C.dim });
  }

  paintCreatures(p) {
    const S = this.sel, tabs = [['templates', 'Templates'], ['models', 'Models'], ['mine', 'Mine'], ['forge', 'Forged'], ['tokens', 'On the table']];
    p.buttons(tabs.map(([k, l]) => ({ label: l, size: 24, on: S.gallery === k, key: `g:${k}`, run: () => { S.gallery = k; } })), { cols: 5, h: 62 });
    if (S.gallery === 'tokens') {
      p.buttons(FORMATIONS.map((f) => ({ label: cap(f), size: 26, run: () => this.lifeDrag.arrange(f) })), { cols: 4, h: 62 });
      for (const t of this.tokens.filter((x) => x.kind !== 'item')) {
        p.row({ icon: kitHas(`creature/${t.statId || t.model}`) ? `creature/${t.statId || t.model}` : 'hp', text: t.name, sub: `${t.hp} / ${t.maxHp} HP · AC ${t.ac}${t.conditions.length ? ' · ' + t.conditions.map((c) => c.name).join(', ') : ''}`, color: t.side === 'enemy' ? '#ffb4a0' : C.ink,
          key: `tr${t.id}`, hold: () => this.editToken(t.id),
          buttons: [{ label: '−5', key: `t5${t.id}`, run: () => this.do('hp', { id: t.id, expr: '-5' }) }, { label: '−1', key: `t1${t.id}`, run: () => this.do('hp', { id: t.id, expr: '-1' }) }, { label: '+1', key: `tp${t.id}`, run: () => this.do('hp', { id: t.id, expr: '+1' }) }, { label: 'Edit', key: `te${t.id}`, run: () => this.editToken(t.id) }] });
      }
      return;
    }
    p.buttons([{ label: '−', key: 'c-', run: () => { S.count = Math.max(1, S.count - 1); } }, { label: `Spawn ${S.count}`, disabled: true, key: 'c' }, { label: '+', key: 'c+', run: () => { S.count = Math.min(8, S.count + 1); } }], { cols: 3, h: 62 });
    p.text('Pinch a creature and pull it out onto the floor (life-size) or onto the map (mini only). On "On the table", pinch and hold a row to edit it.', { size: 24, color: C.dim });
    const list = galleryTiles(this.dm, S.gallery);
    p.tiles(list.map((t, i) => { const id = t.def?.statId || t.def?.model, kit = t.thumb?.startsWith('heroes.') ? `creature/${t.thumb.slice(7)}` : `creature/${id}`;
      return { key: `gt${S.gallery}${i}`, kit: kitHas(kit) ? kit : null, image: t.image || null, label: t.name, sub: t.def?.hp ? `${t.def.hp} HP` : '', drag: { def: { ...t.def, life: true }, count: S.count }, run: () => { this.lifeDrag.beginGhost({ ...t.def, life: true }, S.count); const s = this.lifeDrag.slotFor({ ...t.def }); this.lifeDrag.moveGhost({ x: s[0], z: s[1], onMap: false }); this.lifeDrag.endGhost(); } }; }), { cols: 5 });
    if (!list.length) p.text('Nothing here yet.', { color: C.dim });
  }

  paintCombat(p) {
    const mgr = this.combat, Cb = mgr.combat, S = this.sel, pcs = this.pcs, others = this.tokens.filter((t) => t.kind !== 'item' && t.kind !== 'pc');
    p.buttons(Cb.active ? [{ label: 'Next turn', icon: 'combat/next-turn', primary: true, run: () => this.do('combat', { op: 'next' }) }, { label: 'End combat', icon: 'combat/end-combat', run: () => this.do('combat', { op: 'end' }) }]
      : [{ label: 'Start combat', icon: 'combat/attack', primary: true, run: () => this.do('combat', { op: 'start' }) }], { cols: 2 });
    if (Cb.active) {
      const a = mgr.active(), order = mgr.ordered(); p.text(`Round ${Cb.round}${a ? ` · ${a.name}'s turn` : ''}`, { size: 30, color: C.gold });
      p.heading('Initiative');
      order.forEach((t, i) => p.row({ text: `${t.init ?? '?'}  ${t.name}${a?.id === t.id ? '  ◀' : ''}`, sub: `${t.hp} / ${t.maxHp} HP${t.conditions.length ? ' · ' + t.conditions.map((c) => c.name).join(', ') : ''}`, h: 74, bw: 110,
        color: a?.id === t.id ? C.gold : t.side === 'enemy' ? '#ffb4a0' : C.ink, key: `io${t.id}`, hold: () => this.editToken(t.id),
        buttons: [{ label: '▲', key: `iu${t.id}`, disabled: i === 0, run: () => this.do('reorder', { from: i, to: i - 1 }) }, { label: '▼', key: `id${t.id}`, disabled: i === order.length - 1, run: () => this.do('reorder', { from: i, to: i + 1 }) }, { label: 'Edit', key: `ie${t.id}`, run: () => this.editToken(t.id) }] }));
    }
    const rows = this.calls.describeDM(); if (rows.length) { p.heading('Waiting on you'); for (const r of rows) p.row(r); }
    p.heading('Call for a roll');
    const who = pcs.find((t) => t.id === S.pc) || pcs[0], tgt = others.find((t) => t.id === S.target) || others[0];
    if (!who) return p.text('No player characters yet.', { color: C.dim });
    p.buttons([{ label: `Who: ${who.name} ▸`, key: 'who', run: () => this.cycle('pc', pcs) }, { label: `Target: ${tgt?.name || 'none'} ▸`, key: 'tgt', disabled: !tgt, run: () => this.cycle('target', others) }, { label: 'Everyone: initiative', icon: 'initiative', size: 24, run: () => this.calls.quickCall(pcs.map((t) => t.id), 'init') }], { cols: 3 });
    p.buttons([{ label: 'Attack', icon: 'attack', run: () => this.calls.quickCall(who.id, 'attack', { weapon: who.sheet?.weapons?.length ? 0 : undefined, targetId: tgt?.id }) },
      { label: 'Damage', icon: 'damage', run: () => this.calls.quickCall(who.id, 'damage', { weapon: who.sheet?.weapons?.length ? 0 : undefined, targetId: tgt?.id, damageType: who.sheet?.weapons?.[0]?.type }) },
      { label: 'Death save', icon: 'death-save', run: () => this.calls.quickCall(who.id, 'death') }], { cols: 3 });
    const dc = S.dc ?? 13;
    p.buttons([{ label: '−', key: 'dc-', run: () => { S.dc = Math.max(5, dc - 1); } }, { label: `DC ${dc}`, disabled: true, key: 'dc' }, { label: '+', key: 'dc+', run: () => { S.dc = Math.min(30, dc + 1); } }], { cols: 3, h: 62 });
    p.text('Saving throw', { size: 24, color: C.dim });
    p.buttons(ABILITIES.map((a) => ({ label: a.toUpperCase(), icon: a, key: `cs${a}`, run: () => this.calls.quickCall(who.id, 'save', { ability: a, dc }) })), { cols: 6, h: 70 });
    p.text('Ability check', { size: 24, color: C.dim });
    p.buttons(ABILITIES.map((a) => ({ label: a.toUpperCase(), key: `cc${a}`, run: () => this.calls.quickCall(who.id, 'check', { ability: a, dc }) })), { cols: 6, h: 62 });
    p.buttons(['perception', 'stealth', 'athletics', 'persuasion', 'insight', 'investigation'].map((k) => ({ label: cap(k), size: 24, key: `ck${k}`, run: () => this.calls.quickCall(who.id, 'check', { ability: SKILLS[k], skill: k, dc }) })), { cols: 3, h: 62 });
  }

  paintRequests(p) {
    const R = this.sync.requests, q = R?.queue || [];
    if (!q.length) return p.text('No requests waiting.', { color: C.dim });
    for (const r of q) p.row({ text: `${r.name}: ${r.label}`, sub: r.roll || '', buttons: [{ label: 'Approve', primary: true, key: `ra${r.rid}`, run: () => R.approve(r.rid) }, { label: 'Deny', key: `rd${r.rid}`, run: () => R.deny(r.rid) }] });
  }

  paintWorld(p) {
    const s = this.dm.state, L = s.lighting;
    p.heading('Scene');
    p.tiles(Object.entries(SCENE_LABELS).filter(([k]) => !k.startsWith('ai-')).map(([k, l]) => ({ key: `sc${k}`, kit: sceneKitKey(k), label: l, on: s.scene === k, run: () => this.do('scene', { name: k }) })), { cols: 4 });
    p.heading('Time and mood');
    p.buttons(['day', 'dusk', 'night'].map((t) => ({ label: cap(t), icon: `world/${t}`, on: L.timeOfDay === t, run: () => this.do('lighting', { key: 'timeOfDay', value: t }) })), { cols: 3 });
    p.buttons(['calm', 'tense', 'combat', 'eerie'].map((m) => ({ label: cap(m), icon: `world/${m}`, on: L.mood === m, run: () => this.do('lighting', { key: 'mood', value: m }) })), { cols: 4 });
    p.heading('Weather');
    p.buttons([...['rain', 'snow', 'embers', 'sparkles'].map((w) => ({ label: cap(w), icon: `world/${w}`, on: !!s.weather[w], run: () => this.do('weather', { kind: w }) })), { label: 'Lightning', icon: 'world/lightning', run: () => this.do('weather', { kind: 'lightning' }) }], { cols: 5 });
    p.heading('Music and sounds');
    p.buttons([['none', 'Off', 'world/music-off'], ['tavern', 'Tavern', 'world/tavern'], ['explore', 'Explore', 'world/explore'], ['combat', 'Battle', 'world/battle-music'], ['eerie', 'Eerie', 'world/eerie-music']].map(([k, l, ic]) => ({ label: l, icon: ic, on: s.music === k, run: () => this.do('music', { name: k }) })), { cols: 5 });
    p.buttons([['creak', 'Door'], ['roar', 'Roar'], ['swordClash', 'Swords'], ['cheer', 'Cheer'], ['drone', 'Drone']].map(([k, l]) => ({ label: l, icon: `misc/${k === 'swordClash' ? 'sword-clash' : k}`, run: () => this.do('sfx', { name: k }) })), { cols: 5 });
    p.heading('Fog of war and narration');
    p.buttons([{ label: 'Fog of war', icon: 'world/fog-of-war', on: s.map.fogOfWar, run: () => this.do('map', { op: 'fog' }) }, { label: 'Touch to reveal', icon: 'world/paint-fog', on: s.map.fogPaint, run: () => this.do('map', { op: 'fogPaint' }) },
      { label: 'Narrate…', icon: 'world/narrate', run: () => this.askText('Narration', '', (t) => t && this.do('narrate', { text: t })) }], { cols: 3 });
    p.buttons([{ label: 'Show a handout to everyone…', icon: 'voice/handout', run: () => this.askText('Handout text', '', (t) => t && this.handouts?.send({ title: 'A note', text: t }, 'all')) }], { cols: 1 });
  }

  paintTable(p) {
    const s = this.dm.state, set = s.settings || {}, ses = s.session || { stage: 'play', ready: {} };
    p.text(this.sync.code && this.sync.code !== 'TABLE' ? `Table code: ${this.sync.code}` : 'Test table (no code)', { size: 34, color: C.gold });
    p.heading(ses.stage === 'lobby' ? 'Stage 1: characters' : 'Stage 2: the adventure');
    for (const t of this.pcs) { const c = completeness(t); p.row({ icon: kitHas(`creature/${(t.sheet?.cls || '').toLowerCase()}`) ? `creature/${t.sheet.cls.toLowerCase()}` : 'session/my-sheet', text: t.name, sub: `${t.sheet?.cls || 'building'} · sheet ${c.done}/${c.total}${ses.ready?.[t.id] ? ' · ready' : ''}${t.away ? ' · away' : ''}`, h: 76 }); }
    p.buttons([ses.stage === 'lobby' ? { label: 'Begin the adventure', primary: true, icon: 'action/continue', run: () => this.do('session', { stage: 'play' }) } : { label: 'Back to characters', run: () => this.do('session', { stage: 'lobby' }) }], { cols: 1, h: 90 });
    p.heading('Rules');
    const tog = (k, l) => ({ label: l, size: 24, on: set[k] !== false && !!set[k], key: `set${k}`, run: () => this.do('settings', { patch: { [k]: !set[k] } }) });
    p.buttons([tog('rulesAssist', 'Rules assist'), tog('gestureRelease', 'Damage needs a gesture'), tog('autoReleaseMonsters', 'Monsters strike at once'), tog('linkMiniToBody', 'Minis move bodies'), tog('lockEnemyMinis', 'Only I move enemies'), tog('showDcToPlayers', 'Players see DCs')], { cols: 2, h: 66 });
    p.buttons([{ label: this.tactics?.gridOn ? 'Grid snap: on' : 'Grid snap: off', icon: 'tools/grid-snap', on: !!this.tactics?.gridOn, run: () => this.tactics?.setGrid(!this.tactics.gridOn) }, { label: 'Save table', icon: 'session/save-table', run: () => this.do('session.save') }, { label: 'Load table', icon: 'session/load-table', run: () => this.do('session.load') }], { cols: 3 });
    p.buttons([50, 100, 250].map((n) => ({ label: `Award ${n} XP`, size: 24, run: () => this.do('xp', { amount: n }) })), { cols: 3, h: 62 });
    p.buttons([10, 50, 100].map((n) => ({ label: `Share ${n} gp`, size: 24, run: () => this.do('loot.split', { coins: { gp: n } }) })), { cols: 3, h: 62 });
  }

  paintForge(p) {
    const F = this.dm.forge, lib = (F?.library || []).filter((e) => e.kind === 'creature');
    p.buttons([{ label: this.forgeBusy ? 'Conjuring…' : 'Describe a new creature…', icon: 'forge/generate', primary: true, disabled: !!this.forgeBusy, run: () => this.askText('Describe the creature', '', (t) => this.forgeNew(t)) }], { cols: 1, h: 90 });
    if (this.forgeMsg) p.text(this.forgeMsg, { size: 26, color: C.dim });
    if (!lib.length) return p.text('Nothing forged yet.', { color: C.dim });
    p.text('Pull a forged creature out onto the floor.', { size: 24, color: C.dim });
    p.tiles(lib.map((e) => ({ key: `f${e.id}`, image: e.image, label: e.label, drag: { def: { name: e.label, kind: 'monster', side: 'enemy', forge: e.id, life: true }, count: 1 }, run: () => F.spawn(e) })), { cols: 4 });
  }
  /** Prompt → picture → model → library, without a desktop (the DM approves by pulling it out of the library). */
  async forgeNew(text) {
    const F = this.dm.forge; if (!text || !F) return;
    this.forgeBusy = true; this.forgeMsg = 'Conjuring a picture…';
    try { const d = await F.draft('creature', text); const e = await F.approve(d, (m) => { this.forgeMsg = m; }); this.forgeMsg = `${e.label} is ready.`; }
    catch (e) { this.forgeMsg = `The forge failed: ${e.message}`; }
    this.forgeBusy = false; for (const w of this.windows.values()) w.dirty = true;
  }

  /** Creature editor (the desktop editor's fields): steppers for numbers, the VR keyboard for the name. */
  paintEdit(p) {
    const t = this.tokens.find((x) => x.id === this.sel.edit); if (!t) return p.text('That creature has left the table.', { color: C.dim });
    const up = (patch) => this.do('update', { id: t.id, patch });
    const step = (label, key, val, d, min = 0, max = 999, onSet = (v) => up({ [key]: v })) => p.row({ text: label, sub: String(val), h: 72, bw: 96,
      buttons: [{ label: `−${d}`, key: `${key}-${d}`, run: () => onSet(Math.max(min, val - d)) }, { label: '−1', key: `${key}-1`, run: () => onSet(Math.max(min, val - 1)) },
        { label: '+1', key: `${key}+1`, run: () => onSet(Math.min(max, val + 1)) }, { label: `+${d}`, key: `${key}+${d}`, run: () => onSet(Math.min(max, val + d)) }] });
    p.row({ text: t.name, sub: t.kind === 'pc' ? 'player character' : (t.side || 'creature'), h: 80, buttons: [{ label: 'Rename', key: 'ren', run: () => this.askText('Name', t.name, (v) => v && up({ name: v.slice(0, 40) })) }] });
    p.bar(t.maxHp ? t.hp / t.maxHp : 0);
    step('Hit points', 'hp', t.hp, 5, 0, t.maxHp, (v) => up({ hp: v }));
    step('Max hit points', 'maxHp', t.maxHp, 5, 1, 9999);
    step('Temp hit points', 'tempHp', t.tempHp || 0, 5, 0, 999, (v) => this.do('tempHp', { id: t.id, value: v }));
    step('Armor class', 'ac', t.ac, 2, 0, 40);
    step('Speed (ft)', 'speed', t.speed || 30, 10, 0, 240);
    step('Initiative bonus', 'initBonus', Number(t.initBonus) || 0, 2, -10, 20);
    if (t.kind !== 'pc') p.buttons(['enemy', 'neutral', 'ally'].map((sd) => ({ label: cap(sd), on: (t.side || 'enemy') === sd, key: `side${sd}`, run: () => up({ side: sd }) })), { cols: 3, h: 66 });
    if (t.abilities) { p.heading('Ability scores'); for (const a of ABILITIES) step(`${ABILITY_NAMES[a]} (${fmtMod(abilityMod(t.abilities[a] ?? 10))})`, `ab${a}`, t.abilities[a] ?? 10, 2, 1, 30, (v) => up({ abilities: { ...t.abilities, [a]: v } })); }
    p.heading('Conditions · tap to toggle');
    p.buttons(Object.keys(CONDITIONS).map((c) => ({ label: cap(c), icon: c, size: 22, on: t.conditions.some((k) => k.name === c), key: `cn${c}`, run: () => this.do('condition', { id: t.id, name: c }) })), { cols: 4, h: 62 });
    p.heading('More');
    p.buttons([{ label: t.life ? 'Make it a mini' : 'Make it life-size', key: 'life', run: () => up({ life: !t.life }) }, { label: 'Duplicate', icon: 'action/add', run: () => this.do('duplicate', { id: t.id }) },
      { label: 'Remove', icon: 'action/remove', primary: true, run: () => { this.do('remove', { id: t.id }); this.close('edit'); } }], { cols: 3 });
  }

  /** DM table tools: grid snap, ruler and area templates, worked with the ray on the map. */
  paintTools(p) {
    const tac = this.tactics, T = this.tool; if (!tac) return p.text('Table tools are not available.', { color: C.dim });
    p.buttons([{ label: tac.gridOn ? 'Grid snap: on' : 'Grid snap: off', icon: 'tools/grid-snap', on: !!tac.gridOn, run: () => tac.setGrid(!tac.gridOn) },
      { label: T.mode === 'ruler' ? 'Ruler: on' : 'Ruler', icon: 'tools/ruler', on: T.mode === 'ruler', run: () => { T.mode = T.mode === 'ruler' ? null : 'ruler'; if (!T.mode) tac.clearRuler(); } }], { cols: 2 });
    if (T.mode === 'ruler') p.text('Point at the map, pinch and drag to measure.', { size: 24, color: C.dim });
    p.heading('Area of effect');
    p.tiles(['sphere', 'cone', 'line', 'cube'].map((sh) => ({ key: `sh${sh}`, kit: `tools/${sh}`, label: cap(sh), on: T.shape === sh, run: () => { T.shape = sh; } })), { cols: 4 });
    p.buttons([{ label: '−', key: 'sz-', run: () => { T.size = Math.max(5, T.size - 5); } }, { label: `${T.size} ft`, key: 'sz', disabled: true }, { label: '+', key: 'sz+', run: () => { T.size = Math.min(120, T.size + 5); } }], { cols: 3, h: 66 });
    p.buttons([{ label: T.mode === 'place' ? 'Placing: pinch the map' : 'Place on the map', icon: 'tools/place', on: T.mode === 'place', run: () => { T.mode = T.mode === 'place' ? null : 'place'; } },
      { label: 'Rotate last', icon: 'tools/rotate', disabled: !T.last, run: () => T.last && tac.rotate(T.last, Math.PI / 8) }, { label: 'Clear all', icon: 'tools/clear', run: () => { tac.clearTemplates(); T.last = null; } }], { cols: 3 });
  }

  /** Handouts the DM has shown (newest first); the DM can write a new one. */
  paintHandouts(p) {
    const H = this.handouts, list = H?.list || [];
    if (this.isDM) p.buttons([{ label: 'Show a handout to everyone…', icon: 'session/request-change', primary: true, run: () => this.askText('Handout title', '', (title) => title && setTimeout(() => this.askText('Handout text', '', (text) => text && H?.send({ title, text }, 'all')), 0)) }], { cols: 1, h: 80 });
    if (!list.length) return p.text('No handouts yet.', { color: C.dim });
    list.forEach((h, i) => { p.heading(h.title || 'A note'); (String(h.text || '').match(/.{1,60}(\s|$)/g) || []).slice(0, i === 0 ? 14 : 3).forEach((line) => p.text(line.trim(), { size: 26, color: i ? C.dim : C.ink })); });
  }

  paintKeyboard(p) {
    const K = this.sel.kbd; if (!K) return;
    const g = p.g; if (!drawFrame(g, 'ui/input', p.x0, p.y, p.w + 78, 70, 0.3, 22)) { g.fillStyle = '#f1dfb4'; roundRect(g, p.x0, p.y, p.w + 78, 70, 12); g.fill(); } g.fillStyle = '#2a1408'; g.font = `32px ${FONT.body}`; g.textAlign = 'left'; g.fillText(`${K.text}|`, p.x0 + 26, p.y + 37, p.w + 30); p.y += 82;
    const rows = ['1234567890', 'qwertyuiop', 'asdfghjkl\'', 'zxcvbnm,.?'], wAll = p.w + 78;
    for (const row of rows) { cells(row.length, wAll, 8, p.x0).forEach(([x, w], i) => { const ch = K.shift ? row[i].toUpperCase() : row[i]; p.button(x, p.y, w, 66, { label: ch, key: `k${ch}`, run: () => { K.text = (K.text + ch).slice(0, 200); K.shift = false; } }); }); p.y += 74; }
    const cs = cells(5, wAll, 8, p.x0), bs = [{ label: 'Shift', on: K.shift, run: () => { K.shift = !K.shift; } }, { label: 'Space', run: () => { K.text += ' '; } }, { label: 'Delete', run: () => { K.text = K.text.slice(0, -1); } }, { label: 'Cancel', run: () => { this.sel.kbd = null; this.close('kbd'); } }, { label: 'Done', primary: true, run: () => { const t = K.text.trim(); this.sel.kbd = null; this.close('kbd'); K.done?.(t); } }];
    cs.forEach(([x, w], i) => p.button(x, p.y, w, 70, { ...bs[i], key: `kb${i}` })); p.y += 78;
  }

  /** Where the dice tray is, for placing the Dice panel beside it (used by tests). */
  trayAnchor() { return new THREE.Vector3(TRAY.x, TABLE_TOP + 0.3, TRAY.z); }
}
