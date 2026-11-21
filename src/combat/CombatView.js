import * as THREE from 'three';
import { CONDITIONS } from '../rules/combat.js';
import { TABLE_TOP } from '../physics/Physics.js';
import { fontsReady, FONT, ANISO, strokeText, shield, cross, blades } from '../scene/fonts.js';
import { drawIcon, onIconsReady } from '../ui/icons.js';
import { drawFrame } from '../ui/kit.js';
import { platedTokens, legacyView } from '../tokens/TokenManager.js';

const RING_GOLD = new THREE.Color('#d9a441'), RING_EMBER = new THREE.Color('#ff5a1f');
const SS = 2; // supersample: canvases are 2x their logical layout size

/**
 * Dragonfire HP bar: obsidian trough, dragon-scale fill. Healthy = venom (allies) or ember (foes),
 * bloodied (<=50%) = ember, critical (<=25%) = magma. Colour is backed by a shape cue for
 * colour-blind readability: quarter ticks always, diagonal hatch when bloodied, cross-hatch when critical.
 */
function hpBar(g, x, y, w, h, k, ally) {
  g.fillStyle = '#1c0d07'; g.fillRect(x, y, w, h);
  // Kit palette: green = healthy ally, crimson = foe / bloodied, dark crimson = critical.
  const [a, b] = k <= 0.25 ? ['#c8372a', '#8a1410'] : k <= 0.5 || !ally ? ['#e8663f', '#a8281e'] : ['#6fc46a', '#3f8f45'];
  const fw = w * k;
  if (fw > 0) {
    const fg = g.createLinearGradient(0, y, 0, y + h); fg.addColorStop(0, a); fg.addColorStop(1, b);
    g.save(); g.beginPath(); g.rect(x, y, fw, h); g.clip();
    g.fillStyle = fg; g.fillRect(x, y, fw, h);
    // Overlapping scale arcs.
    const s = h / 2; g.strokeStyle = 'rgba(11,8,7,0.35)'; g.lineWidth = Math.max(1, h / 18);
    for (let row = 0; row < 3; row++) for (let cx = x + (row % 2 ? s / 2 : 0); cx < x + fw + s; cx += s) {
      g.beginPath(); g.arc(cx, y + row * s * 0.6, s / 2, 0, Math.PI); g.stroke();
    }
    // Shape cue: hatch (bloodied) / cross-hatch (critical).
    if (k <= 0.5) {
      g.strokeStyle = 'rgba(11,8,7,0.55)'; g.lineWidth = 3;
      for (let hx = x - h; hx < x + fw + h; hx += 14) {
        g.beginPath(); g.moveTo(hx, y + h); g.lineTo(hx + h, y); g.stroke();
        if (k <= 0.25) { g.beginPath(); g.moveTo(hx, y); g.lineTo(hx + h, y + h); g.stroke(); }
      }
    }
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x, y, fw, h * 0.3);
    g.restore();
  }
  // Quarter ticks on the trough.
  g.strokeStyle = '#c99a3b'; g.lineWidth = 2;
  for (const q of [0.25, 0.5, 0.75]) { g.beginPath(); g.moveTo(x + w * q, y + h - 8); g.lineTo(x + w * q, y + h); g.stroke(); }
  g.strokeRect(x, y, w, h);
}

/** Row of 3 pips; filled = marked. Success pips are circles, fail pips are squares (shape cue). */
function pips(g, x0, y, n, color, square) {
  for (let i = 0; i < 3; i++) {
    const x = x0 + i * 34;
    g.beginPath(); if (square) g.rect(x - 11, y - 11, 22, 22); else g.arc(x, y, 12, 0, Math.PI * 2);
    g.fillStyle = i < n ? color : '#0b0807'; g.fill();
    g.strokeStyle = '#d9a441'; g.lineWidth = 2; g.stroke();
  }
}

/**
 * Draws combat state in the world: name plates and HP bars over minis and life-size creatures,
 * a glowing ring under the active creature, coloured condition rings (Owlbear-style), and
 * physical character cards on the table edge in front of the players.
 */
export class CombatView {
  constructor({ scene, mgr, renderer }) {
    Object.assign(this, { scene, mgr });
    this.aniso = renderer?.capabilities?.getMaxAnisotropy?.() || ANISO;
    this.plates = new Map(); // token id → { mini: Sprite, life: Sprite, key }
    this.activeRing = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.038, 40), new THREE.MeshBasicMaterial({ color: '#d9a441', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    this.activeRing.rotation.x = -Math.PI / 2; this.activeRing.visible = false; scene.add(this.activeRing);
    this.lifeRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.62, 48), this.activeRing.material);
    this.lifeRing.rotation.x = -Math.PI / 2; this.lifeRing.visible = false; scene.add(this.lifeRing);
    this.condRings = new THREE.Group(); scene.add(this.condRings);
    this.cards = new Map(); // char id → { mesh, canvas, key }
    mgr.dm.on(() => this.sync());
    // Baked canvas text: force a full redraw once the Dragonfire faces resolve.
    const redraw = () => {
      for (const p of this.plates.values()) p.key = '';
      for (const c of this.cards.values()) c.key = '';
      this.sync();
    };
    fontsReady().then(redraw);
    onIconsReady(redraw); // game-icons glyphs replace the vector fallbacks once rasterised
  }

  /** Row of condition icons ending at right edge x (centre y). Returns the width used. */
  condIcons(g, conds, x, y, size) {
    const list = (conds || []).slice(0, 5);
    list.forEach((k, i) => drawIcon(g, k.name, x - size / 2 - i * (size + 4), y, size));
    return list.length ? list.length * (size + 4) : 0;
  }

  plateTexture(c) {
    // 1024x256 (2x a 512x128 layout) keeps the sprite's 4:1 aspect and stays crisp in VR.
    const cv = document.createElement('canvas'); cv.width = 512 * SS; cv.height = 128 * SS;
    const g = cv.getContext('2d'), down = c.hp <= 0, k = Math.max(0, Math.min(1, c.hp / c.maxHp)), foe = c.faction === 'enemy';
    g.setTransform(SS, 0, 0, SS, 0, 0); g.textBaseline = 'alphabetic';
    // Kit mahogany frame (nine-sliced); a plain mahogany slab until the art has loaded.
    if (!drawFrame(g, 'ui/panel', 0, 0, 512, 128, 0.3, 26)) {
      const bg = g.createLinearGradient(0, 0, 0, 128); bg.addColorStop(0, 'rgba(61,29,16,0.95)'); bg.addColorStop(1, 'rgba(28,13,7,0.95)');
      g.fillStyle = bg; g.fillRect(0, 0, 512, 128); g.strokeStyle = '#c99a3b'; g.lineWidth = 3; g.strokeRect(4, 4, 504, 120);
    }
    // Name (left), downed cross, AC shield (right).
    let nx = 26;
    if (down) { cross(g, 40, 38, 30); nx = 62; }
    const cw = this.condIcons(g, c.conditions, 428, 38, 28);
    g.fillStyle = down ? '#8a8078' : foe ? '#ffb4a0' : '#f6ead0'; g.font = `bold 40px ${FONT.head}`; g.textAlign = 'left';
    strokeText(g, c.name.slice(0, 16), nx, 54, 420 - nx - cw);
    if (!drawIcon(g, 'ac', 466, 38, 58)) shield(g, 466, 32, 22, '#d9a441', '#211813');
    g.fillStyle = '#efe3c8'; g.font = `bold 28px ${FONT.head}`; g.textAlign = 'center'; strokeText(g, String(c.ac), 466, 50);
    hpBar(g, 22, 70, 468, 38, k, !foe);
    drawIcon(g, down ? 'death-save' : 'hp', 44, 89, 30);
    g.fillStyle = '#efe3c8'; g.font = `bold 28px ${FONT.head}`; g.textAlign = 'center';
    strokeText(g, `${c.hp} / ${c.maxHp}${c.tempHp ? ` +${c.tempHp}` : ''}`, 256, 99);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = this.aniso; return t;
  }

  sprite(tex, scale) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    s.scale.set(scale * 4, scale, 1); s.renderOrder = 9; this.scene.add(s); return s;
  }

  /** Tokens with a plate (every non-item token with a mini or life-size body), as legacy views for drawing. */
  plated() { return platedTokens(this.mgr.tokens.list, this.mgr.refs).map(legacyView); }

  /** Rebuilds plates/cards whose data changed. Cheap: keyed by a short state string. */
  sync() {
    const live = new Set();
    for (const c of this.plated()) {
      const r = this.mgr.refs[c.id];
      live.add(c.id);
      const key = `${c.name}|${c.hp}|${c.maxHp}|${c.tempHp}|${c.ac}|${c.faction}|${!!r.item}|${!!r.life}|${(c.conditions || []).map((k) => k.name).join(',')}`;
      let p = this.plates.get(c.id);
      if (!p) { p = {}; this.plates.set(c.id, p); }
      if (p.key !== key) {
        p.key = key; const tex = this.plateTexture(c);
        for (const [slot, scale] of [['mini', 0.022], ['life', 0.16]]) {
          if (!r[slot === 'mini' ? 'item' : 'life']) { if (p[slot]) { this.dropSprite(p[slot]); p[slot] = null; } continue; }
          if (p[slot]) { p[slot].material.map.dispose(); p[slot].material.map = tex; } else p[slot] = this.sprite(tex, scale);
        }
      }
    }
    for (const [id, p] of this.plates) if (!live.has(id)) { ['mini', 'life'].forEach((k) => p[k] && this.dropSprite(p[k])); this.plates.delete(id); }
    this.syncCards();
  }
  /** Removes a plate sprite and frees its texture and material. */
  dropSprite(sp) { this.scene.remove(sp); sp.material.map?.dispose(); sp.material.dispose(); }

  syncCards() {
    const party = this.mgr.party, live = new Set();
    party.forEach((ch, i) => {
      live.add(ch.id);
      let card = this.cards.get(ch.id);
      if (!card) {
        const cv = document.createElement('canvas'); cv.width = 360 * SS; cv.height = 512 * SS;
        const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = this.aniso;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.105, 0.15), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
        mesh.rotation.x = -Math.PI / 2 + 0.25; mesh.castShadow = true; this.scene.add(mesh);
        card = { mesh, cv, tex, key: '' }; this.cards.set(ch.id, card);
      }
      card.mesh.position.set(-0.62 + i * 0.125, TABLE_TOP + 0.012, 0.5);
      const active = this.mgr.active()?.charId === ch.id;
      const cb = this.mgr.tokens.byChar(ch.id), ds = cb?.deathSaves;
      const key = JSON.stringify([ch.name, ch.hp, ch.maxHp, ch.ac, active, ch.portrait, ds || null, (cb?.conditions || []).map((k) => k.name)]);
      if (card.key !== key) { card.key = key; this.drawCard(card, ch, active); }
    });
    for (const [id, c] of this.cards) if (!live.has(id)) { this.scene.remove(c.mesh); this.cards.delete(id); }
  }

  drawCard(card, ch, active) {
    const g = card.cv.getContext('2d'), W = 360, H = 512, F = FONT.head;
    g.setTransform(SS, 0, 0, SS, 0, 0); g.textBaseline = 'alphabetic';
    g.clearRect(0, 0, W, H);
    // Parchment body, slightly darkened toward the edges.
    const pg = g.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, 320); pg.addColorStop(0, '#efe3c8'); pg.addColorStop(1, '#d9c49a');
    g.fillStyle = pg; g.fillRect(0, 0, W, H);
    // Active turn: thick gold-300 band with a 2 px dark keyline (no blur glow).
    if (active) { g.strokeStyle = '#f3d58a'; g.lineWidth = 14; g.strokeRect(7, 7, W - 14, H - 14); g.strokeStyle = '#0b0807'; g.lineWidth = 2; g.strokeRect(15, 15, W - 30, H - 30); }
    // Gold double frame.
    g.strokeStyle = active ? '#f3d58a' : '#d9a441'; g.lineWidth = 6; g.strokeRect(6, 6, W - 12, H - 12);
    g.strokeStyle = '#8a6420'; g.lineWidth = 2; g.strokeRect(15, 15, W - 30, H - 30);
    // Magma header with a thin class-colour stripe so players still recognise their card.
    const hg = g.createLinearGradient(0, 20, 0, 92); hg.addColorStop(0, '#b3260f'); hg.addColorStop(1, '#5a0f08');
    g.fillStyle = hg; g.fillRect(20, 20, W - 40, 72);
    g.fillStyle = ch.color || '#d9a441'; g.fillRect(20, 88, W - 40, 4);
    g.strokeStyle = '#d9a441'; g.lineWidth = 2; g.strokeRect(20, 20, W - 40, 72);
    g.fillStyle = '#f3d58a'; g.font = `bold 34px ${F}`; g.textAlign = 'center';
    strokeText(g, ch.name.slice(0, 14), W / 2, 66, W - 60);
    g.fillStyle = '#3a2410'; g.font = `italic 26px ${FONT.body}`; g.fillText(`Level ${ch.level} ${ch.cls[0].toUpperCase() + ch.cls.slice(1)}`, W / 2, 124, W - 50);
    const k = Math.max(0, Math.min(1, ch.hp / ch.maxHp));
    const ds = ch.hp <= 0 ? this.mgr.tokens.byChar(ch.id)?.deathSaves : null;
    if (ds) {
      // Death saves replace the HP bar: 3 success (venom circles) + 3 fail (magma squares).
      g.fillStyle = '#0b0807'; g.fillRect(30, 140, W - 60, 54); g.strokeStyle = '#d9a441'; g.lineWidth = 2; g.strokeRect(30, 140, W - 60, 54);
      if (ds.stable || ds.dead) {
        g.fillStyle = ds.dead ? '#c4321a' : '#7fe39f'; g.font = `bold 30px ${F}`; g.textAlign = 'center';
        if (ds.dead) cross(g, 68, 167, 30, '#8a8078');
        strokeText(g, ds.dead ? 'FALLEN' : 'STABLE', W / 2, 178);
      } else {
        pips(g, 62, 167, ds.success || 0, '#4fd17a', false);
        pips(g, W - 130, 167, ds.fail || 0, '#c4321a', true);
        g.fillStyle = '#efe3c8'; g.font = `bold 26px ${F}`; g.textAlign = 'center'; strokeText(g, '0', W / 2, 177);
      }
    } else {
      hpBar(g, 30, 146, W - 60, 42, k, true);
      drawIcon(g, 'hp', 54, 167, 32);
      g.fillStyle = '#efe3c8'; g.font = `bold 26px ${F}`; g.textAlign = 'center'; strokeText(g, `HP ${ch.hp} / ${ch.maxHp}`, W / 2, 177);
    }
    // AC: game-icons shield (vector fallback until loaded) with the number inside.
    const acIcon = drawIcon(g, 'ac', W / 2 + 40, 228, 62);
    if (!acIcon) shield(g, W / 2 + 40, 222, 22, '#8a6420', '#efe3c8');
    g.fillStyle = acIcon ? '#efe3c8' : '#3a2410'; g.font = `bold 30px ${F}`; g.textAlign = 'center';
    if (acIcon) strokeText(g, String(ch.ac), W / 2 + 40, 238); else g.fillText(String(ch.ac), W / 2 + 40, 238);
    g.fillStyle = '#3a2410';
    // Conditions: icon row on the parchment between the abilities and the attacks.
    const cb = this.mgr.tokens.byChar(ch.id);
    if (cb?.conditions?.length) this.condIcons(g, cb.conditions, W - 30, 428, 26);
    g.font = `bold 30px ${F}`; g.textAlign = 'right'; g.fillText('AC', W / 2 + 6, 238); g.textAlign = 'center';
    const ab = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    ab.forEach((a, i) => {
      const x = 60 + (i % 3) * 120, y = 290 + Math.floor(i / 3) * 80, sc = ch.abilities[a], m = Math.floor((sc - 10) / 2);
      g.strokeStyle = '#8a6420'; g.lineWidth = 3; g.strokeRect(x - 48, y - 26, 96, 70);
      g.fillStyle = '#8e1b0e'; g.font = `bold 26px ${F}`; g.fillText(a.toUpperCase(), x, y, 88);
      g.fillStyle = '#3a2410'; g.font = `bold 30px ${F}`; g.fillText(`${m >= 0 ? '+' : ''}${m}`, x, y + 34);
    });
    g.fillStyle = '#3a2410'; g.font = `26px ${FONT.body}`; g.textAlign = 'left';
    ch.attacks.slice(0, 2).forEach((a, i) => { const y = 456 + i * 30; blades(g, 40, y - 9, 18); g.fillText(`${a.name} ${a.dmg}`, 58, y, W - 82); });
    g.textAlign = 'center'; g.setTransform(1, 0, 0, 1, 0, 0);
    card.tex.needsUpdate = true;
  }

  update(t) {
    const plated = platedTokens(this.mgr.tokens.list, this.mgr.refs);
    for (const c of plated) {
      const r = this.mgr.refs[c.id], p = this.plates.get(c.id); if (!r || !p) continue;
      if (p.mini && r.item) { p.mini.position.copy(r.item.mesh.position); p.mini.position.y += 0.085; p.mini.visible = c.hp > 0; }
      if (p.life && r.life) { p.life.position.copy(r.life.position); p.life.position.y += 2.2; p.life.visible = r.life.visible; }
    }
    const a = this.mgr.active(), r = a && this.mgr.refs[a.id], pulse = 0.75 + Math.sin(t * 5) * 0.25;
    this.activeRing.visible = !!r?.item; this.lifeRing.visible = !!(r?.life && r.life.visible);
    if (r?.item) { this.activeRing.position.set(r.item.mesh.position.x, TABLE_TOP + 0.003, r.item.mesh.position.z); this.activeRing.scale.setScalar(pulse * 0.3 + 0.85); }
    if (r?.life) this.lifeRing.position.set(r.life.position.x, 0.02, r.life.position.z);
    this.activeRing.material.opacity = pulse;
    this.activeRing.material.color.lerpColors(RING_GOLD, RING_EMBER, 0.5 + Math.sin(t * 5) * 0.5);
    // Condition rings: one thin coloured ring per condition, stacked outward under the mini.
    this.condRings.children.forEach((m) => { m.geometry.dispose(); m.material.dispose(); }); this.condRings.clear();
    for (const c of plated) {
      const it = this.mgr.refs[c.id]?.item; if (!it || !c.conditions.length) continue;
      c.conditions.forEach((k, i) => {
        const m = new THREE.Mesh(new THREE.RingGeometry(0.04 + i * 0.008, 0.046 + i * 0.008, 32), new THREE.MeshBasicMaterial({ color: CONDITIONS[k.name] || '#fff', side: THREE.DoubleSide }));
        m.rotation.x = -Math.PI / 2; m.position.set(it.mesh.position.x, TABLE_TOP + 0.002, it.mesh.position.z); this.condRings.add(m);
      });
    }
  }
}
