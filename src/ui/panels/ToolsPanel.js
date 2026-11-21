// Tools tab: grid snap, ruler and AoE templates (src/table/Tactics.js). Local DM view tools.
import { kitIcon } from '../kit.js';

const emblem = (id, key, label) => `<button id="${id}" class="kimg" aria-label="${label}" title="${label}">${kitIcon(key)}</button>`;

export function toolsPanel(root, ui) {
  const tac = ui.dm.tactics;
  root.innerHTML = `<section><h4>Grid &amp; ruler</h4><div class="kgrid three">${emblem('tt-grid', 'tools/grid-snap', 'Snap minis to the 5 ft squares')}${emblem('tt-ruler', 'tools/ruler', 'Ruler: drag on the map to measure')}</div>
      <p class="hint">One square is 5 feet. The ring around the acting creature shows how far its speed carries it.</p></section>
    <section><h4>Area of effect</h4><div class="kgrid four" id="tt-shapes">${[['sphere', 'tools/sphere'], ['cone', 'tools/cone'], ['line', 'tools/line'], ['cube', 'tools/cube']].map(([s, k]) => `<button class="kimg" data-shape="${s}" aria-label="${s}" title="${s}">${kitIcon(k)}<span class="art-caption">${s}</span></button>`).join('')}</div>
      <div class="row wrap"><label>Size <select id="tt-size" title="Size in feet"><option>10</option><option selected>15</option><option>20</option><option>30</option><option>60</option></select> ft</label></div>
      <div class="kgrid three">${emblem('tt-place', 'tools/place', 'Place the template on the map')}${emblem('tt-rot', 'tools/rotate', 'Rotate the last template')}${emblem('tt-clear', 'tools/clear', 'Clear every template')}</div></section>`;
  const $ = (id) => root.querySelector('#' + id);
  if (!tac) { root.insertAdjacentHTML('beforeend', '<p class="hint">Table tools are not available.</p>'); return { render() {} }; }
  let last = null, shape = 'sphere';
  const render = () => {
    $('tt-grid').classList.toggle('on', !!tac.gridOn); $('tt-ruler').classList.toggle('on', !!tac.rulerOn);
    $('tt-grid').setAttribute('aria-pressed', !!tac.gridOn); $('tt-ruler').setAttribute('aria-pressed', !!tac.rulerOn);
    root.querySelectorAll('[data-shape]').forEach((b) => { b.classList.toggle('on', b.dataset.shape === shape); b.setAttribute('aria-pressed', b.dataset.shape === shape); });
  };
  $('tt-grid').onclick = () => { tac.setGrid(!tac.gridOn); render(); };
  $('tt-ruler').onclick = () => { tac.setRuler(!tac.rulerOn); render(); };
  $('tt-shapes').onclick = (e) => { const b = e.target.closest('[data-shape]'); if (b) { shape = b.dataset.shape; render(); } };
  $('tt-place').onclick = () => { last = tac.placeTemplate(shape, Number($('tt-size').value)); };
  $('tt-rot').onclick = () => { if (last) tac.rotate(last, Math.PI / 8); };
  $('tt-clear').onclick = () => { tac.clearTemplates(); last = null; };
  return { render };
}
