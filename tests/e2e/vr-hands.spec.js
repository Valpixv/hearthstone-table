// VR hands on Meta's emulated Quest (IWER, hand-tracking mode), through the real input path:
// IWER hand → the system hand ray + system pinch (select events) → XRPointer → VRUI.
// Covers: the Quest's own hand ray is used, pinch-and-release clicks (on release), a pinch that slips onto another
// button does not click it, closing a panel with its X, dragging a panel by its title, toss-to-close, scrolling by
// pinch-drag, the new VR panels (creature editor, tools, handouts, practice) and a long press opening the editor.
// Story type: Integration · Gate: BLOCKING. Real tracking noise and feel need the headset.
import { test, expect } from '@playwright/test';
import { watch, ready, game, newRoom } from './helpers.js';

test.use({ viewport: { width: 960, height: 540 } });

/**
 * Runs in the page: aims the emulated right hand's target ray at a world point from 35 cm in front of it
 * (IWER's hand pose is the target-ray pose, in the rig's local space).
 */
async function aimAt(page, target, back = 0.35) {
  await page.evaluate(async ({ target, back }) => {
    const T = window.__hearthstoneTest, THREE = T.THREE, dev = window.__iwer, hand = dev.hands.right, rig = T.camera.parent;
    rig.updateMatrixWorld(true);
    const tw = new THREE.Vector3(...target), head = new THREE.Vector3(); T.renderer.xr.getCamera().getWorldPosition(head);
    const ow = tw.clone().add(head.clone().sub(tw).normalize().multiplyScalar(back)); // between the eyes and the target
    const o = rig.worldToLocal(ow.clone()), t = rig.worldToLocal(tw.clone()), d = t.clone().sub(o).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), d);
    hand.position.set(o.x, o.y, o.z); hand.quaternion.set(q.x, q.y, q.z, q.w);
  }, { target, back });
  await page.waitForTimeout(250);
}
const pinch = async (page, v) => { await page.evaluate((x) => window.__iwer.hands.right.updatePinchValue(x), v); await page.waitForTimeout(350); };
/** World centre of a pressable rect on an open panel, found by key (string) or key pattern. */
const rectPoint = (page, id, key) => game(page, (T, a) => {
  const w = T.vrui.win(a.id); w.redraw();
  const r = w.rects.find((x) => (a.re ? new RegExp(a.re).test(x.key || '') : x.key === a.key) || (a.title && x.kind === 'title'));
  if (!r) return null;
  const W = 1000, local = new T.THREE.Vector3(((r.x + r.w / 2) / W - 0.5) * w.mw, (0.5 - (r.y + r.h / 2) / w.H) * w.mh, 0);
  return w.mesh.localToWorld(local).toArray();
}, { id, ...(key === 'title' ? { title: true } : key instanceof RegExp ? { re: key.source } : { key }) });

test('VR hands: system ray, pinch-click on release, close, drag, toss, scroll and the new panels', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = []; watch(page, 'VR', errors);
  await page.goto(`/?iwer&nodevui&test&fresh&room=${newRoom()}`); await ready(page);
  await page.check('input[value=dm]');
  await expect(page.locator('#btn-vr')).toBeEnabled({ timeout: 30_000 });
  await page.click('#btn-vr');
  await expect.poll(() => game(page, (T) => T.renderer.xr.isPresenting && T.vrui.active), { timeout: 60_000 }).toBe(true);
  await game(page, (T) => { T.dm.tokens.spawn({ name: 'Goblin', kind: 'monster', side: 'enemy', model: 'goblin', statId: 'goblin', hp: 7, maxHp: 7, ac: 15 }); T.dm.tokens.spawn({ name: 'Orc', kind: 'monster', side: 'enemy', model: 'orc', statId: 'orc', hp: 15, maxHp: 15, ac: 13 }); });

  // 1. The hand ray is the Quest's own (targetRaySpace), not one we build from the joints.
  await game(page, (T) => T.vrui.open('combat'));
  const start = await rectPoint(page, 'combat', /Start combat/);
  expect(start).not.toBeNull();
  await aimAt(page, start);
  const ptr = await game(page, (T) => { const p = T.vrui.ptr.pointers.find((x) => x.kind === 'hand' && x.hand === 'right'); return p && { source: p.source, owner: T.vrui.owner.right }; });
  expect(ptr).toEqual({ source: 'system', owner: 'ui' });

  // 2. Pinch down does not click yet; releasing does (click on release, like a mouse).
  await pinch(page, 1);
  expect(await game(page, (T) => T.combat.combat.active)).toBe(false);
  await pinch(page, 0);
  await expect.poll(() => game(page, (T) => T.combat.combat.active)).toBe(true);

  // 3. A pinch that starts on one button and is released far away on another clicks nothing.
  const next = await rectPoint(page, 'combat', /Next turn/), end = await rectPoint(page, 'combat', /End combat/);
  await aimAt(page, end); await pinch(page, 1); await aimAt(page, next); await pinch(page, 0);
  expect(await game(page, (T) => T.combat.combat.active)).toBe(true); // End combat was not clicked either

  // 4. The initiative list can be reordered from the headset, and a long pinch on a row opens the creature editor.
  const before = await game(page, (T) => T.combat.ordered().map((t) => t.name));
  const down0 = await rectPoint(page, 'combat', new RegExp(`^id${await game(page, (T) => T.combat.ordered()[0].id)}$`));
  await aimAt(page, down0); await pinch(page, 1); await pinch(page, 0);
  await expect.poll(() => game(page, (T) => T.combat.ordered().map((t) => t.name))).toEqual([before[1], before[0], ...before.slice(2)]);
  const row = await rectPoint(page, 'combat', new RegExp(`^io${await game(page, (T) => T.combat.ordered()[0].id)}$`));
  await aimAt(page, row); await pinch(page, 1); await page.waitForTimeout(900); await pinch(page, 0);
  await expect.poll(() => game(page, (T) => T.vrui.windows.get('edit')?.visible && !!T.vrui.sel.edit)).toBe(true);

  // 5. The editor changes the creature: AC +1, a condition on.
  const ed = await game(page, (T) => T.vrui.sel.edit), ac0 = await game(page, (T, id) => T.dm.tokens.find(id).ac, ed);
  await game(page, (T) => { const w = T.vrui.win('edit'); w.mesh.position.y += 0.0; }); // stays where it opened
  const acUp = await rectPoint(page, 'edit', 'ac+1');
  await aimAt(page, acUp); await pinch(page, 1); await pinch(page, 0);
  await expect.poll(() => game(page, (T, id) => T.dm.tokens.find(id).ac, ed)).toBe(ac0 + 1);
  // Off-screen buttons are only pressable once scrolled into view: scroll down until the Prone chip shows.
  const pr = await game(page, (T) => { const w = T.vrui.win('edit'); w.redraw(); for (let i = 0; i < 20 && !w.rects.some((x) => x.key === 'cnprone'); i++) { w.scrollBy(150); w.redraw(); } return w.rects.some((x) => x.key === 'cnprone'); });
  expect(pr).toBe(true);
  const prone = await rectPoint(page, 'edit', 'cnprone');
  await aimAt(page, prone); await pinch(page, 1); await pinch(page, 0);
  await expect.poll(() => game(page, (T, id) => T.dm.tokens.find(id).conditions.map((c) => c.name), ed)).toContain('prone');

  // 6. Scroll by pinching inside the content and dragging up.
  await game(page, (T) => { const w = T.vrui.win('edit'); w.scroll = 0; w.dirty = true; w.redraw(); });
  const mid = await game(page, (T) => { const w = T.vrui.win('edit'); return w.mesh.localToWorld(new T.THREE.Vector3(-w.mw * 0.35, -w.mh * 0.05, 0)).toArray(); });
  const higher = await game(page, (T) => { const w = T.vrui.win('edit'); return w.mesh.localToWorld(new T.THREE.Vector3(-w.mw * 0.35, w.mh * 0.25, 0)).toArray(); });
  await aimAt(page, mid); await pinch(page, 1);
  for (let k = 1; k <= 4; k++) await aimAt(page, mid.map((v, i) => v + (higher[i] - v) * (k / 4)));
  await pinch(page, 0);
  expect(await game(page, (T) => T.vrui.win('edit').scroll)).toBeGreaterThan(40);

  // 7. Close with the X.
  const x = await rectPoint(page, 'edit', 'close');
  await aimAt(page, x); await pinch(page, 1); await pinch(page, 0);
  await expect.poll(() => game(page, (T) => T.vrui.windows.get('edit').visible)).toBe(false);

  // 8. Drag a panel by its title bar, then toss it down below the table edge to close it.
  await game(page, (T) => T.vrui.open('tools'));
  const title = await rectPoint(page, 'tools', 'title'), y0 = await game(page, (T) => T.vrui.win('tools').mesh.position.y);
  await aimAt(page, title); await pinch(page, 1);
  await aimAt(page, [title[0], title[1] - 0.12, title[2]], 0.35);
  expect(await game(page, (T) => T.vrui.win('tools').mesh.position.y)).toBeLessThan(y0 - 0.03); // it follows the hand
  for (const y of [1.3, 1.0, 0.7]) await aimAt(page, [title[0], y, title[2]], 0.35); // down past the table top (0.78 m)
  await pinch(page, 0);
  await expect.poll(() => game(page, (T) => T.vrui.windows.get('tools').visible)).toBe(false);

  // 9. The new panels paint pressable things (tools, handouts, practice), and the menu lists them.
  const counts = await game(page, (T) => { const out = {}; for (const id of ['tools', 'handouts', 'lab', 'menu']) { const w = T.vrui.open(id); w.redraw(); out[id] = w.rects.filter((r) => r.run || r.drag || r.hold).length; } return out; });
  for (const [id, n] of Object.entries(counts)) expect(n, id).toBeGreaterThan(1);
  expect(await game(page, (T) => T.vrui.win('menu').rects.some((r) => r.key === 'm:lab') && T.vrui.win('menu').rects.some((r) => r.key === 'm:tools'))).toBe(true);
  await page.screenshot({ path: 'production/qa/evidence/vr-hands-2026-11-19/vr-panels.png' });
  expect(errors).toEqual([]);
});
