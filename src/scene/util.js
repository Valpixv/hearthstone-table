import * as THREE from 'three';

// Seeded RNG so procedural scenes are identical every load.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 4;
  return t;
}

// Speckle noise over a base colour – used for stone, wood, felt, parchment.
export function noiseTex(base, variance = 30, { w = 256, h = 256, repeat = null, streaks = false, seed = 3 } = {}) {
  const r = rng(seed);
  return canvasTex(w, h, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const y = Math.floor(i / 4 / w);
      const n = (r() - 0.5) * variance + (streaks ? Math.sin(y * 0.35 + r() * 0.6) * variance * 0.4 : 0);
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  }, { repeat });
}

export function planksTex(base = '#6b4423', { repeat = [4, 4], seed = 5 } = {}) {
  const r = rng(seed);
  return canvasTex(256, 256, (g, w, h) => {
    for (let i = 0; i < 8; i++) {
      const l = 0.8 + r() * 0.4;
      g.fillStyle = shade(base, l); g.fillRect(0, i * 32, w, 32);
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      for (let k = 0; k < 6; k++) {
        g.beginPath(); const y = i * 32 + r() * 32;
        g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 4, w * 0.6, y - 4, w, y + r() * 4); g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, i * 32, w, 2);
      g.fillRect(r() * w, i * 32, 2, 32);
    }
  }, { repeat });
}

export function stoneTex(base = '#555', { repeat = [4, 2], seed = 7 } = {}) {
  const r = rng(seed);
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, w, h);
    const rows = 8, bh = h / rows;
    for (let y = 0; y < rows; y++) {
      const off = (y % 2) * 24;
      for (let x = -48; x < w; x += 48) {
        g.fillStyle = shade(base, 0.7 + r() * 0.5);
        g.fillRect(x + off + 2, y * bh + 2, 44, bh - 4);
      }
    }
  }, { repeat });
}

export function shade(hex, f) {
  const c = new THREE.Color(hex); c.multiplyScalar(f);
  return '#' + c.getHexString();
}

export function glowTex(inner = 'rgba(255,220,150,1)', outer = 'rgba(255,80,0,0)') {
  return canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, inner); gr.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.6)')); gr.addColorStop(1, outer);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
}

const flameTexCache = {};
// Flame = additive sprites + optional point light, flickered in update().
export function makeFlame(color = '#ff9a3c', { size = 0.35, light = true, intensity = 2.5, distance = 6, ctx } = {}) {
  const key = color;
  if (!flameTexCache[key]) {
    const c = new THREE.Color(color);
    flameTexCache[key] = glowTex(`rgba(255,255,220,1)`, `rgba(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0},0)`);
  }
  const group = new THREE.Group();
  const mat = new THREE.SpriteMaterial({ map: flameTexCache[key], color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const s1 = new THREE.Sprite(mat); s1.scale.set(size, size * 1.4, 1);
  const s2 = new THREE.Sprite(mat); s2.scale.set(size * 0.6, size, 1); s2.position.y = size * 0.25;
  group.add(s1, s2);
  let pl = null;
  if (light) { pl = new THREE.PointLight(color, intensity, distance, 1.6); pl.position.y = 0.1; group.add(pl); }
  const seed = Math.random() * 100;
  group.userData.update = (t) => {
    const f = 0.85 + Math.sin(t * 13 + seed) * 0.08 + Math.sin(t * 7.3 + seed * 2) * 0.07;
    s1.scale.set(size * f, size * 1.4 * (2 - f), 1);
    s2.position.y = size * (0.25 + 0.05 * Math.sin(t * 9 + seed));
    if (pl) pl.intensity = intensity * f * (ctx ? ctx.torchMul : 1);
  };
  return group;
}

// Instanced mesh helper: transforms = [{p:[x,y,z], r:[x,y,z], s:[x,y,z]|number}]
export function instanced(geom, mat, transforms, { cast = false, receive = false } = {}) {
  const m = new THREE.InstancedMesh(geom, mat, transforms.length);
  const o = new THREE.Object3D();
  transforms.forEach((t, i) => {
    o.position.set(...t.p);
    o.rotation.set(...(t.r || [0, 0, 0]));
    if (typeof t.s === 'number') o.scale.setScalar(t.s); else o.scale.set(...(t.s || [1, 1, 1]));
    o.updateMatrix(); m.setMatrixAt(i, o.matrix);
    if (t.c) m.setColorAt(i, new THREE.Color(t.c));
  });
  m.castShadow = cast; m.receiveShadow = receive;
  m.instanceMatrix.needsUpdate = true;
  return m;
}

export function textCanvas(text, { w = 1024, h = 256, font = 'bold 72px Georgia', color = '#ffe9a8', glow = '#ffae00', bg = null, align = 'center' } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  drawText(g, text, { w, h, font, color, glow, bg, align });
  return c;
}

export function drawText(g, text, { w, h, font, color, glow, bg, align = 'center' }) {
  g.clearRect(0, 0, w, h);
  if (bg) { g.fillStyle = bg; roundRect(g, 4, 4, w - 8, h - 8, 28); g.fill(); }
  g.font = font; g.textAlign = align; g.textBaseline = 'middle';
  const lines = wrap(g, text, w - 60);
  const lh = parseInt(font.match(/(\d+)px/)[1]) * 1.15;
  const y0 = h / 2 - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => {
    if (glow) { g.shadowColor = glow; g.shadowBlur = 24; }
    g.fillStyle = color; g.fillText(l, align === 'center' ? w / 2 : 30, y0 + i * lh);
  });
  g.shadowBlur = 0;
}

function wrap(g, text, maxW) {
  const words = String(text).split(' '); const lines = []; let cur = '';
  for (const wd of words) {
    const test = cur ? cur + ' ' + wd : wd;
    if (g.measureText(test).width > maxW && cur) { lines.push(cur); cur = wd; } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export function textSprite(text, opts = {}) {
  const c = textCanvas(text, opts);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: opts.depthTest ?? true });
  const s = new THREE.Sprite(mat);
  const sc = opts.scale || 0.5;
  s.scale.set(sc * (c.width / c.height), sc, 1);
  s.userData.canvas = c; s.userData.opts = opts;
  return s;
}

export function updateTextSprite(sprite, text) {
  const c = sprite.userData.canvas; const o = sprite.userData.opts;
  drawText(c.getContext('2d'), text, { w: c.width, h: c.height, font: o.font || 'bold 72px Georgia', color: o.color || '#ffe9a8', glow: o.glow ?? '#ffae00', bg: o.bg || null });
  sprite.material.map.needsUpdate = true;
}

export const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
