// The dice tray (design/flexibility-plan.md §4a): bottom HUD, the same for the DM and players.
// Build any pool (click dice / type it), modifier, keep all/highest/lowest, secret, label, physical vs instant,
// saved-roll chips, history (last 50) and an editable result card whose actions all go through dm.act.
import * as P from '../rules/dicePool.js';
import { random } from '../core/random.js';
import { esc, act, typingIn, bumpStat } from './actions.js';
import { kitIcon, closeIcon, glyph } from './kit.js';

const SIDES = [4, 6, 8, 10, 12, 20, 100];
const PHYS = [4, 6, 8, 10, 12, 20];
/** Only the standard set can be rolled: a d7 or d9 has no die on the table. Throws a readable error otherwise. */
export function standardOnly(pool) {
  const odd = [...new Set(pool.groups.map((g) => g.sides).filter((n) => !SIDES.includes(n)))];
  if (odd.length) throw new Error(`Only standard dice: d4, d6, d8, d10, d12, d20 and d100 (not ${odd.map((n) => `d${n}`).join(', ')}).`);
  return pool;
}
const MY_ROLLS_KEY = 'hearthstone-myrolls';
const HISTORY_MAX = 50;
const TAGS = { none: 'No tag', attack: 'Attack vs Defense', save: 'Save vs DC', damage: 'Damage', death: 'Death save' };
const sign = (n) => (n >= 0 ? `+ ${n}` : `− ${-n}`);
const face = (sides) => 1 + Math.floor(random() * sides);
const EMPTY = () => ({ groups: [], mod: 0 });

export class DiceTray {
  /** @param {{ dm: object, rolls: object, who?: () => string }} deps */
  constructor({ dm, rolls, who = () => (dm.isDM ? 'DM' : 'Player') }) {
    Object.assign(this, { dm, rolls, who });
    this.pool = EMPTY(); this.label = ''; this.secret = false; this.physical = true;
    this.tag = 'none'; this.targetId = ''; this.dc = '';
    this.history = []; this.card = null; this.pick = null; this.selDie = null; this.addOpen = false; this.modOpen = false;
    this.focusTokenId = null; this.onHistory = null; this.errMsg = '';
    try { this.myRolls = JSON.parse(localStorage.getItem(MY_ROLLS_KEY)) || []; } catch { this.myRolls = []; }
    const el = (this.el = document.createElement('div'));
    el.id = 'dice-tray'; el.setAttribute('aria-label', 'Dice tray');
    el.innerHTML = `
      <div id="dt-card" class="dt-card" hidden aria-live="polite"></div>
      <div class="dt-top"><span id="dt-chips" class="dt-chips"></span><button id="dt-hist-btn" class="small ghost">History ▾</button></div>
      <div id="dt-hist" class="dt-hist" hidden></div>
      <div class="dt-row">${SIDES.map((s) => `<button class="dt-die" data-sides="${s}" title="Click: add a d${s} · right-click or shift-click: remove one">${kitIcon(`dice/d${s}`, { cls: 'dt-ic' })}<span class="sr-only">d${s}</span><i></i></button>`).join('')}

        <span class="dt-mod">mod <button class="small" data-mod="-1" title="Modifier −1" aria-label="Modifier minus one">${glyph('ctl/minus')}</button><input id="dt-mod" type="number" value="0" title="Modifier"/><button class="small" data-mod="1" title="Modifier +1" aria-label="Modifier plus one">${glyph('ctl/plus')}</button></span>
        <button id="dt-clear" class="small ghost" title="Empty the pool">Clear</button></div>
      <div class="dt-row"><input id="dt-expr" class="dt-expr" placeholder="Type a roll: 1d20 + 2d6 + 3 · 4d6kh3 · d100" autocomplete="off"/>
        <label title="Keep all dice, or only the highest / lowest N of the first group">keep <select id="dt-keep"><option value="all">all</option><option value="h">highest</option><option value="l">lowest</option></select></label><input id="dt-keepn" type="number" min="1" value="1" hidden title="How many to keep"/>
        <label title="Only you and the DM see the result"><input type="checkbox" id="dt-secret"/> ${kitIcon('dice/secret-lock', { cls: 'state-mark' })} secret</label><button id="dt-roll" class="kimg sm" aria-label="Roll" title="Roll">${kitIcon('dice/roll')}</button></div>
      <div class="dt-row"><input id="dt-label" placeholder="Label (e.g. Axe swing)" autocomplete="off"/>
        <span class="dt-as">roll as <label><input type="radio" name="dt-as" value="physical" checked/> ${kitIcon('dice/physical-hand', { cls: 'state-mark' })} physical dice</label><label><input type="radio" name="dt-as" value="instant"/> ${kitIcon('dice/instant-bolt', { cls: 'state-mark' })} instant</label></span>
        <span id="dt-tagbox" class="dt-tagbox">tag <select id="dt-tag">${Object.entries(TAGS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><select id="dt-target" hidden title="Target"></select><input id="dt-dc" type="number" placeholder="DC" hidden title="Difficulty"/></span>
        <button id="dt-star" class="small" title="Save this pool as a chip">★ Save</button></div>
      <div id="dt-saveform" class="dt-row" hidden>Save as <input id="dt-savename" placeholder="Name" autocomplete="off"/> on <select id="dt-saveto"></select><button id="dt-saveok" class="small btn">Save</button><button id="dt-savecancel" class="small ghost">Cancel</button></div>
      <div id="dt-err" class="dt-err" role="alert" hidden></div>`;
    document.getElementById('hud').appendChild(el);
    this.$ = (id) => el.querySelector('#' + id);
    this.bind();
    dm.on(() => this.refresh());
    this.syncControls(); this.syncTag(); this.refresh();
  }

  get rulesOn() { return this.dm.state.settings?.rulesAssist !== false; }
  err(msg) { this.errMsg = msg || ''; const e = this.$('dt-err'); e.textContent = this.errMsg; e.hidden = !this.errMsg; }
  persistMy() { try { localStorage.setItem(MY_ROLLS_KEY, JSON.stringify(this.myRolls)); } catch { /* storage unavailable */ } }

  bind() {
    const $ = this.$, el = this.el;
    el.querySelectorAll('[data-sides]').forEach((b) => {
      const s = Number(b.dataset.sides);
      b.onclick = (e) => (e.shiftKey ? this.removeDie(s) : this.addDie(s));
      b.oncontextmenu = (e) => { e.preventDefault(); this.removeDie(s); };
    });
    el.querySelectorAll('[data-mod]').forEach((b) => { b.onclick = () => this.setPool(P.setMod(this.pool, this.pool.mod + Number(b.dataset.mod))); });
    $('dt-mod').onchange = () => this.setPool(P.setMod(this.pool, Number($('dt-mod').value) || 0));
    $('dt-expr').onchange = () => this.readExpr();
    $('dt-expr').onkeydown = (e) => { if (e.key === 'Enter') { this.readExpr(); if (!this.errMsg) this.roll(); } };
    $('dt-keep').onchange = () => this.applyKeep();
    $('dt-keepn').onchange = () => this.applyKeep();
    $('dt-secret').onchange = () => { this.secret = $('dt-secret').checked; };
    $('dt-label').oninput = () => { this.label = $('dt-label').value; };
    el.querySelectorAll('input[name=dt-as]').forEach((r) => { r.onchange = () => { this.physical = el.querySelector('input[name=dt-as]:checked').value === 'physical'; }; });
    $('dt-tag').onchange = () => { this.tag = $('dt-tag').value; this.syncTag(); };
    $('dt-target').onchange = () => { this.targetId = $('dt-target').value; };
    $('dt-dc').oninput = () => { this.dc = $('dt-dc').value; };
    $('dt-roll').onclick = () => this.roll();
    $('dt-clear').onclick = () => this.setPool(EMPTY());
    $('dt-hist-btn').onclick = () => { $('dt-hist').hidden = !$('dt-hist').hidden; this.renderHistory(); };
    $('dt-hist').onclick = (e) => { const li = e.target.closest('[data-h]'); const h = li && this.history[Number(li.dataset.h)]; if (h) { this.loadExpr(h.expr, h.label); $('dt-hist').hidden = true; } };
    $('dt-star').onclick = () => { $('dt-saveform').hidden = false; $('dt-savename').value = this.label; this.renderSaveTo(); $('dt-savename').focus(); };
    $('dt-savecancel').onclick = () => { $('dt-saveform').hidden = true; };
    $('dt-saveok').onclick = () => this.saveRoll();
    $('dt-savename').onkeydown = (e) => { if (e.key === 'Enter') this.saveRoll(); };
    $('dt-chips').onclick = (e) => {
      const c = e.target.closest('[data-chip]'); const r = c && this.chipRoll(c.dataset.chip); if (!r) return;
      this.loadExpr(r.expr, r.name); if (e.shiftKey && !this.errMsg) this.roll();
    };
    $('dt-chips').oncontextmenu = (e) => {
      const c = e.target.closest('[data-chip^="my:"]'); if (!c) return;
      e.preventDefault(); this.myRolls.splice(Number(c.dataset.chip.slice(3)), 1); this.persistMy(); this.renderChips();
    };
    const card = $('dt-card');
    card.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) this.cardAction(b.dataset.c, b.dataset); });
    card.addEventListener('input', (e) => {
      const i = e.target.closest('[data-pamt]'); if (!i || !this.pick) return;
      const t = this.pick.targets.find((x) => x.id === i.dataset.pamt); if (t) t.amount = i.value;
    });
    card.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (e.target.id === 'dt-setv') this.cardAction('set'); else if (e.target.id === 'dt-modv') this.cardAction('modok');
    });
  }

  // ---------- pool ----------
  setPool(p) { this.pool = p; this.err(''); this.syncControls(); }
  addDie(s) { try { if (!SIDES.includes(s)) throw new Error('Only standard dice: d4, d6, d8, d10, d12, d20 and d100.'); this.setPool(P.add(this.pool, s)); } catch (e) { this.err(e.message); } }
  removeDie(s) { this.setPool(P.removeDie(this.pool, s)); }
  readExpr() {
    const v = this.$('dt-expr').value.trim();
    try { this.pool = v ? standardOnly(P.parse(v)) : EMPTY(); this.err(''); this.syncControls(false); } catch (e) { this.err(e.message); }
  }
  /** Loads an expression (saved roll, history, editor) into the tray. */
  loadExpr(expr, label = '') {
    try { this.pool = standardOnly(P.parse(expr)); this.err(''); } catch (e) { this.err(e.message); return; }
    this.label = label || ''; this.$('dt-label').value = this.label; this.syncControls();
  }
  applyKeep() {
    const mode = this.$('dt-keep').value, n = Math.max(1, Math.floor(Number(this.$('dt-keepn').value)) || 1);
    if (!this.pool.groups.length) { this.syncControls(); return; }
    const groups = this.pool.groups.map((g, i) => (i === 0 ? { ...g, keep: mode === 'all' ? null : { mode, n: Math.min(n, g.count) } } : g));
    this.setPool({ ...this.pool, groups });
  }
  syncControls(expr = true) {
    const $ = this.$, counts = {};
    for (const g of this.pool.groups) counts[g.sides] = (counts[g.sides] || 0) + g.count;
    this.el.querySelectorAll('[data-sides]').forEach((b) => { const n = counts[b.dataset.sides] || 0; b.querySelector('i').textContent = n || ''; b.classList.toggle('has', n > 0); });
    if (expr && document.activeElement !== $('dt-expr')) $('dt-expr').value = this.pool.groups.length || this.pool.mod ? P.toExpr(this.pool) : '';
    if (document.activeElement !== $('dt-mod')) $('dt-mod').value = this.pool.mod;
    const k = this.pool.groups[0]?.keep;
    if (k) { $('dt-keep').value = k.mode; $('dt-keepn').value = k.n; } else if ($('dt-keep').value !== 'all' && this.pool.groups.length) $('dt-keep').value = 'all';
    $('dt-keepn').hidden = $('dt-keep').value === 'all';
  }
  syncTag() {
    const $ = this.$;
    $('dt-tagbox').hidden = !this.rulesOn;
    $('dt-target').hidden = !(this.tag === 'attack' || this.tag === 'death');
    $('dt-dc').hidden = this.tag !== 'save';
    this.renderTargets();
  }

  // ---------- rolling ----------
  roll(callId = null) {
    if (!this.pool.groups.length) { this.err('Add some dice first (click a die or type 1d20 + 3)'); return; }
    const pool = { ...this.pool, label: this.label, secret: this.secret };
    const ctx = { callId, who: this.who(), label: this.label, secret: this.secret, tag: this.rulesOn ? this.tag : 'none', targetId: this.targetId, dc: this.dc };
    this.$('dt-hist').hidden = true;
    if (this.physical && this.rolls && !this.rolls.dice?.locked) { this.card = { ...ctx, rolling: true, expr: P.toExpr(pool) }; this.pick = null; this.renderCard(); }
    const done = (r) => this.showRoll(r, ctx);
    try {
      if (this.rolls) this.rolls.rollPool(pool, { physical: this.physical, secret: this.secret, onDone: done });
      else done(P.roll(pool, random));
    } catch (e) { this.err(e.message); }
  }

  /** Shows a finished roll on the card, adds it to the history and announces it (unless secret). */
  showRoll(r, ctx = {}) {
    const c = { who: this.who(), label: '', secret: false, tag: 'none', targetId: '', dc: '', ...ctx };
    this.card = { ...c, roll: r }; this.pick = null; this.selDie = null; this.addOpen = false; this.modOpen = false;
    this.history.unshift({ who: c.who, expr: r.expr, label: c.label || r.label || '', total: r.total, secret: c.secret });
    this.history.length = Math.min(this.history.length, HISTORY_MAX);
    this.announce(this.card);
    this.renderCard(); this.renderHistory(); this.onHistory?.();
    try { this.onResult?.(this.card); } catch (e) { console.warn('[tray] onResult', e); }
  }

  announce(card) {
    const r = card.roll, dice = r.dice.map((d) => (d.dropped ? `(${d.value})` : d.value)).join(', ');
    const text = `${card.label || r.label || r.expr}: [${dice}]${r.mod ? ' ' + sign(r.mod) : ''} = ${r.total}`;
    if (card.secret) { if (this.dm.isDM) this.dm.addSecret?.(card.label || r.expr, r.total); }
    else {
      this.dm.logRoll?.(`${card.who} · ${text}`);
      const li = document.createElement('li'); li.textContent = `${card.who}: ${text}`;
      const list = document.getElementById('log-list'); if (list) { list.prepend(li); while (list.children.length > 12) list.lastChild.remove(); }
    }
    this.rolls?.onAnnounce?.({ who: card.who, text: card.secret ? `${card.who} rolled secretly` : text, secret: card.secret, roll: r });
  }

  // ---------- result card ----------
  verdictOf(c) {
    if (c.tag === 'none' || !this.rulesOn) return null;
    const tok = this.dm.tokens?.find(c.targetId);
    const target = c.tag === 'attack' ? tok?.ac ?? null : c.tag === 'save' && c.dc !== '' ? Number(c.dc) : null;
    try { return P.verdict(c.roll, { tag: c.tag, target }); } catch (e) { return { text: e.message }; }
  }

  renderCard() {
    const box = this.$('dt-card'), c = this.card;
    box.hidden = !c; if (!c) return;
    if (c.rolling) {
      box.innerHTML = `<div class="dt-card-h"><b>${esc(c.label || c.expr)}</b><small>— ${esc(c.who)}</small><span class="dt-total">…</span><button aria-label="Dismiss" class="small ghost" data-c="close" title="Dismiss">${closeIcon()}</button></div><p class="hint">The dice are rolling…</p>`;
      return;
    }
    const r = c.roll, tok = this.dm.tokens?.find(c.targetId), sel = r.dice.find((d) => d.id === this.selDie), v = this.verdictOf(c);
    const vcls = !v ? '' : v.crit || v.outcome === 'regain' ? 'crit' : v.success === true || v.outcome === 'success' ? 'good' : v.success === false || v.outcome === 'fail' || v.fumble ? 'bad' : '';
    const vs = c.tag === 'attack' && tok ? ` vs ${esc(tok.name)} (Defense ${tok.ac})` : c.tag === 'save' && c.dc !== '' ? ` vs DC ${esc(c.dc)}` : '';
    box.innerHTML = `
      <div class="dt-card-h"><b>${esc(c.label || r.label || r.expr)}</b><small>— ${esc(c.who)}${c.secret ? ' · 🔒 secret' : ''}</small><span class="dt-total" title="Total">${r.total}</span><button aria-label="Dismiss" class="small ghost" data-c="close" title="Dismiss">${closeIcon()}</button></div>
      <div class="dt-dice">${r.dice.map((d) => `<button class="dt-face ${d.dropped ? 'dropped' : ''} ${d.id === this.selDie ? 'on' : ''}" data-c="die" data-id="${d.id}" title="d${d.sides} · ${d.source}${d.dropped ? ' · dropped' : ''} · tap: reroll, drop or set"><small>d${d.sides}</small>${d.value}</button>`).join('')}${r.mod ? `<span class="dt-modv">${sign(r.mod)}</span>` : ''}</div>
      ${sel ? `<div class="dt-sub">d${sel.sides} showing ${sel.value}: <button class="small" data-c="reroll">↻ Reroll</button><button class="small" data-c="drop">${sel.manualDrop ? 'Undrop' : 'Drop'}</button> set <input id="dt-setv" type="number" min="1" max="${sel.sides}" value="${sel.value}"/><button class="small" data-c="set">✔</button></div>` : ''}
      ${v ? `<div class="dt-verdict ${vcls}">${esc(TAGS[c.tag])}${vs}: <b>${esc(v.text)}</b></div>` : ''}
      <div class="dt-acts"><button class="small" data-c="damage">Damage →</button><button class="small" data-c="heal">Heal →</button><button class="small" data-c="init">Initiative →</button><button class="small" data-c="stat">Stat →</button>
        ${c.tag === 'death' && v && tok ? `<button class="small btn" data-c="death">Record on ${esc(tok.name)}</button>` : ''}
        <button class="small ghost" data-c="add">+ add die</button><button class="small ghost" data-c="mod">edit mod</button></div>
      ${this.addOpen ? `<div class="dt-sub">Add a die: ${PHYS.map((s) => `<button class="small" data-c="adddie" data-s="${s}">d${s}</button>`).join('')}</div>` : ''}
      ${this.modOpen ? `<div class="dt-sub">Modifier <input id="dt-modv" type="number" value="${r.mod}"/><button class="small" data-c="modok">✔</button></div>` : ''}
      ${this.pick ? this.pickHTML() : ''}`;
  }

  pickHTML() {
    const p = this.pick, toks = (this.dm.state.tokens || []).filter((t) => t.kind !== 'item'), chosen = new Set(p.targets.map((t) => t.id));
    const title = { damage: 'Damage: pick targets', heal: 'Heal: pick targets', init: 'Initiative: pick a token', stat: 'Stat: pick a token' }[p.kind];
    let rows = '';
    if (p.kind === 'damage' || p.kind === 'heal') {
      rows = p.targets.map((t) => {
        const k = this.dm.tokens.find(t.id); if (!k) return '';
        return `<div class="dt-target"><span>${esc(k.name)} <small>${k.hp}/${k.maxHp}</small></span><input type="number" min="0" data-pamt="${t.id}" value="${esc(t.amount)}" title="Amount for this target"/>
          <button class="small" data-c="half" data-id="${t.id}" title="Half">½</button><button class="small" data-c="double" data-id="${t.id}" title="Double">×2</button><button aria-label="Remove" class="small ghost" data-c="ptok" data-id="${t.id}" title="Remove">${closeIcon()}</button></div>`;
      }).join('') + (p.targets.length ? `<button class="btn small" data-c="apply">Apply ${p.kind}</button>` : '');
    } else if (p.kind === 'stat' && p.targets[0]) {
      const k = this.dm.tokens.find(p.targets[0].id), keys = (k?.custom || []).filter((c) => String(c.key).trim());
      rows = !k ? '' : keys.length
        ? `<div class="dt-target">${esc(k.name)}: <select id="dt-statkey">${keys.map((c) => `<option value="${esc(c.key)}">${esc(c.key)} (${esc(c.value)})</option>`).join('')}</select>
           <select id="dt-statop"><option value="-">−</option><option value="+">+</option><option value="=">=</option></select><input type="number" id="dt-statamt" value="${this.card.roll.total}"/><button class="btn small" data-c="applystat">Apply</button></div>`
        : `<p class="hint">${esc(k.name)} has no custom stats yet. Add one in its editor.</p>`;
    }
    return `<div class="dt-pick"><div><b>${title}</b> <small>click tokens on the table or here</small> <button class="small ghost" data-c="cancelpick">Cancel</button></div>
      <div class="dt-pick-toks">${toks.map((t) => `<button class="small ${chosen.has(t.id) ? 'on' : ''}" data-c="ptok" data-id="${t.id}">${esc(t.name)}</button>`).join('') || '<span class="hint">No tokens on the table.</span>'}</div>${rows}</div>`;
  }

  cardAction(a, d = {}) {
    const card = this.card; if (!card) return;
    if (a === 'close') { this.card = null; this.pick = null; this.renderCard(); return; }
    if (card.rolling) return;
    const r = card.roll, die = r.dice.find((x) => x.id === this.selDie);
    const upd = (nr) => { card.roll = nr; this.renderCard(); };
    try {
      switch (a) {
        case 'die': this.selDie = this.selDie === Number(d.id) ? null : Number(d.id); this.renderCard(); break;
        case 'reroll':
          if (!die) break;
          if (this.physical && this.rolls && PHYS.includes(die.sides) && !this.rolls.dice?.locked) {
            this.rolls.rollPool({ groups: [{ count: 1, sides: die.sides, keep: null }], mod: 0 }, { physical: true, secret: card.secret,
              onDone: (one) => { if (this.card === card) upd(P.rerollDie(card.roll, die.id, one.dice[0].value, 'physical')); } });
          } else upd(P.rerollDie(r, die.id, face(die.sides), 'digital'));
          break;
        case 'drop': if (die) upd(die.manualDrop ? P.undropDie(r, die.id) : P.dropDie(r, die.id)); break;
        case 'set': if (die) upd(P.setDie(r, die.id, Math.floor(Number(this.$('dt-setv').value)))); break;
        case 'add': this.addOpen = !this.addOpen; this.renderCard(); break;
        case 'adddie': upd(P.addDie(r, Number(d.s), face(Number(d.s)), 'digital')); break;
        case 'mod': this.modOpen = !this.modOpen; this.renderCard(); break;
        case 'modok': this.modOpen = false; upd(P.setRollMod(r, Number(this.$('dt-modv').value) || 0)); break;
        case 'damage': case 'heal': case 'init': case 'stat': this.pick = { kind: a, targets: [] }; this.renderCard(); break;
        case 'cancelpick': this.pick = null; this.renderCard(); break;
        case 'ptok': this.toggleTarget(d.id); break;
        case 'half': case 'double': {
          const t = this.pick?.targets.find((x) => x.id === d.id), base = Math.max(0, r.total);
          if (t) { t.amount = a === 'half' ? Math.floor(base / 2) : base * 2; this.renderCard(); }
          break;
        }
        case 'apply': {
          const k = this.pick.kind;
          const targets = this.pick.targets.map((t) => ({ id: t.id, amount: Math.max(0, Math.floor(Number(t.amount)) || 0) })).filter((t) => t.amount);
          // The DM's damage becomes a strike (released by a gesture or the Unleash button); a player's is a request the DM approves.
          if (this.dm.isDM && targets.length) act(this.dm, 'strike', { by: this.dm.combatMgr?.active?.()?.id || null, targets, heal: k === 'heal', label: card.label || '' });
          else for (const t of targets) act(this.dm, 'hp', { id: t.id, expr: `${k === 'damage' ? '-' : '+'}${t.amount}` });
          this.pick = null; this.renderCard(); break;
        }
        case 'applystat': {
          const t = this.dm.tokens.find(this.pick.targets[0]?.id), key = this.$('dt-statkey')?.value; if (!t || key == null) break;
          const cur = t.custom.find((x) => x.key === key);
          act(this.dm, 'stat', { id: t.id, key, value: bumpStat(cur?.value ?? 0, this.$('dt-statop').value, Number(this.$('dt-statamt').value) || 0) });
          this.pick = null; this.renderCard(); break;
        }
        case 'death': act(this.dm, 'deathSave', { id: card.targetId, d20: P.natD20(r) ?? r.total }); break;
        default: break;
      }
    } catch (e) { this.err(e.message); }
  }

  toggleTarget(id) {
    const p = this.pick; if (!p || !this.card || this.card.rolling) return false;
    if (p.kind === 'init') { act(this.dm, 'initiative', { id, value: this.card.roll.total }); this.pick = null; this.renderCard(); return true; }
    const i = p.targets.findIndex((t) => t.id === id);
    if (i >= 0) p.targets.splice(i, 1);
    else if (p.kind === 'stat') p.targets = [{ id }];
    else p.targets.push({ id, amount: Math.max(0, this.card.roll.total) });
    this.renderCard(); return true;
  }

  /** A token clicked on the table or in the list. @returns {boolean} true when the tray took it as a target */
  tokenClick(id) { return this.pick ? this.toggleTarget(id) : false; }

  /** The token whose saved rolls show as chips (the editor's token; else the active combatant). */
  setFocusToken(id) { this.focusTokenId = id; this.renderChips(); }

  // ---------- saved rolls, history, targets ----------
  chipRoll(key) {
    if (key.startsWith('my:')) return this.myRolls[Number(key.slice(3))];
    const [, id, i] = key.split(':'); return this.dm.tokens?.find(id)?.rolls?.[Number(i)];
  }
  saveRoll() {
    if (!this.pool.groups.length && !this.pool.mod) { this.err('Nothing to save: the pool is empty'); return; }
    const name = this.$('dt-savename').value.trim() || this.label || 'Roll', to = this.$('dt-saveto').value, r = { name, expr: P.toExpr(this.pool) };
    if (to === 'my') { this.myRolls.push(r); this.persistMy(); }
    else { const t = this.dm.tokens?.find(to); if (t && act(this.dm, 'update', { id: t.id, patch: { rolls: [...(t.rolls || []), r] } })) this.focusTokenId = t.id; }
    this.$('dt-saveform').hidden = true; this.renderChips();
  }
  renderSaveTo() {
    const toks = this.dm.state.tokens || [];
    this.$('dt-saveto').innerHTML = '<option value="my">My rolls</option>' + toks.map((t) => `<option value="${t.id}" ${t.id === this.focusTokenId ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  }
  renderChips() {
    const focus = this.dm.tokens?.find(this.focusTokenId) || this.dm.combatMgr?.active?.() || null;
    const chip = (key, r, cls, title) => `<button class="dt-chip ${cls}" data-chip="${key}" title="${esc(title)}">★ ${esc(r.name)} <small>${esc(r.expr)}</small></button>`;
    const tok = (focus?.rolls || []).map((r, i) => chip(`tok:${focus.id}:${i}`, r, 'tok', `${focus.name}: click to load · shift-click to roll`));
    const mine = this.myRolls.map((r, i) => chip(`my:${i}`, r, '', 'My rolls: click to load · shift-click to roll · right-click to delete'));
    const html = tok.length || mine.length ? `<small>Saved:</small>${tok.join('')}${mine.join('')}` : '<small>★ Save a pool to keep it here.</small>';
    const box = this.$('dt-chips'); if (box.dataset.sig !== html) { box.innerHTML = html; box.dataset.sig = html; }
  }
  renderHistory() {
    const box = this.$('dt-hist'); if (box.hidden) return;
    box.innerHTML = `<ul>${this.history.map((h, i) => `<li data-h="${i}" title="Reload this pool">${esc(h.who)} · ${esc(h.label || h.expr)} <small>${esc(h.expr)}</small> = <b>${h.total}</b>${h.secret ? ' 🔒' : ''}</li>`).join('') || '<li class="hint">No rolls yet.</li>'}</ul>`;
  }
  renderTargets() {
    const sel = this.$('dt-target'); if (document.activeElement === sel) return;
    const toks = (this.dm.state.tokens || []).filter((t) => t.kind !== 'item' && (this.tag !== 'death' || t.kind === 'pc'));
    const html = `<option value="">(target)</option>${toks.map((t) => `<option value="${t.id}">${esc(t.name)}${this.tag === 'attack' ? ` · Defense ${t.ac}` : ''}</option>`).join('')}`;
    if (sel.dataset.sig !== html) { sel.innerHTML = html; sel.dataset.sig = html; }
    sel.value = toks.some((t) => t.id === this.targetId) ? this.targetId : '';
    this.targetId = sel.value;
  }
  /** Re-renders the parts that read DM state (tokens, settings). */
  refresh() {
    this.$('dt-tagbox').hidden = !this.rulesOn;
    this.renderTargets(); this.renderChips();
    if (this.card && !this.card.rolling && !typingIn(this.$('dt-card'))) this.renderCard();
  }
}
