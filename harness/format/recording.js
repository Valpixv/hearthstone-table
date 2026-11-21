// HandRecording v1 — versioned hand-tracking recording format, validator, and compact encoding.
//
// Canonical (in-memory / human-readable) form:
//   {
//     version: 1,
//     source: 'webxr' | 'mediapipe' | 'synthetic',
//     fps: 72,                       // nominal capture rate (frames carry their own t)
//     meta?: { name, description, ... free-form },
//     frames: [ { t: seconds, left?: Hand, right?: Hand }, ... ]   // t strictly increasing
//   }
//   Hand = { [jointName]: { p: [x,y,z], q: [x,y,z,w], r: radius } }  — all 25 WebXR joints,
//   world space, metres.
//
// Packed (on-disk) form — same top-level fields plus `encoding`, and hands as flat int arrays:
//   encoding: { type: 'packed', decimals: 4, delta: true, joints: [...25 names], fields: [...] }
//   frames:   [ { t, left?: int[200], right?: int[200] } ]
//   Each hand array is joints x [px,py,pz,qx,qy,qz,qw,r] scaled by 10^decimals. With delta=true
//   each array stores the difference from that hand's previous *present* frame.

import { JOINT_NAMES, JOINT_COUNT } from './joints.js';
import { round } from '../math.js';

export const RECORDING_VERSION = 1;
export const SOURCES = ['webxr', 'mediapipe', 'synthetic'];
export const HANDS = ['left', 'right'];
export const PACKED_FIELDS = ['px', 'py', 'pz', 'qx', 'qy', 'qz', 'qw', 'r'];
const STRIDE = PACKED_FIELDS.length;

export function createRecording({ source = 'synthetic', fps = 72, frames = [], meta } = {}) {
  const rec = { version: RECORDING_VERSION, source, fps };
  if (meta) rec.meta = meta;
  rec.frames = frames;
  return rec;
}

// ---- validation --------------------------------------------------------

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

function validateHand(hand, where, errors) {
  if (!isObj(hand)) {
    errors.push(`${where}: hand must be an object of joints`);
    return;
  }
  for (const key of Object.keys(hand)) {
    if (!(key in JOINT_INDEX_SET)) errors.push(`${where}: unknown joint "${key}"`);
  }
  for (const name of JOINT_NAMES) {
    const j = hand[name];
    const w = `${where}.${name}`;
    if (!isObj(j)) {
      errors.push(`${w}: missing joint`);
      continue;
    }
    if (!Array.isArray(j.p) || j.p.length !== 3 || !j.p.every(isNum)) {
      errors.push(`${w}.p: must be [x,y,z] finite numbers`);
    } else if (j.p.some((v) => Math.abs(v) > 100)) {
      errors.push(`${w}.p: position out of range (>100 m)`);
    }
    if (!Array.isArray(j.q) || j.q.length !== 4 || !j.q.every(isNum)) {
      errors.push(`${w}.q: must be [x,y,z,w] finite numbers`);
    } else {
      const n = Math.hypot(...j.q);
      if (Math.abs(n - 1) > 0.01) errors.push(`${w}.q: not a unit quaternion (|q|=${n.toFixed(4)})`);
    }
    if (!isNum(j.r) || j.r < 0 || j.r > 0.1) errors.push(`${w}.r: radius must be 0..0.1 m`);
  }
}
const JOINT_INDEX_SET = Object.fromEntries(JOINT_NAMES.map((n) => [n, true]));

function validateHeader(rec, errors) {
  if (!isObj(rec)) {
    errors.push('recording must be a JSON object');
    return false;
  }
  if (rec.version !== RECORDING_VERSION) errors.push(`version: expected ${RECORDING_VERSION}, got ${JSON.stringify(rec.version)}`);
  if (!SOURCES.includes(rec.source)) errors.push(`source: must be one of ${SOURCES.join('|')}, got ${JSON.stringify(rec.source)}`);
  if (!isNum(rec.fps) || rec.fps <= 0 || rec.fps > 1000) errors.push('fps: must be a number in (0, 1000]');
  if (rec.meta !== undefined && !isObj(rec.meta)) errors.push('meta: must be an object when present');
  if (!Array.isArray(rec.frames) || rec.frames.length === 0) {
    errors.push('frames: must be a non-empty array');
    return false;
  }
  return true;
}

function validateTimes(frames, errors) {
  let prev = -Infinity;
  frames.forEach((f, i) => {
    if (!isObj(f)) {
      errors.push(`frames[${i}]: must be an object`);
      return;
    }
    if (!isNum(f.t) || f.t < 0) errors.push(`frames[${i}].t: must be a finite number >= 0`);
    else if (f.t <= prev) errors.push(`frames[${i}].t: must be strictly increasing (${f.t} <= ${prev})`);
    else prev = f.t;
    for (const k of Object.keys(f)) {
      if (k !== 't' && !HANDS.includes(k)) errors.push(`frames[${i}]: unknown key "${k}"`);
    }
  });
}

/**
 * Validate a canonical or packed recording.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateRecording(rec, { maxErrors = 50 } = {}) {
  const errors = [];
  if (!validateHeader(rec, errors)) return { ok: false, errors };
  validateTimes(rec.frames, errors);
  if (errors.length) return { ok: false, errors: errors.slice(0, maxErrors) };

  let canonical = rec;
  if (rec.encoding !== undefined) {
    validatePacked(rec, errors);
    if (errors.length) return { ok: false, errors: errors.slice(0, maxErrors) };
    canonical = decodeRecording(rec);
  }
  for (let i = 0; i < canonical.frames.length && errors.length < maxErrors; i++) {
    const f = canonical.frames[i];
    for (const h of HANDS) if (f[h] !== undefined) validateHand(f[h], `frames[${i}].${h}`, errors);
  }
  return { ok: errors.length === 0, errors: errors.slice(0, maxErrors) };
}

function validatePacked(rec, errors) {
  const e = rec.encoding;
  if (!isObj(e) || e.type !== 'packed') {
    errors.push('encoding: only {type:"packed"} is supported');
    return;
  }
  if (!Number.isInteger(e.decimals) || e.decimals < 1 || e.decimals > 8) errors.push('encoding.decimals: integer 1..8');
  if (typeof e.delta !== 'boolean') errors.push('encoding.delta: boolean');
  if (!Array.isArray(e.joints) || e.joints.length !== JOINT_COUNT || e.joints.some((n) => !(n in JOINT_INDEX_SET))) {
    errors.push('encoding.joints: must list the 25 WebXR joint names');
  }
  if (!Array.isArray(e.fields) || e.fields.join() !== PACKED_FIELDS.join()) errors.push(`encoding.fields: must be ${PACKED_FIELDS.join(',')}`);
  rec.frames.forEach((f, i) => {
    for (const h of HANDS) {
      const a = f[h];
      if (a === undefined) continue;
      if (!Array.isArray(a) || a.length !== JOINT_COUNT * STRIDE || !a.every(Number.isInteger)) {
        errors.push(`frames[${i}].${h}: packed hand must be ${JOINT_COUNT * STRIDE} integers`);
      }
    }
  });
}

export function assertValidRecording(rec) {
  const { ok, errors } = validateRecording(rec);
  if (!ok) throw new Error(`Invalid HandRecording:\n  - ${errors.join('\n  - ')}`);
  return rec;
}

// ---- rounding / packing --------------------------------------------------

export function roundHand(hand, decimals = 4) {
  const out = {};
  for (const name of JOINT_NAMES) {
    const j = hand[name];
    out[name] = {
      p: j.p.map((v) => round(v, decimals)),
      q: j.q.map((v) => round(v, decimals)),
      r: round(j.r, decimals),
    };
  }
  return out;
}

/** Round every joint value to `decimals` places (canonical form stays canonical). */
export function roundRecording(rec, decimals = 4) {
  const r = decodeRecording(rec);
  return {
    ...r,
    frames: r.frames.map((f) => {
      const o = { t: round(f.t, 6) };
      for (const h of HANDS) if (f[h]) o[h] = roundHand(f[h], decimals);
      return o;
    }),
  };
}

/** Canonical -> packed (optionally delta-encoded). Lossy only through rounding. */
export function encodeRecording(rec, { decimals = 4, delta = true } = {}) {
  const canonical = decodeRecording(rec);
  const k = 10 ** decimals;
  const prev = { left: null, right: null };
  const frames = canonical.frames.map((f) => {
    const o = { t: round(f.t, 6) };
    for (const h of HANDS) {
      if (!f[h]) continue;
      const abs = new Array(JOINT_COUNT * STRIDE);
      JOINT_NAMES.forEach((name, i) => {
        const j = f[h][name];
        const b = i * STRIDE;
        abs[b] = Math.round(j.p[0] * k);
        abs[b + 1] = Math.round(j.p[1] * k);
        abs[b + 2] = Math.round(j.p[2] * k);
        abs[b + 3] = Math.round(j.q[0] * k);
        abs[b + 4] = Math.round(j.q[1] * k);
        abs[b + 5] = Math.round(j.q[2] * k);
        abs[b + 6] = Math.round(j.q[3] * k);
        abs[b + 7] = Math.round(j.r * k);
      });
      o[h] = delta && prev[h] ? abs.map((v, i) => v - prev[h][i] || 0) : abs.map((v) => v || 0);
      prev[h] = abs;
    }
    return o;
  });
  const { encoding: _drop, ...header } = canonical;
  return {
    ...header,
    encoding: { type: 'packed', decimals, delta, joints: [...JOINT_NAMES], fields: [...PACKED_FIELDS] },
    frames,
  };
}

/** Packed -> canonical. Canonical input is returned unchanged. */
export function decodeRecording(rec) {
  if (!rec.encoding) return rec;
  const { decimals, delta, joints } = rec.encoding;
  const k = 10 ** decimals;
  const prev = { left: null, right: null };
  const frames = rec.frames.map((f) => {
    const o = { t: f.t };
    for (const h of HANDS) {
      if (!f[h]) continue;
      const abs = delta && prev[h] ? f[h].map((v, i) => v + prev[h][i]) : f[h].slice();
      prev[h] = abs;
      const hand = {};
      joints.forEach((name, i) => {
        const b = i * STRIDE;
        hand[name] = {
          p: [abs[b] / k, abs[b + 1] / k, abs[b + 2] / k],
          q: [abs[b + 3] / k, abs[b + 4] / k, abs[b + 5] / k, abs[b + 6] / k],
          r: abs[b + 7] / k,
        };
      });
      o[h] = hand;
    }
    return o;
  });
  const { encoding: _drop, ...header } = rec;
  return { ...header, frames };
}

/** Parse JSON text or an object (packed or canonical), validate, and return canonical form. */
export function parseRecording(input) {
  const rec = typeof input === 'string' ? JSON.parse(input) : input;
  assertValidRecording(rec);
  return decodeRecording(rec);
}
