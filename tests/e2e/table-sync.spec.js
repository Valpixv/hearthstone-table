// The whole session in two browsers (design/completion-plan.md §0): the DM hosts and gets a code, a player joins with it,
// builds a character and presses Ready, the DM begins, then one full action: the DM calls for damage, the player rolls,
// the DM confirms it, and only the player's release changes the monster's hit points, on both tables.
// Story type: Integration · Gate: BLOCKING
import { test, expect } from '@playwright/test';
import { watch, ready, game, EVIDENCE } from './helpers.js';

test.use({ viewport: { width: 1280, height: 720 } });

test('host, join by code, build a character, and deal damage with a released strike', async ({ browser }) => {
  test.setTimeout(240_000);
  const errors = [], dmCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } }), plCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const dm = await dmCtx.newPage(), pl = await plCtx.newPage(); watch(dm, 'DM', errors); watch(pl, 'PL', errors);
  try {
    // --- the DM hosts and gets an invite code ---
    await dm.goto('/?fresh'); await ready(dm);
    await dm.screenshot({ path: `${EVIDENCE}/01-home.png` });
    await dm.fill('#host-name', 'Mordenkainen');
    await dm.click('#btn-host');
    await expect(dm.locator('#code-badge')).toBeVisible({ timeout: 30_000 });
    const code = await dm.evaluate(() => window.__tableSync.code);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    await expect(dm.locator('#dm-invite .invite-code')).toHaveText(code);
    expect(await game(dm, (T) => T.dm.state.session.stage)).toBe('lobby');

    // --- a wrong code is refused on the home screen ---
    await pl.goto('/?fresh'); await ready(pl);
    await pl.fill('#join-code', 'ZZZZZZ'); await pl.fill('#player-name', 'Aria');
    await pl.click('#btn-join');
    await expect(pl.locator('#home-error')).toContainText('No table has that code', { timeout: 60_000 });
    await expect(pl.locator('#start')).toBeVisible();

    // --- the player joins with the real code and lands in the character builder ---
    await pl.goto('/?fresh'); await ready(pl);
    await pl.fill('#join-code', code.toLowerCase()); await pl.fill('#player-name', 'Aria');
    await pl.click('#btn-join');
    await expect(pl.locator('#lobby')).toBeVisible({ timeout: 30_000 });
    await expect(pl.locator('#lobby .lb-steps button')).toHaveCount(6);
    await pl.screenshot({ path: `${EVIDENCE}/02-builder-class.png` });
    await pl.click('[data-b=class][data-id=wizard]');
    await pl.click('[data-b=next]'); await pl.click('[data-b=species][data-id=elf]'); await pl.click('[data-b=background][data-id=sage]');
    await pl.click('[data-b=next]');
    await pl.screenshot({ path: `${EVIDENCE}/03-builder-abilities.png` });
    await pl.click('[data-b=method][data-id=roll]'); await pl.click('[data-b=roll][data-how=instant]'); // rolled scores (instant: no physics wait)
    await expect(pl.locator('.lb-rolled span')).toHaveCount(6);
    await pl.click('[data-b=step][data-i="5"]');
    await pl.screenshot({ path: `${EVIDENCE}/04-builder-review.png` });
    await pl.click('#lb-ready');
    await expect(pl.locator('#lobby')).toHaveAttribute('data-mode', 'wait');

    // --- the DM sees the finished character and begins ---
    await expect(dm.locator('.st-roster li.ok')).toHaveCount(1, { timeout: 20_000 });
    await expect(dm.locator('.st-roster li.ok')).toContainText('Wizard');
    const sheet = await game(dm, (T) => { const t = T.dm.state.tokens.find((x) => x.kind === 'pc'); return { cls: t.sheet.cls, species: t.sheet.species, bg: t.sheet.background, binds: t.sheet.castBindings.length, slots: t.sheet.slots[1]?.max, hp: t.maxHp, items: t.inventory.length }; });
    expect(sheet).toMatchObject({ cls: 'Wizard', species: 'Elf', bg: 'Sage', binds: 4, slots: 2 });
    expect(sheet.hp).toBeGreaterThan(0); expect(sheet.items).toBeGreaterThan(3);
    await dm.screenshot({ path: `${EVIDENCE}/05-dm-roster.png` });
    await dm.click('#st-begin');
    await expect(pl.locator('#lobby')).toHaveAttribute('data-mode', 'headset', { timeout: 20_000 });
    await expect(pl.locator('.lb-codes')).toContainText(code); // table code + rejoin number for the headset
    await pl.screenshot({ path: `${EVIDENCE}/06-put-on-headset.png` });
    await pl.click('#lb-stay');
    await expect(pl.locator('#lobby')).toBeHidden();

    // A DM's own die cannot answer an online player's call. A wrong player die also leaves it open.
    await game(dm, (T) => {
      const pc = T.dm.state.tokens.find((t) => t.kind === 'pc');
      T.dm.act('call', { to: [pc.id], kind: 'custom', expr: '1d6+2', label: 'Hand roll' });
      T.rolls.collectLoose({ type: 'd6', value: 6 }); T.rolls.flushLoose();
    });
    await expect(pl.locator('#call-prompt .cp-card')).toContainText('Hand roll');
    await game(pl, (T) => {
      T.rolls.collectLoose({ type: 'd20', value: 20 }); T.rolls.flushLoose();
    });
    await expect(dm.locator('#call-desk .cd-card.wait')).toContainText('Hand roll');
    await game(pl, (T) => {
      T.rolls.collectLoose({ type: 'd6', value: 4 }); T.rolls.flushLoose();
    });
    await expect(dm.locator('#call-desk .cd-total')).toHaveText('6');
    await dm.click('#call-desk [data-d=done]');

    // A reveal and a fresh mask both reach the player.
    await game(dm, (T) => T.dm.setFogOfWar(true));
    await expect.poll(() => game(pl, (T) => T.dm.table.fog.visible)).toBe(true);
    const fogAlpha = () => game(pl, (T) => T.dm.table.fogCanvas.getContext('2d').getImageData(128, 90, 1, 1).data[3]);
    await game(dm, (T) => T.dm.table.revealUV(0.5, 0.5));
    await expect.poll(fogAlpha).toBeLessThan(20);
    await game(dm, (T) => { T.dm.setFogOfWar(false); T.dm.setFogOfWar(true); });
    await expect.poll(fogAlpha).toBe(255);

    // --- one action: call → roll → confirm → release ---
    const ids = await game(dm, (T) => {
      const pc = T.dm.state.tokens.find((x) => x.kind === 'pc');
      const [g] = T.dm.tokens.spawn({ name: 'Goblin', kind: 'monster', side: 'enemy', model: 'goblin', statId: 'goblin', hp: 30, maxHp: 30, ac: 15, life: true });
      T.dm.act('call', { to: [pc.id], kind: 'damage', expr: '2d6+3', targetId: g.id, damageType: 'fire', label: 'Fire Bolt damage' });
      return { pc: pc.id, gob: g.id };
    });
    await expect(pl.locator('#call-prompt .cp-card')).toContainText('Fire Bolt damage', { timeout: 20_000 });
    await pl.screenshot({ path: `${EVIDENCE}/07-player-call-prompt.png` });
    await game(pl, (T) => { T.tray.physical = false; });
    await pl.click('#call-prompt [data-roll]');
    await expect(dm.locator('#call-desk .cd-card.rolled')).toContainText('Fire Bolt damage', { timeout: 20_000 });
    const rolled = await game(dm, (T) => T.dm.state.calls[0].result.total);
    expect(rolled).toBeGreaterThanOrEqual(5); expect(rolled).toBeLessThanOrEqual(15);
    await dm.screenshot({ path: `${EVIDENCE}/08-dm-confirm-card.png` });
    await dm.click('#call-desk [data-d=confirm]');
    await expect(pl.locator('#strike-banner')).toBeVisible({ timeout: 20_000 });
    await pl.screenshot({ path: `${EVIDENCE}/09-player-unleash.png` });
    // Confirmed, not released: nobody has lost a hit point yet.
    expect(await game(dm, (T, id) => T.dm.tokens.find(id).hp, ids.gob)).toBe(30);
    expect(await game(pl, (T, id) => T.dm.tokens.find(id).hp, ids.gob)).toBe(30);
    await pl.click('#strike-banner [data-unleash]');
    await expect.poll(() => game(dm, (T, id) => T.dm.tokens.find(id).hp, ids.gob), { timeout: 30_000 }).toBe(30 - rolled);
    await expect.poll(() => game(pl, (T, id) => T.dm.tokens.find(id).hp, ids.gob), { timeout: 30_000 }).toBe(30 - rolled);
    expect(await game(dm, (T) => T.dm.state.strikes.length)).toBe(0);
    await expect(pl.locator('#strike-banner')).toBeHidden();

    // --- a player cannot release someone else's strike, or change their own hit points ---
    await game(dm, (T, i) => T.dm.act('strike', { by: i.gob, targets: [{ id: i.pc, amount: 2 }] }), ids);
    await expect.poll(() => game(pl, (T) => T.dm.state.strikes.length), { timeout: 15_000 }).toBe(1);
    expect(await game(pl, (T) => !!T.caster.armedStrike())).toBe(false);
    await game(dm, (T) => T.dm.act('strike.now', { id: T.dm.state.strikes[0].id }));
    await expect.poll(() => game(pl, (T, id) => { const t = T.dm.tokens.find(id); return t.maxHp - t.hp; }, ids.pc), { timeout: 15_000 }).toBe(2);
    expect(errors).toEqual([]);
  } finally { await dmCtx.close(); await plCtx.close(); }
});

test('a player who rejoins with their number keeps their character', async ({ browser }) => {
  test.setTimeout(180_000);
  const dmCtx = await browser.newContext(), aCtx = await browser.newContext(), bCtx = await browser.newContext();
  const dm = await dmCtx.newPage(), a = await aCtx.newPage(), b = await bCtx.newPage();
  try {
    await dm.goto('/?fresh'); await ready(dm); await dm.click('#btn-host');
    await expect.poll(() => dm.evaluate(() => window.__tableSync.code), { timeout: 30_000 }).toMatch(/^\w{6}$/);
    const code = await dm.evaluate(() => window.__tableSync.code);
    await a.goto('/?fresh'); await ready(a); await a.fill('#join-code', code); await a.fill('#player-name', 'Bram'); await a.click('#btn-join');
    await expect.poll(() => a.evaluate(() => window.__tableSync.me?.rejoin), { timeout: 30_000 }).toMatch(/^\d{4}$/);
    const me = await a.evaluate(() => window.__tableSync.me);
    await expect.poll(() => dm.evaluate(() => window.__hearthstoneTest.dm.state.tokens.filter((t) => t.kind === 'pc').length), { timeout: 20_000 }).toBe(1);
    // The same person arrives on a second device (their headset) with the table code and their rejoin number.
    await b.goto('/?fresh'); await ready(b); await b.fill('#join-code', code); await b.fill('#join-rejoin', me.rejoin); await b.click('#btn-join');
    await expect.poll(() => b.evaluate(() => window.__tableSync.me?.id), { timeout: 30_000 }).toBe(me.id);
    expect(await b.evaluate(() => window.__tableSync.me.seat)).toBe(me.seat);
    await expect(a.locator('#home-error')).toContainText('moved to another device', { timeout: 20_000 }); // the first device gives up the seat
    await expect.poll(() => b.evaluate(() => window.__hearthstoneTest.builder.token?.name), { timeout: 20_000 }).toBe('Bram');
    expect(await dm.evaluate(() => window.__hearthstoneTest.dm.state.tokens.filter((t) => t.kind === 'pc').length)).toBe(1); // no duplicate character
  } finally { await dmCtx.close(); await aCtx.close(); await bCtx.close(); }
});
