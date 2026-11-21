import { describe, it, expect } from 'vitest';
import { ReplayInputSource, REPLAY_DT } from '../../src/input/ReplayInputSource.js';
import { hand } from '../../harness/synth/hand.js';
import { encodeRecording } from '../../harness/format/recording.js';
import { dist } from '../../harness/math.js';

const rec72 = () => hand('right').at([0, 1, 0]).moveTo([0.3, 1, 0], 1, { ease: 'linear' }).record({ fps: 72, tail: 0 });
const load = async (opts) => new ReplayInputSource({ ui: false, ...opts }).load();

describe('ReplayInputSource', () => {
  it('returns recording frames one per fixed tick, in WebXR joint format', async () => {
    const rec = rec72();
    const src = await load({ recording: rec });
    for (let i = 0; i < rec.frames.length; i++) {
      const f = src.update(REPLAY_DT);
      expect(f.right.wrist.p).toEqual(rec.frames[i].right.wrist.p);
      expect(Object.keys(f.right)).toHaveLength(25);
    }
    expect(src.done).toBe(true);
  });

  it('accepts packed files', async () => {
    const rec = rec72();
    const src = await load({ recording: encodeRecording(rec) });
    expect(src.update(REPLAY_DT).right.wrist.p).toEqual(rec.frames[0].right.wrist.p);
  });

  it('interpolates when the recording rate differs from the tick rate', async () => {
    const rec = hand('right').at([0, 1, 0]).moveTo([0.3, 1, 0], 1, { ease: 'linear' }).record({ fps: 24, tail: 0 });
    const src = await load({ recording: rec });
    const frames = Array.from({ length: 72 }, () => src.update(REPLAY_DT));
    const xs = frames.map((f) => f.right.wrist.p[0]);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]); // smooth, strictly moving
  });

  it('holds the last frame after the end, or hides hands with endBehavior=hide', async () => {
    const rec = rec72();
    const hold = await load({ recording: rec });
    const hide = await load({ recording: rec, endBehavior: 'hide' });
    for (let i = 0; i < rec.frames.length + 10; i++) {
      hold.update(REPLAY_DT);
      hide.update(REPLAY_DT);
    }
    expect(hold.update(REPLAY_DT).right).toBeDefined();
    expect(hide.update(REPLAY_DT)).toEqual({});
  });

  it('loops back to the start', async () => {
    const rec = rec72();
    const src = await load({ recording: rec, loop: true });
    for (let i = 0; i < rec.frames.length + 5; i++) src.update(REPLAY_DT);
    expect(src.loops).toBe(1);
    expect(src.done).toBe(false);
    // Back near the start of the move (x = 0), far from its end (x = 0.3).
    expect(dist(src.update(REPLAY_DT).right.wrist.p, rec.frames[0].right.wrist.p)).toBeLessThan(0.05);
  });

  it('ticksDue: speed changes ticks per wall-second, never the per-tick outcome', async () => {
    const run = async (speed) => {
      const src = await load({ recording: rec72(), speed });
      let ticks = 0;
      for (let i = 0; i < 60; i++) ticks += src.ticksDue(1 / 60); // one wall-clock second
      return ticks;
    };
    expect(await run(1)).toBeGreaterThanOrEqual(71);
    expect(await run(1)).toBeLessThanOrEqual(72);
    expect(await run(0.25)).toBe(18);
    expect(await run(4)).toBe(288);
    const s = await load({ recording: rec72(), speed: 99 });
    expect(s.speed).toBe(4);
    s.setSpeed(0.01);
    expect(s.speed).toBe(0.25);
  });

  it('pause stops ticks; step() releases exactly n', async () => {
    const src = await load({ recording: rec72() });
    src.pause();
    expect(src.ticksDue(1)).toBe(0);
    src.step(3);
    expect(src.ticksDue(1 / 60)).toBe(3);
    expect(src.ticksDue(1 / 60)).toBe(0);
    src.play();
    expect(src.ticksDue(1 / 72 + 1e-6)).toBe(1);
  });

  it('exposes the recording setup for the app to apply', async () => {
    const rec = rec72();
    rec.meta = { setup: { clearDice: true, dice: [{ type: 'd6', pos: [0, 0.8, 0.3] }] } };
    const src = await load({ recording: rec });
    expect(src.setup.dice[0].type).toBe('d6');
  });

  it('fails loudly on an invalid recording', async () => {
    await expect(load({ recording: { version: 1, source: 'synthetic', fps: 72, frames: [{ t: 0, right: {} }] } })).rejects.toThrow(/Invalid HandRecording/);
  });
});
