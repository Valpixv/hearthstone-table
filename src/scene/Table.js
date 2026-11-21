import * as THREE from 'three';
import { TABLE_TOP, TABLE, TRAY, DICE_POUCH } from '../physics/Physics.js';
import { MAP as LAYOUT_MAP, LEGACY_LAYOUT } from '../table/layout.js';
import { planksTex, noiseTex, rng, std, drawText } from './util.js';
import { place } from './assets.js';
import { fontsReady, FONT, ANISO, diamond } from './fonts.js';

// Dragonfire table palette: bone parchment, gold-500 rules, crimson felt.
const BONE = '#efe3c8', BONE_DK = '#b9a888', INK = '#3a2410', GOLD = '#d9a441', CRIMSON = '#8e1b0e';

/** The battle mat rectangle on the table top (src/table/layout.js). */
export const MAP = LAYOUT_MAP;
/** Squares across the mat (70 ft at 5 ft per square). */
export const MAP_COLS = 14;

// The fixed centre of the world: table, felt dice tray, parchment map with fog of war,
// and a little roll-log scroll readable in VR.
export class Table {
  constructor(scene) {
    this.group = new THREE.Group(); scene.add(this.group);
    const wood = std('#ffffff', { map: planksTex('#7a4a26', { repeat: [2, 1] }), roughness: 0.7 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE.w, 0.05, TABLE.d), wood);
    top.position.y = TABLE_TOP - 0.025; top.receiveShadow = true; top.castShadow = true;
    const fallback = new THREE.Group(); this.group.add(fallback);
    fallback.add(top);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(TABLE.w + 0.06, 0.03, TABLE.d + 0.06), std('#4a2a12'));
    trim.position.y = TABLE_TOP - 0.06; fallback.add(trim);
    const legG = new THREE.CylinderGeometry(0.04, 0.05, TABLE_TOP - 0.05, 10);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const l = new THREE.Mesh(legG, std('#4a2a12')); l.position.set(x * (TABLE.w / 2 - 0.1), (TABLE_TOP - 0.05) / 2, z * (TABLE.d / 2 - 0.1)); l.castShadow = true; fallback.add(l);
    }
    // Felt tray: a group in tray space (x to the player's right, z toward the player) so it can sit at any seat.
    this.tray = new THREE.Group(); this.group.add(this.tray);
    const felt = new THREE.Mesh(new THREE.BoxGeometry(TRAY.w, 0.01, TRAY.d), std('#ffffff', { map: noiseTex('#5a1014', 25, { seed: 11 }), roughness: 1 }));
    felt.position.set(0, TABLE_TOP + 0.005, 0); felt.receiveShadow = true; this.tray.add(felt);
    const rimMat = std('#5b3418', { roughness: 0.5 });
    const rims = [[TRAY.w + 0.02, TRAY.t, 0, -TRAY.d / 2], [TRAY.w + 0.02, TRAY.t, 0, TRAY.d / 2], [TRAY.t, TRAY.d, -TRAY.w / 2, 0], [TRAY.t, TRAY.d, TRAY.w / 2, 0]];
    for (const [w, d, x, z] of rims) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(w, TRAY.rim, d), rimMat);
      r.position.set(x, TABLE_TOP + TRAY.rim / 2, z); r.castShadow = true; r.receiveShadow = true; this.tray.add(r);
    }
    // Two CC0 Poly Haven wooden tables pushed together (tops at TABLE_TOP); the procedural
    // table above stays only as a fallback until they load.
    const depth = 0.66, sy = TABLE_TOP / 0.55, sx = TABLE.w / 1.8;
    Promise.all([-1, 1].map((k) => place(this.group, 'WoodenTable_01', [0, 0, k * depth / 2], { scale: [sx, sy, 1], shadow: 'both', rotY: k > 0 ? Math.PI : 0 })))
      .then(() => { fallback.visible = false; })
      .catch((e) => console.warn('table model failed', e.message));
    this.buildMap();
    this.buildLog();
    this.buildPouch();
    this.placeTray();
    // Canvas text is baked; redraw once the Dragonfire faces have loaded.
    fontsReady().then(() => { this.drawMap(); this.setLog(this.logEntries || []); });
  }

  buildPouch() {
    const leather = std('#6b3a1e', { roughness: 0.9 });
    const bag = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), leather);
    bag.scale.set(1, 0.85, 1); bag.position.set(0, TABLE_TOP + 0.042, 0); bag.castShadow = true;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.03, 12, 1, true), leather); neck.position.set(0, TABLE_TOP + 0.09, 0);
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.004, 6, 16), std('#d4af37', { metalness: 0.8 })); tie.rotation.x = Math.PI / 2; tie.position.set(0, TABLE_TOP + 0.085, 0);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.02, 16), new THREE.MeshBasicMaterial({ color: '#ffd34d' })); glow.rotation.x = -Math.PI / 2; glow.position.set(0, TABLE_TOP + 0.104, 0);
    this.pouch = new THREE.Group(); this.pouch.add(bag, neck, tie, glow); this.group.add(this.pouch);
  }

  /** Puts the tray and pouch meshes where Physics.TRAY / DICE_POUCH say (call after Physics.setTray). */
  placeTray() {
    this.tray.position.set(TRAY.x, 0, TRAY.z); this.tray.rotation.y = TRAY.yaw || 0;
    this.pouch.position.set(DICE_POUCH.x, 0, DICE_POUCH.z);
  }

  /** Stands the roll-log scroll at a table point, facing a yaw (the far side of the table from the local player). */
  placeLog(x, z, yaw) { this.logStand.position.set(x, 0, z); this.logStand.rotation.y = yaw; }

  buildMap() {
    // 2x backing store (1024x720); drawMap draws in 512x360 logical units via setTransform.
    this.mapCanvas = document.createElement('canvas'); this.mapCanvas.width = 1024; this.mapCanvas.height = 720;
    this.mapTex = new THREE.CanvasTexture(this.mapCanvas); this.mapTex.colorSpace = THREE.SRGBColorSpace; this.mapTex.anisotropy = ANISO;
    const map = new THREE.Mesh(new THREE.PlaneGeometry(MAP.w, MAP.d), std('#ffffff', { map: this.mapTex, roughness: 0.95 }));
    map.rotation.x = -Math.PI / 2; map.position.set(MAP.x, TABLE_TOP + 0.002, MAP.z); map.receiveShadow = true;
    this.map = map; this.group.add(map);
    this.fogCanvas = document.createElement('canvas'); this.fogCanvas.width = 256; this.fogCanvas.height = 180;
    this.fogTex = new THREE.CanvasTexture(this.fogCanvas);
    this.fog = new THREE.Mesh(new THREE.PlaneGeometry(MAP.w, MAP.d), new THREE.MeshStandardMaterial({ map: this.fogTex, transparent: true, depthWrite: false, roughness: 1 }));
    this.fog.rotation.x = -Math.PI / 2; this.fog.position.set(MAP.x, TABLE_TOP + 0.004, MAP.z); this.fog.visible = false;
    this.group.add(this.fog);
    this.drawMap();
  }

  /**
   * The table map: one fixed parchment battle mat with a 5 ft grid (the same cells minis snap to in
   * src/table/Tactics.js). It never changes during play; only the fog of war hides parts of it.
   */
  drawMap() {
    const g = this.mapCanvas.getContext('2d'), W = 512, H = 360, r = rng(100);
    g.setTransform(2, 0, 0, 2, 0, 0); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const grd = g.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, W * 0.7);
    grd.addColorStop(0, BONE); grd.addColorStop(1, BONE_DK);
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 3000; k++) { g.fillStyle = `rgba(90,60,20,${r() * 0.08})`; g.fillRect(r() * W, r() * H, 2, 2); }
    // 5 ft squares: 14 across the 70 ft mat; every other square is very slightly darker so distances read at a glance.
    const cell = W / MAP_COLS, rows = Math.floor(H / cell + 1e-6);
    for (let i = 0; i < MAP_COLS; i++) for (let j = 0; j < rows; j++) if ((i + j) % 2) { g.fillStyle = 'rgba(75,46,18,0.045)'; g.fillRect(i * cell, j * cell, cell, cell); }
    g.strokeStyle = 'rgba(75,46,18,0.38)'; g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i <= MAP_COLS; i++) { g.moveTo(i * cell, 0); g.lineTo(i * cell, rows * cell); }
    for (let j = 0; j <= rows; j++) { g.moveTo(0, j * cell); g.lineTo(W, j * cell); }
    g.stroke();
    // Gold border rule, corner studs and a small compass.
    g.strokeStyle = GOLD; g.lineWidth = 3; g.strokeRect(4, 4, W - 8, H - 8);
    for (const [x, y] of [[4, 4], [W - 4, 4], [4, H - 4], [W - 4, H - 4]]) diamond(g, x, y, 7, CRIMSON);
    g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); g.arc(W - 30, H - 14, 9, 0, Math.PI * 2); g.stroke();
    g.fillStyle = INK; g.font = `bold 11px ${FONT.head}`; g.textAlign = 'center'; g.fillText('N', W - 30, H - 10);
    g.textAlign = 'left'; g.font = `italic 10px ${FONT.body}`; g.fillText('1 square = 5 ft', 12, H - 10);
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.mapTex.needsUpdate = true;
  }

  resetFog() {
    const g = this.fogCanvas.getContext('2d'), r = rng(9);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#121016'; g.fillRect(0, 0, 256, 180);
    for (let k = 0; k < 800; k++) { g.fillStyle = `rgba(60,55,70,${r() * 0.4})`; g.beginPath(); g.arc(r() * 256, r() * 180, r() * 6, 0, 7); g.fill(); }
    this.fogTex.needsUpdate = true;
  }
  setFogVisible(v, dmView = false) { if (v && !this.fog.visible) this.resetFog(); this.fog.visible = v; this.fog.material.opacity = dmView ? 0.6 : 1; }
  // uv in [0,1]^2 from a raycast hit, or a world point
  revealUV(u, v, radius = 16) {
    const g = this.fogCanvas.getContext('2d');
    g.globalCompositeOperation = 'destination-out';
    const x = u * 256, y = (1 - v) * 180;
    const gr = g.createRadialGradient(x, y, 0, x, y, radius); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.8)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, radius, 0, 7); g.fill();
    g.globalCompositeOperation = 'source-over'; this.fogTex.needsUpdate = true;
  }
  revealWorld(p) {
    const u = (p[0] - (MAP.x - MAP.w / 2)) / MAP.w, v = 1 - (p[2] - (MAP.z - MAP.d / 2)) / MAP.d;
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1 && Math.abs(p[1] - TABLE_TOP) < 0.025) this.revealUV(u, v);
  }

  buildLog() {
    // 2x backing store (1024x720); setLog draws in 512x360 logical units.
    this.logCanvas = document.createElement('canvas'); this.logCanvas.width = 1024; this.logCanvas.height = 720;
    this.logTex = new THREE.CanvasTexture(this.logCanvas); this.logTex.colorSpace = THREE.SRGBColorSpace; this.logTex.anisotropy = ANISO;
    // The scroll stands in a group in its own space (x across, z toward the reader) so it can face any seat.
    this.logStand = new THREE.Group(); this.group.add(this.logStand);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.24), new THREE.MeshBasicMaterial({ map: this.logTex, transparent: true }));
    m.position.set(0, TABLE_TOP + 0.17, 0.04); m.rotation.x = -0.25; this.logStand.add(m);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.38, 8), std('#5b3418'));
    rod.rotation.z = Math.PI / 2; rod.position.set(0, TABLE_TOP + 0.295, 0.01); this.logStand.add(rod);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 6), std('#5b3418'));
    post.position.set(0, TABLE_TOP + 0.15, 0); this.logStand.add(post);
    if (LEGACY_LAYOUT) this.placeLog(0.42, -0.54, 0); else this.placeLog(0.62, -0.5, -0.35);
    this.setLog([]);
  }
  setLog(entries) {
    this.logEntries = entries;
    const g = this.logCanvas.getContext('2d'), W = 512, H = 360;
    g.setTransform(2, 0, 0, 2, 0, 0); g.textBaseline = 'alphabetic';
    const pg = g.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.65); pg.addColorStop(0, BONE); pg.addColorStop(1, '#d9c49a');
    g.fillStyle = pg; g.fillRect(0, 0, W, H);
    g.strokeStyle = GOLD; g.lineWidth = 3; g.strokeRect(4, 4, W - 8, H - 8);
    g.fillStyle = INK; g.font = `bold 34px ${FONT.head}`; g.textAlign = 'left'; g.fillText('Roll Log', 20, 44);
    g.strokeStyle = GOLD; g.lineWidth = 2; g.beginPath(); g.moveTo(20, 56); g.lineTo(W - 20, 56); g.stroke();
    g.font = `28px ${FONT.body}`;
    entries.slice(-7).reverse().forEach((e, i) => { g.fillStyle = e.color || INK; g.fillText(e.text, 24, 92 + i * 38, W - 40); });
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.logTex.needsUpdate = true;
  }
}

export { drawText };
