// Scores battle-gesture tuning against recorded Gesture Lab samples (design/vr-hands-plan.md §5). Pure: used by
// tools/tune-gestures.mjs and by the replay tests.
import { GestureTracker } from './castGestures.js';

const unpack = (o) => { if (!o) return null; const j = {}; for (const [k, p] of Object.entries(o)) j[k] = { p }; return j; };

/** Replays one segment through fresh trackers; returns the fired gestures. */
export function replaySegment(seg, cfg) {
  const tr = { left: new GestureTracker('left', cfg), right: new GestureTracker('right', cfg) }, fires = [];
  let last = 0;
  for (const f of seg.frames || []) {
    const dt = Math.max(1 / 240, Math.min(0.1, (f.t ?? last) - last)); last = f.t ?? last + dt;
    for (const side of ['left', 'right']) { const r = tr[side].update(unpack(f[side]), dt); if (r.fire) fires.push(r.fire.gesture); }
  }
  return fires;
}

/**
 * Score for a tuning on a set of sample files: hits (right sign, up to `reps` per segment) minus penalties for wrong
 * signs and for anything fired during ordinary movement. Higher is better.
 * @returns {{ score: number, hits: number, wanted: number, wrong: number, idle: number, per: object }}
 */
export function scoreTuning(files, cfg, { reps = 8, wrongCost = 2, idleCost = 3 } = {}) {
  let hits = 0, wanted = 0, wrong = 0, idle = 0; const per = {};
  for (const file of files) for (const seg of file.segments || []) {
    const fires = replaySegment(seg, cfg), p = (per[seg.label] ||= { hits: 0, wanted: 0, wrong: 0 });
    if (seg.label === 'idle') { idle += fires.length; p.wrong += fires.length; continue; }
    const h = Math.min(reps, fires.filter((g) => g === seg.label).length), w = fires.filter((g) => g !== seg.label).length;
    hits += h; wanted += reps; wrong += w; p.hits += h; p.wanted += reps; p.wrong += w;
  }
  return { score: hits - wrongCost * wrong - idleCost * idle, hits, wanted, wrong, idle, per };
}

/** Parameters the tuner may move, with the multipliers it tries. */
export const TUNABLE = ['extendRatio', 'curlRatio', 'thumbOut', 'thumbIn', 'hold', 'flickSpeed', 'pushSpeed', 'slashSpeed', 'slashBias', 'triggerWindow'];
const STEPS = [0.8, 0.9, 1.1, 1.2];

/** Coordinate descent over TUNABLE. Returns { cfg, before, after }. */
export function tune(files, base, { passes = 3, reps = 8 } = {}) {
  let cfg = { ...base }, best = scoreTuning(files, cfg, { reps });
  const before = best;
  for (let pass = 0; pass < passes; pass++) {
    let improved = false;
    for (const k of TUNABLE) for (const m of STEPS) {
      const c = { ...cfg, [k]: +(cfg[k] * m).toFixed(4) };
      if (c.curlRatio >= c.extendRatio || c.thumbIn >= c.thumbOut) continue;
      const s = scoreTuning(files, c, { reps });
      if (s.score > best.score) { best = s; cfg = c; improved = true; }
    }
    if (!improved) break;
  }
  return { cfg, before, after: best };
}
