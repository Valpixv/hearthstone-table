// The DM's AI Forge with the server's mock providers (no network, no keys): describe a creature → image draft →
// approve → it opens in the editor → Spawn. The Forge makes creatures only: items, backdrops and icons are refused.
import { test, expect } from '@playwright/test';
import { watch, startTest, game } from './helpers.js';

test.use({ viewport: { width: 1280, height: 720 } });

test('DM forges a creature; nothing else can be generated', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = []; watch(page, 'DM', errors);
  await page.route('**/api/ai/**', (route) => route.continue({ headers: { ...route.request().headers(), 'x-ai-mock': '1' } })); // mock providers for the forge only
  await startTest(page, 'dm');
  await page.click('#dm-tabs [data-tab=forge]');
  await expect(page.locator('#forge-prov')).toContainText('image: mock');
  await expect(page.locator('#forge-kind')).toHaveCount(0); // no kind picker: creatures only

  await page.fill('#forge-prompt', 'a moss troll');
  await page.click('#forge-go');
  await expect(page.locator('#forge-draft')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#forge-img')).toHaveAttribute('src', /\/api\/ai\/asset\/.+\.jpg/);
  await page.click('#forge-ok');
  await expect(page.locator('#creature-editor')).toBeVisible({ timeout: 30_000 }); // numbers are shown before anything spawns
  await expect(page.locator('#forge-lib .thumb')).toHaveCount(1);
  await page.click('#creature-editor [data-a=spawn]');
  await expect.poll(() => game(page, (T) => { const t = T.dm.state.tokens.find((x) => x.forge); const r = t && T.dm.tokens.refs[t.id]; return !!(r?.item && r?.life); }), { timeout: 60_000 }).toBe(true);
  expect(await game(page, (T) => T.dm.state.forge.library.map((e) => e.kind))).toEqual(['creature']);

  // The server refuses every other kind.
  for (const kind of ['backdrop', 'item', 'icon', 'avatar']) {
    const r = await page.request.post('/api/ai/image', { headers: { 'x-ai-mock': '1' }, data: { kind, prompt: 'elven ruins' } });
    expect(r.status(), kind).toBe(400);
  }
  expect(errors).toEqual([]);
});
