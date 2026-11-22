// Table tab: the invite (table code, link, QR — TableSync fills #dm-invite), the stage roster with "Begin the adventure",
// player requests (Requests.js renders #dm-requests), quick add players, the table's rules switches, saved setups and
// session save / load.
import MODELS from '../../data/models.json';
import { esc, act, setupsOf, typingIn } from '../actions.js';
import { kitIcon, closeIcon } from '../kit.js';
import { completeness } from '../../party/sheet.js';

const HEROES = Object.keys(MODELS.heroes).filter((k) => !k.startsWith('_'));
/** Rules switches shown on the tab: [settings key, label, hint]. Defaults: src/data/tableDefaults.json. */
const SWITCHES = [
  ['rulesAssist', 'Rules assist', 'Classic D&D help: hit or miss against AC, saves against a DC, crits, death saves, monster initiative. Off = free dice.'],
  ['gestureRelease', 'Damage needs the attacker’s gesture', 'Confirmed damage waits until the attacker makes their hand sign (or presses Unleash). Off = it lands at once.'],
  ['showDcToPlayers', 'Players see the DC', 'Show the difficulty on the rolls you call for.'],
];

export function tablePanel(root, ui) {
  const { dm } = ui;
  root.innerHTML = `
    <section id="dm-invite"><h4>Invite your players</h4>
      <div class="invite"><img alt="Scan to join" /><div><small>Table code</small><b class="invite-code">…</b><small>or open</small><code>starting…</code><ul></ul></div></div></section>
    <section id="dm-stage"><h4>Session</h4><div id="st-body"></div></section>
    <section class="dm-requests-box"><h4>Player requests</h4><div id="dm-requests"></div></section>
    <section><h4>Quick add players <small>(no device of their own)</small></h4>
      <div class="row"><input id="qa-names" placeholder="Aria, Bram, Cyra" autocomplete="off" title="Names separated by commas, then Enter" aria-label="Names to add"/><button id="qa-go" class="btn">Add</button></div></section>
    <section><h4>Rules of this table</h4><div id="ra-list"></div>
      <div class="row wrap"><span class="hint">Award experience:</span>${[50, 100, 250, 500].map((n) => `<button class="small" data-xp="${n}">${n} XP</button>`).join('')}</div></section>
    <section><h4>Party loot</h4>
      <div class="row wrap">${['pp', 'gp', 'sp', 'cp'].map((c) => `<label class="loot">${c.toUpperCase()} <input type="number" min="0" data-loot="${c}" value="0" aria-label="${c} to share"></label>`).join('')}<button id="loot-go" class="btn" title="Share these coins evenly among the player characters">Split among the party</button></div></section>
    <section><h4>Handout</h4>
      <input id="ho-title" class="wide" placeholder="Title (e.g. A crumpled letter)" autocomplete="off" aria-label="Handout title"/>
      <textarea id="ho-text" rows="3" placeholder="What the players read…" aria-label="Handout text"></textarea>
      <div class="row wrap" id="ho-who"></div><button id="ho-go" class="btn">Show it</button></section>
    <section><h4>Saved setups</h4>
      <div class="row"><input id="su-name" placeholder="Name (e.g. Goblin ambush)" autocomplete="off" aria-label="Setup name"/><button id="su-save" class="btn" title="Scene, lighting, weather, tokens and positions, and fog">Save current table</button></div>
      <ul id="su-list" class="su-list"></ul></section>
    <section><h4>Whole session</h4>
      <div class="kgrid three"><button id="ss-save" class="kimg" aria-label="Save the table" title="Save the table">${kitIcon('session/save-table')}</button><button id="ss-load" class="kimg" aria-label="Load the table" title="Load the table">${kitIcon('session/load-table')}</button><button id="ss-export" class="kimg" aria-label="Copy the table state" title="Copy the table state as JSON">${kitIcon('session/copy-state')}</button></div></section>`;
  const $ = (id) => root.querySelector('#' + id);
  const quickAdd = () => {
    const names = $('qa-names').value.split(',').map((s) => s.trim()).filter(Boolean);
    const pcs = (dm.state.tokens || []).filter((t) => t.kind === 'pc').length;
    names.forEach((name, i) => act(dm, 'spawn', { def: { name, kind: 'pc', side: 'ally', model: HEROES[(pcs + i) % HEROES.length] || 'fighter', sheet: {}, inventory: [], coins: {} } }));
    $('qa-names').value = '';
  };
  $('qa-go').onclick = quickAdd;
  $('qa-names').onkeydown = (e) => { if (e.key === 'Enter') quickAdd(); };
  root.addEventListener('change', (e) => { const k = e.target.dataset.set; if (k) act(dm, 'settings', { patch: { [k]: e.target.checked } }); });
  root.addEventListener('click', (e) => {
    const xp = e.target.closest('[data-xp]'); if (xp) return void act(dm, 'xp', { amount: Number(xp.dataset.xp) });
    const st = e.target.closest('[data-st]'); if (!st) return undefined;
    if (st.dataset.st === 'begin') act(dm, 'session', { stage: 'play' });
    else if (st.dataset.st === 'lobby') act(dm, 'session', { stage: 'lobby' });
    else if (st.dataset.st === 'sheet') ui.sheet?.open('sheet', st.dataset.id);
    else if (st.dataset.st === 'unready') act(dm, 'ready', { id: st.dataset.id, on: false });
    else if (st.dataset.st === 'kick') {
      const t = dm.state.tokens.find((x) => x.id === st.dataset.id); if (!t) return undefined;
      if (!globalThis.confirm?.(`Remove ${t.name} from the table? Their character is deleted and their rejoin number stops working.`)) return undefined;
      ui.sync?.kick(t.owner); act(dm, 'remove', { id: t.id });
    }
    return undefined;
  });
  $('loot-go').onclick = () => {
    const coins = {}; root.querySelectorAll('[data-loot]').forEach((i) => { const v = Math.floor(Number(i.value)) || 0; if (v > 0) coins[i.dataset.loot] = v; });
    if (Object.keys(coins).length && act(dm, 'loot.split', { coins })) root.querySelectorAll('[data-loot]').forEach((i) => { i.value = 0; });
  };
  const hoTo = new Set();
  $('ho-who').onclick = (e) => { const b = e.target.closest('[data-ho]'); if (!b) return; if (b.dataset.ho === 'all') hoTo.clear(); else if (hoTo.has(b.dataset.ho)) hoTo.delete(b.dataset.ho); else hoTo.add(b.dataset.ho); hoSig = ''; renderHo(); };
  $('ho-go').onclick = () => { if (ui.handouts?.send({ title: $('ho-title').value, text: $('ho-text').value }, hoTo.size ? [...hoTo] : 'all')) { $('ho-title').value = ''; $('ho-text').value = ''; } };
  let hoSig = '';
  const renderHo = () => {
    const players = (ui.sync?.players || []).filter((p) => p.role === 'player');
    const html = `<button data-ho="all" class="small ${hoTo.size ? '' : 'on'}">Everyone</button>${players.map((p) => `<button data-ho="${esc(p.id)}" class="small ${hoTo.has(p.id) ? 'on' : ''}">${esc(p.name)}</button>`).join('')}`;
    if (html !== hoSig) { $('ho-who').innerHTML = html; hoSig = html; }
  };
  const saveSetup = () => { if (act(dm, 'setup.save', { name: $('su-name').value })) $('su-name').value = ''; };
  $('su-save').onclick = saveSetup;
  $('su-name').onkeydown = (e) => { if (e.key === 'Enter') saveSetup(); };
  $('su-list').onclick = (e) => {
    const b = e.target.closest('[data-su]'); if (!b) return;
    act(dm, b.dataset.su === 'load' ? 'setup.load' : 'setup.delete', { id: b.dataset.id });
  };
  $('ss-save').onclick = () => act(dm, 'session.save');
  $('ss-load').onclick = () => act(dm, 'session.load');
  $('ss-export').onclick = () => { navigator.clipboard?.writeText(dm.serialize()); dm.narrate('State copied to clipboard'); };
  let stSig = '', raSig = '';
  return {
    render() {
      const s = dm.state, ses = s.session || { stage: 'play', ready: {} }, pcs = (s.tokens || []).filter((t) => t.kind === 'pc'), set = s.settings || {};
      const players = ui.sync?.players || [], vrOf = (t) => players.find((p) => p.id === t.owner)?.vr;
      const ready = pcs.filter((t) => ses.ready?.[t.id]).length;
      const roster = pcs.map((t) => { const c = completeness(t), ok = !!ses.ready?.[t.id];
        return `<li class="${ok ? 'ok' : ''}"><span><b>${esc(t.name)}</b> <small>${esc(t.sheet?.cls ? `level ${t.sheet.level} ${t.sheet.species || ''} ${t.sheet.cls}` : 'building…')}${t.away ? ' · away' : ''}${vrOf(t) ? ' · in headset' : ''}</small></span>
          <small title="${esc(c.missing.length ? 'Still open: ' + c.missing.join(', ') : 'Complete')}">sheet ${c.done}/${c.total}</small><em>${ok ? 'ready' : 'not ready'}</em>
          <button class="small" data-st="sheet" data-id="${t.id}" title="Open this sheet">Sheet</button>${ok ? `<button class="small ghost" data-st="unready" data-id="${t.id}" title="Let them edit freely again">Unlock</button>` : ''}<button class="small ghost st-kick" data-st="kick" data-id="${t.id}" title="Remove this player and their character from the table">Kick</button></li>`; }).join('');
      const st = ses.stage === 'lobby'
        ? `<p class="st-stage"><b>Stage 1 · Characters.</b> Players are filling in their sheets on their desktops. ${ready} of ${pcs.length} ready.</p><ul class="st-roster">${roster || '<li class="hint">Nobody has joined yet. Share the code above.</li>'}</ul>
           <button class="btn wide" data-st="begin" id="st-begin"${pcs.length ? '' : ' disabled'}>Begin the adventure${pcs.length && ready < pcs.length ? ` (${pcs.length - ready} not ready)` : ''}</button>
           <p class="hint">Then everyone is asked to put their headset on.</p>`
        : `<p class="st-stage"><b>Stage 2 · The adventure.</b> ${pcs.length} character${pcs.length === 1 ? '' : 's'} at the table.</p><ul class="st-roster">${roster || '<li class="hint">No player characters yet.</li>'}</ul>
           <button class="small" data-st="lobby" title="Level-up night: everyone edits their sheet freely again">Back to the character stage</button>`;
      if (st !== stSig) { $('st-body').innerHTML = st; stSig = st; }
      renderHo();
      const ra = SWITCHES.map(([k, l, hint]) => `<label class="switch" title="${esc(hint)}"><input type="checkbox" data-set="${k}"${set[k] ? ' checked' : ''}/> <span>${esc(l)}</span></label>`).join('');
      if (ra !== raSig) { $('ra-list').innerHTML = ra; raSig = ra; }
      if (typingIn($('su-list'))) return;
      $('su-list').innerHTML = setupsOf(dm).map((x) => `<li><span><b>${esc(x.name)}</b> <small>${esc(x.at)}</small></span>
        <button class="small btn" data-su="load" data-id="${esc(x.id)}">Load</button><button aria-label="Delete" class="small ghost" data-su="del" data-id="${esc(x.id)}" title="Delete">${closeIcon()}</button></li>`).join('')
        || '<li class="hint">No setups yet. Build a table, then “Save current table”.</li>';
    },
  };
}
