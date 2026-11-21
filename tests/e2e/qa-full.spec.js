// The interface inside the headset, on Meta's emulated Quest (IWER, `?iwer`): the session starts, every panel paints and
// can be pressed, the DM moves a life-size creature and pulls new ones out of the gallery, and a player-style release works.
// Story type: Integration · Gate: BLOCKING. Real hand-tracking feel and frame rate still need a headset.
import { test, expect } from '@playwright/test';
import { watch, ready, game, newRoom } from './helpers.js';

test.use({ viewport: { width: 960, height: 540 } });

test('VR: panels, presses, creature dragging and strike release on the emulated headset', async ({ page }) => {
  test.setTimeout(process.env.CI ? 3 * 240_000 : 240_000);
  const errors = []; watch(page, 'VR', errors);
  await page.goto(`/?iwer&nodevui&test&fresh&room=${newRoom()}`); await ready(page);
  await page.check('input[value=dm]');
  await expect(page.locator('#btn-vr')).toBeEnabled({ timeout: 30_000 });
  await page.click('#btn-vr');
  await expect.poll(() => game(page, (T) => T.renderer.xr.isPresenting && T.vrui.active), { timeout: 60_000 }).toBe(true);

  // Seated at the DM's seat, not at the table centre.
  const rig = await game(page, (T) => [T.camera.parent.position.x, T.camera.parent.position.z]);
  expect(Math.hypot(...rig)).toBeGreaterThan(0.6);

  // Every panel paints something pressable (DM sees all of them).
  await game(page, (T) => { T.dm.act('spawn', { def: { name: 'Bram', kind: 'pc', side: 'ally', model: 'fighter', sheet: { cls: 'Fighter', weapons: [{ name: 'Longsword', bonus: '+5', damage: '1d8+3', type: 'slashing' }] }, inventory: [{ ref: 'rope', name: 'Rope' }], coins: { gp: 5 } } }); });
  const panels = await game(page, (T) => { const out = {}; for (const id of ['menu', 'dice', 'sheet', 'bag', 'spells', 'voice', 'creatures', 'combat', 'requests', 'world', 'table', 'forge']) { const w = T.vrui.open(id); w.redraw(); out[id] = w.rects.filter((r) => r.run || r.drag).length; } return out; });
  for (const [id, n] of Object.entries(panels)) expect(n, id).toBeGreaterThan(0);
  expect(panels.menu).toBeGreaterThanOrEqual(12); expect(panels.creatures).toBeGreaterThan(10);

  // A ray through a panel finds the control under it; pressing it acts on the table.
  const press = await game(page, (T) => {
    const U = T.vrui, w = U.win('combat'); w.redraw();
    const r = w.rects.find((x) => /Start combat/.test(x.key || ''));
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    // canvas point → world point on the panel, then a ray from the head through it
    const local = { x: (cx / 1000 - 0.5) * w.mw, y: (0.5 - cy / w.H) * w.mh };
    const world = w.mesh.localToWorld(w.mesh.position.clone().set(local.x, local.y, 0));
    const head = U.head().p, dir = world.clone().sub(head).normalize(), hit = w.raycast(head, dir), under = hit && w.rectAt(hit.x, hit.y);
    const before = T.combat.combat.active; if (under?.run) U.press(w, under, { id: 'right' });
    return { found: under?.key === r.key, before, after: T.combat.combat.active };
  });
  expect(press).toEqual({ found: true, before: false, after: true });

  // The keyboard types a narration.
  const typed = await game(page, (T) => {
    const U = T.vrui; let got = null; U.askText('Narration', '', (t) => { got = t; });
    const w = U.win('kbd'); for (const ch of ['h', 'i']) { w.redraw(); U.press(w, w.rects.find((r) => r.key === `k${ch}`), { id: 'right' }); }
    w.redraw(); U.press(w, w.rects.find((r) => r.key === 'kb4'), { id: 'right' });
    return got;
  });
  expect(typed).toBe('hi');

  // DM: drag a standing creature; it settles on a free spot and the spot is saved on the token.
  const drag = await game(page, (T) => {
    const [a] = T.dm.tokens.spawn({ name: 'Orc', kind: 'monster', side: 'enemy', model: 'orc', statId: 'orc', hp: 15, maxHp: 15, ac: 13, life: true });
    const [b] = T.dm.tokens.spawn({ name: 'Wolf', kind: 'monster', side: 'enemy', model: 'wolf', statId: 'wolf', hp: 11, maxHp: 11, ac: 13, life: true });
    const L = T.lifeDrag; L.begin(a.id); L.moveTo(b.lifePos[0], b.lifePos[1]); L.end(); // dropped right on top of the wolf
    return { a: T.dm.tokens.find(a.id).lifePos, b: b.lifePos };
  });
  expect(Math.hypot(drag.a[0] - drag.b[0], drag.a[1] - drag.b[1])).toBeGreaterThan(0.9);

  // DM: pull three goblins out of the gallery onto the floor, and one onto the map (mini only).
  const pulled = await game(page, (T) => {
    const L = T.lifeDrag, def = { name: 'Goblin', kind: 'monster', side: 'enemy', model: 'goblin', statId: 'goblin', hp: 7, maxHp: 7, ac: 15 };
    L.beginGhost(def, 3); L.moveGhost({ x: 3, z: 2.5, onMap: false }); const floor = L.endGhost();
    L.beginGhost(def, 1); L.moveGhost({ x: 0.05, z: 0.05, onMap: true }); const map = L.endGhost();
    return { floor: floor.map((t) => ({ life: t.life, pos: t.lifePos })), map: map.map((t) => t.life) };
  });
  expect(pulled.floor).toHaveLength(3); expect(pulled.floor.every((t) => t.life)).toBe(true); expect(pulled.map).toEqual([false]);
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(Math.hypot(pulled.floor[i].pos[0] - pulled.floor[j].pos[0], pulled.floor[i].pos[1] - pulled.floor[j].pos[1])).toBeGreaterThan(0.7);

  // A confirmed strike shows on the ribbon and the Spells panel releases it.
  const strike = await game(page, async (T) => {
    const pc = T.dm.state.tokens.find((t) => t.kind === 'pc'), foe = T.dm.state.tokens.find((t) => t.name === 'Orc');
    T.dm.act('strike', { by: pc.id, targets: [{ id: foe.id, amount: 6 }], damageType: 'slashing' });
    const standing = T.vrui.standing()?.kind, hp0 = foe.hp;
    const w = T.vrui.win('spells'); w.redraw(); T.vrui.press(w, w.rects.find((r) => /Unleash it now/.test(r.key || '')), { id: 'right' });
    await new Promise((r) => setTimeout(r, 2500));
    return { standing, hp0, hp1: T.dm.tokens.find(foe.id).hp, left: T.dm.state.strikes.length };
  });
  expect(strike).toEqual({ standing: 'strike', hp0: 15, hp1: 9, left: 0 });
  expect(errors).toEqual([]);
});
