// Forge tab: describe a creature → image draft → approve → it opens in the Creature Editor with suggested numbers
// before anything spawns. The Forge makes creatures only (design/completion-plan.md C2).
import { guessStat } from '../../combat/CombatManager.js';
import { templateDef } from '../../tokens/TokenManager.js';
import { esc } from '../actions.js';
import { kitIcon } from '../kit.js';

export const FORGE_NOTE = 'AI Forge: suggested numbers from the closest template. Change anything, then Spawn.';

/** The editable def for a Forge library creature (suggested template numbers). */
export function forgeDef(e) {
  return { ...(templateDef(guessStat(e.prompt)) || {}), name: e.label, model: null, forge: e.id, life: true };
}

export function forgePanel(root, ui) {
  const { dm } = ui, forge = dm.forge;
  if (!forge) { root.innerHTML = '<p class="hint">The AI Forge is not available.</p>'; return { render() {} }; }
  root.innerHTML = `
    <section id="forge"><h4>AI Forge <small id="forge-prov" class="hint"></small></h4>
      <p class="hint">Describe a creature. You approve the picture before it becomes a model.</p>
      <div class="row"><input id="forge-prompt" placeholder="e.g. a hulking moss troll with a stone club" autocomplete="off"/><button id="forge-go" class="kimg" title="Generate a picture">${kitIcon('forge/generate')}<span class="art-caption">Generate</span></button></div>
      <div id="forge-draft" hidden><img id="forge-img" alt="AI draft"/>
        <div class="row forge-acts"><button id="forge-ok" class="kimg" title="Approve: make it a creature">${kitIcon('forge/approve')}<span class="art-caption">Approve</span></button><button id="forge-again" class="kimg" title="Regenerate the picture">${kitIcon('forge/regenerate')}<span class="art-caption">Regenerate</span></button><button id="forge-no" class="kimg" title="Discard">${kitIcon('forge/discard')}<span class="sr-only">Discard</span></button></div></div>
      <div id="forge-status" class="hint" role="status"></div></section>
    <section><h4>Forged creatures <button id="forge-clear" class="small" title="Remove every AI Forge creature from the table">Clear from table</button></h4>
      <p class="hint">They also appear in the Creatures gallery under “AI Forge”.</p>
      <div id="forge-lib"></div></section>`;
  const $ = (id) => root.querySelector('#' + id), say = (m) => { $('forge-status').textContent = m; };
  forge.status().then((p) => { $('forge-prov').textContent = p ? `image: ${p.image} · 3D: ${p.model}` : 'offline: run npm run dev'; if (!p) $('forge-go').disabled = true; });
  let draft = null, libSig = '';
  const setBusy = (b) => ['forge-go', 'forge-ok', 'forge-again'].forEach((id) => { $(id).disabled = b; });
  const gen = async () => {
    setBusy(true); say('Conjuring an image…'); $('forge-draft').hidden = true;
    try { draft = await forge.draft('creature', $('forge-prompt').value); $('forge-img').src = draft.image; $('forge-img').className = draft.kind; $('forge-draft').hidden = false; say('Approve it, or regenerate.'); }
    catch (e) { say('⚠ ' + e.message); }
    setBusy(false);
  };
  $('forge-go').onclick = gen; $('forge-again').onclick = gen;
  $('forge-prompt').onkeydown = (e) => { if (e.key === 'Enter') gen(); };
  $('forge-no').onclick = () => { draft = null; $('forge-draft').hidden = true; say(''); };
  $('forge-clear').onclick = () => forge.clear();
  $('forge-ok').onclick = async () => {
    if (!draft) return; setBusy(true);
    try {
      // Same library entry AIForge.approve builds, minus the automatic spawn.
      const entry = { id: `ai${Date.now().toString(36)}`, kind: 'creature', prompt: draft.prompt, label: draft.prompt.slice(0, 28), image: draft.image, model: null };
      say('Sculpting a 3D model…');
      const { url, provider } = await forge.post('/api/ai/model', { image: draft.image });
      entry.model = url; entry.modelProvider = provider;
      forge.library.unshift(entry); dm.emit();
      ui.editor.openNew(forgeDef(entry), { note: FORGE_NOTE });
      say('Check the numbers in the editor, then Spawn.');
      $('forge-draft').hidden = true; draft = null;
    } catch (e) { say('⚠ ' + e.message); }
    setBusy(false);
  };
  $('forge-lib').addEventListener('click', (e) => {
    const b = e.target.closest('[data-entry]'); if (!b) return;
    const en = forge.library.find((x) => x.id === b.dataset.entry); if (!en) return;
    ui.editor.openNew(forgeDef(en), { note: FORGE_NOTE });
  });
  return {
    render() {
      const lib = forge.library.filter((e) => e.kind === 'creature'), sig = lib.map((e) => e.id).join();
      if (sig === libSig) return; libSig = sig;
      $('forge-lib').innerHTML = lib.map((e) => `<button class="thumb" data-entry="${esc(e.id)}" title="${esc(e.prompt)}\nClick to open in the editor"><img src="${esc(e.image)}" alt=""/></button>`).join('') || '<p class="hint">Nothing forged yet.</p>';
    },
  };
}
