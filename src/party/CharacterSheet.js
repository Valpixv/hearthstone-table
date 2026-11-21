// The character sheet window (design/completion-plan.md §4.3–4.6). It carries every block of the D&D 2024 character
// sheet, grouped in four tabs: Sheet (page 1), Spells (page 2 spellcasting + gesture spells), Bag (equipment, coins,
// attunement) and Story (appearance, backstory, languages, alignment, notes).
// One window for players (their own PC) and the DM (any PC or loot container). Every edit goes through dm.act:
// sheet / inv / give are self-serve on your own token; HP and rests are requests the DM approves.
// Clicking an ability, save, skill, initiative or weapon loads that roll into the dice tray. Opens with K.
import CLASSES from '../data/classes.json';
import ORIGINS from '../data/origins.json';
import EFFECTS from '../data/effects.json';
import { esc, typingIn } from '../ui/actions.js';
import { kitIcon, closeIcon, glyph, symKey } from '../ui/kit.js';
import { iconHTML } from '../ui/icons.js';
import { ABILITIES, ABILITY_NAMES, SKILLS, COINS, COIN_ART, GESTURES, GESTURE_LABELS, SIZES, CLASS_IDS, SPECIES_IDS, BACKGROUND_IDS, MAX_ATTUNED,
  defaultSheet, abilityMod, fmtMod, profBonus, saveBonus, skillBonus, passivePerception, spellSaveDC, spellAttackBonus, hitDiceLeft,
  nextLevelXp, suggestedAC, applyClass, applySpecies, applyBackground, slotsFor, weaponRow, canLevelUp } from './sheet.js';
import { canBuild } from './bagActions.js';
import { resolveItem, presetList } from '../rules/itemIcon.js';
import { itemIconMarkup } from './itemIcons.js';

const TABS = [['sheet', 'Sheet', 'sheet/abilities'], ['spells', 'Spells', 'sheet/spells'], ['inv', 'Bag', 'sheet/inventory'], ['story', 'Story', 'sheet/features']];
const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Effect picker options grouped by archetype. */
export function effectOptions(sel) {
  const groups = {};
  for (const [id, e] of Object.entries(EFFECTS.effects)) (groups[e.archetype] ||= []).push([id, e.name]);
  return `<option value="">— none —</option>` + Object.entries(groups).map(([g, list]) =>
    `<optgroup label="${esc(cap(g))}">${list.map(([id, n]) => `<option value="${id}"${id === sel ? ' selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`).join('');
}
/** Kit icon for a spell effect (falls back to its damage type symbol). */
export function effectIcon(id, cls = 'gi-lg') {
  const e = EFFECTS.effects[id]; if (!e) return '';
  return kitIcon(`spell/${id}`, { cls: `gi ${cls}` }) || iconHTML(e.damageType, cls) || iconHTML('attack', cls);
}

export class CharacterSheet {
  /** @param {{ dm: object, sync: object, caster?: object, tray?: object, doc?: Document }} deps */
  constructor({ dm, sync, caster = null, tray = null, doc = globalThis.document }) {
    Object.assign(this, { dm, sync, caster, tray, doc }); this.tab = 'sheet'; this.tokenId = null;
    if (!doc) return;
    this.el = doc.createElement('div'); this.el.id = 'char-sheet'; this.el.hidden = true; this.el.setAttribute('role', 'dialog'); this.el.setAttribute('aria-label', 'Character sheet');
    doc.body.appendChild(this.el);
    this.btn = doc.createElement('button'); this.btn.id = 'char-open'; this.btn.className = 'kimg'; this.btn.title = 'Character sheet (K)';
    this.btn.innerHTML = `${kitIcon('session/my-sheet')}`; this.btn.setAttribute('aria-label', 'Open my character sheet'); this.btn.hidden = true;
    this.btn.onclick = () => this.toggle(); doc.body.appendChild(this.btn);
    this.el.addEventListener('change', (e) => this.onChange(e));
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset.a === 'add-name') this.addTyped(); if (e.key === 'Enter' && e.target.dataset.hpExpr != null) this.askHp(); e.stopPropagation(); });
    this.el.addEventListener('focusout', () => setTimeout(() => this.render(), 0));
    dm.on(() => this.render());
  }

  get myId() { return this.sync?.me?.id ?? null; }
  get isDM() { return this.sync?.role !== 'player'; }
  /** Tokens this viewer may open: own PC (player), every PC and loot container (DM). */
  get choices() {
    const all = this.dm.state.tokens || [];
    return this.isDM ? all.filter((t) => t.kind === 'pc' || t.kind === 'item') : all.filter((t) => t.kind === 'pc' && t.owner === this.myId);
  }
  get token() {
    const c = this.choices;
    return c.find((t) => t.id === this.tokenId) || c.find((t) => t.owner && t.owner === this.myId) || c[0] || null;
  }
  get sheet() { return this.token?.sheet || defaultSheet(); }
  /** May this viewer set the token's own numbers (name, HP, AC…) directly? The DM always; a player while building. */
  get free() { const t = this.token; return this.isDM || (!!t && canBuild(this.dm.state, t.id)); }

  toggle(v = this.el.hidden) { this.el.hidden = !v; this.render(true); }
  /** Opens on a tab, optionally on a token (DM). */
  open(tab = this.tab, tokenId = null) { this.tab = tab; if (tokenId) this.tokenId = tokenId; this.toggle(true); }

  act(type, payload) { try { return this.dm.act(type, payload); } catch (e) { console.warn('[sheet]', e); (this.dm.toast || this.dm.narrate)?.call(this.dm, e.message); return null; } }
  patchSheet(patch) { const t = this.token; if (t) this.act('sheet', { id: t.id, patch }); }
  inv(op, extra = {}) { const t = this.token; if (t) this.act('inv', { id: t.id, op, ...extra }); }
  /** Sets fields on the token itself: directly for the DM, as a build step while building, else as a request. */
  patchToken(patch) {
    const t = this.token; if (!t) return;
    if (this.isDM) this.act('update', { id: t.id, patch });
    else if (this.free) this.act('build', { id: t.id, token: patch });
    else this.act('update', { id: t.id, patch });
  }

  /** Loads a roll into the dice tray (and rolls it): the sheet is the fastest way to roll the right modifier. */
  roll(label, expr) {
    if (!this.tray) return;
    this.tray.loadExpr(expr, `${this.token?.name || ''} · ${label}`.replace(/^ · /, ''));
    if (!this.tray.errMsg) this.tray.roll();
  }
  d20(label, mod) { this.roll(label, `1d20${mod ? (mod > 0 ? '+' : '') + mod : ''}`); }

  askHp() {
    const inp = this.el.querySelector('[data-hp-expr]'), x = inp?.value.trim(), t = this.token;
    if (!x || !t) return;
    this.act('hp', { id: t.id, expr: x }); inp.value = '';
  }

  // ---------- events ----------
  onChange(e) {
    const d = e.target.dataset, v = e.target.type === 'checkbox' ? e.target.checked : e.target.value, t = this.token, s = this.sheet;
    if (!t) return;
    if (d.pick) { this.tokenId = v; return this.render(true); }
    if (d.s) return this.patchSheet({ [d.s]: d.num ? Number(v) : v });
    if (d.tok) return this.patchToken({ [d.tok]: d.num ? Number(v) || 0 : v });
    if (d.ab) return this.patchSheet({ abilities: { ...s.abilities, [d.ab]: Number(v) } });
    if (d.save) return this.patchSheet({ saves: { ...s.saves, [d.save]: !!v } });
    if (d.train) return this.patchSheet({ training: { ...s.training, [d.train]: v } });
    if (d.hd) return this.patchSheet({ hitDice: { ...s.hitDice, [d.hd]: Number(v) } });
    if (d.slot) { const l = d.slot, cur = s.slots[l] || { max: 0, used: 0 }; return this.patchSheet({ slots: { ...s.slots, [l]: { ...cur, max: Number(v) || 0 } } }); }
    if (d.list) {
      const list = s[d.list].map((x) => ({ ...x })); list[+d.i][d.k] = d.num ? Number(v) : v;
      return this.patchSheet({ [d.list]: list });
    }
    if (d.att != null) { const a = [...s.attuned]; a[+d.att] = v; return this.patchSheet({ attuned: a.filter(Boolean) }); }
    if (d.bind) return this.setBinding(d.bind, d.k, v);
    if (d.coin) return this.inv('coins', { coins: { [d.coin]: Number(v) } });
    if (d.give) { if (v) this.act('give', { id: t.id, to: v, itemId: d.give, qty: 1 }); return; }
    if (d.inote) return this.inv('edit', { itemId: d.inote, patch: { notes: v } });
    if (d.a === 'fill-class' && v) return this.fill('class', v);
    if (d.a === 'fill-species' && v) return this.fill('species', v);
    if (d.a === 'fill-background' && v) return this.fill('background', v);
  }

  onClick(e) {
    const b = e.target.closest('[data-a],[data-tabk],[data-skill],[data-roll]'); if (!b) return;
    const d = b.dataset, t = this.token, s = this.sheet;
    if (d.tabk) { this.tab = d.tabk; return this.render(true); }
    if (!t && d.a !== 'close') return;
    if (d.roll) {
      const [kind, key] = d.roll.split(':');
      if (kind === 'ab') return this.d20(`${ABILITY_NAMES[key]} check`, abilityMod(s.abilities[key]));
      if (kind === 'save') return this.d20(`${ABILITY_NAMES[key]} save`, saveBonus(s, key));
      if (kind === 'skill') return this.d20(cap(key), skillBonus(s, key));
      if (kind === 'init') return this.d20('Initiative', Number(t.initBonus) || 0);
      if (kind === 'death') return this.d20('Death save', 0);
      if (kind === 'atk') { const w = s.weapons[+key]; const m = String(w?.bonus || '').match(/^[+-]?\d+$/); if (w) this.d20(`${w.name} attack`, m ? Number(w.bonus) : 0); return; }
      if (kind === 'dmg') { const w = s.weapons[+key]; if (w?.damage) this.roll(`${w.name} damage`, w.damage); return; }
      if (kind === 'hd') return this.roll('Hit die', `1d${s.hitDice.die}${fmtModOrEmpty(abilityMod(s.abilities.con))}`);
      if (kind === 'spellatk') return this.d20('Spell attack', spellAttackBonus(s) || 0);
      return;
    }
    if (d.skill) { const cur = s.skills[d.skill], next = !cur ? 'prof' : cur === 'prof' ? 'exp' : null; const sk = { ...s.skills }; if (next) sk[d.skill] = next; else delete sk[d.skill]; return this.patchSheet({ skills: sk }); }
    switch (d.a) {
      case 'close': return this.toggle(false);
      case 'hp': return this.askHp();
      case 'ac-suggest': return this.patchToken({ ac: suggestedAC(s, t.inventory || []) });
      case 'insp': return this.patchSheet({ heroicInspiration: !s.heroicInspiration });
      case 'exh': return this.patchSheet({ exhaustion: Math.max(0, Math.min(6, s.exhaustion + Number(d.n))) });
      case 'res-add': return this.patchSheet({ resources: [...s.resources, { name: 'Resource', max: 1, used: 0 }] });
      case 'res-bump': { const list = s.resources.map((x) => ({ ...x })), r = list[+d.i]; r.used = Math.max(0, Math.min(r.max, r.used + Number(d.n))); return this.patchSheet({ resources: list }); }
      case 'slot-bump': { const cur = s.slots[d.l]; if (!cur) return; return this.patchSheet({ slots: { ...s.slots, [d.l]: { ...cur, used: Math.max(0, Math.min(cur.max, cur.used + Number(d.n))) } } }); }
      case 'slots-fill': return this.patchSheet({ slots: slotsFor(s.cls, s.level) });
      case 'levelup': return this.act('levelup', { id: t.id });
      case 'hd-spend': return this.rest('short');
      case 'rest-long': return this.rest('long');
      case 'add-row': { const blank = { weapons: { name: 'Weapon', bonus: '+0', damage: '1d6', type: '', notes: '' }, features: { name: 'Feature', text: '' }, speciesTraits: { name: 'Trait', text: '' }, feats: { name: 'Feat', text: '' },
        spells: { name: 'Spell', level: 0, castingTime: 'Action', range: '', conc: false, ritual: false, material: false, prepared: true, notes: '' } }[d.list];
        return blank ? this.patchSheet({ [d.list]: [...s[d.list], blank] }) : null; }
      case 'del': return this.patchSheet({ [d.list]: s[d.list].filter((_, j) => j !== +d.i) });
      case 'flag': { const list = s.spells.map((x) => ({ ...x })); list[+d.i][d.k] = !list[+d.i][d.k]; return this.patchSheet({ spells: list }); }
      case 'add': return this.addTyped();
      case 'qty': return this.inv('qty', { itemId: d.item, qty: Number(d.n) });
      case 'equip': return this.equip(d.item);
      case 'remove': return this.inv('remove', { itemId: d.item });
      case 'test': return this.caster?.preview?.(d.effect);
      default:
    }
  }

  /** Short rest: spend one hit die (rolled in the tray, healing asked of the DM). Long rest: asked of the DM. */
  rest(kind) {
    const t = this.token, s = this.sheet; if (!t) return;
    if (kind === 'long') return this.act('rest', { id: t.id, kind: 'long' });
    if (hitDiceLeft(s) <= 0) { (this.dm.toast || this.dm.narrate)?.call(this.dm, 'No hit dice left: take a long rest.'); return null; }
    const con = abilityMod(s.abilities.con), heal = Math.max(1, 1 + Math.floor(Math.random() * s.hitDice.die) + con);
    return this.act('rest', { id: t.id, kind: 'short', heal });
  }

  /** Equip toggles the row; a weapon preset also adds (or removes) its row in the weapons table. */
  equip(itemId) {
    const t = this.token, s = this.sheet, it = (t.inventory || []).find((x) => x.id === itemId); if (!it) return;
    this.inv('equip', { itemId });
    const row = weaponRow(it.ref, it.name, s);
    if (row && !it.equipped && !s.weapons.some((w) => w.name === row.name)) this.patchSheet({ weapons: [...s.weapons, row] });
    if (it.ref === 'shield') this.patchSheet({ shield: !it.equipped });
  }

  /** Adds the typed item: a preset, a renamed preset (keeps its icon), or anything else with the closest icon. */
  addTyped() {
    const nameEl = this.el.querySelector('[data-a="add-name"]'), qtyEl = this.el.querySelector('[data-add-qty]');
    const name = nameEl?.value.trim(); if (!name) return;
    const r = resolveItem(name), qty = Math.max(1, Number(qtyEl?.value) || 1);
    this.inv('add', { item: { ref: r.ref, name: r.preset && r.ref ? r.preset.name : name, icon: r.icon }, qty });
    nameEl.value = ''; if (qtyEl) qtyEl.value = 1; nameEl.focus();
  }

  setBinding(gesture, key, value) {
    const list = this.sheet.castBindings.map((x) => ({ ...x }));
    let b = list.find((x) => x.gesture === gesture);
    if (!b) { b = { gesture, effectId: '', label: '', roll: '' }; list.push(b); }
    b[key] = value;
    this.patchSheet({ castBindings: list.filter((x) => x.effectId) });
  }

  /** "Fill from…" pickers: apply a class, species or background to the sheet (everything stays editable). */
  fill(kind, id) {
    const t = this.token, s = this.sheet; if (!t) return;
    if (kind === 'class') { const r = applyClass(s, id); if (!r) return; this.patchSheet(r.sheet); if (this.free) this.patchToken({ ac: r.ac, model: r.model }); }
    if (kind === 'species') { const r = applySpecies(s, id); if (r) this.patchSheet(r); }
    if (kind === 'background') { const r = applyBackground(s, id); if (r) this.patchSheet(r.sheet); }
  }

  // ---------- render ----------
  render(force = false) {
    if (!this.el) return;
    const hasAny = this.choices.length > 0 && this.sync?.role != null;
    this.btn.hidden = !hasAny || !this.el.hidden || !!this.doc.body.classList.contains('in-lobby');
    if (this.el.hidden) return;
    if (!force && typingIn(this.el)) return;
    const t = this.token;
    if (!t) { this.el.innerHTML = `<header><b>Character</b><button aria-label="Close" class="ghost" data-a="close">${closeIcon()}</button></header><div class="cs-body muted">No character yet. Join the table (or the DM adds one in the Table tab).</div>`; return; }
    const picker = this.isDM && this.choices.length > 1 ? `<select data-pick="1" aria-label="Which character">${this.choices.map((c) => `<option value="${c.id}"${c.id === t.id ? ' selected' : ''}>${esc(c.name)}${c.kind === 'item' ? ' (container)' : ''}</option>`).join('')}</select>` : '';
    const tabs = t.kind === 'item' ? [['inv', 'Contents', 'sheet/inventory']] : TABS;
    if (!tabs.some(([k]) => k === this.tab)) this.tab = tabs[0][0];
    const body = this.pageHTML(this.tab, t);
    const scroll = this.el.querySelector('.cs-body')?.scrollTop || 0;
    this.el.innerHTML = `<header><b>${esc(t.name)}</b>${picker}<button class="ghost" data-a="close" title="Close (K)" aria-label="Close">${closeIcon()}</button></header>
      <nav>${tabs.map(([k, l, ic]) => `<button data-tabk="${k}" class="${k === this.tab ? 'on' : ''}">${kitIcon(symKey(ic), { cls: 'cs-tab-ic' })}<span>${l}</span></button>`).join('')}</nav><div class="cs-body">${body}</div>`;
    this.el.querySelector('.cs-body').scrollTop = scroll;
  }

  /** HTML of one page for a token (also used by the stage-1 builder's review step). */
  pageHTML(tab, t) { return { sheet: () => this.sheetHTML(t), spells: () => this.spellsHTML(t), inv: () => this.invHTML(t), story: () => this.storyHTML(t) }[tab](); }

  sheetHTML(t) {
    const s = t.sheet || defaultSheet(), pb = profBonus(s.level), free = this.free, ro = free ? '' : ' disabled';
    const inp = (k, w = 90, num = false, extra = '') => `<input data-s="${k}"${num ? ' data-num="1" type="number"' : ''} style="width:${w}px" value="${esc(s[k])}"${extra}>`;
    const fillSel = (kind, ids, src) => `<select data-a="fill-${kind}" title="Fill the sheet from a ${kind}" aria-label="Fill from a ${kind}"><option value="">fill…</option>${ids.map((k) => `<option value="${k}">${esc(src[k].name)}</option>`).join('')}</select>`;
    const hp = t.hp != null ? `${t.hp}<small> / ${t.maxHp}</small>` : esc(t.hpBand || '—');
    const ds = t.deathSaves, pips = (n, ch) => ch.repeat(n || 0) + '·'.repeat(3 - (n || 0));
    const nx = nextLevelXp(s.level), sac = suggestedAC(s, t.inventory || []);
    const skillsOf = (ab) => Object.keys(SKILLS).filter((k) => SKILLS[k] === ab).map((k) => { const p = s.skills[k];
      return `<div class="sk"><button class="pill ${p || ''}" data-skill="${k}" title="Click: proficient → expertise → none" aria-label="${esc(k)} proficiency">${p === 'exp' ? '◆' : p === 'prof' ? '●' : '○'}</button><button class="rollable" data-roll="skill:${k}" title="Roll ${esc(cap(k))}">${fmtMod(skillBonus(s, k))} ${esc(cap(k))}</button></div>`; }).join('');
    const featBox = (list, title, key) => `<h4>${title} <button aria-label="Add" data-a="add-row" data-list="${key}" title="Add">${glyph('ctl/plus')}</button></h4>${s[key].map((f, i) => `<details class="feat"${f.text ? '' : ' open'}><summary><input data-list="${key}" data-i="${i}" data-k="name" value="${esc(f.name)}"><button aria-label="Remove" class="ghost" data-a="del" data-list="${key}" data-i="${i}" title="Remove">${closeIcon()}</button></summary><textarea data-list="${key}" data-i="${i}" data-k="text">${esc(f.text)}</textarea></details>`).join('') || `<div class="muted">${list}</div>`}`;
    return `<div class="cs-head">
        <label class="grow">Character name<input data-tok="name" maxlength="24" value="${esc(t.name)}"${ro}></label>
        <label>Background<span class="pair">${inp('background', 96)}${fillSel('background', BACKGROUND_IDS, ORIGINS.backgrounds)}</span></label>
        <label>Class<span class="pair">${inp('cls', 96)}${fillSel('class', CLASS_IDS, CLASSES)}</span></label>
        <label>Species<span class="pair">${inp('species', 96)}${fillSel('species', SPECIES_IDS, ORIGINS.species)}</span></label>
        <label>Subclass${inp('subclass', 100)}</label>
        <label>Level${inp('level', 50, true, ' min="1" max="20"')}</label>
        <label>XP${inp('xp', 74, true, ' min="0"')}<small>${nx ? `next: ${nx}` : 'max level'}</small></label>
        ${s.level < 20 && (this.isDM || canLevelUp(s)) ? `<button class="btn ok" data-a="levelup" title="${this.isDM ? 'Raise this character one level' : 'You have the experience: ask the DM to level up'}">Level up</button>` : ''}
      </div>
      <div class="cs-core">
        <div class="stat ac">${iconHTML('ac', 'gi-xl')}<span>Armor Class</span><b><input data-tok="ac" data-num="1" type="number" value="${t.ac}"${ro} aria-label="Armor class"></b>
          <label class="muted"><input type="checkbox" data-s="shield"${s.shield ? ' checked' : ''}> shield</label>${sac !== t.ac && free ? `<button class="tiny" data-a="ac-suggest" title="Use the AC your equipped armor suggests">use ${sac}</button>` : ''}</div>
        <div class="stat hp">${iconHTML('hp', 'gi-xl')}<span>Hit Points</span><b>${hp}</b>${t.tempHp ? `<small>${iconHTML('temp-hp')}+${t.tempHp} temp</small>` : ''}
          ${free ? `<label class="muted">max <input data-tok="maxHp" data-num="1" type="number" min="1" value="${t.maxHp}" style="width:54px"></label>` : ''}
          <span class="pair"><input data-hp-expr placeholder="-7 · +3" title="Damage or healing: ${this.isDM ? 'applies now' : 'the DM approves it'}" aria-label="Change hit points"><button data-a="hp" title="${this.isDM ? 'Apply' : 'Ask the DM to apply'}">✔</button></span></div>
        <div class="stat">${kitIcon(`dice/d${s.hitDice?.die || 8}`, { cls: 'gi gi-lg' }) || iconHTML('d20', 'gi-lg')}<span>Hit Dice</span><b>${hitDiceLeft(s)}<small> / ${s.level}</small></b>
          <span class="pair">d<select data-hd="die" aria-label="Hit die">${[6, 8, 10, 12].map((n) => `<option${n === s.hitDice.die ? ' selected' : ''}>${n}</option>`).join('')}</select></span>
          <span class="pair"><button class="tiny" data-a="hd-spend" title="Short rest: spend one hit die to heal (the DM approves)">Short rest</button><button class="tiny" data-a="rest-long" title="Long rest: everything back (the DM approves)">Long rest</button></span></div>
        <div class="stat">${iconHTML('death-save', 'gi-lg')}<span>Death Saves</span><b class="ds"><span class="ok">${pips(ds?.success, '✔')}</span> <span class="bad">${pips(ds?.fail, '✖')}</span></b>
          <button class="tiny rollable" data-roll="death:0">Roll</button></div>
        <div class="stat sm">${iconHTML('prof', 'gi-lg')}<span>Proficiency</span><b>${fmtMod(pb)}</b></div>
        <div class="stat sm">${iconHTML('initiative', 'gi-lg')}<span>Initiative</span><b><input data-tok="initBonus" data-num="1" type="number" value="${t.initBonus}"${ro} aria-label="Initiative bonus"></b><button class="tiny rollable" data-roll="init:0">Roll</button></div>
        <div class="stat sm">${iconHTML('speed', 'gi-lg')}<span>Speed</span><b>${inp('speed', 52, true)}</b></div>
        <div class="stat sm"><span>Size</span><b><select data-s="size" aria-label="Size">${SIZES.map((z) => `<option${z === s.size ? ' selected' : ''}>${z}</option>`).join('')}</select></b></div>
        <div class="stat sm">${iconHTML('passive', 'gi-lg')}<span>Passive Perception</span><b>${passivePerception(s)}</b></div>
        <div class="stat sm">${iconHTML('inspiration', 'gi-lg')}<span>Heroic Inspiration</span><b><button class="pill ${s.heroicInspiration ? 'prof' : ''}" data-a="insp" aria-pressed="${s.heroicInspiration}">${s.heroicInspiration ? '★' : '☆'}</button></b></div>
        <div class="stat sm">${iconHTML('exhaustion', 'gi-lg')}<span>Exhaustion</span><b><button class="tiny" data-a="exh" data-n="-1" aria-label="Less exhaustion" title="Less exhaustion">${glyph('ctl/minus')}</button> ${s.exhaustion} <button class="tiny" data-a="exh" data-n="1" aria-label="More exhaustion" title="More exhaustion">${glyph('ctl/plus')}</button></b></div>
      </div>
      <div class="cs-cols"><div class="cs-abils">${ABILITIES.map((a) => `<div class="abil">
          <div class="abil-h">${iconHTML(a, 'gi-xl')}<div><button class="rollable abil-name" data-roll="ab:${a}" title="Roll a ${ABILITY_NAMES[a]} check">${ABILITY_NAMES[a]}</button>
            <div class="mod">${fmtMod(abilityMod(s.abilities[a]))}</div></div><input type="number" data-ab="${a}" min="1" max="30" value="${s.abilities[a]}" aria-label="${ABILITY_NAMES[a]} score"></div>
          <div class="sk"><input type="checkbox" data-save="${a}"${s.saves[a] ? ' checked' : ''} aria-label="${ABILITY_NAMES[a]} save proficiency"><button class="rollable" data-roll="save:${a}" title="Roll a ${ABILITY_NAMES[a]} saving throw">${fmtMod(saveBonus(s, a))} Saving throw</button></div>
          ${skillsOf(a)}</div>`).join('')}</div>
      <div class="cs-right">
        <h4>Weapons &amp; damage cantrips <button aria-label="Add" data-a="add-row" data-list="weapons" title="Add">${glyph('ctl/plus')}</button></h4>
        <table class="wtab"><thead><tr><th>Name</th><th>Atk / DC</th><th>Damage &amp; type</th><th>Notes</th><th></th></tr></thead><tbody>${s.weapons.map((w, i) => `<tr>
          <td><input data-list="weapons" data-i="${i}" data-k="name" value="${esc(w.name)}"></td>
          <td><span class="pair"><input data-list="weapons" data-i="${i}" data-k="bonus" value="${esc(w.bonus)}" style="width:58px"><button class="tiny rollable" data-roll="atk:${i}" title="Roll the attack">🎲</button></span></td>
          <td><span class="pair"><input data-list="weapons" data-i="${i}" data-k="damage" value="${esc(w.damage)}" style="width:62px"><input data-list="weapons" data-i="${i}" data-k="type" value="${esc(w.type)}" style="width:70px" placeholder="type"><button class="tiny rollable" data-roll="dmg:${i}" title="Roll the damage">🎲</button></span></td>
          <td><input data-list="weapons" data-i="${i}" data-k="notes" value="${esc(w.notes)}"></td><td><button aria-label="Remove" class="ghost" data-a="del" data-list="weapons" data-i="${i}" title="Remove">${closeIcon()}</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Equip a weapon in your bag, or add a row.</td></tr>'}</tbody></table>
        <h4>Resources <button aria-label="Add" data-a="res-add" title="Add">${glyph('ctl/plus')}</button></h4>${s.resources.map((r, i) => `<div class="row"><input data-list="resources" data-i="${i}" data-k="name" value="${esc(r.name)}" style="flex:1">
          <button aria-label="Spend" data-a="res-bump" data-i="${i}" data-n="1" title="Spend">${glyph('ctl/minus')}</button><b>${r.max - r.used} / </b><input data-list="resources" data-i="${i}" data-k="max" data-num="1" type="number" value="${r.max}" style="width:50px">
          <button aria-label="Recover" data-a="res-bump" data-i="${i}" data-n="-1" title="Recover">${glyph('ctl/plus')}</button><button aria-label="Close" class="ghost" data-a="del" data-list="resources" data-i="${i}">${closeIcon()}</button></div>`).join('') || '<div class="muted">Rages, channel divinity, ki… anything you count.</div>'}
        ${featBox('Fill from a class, or add your own.', 'Class features', 'features')}
        ${featBox('Fill from a species, or add your own.', 'Species traits', 'speciesTraits')}
        ${featBox('Your background gives your first feat.', 'Feats', 'feats')}
        <h4>Equipment training &amp; proficiencies</h4>
        <div class="row">Armor: ${['light', 'medium', 'heavy', 'shields'].map((k) => `<label class="inline"><input type="checkbox" data-train="${k}"${s.training[k] ? ' checked' : ''}> ${cap(k)}</label>`).join('')}</div>
        <label class="wide">Weapons<input data-train="weapons" value="${esc(s.training.weapons)}"></label>
        <label class="wide">Tools<input data-train="tools" value="${esc(s.training.tools)}"></label>
        <h4>Defences</h4>
        <label class="wide">Resistances<input data-s="resist" value="${esc(s.resist)}" placeholder="fire, poison…"></label>
        <label class="wide">Vulnerabilities<input data-s="vulnerable" value="${esc(s.vulnerable)}"></label>
        <label class="wide">Immunities<input data-s="immune" value="${esc(s.immune)}"></label>
      </div></div>`;
  }

  spellsHTML(t) {
    const s = t.sheet || defaultSheet(), dc = spellSaveDC(s), atk = spellAttackBonus(s);
    const slotRow = (l) => { const x = s.slots[l] || { max: 0, used: 0 };
      return `<div class="slot"><small>Level ${l}</small><input data-slot="${l}" type="number" min="0" max="9" value="${x.max}" aria-label="Level ${l} slots">
        <div class="pips">${Array.from({ length: x.max }, (_, i) => `<button class="pip ${i < x.used ? 'used' : ''}" data-a="slot-bump" data-l="${l}" data-n="${i < x.used ? -1 : 1}" title="${i < x.used ? 'Recover' : 'Expend'} a level ${l} slot" aria-label="${i < x.used ? 'Expended' : 'Available'} slot"></button>`).join('')}</div></div>`; };
    return `<div class="cs-core">
        <div class="stat"><span>Spellcasting ability</span><b><select data-s="castAbility" aria-label="Spellcasting ability"><option value="">—</option>${ABILITIES.map((a) => `<option value="${a}"${a === s.castAbility ? ' selected' : ''}>${ABILITY_NAMES[a]}</option>`).join('')}</select></b></div>
        <div class="stat sm"><span>Modifier</span><b>${s.castAbility ? fmtMod(abilityMod(s.abilities[s.castAbility])) : '—'}</b></div>
        <div class="stat sm">${iconHTML('save', 'gi-lg')}<span>Spell save DC</span><b>${dc ?? '—'}</b></div>
        <div class="stat sm">${iconHTML('attack', 'gi-lg')}<span>Spell attack</span><b>${atk != null ? fmtMod(atk) : '—'}</b>${atk != null ? '<button class="tiny rollable" data-roll="spellatk:0">Roll</button>' : ''}</div>
      </div>
      <h4>Spell slots <button class="tiny" data-a="slots-fill" title="Set the slots your class and level give">from class</button></h4>
      <div class="slots">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(slotRow).join('')}</div>
      <h4>Cantrips &amp; prepared spells <button aria-label="Add" data-a="add-row" data-list="spells" title="Add">${glyph('ctl/plus')}</button></h4>
      <table class="wtab stab"><thead><tr><th>Lvl</th><th>Name</th><th>Casting time</th><th>Range</th><th title="Concentration, Ritual, Material">C R M</th><th>Notes</th><th></th></tr></thead><tbody>${s.spells.map((f, i) => `<tr class="${f.prepared ? '' : 'unprep'}">
        <td><input data-list="spells" data-i="${i}" data-k="level" data-num="1" type="number" min="0" max="9" value="${f.level}" style="width:42px"></td>
        <td><input data-list="spells" data-i="${i}" data-k="name" value="${esc(f.name)}"></td>
        <td><input data-list="spells" data-i="${i}" data-k="castingTime" value="${esc(f.castingTime)}" style="width:80px"></td>
        <td><input data-list="spells" data-i="${i}" data-k="range" value="${esc(f.range)}" style="width:70px"></td>
        <td class="crm">${[['conc', 'C', 'Concentration'], ['ritual', 'R', 'Ritual'], ['material', 'M', 'Material component'], ['prepared', '✓', 'Prepared']].map(([k, l, tt]) => `<button class="pill ${f[k] ? 'prof' : ''}" data-a="flag" data-i="${i}" data-k="${k}" title="${tt}" aria-pressed="${!!f[k]}">${l}</button>`).join('')}</td>
        <td><input data-list="spells" data-i="${i}" data-k="notes" value="${esc(f.notes)}"></td>
        <td><button aria-label="Remove" class="ghost" data-a="del" data-list="spells" data-i="${i}" title="Remove">${closeIcon()}</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Add the spells you know.</td></tr>'}</tbody></table>
      <h4>Gesture spells <span class="muted">(your four hand signs: any effect on any gesture)</span></h4>
      <div class="muted">In VR or with webcam hands: hold the shape for a moment, then do its move: flick your pointing finger forward, drop your thumb for Finger gun, push your palm forward, or swipe your flat hand sideways for Slash. On desktop: Shift+1…4, then click a target. When the DM confirms your damage, one of these gestures delivers it.</div>
      ${GESTURES.map((g, i) => { const b = s.castBindings.find((x) => x.gesture === g) || {}; return `<div class="bind"><span class="bind-ic">${kitIcon(`gesture/${g}`, { cls: 'gi gi-xl' })}</span><b>${i + 1}. ${GESTURE_LABELS[g]}</b>
        <select data-bind="${g}" data-k="effectId" aria-label="${GESTURE_LABELS[g]} effect">${effectOptions(b.effectId)}</select>
        <input data-bind="${g}" data-k="label" placeholder="name (optional)" value="${esc(b.label || '')}">
        <input data-bind="${g}" data-k="roll" placeholder="dice: 8d6" value="${esc(b.roll || '')}" title="Dice shown when you cast it freely">
        <button data-a="test" data-effect="${esc(b.effectId || '')}"${b.effectId ? '' : ' disabled'}>Test</button></div>`; }).join('')}`;
  }

  invHTML(t) {
    const s = t.sheet || defaultSheet(), inv = t.inventory || [], coins = t.coins || {}, others = (this.dm.state.tokens || []).filter((x) => x.id !== t.id && (x.kind === 'pc' || x.kind === 'item'));
    const canEdit = this.isDM || t.owner === this.myId;
    const give = (it) => (others.length ? `<select data-give="${it.id}" title="Give one" aria-label="Give ${esc(it.name)} to"><option value="">${t.kind === 'item' ? 'take…' : 'give…'}</option>${others.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>` : '');
    return `${canEdit ? `<h4>Coins</h4><div class="row coins">${COINS.map((c) => `<label>${kitIcon(COIN_ART[c] || 'item/gold-coin', { cls: 'gi gi-lg' }).replace('<img ', `<img data-coin="${c}" `)}${c.toUpperCase()}<input type="number" min="0" data-coin="${c}" value="${coins[c] || 0}"></label>`).join('')}</div>
      <div class="row"><input data-a="add-name" list="cs-presets" placeholder="Add an item: rope, potion of healing, troll tooth…" style="flex:1" aria-label="Item to add">
        <input data-add-qty type="number" min="1" value="1" style="width:56px" aria-label="Quantity"><button data-a="add">Add</button></div>
      <datalist id="cs-presets">${presetList().map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>` : ''}
      <h4>${t.kind === 'item' ? 'Contents' : 'Equipment'} (${inv.reduce((n, x) => n + x.qty, 0)})</h4>
      <div class="items">${inv.map((it) => `<div class="item${it.equipped ? ' eq' : ''}" title="${esc(it.notes || it.name)}"><div class="ic">${itemIconMarkup(it)}</div>
        <div class="nm">${esc(it.name)}${it.qty > 1 ? ` ×${it.qty}` : ''}</div>
        <div class="ctl">${canEdit ? `<button aria-label="Use one" data-a="qty" data-item="${it.id}" data-n="-1" title="Use one">${glyph('ctl/minus')}</button><button aria-label="Add one" data-a="qty" data-item="${it.id}" data-n="1" title="Add one">${glyph('ctl/plus')}</button>
          ${t.kind === 'pc' ? `<button data-a="equip" data-item="${it.id}" title="${it.equipped ? 'Unequip' : 'Equip'}" aria-pressed="${it.equipped}">${it.equipped ? '★' : '☆'}</button>` : ''}` : ''}${give(it)}${canEdit ? `<button aria-label="Drop" class="ghost" data-a="remove" data-item="${it.id}" title="Drop">${closeIcon()}</button>` : ''}</div>
        ${canEdit ? `<input data-inote="${it.id}" placeholder="notes" value="${esc(it.notes)}" style="grid-column:1/3" aria-label="Notes for ${esc(it.name)}">` : ''}</div>`).join('') || '<div class="muted">Empty.</div>'}</div>
      ${t.kind === 'pc' ? `<h4>Magic item attunement <span class="muted">(up to ${MAX_ATTUNED})</span></h4><div class="row">${Array.from({ length: MAX_ATTUNED }, (_, i) => `<input data-att="${i}" value="${esc(s.attuned[i] || '')}" placeholder="—" style="flex:1" aria-label="Attuned item ${i + 1}">`).join('')}</div>` : ''}`;
  }

  storyHTML(t) {
    const s = t.sheet || defaultSheet();
    return `<div class="row"><label>Alignment<select data-s="alignment"><option value="">—</option>${ORIGINS.alignments.map((a) => `<option${a === s.alignment ? ' selected' : ''}>${a}</option>`).join('')}</select></label>
        <label class="grow">Languages<input data-s="languages" value="${esc(s.languages)}"></label></div>
      <h4>Appearance</h4><textarea data-s="appearance">${esc(s.appearance)}</textarea>
      <h4>Backstory &amp; personality</h4><textarea data-s="backstory" style="min-height:160px">${esc(s.backstory)}</textarea>
      <h4>Notes</h4><textarea data-tok="notes" style="min-height:120px"${this.free ? '' : ' disabled'}>${esc(t.notes)}</textarea>`;
  }
}

const fmtModOrEmpty = (n) => (n ? (n > 0 ? `+${n}` : `${n}`) : '');
