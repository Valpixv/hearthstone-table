import { makeAnimated } from './ModelLibrary.js';

/**
 * Per-frame registry for animated creature models (and small tickers such as hero-mini followers).
 * An entry whose `owner` Object3D has left the scene graph is dropped on the next update, so the
 * many removal paths (clearCreatures, removeCombatant, TableSync.removeObj) need no bookkeeping.
 */
const live = new Set();

/** Registers `ticker` ({ update(dt) }) for as long as `owner` stays parented (owner null = forever). */
export function track(owner, ticker) { const e = { owner, ticker }; live.add(e); return e; }
/** Removes a tracked entry. */
export function untrack(e) { live.delete(e); }

/** Advances every live mixer/ticker; call once per frame (DMController.update). No allocations. */
export function updateAnimations(dt) {
  for (const e of live) {
    if (e.owner && !e.owner.parent) { live.delete(e); continue; }
    e.ticker.update(dt);
  }
}

/**
 * Swaps the primitive `root.userData.inner` for an animated models.json model `height` units tall.
 * The primitive stays hidden while loading and comes back if the load fails.
 * root.userData.model is true while a model is loading or attached (callers skip primitive bobbing/toppling).
 * @param {THREE.Object3D} root creature root (mini or life-size) already added to the scene
 * @param {object} entry models.json entry
 * @param {number} height target height in metres
 * @param {{ y?: number, shadows?: boolean }} opts base offset and castShadow
 * @returns {Promise<object|null>} the ModelLibrary handle, or null on failure
 */
export function attachAnimated(root, entry, height, { y = 0, shadows = true } = {}) {
  const prim = root.userData.inner, k = height / (entry.scale || 1);
  if (prim) prim.visible = false;
  root.userData.model = true;
  return makeAnimated({ ...entry, scale: height, yOffset: (entry.yOffset || 0) * k }).then((h) => {
    if (!root.parent) return null; // removed before the model arrived
    h.root.position.y = y;
    if (!shadows) h.root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    if (prim) root.remove(prim);
    root.add(h.root); root.userData.inner = h.root; root.userData.anim = h;
    h.mixer.update(Math.random() * 2); // desync idles (visual only: never the seeded game RNG)
    h.mixer.addEventListener('finished', () => { if (root.userData.animState !== 'dead') h.play('idle'); });
    if (root.userData.animState === 'dead') h.play('death', { loop: false, fade: 0 });
    track(root, h);
    return h;
  }).catch((e) => {
    console.warn('[AnimRegistry] model failed, keeping primitive:', e);
    root.userData.model = false; if (prim) prim.visible = true;
    return null;
  });
}

/**
 * Plays a role clip ('idle' | 'attack' | 'hit' | 'death') on a creature root. One-shots return to idle,
 * except death, which holds until 'idle' (a heal). Safe on roots without a model.
 */
export function playRole(root, role) {
  if (!root) return;
  const ud = root.userData;
  if (role === 'death') ud.animState = 'dead';
  else if (role === 'idle') ud.animState = 'idle';
  else if (ud.animState === 'dead') return;
  ud.anim?.play(role, { loop: role === 'idle' });
}
