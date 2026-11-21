import * as THREE from 'three';
import { canvasTex } from '../scene/util.js';

// Cached procedural textures for the cinematic layer (white, tinted by material colour).
const cache = {};
const once = (key, make) => cache[key] || (cache[key] = make());

/** Outer rune circle: two rings + 8 glyphs + inner star. */
export const runeTex = () => once('rune', () => canvasTex(512, 512, (g, w) => {
  const c = w / 2;
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = 18;
  g.lineWidth = 10; g.beginPath(); g.arc(c, c, 236, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 5; g.beginPath(); g.arc(c, c, 168, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 6;
  for (let i = 0; i < 8; i++) {
    g.save(); g.translate(c, c); g.rotate((i / 8) * Math.PI * 2); g.translate(0, -202);
    g.beginPath();
    g.moveTo(0, -20); g.lineTo(0, 20);
    if (i % 2) { g.moveTo(-12, -8); g.lineTo(12, 8); } else { g.moveTo(-12, 0); g.lineTo(0, -12); g.lineTo(12, 0); g.lineTo(0, 12); g.closePath(); }
    if (i % 3 === 0) { g.moveTo(-14, 18); g.lineTo(14, 18); }
    g.stroke(); g.restore();
  }
  g.lineWidth = 3; g.beginPath();
  for (let i = 0; i <= 8; i++) { const a = (i * 3 / 8) * Math.PI * 2; g.lineTo(c + Math.sin(a) * 168, c - Math.cos(a) * 168); }
  g.stroke();
}));

/** Inner counter-rotating ring: dashed band, 12 tick runes, small hexagram. */
export const innerRuneTex = () => once('inner', () => canvasTex(256, 256, (g, w) => {
  const c = w / 2;
  g.strokeStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = 10;
  g.lineWidth = 5; g.setLineDash([18, 10]); g.beginPath(); g.arc(c, c, 118, 0, Math.PI * 2); g.stroke();
  g.setLineDash([]); g.lineWidth = 3; g.beginPath(); g.arc(c, c, 96, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 12; i++) {
    g.save(); g.translate(c, c); g.rotate((i / 12) * Math.PI * 2); g.translate(0, -107);
    g.beginPath(); g.moveTo(0, -7); g.lineTo(0, 7); if (i % 2) { g.moveTo(-5, 0); g.lineTo(5, 0); } g.stroke(); g.restore();
  }
  for (let t = 0; t < 2; t++) {
    g.beginPath();
    for (let i = 0; i <= 3; i++) { const a = (i / 3) * Math.PI * 2 + t * Math.PI / 3; g.lineTo(c + Math.sin(a) * 70, c - Math.cos(a) * 70); }
    g.stroke();
  }
}));

/** Soft shockwave ring with bright leading edge. */
export const ringTex = () => once('ring', () => canvasTex(256, 256, (g, w) => {
  const c = w / 2, gr = g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.62, 'rgba(255,255,255,0.05)');
  gr.addColorStop(0.86, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.94, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, w);
}));

/** Radial flash glow. */
export const flashTex = () => once('flash', () => canvasTex(128, 128, (g, w) => {
  const c = w / 2, gr = g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, w);
}));

/** Vertical light-pillar gradient (bright at base, fading upward, soft at the seams). */
export const pillarTex = () => once('pillar', () => canvasTex(64, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, h, 0, 0);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 8) { g.fillStyle = `rgba(255,255,255,${0.08 + (x % 24 === 0 ? 0.25 : 0)})`; g.fillRect(x, 0, 2, h); }
}));

/** Cracked-ground decal: charred fissures with a molten core line (alpha carries the shape). */
export const crackTex = () => once('crack', () => canvasTex(512, 512, (g, w) => {
  const c = w / 2; let s = 7;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const paths = [];
  const branch = (x, y, a, len, depth) => {
    const pts = [[x, y]];
    for (let i = 0; i < 7; i++) { a += (r() - 0.5) * 0.9; x += Math.cos(a) * len / 7; y += Math.sin(a) * len / 7; pts.push([x, y]); if (depth < 2 && r() < 0.25) branch(x, y, a + (r() - 0.5) * 1.6, len * 0.5, depth + 1); }
    paths.push([pts, 3 - depth]);
  };
  for (let i = 0; i < 9; i++) branch(c, c, (i / 9) * Math.PI * 2 + r() * 0.5, 150 + r() * 90, 0);
  const g2 = g.createRadialGradient(c, c, 0, c, c, c);
  g2.addColorStop(0, 'rgba(8,4,2,0.85)'); g2.addColorStop(0.35, 'rgba(12,6,3,0.45)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = g2; g.fillRect(0, 0, w, w);
  const stroke = (style, wMul, blur) => {
    g.strokeStyle = style; g.shadowColor = style; g.shadowBlur = blur; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const [pts, wd] of paths) { g.lineWidth = wd * wMul; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }
  };
  stroke('rgba(10,4,2,0.95)', 4, 0);
  stroke('rgba(255,90,31,1)', 1.6, 14);
  stroke('rgba(255,210,120,1)', 0.5, 4);
}));
