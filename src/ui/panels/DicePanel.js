// Dice tab: table dice toggles, secret rolls, the tray history and the roll log. The tray itself is the bottom HUD.
import { esc } from '../actions.js';

export function dicePanel(root, ui) {
  const { dm, tray } = ui;
  root.innerHTML = `
    <section><h4>Dice</h4><p class="hint">The dice tray is at the bottom of the screen. Click a die to add it, right-click to remove one, or type any roll. Tap a result die to reroll, drop or set it.</p>
      <div class="row wrap"><button id="dk-secret" title="Physical dice show ? to players">Secret physical rolls</button><button id="dk-lock">Lock dice</button><button id="dk-all">Roll all</button><button id="dk-clear">Clear dice</button></div></section>
    <section><h4>Secret rolls <button id="dk-sd20" class="small btn arcane">Secret d20</button></h4><ul id="dm-secret"></ul></section>
    <section><h4>Tray history <small>last 50 · click to reload</small></h4><ul id="dk-hist" class="dk-log"></ul></section>
    <section><h4>Roll log</h4><ul id="dk-log" class="dk-log"></ul></section>`;
  const $ = (id) => root.querySelector('#' + id);
  $('dk-secret').onclick = () => dm.setSecret();
  $('dk-lock').onclick = () => dm.setLocked();
  $('dk-all').onclick = () => dm.dice.rollAll();
  $('dk-clear').onclick = () => dm.clearDice();
  $('dk-sd20').onclick = () => dm.secretRoll(20);
  $('dk-hist').onclick = (e) => { const li = e.target.closest('[data-h]'); const h = li && tray.history[Number(li.dataset.h)]; if (h) tray.loadExpr(h.expr, h.label); };
  const render = () => {
    const s = dm.state;
    $('dk-secret').className = s.dice.secret ? 'on' : ''; $('dk-lock').className = s.dice.locked ? 'on' : '';
    $('dm-secret').innerHTML = s.secretRolls.map((r) => `<li>${esc(r.at)} · ${esc(r.type)}: <b>${esc(r.value)}</b></li>`).join('') || '<li class="hint">None yet. Tick 🔒 secret in the tray.</li>';
    $('dk-hist').innerHTML = tray.history.map((h, i) => `<li data-h="${i}" title="Reload this pool">${esc(h.who)} · ${esc(h.label || h.expr)} <small>${esc(h.expr)}</small> = <b>${h.secret && !dm.isDM ? '?' : h.total}</b></li>`).join('') || '<li class="hint">No rolls yet.</li>';
    $('dk-log').innerHTML = [...(s.rollLog || [])].reverse().map((r) => `<li>${esc(r.text)}</li>`).join('') || '<li class="hint">Empty.</li>';
  };
  tray.onHistory = () => { if (!root.hidden) render(); };
  return { render };
}
