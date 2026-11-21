// The DM dock (design/flexibility-plan.md §7): a left dock with 6 tabs replacing the long DesktopPanel scroll.
// Hotkeys 1–6 switch tabs (wired in main.js). Each tab lives in src/ui/panels/*.js and returns { render }.
import './dock.css';
import { act } from './actions.js';
import { kitIcon, closeIcon, glyph, symKey } from './kit.js';
import { CreatureEditor } from './panels/CreatureEditor.js';
import { tablePanel } from './panels/TablePanel.js';
import { creaturesPanel } from './panels/CreaturesPanel.js';
import { dicePanel } from './panels/DicePanel.js';
import { worldPanel } from './panels/WorldPanel.js';
import { forgePanel } from './panels/ForgePanel.js';
import { toolsPanel } from './panels/ToolsPanel.js';

export const DOCK_TABS = [
  { key: 'table', label: 'Table', make: tablePanel },
  { key: 'creatures', label: 'Creatures', make: creaturesPanel },
  { key: 'dice', label: 'Dice', make: dicePanel },
  { key: 'world', label: 'World', make: worldPanel },
  { key: 'forge', label: 'Forge', make: forgePanel },
  { key: 'tools', label: 'Tools', make: toolsPanel },
];
const TAB_KEY = 'hearthstone-dock-tab';
const BIG_KEY = 'hearthstone-dock-expanded';

export class DMDock {
  /** @param {{ dm: object, audio: object, rolls: object, tray: import('./DiceTray.js').DiceTray }} deps */
  constructor({ dm, audio, rolls, tray }) {
    this.dm = dm; this.audio = audio;
    this.ui = { dm, audio, rolls, tray, dock: this, act: (t, p) => act(dm, t, p) };
    this.ui.editor = new CreatureEditor(this.ui);
    let saved = null; try { saved = localStorage.getItem(TAB_KEY); } catch { /* storage unavailable */ }
    this.tab = DOCK_TABS.some((t) => t.key === saved) ? saved : 'creatures';
    const el = (this.el = document.getElementById('dm-panel'));
    el.innerHTML = `
      <header><b>Dungeon Master</b><button id="dm-requests-badge" class="req-badge" title="Player requests waiting (Table tab)"></button><button aria-label="Expand (Shift+M)" id="dm-expand" class="small ghost" title="Expand (Shift+M)">${glyph('ctl/up')}</button><button aria-label="Close (M)" id="dm-close" class="small ghost" title="Close (M)">${closeIcon()}</button></header>
      <nav id="dm-tabs" role="tablist">${DOCK_TABS.map((t, i) => `<button class="tab" role="tab" data-tab="${t.key}" title="${t.label} (${i + 1})">${kitIcon(symKey(`nav/${t.key}`))}<kbd>${i + 1}</kbd><span>${t.label}</span></button>`).join('')}</nav>
      <div class="dm-body">${DOCK_TABS.map((t) => `<div class="dm-tab" role="tabpanel" data-pane="${t.key}" hidden></div>`).join('')}</div>`;
    this.panels = {};
    for (const t of DOCK_TABS) this.panels[t.key] = t.make(el.querySelector(`[data-pane="${t.key}"]`), this.ui) || {};
    el.querySelector('#dm-close').onclick = () => this.toggle(false);
    el.querySelector('#dm-expand').onclick = () => { this.expand(); audio?.click?.(); };
    let big = false; try { big = localStorage.getItem(BIG_KEY) === '1'; } catch { /* storage unavailable */ }
    this.expand(big);
    el.querySelector('#dm-tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) { this.showTab(b.dataset.tab); audio?.click?.(); } };
    el.querySelector('#dm-requests-badge').onclick = () => { this.showTab('table'); el.querySelector('#dm-requests')?.scrollIntoView({ block: 'nearest' }); };
    el.addEventListener('focusout', () => setTimeout(() => this.render(), 0)); // catch up on renders skipped while typing
    dm.on(() => this.render());
    this.render();
  }

  /** Opens / closes the dock. */
  toggle(v = this.el.hidden) { this.el.hidden = !v; if (v) this.render(); }

  /** Expands the panel to fill most of the screen, or shrinks it back to the side dock (remembered per browser). */
  expand(v = !this.el.classList.contains('expanded')) {
    this.el.classList.toggle('expanded', v);
    const b = this.el.querySelector('#dm-expand'), label = v ? 'Shrink (Shift+M)' : 'Expand (Shift+M)';
    b.innerHTML = glyph(v ? 'ctl/down' : 'ctl/up'); b.title = label; b.setAttribute('aria-label', label); b.setAttribute('aria-pressed', v);
    try { localStorage.setItem(BIG_KEY, v ? '1' : '0'); } catch { /* storage unavailable */ }
  }

  /** Opens the dock on a tab (key or 0-based index). */
  showTab(k) {
    const t = typeof k === 'number' ? DOCK_TABS[k]?.key : k; if (!t) return;
    this.tab = t; try { localStorage.setItem(TAB_KEY, t); } catch { /* storage unavailable */ }
    this.el.hidden = false; this.render();
  }

  render() {
    if (this.el.hidden) return;
    this.el.querySelectorAll('#dm-tabs [data-tab]').forEach((b) => { const on = b.dataset.tab === this.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    this.el.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== this.tab; });
    try { this.panels[this.tab]?.render?.(); } catch (e) { console.error('[dock] render failed', e); }
  }

  /** A token (mini) clicked on the table: a target while the tray is picking, else (DM) open it in the editor. */
  tokenClick(id) {
    if (this.ui.tray.tokenClick(id)) return;
    if (this.dm.isDM) this.ui.editor.openToken(id);
  }
}
