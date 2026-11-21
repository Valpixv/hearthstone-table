// The painted fantasy kit (assets/fantasy-kit-v1, sliced by tools/slice-fantasy-kit.mjs into public/assets/kit).
// One module serves every surface so the DOM, the in-world canvases and the VR panels share one look:
//   DOM:    kitIcon(key) → <img> markup, kitUrl(key) for CSS
//   canvas: kitImage(key) → a cached HTMLImageElement (null until loaded), drawKit / drawFrame to paint it
import KIT from '../data/kit.json';

const BASE = (import.meta.env?.BASE_URL ?? '/') + 'assets/kit/';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Every key in the kit ("group/slug"). */
export const KIT_KEYS = Object.keys(KIT);
/** True when the kit has this key. */
export const kitHas = (key) => !!KIT[key];
/** URL of a kit image. */
export const kitUrl = (key) => `${BASE}${key}.webp`;
/** [width, height] of a kit image in pixels, or null. */
export const kitSize = (key) => KIT[key] || null;
/** The painted close / remove glyph for icon-only buttons (the button keeps its title / aria-label). */
export const closeIcon = () => `<img class="kx" src="${kitUrl('ctl/close')}" alt="" aria-hidden="true" draggable="false">`;
/** A small painted glyph (plus, minus, search, down) for use inside a button. */
export const glyph = (key) => `<img class="kg" src="${kitUrl(symKey(key))}" alt="" aria-hidden="true" draggable="false">`;
/**
 * The picture-only version of a lettered emblem (its painted word cropped off by tools/make-ui-states.mjs), for a
 * small icon that sits beside a live text label, so the word never shows twice. Returns the key itself when there is none.
 */
export const symKey = (key) => (kitHas(`${key}-sym`) ? `${key}-sym` : key);
/** First key of the list that exists in the kit. */
export const kitFirst = (...keys) => keys.find(kitHas) || null;

/**
 * DOM markup for a kit image. Decorative by default (empty alt); pass alt for a standalone image.
 * @param {string} key @param {{ cls?: string, alt?: string, title?: string }} [o]
 */
export function kitIcon(key, { cls = '', alt = '', title = '' } = {}) {
  if (!kitHas(key)) return '';
  return `<img class="kit ${cls}" src="${kitUrl(key)}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ''} draggable="false">`;
}

const images = new Map(); // key → HTMLImageElement | null (loading)
const listeners = new Set();
let notifyTimer = null;
function notify() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => { notifyTimer = null; for (const f of [...listeners]) { try { f(); } catch (e) { console.warn('[kit] listener', e); } } }, 60);
}

/** Calls fn (debounced) every time more kit images finish loading, so canvases can redraw. Returns an unsubscribe. */
export function onKitLoad(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** The loaded image for a key, or null while it loads (starts the load on first use). */
export function kitImage(key) {
  if (!kitHas(key) || typeof Image === 'undefined') return null;
  if (images.has(key)) return images.get(key);
  images.set(key, null);
  const im = new Image();
  im.onload = () => { images.set(key, im); notify(); };
  im.onerror = () => console.warn('[kit] failed to load', key);
  im.src = kitUrl(key);
  return null;
}

/** Starts loading a list of keys. */
export function preloadKit(keys) { for (const k of keys) kitImage(k); }

/**
 * Paints a kit image into a box, keeping its aspect ('contain') or stretching ('fill').
 * @returns {boolean} false while the image is still loading
 */
export function drawKit(ctx, key, x, y, w, h, { fit = 'contain', alpha = 1 } = {}) {
  const im = kitImage(key); if (!im) return false;
  let dw = w, dh = h, dx = x, dy = y;
  if (fit === 'contain') { const k = Math.min(w / im.width, h / im.height); dw = im.width * k; dh = im.height * k; dx = x + (w - dw) / 2; dy = y + (h - dh) / 2; }
  const a = ctx.globalAlpha; ctx.globalAlpha = a * alpha;
  ctx.drawImage(im, dx, dy, dw, dh);
  ctx.globalAlpha = a;
  return true;
}

/**
 * Nine-slice paint of a kit frame so corners keep their shape at any size.
 * @param {number} m source margin as a fraction of the image's short edge
 * @param {number} [edge] destination corner size in ctx units (default: scaled from the box)
 * @returns {boolean} false while the image is still loading
 */
export function drawFrame(ctx, key, x, y, w, h, m = 0.3, edge = null) {
  const im = kitImage(key); if (!im) return false;
  const sm = Math.round(Math.min(im.width, im.height) * m), dm = Math.min(edge ?? Math.min(w, h) * m, w / 2, h / 2);
  const sx = [0, sm, im.width - sm, im.width], sy = [0, sm, im.height - sm, im.height];
  const dx = [x, x + dm, x + w - dm, x + w], dy = [y, y + dm, y + h - dm, y + h];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const sw = sx[c + 1] - sx[c], sh = sy[r + 1] - sy[r], dw = dx[c + 1] - dx[c], dh = dy[r + 1] - dy[r];
    if (sw > 0 && sh > 0 && dw > 0 && dh > 0) ctx.drawImage(im, sx[c], sy[r], sw, sh, dx[c], dy[r], dw, dh);
  }
  return true;
}
