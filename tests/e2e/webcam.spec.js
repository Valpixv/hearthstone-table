import { test, expect } from '@playwright/test';
import { ready } from './helpers.js';

test.use({
  viewport: { width: 800, height: 600 },
  launchOptions: { args: [...(process.env.E2E_GPU ? ['--use-angle=d3d11', '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']), '--ignore-gpu-blocklist',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

test('normal player join starts the hand tracker with a simulated webcam', async ({ page, context }) => {
  const dm = await context.newPage();
  await dm.goto('/?fresh');
  await ready(dm);
  await dm.click('#btn-host');
  await expect(dm.locator('#code-badge')).toBeVisible();
  const code = await dm.evaluate(() => window.__tableSync.code);
  await dm.evaluate(() => window.__hearthstoneTest.renderer.setAnimationLoop(null));
  await page.goto('/?fresh', { waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.fill('#join-code', code);
  await page.fill('#player-name', 'Webcam player');
  await page.check('#join-webcam');
  await page.click('#btn-join');
  await expect(page.locator('#lobby')).toBeVisible();
  // lastTime advances only after the real MediaPipe detector loads and processes camera frames.
  await expect.poll(() => page.evaluate(() => window.__hearthstoneTest.input.jointSource?.lastTime ?? -1),
    { timeout: 60_000 }).toBeGreaterThan(0);
});
