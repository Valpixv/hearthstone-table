// Replay-mode integration tests: real app, real physics, synthetic hands, headless Chromium.
// To add a gesture test: generate a recording (npm run synth -- --script <name>), then add an
// entry below with what must be true about the trajectory / final state.
import { test, expect } from '@playwright/test';
import { openReplay, runReplay, watchErrors, inTray, speed, dist, dieById } from './replay-helpers.js';

test.describe.configure({ mode: 'parallel' });

/** First tick index at which `pred(snapshot)` holds, or -1. */
const firstTick = (trace, pred) => trace.findIndex(pred);

const CASES = {
  'pinch-spawn': async ({ start, trace }) => {
    const end = trace.at(-1);
    expect(end.dice.length, 'one new die').toBe(start.dice.length + 1);
    const spawned = end.dice.find((d) => !start.dice.some((s) => s.id === d.id));
    expect(spawned.type).toBe('d20');
    const heldAt = firstTick(trace, (s) => dieById(s, spawned.id)?.held);
    expect(heldAt, 'spawned straight into the pinching hand').toBeGreaterThanOrEqual(0);
    expect(end.rollCount, 'released over the tray -> a roll').toBeGreaterThan(start.rollCount ?? 0);
    expect(inTray(dieById(end, spawned.id).position)).toBe(true);
  },

  'grab-and-hold': async ({ start, trace }) => {
    const id = start.dice[0].id;
    const grabbed = firstTick(trace, (s) => dieById(s, id).held);
    expect(grabbed, 'die gets grabbed').toBeGreaterThan(0);
    const after = trace.slice(grabbed);
    expect(after.every((s) => dieById(s, id).held), 'stays held to the end').toBe(true);
    // It travels with the hand: >25 cm path, and ends far from where it started.
    const path = after.slice(1).reduce((sum, s, i) => sum + dist(dieById(s, id).position, dieById(after[i], id).position), 0);
    expect(path).toBeGreaterThan(0.25);
    expect(dist(dieById(trace.at(-1), id).position, start.dice[0].position)).toBeGreaterThan(0.15);
    expect(trace.at(-1).heldObject).not.toBeNull();
  },

  'gentle-drop': async ({ start, trace }) => {
    const id = start.dice[0].id;
    expect(firstTick(trace, (s) => dieById(s, id).held)).toBeGreaterThan(0);
    const end = trace.at(-1);
    expect(dieById(end, id).held).toBe(false);
    expect(inTray(dieById(end, id).position), `rest position ${dieById(end, id).position}`).toBe(true);
    expect(end.rollCount).toBeGreaterThan(start.rollCount ?? 0);
  },

  'hard-throw': async ({ start, trace }) => {
    const id = start.dice[0].id;
    const grabbed = firstTick(trace, (s) => dieById(s, id).held);
    expect(grabbed, 'die gets grabbed').toBeGreaterThan(0);
    const released = firstTick(trace.slice(grabbed), (s) => !dieById(s, id).held) + grabbed;
    expect(released).toBeGreaterThan(grabbed);
    // It was thrown, not dropped: fast right after release.
    const v = Math.max(...trace.slice(released, released + 3).map((s) => speed(dieById(s, id).velocity)));
    expect(v, 'release speed').toBeGreaterThan(1.5);
    // Never fell off the table (the app would silently re-toss it into the tray).
    expect(Math.min(...trace.map((s) => dieById(s, id).position[1]))).toBeGreaterThan(0.7);
    const end = trace.at(-1);
    expect(inTray(dieById(end, id).position), `rest position ${dieById(end, id).position}`).toBe(true);
    expect(end.rollCount).toBeGreaterThan(start.rollCount ?? 0);
    expect(end.lastRoll.type).toBe('d20');
    expect(end.lastRoll.value).toBeGreaterThanOrEqual(1);
    expect(end.lastRoll.value).toBeLessThanOrEqual(20);
  },

  'poke-die': async ({ start, trace }) => {
    const id = start.dice[0].id;
    expect(trace.every((s) => !dieById(s, id).held), 'a poke never grabs').toBe(true);
    expect(Math.max(...trace.map((s) => speed(dieById(s, id).velocity))), 'poke changes the velocity').toBeGreaterThan(0.05);
    expect(dist(dieById(trace.at(-1), id).position, start.dice[0].position), 'die moved').toBeGreaterThan(0.01);
  },

  'flick-die': async ({ start, trace }) => {
    const id = start.dice[0].id;
    expect(trace.every((s) => !dieById(s, id).held), 'a flick never grabs').toBe(true);
    expect(Math.max(...trace.map((s) => speed(dieById(s, id).velocity))), 'flick changes the velocity').toBeGreaterThan(0.1);
    const end = dieById(trace.at(-1), id).position;
    expect(end[2], 'flicked away from the player (-z)').toBeLessThan(start.dice[0].position[2] - 0.02);
  },

  'two-hand-grab': async ({ start, trace }) => {
    const ids = start.dice.map((d) => d.id);
    expect(ids).toHaveLength(2);
    const end = trace.at(-1);
    for (const id of ids) expect(dieById(end, id).held, `die ${id} held`).toBe(true);
    // Lifted together well above the table.
    for (const id of ids) expect(dieById(end, id).position[1]).toBeGreaterThan(start.dice[0].position[1] + 0.12);
  },

  'jitter-grab': async ({ start, trace }) => {
    const id = start.dice[0].id;
    const grabbed = firstTick(trace, (s) => dieById(s, id).held);
    expect(grabbed).toBeGreaterThan(0);
    const dropped = firstTick(trace.slice(grabbed), (s) => !dieById(s, id).held);
    expect(dropped, `tracking noise dropped the die ${dropped} ticks after the grab`).toBe(-1);
  },

  'dropout-grab': async ({ start, trace }) => {
    const id = start.dice[0].id;
    const grabbed = firstTick(trace, (s) => dieById(s, id).held);
    expect(grabbed).toBeGreaterThan(0);
    const dropped = firstTick(trace.slice(grabbed), (s) => !dieById(s, id).held);
    expect(dropped, `a tracking dropout released the die ${dropped} ticks after the grab`).toBe(-1);
  },
};

for (const [name, check] of Object.entries(CASES)) {
  test(`replay: ${name}`, async ({ page }) => {
    const errors = watchErrors(page);
    const { start } = await openReplay(page, name);
    const trace = await runReplay(page);
    expect(trace.at(-1).done, 'recording played to the end').toBe(true);
    await check({ start, trace });
    expect(errors, 'console errors during replay').toEqual([]);
  });
}

test('replays are deterministic for a given seed', async ({ browser }) => {
  const run = async () => {
    const page = await browser.newPage();
    await openReplay(page, 'hard-throw', { seed: 42 });
    const end = (await runReplay(page)).at(-1);
    await page.close();
    return end;
  };
  const [a, b] = await Promise.all([run(), run()]);
  // Bit-exact: everything that touches physics runs on the sim clock in replay mode.
  expect(a.lastRoll).toEqual(b.lastRoll);
  expect(a.rollCount).toBe(b.rollCount);
  expect(a.dice.map((d) => d.position)).toEqual(b.dice.map((d) => d.position));
  expect(a.dice.map((d) => d.velocity)).toEqual(b.dice.map((d) => d.velocity));
});

test('the render loop at 4x speed reaches the same result as manual stepping', async ({ page }) => {
  test.slow();
  const errors = watchErrors(page);
  await openReplay(page, 'grab-and-hold', { seed: 42 });
  const stepped = (await runReplay(page, { settle: 0.5 })).at(-1);
  // Reload, this time let the app's own requestAnimationFrame loop drive the replay at 4x.
  await page.goto('/?replay=recordings/grab-and-hold.json&seed=42&speed=4&replayUi=0');
  await page.waitForFunction(() => window.__hearthstoneReplay?.done, null, { timeout: 60_000 });
  const live = await page.evaluate(() => window.__hearthstoneTest.snapshot());
  expect(live.dice[0].held).toBe(stepped.dice[0].held);
  // Same final hold position to within a tick of hand motion (the live loop may stop mid-frame).
  expect(dist(live.dice[0].position, stepped.dice[0].position)).toBeLessThan(0.02);
  expect(errors).toEqual([]);
});
