import * as THREE from 'three';
import { TABLE_TOP } from '../physics/Physics.js';
import { place } from './assets.js';
import { drawFrame, drawKit, kitHas, onKitLoad } from '../ui/kit.js';
import { drawIcon, onIconsReady } from '../ui/icons.js';
import { FONT, fontsReady } from './fonts.js';
import { roundRect } from './util.js';
import { ABILITIES, abilityMod, fmtMod, defaultSheet, classId } from '../party/sheet.js';
import CLASSES from '../data/classes.json';

/** Size of the card on the table (metres) and how close a fingertip must come to open it. */
export const SEAT_PROPS = { cardW: 0.15, cardH: 0.21, tilt: 0.42, touch: 0.035, cooldown: 0.8, bagScale: 0.75 };
const CW = 600, CH = 840;

/** Kit portrait key for a character (class portrait, else the class's hero model). Pure. */
export function portraitKey(token) {
  const id = classId(token?.sheet?.cls);
  if (id && kitHas(`creature/${id}`)) return `creature/${id}`;
  const m = id ? CLASSES[id].model : token?.model;
  return m && kitHas(`creature/${m}`) ? `creature/${m}` : null;
}

/**
 * The player's own things on the table in front of their seat (design/completion-plan.md §5.2):
 *  - a character card: portrait, name, class and level, hit points, AC, speed and the six ability modifiers, always current;
 *  - a satchel: their bag.
 * Touch either with a fingertip (VR / webcam hands) or click it (desktop) to open the full Character or Bag panel.
 * Only a player with a character has them; they sit where seatLayout() puts them.
 */
export class SeatProps {
  /** @param {{ scene: THREE.Scene, dm: object, sync: object, mouse?: object, onOpen: (kind: 'sheet'|'bag') => void }} deps */
  constructor({ scene, dm, sync, mouse = null, onOpen }) {
    Object.assign(this, { dm, sync, onOpen }); this.cool = 0; this.sig = '';
    this.root = new THREE.Group(); this.root.name = 'SeatProps'; this.root.visible = false; scene.add(this.root);
    // Card: a thin slab leaning back toward the player.
    this.canvas = document.createElement('canvas'); this.canvas.width = CW; this.canvas.height = CH;
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    this.card = new THREE.Group();
    const face = new THREE.Mesh(new THREE.PlaneGeometry(SEAT_PROPS.cardW, SEAT_PROPS.cardH), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false }));
    const back = new THREE.Mesh(new THREE.BoxGeometry(SEAT_PROPS.cardW * 0.94, SEAT_PROPS.cardH * 0.94, 0.004), new THREE.MeshStandardMaterial({ color: '#3d1d10', roughness: 0.8 }));
    back.position.z = -0.004; back.castShadow = true; face.position.z = 0.0005;
    const slab = new THREE.Group(); slab.add(face, back); slab.position.y = SEAT_PROPS.cardH / 2 * Math.cos(SEAT_PROPS.tilt) + 0.004; slab.rotation.x = -SEAT_PROPS.tilt;
    this.card.add(slab); this.root.add(this.card);
    // Satchel: the wicker basket stands in for the bag.
    this.bag = new THREE.Group(); this.root.add(this.bag);
    place(this.bag, 'wicker_basket_01', [0, 0, 0], { scale: SEAT_PROPS.bagScale, shadow: 'cast' }).catch((e) => console.warn('[seat props] bag model failed', e.message));
    mouse?.addTool({ enabled: () => this.root.visible, targets: () => [this.card, this.bag],
      onDown: (h) => { let o = h.object; while (o && o !== this.card && o !== this.bag) o = o.parent; if (o) this.onOpen(o === this.card ? 'sheet' : 'bag'); } });
    const redraw = () => { this.sig = ''; this.refresh(); };
    dm.on(() => this.refresh()); onKitLoad(redraw); onIconsReady(redraw); fontsReady().then(redraw);
  }

  /** My character (players only). */
  get token() { const id = this.sync?.me?.id; return id ? (this.dm.state.tokens || []).find((t) => t.kind === 'pc' && t.owner === id) || null : null; }

  /** Puts the card and the satchel in front of a seat (from seatLayout()). */
  setSeat(L) {
    this.card.position.set(L.card.x, TABLE_TOP, L.card.z); this.card.rotation.y = L.card.yaw;
    // The satchel sits on the other side of the tray, toward the player's edge.
    const bx = L.tray.x + L.right[0] * (L.tray.w / 2 + 0.1) - L.fwd[0] * 0.02, bz = L.tray.z + L.right[1] * (L.tray.w / 2 + 0.1) - L.fwd[1] * 0.02;
    this.bag.position.set(Math.max(-0.76, Math.min(0.76, bx)), TABLE_TOP, Math.max(-0.58, Math.min(0.58, bz))); this.bag.rotation.y = L.yaw + 0.4;
    this.refresh();
  }

  /** Redraws the card when the character changed. */
  refresh() {
    const t = this.token; this.root.visible = !!t; if (!t) return;
    const s = t.sheet || defaultSheet();
    const sig = JSON.stringify([t.name, t.hp, t.maxHp, t.tempHp, t.ac, s.cls, s.level, s.species, s.speed, s.abilities, s.heroicInspiration, (t.conditions || []).map((c) => c.name)]);
    if (sig === this.sig) return; this.sig = sig;
    const g = this.canvas.getContext('2d'); g.clearRect(0, 0, CW, CH);
    if (!drawFrame(g, 'ui/card', 0, 0, CW, CH, 0.22, 130)) { g.fillStyle = '#ecd9b0'; roundRect(g, 6, 6, CW - 12, CH - 12, 40); g.fill(); g.strokeStyle = '#8a2a1a'; g.lineWidth = 14; g.stroke(); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const pk = portraitKey(t); if (pk) drawKit(g, pk, 150, 96, 300, 300);
    g.fillStyle = '#7a1c12'; g.font = `900 52px ${FONT.deco}`; g.fillText(t.name, CW / 2, 430, CW - 150);
    g.fillStyle = '#4a3418'; g.font = `italic 30px ${FONT.body}`; g.fillText(`Level ${s.level} ${s.species || ''} ${s.cls || 'Adventurer'}`.replace(/\s+/g, ' '), CW / 2, 478, CW - 150);
    // Hit points bar.
    const bx = 96, bw = CW - 192, by = 512, frac = t.maxHp ? Math.max(0, Math.min(1, t.hp / t.maxHp)) : 0;
    g.fillStyle = '#2a1408'; roundRect(g, bx, by, bw, 44, 22); g.fill();
    g.fillStyle = frac > 0.5 ? '#c8372a' : frac > 0.25 ? '#d98a1e' : '#8a1410'; if (frac > 0) { roundRect(g, bx + 4, by + 4, Math.max(36, (bw - 8) * frac), 36, 18); g.fill(); }
    g.fillStyle = '#fff6e0'; g.font = `bold 30px ${FONT.head}`; g.fillText(t.hp != null ? `${t.hp} / ${t.maxHp}${t.tempHp ? ` +${t.tempHp}` : ''}` : '—', CW / 2, by + 23);
    drawIcon(g, 'hp', bx - 4, by + 22, 62);
    // AC, speed, inspiration.
    g.fillStyle = '#3a2410'; g.font = `bold 34px ${FONT.head}`;
    drawIcon(g, 'ac', 150, 606, 60); g.fillText(`AC ${t.ac}`, 236, 608);
    drawIcon(g, 'speed', 362, 606, 60); g.fillText(`${s.speed} ft`, 452, 608);
    if (s.heroicInspiration) drawIcon(g, 'inspiration', CW - 110, 150, 70);
    // Six ability modifiers.
    const cw = (CW - 150) / 6;
    ABILITIES.forEach((a, i) => { const x = 75 + cw * (i + 0.5);
      g.fillStyle = '#7a6038'; g.font = `bold 22px ${FONT.head}`; g.fillText(a.toUpperCase(), x, 676);
      g.fillStyle = '#7a1c12'; g.font = `900 38px ${FONT.deco}`; g.fillText(fmtMod(abilityMod(s.abilities[a])), x, 716); });
    (t.conditions || []).slice(0, 5).forEach((c, i, arr) => drawIcon(g, c.name, CW / 2 + (i - (arr.length - 1) / 2) * 58, 770, 50));
    this.tex.needsUpdate = true;
  }

  /** Per frame: a fingertip on the card or in the satchel opens its panel. @param {object[]} hands HandState[] */
  update(hands, dt) {
    this.cool -= dt; if (!this.root.visible || this.cool > 0) return;
    const c = new THREE.Vector3(), p = new THREE.Vector3();
    for (const h of hands || []) {
      const tip = h.joints?.['index-finger-tip']?.p; if (!tip || h.grabbing) continue;
      p.set(...tip);
      this.card.getWorldPosition(c); c.y += SEAT_PROPS.cardH * 0.4;
      if (Math.abs(p.x - c.x) < SEAT_PROPS.cardW * 0.6 && Math.abs(p.z - c.z) < 0.07 && Math.abs(p.y - c.y) < SEAT_PROPS.cardH * 0.55) { this.cool = SEAT_PROPS.cooldown; return this.onOpen('sheet'); }
      this.bag.getWorldPosition(c); c.y += 0.07;
      if (p.distanceTo(c) < 0.08 + SEAT_PROPS.touch) { this.cool = SEAT_PROPS.cooldown; return this.onOpen('bag'); }
    }
    return undefined;
  }
}
