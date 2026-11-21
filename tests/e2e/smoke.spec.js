// Smoke: the DM's critical path on one machine in Test mode (desktop). Screenshots are QA evidence.
// Story type: Integration · Evidence: production/qa/evidence/completion-<date>/ · Gate: BLOCKING (smoke)
import { test, expect } from '@playwright/test';
import { watch, startTest, game, EVIDENCE } from './helpers.js';

test.use({ viewport: { width: 1280, height: 720 } });

test('DM critical path smoke', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = []; watch(page, 'DM', errors);
  await startTest(page, 'dm');
  // Test mode skips the character stage and opens the dock on the Table tab.
  expect(await game(page, (T) => T.dm.state.session.stage)).toBe('play');
  await expect(page.locator('#dm-panel')).toBeVisible();
  await expect(page.locator('#dm-tabs .tab')).toHaveCount(6);
  await page.screenshot({ path: `${EVIDENCE}/10-dock-table.png` });

  // Quick-add two players, open one sheet.
  await page.fill('#qa-names', 'Brienne, Elminster'); await page.click('#qa-go');
  await expect(page.locator('.st-roster li')).toHaveCount(2);

  // Creatures: a gallery tile opens the editor; Spawn puts a token with a health bar on the table.
  await page.click('#dm-tabs [data-tab=creatures]');
  await page.click('[data-filter=templates]');
  await page.locator('.gal-tile', { hasText: 'Goblin' }).first().click();
  await expect(page.locator('#creature-editor')).toBeVisible();
  await page.click('#creature-editor [data-a=spawn]');
  await expect(page.locator('#tok-list .tok.enemy')).toHaveCount(1);
  await page.screenshot({ path: `${EVIDENCE}/11-dock-creatures.png` });
  const gob = await game(page, (T) => { const t = T.dm.state.tokens.find((x) => x.kind === 'monster'); return { id: t.id, hp: t.hp, lifePos: t.lifePos, life: !!T.dm.tokens.refs[t.id].life }; });
  expect(gob.life).toBe(true);
  expect(Math.hypot(...gob.lifePos)).toBeGreaterThan(1.6); // standing in the room, clear of the table

  // Typed HP: -3 then Enter.
  const hpBox = page.locator('#tok-list .tok.enemy .hp-expr');
  await hpBox.fill('-3'); await hpBox.press('Enter');
  await expect.poll(() => game(page, (T, id) => T.dm.tokens.find(id).hp, gob.id)).toBe(gob.hp - 3);

  // A second and third spawn never stand on the first.
  const spots = await game(page, (T) => { for (let i = 0; i < 3; i++) T.dm.tokens.spawn({ name: `Orc ${i}`, kind: 'monster', side: 'enemy', model: 'orc', statId: 'orc', hp: 15, maxHp: 15, ac: 13, life: true });
    return T.dm.state.tokens.filter((t) => t.lifePos).map((t) => t.lifePos); });
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) expect(Math.hypot(spots[i][0] - spots[j][0], spots[i][1] - spots[j][1])).toBeGreaterThan(0.9);

  // Combat: start, initiative, next turn.
  await page.click('#cb-start');
  await expect(page.locator('#cr-combat')).toBeVisible();
  await game(page, (T) => { for (const t of T.dm.state.tokens) if (t.init == null) T.dm.act('initiative', { id: t.id, value: 10 }); });
  const turn = await game(page, (T) => T.combat.combat.turn);
  await page.click('#cr-combat [data-t=next]');
  await expect.poll(() => game(page, (T) => T.combat.combat.turn)).not.toBe(turn);

  // The dice tray rolls an instant pool and shows a result card.
  await page.click('#dm-tabs [data-tab=dice]');
  await page.fill('#dt-expr', '2d6+3'); await page.locator('#dt-expr').press('Tab');
  await page.check('input[name=dt-as][value=instant]');
  await page.click('#dt-roll');
  await expect(page.locator('#dt-card .dt-total')).toHaveText(/^\d+$/);
  await page.screenshot({ path: `${EVIDENCE}/12-dice-result.png` });
  await page.click('#dt-card [data-c=close]');

  // World: one fixed map (no control changes it); the fog toggles; a scene change is accepted.
  await page.click('#dm-tabs [data-tab=world]');
  await expect(page.locator('[data-w="map:next"]')).toHaveCount(0);
  await expect(page.getByText('Next map')).toHaveCount(0);
  await page.click('[data-w="map:fog"]');
  expect(await game(page, (T) => T.dm.state.map.fogOfWar)).toBe(true);
  expect(await game(page, (T) => 'index' in T.dm.state.map)).toBe(false);
  await page.click('[data-w="weather:rain"]');
  expect(await game(page, (T) => T.dm.state.weather.rain)).toBe(true);
  await page.screenshot({ path: `${EVIDENCE}/13-dock-world.png` });

  // Save and load keep the table.
  const before = await game(page, (T) => T.dm.state.tokens.length);
  await page.click('#dm-tabs [data-tab=table]');
  await page.click('#ss-save');
  await game(page, (T) => T.dm.clearCreatures());
  await page.click('#ss-load');
  await expect.poll(() => game(page, (T) => T.dm.state.tokens.length), { timeout: 30_000 }).toBe(before);
  expect(errors).toEqual([]);
});

test('character sheet: fill from a class, roll from the sheet, rest', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = []; watch(page, 'DM', errors);
  await startTest(page, 'dm');
  await page.fill('#qa-names', 'Aria'); await page.click('#qa-go');
  await page.click('.st-roster [data-st=sheet]');
  await expect(page.locator('#char-sheet')).toBeVisible();
  await page.selectOption('#char-sheet [data-a=fill-class]', 'cleric');
  await page.selectOption('#char-sheet [data-a=fill-species]', 'dwarf');
  await page.selectOption('#char-sheet [data-a=fill-background]', 'acolyte');
  const s = await game(page, (T) => { const t = T.dm.state.tokens.find((x) => x.kind === 'pc'); return { cls: t.sheet.cls, saves: Object.keys(t.sheet.saves).sort(), feats: t.sheet.feats.map((f) => f.name), traits: t.sheet.speciesTraits.length, weapons: t.sheet.weapons.length, cast: t.sheet.castAbility }; });
  expect(s).toMatchObject({ cls: 'Cleric', saves: ['cha', 'wis'], feats: ['Magic Initiate (Cleric)'], cast: 'wis' });
  expect(s.traits).toBeGreaterThan(2); expect(s.weapons).toBe(2);
  await page.screenshot({ path: `${EVIDENCE}/14-sheet-page1.png` });
  // Clicking a skill rolls it through the tray with the sheet's modifier.
  await game(page, (T) => { T.tray.physical = false; });
  await page.click('#char-sheet [data-roll="save:wis"]');
  await expect(page.locator('#dt-card')).toContainText('Wisdom save');
  await page.click('#dt-card [data-c=close]');
  // Long rest restores a spent slot.
  await page.click('#char-sheet [data-tabk=spells]');
  await page.click('#char-sheet [data-a=slots-fill]');
  await page.locator('#char-sheet .pip').first().click();
  await expect.poll(() => game(page, (T) => T.dm.state.tokens.find((x) => x.kind === 'pc').sheet.slots[1].used)).toBe(1);
  await page.screenshot({ path: `${EVIDENCE}/15-sheet-spells.png` });
  await page.click('#char-sheet [data-tabk=sheet]');
  await page.click('#char-sheet [data-a=rest-long]');
  await expect.poll(() => game(page, (T) => T.dm.state.tokens.find((x) => x.kind === 'pc').sheet.slots[1].used)).toBe(0);
  // Bag: an unknown item gets the closest painted icon, never a generated one.
  await page.click('#char-sheet [data-tabk=inv]');
  await page.fill('#char-sheet [data-a=add-name]', 'Glowing troll tooth'); await page.click('#char-sheet [data-a=add]');
  await expect(page.locator('#char-sheet .item img.item-icon')).toHaveAttribute('src', /assets\/kit\/item\/bone\.webp/);
  await page.screenshot({ path: `${EVIDENCE}/16-sheet-bag.png` });
  expect(errors).toEqual([]);
});
