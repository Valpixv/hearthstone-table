// The action loop's cards (design/completion-plan.md §7), for the DM and for players, on desktop.
//   DM:     "Call for a roll" form · a confirm card for every answered roll · the strikes waiting for a gesture.
//   Player: a prompt for every roll the DM asked of them; the next roll they make answers it.
// The same information is offered to the VR panels through describeDM() / describePlayer().
import { esc, act } from './actions.js';
import { iconHTML } from './icons.js';
import { kitIcon, closeIcon, glyph } from './kit.js';
import { ABILITIES, ABILITY_NAMES, SKILLS } from '../party/sheet.js';
import { CALL_KINDS, adjustDamage } from '../combat/strikes.js';
import { fromResults, natD20, parse, split } from '../rules/dicePool.js';
import EFFECTS from '../data/effects.json';

const DAMAGE_TYPES = [...new Set(Object.values(EFFECTS.effects).map((e) => e.damageType).filter((t) => t && t !== 'none' && t !== 'heal'))].sort();
const cap = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());
const KIND_ICON = { attack: 'attack', save: 'save', check: 'd20', damage: 'damage', init: 'initiative', death: 'death-save', custom: 'd20' };

export class CallCards {
  /** @param {{ dm: object, sync: object, tray: object, doc?: Document }} deps */
  constructor({ dm, sync, tray, doc = globalThis.document }) {
    Object.assign(this, { dm, sync, tray, doc });
    this.form = { open: false, to: [], kind: 'attack', ability: 'dex', skill: '', dc: '', adv: '', targetId: '', damageType: '', expr: '' };
    this.edits = {}; // call id → { amount, targetId, type } typed on a confirm card
    tray.onResult = (card) => this.onRoll(card);
    if (!doc) return;
    this.desk = doc.createElement('div'); this.desk.id = 'call-desk'; this.desk.hidden = true; doc.body.appendChild(this.desk);
    this.prompt = doc.createElement('div'); this.prompt.id = 'call-prompt'; this.prompt.hidden = true; this.prompt.setAttribute('role', 'status'); doc.body.appendChild(this.prompt);
    this.desk.addEventListener('click', (e) => this.onDeskClick(e));
    this.desk.addEventListener('change', (e) => this.onDeskChange(e));
    this.desk.addEventListener('keydown', (e) => e.stopPropagation());
    this.prompt.addEventListener('click', (e) => { const b = e.target.closest('[data-roll]'); if (b) this.rollFor(b.dataset.roll); });
    dm.on(() => this.render());
    setInterval(() => { if (this.isDM && (dm.state.strikes || []).length) this.render(); }, 5000); // "resolve now" appears after the timeout
  }

  get isDM() { return this.sync?.role !== 'player'; }
  get me() { return this.sync?.me?.id ?? null; }
  get tokens() { return this.dm.state.tokens || []; }
  get calls() { return this.dm.state.calls || []; }
  get strikes() { return this.dm.state.strikes || []; }
  name(id) { return this.tokens.find((t) => t.id === id)?.name ?? '?'; }

  /** Is this call for this machine to roll? A player's own character; on the DM's machine, characters nobody is playing. */
  mine(call) {
    const t = this.tokens.find((x) => x.id === call.to); if (!t) return false;
    if (!this.isDM) return t.owner === this.me;
    const present = new Set((this.sync?.players || []).map((p) => p.id));
    return !t.owner || !present.has(t.owner);
  }
  /** Open calls this machine should answer. */
  myCalls() { return this.calls.filter((c) => c.status === 'open' && this.mine(c)); }

  /** Loads a call's dice into the tray and rolls them. */
  rollFor(id) {
    const c = this.myCalls().find((x) => x.id === id); if (!c) return;
    this.tray.loadExpr(c.expr, `${this.name(c.to)} · ${c.label}`);
    if (!this.tray.errMsg) this.tray.roll(id);
  }

  /**
   * Every finished roll (tray or hand-thrown) answers the oldest open call for this machine.
   * Hand-thrown dice carry no modifier, so the call's modifier is added to them.
   */
  onRoll(card) {
    const mine = this.myCalls(); if (!mine.length || !card?.roll) return;
    const c = card.callId ? mine.find((x) => x.id === card.callId) : mine[0];
    if (!c) return;
    let r = card.roll;
    if (card.label === 'Hand-thrown') {
      const pool = parse(c.expr), { physical, digital } = split(pool);
      if (digital.length || physical.length !== r.dice.length) return;
      const remaining = [...r.dice], faces = [];
      for (const die of physical) {
        const i = remaining.findIndex((d) => d.sides === die.sides);
        if (i < 0) return;
        const value = remaining.splice(i, 1)[0].value;
        faces.push(die.part === 'tens' && value === 10 ? 0 : value);
      }
      r = fromResults(pool, faces);
    }
    const text = r.dice.filter((d) => !d.dropped).map((d) => d.value).join(' + ')
      + (r.mod ? ` ${r.mod > 0 ? '+' : '−'} ${Math.abs(r.mod)}` : '');
    try { this.dm.act('call.answer', { id: c.id, total: r.total, nat: natD20(r), text }); } catch (e) { console.warn('[calls]', e); }
  }

  // ---------- DM desk ----------
  onDeskChange(e) {
    const d = e.target.dataset, v = e.target.value;
    if (d.form) { this.form[d.form] = v; if (d.form === 'kind') this.render(true); return; }
    if (d.edit) { (this.edits[d.id] ||= {})[d.edit] = v; if (d.edit === 'type' || d.edit === 'targetId') this.render(true); }
  }

  onDeskClick(e) {
    const b = e.target.closest('[data-d]'); if (!b) return;
    const d = b.dataset, F = this.form, dm = this.dm;
    const call = d.id ? this.calls.find((c) => c.id === d.id) : null, ed = d.id ? (this.edits[d.id] ||= {}) : {};
    switch (d.d) {
      case 'toggle': F.open = !F.open; return this.render(true);
      case 'who': { const all = this.tokens.filter((t) => t.kind === 'pc').map((t) => t.id);
        if (d.who === 'all') F.to = F.to.length === all.length ? [] : all; else F.to = F.to.includes(d.who) ? F.to.filter((x) => x !== d.who) : [...F.to, d.who];
        return this.render(true); }
      case 'ask': {
        if (!F.to.length) return (dm.toast || dm.narrate).call(dm, 'Pick who rolls first.');
        const skill = F.kind === 'check' && SKILLS[F.skill] ? F.skill : null;
        act(dm, 'call', { to: F.to, kind: F.kind, ability: F.ability, skill, dc: F.dc, adv: F.adv || null, targetId: F.targetId || null, damageType: F.damageType || null,
          expr: (F.kind === 'damage' || F.kind === 'custom') && F.expr ? F.expr : undefined, showDc: !!dm.state.settings?.showDcToPlayers });
        F.open = false; return this.render(true);
      }
      case 'cancel': return void act(dm, 'call.cancel', { id: d.id });
      case 'done': delete this.edits[d.id]; return void act(dm, 'call.resolve', { id: d.id });
      case 'ask-damage': { // an attack hit: ask the same character for the damage, aimed at the same target
        const w = this.tokens.find((t) => t.id === call.to)?.sheet?.weapons?.[call.weapon ?? 0];
        act(dm, 'call', { to: [call.to], kind: 'damage', weapon: call.weapon ?? (w ? 0 : undefined), targetId: call.targetId, damageType: w?.type || call.damageType || null,
          label: `${w ? w.name + ' damage' : 'Damage'}${call.result?.verdict?.crit ? ' (critical: roll the dice twice)' : ''}` });
        return void act(dm, 'call.resolve', { id: d.id });
      }
      case 'half': case 'double': { const base = Number(ed.amount ?? call?.result?.total ?? 0) || 0; ed.amount = d.d === 'half' ? Math.floor(base / 2) : base * 2; return this.render(true); }
      case 'confirm': {
        // The DM confirms what the roll does: a strike that waits for the attacker's gesture.
        const amount = Math.max(0, Math.floor(Number(ed.amount ?? call.result.total)) || 0), target = ed.targetId || call.targetId || '';
        if (!target) return (dm.toast || dm.narrate).call(dm, 'Pick a target.');
        const fail = call.kind === 'save' || call.kind === 'check'; // damage a failed save takes comes from the DM's creature, not the roller
        if (act(dm, 'strike', { by: fail ? null : call.to, targets: [{ id: fail ? call.to : target, amount }], damageType: ed.type || call.damageType || null, heal: ed.heal === '1', label: call.label })) {
          delete this.edits[d.id]; act(dm, 'call.resolve', { id: d.id });
        }
        return null;
      }
      case 'strike-now': return void act(dm, 'strike.now', { id: d.id });
      case 'strike-release': return void act(dm, 'strike.release', { id: d.id });
      case 'strike-cancel': return void act(dm, 'strike.cancel', { id: d.id });
      default: return null;
    }
  }

  render(force = false) {
    if (!this.desk) return;
    this.renderPrompt();
    const show = this.isDM && this.sync?.role != null && this.dm.isDM;
    this.desk.hidden = !show; if (!show) return;
    if (!force && this.desk.contains(this.doc.activeElement) && this.doc.activeElement.matches('input,select')) return;
    const F = this.form, pcs = this.tokens.filter((t) => t.kind === 'pc'), others = this.tokens.filter((t) => t.kind !== 'item');
    const open = this.calls.filter((c) => c.status === 'open'), rolled = this.calls.filter((c) => c.status === 'rolled'), now = Date.now();
    const opt = (list, sel, f = (x) => x) => list.map((x) => `<option value="${esc(x)}"${x === sel ? ' selected' : ''}>${esc(f(x))}</option>`).join('');
    const form = !F.open ? '' : `<div class="cd-form">
        <div class="cd-who">${pcs.length ? `<button data-d="who" data-who="all" class="${F.to.length === pcs.length ? 'on' : ''}">Everyone</button>` : '<span class="hint">No player characters yet.</span>'}${pcs.map((t) => `<button data-d="who" data-who="${t.id}" class="${F.to.includes(t.id) ? 'on' : ''}">${esc(t.name)}</button>`).join('')}</div>
        <div class="row wrap"><select data-form="kind" aria-label="Kind of roll">${Object.entries(CALL_KINDS).map(([k, l]) => `<option value="${k}"${k === F.kind ? ' selected' : ''}>${l}</option>`).join('')}</select>
          ${F.kind === 'save' || F.kind === 'check' ? `<select data-form="ability" aria-label="Ability">${opt(ABILITIES, F.ability, (a) => ABILITY_NAMES[a])}</select>` : ''}
          ${F.kind === 'check' ? `<select data-form="skill" aria-label="Skill"><option value="">(no skill)</option>${opt(Object.keys(SKILLS), F.skill, cap)}</select>` : ''}
          ${F.kind === 'damage' || F.kind === 'custom' ? `<input data-form="expr" placeholder="dice: 2d6+3" value="${esc(F.expr)}" style="width:110px" aria-label="Dice">` : ''}
          ${F.kind === 'save' || F.kind === 'check' ? `<input data-form="dc" type="number" placeholder="DC" value="${esc(F.dc)}" style="width:64px" aria-label="Difficulty">` : ''}
          ${F.kind !== 'damage' && F.kind !== 'custom' ? `<select data-form="adv" aria-label="Advantage"><option value="">normal</option><option value="adv"${F.adv === 'adv' ? ' selected' : ''}>advantage</option><option value="dis"${F.adv === 'dis' ? ' selected' : ''}>disadvantage</option></select>` : ''}
          ${F.kind === 'attack' || F.kind === 'damage' ? `<select data-form="targetId" aria-label="Target"><option value="">(target)</option>${others.map((t) => `<option value="${t.id}"${t.id === F.targetId ? ' selected' : ''}>${esc(t.name)} · AC ${t.ac}</option>`).join('')}</select>` : ''}
          ${F.kind === 'damage' ? `<select data-form="damageType" aria-label="Damage type"><option value="">(type)</option>${opt(DAMAGE_TYPES, F.damageType, cap)}</select>` : ''}
          <button class="btn" data-d="ask">Ask</button></div></div>`;
    const waiting = open.map((c) => `<div class="cd-card wait">${iconHTML(KIND_ICON[c.kind])}<span><b>${esc(this.name(c.to))}</b> · ${esc(c.label)} <small>${esc(c.expr)}${c.dc != null ? ` · DC ${c.dc}` : ''} · waiting…</small></span><button aria-label="Cancel" class="ghost" data-d="cancel" data-id="${c.id}" title="Cancel">${closeIcon()}</button></div>`).join('');
    const confirm = rolled.map((c) => this.confirmHTML(c, others)).join('');
    const strikes = this.strikes.map((s) => { const stale = s.status === 'armed' && now - s.at > 30000;
      return `<div class="cd-card strike ${s.status}">${kitIcon(s.heal ? 'combat/heal-impact' : 'combat/damage-impact', { cls: 'gi gi-lg' })}<span><b>${esc(s.by ? this.name(s.by) : 'The DM')}</b> → ${s.targets.map((t) => `${esc(this.name(t.id))} ${s.heal ? '+' : ''}${t.amount}`).join(', ')}
        <small>${s.status === 'armed' ? (stale ? 'no gesture yet' : 'waiting for the gesture…') : 'in flight'}</small></span>
        ${s.status === 'armed' ? `<button data-d="strike-release" data-id="${s.id}" title="Play the effect and apply it now">Unleash</button><button data-d="strike-now" data-id="${s.id}" title="Apply without the effect">Apply</button><button aria-label="Cancel" class="ghost" data-d="strike-cancel" data-id="${s.id}" title="Cancel">${closeIcon()}</button>` : ''}</div>`; }).join('');
    const html = `<button class="cd-toggle ${F.open ? 'on' : ''}" data-d="toggle" id="cd-toggle">${kitIcon('combat/roll-request', { cls: 'cd-ic' })}<span>Call for a roll</span></button>${form}${waiting}${confirm}${strikes}`;
    if (this.desk.dataset.sig !== html) { this.desk.innerHTML = html; this.desk.dataset.sig = html; }
  }

  confirmHTML(c, others) {
    const v = c.result.verdict, ed = this.edits[c.id] || {}, cls = v.success === true ? 'good' : v.success === false ? 'bad' : '';
    const head = `${kitIcon('combat/roll-answered', { cls: 'gi gi-lg' })}<span><b>${esc(this.name(c.to))}</b> · ${esc(c.label)}<br><b class="cd-total">${c.result.total}</b> <small>${esc(c.result.text)}</small> ${v.text ? `<em class="${cls} ${v.crit ? 'crit' : ''}">${esc(v.text)}</em>` : ''}</span>`;
    if (c.kind === 'attack') {
      return `<div class="cd-card rolled">${head}<div class="cd-acts">${v.success === false ? '' : `<button class="btn" data-d="ask-damage" data-id="${c.id}">Ask for damage</button>`}<button data-d="done" data-id="${c.id}">${v.success === false ? 'Miss: done' : 'Dismiss'}</button></div></div>`;
    }
    if (c.kind === 'damage' || c.kind === 'save' || c.kind === 'check') {
      const fail = c.kind !== 'damage', targetId = fail ? c.to : (ed.targetId || c.targetId || ''), type = ed.type ?? c.damageType ?? '';
      const amount = ed.amount ?? (fail ? '' : c.result.total), sug = targetId && amount !== '' ? adjustDamage(this.tokens.find((t) => t.id === targetId), Number(amount) || 0, type) : null;
      return `<div class="cd-card rolled">${head}<div class="cd-acts">
        ${fail ? `<small>${v.success === false ? 'Failed. Damage they take:' : 'Damage they take (if any):'}</small>` : `<select data-edit="targetId" data-id="${c.id}" aria-label="Target"><option value="">(target)</option>${others.map((t) => `<option value="${t.id}"${t.id === targetId ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`}
        <input data-edit="amount" data-id="${c.id}" type="number" min="0" value="${esc(amount)}" style="width:66px" aria-label="Amount">
        <select data-edit="type" data-id="${c.id}" aria-label="Damage type"><option value="">(type)</option>${DAMAGE_TYPES.map((t) => `<option value="${t}"${t === type ? ' selected' : ''}>${cap(t)}</option>`).join('')}</select>
        <button data-d="half" data-id="${c.id}" title="Half (resistance)">½</button><button data-d="double" data-id="${c.id}" title="Double (vulnerability)">×2</button>
        ${sug?.note ? `<small class="cd-sug">${esc(sug.note)}: ${sug.amount} suggested</small>` : ''}
        <button class="btn ok" data-d="confirm" data-id="${c.id}">Confirm</button><button data-d="done" data-id="${c.id}">${fail ? 'Done' : 'Dismiss'}</button></div></div>`;
    }
    return `<div class="cd-card rolled">${head}<div class="cd-acts"><button data-d="done" data-id="${c.id}">Done</button></div></div>`;
  }

  // ---------- player prompt ----------
  renderPrompt() {
    if (!this.prompt) return;
    const mine = this.sync?.role != null ? this.myCalls() : [];
    this.prompt.hidden = !mine.length; if (!mine.length) return;
    const html = mine.map((c) => `<div class="cp-card">${iconHTML(KIND_ICON[c.kind], 'gi-xl')}<span><small>${this.isDM ? esc(this.name(c.to)) + ' · the DM asks for' : 'The Dungeon Master asks for'}</small><b>${esc(c.label)}</b>
      <small>${esc(c.expr)}${c.dc != null ? ` · DC ${c.dc}` : ''}${c.targetId ? ` · at ${esc(this.name(c.targetId))}` : ''}</small></span>
      <button class="btn" data-roll="${c.id}">Roll</button></div>`).join('') + '<small class="cp-hint">Or throw the dice shown for your oldest request together.</small>';
    if (this.prompt.dataset.sig !== html) { this.prompt.innerHTML = html; this.prompt.dataset.sig = html; }
  }

  // ---------- the same cards as data, for the VR panels ----------
  /** VR "Combat" panel for the DM. */
  describeDM() {
    const items = [];
    for (const c of this.calls.filter((x) => x.status === 'open')) items.push({ type: 'row', icon: KIND_ICON[c.kind], text: `${this.name(c.to)} · ${c.label}`, sub: 'waiting…', buttons: [{ label: 'Cancel', run: () => act(this.dm, 'call.cancel', { id: c.id }) }] });
    for (const c of this.calls.filter((x) => x.status === 'rolled')) {
      const v = c.result.verdict, buttons = [];
      if (c.kind === 'attack' && v.success !== false) buttons.push({ label: 'Ask damage', primary: true, run: () => this.onDeskClick({ target: { closest: () => ({ dataset: { d: 'ask-damage', id: c.id } }) } }) });
      if (c.kind === 'damage' && c.targetId) buttons.push({ label: `Confirm ${c.result.total}`, primary: true, run: () => { if (act(this.dm, 'strike', { by: c.to, targets: [{ id: c.targetId, amount: c.result.total }], damageType: c.damageType, label: c.label })) act(this.dm, 'call.resolve', { id: c.id }); } });
      if (c.kind === 'damage' && c.targetId) buttons.push({ label: 'Half', run: () => { if (act(this.dm, 'strike', { by: c.to, targets: [{ id: c.targetId, amount: Math.floor(c.result.total / 2) }], damageType: c.damageType, label: c.label })) act(this.dm, 'call.resolve', { id: c.id }); } });
      buttons.push({ label: 'Done', run: () => act(this.dm, 'call.resolve', { id: c.id }) });
      items.push({ type: 'row', icon: KIND_ICON[c.kind], text: `${this.name(c.to)} · ${c.label}: ${c.result.total}`, sub: v.text || c.result.text, buttons });
    }
    for (const s of this.strikes) items.push({ type: 'row', icon: s.status === 'armed' ? 'combat/strike-armed' : 'combat/strike-in-flight', text: `${s.by ? this.name(s.by) : 'DM'} → ${s.targets.map((t) => `${this.name(t.id)} ${t.amount}`).join(', ')}`, sub: s.status === 'armed' ? 'waiting for the gesture' : 'in flight',
      buttons: s.status === 'armed' ? [{ label: 'Unleash', primary: true, run: () => act(this.dm, 'strike.release', { id: s.id }) }, { label: 'Cancel', run: () => act(this.dm, 'strike.cancel', { id: s.id }) }] : [] });
    return items;
  }

  /** Quick calls the DM can make from VR without typing: one button per kind for a chosen character. */
  quickCall(to, kind, extra = {}) { return act(this.dm, 'call', { to: [].concat(to), kind, ...extra }); }

  /** VR prompt rows for this player. */
  describePlayer() {
    return this.myCalls().map((c) => ({ type: 'row', icon: KIND_ICON[c.kind], text: c.label, sub: `${c.expr}${c.targetId ? ` · at ${this.name(c.targetId)}` : ''} · throw your dice`, buttons: [{ label: 'Roll', primary: true, run: () => this.rollFor(c.id) }] }));
  }
}
