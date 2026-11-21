// Creature Editor side sheet (design/flexibility-plan.md §2). Stats only: no tint / size / appearance controls.
// mode 'new': edits a def (gallery tile, saved creature, AI Forge suggestion) → Spawn / Save to My creatures.
// mode 'token': live-edits a spawned token through dm.act('update').
import QUICK from './quickFill.json';
import { defOf } from '../../tokens/TokenManager.js';
import { esc, act, typingIn } from '../actions.js';
import { kitIcon, kitHas, closeIcon } from '../kit.js';

const ABIL = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const NUMS = [['maxHp', 'Max HP'], ['hp', 'Current HP'], ['tempHp', 'Temp HP'], ['ac', 'Defense'], ['initBonus', 'Initiative bonus'], ['speed', 'Speed']];
const VIS = [['exact', 'exact'], ['approx', 'approximate (healthy / bloodied / near death)'], ['hidden', 'hidden']];
const asValue = (raw) => (/^-?\d+$/.test(String(raw).trim()) ? Number(raw) : raw);

export class CreatureEditor {
  /** @param {{ dm: object, tray?: object }} ui */
  constructor(ui) {
    this.ui = ui; this.dm = ui.dm; this.mode = null; this.def = null; this.tokenId = null; this.count = 1; this.note = ''; this.defId = null;
    const el = (this.el = document.createElement('aside'));
    el.id = 'creature-editor'; el.hidden = true; el.setAttribute('aria-label', 'Creature editor');
    document.body.appendChild(el);
    el.addEventListener('click', (e) => this.click(e));
    el.addEventListener('change', (e) => this.change(e));
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    el.addEventListener('focusout', () => setTimeout(() => { if (this.mode === 'token' && !el.hidden && !typingIn(el)) this.render(); }, 0));
    this.dm.on(() => {
      if (this.mode !== 'token' || el.hidden || typingIn(el)) return;
      if (!this.dm.tokens?.find(this.tokenId)) this.close(); else this.render();
    });
  }

  /** Opens a def (not yet on the table). opts.note explains where the numbers came from; opts.defId = a My creatures entry. */
  openNew(def, { note = '', defId = null } = {}) {
    this.mode = 'new'; this.def = JSON.parse(JSON.stringify(def || {})); delete this.def.id;
    this.defId = defId; this.count = 1; this.note = note; this.show();
  }
  /** Opens a spawned token for live editing. */
  openToken(id) {
    if (!this.dm.tokens?.find(id)) return;
    this.mode = 'token'; this.tokenId = id; this.note = ''; this.defId = null;
    this.ui.tray?.setFocusToken(id); this.show();
  }
  show() { this.el.hidden = false; this.render(); this.el.querySelector('[data-f=name]')?.focus(); }
  close() { this.el.hidden = true; this.mode = null; }
  get cur() { return this.mode === 'token' ? this.dm.tokens?.find(this.tokenId) : this.def; }

  /** Writes a patch: live on a token, into the draft otherwise. */
  patch(p, rerender = false) {
    if (this.mode === 'token') act(this.dm, 'update', { id: this.tokenId, patch: p });
    else for (const [k, v] of Object.entries(p)) { if (v === '' || v === undefined) delete this.def[k]; else this.def[k] = v; }
    if (rerender) this.render();
  }

  /** The def to spawn or save (empty custom rows and rolls dropped). */
  cleanDef() {
    const d = this.mode === 'token' ? defOf(this.cur) : JSON.parse(JSON.stringify(this.def));
    d.custom = (d.custom || []).filter((c) => String(c.key).trim());
    d.rolls = (d.rolls || []).filter((r) => String(r.expr).trim());
    return d;
  }

  render() {
    const d = this.cur; if (!d) { this.close(); return; }
    const v = (x) => (x == null ? '' : esc(x)), tok = this.mode === 'token';
    const pk = `creature/${d.statId || d.model}`, portrait = !d.forge && kitHas(pk) ? kitIcon(pk, { cls: 'ce-portrait' }) : '';
    this.el.innerHTML = `
      <header>${portrait}<b>${tok ? 'Edit token' : 'New creature'}</b><button aria-label="Close (Esc)" class="small ghost" data-a="close" title="Close (Esc)">${closeIcon()}</button></header>
      ${this.note ? `<p class="hint">${esc(this.note)}</p>` : ''}
      ${tok ? '<p class="hint">Changes apply live.</p>' : ''}
      <label class="ce-wide">Name <input data-f="name" value="${v(d.name)}" autocomplete="off"></label>
      <label class="ce-wide">Side <select data-f="side">${['enemy', 'ally', 'neutral'].map((s) => `<option value="${s}" ${(d.side || 'enemy') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <div class="ce-quick"><small>Quick fill (optional):</small> ${Object.entries(QUICK.presets).map(([k, p]) => `<button class="small" data-a="quick" data-k="${k}" title="Sets Max HP ${p.maxHp} and Defense ${p.ac}; you can still edit them">${esc(p.label)}</button>`).join('')}</div>
      <div class="ce-grid">${NUMS.map(([f, l]) => `<label>${l}<input type="number" data-f="${f}" data-num value="${v(d[f])}" placeholder="blank"></label>`).join('')}</div>
      <h5>Custom stats</h5>
      <div class="ce-list">${(d.custom || []).map((c, i) => `<div class="row"><input data-cs="key" data-i="${i}" value="${v(c.key)}" placeholder="Name (Mana)"><input data-cs="value" data-i="${i}" value="${v(c.value)}" placeholder="Value (12, 3/3, shaky)"><button aria-label="Remove" class="small ghost" data-a="csdel" data-i="${i}" title="Remove">${closeIcon()}</button></div>`).join('')}</div>
      <button class="small" data-a="csadd">+ Add stat</button>
      <details><summary>Abilities (optional)</summary><div class="ce-grid six">${ABIL.map((a) => `<label>${a.toUpperCase()}<input type="number" data-ab="${a}" value="${v(d.abilities?.[a])}" placeholder="—"></label>`).join('')}</div></details>
      <details ${(d.rolls || []).length ? 'open' : ''}><summary>Saved rolls</summary>
        <div class="ce-list">${(d.rolls || []).map((r, i) => `<div class="row"><input data-r="name" data-i="${i}" value="${v(r.name)}" placeholder="Name"><input data-r="expr" data-i="${i}" value="${v(r.expr)}" placeholder="1d8 + 3"><button class="small" data-a="rtray" data-i="${i}" title="Load into the dice tray">Roll</button><button aria-label="Remove" class="small ghost" data-a="rdel" data-i="${i}" title="Remove">${closeIcon()}</button></div>`).join('')}</div>
        <button class="small" data-a="radd">+ Add roll</button></details>
      <details ${d.notes ? 'open' : ''}><summary>Notes</summary><textarea data-f="notes" rows="3">${v(d.notes)}</textarea></details>
      <label class="ce-wide ce-check"><input type="checkbox" data-f="life" ${d.life !== false ? 'checked' : ''}> Life-size body around the table <small>(drag it to move it)</small></label>
      <label class="ce-wide">Players see HP <select data-f="hpVisibility">${VIS.map(([k, l]) => `<option value="${k}" ${(d.hpVisibility || 'exact') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <footer>
        ${tok ? `<button class="kimg sm" data-a="dup" aria-label="Duplicate" title="Duplicate">${kitIcon('forge/duplicate')}</button><button class="small btn danger" data-a="remove">Remove</button>`
    : `<label>Count <input type="number" min="1" max="20" data-count value="${this.count}"></label><button class="kimg sm" data-a="spawn" aria-label="Spawn" title="Spawn">${kitIcon('forge/spawn')}<span class="art-caption">Spawn</span></button>`}
        <button class="small" data-a="save">Save to My creatures</button>
        ${this.defId ? '<button class="small ghost" data-a="deldef">Delete from My creatures</button>' : ''}
      </footer>`;
  }

  change(e) {
    const t = e.target, d = this.cur; if (!d) return;
    if (t.hasAttribute('data-count')) { this.count = Math.max(1, Math.min(20, Math.floor(Number(t.value)) || 1)); return; }
    if (t.dataset.f) {
      let val = t.type === 'checkbox' ? t.checked : t.value;
      if (t.hasAttribute('data-num')) val = val === '' ? '' : Number(val);
      this.patch({ [t.dataset.f]: val });
    } else if (t.dataset.cs) {
      const custom = (d.custom || []).map((c) => ({ ...c }));
      custom[Number(t.dataset.i)][t.dataset.cs] = t.dataset.cs === 'value' ? asValue(t.value) : t.value;
      this.patch({ custom });
    } else if (t.dataset.ab) {
      const ab = { ...(d.abilities || {}) };
      if (t.value === '') delete ab[t.dataset.ab]; else ab[t.dataset.ab] = Number(t.value);
      this.patch({ abilities: Object.keys(ab).length ? ab : undefined });
    } else if (t.dataset.r) {
      const rolls = (d.rolls || []).map((r) => ({ ...r }));
      rolls[Number(t.dataset.i)][t.dataset.r] = t.value;
      this.patch({ rolls });
    }
  }

  click(e) {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a, d = this.cur, i = Number(b.dataset.i);
    if (!d && a !== 'close') return;
    switch (a) {
      case 'close': this.close(); break;
      case 'quick': { const p = QUICK.presets[b.dataset.k]; this.patch({ maxHp: p.maxHp, hp: p.maxHp, ac: p.ac }, true); break; }
      case 'csadd': this.patch({ custom: [...(d.custom || []), { key: '', value: '' }] }, true); break;
      case 'csdel': this.patch({ custom: (d.custom || []).filter((_, j) => j !== i) }, true); break;
      case 'radd': this.patch({ rolls: [...(d.rolls || []), { name: '', expr: '' }] }, true); break;
      case 'rdel': this.patch({ rolls: (d.rolls || []).filter((_, j) => j !== i) }, true); break;
      case 'rtray': { const r = d.rolls?.[i]; if (r?.expr) this.ui.tray?.loadExpr(r.expr, r.name); break; }
      case 'spawn': if (act(this.dm, 'spawn', { def: this.cleanDef(), count: this.count })) this.close(); break;
      case 'save': {
        const def = this.cleanDef(); if (this.defId) def.defId = this.defId;
        if (act(this.dm, 'saveDef', { def })) { b.textContent = '✔ Saved'; setTimeout(() => { if (b.isConnected) b.textContent = 'Save to My creatures'; }, 1500); }
        break;
      }
      case 'deldef': act(this.dm, 'deleteDef', { defId: this.defId }); this.defId = null; this.render(); break;
      case 'dup': act(this.dm, 'duplicate', { id: this.tokenId }); break;
      case 'remove': act(this.dm, 'remove', { id: this.tokenId }); this.close(); break;
      default: break;
    }
  }
}
