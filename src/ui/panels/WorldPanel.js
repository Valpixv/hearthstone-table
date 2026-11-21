// World tab: backdrops, time of day, mood, weather, music and sounds, narration and the fog of war.
// The table map itself is fixed (one battle mat); only the fog hides parts of it.
import { SCENE_LABELS } from '../../scene/SceneManager.js';
import { esc, act } from '../actions.js';
import { kitIcon, kitHas, symKey } from '../kit.js';

const TIMES = ['day', 'dusk', 'night'];
const MOODS = ['calm', 'tense', 'combat', 'eerie'];
const WEATHER = ['rain', 'snow', 'embers', 'sparkles'];
/** Music moods (mirrors DMController MUSIC) → kit emblem. */
const MUSIC = [['none', 'Music off', 'world/music-off'], ['tavern', 'Tavern', 'world/tavern'], ['explore', 'Explore', 'world/explore'], ['combat', 'Battle', 'world/battle-music'], ['eerie', 'Eerie', 'world/eerie-music']];
const SFX = [['creak', 'Door creak', 'misc/creak'], ['roar', 'Roar', 'misc/roar'], ['swordClash', 'Sword clash', 'misc/sword-clash'], ['cheer', 'Cheer', 'misc/cheer'], ['drone', 'Drone', 'misc/drone']];
/** Scene id → kit slug shared by the scene buttons and thumbnails. */
const SCENE_SLUG = { campfire: 'campfire', castle_cellar: 'castle-cellar', crypt: 'crypt', castle_ruins: 'castle-ruins', rock_castle: 'cliff-fortress', forest_cave: 'forest-cave',
  mossy_forest: 'fey-forest', moonrise: 'moonrise', tavern: 'tavern', dungeon: 'dungeon', forest: 'forest-clearing', lair: 'dragon-lair' };
const SCENE_BTN = { crypt: 'crypt-rotunda', moonrise: 'moonrise-plains' };
const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** Kit thumbnail key for a scene id (null when there is none). */
export function sceneKitKey(id) { const k = `scene/${SCENE_SLUG[id]}`; return kitHas(k) ? k : null; }
/** Kit emblem button key for a scene id (null when there is none). */
export function sceneButtonKey(id) { const s = SCENE_SLUG[id], k = `scenebtn/${SCENE_BTN[s] || s}`; return kitHas(k) ? k : null; }

export function worldPanel(root, ui) {
  const { dm } = ui;
  root.innerHTML = `<div id="wd-btns"></div>
    <section><h4>Narration</h4><div class="row"><input id="wd-narr" placeholder="Type narration…" autocomplete="off" aria-label="Narration text"/><button id="wd-narr-go" class="kimg sm" aria-label="Show the narration">${kitIcon('world/narrate')}</button></div></section>`;
  const $ = (id) => root.querySelector('#' + id);
  const narr = () => { const v = $('wd-narr').value.trim(); if (v && act(dm, 'narrate', { text: v })) $('wd-narr').value = ''; };
  $('wd-narr-go').onclick = narr;
  $('wd-narr').onkeydown = (e) => { if (e.key === 'Enter') narr(); };
  $('wd-btns').addEventListener('click', (e) => {
    const b = e.target.closest('[data-w]'); if (!b) return;
    const s = b.dataset.w, i = s.indexOf(':'), k = s.slice(0, i), v = s.slice(i + 1), L = dm.state.lighting;
    if (k === 'scene') act(dm, 'scene', { name: v });
    else if (k === 'time') act(dm, 'lighting', { key: 'timeOfDay', value: v });
    else if (k === 'mood') act(dm, 'lighting', { key: 'mood', value: v });
    else if (k === 'torch' || k === 'fogl') act(dm, 'lighting', { key: k === 'torch' ? 'torch' : 'fog', value: (k === 'torch' ? L.torch : L.fog) + Number(v) });
    else if (k === 'weather') act(dm, 'weather', { kind: v });
    else if (k === 'music') act(dm, 'music', { name: v });
    else if (k === 'sfx') act(dm, 'sfx', { name: v });
    else if (k === 'map') act(dm, 'map', { op: v });
  });
  let sig = '';
  return {
    render() {
      const s = dm.state, L = s.lighting;
      // An emblem button: big emblems carry their painted word; small ones (five to a row) show the picture only plus a
      // live caption, since a painted word that small is unreadable. The accessible name and tooltip are live text.
      const kb = (w, label, key, isOn = false, small = false) => (kitHas(key)
        ? `<button class="kimg ${isOn ? 'on' : ''}" data-w="${esc(w)}" title="${esc(label)}" aria-label="${esc(label)}" aria-pressed="${!!isOn}">${kitIcon(small ? symKey(key) : key)}${small || w.startsWith('map:') ? `<span class="art-caption">${esc(label)}</span>` : ''}</button>`
        : `<button class="${isOn ? 'on' : ''}" data-w="${esc(w)}" aria-pressed="${!!isOn}">${esc(label)}</button>`);
      const html = `
        <section><h4>${kitIcon('world/backdrop', { cls: 'state-mark' })} Backdrop</h4><div class="kgrid three">${Object.entries(SCENE_LABELS).filter(([k]) => !k.startsWith('ai-')).map(([k, l]) => kb(`scene:${k}`, l, sceneButtonKey(k), s.scene === k)).join('')}</div>
          <div class="kgrid three">${TIMES.map((t) => kb(`time:${t}`, cap(t), `world/${t}`, L.timeOfDay === t)).join('')}</div></section>
        <section><h4>Mood <small>torch ${L.torch.toFixed(2)} · ${kitIcon('world/atmospheric-fog', { cls: 'state-mark' })} fog ${L.fog.toFixed(2)}</small></h4><div class="kgrid four">${MOODS.map((m) => kb(`mood:${m}`, cap(m), `world/${m}`, L.mood === m)).join('')}</div>
          <div class="kgrid four">${kb('torch:-0.25', 'Torch dimmer', 'world/torch-minus')}${kb('torch:0.25', 'Torch brighter', 'world/torch-plus')}${kb('fogl:-0.15', 'Less fog', 'world/fog-minus')}${kb('fogl:0.15', 'More fog', 'world/fog-plus')}</div></section>
        <section><h4>Weather</h4><div class="kgrid five">${WEATHER.map((w) => kb(`weather:${w}`, cap(w), `world/${w}`, s.weather[w], true)).join('')}${kb('weather:lightning', 'Lightning', 'world/lightning', false, true)}</div></section>
        <section><h4>${kitIcon('world/volume', { cls: 'state-mark' })} Music &amp; sounds</h4><div class="kgrid five">${MUSIC.map(([k, l, ic]) => kb(`music:${k}`, l, ic, s.music === k, true)).join('')}</div>
          <div class="kgrid five">${SFX.map(([k, l, ic]) => kb(`sfx:${k}`, l, ic)).join('')}</div></section>
        <section><h4>Fog of war</h4><div class="kgrid three">${kb('map:fog', 'Fog of war', 'world/fog-of-war', s.map.fogOfWar)}${kb('map:fogPaint', 'Paint the fog away (F)', 'world/paint-fog', s.map.fogPaint)}</div>
          <p class="hint">${s.map.fogPaint ? 'Left-drag on the map to reveal it.' : 'The map never changes: the fog only hides parts of it from the players.'}</p></section>`;
      if (html !== sig) { $('wd-btns').innerHTML = html; sig = html; }
    },
  };
}
