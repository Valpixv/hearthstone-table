// Gesture casting through the real pipeline (joint source → InputManager → GestureTracker → Caster → StrikeFlow), driven
// by synthetic hands from the test harness skeleton (the same joints WebXR and MediaPipe produce).
// What this cannot cover: how a real headset's tracking noise behaves. That needs the headset.
import { test, expect } from '@playwright/test';
import { watch, startTest, game } from './helpers.js';

test.use({ viewport: { width: 960, height: 540 } });

/** Installs a joint source that holds a hand shape, then performs its firing motion. Runs in the page. */
async function playGesture(page, gesture) {
  return page.evaluate(async (g) => {
    const T = window.__hearthstoneTest;
    const { POSE_SPECS, resolvePose } = await import('/harness/synth/skeleton.js');
    const { handInPose } = await import('/tests/helpers/hands.js');
    const SPECS = {
      point: POSE_SPECS.point,
      gun: { flex: { ...POSE_SPECS.point.flex }, spread: POSE_SPECS.point.spread, thumb: { mode: 'rest' } },
      palm: POSE_SPECS.open,
      slash: POSE_SPECS.open,
    };
    // Seat 0 faces -z. Palm-down hand, fingers along -z; the open palm is turned up to face -z (fingers up) for the push.
    // The slash keeps the palm down and swipes sideways (+x), knuckle edge first.
    const rot = g === 'palm' ? [90, 0, 0] : [0, 0, 0], wrist = [0.15, 1.15, 0.7];
    const base = handInPose(resolvePose(SPECS[g]), { wrist, rot }), drop = handInPose(resolvePose(SPECS.point), { wrist, rot });
    const shift = (h, d) => Object.fromEntries(Object.entries(h).map(([k, j]) => [k, { ...j, p: g === 'slash' ? [j.p[0] - d, j.p[1], j.p[2]] : [j.p[0], j.p[1], j.p[2] + d] }]));
    let t = 0;
    const HOLD = 0.9, MOVE = 0.5, SPEED = 1.6; // seconds held, seconds moving, metres per second (above the flick / push thresholds)
    await T.input.setJointSource({ update(dt) { t += dt;
      if (t < HOLD) return { right: base };
      if (g === 'gun') return { right: drop };            // the thumb drops: the trigger
      const k = Math.min(MOVE, t - HOLD); return { right: shift(base, -SPEED * k) }; } });
    // Wait on the simulation clock, not the wall clock: software rendering can run at a few frames a second.
    for (let i = 0; i < 600 && t < HOLD + MOVE + 0.4; i++) await new Promise((r) => setTimeout(r, 100));
    await T.input.setJointSource(null);
    await new Promise((r) => setTimeout(r, 300));
    return true;
  }, gesture);
}

for (const gesture of ['point', 'gun', 'palm', 'slash']) {
  test(`a "${gesture}" hand sign releases the confirmed strike and the damage lands`, async ({ page }) => {
    test.setTimeout(process.env.CI ? 3 * 180_000 : 180_000);
    const errors = []; watch(page, 'DM', errors);
    await startTest(page, 'dm');
    const ids = await game(page, (T) => {
      T.caster.setCastMode(true); // step 1 checks a free cast changes nothing; free casting is opt-in
      const binds = ['point', 'gun', 'palm', 'slash'].map((x, i) => ({ gesture: x, effectId: ['fireball', 'magic-missile', 'thunderwave', 'lightning-bolt'][i] }));
      const [pc] = T.dm.act('spawn', { def: { name: 'Aria', kind: 'pc', side: 'ally', model: 'wizard', sheet: { cls: 'Wizard', castBindings: binds }, inventory: [], coins: {} } });
      const [foe] = T.dm.tokens.spawn({ name: 'Ogre', kind: 'monster', side: 'enemy', model: 'ogre', statId: 'ogre', hp: 40, maxHp: 40, ac: 11, life: true, lifePos: [0.15, -3.2] });
      return { pc: pc.id, foe: foe.id };
    });
    await expect.poll(() => game(page, (T, id) => !!T.dm.tokens.refs[id]?.life, ids.foe), { timeout: 60_000 }).toBe(true);

    // 1. With nothing confirmed, the sign is a free cast: an effect plays, no hit points change.
    await playGesture(page, gesture);
    expect(await game(page, (T, id) => T.dm.tokens.find(id).hp, ids.foe)).toBe(40);

    // 2. The DM confirms 7 damage: the same sign now releases it.
    await game(page, (T, i) => T.dm.act('strike', { by: i.pc, targets: [{ id: i.foe, amount: 7 }], damageType: 'fire' }), ids);
    expect(await game(page, (T) => T.caster.armedStrike()?.status)).toBe('armed');
    expect(await game(page, (T, id) => T.dm.tokens.find(id).hp, ids.foe)).toBe(40); // armed, not applied
    await playGesture(page, gesture);
    await expect.poll(() => game(page, (T, id) => T.dm.tokens.find(id).hp, ids.foe), { timeout: 20_000 }).toBe(33);
    expect(await game(page, (T) => T.dm.state.strikes.length)).toBe(0);
    expect(errors).toEqual([]);
  });
}

test('a resting hand, a fist and a hand holding a die never cast', async ({ page }) => {
  test.setTimeout(process.env.CI ? 3 * 180_000 : 180_000);
  await startTest(page, 'dm');
  const fired = await page.evaluate(async () => {
    const T = window.__hearthstoneTest;
    const { POSE_SPECS, resolvePose, curlPose } = await import('/harness/synth/skeleton.js');
    const { handInPose } = await import('/tests/helpers/hands.js');
    T.dm.act('spawn', { def: { name: 'Aria', kind: 'pc', side: 'ally', model: 'wizard', sheet: { castBindings: [{ gesture: 'point', effectId: 'fireball' }, { gesture: 'palm', effectId: 'thunderwave' }] }, inventory: [], coins: {} } });
    T.caster.setCastMode(true); // free casting on, so a false fire would show up as a cast
    let casts = 0; const cast = T.caster.cast.bind(T.caster); T.caster.cast = (...a) => { casts++; return cast(...a); };
    const wrist = [0.15, 1.15, 0.7], shapes = [handInPose(resolvePose(POSE_SPECS.fist), { wrist }), handInPose(curlPose(0.45), { wrist }), handInPose(resolvePose(POSE_SPECS.pinch), { wrist })];
    for (const h of shapes) { // each shape is held, then shoved forward fast: only a cast shape may fire
      let t = 0; await T.input.setJointSource({ update(dt) { t += dt; const k = Math.max(0, Math.min(0.5, t - 0.8)); return { right: Object.fromEntries(Object.entries(h).map(([n, j]) => [n, { ...j, p: [j.p[0], j.p[1], j.p[2] - 1.6 * k] }])) }; } });
      for (let i = 0; i < 600 && t < 1.7; i++) await new Promise((r) => setTimeout(r, 100));
    }
    await T.input.setJointSource(null);
    return casts;
  });
  expect(fired).toBe(0);
});
