// Every mutating UI action goes through dm.act(type, payload) (design/flexibility-plan.md §5b).
// src/net/Requests.js installs the real dm.act (local on the DM, a DM-approval request on a player).
// Until then installActions() puts in a local fallback. EXECUTORS is exported so Requests.js can reuse it.
import { parseHpExpr } from '../rules/dicePool.js';
import { BAG_EXECUTORS } from '../party/bagActions.js';
import { makeCalls, answerCall, makeStrike } from '../combat/strikes.js';
import { normalizeSheet, defaultSheet, longRest, hitDiceLeft, levelUp, splitCoins, normalizeCoins, COINS } from '../party/sheet.js';

const SETUPS_KEY = 'hearthstone-setups';
const uid = (p) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e5).toString(36)}`;

/** HTML-escape user text. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** True when a custom stat value starts with a number ("12", "3/3", "+5"), so it gets +/− buttons. */
export const isNumericStat = (v) => typeof v === 'number' || /^\s*[+-]?\d+/.test(String(v ?? ''));

/**
 * Changes the leading number of a custom stat value, keeping the rest ("3/3" − 1 → "2/3", "+5" + 1 → "+6").
 * @param {string|number} value
 * @param {'+'|'-'|'='} op
 * @param {number} n
 */
export function bumpStat(value, op, n) {
  const m = String(value ?? '').match(/^\s*([+-]?)(\d+)([\s\S]*)$/);
  const cur = m ? (m[1] === '-' ? -1 : 1) * Number(m[2]) : 0, rest = m ? m[3] : '';
  const v = op === '=' ? n : op === '-' ? cur - n : cur + n;
  if (typeof value === 'number' || (m && !rest && !m[1])) return v;
  return `${m && m[1] === '+' && v >= 0 ? '+' : ''}${v}${rest}`;
}

/** The saved setups list (dm.state.setups), seeded from localStorage on first use. */
export function setupsOf(dm) {
  if (!Array.isArray(dm.state.setups)) {
    let s = []; try { s = JSON.parse(localStorage.getItem(SETUPS_KEY)) || []; } catch { s = []; }
    dm.state.setups = Array.isArray(s) ? s : [];
  }
  return dm.state.setups;
}
function persistSetups(dm) { try { localStorage.setItem(SETUPS_KEY, JSON.stringify(setupsOf(dm))); } catch (e) { console.warn('[setups] not saved', e); } }

/** Runs dm.load keeping what a load must not roll back (My creatures, setups, settings, role, the Forge library). */
function loadKeeping(dm, raw) {
  const keep = { savedDefs: dm.state.savedDefs, setups: setupsOf(dm), settings: dm.state.settings, role: dm.state.role };
  const lib = dm.state.forge?.library || [];
  const ok = dm.load(raw);
  Object.assign(dm.state, keep);
  if (dm.state.forge) { const ids = new Set((dm.state.forge.library || []).map((e) => e.id)); dm.state.forge.library = [...(dm.state.forge.library || []), ...lib.filter((e) => !ids.has(e.id))]; }
  dm.emit();
  return ok;
}

/** Applies an HP field entry ('-7', '+3', '=25', '12', '+5 temp'). Throws on unreadable input. */
function applyHp(dm, id, expr) {
  const p = parseHpExpr(expr), T = dm.tokens;
  if (!T.find(id)) return null;
  if (p.op === 'temp') T.setTempHp(id, p.value);
  else if (p.op === 'set') T.setHp(id, p.value);
  else if (dm.combatMgr) dm.combatMgr.damage(id, -p.value); // keeps the down / stand-up animations
  else T.applyHp(id, p.value);
  return T.find(id);
}

/**
 * Executor map: type → (dm, payload) => result. Shared by the local fallback and src/net/Requests.js.
 * Required: hp, tempHp, update, stat, condition, initiative, spawn, remove, duplicate, narrate, scene, weather, music,
 * setup.save, setup.load. The rest are extra DM-state actions the dock uses.
 */
export const EXECUTORS = {
  hp: (dm, { id, expr }) => applyHp(dm, id, expr),
  tempHp: (dm, { id, value }) => dm.tokens.setTempHp(id, value),
  update: (dm, { id, patch }) => dm.tokens.update(id, patch || {}),
  stat: (dm, { id, key, value }) => {
    const t = dm.tokens.find(id); if (!t) return null;
    const custom = t.custom.map((c) => ({ ...c })), c = custom.find((x) => x.key === key);
    if (c) c.value = value; else custom.push({ key, value });
    return dm.tokens.update(id, { custom });
  },
  condition: (dm, { id, name, on = null, rounds = null }) => {
    const t = dm.tokens.find(id); if (!t) return null;
    const has = t.conditions.some((k) => k.name === name);
    if ((on ?? !has) !== has) dm.combatMgr.toggleCondition(id, name, rounds);
    return t;
  },
  initiative: (dm, { id, value }) => dm.combatMgr.setInit(id, value),
  spawn: (dm, { def, count = 1 }) => dm.tokens.spawn(def, { count }),
  remove: (dm, { id }) => dm.tokens.remove(id),
  duplicate: (dm, { id }) => dm.tokens.duplicate(id),
  narrate: (dm, { text }) => dm.narrate(String(text || '')),
  scene: (dm, { name }) => dm.setScene(name),
  weather: (dm, { kind, on = null }) => (kind === 'lightning' ? dm.lightning() : dm.setWeather(kind, on ?? !dm.state.weather[kind])),
  music: (dm, { name }) => dm.setMusic(name),
  'setup.save': (dm, { name = '' } = {}) => {
    const data = JSON.parse(dm.serialize());
    for (const k of ['setups', 'rollLog', 'secretRolls', 'role', 'savedDefs', 'narration', 'settings']) delete data[k];
    if (data.forge) delete data.forge.library; // the library is global, not part of a setup
    const list = setupsOf(dm), s = { id: uid('s'), name: String(name).trim() || `Setup ${list.length + 1}`, at: new Date().toLocaleString(), data };
    list.unshift(s); persistSetups(dm); dm.emit(); return s;
  },
  'setup.load': (dm, { id }) => { const s = setupsOf(dm).find((x) => x.id === id); return s ? loadKeeping(dm, JSON.parse(JSON.stringify(s.data))) : false; },
  'setup.delete': (dm, { id }) => { dm.state.setups = setupsOf(dm).filter((x) => x.id !== id); persistSetups(dm); dm.emit(); },
  'session.save': (dm) => dm.save(),
  'session.load': (dm) => loadKeeping(dm, null),
  settings: (dm, { patch }) => { dm.state.settings = { ...dm.state.settings, ...patch }; dm.emit(); return dm.state.settings; },
  lighting: (dm, { key, value }) => dm.setLighting(key, value),
  combat: (dm, { op }) => ({ start: () => dm.combatMgr.start(), next: () => dm.combatMgr.next(), end: () => dm.combatMgr.end() }[op]?.()),
  reorder: (dm, { from, to }) => dm.combatMgr.reorder(from, to),
  deathSaves: (dm, { id, kind, delta }) => dm.combatMgr.adjustDeathSaves(id, kind, delta),
  deathSave: (dm, { id, d20 }) => { const r = dm.combatMgr.deathSave(id, d20); dm.emit(); return r; },
  saveDef: (dm, { def }) => {
    const d = JSON.parse(JSON.stringify(def)); d.defId = d.defId || uid('d'); delete d.id;
    dm.state.savedDefs = [...(dm.state.savedDefs || []).filter((x) => x.defId !== d.defId), d]; dm.emit(); return d;
  },
  deleteDef: (dm, { defId }) => { dm.state.savedDefs = (dm.state.savedDefs || []).filter((x) => x.defId !== defId); dm.emit(); },
  map: (dm, { op }) => ({ fog: () => dm.setFogOfWar(), fogPaint: () => dm.toggleFogPaint() }[op]?.()),
  sfx: (dm, { name }) => dm.sfx(name),
  // ---- session stages (design/completion-plan.md §3.3) ----
  session: (dm, { stage }) => {
    const s = (dm.state.session = dm.state.session || { stage: 'play', ready: {} });
    if (stage !== 'lobby' && stage !== 'play') throw new Error('Unknown stage');
    if (s.stage !== stage) { s.stage = stage; dm.narrate(stage === 'play' ? 'The adventure begins.' : 'Back to the character table.'); }
    dm.emit(); return s;
  },
  // ---- the action loop: call → roll → confirm → gesture (design/completion-plan.md §7) ----
  call: (dm, p) => { const made = makeCalls(dm.state.tokens || [], p); dm.state.calls = [...(dm.state.calls || []), ...made].slice(-40); dm.emit(); return made; },
  'call.cancel': (dm, { id }) => { dm.state.calls = (dm.state.calls || []).filter((c) => c.id !== id); dm.emit(); },
  'call.resolve': (dm, { id }) => { dm.state.calls = (dm.state.calls || []).filter((c) => c.id !== id); dm.emit(); },
  'call.answer': (dm, { id, total, nat = null, text = '' }) => {
    const before = (dm.state.calls || []).find((c) => c.id === id); if (!before || before.status !== 'open') return null;
    dm.state.calls = answerCall(dm.state.calls, id, { total, nat, text }, dm.state.tokens || [], dm.state.settings?.rulesAssist !== false);
    const c = dm.state.calls.find((x) => x.id === id), who = dm.tokens.find(c.to);
    // Rolls that only set a number resolve on their own; everything else waits for the DM's confirm card.
    if (c.kind === 'init') { dm.combatMgr?.setInit(c.to, c.result.total); dm.state.calls = dm.state.calls.filter((x) => x.id !== id); }
    else if (c.kind === 'death') { dm.combatMgr?.deathSave(c.to, nat ?? c.result.total); dm.state.calls = dm.state.calls.filter((x) => x.id !== id); }
    dm.logRoll?.(`${who?.name || 'Someone'} · ${c.label}: ${c.result.total}${c.result.verdict.text ? ' · ' + c.result.verdict.text : ''}`);
    dm.emit(); return c;
  },
  strike: (dm, p) => { const s = makeStrike(p); if (!s) throw new Error('Pick at least one target'); dm.state.strikes = [...(dm.state.strikes || []), s].slice(-20); dm.emit(); dm.strikes?.onArmed?.(s); return s; },
  'strike.cancel': (dm, { id }) => { dm.state.strikes = (dm.state.strikes || []).filter((s) => s.id !== id); dm.emit(); },
  'strike.now': (dm, { id }) => dm.strikes?.resolve(id),
  'strike.release': (dm, p) => dm.strikes?.release(p),
  // ---- rests and experience ----
  rest: (dm, { id, kind, heal = 0 }) => {
    const t = dm.tokens.find(id); if (!t) return null;
    const s = normalizeSheet(t.sheet || defaultSheet());
    if (kind === 'long') {
      dm.tokens.update(id, { sheet: longRest(s), hp: t.maxHp, tempHp: 0, deathSaves: null });
      dm.logRoll?.(`${t.name} finishes a long rest.`);
    } else {
      if (hitDiceLeft(s) <= 0) throw new Error(`${t.name} has no hit dice left`);
      dm.tokens.update(id, { sheet: { ...s, hitDice: { ...s.hitDice, spent: s.hitDice.spent + 1 } } });
      if (heal > 0) applyHp(dm, id, `+${Math.floor(heal)}`);
      dm.logRoll?.(`${t.name} spends a hit die: +${Math.floor(heal)} HP.`);
    }
    dm.emit(); return dm.tokens.find(id);
  },
  levelup: (dm, { id, rolled = null }) => {
    const t = dm.tokens.find(id); if (!t) return null;
    const r = levelUp(t.sheet || defaultSheet(), { rolled }); if (!r) throw new Error(`${t.name} is already level 20`);
    dm.tokens.update(id, { sheet: r.sheet, maxHp: t.maxHp + r.hpGain, hp: t.hp + r.hpGain });
    dm.narrate(`${t.name} reaches level ${r.sheet.level}!`);
    return dm.tokens.find(id);
  },
  /** Party loot: coins are shared evenly among the player characters; what does not divide stays with the DM to hand out. */
  'loot.split': (dm, { coins }) => {
    const pcs = (dm.state.tokens || []).filter((t) => t.kind === 'pc'); if (!pcs.length) throw new Error('No player characters to share with');
    const { share, rest } = splitCoins(coins, pcs.length);
    for (const t of pcs) { const c = normalizeCoins(t.coins || {}); for (const k of COINS) c[k] += share[k] || 0; dm.tokens.update(t.id, { coins: c }); }
    const txt = (o) => COINS.filter((k) => o[k]).map((k) => `${o[k]} ${k}`).join(', ');
    dm.logRoll?.(`Loot: ${txt(share) || 'nothing'} each${txt(rest) ? ` · ${txt(rest)} left over` : ''}`);
    dm.emit(); return { share, rest };
  },
  xp: (dm, { amount, ids = null }) => {
    const n = Math.floor(Number(amount)) || 0, pcs = (dm.state.tokens || []).filter((t) => t.kind === 'pc' && (!ids || ids.includes(t.id)));
    for (const t of pcs) dm.tokens.update(t.id, { sheet: normalizeSheet({ ...(t.sheet || defaultSheet()), xp: (t.sheet?.xp || 0) + n }) });
    if (n && pcs.length) dm.narrate(`${n} XP each.`);
    return pcs.length;
  },
  ...BAG_EXECUTORS, // sheet, inv, give, icon (design/feature-expansion-plan.md §2, §3)
};

/** Runs an action locally. @returns the executor's result. @throws on an unknown type or a bad payload. */
export function localExecute(dm, type, payload = {}) {
  const f = EXECUTORS[type];
  if (!f) throw new Error(`Unknown action: ${type}`);
  return f(dm, payload || {});
}

/** Installs the local fallback dm.act unless Requests.js already installed the real one. */
export function installActions(dm) {
  dm.act ??= (type, p) => localExecute(dm, type, p);
  setupsOf(dm);
  return dm.act;
}

/** dm.act with the error shown as a toast instead of thrown. @returns {boolean} true when it ran without an error */
export function act(dm, type, payload) {
  try { dm.act(type, payload); return true; } catch (e) { console.warn('[act]', type, e); (dm.toast || dm.narrate)?.call(dm, '⚠ ' + e.message); return false; }
}

/** True while focus is in a text field inside root (re-rendering it would eat the typing). */
export function typingIn(root) {
  const a = document.activeElement;
  return !!(a && root?.contains(a) && a.matches('input:not([type=checkbox]):not([type=radio]),select,textarea'));
}
