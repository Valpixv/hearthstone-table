// Voice chat between two browsers with Chromium's fake microphone (a repeating beep): both turn their microphone on,
// the peer connection completes over the table socket, and each side measures the other's audio.
// What this cannot cover: echo, latency and the microphone prompt inside a real headset browser.
import { test, expect } from '@playwright/test';
import { watch, startTest, game, newRoom, closeAll } from './helpers.js';

test.use({
  viewport: { width: 800, height: 450 },
  launchOptions: { args: [...(process.env.E2E_GPU ? ['--use-angle=d3d11', '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']), '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
});

test('two people hear each other: connection completes and audio flows both ways', async ({ browser }) => {
  test.setTimeout(process.env.CI ? 3 * 240_000 : 240_000);
  const errors = [], opts = { viewport: { width: 800, height: 450 }, permissions: ['microphone'] };
  const dmCtx = await browser.newContext(opts), plCtx = await browser.newContext(opts);
  const dm = await dmCtx.newPage(), pl = await plCtx.newPage(); watch(dm, 'DM', errors); watch(pl, 'PL', errors);
  try {
    const room = newRoom();
    await startTest(dm, 'dm', { room });
    await startTest(pl, 'player', { name: 'Aria', room });
    await dm.click('#mic-btn'); await pl.click('#mic-btn');
    await expect(dm.locator('#mic-btn')).toHaveText('Mic on', { timeout: 20_000 });
    await expect(pl.locator('#mic-btn')).toHaveText('Mic on', { timeout: 20_000 });
    const connected = (page) => game(page, (T) => [...T.voice.peers.values()].map((p) => p.pc.connectionState));
    await expect.poll(() => connected(dm), { timeout: 60_000 }).toEqual(['connected']);
    await expect.poll(() => connected(pl), { timeout: 60_000 }).toEqual(['connected']);
    // Incoming audio is measured on both sides (the fake microphone beeps about once a second).
    const heard = (page) => page.evaluate(async () => { const V = window.__hearthstoneTest.voice; let max = 0; for (let i = 0; i < 40; i++) { for (const p of V.peers.values()) max = Math.max(max, p.level || 0); await new Promise((r) => setTimeout(r, 100)); } return max; });
    expect(await heard(dm)).toBeGreaterThan(0.002);
    expect(await heard(pl)).toBeGreaterThan(0.002);
    // The voice is anchored to the other person's head (positional), and my own level shows I am sending.
    expect(await game(dm, (T) => { const p = [...T.voice.peers.values()][0]; return !!p.anchor?.parent && p.anchor.parent === T.avatars.headOf(p.id); })).toBe(true);
    // Mute stops sending; the other side falls silent.
    await pl.click('#mic-btn');
    await expect(pl.locator('#mic-btn')).toHaveText('Mic muted');
    await dm.waitForTimeout(1500);
    expect(await heard(dm)).toBeLessThan(0.01);
    // The DM can mute and unmute a player.
    await pl.click('#mic-btn'); await expect(pl.locator('#mic-btn')).toHaveText('Mic on');
    await game(dm, (T) => { const p = [...T.voice.peers.values()][0]; T.voice.muteOther(p.id, true); });
    await expect.poll(() => game(pl, (T) => T.voice.live), { timeout: 10_000 }).toBe(false);
    await game(dm, (T) => { const p = [...T.voice.peers.values()][0]; T.voice.muteOther(p.id, false); });
    await expect.poll(() => game(pl, (T) => T.voice.live), { timeout: 10_000 }).toBe(true);
    // Narrator voice: the DM's audio is routed evenly instead of from their seat.
    await game(dm, (T) => T.voice.setNarrator(true));
    await expect.poll(() => game(pl, (T) => { const p = [...T.voice.peers.values()][0]; return [p.narrator, p.spatial.gain.value, p.flat.gain.value > 1]; }), { timeout: 10_000 }).toEqual([true, 0, true]);
    expect(errors).toEqual([]);
  } finally { await closeAll(dmCtx, plCtx); }
});

test('someone without a microphone still hears the others', async ({ browser }) => {
  test.setTimeout(process.env.CI ? 3 * 180_000 : 180_000);
  const dmCtx = await browser.newContext({ permissions: ['microphone'] }), plCtx = await browser.newContext({ permissions: ['microphone'] });
  const dm = await dmCtx.newPage(), pl = await plCtx.newPage();
  try {
    const room = newRoom();
    await startTest(dm, 'dm', { room }); await startTest(pl, 'player', { name: 'Bram', room });
    await dm.click('#mic-btn'); // only the DM speaks
    await expect.poll(() => game(pl, (T) => [...T.voice.peers.values()].map((p) => p.pc.connectionState)), { timeout: 60_000 }).toEqual(['connected']);
    const max = await pl.evaluate(async () => { const V = window.__hearthstoneTest.voice; let m = 0; for (let i = 0; i < 40; i++) { for (const p of V.peers.values()) m = Math.max(m, p.level || 0); await new Promise((r) => setTimeout(r, 100)); } return m; });
    expect(max).toBeGreaterThan(0.002);
  } finally { await closeAll(dmCtx, plCtx); }
});
