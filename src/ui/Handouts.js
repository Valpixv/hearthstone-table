// Handouts (design/completion-plan.md §10): the DM shows a titled note (a letter, a riddle, a rumour) to chosen players.
// It travels as a `tell` message relayed only to those players; nothing is stored on the table, so players who were
// not shown it never receive it. Players see a parchment card (desktop) and a ribbon message (headset).
import { esc } from './actions.js';
import { kitIcon, symKey } from './kit.js';

export const HANDOUT_MAX = { title: 80, text: 1200, kept: 8 };

/** Cleans a handout from the network or the form. Returns null when it has no text at all. Pure. */
export function normalizeHandout(h = {}) {
  const title = String(h.title ?? '').trim().slice(0, HANDOUT_MAX.title), text = String(h.text ?? '').trim().slice(0, HANDOUT_MAX.text);
  return title || text ? { title: title || 'A note', text, from: String(h.from ?? 'The Dungeon Master').slice(0, 40) } : null;
}

export class Handouts {
  /** @param {{ dm: object, sync: object, onShow?: (h: object) => void, doc?: Document }} deps */
  constructor({ dm, sync, onShow = null, doc = globalThis.document }) {
    Object.assign(this, { dm, sync, onShow, doc }); this.list = [];
    sync.on('tell', (m) => { if (m.kind === 'handout') this.receive(m.handout); });
    if (!doc) return;
    this.el = doc.createElement('div'); this.el.id = 'handout'; this.el.hidden = true; this.el.setAttribute('role', 'dialog'); this.el.setAttribute('aria-label', 'Handout');
    doc.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === this.el) this.close(); if (e.target.closest('[data-prev]')) this.show(this.index + 1); });
  }

  /**
   * DM: shows a handout to players. to: 'all' or a list of player (client) ids.
   * @returns {number} how many players it was sent to
   */
  send(handout, to = 'all') {
    const h = normalizeHandout(handout); if (!h || this.sync.role !== 'dm') return 0;
    const ids = (this.sync.players || []).filter((p) => p.role === 'player' && (to === 'all' || to.includes(p.id))).map((p) => p.id);
    for (const id of ids) this.sync.send({ t: 'tell', to: id, kind: 'handout', handout: h });
    this.sync.toast?.(ids.length ? `Handout shown to ${ids.length} player${ids.length === 1 ? '' : 's'}.` : 'No players to show it to yet.', ids.length ? 'join' : 'warn');
    return ids.length;
  }

  /** A handout arrived for this player. */
  receive(raw) {
    const h = normalizeHandout(raw); if (!h) return;
    this.list.unshift(h); this.list.length = Math.min(this.list.length, HANDOUT_MAX.kept);
    this.show(0); this.onShow?.(h);
  }

  show(i = 0) {
    if (!this.el || !this.list.length) return;
    this.index = ((i % this.list.length) + this.list.length) % this.list.length;
    const h = this.list[this.index];
    this.el.hidden = false;
    this.el.innerHTML = `<div class="ho-card">${kitIcon(symKey('world/show'), { cls: 'ho-ic' })}<h3>${esc(h.title)}</h3><p>${esc(h.text).replace(/\n/g, '<br>')}</p>
      <footer><small>From ${esc(h.from)}${this.list.length > 1 ? ` · ${this.index + 1} of ${this.list.length}` : ''}</small>${this.list.length > 1 ? '<button data-prev>Older</button>' : ''}<button class="btn" data-close>Close</button></footer></div>`;
  }
  close() { if (this.el) this.el.hidden = true; }
  /** The latest handout this player was shown (for the VR panel), or null. */
  latest() { return this.list[0] || null; }
}
