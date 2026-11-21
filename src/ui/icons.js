// Game symbols (conditions, damage types, combat marks, stats) drawn from the painted kit (src/ui/kit.js).
//  - DOM: iconHTML(name) → an <img> sized 1.25em.
//  - Canvas: drawIcon(ctx, name, cx, cy, size) → false until the image has loaded (redraw on onIconsReady).
import { kitHas, kitUrl, kitImage, onKitLoad, drawKit, preloadKit } from './kit.js';

const SYM = ['blinded', 'charmed', 'deafened', 'exhaustion', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified',
  'poisoned', 'prone', 'restrained', 'stunned', 'unconscious', 'concentrating', 'burning', 'frozen', 'bleeding', 'dodging',
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
  'attack', 'save', 'heal', 'initiative', 'death-save', 'ac', 'hp', 'crit', 'fumble', 'miss', 'success', 'fail', 'advantage', 'disadvantage', 'inspiration'];
const STAT = ['str', 'dex', 'con', 'int', 'wis', 'cha', 'speed', 'prof', 'level', 'xp', 'passive', 'temp-hp'];

/** Logical name → kit key. Condition names match rules/combat.js CONDITIONS; damage types match effects.json. */
export const ICONS = {
  ...Object.fromEntries(SYM.map((k) => [k, `sym/${k}`])),
  ...Object.fromEntries(STAT.map((k) => [k, `stat/${k}`])),
  damage: 'sym/bleeding', d20: 'dice/d20', con: 'stat/constitution', // 'con' cannot be a file name on Windows
};

const CSS = `.gi{display:inline-block;width:1.25em;height:1.25em;vertical-align:-0.28em;margin-right:0.2em;object-fit:contain}
.gi.gi-lg{width:1.7em;height:1.7em;vertical-align:-0.45em}.gi.gi-xl{width:2.4em;height:2.4em;vertical-align:-0.7em}`;
if (typeof document !== 'undefined' && !document.getElementById('gi-css')) {
  const s = document.createElement('style'); s.id = 'gi-css'; s.textContent = CSS; document.head.appendChild(s);
}

/** Kit key for a logical name (a full "group/slug" key passes through); null when unknown. */
export function iconKey(name) { const k = ICONS[name] || name; return kitHas(k) ? k : null; }

/** DOM markup for a symbol; '' when the name is unknown. cls adds classes (gi-lg, gi-xl). */
export function iconHTML(name, cls = '') {
  const k = iconKey(name); if (!k) return '';
  return `<img class="gi ${cls}" src="${kitUrl(k)}" alt="" aria-hidden="true" draggable="false">`;
}

/** Starts loading every symbol; resolves at once (canvases redraw through onIconsReady as images arrive). */
export function iconsReady() { preloadKit(Object.values(ICONS)); return Promise.resolve(); }

/** Calls fn whenever more symbols have loaded. */
export function onIconsReady(fn) { iconsReady(); onKitLoad(fn); }

/**
 * Draws a symbol centred on (cx, cy) at size px (ctx units). Returns false while it is still loading
 * (callers keep their vector fallback and redraw on onIconsReady).
 */
export function drawIcon(ctx, name, cx, cy, size) {
  const k = iconKey(name); if (!k || !kitImage(k)) return false;
  return drawKit(ctx, k, cx - size / 2, cy - size / 2, size, size);
}
