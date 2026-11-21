import * as THREE from 'three';
import { fontsReady, FONT, strokeText } from './fonts.js';
import { drawIcon, onIconsReady } from '../ui/icons.js';
import { legacyView } from '../tokens/TokenManager.js';

const PW = 256, PH = 512, CW = 0.2, CH = 0.4, POLE_H = 1.45, RISE = 0.15;
const GREY = new THREE.Color('#6d6660'), WHITE = new THREE.Color('#ffffff');

/**
 * Initiative as standing banners (Dragonfire A6): one dragon-hide pennant on a pole per combatant,
 * planted around the far half of the table rim in initiative order. The active combatant's banner
 * rises 15 cm and the brazier at its foot lights; downed ones droop and grey out.
 * Display only: reads dm.state.combat on dm.on. Animates in onBeforeRender, so it runs in WebXR too.
 */
export class InitiativeBanners {
  /** @param {{scene: THREE.Scene, dm: {state: object, on: Function}}} deps */
  constructor({ scene, dm }) {
    this.dm = dm; this.group = new THREE.Group(); this.group.visible = false; scene.add(this.group);
    this.pool = []; this.time = { value: 0 };
    // One shared ember light, moved to the active banner's brazier.
    this.light = new THREE.PointLight('#ff7a2e', 0, 1.6, 2); this.group.add(this.light);
    dm.on(() => this.sync());
    const redraw = () => { this.pool.forEach((b) => { b.key = ''; }); this.sync(); };
    fontsReady().then(redraw); onIconsReady(redraw);
  }

  make() {
    const b = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: '#2a1a10', roughness: 0.7, metalness: 0.1 });
    const gold = new THREE.MeshStandardMaterial({ color: '#d9a441', roughness: 0.35, metalness: 0.9 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, POLE_H, 10), wood); pole.position.y = POLE_H / 2; pole.castShadow = true;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, CW + 0.06, 8), gold); bar.rotation.z = Math.PI / 2; bar.position.set(CW / 2, POLE_H - 0.03, 0);
    const finial = new THREE.Mesh(new THREE.OctahedronGeometry(0.022), gold); finial.position.y = POLE_H + 0.02;
    // Brazier: iron bowl with a coal bed that glows when the banner is active.
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.04, 0.06, 14, 1, true), new THREE.MeshStandardMaterial({ color: '#1a1412', metalness: 0.8, roughness: 0.5, side: THREE.DoubleSide }));
    bowl.position.y = 0.33;
    const coal = new THREE.Mesh(new THREE.CircleGeometry(0.066, 14), new THREE.MeshStandardMaterial({ color: '#211813', emissive: '#ff5a1f', emissiveIntensity: 0 }));
    coal.rotation.x = -Math.PI / 2; coal.position.y = 0.35;
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.03, 0.3, 6), bowl.material); legs.position.y = 0.15;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ff7a2e', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
    glow.scale.setScalar(0.35); glow.position.y = 0.4;
    // Pennant: canvas texture + vertex-shader sway (amplitude grows toward the free bottom edge).
    const cv = document.createElement('canvas'); cv.width = PW; cv.height = PH;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
    const u = { uTime: this.time, uPhase: { value: this.pool.length * 1.7 }, uDroop: { value: 0 } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = 'uniform float uTime, uPhase, uDroop;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float k = clamp((${(CH / 2).toFixed(3)} - position.y) / ${CH.toFixed(3)}, 0.0, 1.0);
        float amp = mix(1.0, 0.25, uDroop);
        transformed.z += (sin(uTime * 1.7 + uPhase + position.y * 9.0) * 0.022 + sin(uTime * 2.9 + position.x * 14.0) * 0.006) * k * amp;
        transformed.x *= 1.0 - uDroop * 0.3 * k;
        transformed.y -= uDroop * k * k * 0.06;`);
    };
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(CW, CH, 6, 14), mat);
    cloth.position.set(CW / 2 + 0.01, POLE_H - 0.04 - CH / 2, 0); cloth.castShadow = true;
    const sway = new THREE.Group(); sway.add(pole, bar, finial, cloth);
    for (const m of [legs, bowl, coal, glow]) m.position.z = 0.1; // brazier stands just in front of the pole
    b.add(sway, legs, bowl, coal, glow);
    cloth.onBeforeRender = () => { this.animate(); };
    const rec = { root: b, sway, cloth, mat, cv, tex, u, coal, glow, key: '', y: 0, lit: 0 };
    this.group.add(b); this.pool.push(rec); return rec;
  }

  sync() {
    // Reads tokens in initiative order (combat.order); legacy views keep side 'pc' | 'monster' plus faction.
    const C = this.dm.state.combat, toks = this.dm.state.tokens || [];
    const list = C?.active ? (C.order || []).map((id) => toks.find((t) => t.id === id)).filter((c) => c && c.init != null).map(legacyView) : [];
    this.group.visible = list.length > 0;
    const activeId = C?.active ? C.order?.[C.turn] ?? null : null;
    while (this.pool.length < list.length) this.make();
    const n = list.length, a0 = 0.12 * Math.PI, a1 = 0.88 * Math.PI;
    this.pool.forEach((b, i) => {
      const c = list[i]; b.root.visible = !!c; if (!c) return;
      // Far half of the rim (the players' cards sit on the near +z edge), left to right in order.
      const a = n === 1 ? Math.PI / 2 : a1 - (a1 - a0) * (i / (n - 1));
      b.root.position.set(Math.cos(a) * 1.08, 0, -Math.sin(a) * 0.86);
      b.root.lookAt(0, 0, 0); // local +z (cloth front, brazier) faces the table centre
      b.active = c.id === activeId; b.down = c.hp <= 0;
      const key = JSON.stringify([c.name, c.init, c.hp, c.maxHp, c.faction, b.active, (c.conditions || []).map((k) => k.name)]);
      if (b.key !== key) { b.key = key; this.draw(b, c); }
    });
  }

  draw(b, c) {
    const g = b.cv.getContext('2d'), down = c.hp <= 0, k = Math.max(0, Math.min(1, c.hp / c.maxHp)), ally = c.faction !== 'enemy';
    g.clearRect(0, 0, PW, PH);
    // Swallow-tailed dragon-hide pennant (magma to deep red; ash grey when downed).
    const hide = g.createLinearGradient(0, 0, 0, PH);
    if (down) { hide.addColorStop(0, '#4a4440'); hide.addColorStop(1, '#1f1c1a'); } else { hide.addColorStop(0, ally ? '#1f8f86' : '#a8281e'); hide.addColorStop(1, ally ? '#0e3f3b' : '#3d0d08'); }
    g.fillStyle = hide; g.beginPath(); g.moveTo(0, 0); g.lineTo(PW, 0); g.lineTo(PW, PH); g.lineTo(PW / 2, PH - 90); g.lineTo(0, PH); g.closePath(); g.fill();
    g.strokeStyle = down ? '#8a8078' : b.active ? '#f0cf7e' : '#c99a3b'; g.lineWidth = b.active ? 10 : 6; g.stroke();
    g.strokeStyle = 'rgba(11,8,7,0.25)'; g.lineWidth = 2;
    for (let y = 30; y < PH - 120; y += 22) for (let x = (y / 22) % 2 ? 22 : 0; x < PW; x += 44) { g.beginPath(); g.arc(x, y, 22, 0, Math.PI); g.stroke(); }
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    // Initiative number in a gold roundel.
    g.fillStyle = '#1c0d07'; g.beginPath(); g.arc(PW / 2, 86, 58, 0, Math.PI * 2); g.fill();
    g.strokeStyle = down ? '#8a8078' : '#d9a441'; g.lineWidth = 5; g.stroke();
    g.fillStyle = down ? '#8a8078' : '#f3d58a'; g.font = `bold 64px ${FONT.head}`; strokeText(g, String(c.init), PW / 2, 108);
    // Name (Cinzel), up to two lines.
    g.fillStyle = down ? '#b0a89f' : '#efe3c8'; g.font = `bold 34px ${FONT.head}`;
    const words = c.name.split(' '), l1 = words.slice(0, Math.ceil(words.length / 2)).join(' '), l2 = words.slice(Math.ceil(words.length / 2)).join(' ');
    strokeText(g, l2 ? l1 : c.name, PW / 2, 196, PW - 30); if (l2) strokeText(g, l2, PW / 2, 236, PW - 30);
    // HP state: PCs show numbers; monsters only show a word (no exact enemy HP to players).
    const state = down ? 'DOWN' : ally ? `${c.hp} / ${c.maxHp}` : k <= 0.5 ? 'BLOODIED' : 'HALE';
    if (!drawIcon(g, down ? 'death-save' : 'hp', PW / 2, 286, 46, down ? '#b0a89f' : undefined)) { /* text alone still reads */ }
    g.fillStyle = down ? '#b0a89f' : k <= 0.5 ? '#ffb07a' : '#b8f0b0'; g.font = `bold 30px ${FONT.head}`; strokeText(g, state, PW / 2, 344, PW - 30);
    (c.conditions || []).slice(0, 4).forEach((cd, i, arr) => drawIcon(g, cd.name, PW / 2 + (i - (arr.length - 1) / 2) * 50, 392, 42));
    b.tex.needsUpdate = true;
  }

  animate() {
    const now = performance.now() / 1000; if (this.lastT === now) return;
    const dt = Math.min(0.1, this.lastT ? now - this.lastT : 0); this.lastT = now; this.time.value = now;
    const e = 1 - Math.exp(-dt * 4);
    let act = null;
    for (const b of this.pool) {
      if (!b.root.visible) continue;
      b.y += ((b.active ? RISE : 0) - b.y) * e; b.sway.position.y = b.y;
      b.lit += ((b.active ? 1 : 0) - b.lit) * e;
      b.u.uDroop.value += ((b.down ? 1 : 0) - b.u.uDroop.value) * e;
      b.mat.color.copy(WHITE).lerp(GREY, b.u.uDroop.value * 0.5);
      const flick = 0.85 + Math.sin(now * 11 + b.u.uPhase.value) * 0.08 + Math.sin(now * 23) * 0.05;
      b.coal.material.emissiveIntensity = b.lit * 2.2 * flick; b.glow.material.opacity = b.lit * 0.9 * flick;
      if (b.active) act = b;
    }
    if (act) { act.coal.getWorldPosition(this.light.position); this.group.worldToLocal(this.light.position); this.light.position.y += 0.1; }
    this.light.intensity = act ? 0.9 * act.lit * (0.9 + Math.sin(now * 13) * 0.1) : 0;
  }
}

let _glow = null;
function glowTex() {
  if (_glow) return _glow;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.4, 'rgba(255,200,140,0.5)'); r.addColorStop(1, 'rgba(255,90,31,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64); _glow = new THREE.CanvasTexture(c); return _glow;
}
