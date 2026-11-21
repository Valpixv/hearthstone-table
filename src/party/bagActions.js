// Table actions for character sheets and bags (design/completion-plan.md §3.3, §4.6).
// Run on the DM's machine through dm.act (src/ui/actions.js EXECUTORS and the Requests fallback share this map).
// Players' own sheet and bag edits are self-serve: validated, then applied without a DM approval card.
//   sheet  – patch the character sheet            inv   – add / change / remove bag rows, coins
//   give   – hand an item to another character    build – stage-1 character building: also sets name, model, HP, AC …
//   ready  – "my character is finished"
import { defaultSheet, normalizeSheet, addItem, changeQty, removeItem, toggleEquip, editItem, transferItem, normalizeCoins, normalizeInventory } from './sheet.js';

export const BAG_TYPES = ['sheet', 'inv', 'give', 'build', 'ready'];
const SHEET_KEYS = Object.keys(defaultSheet());
const INV_OPS = ['add', 'qty', 'remove', 'equip', 'edit', 'coins'];
/** Token fields a player may set on their own character while building it (HP included: they are making the character). */
export const BUILD_FIELDS = ['name', 'model', 'maxHp', 'hp', 'ac', 'initBonus', 'speed', 'notes', 'rolls', 'custom'];

/** True for a shared loot container (an item token nobody owns): players may take from it. */
export const isContainer = (t) => !!t && t.kind === 'item' && !t.owner;
/** True while a player may still build their character freely: the table is in the lobby, or they have not pressed Ready yet. */
export const canBuild = (state, tokenId) => (state?.session?.stage || 'play') === 'lobby' || !state?.session?.ready?.[tokenId];

/**
 * Validates a bag/sheet request from a player. @returns {{ ok: boolean, error?: string }}
 * @param {object} [state] dm.state (for `build`: only allowed while the character is still being built)
 */
export function validateBag(type, p = {}, from, tokens, state = null) {
  const t = p.id != null ? tokens.find((x) => x.id === p.id) : null;
  if (!t) return { ok: false, error: 'That character is gone.' };
  if (type === 'give') {
    if (t.owner !== from && !isContainer(t)) return { ok: false, error: 'You can only give your own things.' };
    const to = tokens.find((x) => x.id === p.to);
    if (!to || !(to.kind === 'pc' || to.kind === 'item')) return { ok: false, error: 'Give it to whom?' };
    if (!(t.inventory || []).some((x) => x.id === p.itemId)) return { ok: false, error: 'That item is gone.' };
    return { ok: true };
  }
  if (t.owner !== from) return { ok: false, error: 'You can only change your own character.' };
  if (type === 'sheet') {
    const bad = Object.keys(p.patch || {}).filter((k) => !SHEET_KEYS.includes(k));
    return bad.length || !Object.keys(p.patch || {}).length ? { ok: false, error: `Not editable: ${bad.join(', ') || 'nothing'}.` } : { ok: true };
  }
  if (type === 'inv') return INV_OPS.includes(p.op) ? { ok: true } : { ok: false, error: 'Unknown bag action.' };
  if (type === 'ready') return { ok: true };
  if (type === 'build') {
    if (!canBuild(state, t.id)) return { ok: false, error: 'Your character is locked in. Ask the DM for changes to these numbers.' };
    const bad = Object.keys(p.token || {}).filter((k) => !BUILD_FIELDS.includes(k));
    return bad.length ? { ok: false, error: `Not editable: ${bad.join(', ')}.` } : { ok: true };
  }
  return { ok: false, error: 'Unknown action.' };
}

/** One-line description for logs and request cards. */
export function describeBag(type, p = {}, tokens = []) {
  const nm = (id) => tokens.find((t) => t.id === id)?.name ?? '?';
  const item = (id, itemId) => tokens.find((t) => t.id === id)?.inventory?.find((x) => x.id === itemId)?.name ?? 'item';
  if (type === 'sheet') return `Sheet: ${nm(p.id)} (${Object.keys(p.patch || {}).join(', ')})`;
  if (type === 'inv') return `Bag: ${nm(p.id)} ${p.op}${p.item?.name ? ` ${p.item.name}` : ''}`;
  if (type === 'give') return `${nm(p.id)} gives ${p.qty > 1 ? `${p.qty} × ` : ''}${item(p.id, p.itemId)} to ${nm(p.to)}`;
  if (type === 'build') return `Building ${nm(p.id)}`;
  if (type === 'ready') return `${nm(p.id)} is ${p.on === false ? 'not ready' : 'ready'}`;
  return type;
}

/** type → (dm, payload) executors. dm.tokens is the TokenManager. */
export const BAG_EXECUTORS = {
  sheet: (dm, { id, patch }) => {
    const t = dm.tokens.find(id); if (!t) return null;
    return dm.tokens.update(id, { sheet: normalizeSheet({ ...(t.sheet || defaultSheet()), ...(patch || {}) }) });
  },
  inv: (dm, { id, op, item, qty = 1, itemId, patch, coins }) => {
    const t = dm.tokens.find(id); if (!t) return null;
    const inv = t.inventory || [];
    if (op === 'coins') return dm.tokens.update(id, { coins: normalizeCoins({ ...(t.coins || {}), ...(coins || {}) }) });
    const next = op === 'add' ? addItem(inv, item, qty) : op === 'qty' ? changeQty(inv, itemId, qty)
      : op === 'remove' ? removeItem(inv, itemId) : op === 'equip' ? toggleEquip(inv, itemId) : op === 'edit' ? editItem(inv, itemId, patch || {}) : inv;
    return dm.tokens.update(id, { inventory: next });
  },
  give: (dm, { id, to, itemId, qty = 1 }) => {
    const a = dm.tokens.find(id), b = dm.tokens.find(to); if (!a || !b) return null;
    const r = transferItem(a.inventory || [], b.inventory || [], itemId, qty);
    if (!r.moved) return null;
    const name = (a.inventory || []).find((x) => x.id === itemId)?.name;
    dm.tokens.update(id, { inventory: r.from }); dm.tokens.update(to, { inventory: r.to });
    dm.logRoll?.(`${a.name} → ${b.name}: ${r.moved > 1 ? `${r.moved} × ` : ''}${name}`);
    return r;
  },
  /** Stage-1 building: token fields, the sheet, and optionally a whole new bag and purse, in one step. */
  build: (dm, { id, token = null, sheet = null, inventory = null, coins = null }) => {
    const t = dm.tokens.find(id); if (!t) return null;
    const patch = {};
    for (const k of BUILD_FIELDS) if (token && k in token) patch[k] = token[k];
    if ('maxHp' in patch && !('hp' in patch)) patch.hp = patch.maxHp; // a new maximum starts full
    if (sheet) patch.sheet = normalizeSheet({ ...(t.sheet || defaultSheet()), ...sheet });
    if (inventory) patch.inventory = normalizeInventory(inventory);
    if (coins) patch.coins = normalizeCoins(coins);
    return dm.tokens.update(id, patch);
  },
  ready: (dm, { id, on = true }) => {
    const s = (dm.state.session = dm.state.session || { stage: 'play', ready: {} });
    s.ready = { ...(s.ready || {}), [id]: !!on };
    if (!on) delete s.ready[id];
    dm.emit(); return s;
  },
};
