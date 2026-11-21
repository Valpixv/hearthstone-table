// Drive the real app in headless Chromium from a HandRecording, deterministically.
//
// The page is opened paused (?paused=1), so the app's own render loop runs zero replay ticks.
// The test then advances the simulation itself, one fixed 1/72 s tick at a time, through
// window.__hearthstoneTest.step(1, 1/72) and records a state snapshot after every tick.

export const TICK = 1 / 72;

// Bounds of the felt tray (src/physics/Physics.js TRAY: x 0.42 ± 0.28, z 0.05 ± 0.25).
export const TRAY_BOUNDS = { minX: 0.14, maxX: 0.7, minZ: -0.2, maxZ: 0.3 };
export const inTray = (p) => p[0] > TRAY_BOUNDS.minX && p[0] < TRAY_BOUNDS.maxX && p[2] > TRAY_BOUNDS.minZ && p[2] < TRAY_BOUNDS.maxZ;

/** Collect console errors and uncaught exceptions for the page's lifetime. */
export function watchErrors(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/** Open the app in replay mode and wait until the recording is loaded and its setup applied. */
export async function openReplay(page, name, { seed = 42 } = {}) {
  await page.goto(`/?replay=recordings/${name}.json&seed=${seed}&paused=1&replayUi=0`);
  await page.waitForFunction(
    () => {
      const t = window.__hearthstoneTest;
      const r = window.__hearthstoneReplay;
      if (!t || !r?.frames) return false;
      if (t.replayReady) return true;
      // Fallback for builds without the replayReady flag: setup dice are in place.
      const want = r.setup?.dice ?? [];
      const dice = t.snapshot().dice;
      return dice.length === want.length && want.every((w, i) => Math.hypot(...w.pos.map((v, k) => v - dice[i].position[k])) < 0.02);
    },
    null,
    { timeout: 120_000 }, // the campfire scene loads ~45 MB of models under software WebGL
  );
  return page.evaluate(() => ({
    frames: window.__hearthstoneReplay.frameCount,
    setup: window.__hearthstoneReplay.setup,
    start: window.__hearthstoneTest.snapshot(),
  }));
}

/**
 * Step the whole recording plus `settle` extra seconds. Returns one snapshot per tick
 * (with the replay frame index), so tests can assert on the full trajectory.
 */
export async function runReplay(page, { settle = 4, every = 1 } = {}) {
  return page.evaluate(
    ({ settle, every, dt }) => {
      const t = window.__hearthstoneTest;
      const r = window.__hearthstoneReplay;
      const total = r.frameCount + Math.round(settle / dt);
      const out = [];
      for (let i = 0; i < total; i++) {
        const s = t.step(1, dt);
        if (i % every === 0 || i === total - 1) out.push({ tick: i, replayFrame: r.frameIndex, done: r.done, ...s });
      }
      return out;
    },
    { settle, every, dt: TICK },
  );
}

export const speed = (v) => Math.hypot(v[0], v[1], v[2]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const dieById = (snap, id) => snap.dice.find((d) => d.id === id);
