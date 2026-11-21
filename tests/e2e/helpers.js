// Shared helpers for the session-flow specs (design/completion-plan.md). The replay specs keep replay-helpers.js.
import { expect } from '@playwright/test';

export const DATE = new Date().toISOString().slice(0, 10);
/** Retained screenshots (QA evidence). */
export const EVIDENCE = `production/qa/evidence/completion-${DATE}`;
/** Console noise that is not a defect: software WebGL, a muted audio device, the emulated headset. */
export const IGNORE = /GL Driver|GPU stall|performance|skinning|WebGL|swiftshader|ReadPixels|Automatic fallback|THREE\.|AudioContext|Replay source unavailable|NotAllowedError|Permission|getUserMedia|favicon/i;

/** Collects page errors and console errors (minus IGNORE) into `errors`. */
export function watch(page, tag, errors) {
  page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(`${tag} console.error: ${m.text().slice(0, 300)}`); });
}

/** Waits until the page's game hooks exist. */
export async function ready(page) { await page.waitForFunction(() => !!window.__hearthstoneTest && !!window.__tableSync, null, { timeout: 60_000 }); }

/**
 * Starts a quick test session from the home screen's Test mode row (no table code, no character stage).
 * @param {import('@playwright/test').Page} page @param {'dm'|'player'} role @param {{ query?: string, name?: string }} [o]
 */
/** A table name no other test uses (tests run in parallel against one server). */
export const newRoom = () => `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

export async function startTest(page, role = 'dm', { query = '', name = '', room = newRoom() } = {}) {
  await page.goto(`/?test&fresh&room=${room}${query}`);
  await ready(page);
  if (name) await page.fill('#player-name', name);
  await page.check(`input[value=${role}]`);
  await page.click('#btn-desktop');
  await expect.poll(() => page.evaluate(() => window.__tableSync.role), { timeout: 30_000 }).toBe(role);
  await expect(page.locator('#net-badge')).toHaveClass(/online/, { timeout: 30_000 });
}

/** Runs fn(T, arg) in the page with T = window.__hearthstoneTest. */
export const game = (page, fn, arg) => page.evaluate(([src, a]) => (0, eval)(`(${src})`)(window.__hearthstoneTest, a), [fn.toString(), arg]);

/**
 * Closes browser contexts without letting a stuck close fail the test: on a GPU-less CI runner, disposing a
 * software-WebGL context can hang after the test has already passed, and that hang then breaks the next test.
 */
export async function closeAll(...ctxs) {
  await Promise.all(ctxs.map((c) => Promise.race([c.close().catch(() => {}), new Promise((r) => setTimeout(r, 15_000))])));
}
