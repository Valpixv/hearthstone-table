// Creatures tab: combat tracker (while combat is active), the Creature Gallery (the one place to spawn) and the token list.
import MODELS from '../../data/models.json';
import MONSTERS from '../../data/monsters.json';
import { templateDef, TOKEN_CFG } from '../../tokens/TokenManager.js';
import { thumbnailsFor } from '../../scene/Thumbnails.js';
import { CONDITIONS } from '../../rules/combat.js';
import { CONDITION_REMINDERS } from '../../rules/reminders.js';
import { iconHTML } from '../icons.js';
import { esc, act, typingIn, bumpStat, isNumericStat } from '../actions.js';
import { pendingChipsHTML, bindPendingChips } from '../pending.js';
import { forgeDef, FORGE_NOTE } from './ForgePanel.js';
import { kitHas, kitUrl, kitIcon, glyph, closeIcon } from '../kit.js';
import { FORMATIONS } from '../../table/arena.js';

const FILTERS = [['models', 'Models'], ['mine', 'My creatures'], ['forge', 'AI Forge'], ['templates', 'Templates']];
const titleOf = (k) => k.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const thumbCache = new Map(), thumbBusy = new Set();
const blank = () => ({ maxHp: TOKEN_CFG.defaults.maxHp, hp: TOKEN_CFG.defaults.maxHp, ac: TOKEN_CFG.defaults.ac });

/** Gallery tiles for a filter: { name, sub, thumb (models.json key) | image (URL), def, note?, defId? }. */
export function tiles(dm, filter) {
  const lib = dm.forge?.library || [];
  if (filter === 'models') {
    return [
      ...Object.keys(MODELS.monsters).filter((k) => !k.startsWith('_')).map((k) => ({ name: titleOf(k), sub: 'blank stats', thumb: k, def: { name: titleOf(k), kind: 'monster', side: 'enemy', model: k, ...blank() } })),
      ...Object.keys(MODELS.heroes).filter((k) => !k.startsWith('_')).map((k) => ({ name: titleOf(k), sub: 'hero · blank stats', thumb: `heroes.${k}`, def: { name: titleOf(k), kind: 'npc', side: 'ally', model: k, ...blank() } })),
    ];
  }
  if (filter === 'mine') {
    return (dm.state.savedDefs || []).map((d) => ({ name: d.name || 'Creature', sub: 'saved', thumb: !d.forge && MODELS.monsters[d.model] ? d.model : null,
      image: d.forge ? lib.find((e) => e.id === d.forge)?.image : null, def: d, defId: d.defId, note: 'From My creatures.' }));
  }
  if (filter === 'forge') return lib.filter((e) => e.kind === 'creature').map((e) => ({ name: e.label, sub: e.kind, image: e.image, def: forgeDef(e), note: FORGE_NOTE }));
  return Object.keys(MONSTERS).filter((k) => !k.startsWith('_')).map((k) => ({ name: MONSTERS[k].name, sub: `template · CR ${MONSTERS[k].cr}`,
    thumb: MODELS.monsters[k] ? k : null, def: templateDef(k), note: 'SRD template: an optional starting point. Edit freely.' }));
}

export function creaturesPanel(root, ui) {
  const { dm } = ui;
  let filter = 'models', q = '', galSig = '', list = [], dragFrom = null;
  root.innerHTML = `
    <section id="cr-combat" class="cr-combat" hidden></section>
    <section id="cr-pending" hidden><h4>Pending damage</h4><div class="rb-pending" id="cr-pend"></div></section>
    <section><h4>Creature gallery</h4>
      <label class="k-search">${kitIcon('ctl/search')}<input id="gal-q" type="search" class="wide" placeholder="Search creatures…" autocomplete="off" aria-label="Search creatures"></label>
      <div class="gal-filters">${FILTERS.map(([k, l]) => `<button class="small ${k === filter ? 'on' : ''}" data-filter="${k}">${l}${k === 'templates' ? ' <small>(optional)</small>' : ''}</button>`).join('')}</div>
      <p class="hint">Click a tile to edit it first, or drag it onto the room to place it life-size (onto the map: mini only).</p>
      <div id="gal-grid" class="gal-grid"></div></section>
    <section><h4>Arrange the room</h4><div class="btn-grid four">${FORMATIONS.map((f) => `<button data-form="${f}" title="Arrange every enemy standing in the room">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}</div>
      <p class="hint">Drag a life-size creature to move it; turn it with the mouse wheel while dragging.</p></section>
    <section><h4>Tokens <button id="cb-start" class="small btn" title="Everyone joins the initiative order">Start combat</button></h4>
      <div class="row hint">New conditions last <input id="cb-rounds" type="number" min="1" placeholder="∞" title="Rounds; empty = until removed"> rounds</div>
      <ul id="tok-list" class="tok-list"></ul></section>`;
  const $ = (id) => root.querySelector('#' + id);
  if (dm.combatMgr) bindPendingChips($('cr-pend'), dm.combatMgr);
  $('cb-start').onclick = () => act(dm, 'combat', { op: 'start' });
  $('gal-q').addEventListener('input', () => { q = $('gal-q').value.trim().toLowerCase(); renderGallery(true); });

  /** DM-clicked initiative roll for one creature: d20 + its bonus, then it becomes its initiative. */
  function rollInit(id) {
    const t = dm.tokens.find(id); if (!t) return;
    const pool = { groups: [{ count: 1, sides: 20, keep: null }], mod: Number(t.initBonus) || 0, label: `${t.name} · Initiative` };
    const done = (r) => { act(dm, 'initiative', { id, value: r.total }); ui.tray.showRoll(r, { label: pool.label }); };
    ui.rolls.rollPool(pool, { physical: ui.tray.physical, onDone: done });
  }

  root.addEventListener('click', (e) => {
    const fm = e.target.closest('[data-form]'); if (fm) { ui.lifeDrag?.arrange(fm.dataset.form); return; }
    const f = e.target.closest('[data-filter]');
    if (f) { filter = f.dataset.filter; root.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('on', b === f)); renderGallery(true); return; }
    const g = e.target.closest('[data-g]');
    if (g) { const it = list[Number(g.dataset.g)]; if (it) ui.editor.openNew(it.def, { note: it.note || '', defId: it.defId || null }); return; }
    const b = e.target.closest('[data-t]'); if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
    const id = b.closest('[data-id]')?.dataset.id, t = id ? dm.tokens.find(id) : null, a = b.dataset.t;
    switch (a) {
      case 'edit': if (!ui.tray.tokenClick(id)) ui.editor.openToken(id); break;
      case 'dup': act(dm, 'duplicate', { id }); break;
      case 'del': act(dm, 'remove', { id }); break;
      case 'cs-': case 'cs+': { const c = t?.custom[Number(b.dataset.i)]; if (c) act(dm, 'stat', { id, key: c.key, value: bumpStat(c.value, a === 'cs+' ? '+' : '-', 1) }); break; }
      case 'cdel': act(dm, 'condition', { id, name: b.dataset.name, on: false }); break;
      case 'next': act(dm, 'combat', { op: 'next' }); break;
      case 'end': act(dm, 'combat', { op: 'end' }); break;
      case 'cine': dm.combatMgr?.setCinematic(!dm.combatMgr.cineOn); break;
      case 'initroll': rollInit(id); break;
      case 'ds': act(dm, 'deathSaves', { id, kind: b.dataset.kind, delta: Number(b.dataset.n) }); break;
      default: break;
    }
  });
  root.addEventListener('change', (e) => {
    const el = e.target, id = el.closest('[data-id]')?.dataset.id; if (!id) return;
    if (el.dataset.t === 'ac') act(dm, 'update', { id, patch: { ac: el.value === '' ? '' : Number(el.value) } });
    else if (el.dataset.t === 'init') act(dm, 'initiative', { id, value: el.value });
    else if (el.dataset.t === 'cond' && el.value) { const r = Number($('cb-rounds').value); act(dm, 'condition', { id, name: el.value, on: true, rounds: r > 0 ? r : null }); el.value = ''; }
  });
  root.addEventListener('keydown', (e) => {
    const el = e.target; if (e.key !== 'Enter') return;
    if (el.dataset.t === 'hp') {
      const id = el.closest('[data-id]').dataset.id;
      if (act(dm, 'hp', { id, expr: el.value })) { el.value = ''; el.classList.remove('bad'); el.blur(); } else el.classList.add('bad');
    } else if (el.dataset.t === 'init' || el.dataset.t === 'ac') el.blur();
  });
  // Drag to reorder the initiative (ties are the DM's call).
  root.addEventListener('dragstart', (e) => { const g = e.target.closest?.('[data-g]'); if (g) { const it = list[Number(g.dataset.g)]; if (it) { ui.lifeDrag?.setDragDef({ ...it.def, life: true }, 1); e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', it.name); } return; }
    const li = e.target.closest?.('li[data-i]'); if (li) { dragFrom = Number(li.dataset.i); e.dataTransfer.effectAllowed = 'move'; } });
  root.addEventListener('dragover', (e) => { if (dragFrom != null && e.target.closest?.('li[data-i]')) e.preventDefault(); });
  root.addEventListener('drop', (e) => { const li = e.target.closest?.('li[data-i]'); if (li && dragFrom != null) { e.preventDefault(); act(dm, 'reorder', { from: dragFrom, to: Number(li.dataset.i) }); } dragFrom = null; });
  root.addEventListener('dragend', () => { dragFrom = null; setTimeout(() => ui.lifeDrag?.setDragDef(null), 50); });

  function renderGallery(force = false) {
    const lib = dm.forge?.library || [], saved = dm.state.savedDefs || [];
    const sig = `${filter}|${q}|${saved.map((d) => d.defId + d.name).join()}|${lib.map((e) => e.id).join()}`;
    if (!force && sig === galSig) return; galSig = sig;
    list = tiles(dm, filter).filter((t) => !q || t.name.toLowerCase().includes(q));
    const portrait = (t) => { const id = t.thumb?.startsWith('heroes.') ? t.thumb.slice(7) : t.def?.statId || t.def?.model || t.thumb; return !t.image && id && kitHas(`creature/${id}`) ? `creature/${id}` : null; };
    const img = (t) => (portrait(t) ? `<img alt="" src="${kitUrl(portrait(t))}">` : t.thumb ? `<img alt="" data-thumb="${esc(t.thumb)}"${thumbCache.has(t.thumb) ? ` src="${thumbCache.get(t.thumb)}"` : ''}>`
      : t.image ? `<img alt="" src="${esc(t.image)}">` : '<span class="gal-ph">?</span>');
    $('gal-grid').innerHTML = list.map((t, i) => `<button class="gal-tile" draggable="true" data-g="${i}" title="${esc(t.name)}: click to edit, drag onto the room to place">${img(t)}<span class="gal-name">${esc(t.name)}</span><small>${esc(t.sub)}</small></button>`).join('')
      || `<p class="hint">${filter === 'mine' ? 'Nothing saved yet. Open a creature and press “Save to My creatures”.' : filter === 'forge' ? 'Nothing forged yet: use the Forge tab (5).' : 'No match.'}</p>`;
    const need = [...new Set(list.filter((t) => !portrait(t)).map((t) => t.thumb).filter((k) => k && !thumbCache.has(k) && !thumbBusy.has(k)))];
    if (!need.length) return;
    need.forEach((k) => thumbBusy.add(k));
    thumbnailsFor(need, (k, url) => { thumbCache.set(k, url); root.querySelectorAll('img[data-thumb]').forEach((im) => { if (im.dataset.thumb === k) im.src = url; }); })
      .finally(() => need.forEach((k) => thumbBusy.delete(k)));
  }

  const condOpts = '<option value="">+ condition</option>' + Object.keys(CONDITIONS).map((k) => `<option value="${k}">${k}</option>`).join('');
  const chip = (k) => `<span style="background:${CONDITIONS[k.name] || '#555'}" title="${esc(CONDITION_REMINDERS[k.name] || k.name)} · click to remove" data-t="cdel" data-name="${esc(k.name)}">${iconHTML(k.name)}${esc(k.name)}${k.rounds ? ' ' + k.rounds : ''}</span>`;
  const lastHp = new Map(); // token id -> the HP % its bar last showed, so a change slides instead of jumping
  const hpBar = (t) => {
    const p = t.maxHp > 0 ? Math.max(0, Math.min(100, (t.hp / t.maxHp) * 100)) : 0;
    const from = lastHp.has(t.id) ? lastHp.get(t.id) : p;
    return `<div class="hpbar ${p <= 25 ? 'low' : p <= 50 ? 'mid' : ''}" title="${t.hp} / ${t.maxHp} HP"><i data-hid="${esc(t.id)}" style="--from:${from.toFixed(1)}%;width:${p}%"></i></div>`;
  };
  const stat = (c, i) => (!String(c.key).trim() ? '' : isNumericStat(c.value)
    ? `<span class="cstat">${esc(c.key)} <button aria-label="${esc(c.key)} −1" class="small" data-t="cs-" data-i="${i}" title="${esc(c.key)} −1">${glyph('ctl/minus')}</button><b>${esc(c.value)}</b><button aria-label="${esc(c.key)} +1" class="small" data-t="cs+" data-i="${i}" title="${esc(c.key)} +1">${glyph('ctl/plus')}</button></span>`
    : `<span class="cstat">${esc(c.key)}: <b>${esc(c.value)}</b></span>`);
  const tokenRow = (t) => {
    const item = t.kind === 'item';
    return `<li class="tok ${esc(t.side)} ${!item && t.hp <= 0 ? 'down' : ''}" data-id="${t.id}">
      <div class="tok-h"><button class="tok-name" data-t="edit" title="Edit (or pick as a target)">${esc(t.name)}</button><small>${t.kind === 'pc' ? 'player' : esc(t.kind)} · ${esc(t.side)}</small>
        <span class="tok-acts"><button aria-label="Edit" class="small" data-t="edit" title="Edit">${glyph('forge/edit')}</button><button aria-label="Duplicate" class="small" data-t="dup" title="Duplicate">${glyph('forge/duplicate')}</button><button aria-label="Remove" class="small ghost" data-t="del" title="Remove">${closeIcon()}</button></span></div>
      ${item ? '' : `<div class="tok-hp">${hpBar(t)}<b>${t.hp}/${t.maxHp}</b>${t.tempHp ? `<small>+${t.tempHp} temp</small>` : ''}<input class="hp-expr" data-t="hp" placeholder="-7 · +3 · =25 · +5 temp" title="-7 damage, +3 heal, =25 set, +5 temp; then Enter" autocomplete="off"></div>
      <div class="tok-stats"><label>Defense <input type="number" data-t="ac" value="${t.ac ?? ''}"></label>${t.custom.map(stat).join('')}</div>
      <div class="chips">${t.conditions.map(chip).join('')}<select data-t="cond" title="Add a condition">${condOpts}</select></div>`}
    </li>`;
  };
  const pips = (t) => {
    if (t.kind !== 'pc' || t.hp > 0 || !t.deathSaves) return '';
    const ds = t.deathSaves, state = ds.dead ? ' ☠ DEAD' : ds.stable ? ' ✚ STABLE' : '';
    const row = (kind, on) => `<button aria-label="Remove one" class="small" data-t="ds" data-kind="${kind}" data-n="-1" title="Remove one">${glyph('ctl/minus')}</button><span class="ds-${kind}">${on.repeat(ds[kind] || 0)}${'·'.repeat(3 - (ds[kind] || 0))}</span><button aria-label="Add one" class="small" data-t="ds" data-kind="${kind}" data-n="1" title="Add one">${glyph('ctl/plus')}</button>`;
    return `<span class="ds-pips" title="Death saves: successes / failures">${row('success', '✔')} ${row('fail', '✖')}<b>${state}</b></span>`;
  };

  function renderCombat() {
    const mgr = dm.combatMgr, box = $('cr-combat'); if (!mgr) return;
    const C = mgr.combat; box.hidden = !C.active; $('cb-start').hidden = !!C.active;
    if (!C.active || typingIn(box)) return;
    const a = mgr.active(), order = mgr.ordered(), wait = mgr.awaitingInit();
    box.innerHTML = `<h4>Combat <small>Round ${C.round}${a ? ` · ${esc(a.name)} to act` : ''}</small></h4>
      <div class="row wrap"><button class="kimg" data-t="next" aria-label="Next turn">${kitIcon('combat/next-turn')}</button><button class="kimg" data-t="end" aria-label="End combat">${kitIcon('combat/end-combat')}</button><button data-t="cine" class="kimg ${mgr.cineOn ? 'on' : ''}" aria-label="Cinematic camera" aria-pressed="${!!mgr.cineOn}">${kitIcon('combat/cinematic')}</button></div>
      ${wait.length ? `<div class="hint">Waiting for initiative: ${wait.map((c) => esc(c.name)).join(', ')} (type it or 🎲)</div>` : ''}
      <ol class="combat-list cb-order">${order.map((t, i) => `<li data-i="${i}" data-id="${t.id}" draggable="true" class="${a?.id === t.id ? 'cur' : ''} ${t.hp <= 0 ? 'down' : ''} ${t.side === 'enemy' ? 'mon' : ''}" title="Drag to reorder">
        <span class="grip" aria-hidden="true">⋮⋮</span><input class="cb-init" type="number" data-t="init" value="${t.init ?? ''}" placeholder="?" title="Initiative"><button class="small" data-t="initroll" title="Roll d20 ${t.initBonus >= 0 ? '+' : '−'} ${Math.abs(t.initBonus || 0)}">🎲</button>
        <span class="nm">${a?.id === t.id ? '▶ ' : ''}${esc(t.name)}</span><b>${t.hp}/${t.maxHp}</b>${pips(t)}</li>`).join('')}</ol>`;
  }

  return {
    render() {
      renderGallery(); renderCombat();
      const pend = pendingChipsHTML(dm.combatMgr), pe = $('cr-pend');
      if (!typingIn(pe) && pe.dataset.sig !== pend) { pe.innerHTML = pend; pe.dataset.sig = pend; }
      $('cr-pending').hidden = !pend;
      const tl = $('tok-list'); if (typingIn(tl)) return;
      // Bars mid-slide keep going: each new bar starts from the width the old one shows right now.
      tl.querySelectorAll('.hpbar i[data-hid]').forEach((i) => { const w = i.parentElement.clientWidth; if (w) lastHp.set(i.dataset.hid, (i.getBoundingClientRect().width / w) * 100); });
      const html = (dm.state.tokens || []).map(tokenRow).join('') || '<li class="hint">No tokens yet. Click a gallery tile, then Spawn.</li>';
      const sig = html.replace(/ style="--from:[^"]*"/g, ''); // ignore each bar's starting width
      if (sig === tl.dataset.sig) return; // nothing changed: leave the bars animating
      tl.innerHTML = html; tl.dataset.sig = sig;

    },
  };
}
