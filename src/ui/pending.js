import { closeIcon } from './kit.js';
// Pending damage chips (player-roll damage awaiting the DM). Shown in the Creatures tab.
import { esc } from './actions.js';

/** HTML for the DM's pending damage chips. */
export function pendingChipsHTML(mgr) {
  return (mgr?.pending || []).map((p) => {
    const t = mgr.find(p.targetId);
    return `<span class="pend-chip" data-pend="${p.pid}" title="${esc(p.source || 'Damage')} → ${esc(t?.name || '?')}">
      <b>${p.crit ? '★ ' : ''}${esc(t?.name || '?')}</b><small>${esc(p.type || '')}</small>
      <input type="number" min="0" value="${p.amount}" data-pamt="${p.pid}" title="Edit the amount"/>
      <button class="small ok" data-pact="apply" data-pid="${p.pid}">Apply</button><button class="small" data-pact="half" data-pid="${p.pid}" title="Half">½</button><button class="small" data-pact="double" data-pid="${p.pid}" title="Double">×2</button><button aria-label="Discard" class="small ghost" data-pact="discard" data-pid="${p.pid}" title="Discard">${closeIcon()}</button></span>`;
  }).join('');
}

/** Delegated click handler for pending chips inside root. The edited amount wins over the rolled one. */
export function bindPendingChips(root, mgr) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pact]'); if (!b) return;
    const pid = b.dataset.pid, p = mgr.pending.find((x) => x.pid === pid); if (!p) return;
    const inp = root.querySelector(`[data-pamt="${pid}"]`), typed = inp ? Number(inp.value) : p.amount;
    const override = Number.isFinite(typed) && typed !== p.amount ? typed : null, a = b.dataset.pact;
    if (a === 'discard') mgr.discardPending(pid);
    else mgr.applyPending(pid, a === 'half' ? { multiplier: 0.5, override: override != null ? override * 0.5 : null }
      : a === 'double' ? { multiplier: 2, override: override != null ? override * 2 : null } : { override });
  });
}
