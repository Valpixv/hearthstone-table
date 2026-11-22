// Stage 1 of a session (design/completion-plan.md §3.3, §4.4): each player builds their character on a desktop before
// anyone puts a headset on. A guided pass over the same sheet the Character window edits: class → origin → ability
// scores (rolled 4d6 drop lowest, standard array or point buy) → skills & hit points → details → review → Ready.
// Everything is a suggestion: any step can be skipped and every number can be overtyped on the full sheet afterwards.
// The draft lives in this browser (localStorage) and is written to the player's token with dm.act('build').
// After Ready the same overlay becomes the waiting room and, when the DM begins, the "put on your headset" screen.
import CLASSES from '../data/classes.json';
import ORIGINS from '../data/origins.json';
import MODELS from '../data/models.json';
import { esc } from '../ui/actions.js';
import { kitIcon, kitHas, glyph } from '../ui/kit.js';
import { iconHTML } from '../ui/icons.js';
import { PRESETS } from '../rules/itemIcon.js';
import { effectOptions } from './CharacterSheet.js';
import { ABILITIES, ABILITY_NAMES, SKILLS, GESTURES, GESTURE_LABELS, CLASS_IDS, SPECIES_IDS, BACKGROUND_IDS, STANDARD_ARRAY, POINT_BUY,
  defaultSheet, normalizeSheet, abilityMod, fmtMod, applyClass, applySpecies, applyBackground, rollAbilityScores, pointBuyCost,
  suggestedAC, completeness, slotsFor } from './sheet.js';
import { parse } from '../rules/dicePool.js';

const STEPS = [['class', 'Class'], ['origin', 'Origin'], ['abilities', 'Abilities'], ['skills', 'Skills & HP'], ['details', 'Details'], ['review', 'Review']];
const HEROES = Object.keys(MODELS.heroes || {}).filter((k) => !k.startsWith('_'));
const KEY = 'hearthstone-builder';
const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const portrait = (id) => (kitHas(`creature/${id}`) ? `creature/${id}` : `creature/${CLASSES[id]?.model || 'fighter'}`);

/** A fresh draft. */
export function newDraft(name = '') {
  return { name, cls: '', species: '', background: '', level: 1, method: 'array', pool: [...STANDARD_ARRAY], rolled: null,
    assign: { str: null, dex: null, con: null, int: null, wis: null, cha: null }, buy: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
    boosts: null, skills: [], hp: null, alignment: '', appearance: '', backstory: '', model: '', bindings: null };
}

/** Base ability scores of a draft before background boosts (10 where nothing is assigned yet). */
export function draftScores(d) {
  if (d.method === 'buy') return { ...d.buy };
  return Object.fromEntries(ABILITIES.map((a) => [a, d.assign[a] != null && d.pool[d.assign[a]] != null ? d.pool[d.assign[a]] : 10]));
}

/** Puts the pool's values on the abilities in the order the class cares about them (its suggested array, highest first). */
export function autoAssign(d) {
  const want = CLASSES[d.cls]?.abilities || { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
  const order = [...ABILITIES].sort((x, y) => want[y] - want[x]);
  const idx = d.pool.map((v, i) => [v, i]).sort((x, y) => y[0] - x[0]).map((x) => x[1]);
  const assign = {}; order.forEach((a, i) => { assign[a] = idx[i] ?? null; });
  return { ...d, assign };
}

/**
 * Turns a draft into what the token becomes: { token, sheet, inventory, coins }. Pure.
 * Class sets hit die, saves, training, features, gear; species sets size, speed, traits; background adds skills, a feat,
 * gear and ability boosts; picked skills and typed details go on top.
 */
export function buildCharacter(d) {
  let sheet = normalizeSheet({ ...defaultSheet(), level: d.level, abilities: draftScores(d), alignment: d.alignment, appearance: d.appearance, backstory: d.backstory });
  let gear = [], gold = 0, ac = 10, model = d.model || 'fighter', hitDie = 8;
  if (CLASSES[d.cls]) { const r = applyClass(sheet, d.cls); sheet = r.sheet; gear = gear.concat(r.gear); gold += r.gold; ac = r.ac; model = d.model || r.model; hitDie = CLASSES[d.cls].hitDie; }
  if (ORIGINS.species[d.species]) sheet = applySpecies(sheet, d.species);
  if (ORIGINS.backgrounds[d.background]) { const r = applyBackground(sheet, d.background, { boosts: d.boosts }); sheet = r.sheet; gear = gear.concat(r.gear); gold += r.gold; }
  for (const k of d.skills) if (SKILLS[k] && !sheet.skills[k]) sheet.skills[k] = 'prof';
  if (CLASSES[d.cls]) {
    // Class rows that depend on the scores are recomputed now that boosts are in.
    const again = applyClass({ ...sheet }, d.cls);
    sheet = normalizeSheet({ ...sheet, weapons: again.sheet.weapons, slots: slotsFor(d.cls, d.level) });
  }
  if (d.bindings) sheet.castBindings = normalizeSheet({ castBindings: d.bindings }).castBindings;
  const con = abilityMod(sheet.abilities.con), avg = Math.floor(hitDie / 2) + 1;
  const maxHp = Math.max(1, d.hp ?? (hitDie + con + (d.level - 1) * Math.max(1, avg + con)));
  const inv = new Map();
  for (const [id, qty] of gear) { if (!PRESETS[id]) continue; inv.set(id, (inv.get(id) || 0) + qty); }
  const inventory = [...inv].map(([id, qty]) => ({ ref: id, name: PRESETS[id].name, qty, icon: { kind: 'preset', key: PRESETS[id].icon },
    equipped: !!ORIGINS.armorAC[id] || id === 'shield' }));
  // Only one suit of armor is worn.
  let worn = false; for (const it of inventory) if (ORIGINS.armorAC[it.ref]) { if (worn) it.equipped = false; worn = true; }
  const shownAc = CLASSES[d.cls] ? Math.max(suggestedAC(sheet, inventory), 10) : ac;
  return { token: { name: d.name || 'Adventurer', model: HEROES.includes(model) ? model : 'fighter', maxHp, hp: maxHp, ac: shownAc, initBonus: abilityMod(sheet.abilities.dex), speed: sheet.speed },
    sheet, inventory, coins: { gp: gold } };
}

/** A legal level-1 character in one click: random class, species and background, the class's suggested array. */
export function quickDraft(name, rand = Math.random) {
  const pick = (a) => a[Math.floor(rand() * a.length)];
  let d = newDraft(name);
  d.cls = pick(CLASS_IDS); d.species = pick(SPECIES_IDS); d.background = pick(BACKGROUND_IDS);
  d = autoAssign(d);
  const c = CLASSES[d.cls], choices = (c.skills === 'any' ? Object.keys(SKILLS) : c.skills).filter((k) => !ORIGINS.backgrounds[d.background].skills.includes(k));
  d.skills = choices.slice(0, c.skillPick);
  return d;
}

export class SheetBuilder {
  /**
   * @param {{ dm: object, sync: object, rolls?: object, sheetWin?: object, onEnterVR?: Function, canVR?: () => boolean, doc?: Document }} deps
   */
  constructor({ dm, sync, rolls = null, sheetWin = null, onEnterVR = null, canVR = () => false, doc = globalThis.document }) {
    Object.assign(this, { dm, sync, rolls, sheetWin, onEnterVR, canVR, doc });
    this.step = 0; this.enabled = false; this.editing = true; this.dismissed = false; this.busy = false; this.draft = newDraft();
    if (!doc) return;
    this.el = doc.createElement('div'); this.el.id = 'lobby'; this.el.hidden = true; doc.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('change', (e) => this.onChange(e));
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
    dm.on(() => this.render());
  }

  /** Turns the builder on for this session (not in test mode). Restores a draft saved in this browser for this name. */
  enable(name) {
    this.enabled = true;
    let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { saved = null; }
    this.draft = saved && saved.name === name ? { ...newDraft(name), ...saved } : newDraft(name);
    this.render();
  }

  get token() { const id = this.sync?.me?.id; return id ? (this.dm.state.tokens || []).find((t) => t.kind === 'pc' && t.owner === id) || null : null; }
  get stage() { return this.dm.state.session?.stage || 'play'; }
  get ready() { const t = this.token; return !!(t && this.dm.state.session?.ready?.[t.id]); }
  /** What the overlay shows: 'off' | 'build' | 'wait' | 'headset'. */
  get mode() {
    if (!this.enabled || this.sync?.role !== 'player' || !this.token) return 'off';
    if (!this.ready || this.editing) return 'build';
    if (this.stage === 'lobby') return 'wait';
    return this.dismissed ? 'off' : 'headset';
  }

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.draft)); } catch { /* storage unavailable */ } }
  set(patch, { commit = true } = {}) { this.draft = { ...this.draft, ...patch }; this.save(); if (commit) this.commit(); this.render(true); }

  /** Writes the draft onto the player's token. */
  commit() {
    const t = this.token; if (!t) return;
    const c = buildCharacter(this.draft);
    try { this.dm.act('build', { id: t.id, ...c }); } catch (e) { console.warn('[builder]', e); }
  }

  /** Rolls six ability scores. Physical: real dice are thrown one score at a time while the overlay steps aside. */
  async rollScores({ physical = true } = {}) {
    if (this.busy) return;
    const canThrow = physical && this.rolls && !this.rolls.dice?.locked;
    let rolled;
    if (!canThrow) rolled = rollAbilityScores();
    else {
      this.sheetWin?.toggle(false); // the full sheet would show through while the table is uncovered for the throw
      this.busy = true; this.el.classList.add('rolling'); rolled = [];
      for (let i = 0; i < 6; i++) {
        this.progress = `Rolling score ${i + 1} of 6…`; this.render(true);
        // eslint-disable-next-line no-await-in-loop
        const r = await new Promise((done) => { const to = setTimeout(() => done(null), 12000); this.rolls.rollPool(parse('4d6kh3'), { physical: true, onDone: (x) => { clearTimeout(to); done(x); } }); });
        rolled.push(r ? { total: r.total, dice: r.dice.map((x) => x.value) } : rollAbilityScores()[0]);
      }
      this.busy = false; this.progress = ''; this.el.classList.remove('rolling');
    }
    const text = rolled.map((r) => r.total).join(', ');
    this.rolls?.onAnnounce?.({ who: this.draft.name || 'A player', text: `Ability scores (4d6 drop lowest): ${text}`, secret: false });
    this.set(autoAssign({ ...this.draft, method: 'roll', rolled, pool: rolled.map((r) => r.total) }));
  }

  onChange(e) {
    const d = e.target.dataset, v = e.target.value, D = this.draft;
    if (d.f) return this.set({ [d.f]: d.num ? Math.max(1, Math.min(20, Number(v) || 1)) : v });
    if (d.assign) {
      // Picking a value for an ability swaps it with whichever ability held it.
      const idx = v === '' ? null : Number(v), assign = { ...D.assign }, other = Object.keys(assign).find((a) => assign[a] === idx && a !== d.assign);
      if (other && idx != null) assign[other] = assign[d.assign];
      assign[d.assign] = idx; return this.set({ assign });
    }
    if (d.boost) {
      const b = ORIGINS.backgrounds[D.background]; if (!b) return;
      const two = d.boost === '2' ? v : (D.boosts && Object.keys(D.boosts).find((k) => D.boosts[k] === 2)) || b.abilities[0];
      let one = d.boost === '1' ? v : (D.boosts && Object.keys(D.boosts).find((k) => D.boosts[k] === 1)) || b.abilities[1];
      if (one === two) one = b.abilities.find((k) => k !== two);
      return this.set({ boosts: { [two]: 2, [one]: 1 } });
    }
    if (d.hp != null) return this.set({ hp: v === '' ? null : Math.max(1, Number(v) || 1) });
    if (d.bind) {
      const cur = buildCharacter(D).sheet.castBindings.map((x) => ({ ...x })); let b = cur.find((x) => x.gesture === d.bind);
      if (!b) { b = { gesture: d.bind, effectId: '' }; cur.push(b); } b.effectId = v;
      return this.set({ bindings: cur.filter((x) => x.effectId) });
    }
  }

  onClick(e) {
    const b = e.target.closest('[data-b]'); if (!b) return;
    const d = b.dataset, D = this.draft;
    switch (d.b) {
      case 'step': this.step = Number(d.i); return this.render(true);
      case 'next': this.step = Math.min(STEPS.length - 1, this.step + 1); return this.render(true);
      case 'back': this.step = Math.max(0, this.step - 1); return this.render(true);
      case 'class': return this.set(autoAssign({ ...D, cls: d.id, skills: [], bindings: null, model: '' }));
      case 'species': return this.set({ species: d.id });
      case 'background': return this.set({ background: d.id, boosts: null, skills: D.skills.filter((k) => !ORIGINS.backgrounds[d.id].skills.includes(k)) });
      case 'method': return this.set(d.id === 'array' ? autoAssign({ ...D, method: 'array', pool: [...STANDARD_ARRAY] }) : d.id === 'roll' ? { method: 'roll', pool: D.rolled ? D.rolled.map((r) => r.total) : [] } : { method: 'buy' });
      case 'roll': return void this.rollScores({ physical: d.how !== 'instant' });
      case 'buy': { const n = D.buy[d.ab] + Number(d.n); if (n < POINT_BUY.min || n > POINT_BUY.max) return null; const buy = { ...D.buy, [d.ab]: n }; if (pointBuyCost(buy) > POINT_BUY.points) return null; return this.set({ buy }); }
      case 'skill': { const c = CLASSES[D.cls], has = D.skills.includes(d.id); if (!has && c && D.skills.length >= c.skillPick) return null; return this.set({ skills: has ? D.skills.filter((k) => k !== d.id) : [...D.skills, d.id] }); }
      case 'quick': this.step = STEPS.length - 1; return this.set(quickDraft(D.name));
      case 'ready': this.commit(); this.editing = false; this.dm.act('ready', { id: this.token.id, on: true }); return this.render(true);
      case 'edit': this.editing = true; this.dismissed = false; return this.render(true);
      case 'sheet': return this.sheetWin?.open('sheet');
      case 'vr': this.dismissed = true; this.render(true); return this.onEnterVR?.();
      case 'stay': this.dismissed = true; return this.render(true);
      default: return null;
    }
  }

  // ---------- render ----------
  render(force = false) {
    if (!this.el) return;
    const mode = this.mode;
    this.el.hidden = mode === 'off';
    this.doc.body.classList.toggle('in-lobby', mode === 'build' || mode === 'wait');
    if (mode === 'off') return;
    if (!force && this.el.contains(this.doc.activeElement) && this.doc.activeElement.matches('input:not([type=checkbox]),textarea')) return;
    this.el.dataset.mode = mode;
    this.el.innerHTML = mode === 'build' ? this.buildHTML() : mode === 'wait' ? this.waitHTML() : this.headsetHTML();
  }

  buildHTML() {
    const D = this.draft, t = this.token, comp = completeness(t), key = STEPS[this.step][0];
    const body = { class: () => this.classHTML(), origin: () => this.originHTML(), abilities: () => this.abilitiesHTML(), skills: () => this.skillsHTML(), details: () => this.detailsHTML(), review: () => this.reviewHTML() }[key]();
    return `<div class="lb-card"><header><img class="lb-logo" src="${kitUrlOf('nav/hearthstone-table')}" alt=""><div><b>Create your character</b><small>Stage 1 of 2 · do this on a desktop, then put your headset on</small></div>
        <span class="lb-meter" title="${comp.missing.length ? 'Still open: ' + esc(comp.missing.join(', ')) : 'Everything is filled in'}">${comp.done} / ${comp.total}</span></header>
      <nav class="lb-steps">${STEPS.map(([k, l], i) => `<button data-b="step" data-i="${i}" class="${i === this.step ? 'on' : ''}"><i>${i + 1}</i>${l}</button>`).join('')}</nav>
      <div class="lb-body">${this.busy ? `<p class="lb-progress">${esc(this.progress)} <small>Watch the dice in your tray.</small></p>` : body}</div>
      <footer><button data-b="quick" title="Fill in a complete level 1 character for me">Quick build</button><span class="grow"></span>
        <button data-b="back"${this.step === 0 ? ' disabled' : ''}>Back</button>
        ${this.step < STEPS.length - 1 ? `<button class="btn" data-b="next">Next</button>` : `<button class="btn ok" data-b="ready" id="lb-ready">I'm ready</button>`}</footer></div>`;
  }

  classHTML() {
    const D = this.draft;
    return `<p class="lb-lead">Pick a class. It fills in your hit die, saving throws, training, starting gear and first features. You can change anything later.</p>
      <div class="lb-grid">${CLASS_IDS.map((id) => { const c = CLASSES[id];
        return `<button class="lb-pick ${D.cls === id ? 'on' : ''}" data-b="class" data-id="${id}">${kitIcon(portrait(id), { cls: 'lb-portrait' })}<b>${esc(c.name)}</b>
          <small>d${c.hitDie} · ${c.primary.map((a) => a.toUpperCase()).join(' / ')}${c.caster ? ' · spells' : ''}</small></button>`; }).join('')}</div>
      ${CLASSES[D.cls] ? `<div class="lb-info"><b>${esc(CLASSES[D.cls].name)}</b> ${CLASSES[D.cls].features.map((f) => `<p><i>${esc(f.name)}.</i> ${esc(f.text)}</p>`).join('')}</div>` : ''}`;
  }

  originHTML() {
    const D = this.draft;
    return `<p class="lb-lead">Your species and your background.</p>
      <h4>Species</h4><div class="lb-grid sm">${SPECIES_IDS.map((id) => { const s = ORIGINS.species[id];
        return `<button class="lb-pick ${D.species === id ? 'on' : ''}" data-b="species" data-id="${id}"><b>${esc(s.name)}</b><small>${s.size} · ${s.speed} ft</small><small>${s.traits.slice(0, 2).map((t) => esc(t.name)).join(', ')}…</small></button>`; }).join('')}</div>
      ${ORIGINS.species[D.species] ? `<div class="lb-info">${ORIGINS.species[D.species].traits.map((f) => `<p><i>${esc(f.name)}.</i> ${esc(f.text)}</p>`).join('')}</div>` : ''}
      <h4>Background</h4><div class="lb-grid sm">${BACKGROUND_IDS.map((id) => { const b = ORIGINS.backgrounds[id];
        return `<button class="lb-pick ${D.background === id ? 'on' : ''}" data-b="background" data-id="${id}"><b>${esc(b.name)}</b><small>${b.skills.map(cap).join(', ')}</small><small>${esc(ORIGINS.feats[b.feat].name)} · ${b.abilities.map((a) => a.toUpperCase()).join('/')}</small></button>`; }).join('')}</div>`;
  }

  abilitiesHTML() {
    const D = this.draft, base = draftScores(D), final = buildCharacter(D).sheet.abilities, b = ORIGINS.backgrounds[D.background];
    const two = (D.boosts && Object.keys(D.boosts).find((k) => D.boosts[k] === 2)) || null, one = (D.boosts && Object.keys(D.boosts).find((k) => D.boosts[k] === 1)) || null;
    const methods = [['roll', 'Roll', 'ability/roll-four-d6'], ['array', 'Standard array', 'ability/standard-array'], ['buy', 'Point buy', 'ability/point-buy']];
    let pick = '';
    if (D.method === 'roll') {
      pick = `<div class="row"><button class="btn" data-b="roll">${kitIcon('ability/roll-four-d6', { cls: 'state-mark' })} Roll 4d6, drop the lowest, six times</button><button data-b="roll" data-how="instant" title="No physical dice: results at once">Instant</button></div>
        ${D.rolled ? `<div class="lb-rolled">${D.rolled.map((r) => { const lo = r.dice.indexOf(Math.min(...r.dice)); return `<span><b>${r.total}</b><small>${r.dice.map((x, i) => (i === lo ? `<s>${x}</s>` : x)).join(' ')}</small></span>`; }).join('')}</div>` : '<p class="muted">Your six scores appear here. Everyone at the table sees them in the roll log.</p>'}`;
    } else if (D.method === 'array') pick = `<p class="muted">Standard array: ${STANDARD_ARRAY.join(', ')}. Put each number on one ability.</p>`;
    else pick = `<p class="muted">Point buy: ${POINT_BUY.points - pointBuyCost(D.buy)} of ${POINT_BUY.points} points left. Scores run from ${POINT_BUY.min} to ${POINT_BUY.max}.</p>`;
    const cell = (a) => {
      if (D.method === 'buy') return `<span class="pair"><button data-b="buy" data-ab="${a}" data-n="-1" aria-label="Lower ${ABILITY_NAMES[a]}">${glyph('ctl/minus')}</button><b class="lb-score">${D.buy[a]}</b><button data-b="buy" data-ab="${a}" data-n="1" aria-label="Raise ${ABILITY_NAMES[a]}">${glyph('ctl/plus')}</button></span>`;
      return `<select data-assign="${a}" aria-label="${ABILITY_NAMES[a]} score"><option value="">—</option>${D.pool.map((v, i) => `<option value="${i}"${D.assign[a] === i ? ' selected' : ''}>${v}</option>`).join('')}</select>`;
    };
    return `<p class="lb-lead">Choose how you get your six ability scores, then place them.</p>
      <div class="lb-tabs">${methods.map(([k, l, ic]) => `<button data-b="method" data-id="${k}" class="${D.method === k ? 'on' : ''}">${kitIcon(ic, { cls: 'lb-tab-ic' })}<span>${l}</span></button>`).join('')}</div>${pick}
      <div class="lb-abils">${ABILITIES.map((a) => `<div class="lb-abil">${iconHTML(a, 'gi-xl')}<b>${ABILITY_NAMES[a]}</b>${cell(a)}
        <small>${final[a] !== base[a] ? `${base[a]} + ${final[a] - base[a]} = ` : ''}<b>${final[a]}</b> (${fmtMod(abilityMod(final[a]))})</small></div>`).join('')}</div>
      ${b ? `<div class="row lb-boost">Background (${esc(b.name)}): <label>+2 to <select data-boost="2">${b.abilities.map((k) => `<option value="${k}"${k === two ? ' selected' : ''}>${ABILITY_NAMES[k]}</option>`).join('')}</select></label>
        <label>+1 to <select data-boost="1">${b.abilities.map((k) => `<option value="${k}"${k === one ? ' selected' : ''}>${ABILITY_NAMES[k]}</option>`).join('')}</select></label>
        <small class="muted">${D.boosts ? '' : 'Placed on your two highest for now.'}</small></div>` : '<p class="muted">Pick a background to add its ability boosts.</p>'}`;
  }

  skillsHTML() {
    const D = this.draft, c = CLASSES[D.cls], b = ORIGINS.backgrounds[D.background], built = buildCharacter(D);
    const fixed = b ? b.skills : [], choices = c ? (c.skills === 'any' ? Object.keys(SKILLS) : c.skills) : [];
    return `<p class="lb-lead">${c ? `Choose ${c.skillPick} ${esc(c.name)} skills (${D.skills.length} chosen).` : 'Pick a class to choose its skills.'}${b ? ` Your background already gives ${fixed.map(cap).join(' and ')}.` : ''}</p>
      <div class="lb-skills">${Object.keys(SKILLS).map((k) => { const lock = fixed.includes(k), on = lock || D.skills.includes(k), can = choices.includes(k);
        return `<button class="lb-skill ${on ? 'on' : ''}" data-b="skill" data-id="${k}"${lock || !can ? ' disabled' : ''} aria-pressed="${on}">${kitIcon(`skill/${lock ? 'background-trained' : on ? 'chosen' : can ? 'available' : 'limit-reached'}`, { cls: 'state-mark' })} ${esc(cap(k))} <small>${SKILLS[k].toUpperCase()}${lock ? ' · background' : ''}</small></button>`; }).join('')}</div>
      <h4>Level &amp; hit points</h4>
      <div class="row lb-hp"><label>Level <input type="number" min="1" max="20" data-f="level" data-num="1" value="${D.level}" style="width:60px"></label>
        <label><span>${kitIcon('skill/maximum-hp', { cls: 'state-mark' })}Hit point maximum</span><input type="number" min="1" data-hp value="${D.hp ?? ''}" placeholder="${built.token.maxHp}" style="width:80px"></label>
        <small class="muted">${kitIcon('skill/hit-die', { cls: 'state-mark' })} Suggested ${built.token.maxHp}: the full hit die at level 1, the average after. Type your own if you rolled.</small></div>`;
  }

  detailsHTML() {
    const D = this.draft, built = buildCharacter(D);
    return `<div class="row"><label class="grow">Character name<input data-f="name" maxlength="24" value="${esc(D.name)}"></label>
        <label>Alignment<select data-f="alignment"><option value="">—</option>${ORIGINS.alignments.map((a) => `<option${a === D.alignment ? ' selected' : ''}>${a}</option>`).join('')}</select></label>
        <label>Miniature<select data-f="model">${HEROES.map((h) => `<option value="${h}"${h === built.token.model ? ' selected' : ''}>${cap(h)}</option>`).join('')}</select></label></div>
      <label class="wide">Appearance<textarea data-f="appearance">${esc(D.appearance)}</textarea></label>
      <label class="wide">Backstory &amp; personality<textarea data-f="backstory">${esc(D.backstory)}</textarea></label>
      <h4>Your four gesture spells</h4>
      <p class="muted">In VR these hand signs deliver your attacks and spells. Any effect can go on any gesture.</p>
      <div class="lb-binds">${GESTURES.map((g) => { const bnd = built.sheet.castBindings.find((x) => x.gesture === g);
        return `<label>${kitIcon(`gesture/${g}`, { cls: 'gi gi-xl' })}<span>${GESTURE_LABELS[g]}</span><select data-bind="${g}">${effectOptions(bnd?.effectId)}</select></label>`; }).join('')}</div>`;
  }

  reviewHTML() {
    const D = this.draft, c = buildCharacter(D), s = c.sheet, comp = completeness(this.token);
    return `<div class="lb-review">${kitIcon(portrait(D.cls || 'fighter'), { cls: 'lb-portrait big' })}<div>
        <h3>${esc(c.token.name)}</h3><p>Level ${s.level} ${esc(s.species || 'adventurer')} ${esc(s.cls || '')}${s.background ? ` · ${esc(s.background)}` : ''}</p>
        <p>${iconHTML('hp')} ${c.token.maxHp} HP · ${iconHTML('ac')} AC ${c.token.ac} · ${iconHTML('speed')} ${s.speed} ft · ${iconHTML('initiative')} ${fmtMod(c.token.initBonus)}</p>
        <p class="lb-line">${ABILITIES.map((a) => `<span>${a.toUpperCase()} <b>${s.abilities[a]}</b> (${fmtMod(abilityMod(s.abilities[a]))})</span>`).join('')}</p>
        <p><b>Skills:</b> ${Object.keys(s.skills).map(cap).join(', ') || '—'}</p>
        <p><b>Gear:</b> ${c.inventory.map((i) => `${esc(i.name)}${i.qty > 1 ? ` ×${i.qty}` : ''}`).join(', ') || '—'} · ${c.coins.gp} gp</p>
        ${comp.missing.length ? `<p class="lb-warn">Still open: ${esc(comp.missing.join(', '))}. You can press Ready anyway.</p>` : '<p class="lb-ok">Your sheet is complete.</p>'}
        <button data-b="sheet">Open the full sheet</button></div></div>`;
  }

  waitHTML() {
    const t = this.token, me = this.sync.me || {}, others = (this.dm.state.tokens || []).filter((x) => x.kind === 'pc');
    const R = this.dm.state.session?.ready || {};
    return `<div class="lb-card narrow"><img class="lb-logo big" src="${kitUrlOf('nav/hearthstone-table')}" alt="">
      <h2>${esc(t.name)} is ready</h2><p>Waiting for the Dungeon Master to begin the adventure…</p>
      <ul class="lb-roster">${others.map((x) => `<li class="${R[x.id] ? 'ok' : ''}">${R[x.id] ? '✔' : '…'} ${esc(x.name)} <small>${esc(x.sheet?.cls || 'building')}</small></li>`).join('')}</ul>
      ${this.rejoinHTML(me)}
      <div class="row center"><button data-b="edit">Edit my character</button><button data-b="sheet">Open the full sheet</button></div></div>`;
  }

  headsetHTML() {
    const me = this.sync.me || {}, vr = this.canVR();
    return `<div class="lb-card narrow"><img class="lb-logo big" src="${kitUrlOf('nav/enter-vr')}" alt="">
      <h2>The adventure begins</h2><p>Stage 2: put on your headset and take your seat at the table.</p>
      <div class="row center">${vr ? `<button class="btn" data-b="vr" id="lb-vr">Enter VR on this device</button>` : ''}<button data-b="stay" id="lb-stay">Stay on this desktop</button></div>
      ${this.rejoinHTML(me, true)}</div>`;
  }

  rejoinHTML(me, lead = false) {
    const code = this.sync.code || '', url = (this.sync.joinUrl || '').replace(/\?.*$/, '');
    return `<div class="lb-rejoin">${lead ? '<b>Using a standalone headset (Quest)?</b>' : '<b>Moving to a headset later?</b>'}
      <p>Open <code>${esc(url || 'this address')}</code> in the headset's browser, choose <i>Join a table</i> and type:</p>
      <p class="lb-codes"><span>Table code <b>${esc(code)}</b></span><span>Rejoin # <b>${esc(me.rejoin || '----')}</b></span></p>
      <small>Your character follows you; this window then closes its seat.</small></div>`;
  }
}

const kitUrlOf = (key) => `${import.meta.env?.BASE_URL ?? '/'}assets/kit/${key}.webp`;
