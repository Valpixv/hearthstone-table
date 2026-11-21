// Dragonfire canvas typography. Canvas text is baked into textures, so anything drawn before the
// web fonts finish loading falls back to Georgia forever unless it is redrawn once they resolve.

/** Heading face (Cinzel), display face (Cinzel Decorative) and body face (IM Fell English). */
export const FONT = {
  head: "Cinzel, Georgia, serif",
  deco: "'Cinzel Decorative', Cinzel, Georgia, serif",
  body: "'IM Fell English', Georgia, serif",
};

let ready = null;

/**
 * Resolves once Cinzel, Cinzel Decorative and IM Fell English are loaded, or after `timeoutMs`
 * (whichever comes first). Never rejects. Callers: `fontsReady().then(() => redraw())`.
 * @param {number} [timeoutMs=4000]
 * @returns {Promise<void>}
 */
export function fontsReady(timeoutMs = 4000) {
  if (ready) return ready;
  const fonts = typeof document !== 'undefined' && document.fonts;
  if (!fonts?.load) return (ready = Promise.resolve());
  const loads = ['bold 32px Cinzel', "bold 32px 'Cinzel Decorative'", "32px 'IM Fell English'", "italic 32px 'IM Fell English'"]
    .map((f) => fonts.load(f).catch(() => null));
  const timeout = new Promise((res) => setTimeout(res, timeoutMs));
  ready = Promise.race([Promise.all(loads), timeout]).then(() => undefined);
  return ready;
}

/** Canvas helper: draw an outlined text run (2 px dark stroke instead of a shadowBlur glow). */
export function strokeText(g, text, x, y, maxW, stroke = '#0b0807', lw = 4) {
  g.save(); g.lineJoin = 'round'; g.strokeStyle = stroke; g.lineWidth = lw;
  maxW ? g.strokeText(text, x, y, maxW) : g.strokeText(text, x, y);
  g.restore();
  maxW ? g.fillText(text, x, y, maxW) : g.fillText(text, x, y);
}

/** Vector diamond stud (replaces the ◆ glyph). */
export function diamond(g, x, y, r, fill = '#d9a441') {
  g.save(); g.fillStyle = fill; g.beginPath();
  g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.fill();
  g.strokeStyle = '#0b0807'; g.lineWidth = 2; g.stroke(); g.restore();
}

/** Vector heater shield outline (replaces 🛡 for AC). Centre (x, y), half-width r. */
export function shield(g, x, y, r, stroke = '#d9a441', fill = null) {
  g.save(); g.beginPath();
  g.moveTo(x - r, y - r * 1.1); g.lineTo(x + r, y - r * 1.1); g.lineTo(x + r, y);
  g.quadraticCurveTo(x + r, y + r * 0.9, x, y + r * 1.3); g.quadraticCurveTo(x - r, y + r * 0.9, x - r, y); g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  g.strokeStyle = stroke; g.lineWidth = Math.max(2, r / 6); g.stroke(); g.restore();
}

/** Vector cross (replaces ✝ for downed). */
export function cross(g, x, y, s, fill = '#8a8078') {
  g.save(); g.fillStyle = fill; g.strokeStyle = '#0b0807'; g.lineWidth = 2;
  const t = s * 0.22;
  g.beginPath(); g.rect(x - t / 2, y - s / 2, t, s); g.rect(x - s * 0.35, y - s * 0.22, s * 0.7, t);
  g.fill(); g.stroke(); g.restore();
}

/** Vector crossed blades (replaces ⚔). */
export function blades(g, x, y, s, stroke = '#3a2410') {
  g.save(); g.strokeStyle = stroke; g.lineWidth = Math.max(2, s / 8); g.lineCap = 'round';
  g.beginPath(); g.moveTo(x - s / 2, y + s / 2); g.lineTo(x + s / 2, y - s / 2); g.moveTo(x + s / 2, y + s / 2); g.lineTo(x - s / 2, y - s / 2); g.stroke();
  g.beginPath(); g.moveTo(x - s * 0.5, y + s * 0.15); g.lineTo(x - s * 0.15, y + s * 0.5); g.moveTo(x + s * 0.5, y + s * 0.15); g.lineTo(x + s * 0.15, y + s * 0.5); g.stroke();
  g.restore();
}

/** Default anisotropy when no renderer is passed in. */
export const ANISO = 8;
