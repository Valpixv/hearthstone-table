import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validateRecording, encodeRecording, decodeRecording, parseRecording, roundRecording, createRecording,
} from '../../harness/format/recording.js';
import { JOINT_NAMES } from '../../harness/format/joints.js';
import { handInPose } from '../helpers/hands.js';

const RECORDINGS = resolve(import.meta.dirname, '../../recordings');
const canned = readdirSync(RECORDINGS).filter((f) => f.endsWith('.json'));

const good = () =>
  roundRecording(
    createRecording({
      source: 'synthetic',
      fps: 72,
      frames: [
        { t: 0, right: handInPose('open') },
        { t: 1 / 72, right: handInPose('fist'), left: handInPose('open', { handedness: 'left' }) },
        { t: 2 / 72 },
      ],
    }),
  );
const errorsOf = (rec) => validateRecording(rec).errors.join('\n');

describe('recording validator', () => {
  it('accepts a well-formed recording', () => {
    expect(validateRecording(good())).toEqual({ ok: true, errors: [] });
  });

  it.each(canned)('accepts canned recording %s', (file) => {
    const rec = JSON.parse(readFileSync(resolve(RECORDINGS, file), 'utf8'));
    const res = validateRecording(rec);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('ships at least 8 canned recordings', () => {
    expect(canned.length).toBeGreaterThanOrEqual(8);
  });

  const cases = [
    ['non-object', () => 'hello', /JSON object/],
    ['wrong version', (r) => ({ ...r, version: 2 }), /version/],
    ['unknown source', (r) => ({ ...r, source: 'kinect' }), /source/],
    ['bad fps', (r) => ({ ...r, fps: 0 }), /fps/],
    ['no frames', (r) => ({ ...r, frames: [] }), /frames/],
    ['time going backwards', (r) => { r.frames[1].t = 0; return r; }, /strictly increasing/],
    ['negative time', (r) => { r.frames[0].t = -1; return r; }, /t: must be/],
    ['unknown frame key', (r) => { r.frames[0].middle = {}; return r; }, /unknown key/],
    ['missing joint', (r) => { delete r.frames[0].right['index-finger-tip']; return r; }, /index-finger-tip: missing joint/],
    ['extra joint', (r) => { r.frames[0].right.elbow = r.frames[0].right.wrist; return r; }, /unknown joint "elbow"/],
    ['position wrong length', (r) => { r.frames[0].right.wrist.p = [0, 1]; return r; }, /wrist\.p/],
    ['NaN position', (r) => { r.frames[0].right.wrist.p = [0, NaN, 0]; return r; }, /wrist\.p/],
    ['position out of range', (r) => { r.frames[0].right.wrist.p = [0, 1000, 0]; return r; }, /out of range/],
    ['non-unit quaternion', (r) => { r.frames[0].right.wrist.q = [0, 0, 0, 2]; return r; }, /unit quaternion/],
    ['quaternion wrong length', (r) => { r.frames[0].right.wrist.q = [0, 0, 1]; return r; }, /wrist\.q/],
    ['negative radius', (r) => { r.frames[0].right.wrist.r = -0.01; return r; }, /radius/],
    ['hand is an array', (r) => { r.frames[0].right = []; return r; }, /hand must be an object/],
  ];
  it.each(cases)('rejects %s', (_, mutate, pattern) => {
    const res = validateRecording(mutate(structuredClone(good())));
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toMatch(pattern);
  });

  it('rejects malformed packed files', () => {
    const packed = encodeRecording(good());
    const short = structuredClone(packed);
    short.frames[0].right = short.frames[0].right.slice(1);
    expect(errorsOf(short)).toMatch(/packed hand must be 200 integers/);
    const floats = structuredClone(packed);
    floats.frames[0].right[0] = 0.5;
    expect(errorsOf(floats)).toMatch(/integers/);
    const badFields = structuredClone(packed);
    badFields.encoding.fields = ['x'];
    expect(errorsOf(badFields)).toMatch(/encoding.fields/);
    const badType = structuredClone(packed);
    badType.encoding.type = 'gzip';
    expect(errorsOf(badType)).toMatch(/packed/);
  });

  it('parseRecording throws a readable error listing problems', () => {
    expect(() => parseRecording({ version: 1, source: 'webxr', fps: 72, frames: [{ t: 0, right: {} }] })).toThrow(/missing joint/);
  });
});

describe('compression', () => {
  it('rounds to 4 decimals', () => {
    const r = roundRecording(createRecording({ fps: 72, frames: [{ t: 0, right: handInPose('open') }] }), 4);
    for (const n of JOINT_NAMES) for (const v of r.frames[0].right[n].p) expect(Math.abs(v * 1e4 - Math.round(v * 1e4))).toBeLessThan(1e-6);
  });

  it('packed + delta round-trips exactly (after rounding) and is much smaller', () => {
    const rec = good();
    for (const delta of [true, false]) {
      const packed = encodeRecording(rec, { delta });
      expect(validateRecording(packed).ok).toBe(true);
      const back = decodeRecording(packed);
      back.frames.forEach((f, i) => {
        for (const h of ['left', 'right']) {
          expect(!!f[h]).toBe(!!rec.frames[i][h]);
          if (!f[h]) continue;
          for (const n of JOINT_NAMES) {
            f[h][n].p.forEach((v, k) => expect(v).toBeCloseTo(rec.frames[i][h][n].p[k], 6));
            f[h][n].q.forEach((v, k) => expect(v).toBeCloseTo(rec.frames[i][h][n].q[k], 6));
          }
        }
      });
    }
    const file = JSON.parse(readFileSync(resolve(RECORDINGS, 'grab-and-hold.json'), 'utf8'));
    const plain = JSON.stringify(decodeRecording(file)).length;
    expect(JSON.stringify(file).length).toBeLessThan(plain / 3);
  });
});
