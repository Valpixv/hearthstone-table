// Item name → preset and icon (design/completion-plan.md D3). Pure.
// 1. exact preset id or name → its icon; 2. a preset name's words all appear in the typed name ("rusty dagger" → dagger;
// longest preset name wins); 3. a keyword that hints at a kind of thing ("troll tooth" → bone); 4. a plain sack.
// Icons are kit slugs (public/assets/kit/item/<slug>.webp); nothing is ever generated.
import ITEMS from '../data/items.json';

export const PRESETS = ITEMS.items;
/** The icon for an item nothing else matches. */
export const GENERIC_ICON = 'sack';
/** keyword → preset id whose icon stands in for that kind of thing. */
export const ICON_HINTS = ITEMS.iconHints || {};

/** Lower-case, letters/digits only, simple plural strip per word. */
export function normalizeName(name) {
  return String(name ?? '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').filter(Boolean).map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');
}

/**
 * @param {string} name typed item name
 * @param {object} [presets] id → { name, cat, icon }
 * @param {object} [hints] keyword → preset id
 * @returns {{ ref: string|null, preset: object|null, icon: { kind: 'preset', key: string } }}
 */
export function resolveItem(name, presets = PRESETS, hints = ICON_HINTS) {
  const q = normalizeName(name), generic = { ref: null, preset: null, icon: { kind: 'preset', key: GENERIC_ICON } };
  if (!q) return generic;
  const hit = (id) => ({ ref: id, preset: presets[id], icon: { kind: 'preset', key: presets[id].icon } });
  const id = q.replace(/ /g, '-');
  if (presets[id]) return hit(id);
  for (const [k, p] of Object.entries(presets)) if (normalizeName(p.name) === q) return hit(k);
  const words = new Set(q.split(' '));
  let best = null, bestLen = 0;
  for (const [k, p] of Object.entries(presets)) {
    const pw = normalizeName(p.name).split(' ');
    if (pw.every((w) => words.has(w)) && pw.join(' ').length > bestLen) { best = k; bestLen = pw.join(' ').length; }
  }
  if (best) return { ...hit(best), ref: null }; // looks like a preset, but it is the player's own named item
  for (const w of words) { const h = hints[w]; if (h && presets[h]) return { ref: null, preset: null, icon: { kind: 'preset', key: presets[h].icon } }; }
  return generic;
}

/** Preset list for pickers: [{ id, name, cat }] sorted by category then name. */
export function presetList(presets = PRESETS) {
  return Object.entries(presets).map(([id, p]) => ({ id, name: p.name, cat: p.cat })).sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));
}
