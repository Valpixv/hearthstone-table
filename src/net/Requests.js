// Player requests (design/flexibility-plan.md §5, §5b, §8). dm.act(type, payload) is the one door for table actions:
// on the DM it executes; on a player it becomes a `req` that the DM's machine validates, queues and approves / edits / denies.
import NET from './netConfig.json';
import MODELS from '../data/models.json';
import { TOKEN_CFG, parseHpExpr } from '../tokens/TokenManager.js';
import { setInitiative } from '../rules/combat.js';
import { BAG_TYPES, BAG_EXECUTORS, validateBag, describeBag } from '../party/bagActions.js';
import { canRelease } from '../combat/strikes.js';

export const NET_CFG = NET;
export const HEROES = Object.keys(MODELS.heroes || {});

/** Types a player may ask for. Everything else (combat flow, setup.*, settings, kick) is DM-only. */
export const REQUESTABLE = ['hp', 'tempHp', 'update', 'stat', 'condition', 'initiative', 'deathSave', 'move', 'spawn', 'remove', 'duplicate', 'narrate', 'scene', 'weather', 'music', 'rest', 'levelup', 'call.answer', 'strike.release', ...BAG_TYPES];
/** A player's own sheet / bag edits (and gifts, icons) apply at once: validated, no DM approval card. */
export const SELF_SERVE = new Set([...BAG_TYPES, 'call.answer', 'strike.release']);
/** Sheet fields a player may change on their own token through 'update'. A player's own HP changes go through 'hp' and apply at once. */
export const SHEET_FIELDS = ['name', 'model', 'ac', 'initBonus', 'speed', 'custom', 'rolls', 'notes'];
const OWN_ONLY = new Set(['update', 'initiative', 'deathSave', 'rest', 'levelup']);
const NEEDS_TOKEN = new Set(['hp', 'tempHp', 'update', 'stat', 'condition', 'initiative', 'deathSave', 'move', 'remove', 'duplicate', 'rest', 'levelup']);
const CORE_STATS = new Set(['name', 'ac', 'initBonus', 'speed', 'maxHp', 'hp', 'tempHp']);

/**
 * Validates a player's request on the DM's machine.
 * @param {string} type @param {object} payload @param {string} from client id @param {object[]} tokens
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateRequest(type, payload, from, tokens, state = null) {
  if (!REQUESTABLE.includes(type)) return { ok: false, error: `“${type}” is the DM's call.` };
  if (BAG_TYPES.includes(type)) return validateBag(type, payload, from, tokens, state);
  if (type === 'call.answer') {
    const c = (state?.calls || []).find((x) => x.id === payload?.id), who = c && tokens.find((x) => x.id === c.to);
    if (!c || c.status !== 'open') return { ok: false, error: 'That roll is no longer wanted.' };
    if (!who || who.owner !== from) return { ok: false, error: 'That roll was asked of someone else.' };
    return Number.isFinite(Number(payload.total)) ? { ok: true } : { ok: false, error: 'Unreadable roll.' };
  }
  if (type === 'strike.release') {
    const s = (state?.strikes || []).find((x) => x.id === payload?.id);
    return canRelease(s, from, false, tokens) ? { ok: true } : { ok: false, error: 'That strike is not yours to release.' };
  }
  const p = payload || {}, t = p.id != null ? tokens.find((x) => x.id === p.id) : null;
  if (NEEDS_TOKEN.has(type) && !t) return { ok: false, error: 'That creature is gone.' };
  if (OWN_ONLY.has(type) && t.owner !== from) return { ok: false, error: 'You can only change your own character.' };
  if (type === 'update') {
    const bad = Object.keys(p.patch || {}).filter((k) => !SHEET_FIELDS.includes(k));
    if (bad.length || !Object.keys(p.patch || {}).length) return { ok: false, error: `Not editable: ${bad.join(', ') || 'nothing'}.` };
    if ('model' in p.patch && !HEROES.includes(p.patch.model)) return { ok: false, error: 'Pick a hero model.' };
  }
  if (type === 'remove' && t.kind === 'pc' && t.owner && t.owner !== from) return { ok: false, error: 'Only the DM removes other players.' };
  if (type === 'hp' && !parseHpExpr(p.expr)) return { ok: false, error: 'Unreadable amount.' };
  if (type === 'stat' && !String(p.key ?? '').trim()) return { ok: false, error: 'Which stat?' };
  if (type === 'move' && !(Number.isFinite(p.x) && Number.isFinite(p.z))) return { ok: false, error: 'Bad position.' };
  if (type === 'spawn' && !p.def) return { ok: false, error: 'Spawn what?' };
  return { ok: true };
}

/** One-line card text: "Damage 12 → Goblin 2". */
export function describeRequest(type, p = {}, tokens = []) {
  const nm = (id) => tokens.find((t) => t.id === id)?.name ?? '?';
  if (BAG_TYPES.includes(type)) return describeBag(type, p, tokens);
  switch (type) {
    case 'hp': { const h = parseHpExpr(p.expr); if (!h) return `HP ${p.expr} → ${nm(p.id)}`;
      return `${h.op === 'temp' ? 'Temp HP' : h.op === 'set' ? 'Set HP' : h.value < 0 ? 'Damage' : 'Heal'} ${Math.abs(h.value)} → ${nm(p.id)}`; }
    case 'tempHp': return `Temp HP ${p.value} → ${nm(p.id)}`;
    case 'update': return `Edit ${nm(p.id)}: ${Object.entries(p.patch || {}).map(([k, v]) => `${k} = ${typeof v === 'object' ? '…' : v}`).join(', ')}`;
    case 'stat': return `${p.key} = ${p.value} → ${nm(p.id)}`;
    case 'condition': return `${p.on === false ? 'Remove' : 'Add'} ${p.name}${p.rounds ? ` (${p.rounds} rds)` : ''} → ${nm(p.id)}`;
    case 'initiative': return `Initiative ${p.value} for ${nm(p.id)}`;
    case 'deathSave': return `Death save ${p.d20} for ${nm(p.id)}`;
    case 'move': return `Move ${nm(p.id)}`;
    case 'spawn': return `Spawn ${p.count > 1 ? `${p.count} × ` : ''}${p.def?.name || 'creature'}`;
    case 'remove': return `Remove ${nm(p.id)}`;
    case 'duplicate': return `Duplicate ${nm(p.id)}`;
    case 'narrate': return `Narrate “${String(p.text || '').slice(0, 80)}”`;
    case 'scene': return `Scene → ${p.name}`;
    case 'weather': return `Weather ${p.kind} ${p.on === false ? 'off' : 'on'}`;
    case 'music': return `Music → ${p.name}`;
    case 'rest': return `${p.kind === 'long' ? 'Long rest' : `Short rest (+${p.heal || 0} HP)`} for ${nm(p.id)}`;
    case 'levelup': return `Level up ${nm(p.id)}`;
    case 'call.answer': return `Roll answered: ${p.total}`;
    case 'strike.release': return 'Strike released';
    default: return type;
  }
}

/** The field "Edit & approve" changes for each type (besides the target). */
export const EDIT_FIELD = { hp: 'expr', tempHp: 'value', stat: 'value', initiative: 'value', narrate: 'text', scene: 'name', music: 'name', condition: 'name', spawn: 'count', deathSave: 'd20' };

/** Health band for 'approx' visibility. */
export function hpBand(t, bands = NET.hpBands) {
  const f = t.maxHp > 0 ? t.hp / t.maxHp : 0;
  return f <= bands.critical ? 'critical' : f <= bands.bloodied ? 'bloodied' : 'healthy';
}

/**
 * DM side of auto-join: gives a joining player their PC token. Reclaims an existing PC by owner or by name (a rejoin),
 * otherwise spawns one with a hero model and the default stats. Idempotent.
 * @param {import('../tokens/TokenManager.js').TokenManager} T @param {{id, name, seat?}} player
 * @param {Set<string>} present client ids currently connected
 */
export function claimPlayerToken(T, player, present = new Set([player.id])) {
  const pcs = T.list.filter((t) => t.kind === 'pc');
  let t = pcs.find((x) => x.owner === player.id);
  const key = String(player.name || '').trim().toLowerCase();
  if (!t) t = pcs.find((x) => x.name.trim().toLowerCase() === key && (!x.owner || x.away || !present.has(x.owner)));
  if (t) { if (t.owner !== player.id || t.away) { t.owner = player.id; t.away = false; T.dm.emit(); } return t; }
  const model = HEROES.length ? HEROES[(player.seat ?? pcs.length) % HEROES.length] : TOKEN_CFG.genericModel;
  return T.spawn({ ...TOKEN_CFG.defaults, name: player.name || 'Adventurer', kind: 'pc', side: 'ally', model, owner: player.id, away: false, sheet: {}, inventory: [], coins: {} })[0];
}

/** DM side: owned PC tokens whose player is gone are marked away (kept, not deleted). Returns how many changed. */
export function markAway(T, present) {
  let n = 0;
  for (const t of T.list) if (t.kind === 'pc' && t.owner && !present.has(t.owner) && !t.away) { t.away = true; n++; }
  if (n) T.dm.emit();
  return n;
}

const actionsMod = import.meta.glob('../ui/actions.js');

/**
 * The request system. Construct once, call install(); TableSync feeds it `req` / `reqResult` messages.
 * deps: dm, send(msg), isDM(), me() → client id, name() → my name, toast(text, kind), move(id, x, z),
 * executors (optional map; otherwise EXECUTORS from src/ui/actions.js is loaded lazily, then TokenManager fallbacks), now().
 */
export class Requests {
  constructor(deps) {
    Object.assign(this, { send: () => {}, isDM: () => true, me: () => null, name: () => 'Adventurer', toast: () => {}, move: null, now: () => Date.now() }, deps);
    this.queue = []; this.mine = new Map(); this.allow = new Map(); this.listeners = []; this.seq = 0; this.lastLog = 0;
    if (this.executors === undefined) {
      this.executors = null;
      const load = actionsMod['../ui/actions.js'];
      if (load) load().then((m) => { this.executors = m.EXECUTORS || null; }).catch(() => {});
    }
  }

  /** Installs dm.act(type, payload, meta?) → DM: the executor's result; player: the request id. */
  install() { this.dm.act = (type, payload = {}, meta = {}) => this.act(type, payload, meta); return this; }
  onChange(fn) { this.listeners.push(fn); }
  changed() { for (const f of this.listeners) { try { f(this); } catch (e) { console.warn('[requests] listener', e); } } }
  get tokens() { return this.dm.state.tokens || []; }
  get settings() { const s = (this.dm.state.settings = this.dm.state.settings || {}); s.autoApprove = s.autoApprove || {}; return s; }

  act(type, payload, meta = {}) {
    if (this.isDM()) return this.execute(type, payload);
    const rid = `${this.me() || 'p'}-${++this.seq}`;
    this.mine.set(rid, { rid, type, payload, status: 'pending', label: describeRequest(type, payload, this.tokens), at: this.now(), field: meta.field ?? null });
    this.send({ t: 'req', v: NET.protocol, op: 'act', type, payload, rid, from: this.me(), roll: meta.roll ?? payload.roll ?? null });
    this.changed(); return rid;
  }

  /** Runs an action on the DM's machine: EXECUTORS from actions.js when it has the type, else the TokenManager fallback. */
  execute(type, p = {}) {
    if (type === 'move') return this.move?.(p.id, p.x, p.z);
    const ex = this.executors?.[type];
    if (ex) return ex(this.dm, p);
    return this.fallback(type, p);
  }

  fallback(type, p) {
    const dm = this.dm, T = dm.tokens, mgr = dm.combatMgr;
    if (BAG_EXECUTORS[type]) return BAG_EXECUTORS[type](dm, p);
    switch (type) {
      case 'hp': { const h = parseHpExpr(p.expr); if (!h) return false;
        if (h.op === 'delta' && mgr?.damage) return mgr.damage(p.id, -h.value, { crit: !!p.crit }) ?? true;
        if (h.op === 'delta') return T.applyHp(p.id, h.value, { crit: !!p.crit });
        return T.applyHpExpr(p.id, p.expr); }
      case 'tempHp': return T.setTempHp(p.id, p.value);
      case 'update': return T.update(p.id, p.patch || {});
      case 'stat': {
        if (CORE_STATS.has(p.key)) return T.update(p.id, { [p.key]: p.value });
        const t = T.find(p.id); if (!t) return null;
        const custom = t.custom.map((c) => ({ ...c })), c = custom.find((x) => x.key === p.key);
        if (c) c.value = p.value; else custom.push({ key: p.key, value: p.value });
        return T.update(p.id, { custom });
      }
      case 'condition': {
        const t = T.find(p.id); if (!t) return null;
        const has = t.conditions.some((k) => k.name === p.name), on = p.on ?? !has;
        if (on === has) return t;
        if (mgr?.toggleCondition) return mgr.toggleCondition(p.id, p.name, p.rounds ?? null);
        t.conditions = on ? [...t.conditions, { name: p.name, rounds: p.rounds ?? null }] : t.conditions.filter((k) => k.name !== p.name);
        dm.emit(); return t;
      }
      case 'initiative': {
        const t = T.find(p.id); if (!t) return null; const v = Number(p.value);
        if (mgr?.setInit) return mgr.setInit(p.id, v);
        if (T.combat.order.includes(p.id)) T.combatOp((c) => setInitiative(c, p.id, v)); else t.init = v;
        dm.emit(); return t;
      }
      case 'deathSave': return mgr?.deathSave ? mgr.deathSave(p.id, p.d20) : T.deathSave(p.id, p.d20);
      case 'spawn': return T.spawn(p.def, { count: p.count || 1 });
      case 'remove': return T.remove(p.id);
      case 'duplicate': return T.duplicate(p.id);
      case 'narrate': return dm.narrate(String(p.text || ''));
      case 'scene': return dm.setScene(p.name);
      case 'weather': return dm.setWeather(p.kind, p.on);
      case 'music': return dm.setMusic(p.name);
      case 'setup.save': return dm.save?.();
      case 'setup.load': return dm.load?.(p.raw ?? null);
      default: this.anomaly(`no executor for ${type}`); return null;
    }
  }

  // ---------- DM: incoming requests ----------
  /** A `req` from a player (the server stamps `from`; the player's own `from` is ignored). */
  receive(m, player = {}) {
    if (!this.isDM() || m.op !== 'act') return;
    const from = m.from, name = player.name || from;
    const v = validateRequest(m.type, m.payload, from, this.tokens, this.dm.state);
    if (!v.ok) return this.reply(from, m.rid, 'denied', { reason: v.error });
    if (this.queue.filter((r) => r.from === from).length >= NET.queueMaxPerPlayer) { this.anomaly(`queue full for ${name}`); return this.reply(from, m.rid, 'denied', { reason: 'Too many requests waiting.' }); }
    const r = { rid: m.rid, from, name, type: m.type, payload: m.payload || {}, roll: m.roll || null, at: this.now() };
    r.label = describeRequest(r.type, r.payload, this.tokens);
    // Hit points (damage, healing, temp HP), the player's own included, always wait for the DM unless the DM auto-approves them.
    if (SELF_SERVE.has(r.type) || this.settings.autoApprove[r.type] || this.allowed(from)) return this.run(r, null);
    this.queue.push(r); this.toast(`📨 ${name} asks: ${r.label}`, 'join'); this.changed();
  }

  find(rid) { return this.queue.find((r) => r.rid === rid) || null; }
  /** Approves a queued request, optionally with an edited payload ("Edit & approve"). */
  approve(rid, edited = null) { const r = this.find(rid); if (!r) return false; this.queue = this.queue.filter((x) => x !== r); this.run(r, edited); this.changed(); return true; }
  deny(rid, reason = 'The DM said no.') { const r = this.find(rid); if (!r) return false; this.queue = this.queue.filter((x) => x !== r); this.reply(r.from, rid, 'denied', { reason }); this.changed(); return true; }
  /** Approves everything queued from that player and auto-approves them until the turn changes. */
  approveAllFrom(from) { this.allow.set(from, { key: this.turnKey(), at: this.now() }); for (const r of this.queue.filter((x) => x.from === from)) this.approve(r.rid); this.changed(); }
  setAutoApprove(type, on) { this.settings.autoApprove[type] = !!on; this.dm.emit?.(); this.changed(); }

  turnKey() { const C = this.dm.state.combat || {}; return C.active ? `${C.round}:${C.turn}` : 'out'; }
  allowed(from) {
    const a = this.allow.get(from); if (!a) return false;
    const ok = a.key === this.turnKey() && (a.key !== 'out' || this.now() - a.at < NET.approveAllOutOfCombatMs);
    if (!ok) this.allow.delete(from);
    return ok;
  }

  run(r, edited) {
    const payload = edited ? { ...r.payload, ...edited } : r.payload;
    const changed = !!edited && JSON.stringify(payload) !== JSON.stringify(r.payload);
    if (changed) { const v = validateRequest(r.type, payload, r.from, this.tokens, this.dm.state); if (!v.ok && v.error !== 'You can only change your own character.') return this.reply(r.from, r.rid, 'denied', { reason: v.error }); }
    try {
      const h = r.type === 'hp' ? parseHpExpr(payload.expr) : null, by = this.tokens.find((t) => t.kind === 'pc' && t.owner === r.from);
      // Damage a player deals to someone else becomes their strike (released by their gesture); their own HP just changes.
      if (h && h.op === 'delta' && by && payload.id !== by.id && this.dm.strikes && this.dm.state.settings?.gestureRelease !== false) this.execute('strike', { by: by.id, targets: [{ id: payload.id, amount: Math.abs(h.value) }], heal: h.value > 0, crit: !!payload.crit });
      else this.execute(r.type, payload);
    } catch (e) { this.anomaly(`executor ${r.type} failed: ${e.message}`); return this.reply(r.from, r.rid, 'denied', { reason: 'It could not be done.' }); }
    this.reply(r.from, r.rid, changed ? 'edited' : 'approved', { payload, label: describeRequest(r.type, payload, this.tokens) });
  }

  reply(to, rid, status, extra = {}) { this.send({ t: 'reqResult', v: NET.protocol, to, rid, status, ...extra }); }

  // ---------- player: results ----------
  onResult(m) {
    const r = this.mine.get(m.rid); if (!r) return;
    Object.assign(r, { status: m.status, reason: m.reason ?? null, label: m.label || r.label });
    const verb = m.status === 'denied' ? `✋ Denied: ${r.label}${m.reason ? ` (${m.reason})` : ''}` : m.status === 'edited' ? `✎ The DM adjusted it: ${r.label}` : `✔ Approved: ${r.label}`;
    this.toast(verb, m.status === 'denied' ? 'leave' : 'join');
    this.onResolved?.(r, m);
    const keep = [...this.mine.values()].slice(-20); this.mine = new Map(keep.map((x) => [x.rid, x]));
    this.changed();
  }

  anomaly(msg) { const t = this.now(); if (t - this.lastLog > NET.anomalyLogEveryMs) { this.lastLog = t; console.warn(`[requests] ${msg}`); } }

  // ---------- DM inbox (#dm-requests, #dm-requests-badge) ----------
  /** Renders the queue into the ui-programmer's container. Safe without a DOM. */
  render(doc = globalThis.document) {
    if (!doc) return;
    const badge = doc.getElementById('dm-requests-badge');
    if (badge) { const n = this.queue.length; badge.textContent = n ? `${n} request${n === 1 ? '' : 's'}` : ''; badge.hidden = !n; }
    const root = doc.getElementById('dm-requests'); if (!root || !this.isDM()) return;
    injectStyle(doc);
    if (!root.dataset.wired) { root.dataset.wired = '1'; root.addEventListener('click', (e) => this.onClick(e, root)); root.addEventListener('change', (e) => { const a = e.target.dataset.auto; if (a) this.setAutoApprove(a, e.target.checked); }); }
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    const opts = (sel) => this.tokens.map((t) => `<option value="${esc(t.id)}"${t.id === sel ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
    const cards = this.queue.map((r) => {
      const f = EDIT_FIELD[r.type];
      return `<div class="req-card" data-rid="${esc(r.rid)}"><div><b>${esc(r.name)}</b> asks: <strong>${esc(r.label)}</strong></div>
        ${r.roll ? `<small class="req-roll">🎲 ${esc(r.roll)}</small>` : ''}
        <div class="req-edit" hidden>${r.payload.id != null ? `<select data-f="id">${opts(r.payload.id)}</select>` : ''}${f ? `<input data-f="${f}" value="${esc(r.payload[f])}">` : ''}<button data-a="apply">Apply</button></div>
        <div class="req-btns"><button data-a="approve">Approve</button><button data-a="edit">Edit &amp; approve</button><button data-a="deny">Deny</button><button data-a="all" title="Approve everything from ${esc(r.name)} until the turn changes">All from ${esc(r.name)} this turn</button></div></div>`;
    }).join('') || '<p class="hint">No requests.</p>';
    const auto = REQUESTABLE.filter((t) => !SELF_SERVE.has(t)).map((t) => `<label><input type="checkbox" data-auto="${t}"${this.settings.autoApprove[t] ? ' checked' : ''}> ${t}</label>`).join('');
    root.innerHTML = `${cards}<details class="req-auto"><summary>Auto-approve</summary>${auto}</details>`;
  }

  onClick(e, root) {
    const a = e.target.dataset?.a; if (!a) return;
    const card = e.target.closest('.req-card'), rid = card?.dataset.rid, r = rid && this.find(rid); if (!r) return;
    if (a === 'approve') this.approve(rid);
    else if (a === 'deny') this.deny(rid);
    else if (a === 'all') this.approveAllFrom(r.from);
    else if (a === 'edit') card.querySelector('.req-edit').hidden = false;
    else if (a === 'apply') {
      const ed = {};
      for (const el of card.querySelectorAll('.req-edit [data-f]')) ed[el.dataset.f] = ['count', 'value', 'd20'].includes(el.dataset.f) && r.type !== 'stat' && el.value !== '' && Number.isFinite(Number(el.value)) ? Number(el.value) : el.value;
      this.approve(rid, ed);
    }
    this.render(root.ownerDocument);
  }
}

function injectStyle(doc) {
  if (doc.getElementById('req-style')) return;
  const s = doc.createElement('style'); s.id = 'req-style';
  s.textContent = `.req-card{border:1px solid #6b4a1f;border-radius:8px;padding:6px 8px;margin:6px 0;background:rgba(26,8,2,.55);font-size:13px}
.req-card .req-roll{display:block;opacity:.8;margin:2px 0}.req-btns,.req-edit{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.req-edit input,.req-edit select{min-width:0;flex:1}.req-auto label{display:inline-block;margin:2px 8px 2px 0;font-size:12px}`;
  doc.head.appendChild(s);
}
