// Live hand recorder: captures whatever the active joint source produces (Quest hands via
// WebXR, the webcam via MediaPipe, or even a replay) into a HandRecording v1 file, so real
// sessions can become regression tests.
//
//   Desktop / webcam: press R to start, R again to stop.
//   VR: the wrist-menu "Record hands" button calls window.__hearthstoneRecorder.toggle().
//
// On stop the file is POSTed to the dev server (harness/vite-plugin-recordings.js writes it to
// recordings/captured/<name>.json); if that isn't available (built site, Quest browser on a
// static host) it is downloaded instead.

import * as THREE from 'three';
import { JOINT_NAMES, defaultRadius } from '../../harness/format/joints.js';
import { orientFromPositions } from '../../harness/format/orient.js';
import { createRecording, roundRecording, encodeRecording, validateRecording } from '../../harness/format/recording.js';

export const SAVE_ENDPOINT = '/__harness/recordings';
export const MAX_SECONDS = 180;

function sourceKind(src) {
  const name = src?.constructor?.name ?? '';
  if (/XR/i.test(name)) return 'webxr';
  if (/Webcam|MediaPipe/i.test(name)) return 'mediapipe';
  if (src?.recording?.source) return src.recording.source;
  return 'webxr';
}

const isIdentity = (q) => !q || (Math.abs(q[0]) < 1e-6 && Math.abs(q[1]) < 1e-6 && Math.abs(q[2]) < 1e-6);

/** Copy one live hand into HandRecording form (fills missing rotations / radii). */
export function normalizeHand(joints, handedness) {
  if (!joints || !JOINT_NAMES.every((n) => joints[n]?.p)) return null;
  const needsRot = JOINT_NAMES.every((n) => isIdentity(joints[n].q));
  const rot = needsRot ? orientFromPositions(Object.fromEntries(JOINT_NAMES.map((n) => [n, joints[n].p])), handedness) : null;
  const out = {};
  for (const n of JOINT_NAMES) {
    const j = joints[n];
    out[n] = { p: [...j.p], q: rot ? rot[n] : [...j.q], r: j.r > 0 && j.r <= 0.1 ? j.r : defaultRadius(n) };
  }
  return out;
}

export class HandRecorder {
  constructor({ input, scene = null, onStatus = null } = {}) {
    this.input = input;
    this.scene = scene;
    this.onStatus = onStatus;
    this.recording = false;
    this.frames = [];
    this.time = 0;
    this.source = 'webxr';
    this.lastSaved = null;
    this.wrapInput();
    if (scene) this.makeIndicator();
  }

  /** Hook InputManager.update so every frame's hands are seen exactly as the app sees them. */
  wrapInput() {
    const input = this.input;
    const orig = input.update.bind(input);
    input.update = (dt) => {
      const hands = orig(dt);
      if (this.recording) this.capture(hands, dt);
      this.updateIndicator(hands);
      return hands;
    };
  }

  capture(hands, dt) {
    this.time += dt;
    const frame = { t: +this.time.toFixed(6) };
    for (const h of hands) {
      if (!h.joints || (h.handedness !== 'left' && h.handedness !== 'right')) continue;
      const hand = normalizeHand(h.joints, h.handedness);
      if (hand) frame[h.handedness] = hand;
    }
    const prev = this.frames[this.frames.length - 1];
    if (!prev || frame.t > prev.t) this.frames.push(frame);
    if (this.time > MAX_SECONDS) this.stop();
  }

  start() {
    if (this.recording) return;
    this.frames = [];
    this.time = 0;
    this.source = sourceKind(this.input.jointSource);
    this.recording = true;
    this.status(`● REC (${this.source})`);
  }

  async stop({ save = true, name } = {}) {
    if (!this.recording) return null;
    this.recording = false;
    const withHands = this.frames.filter((f) => f.left || f.right);
    if (!withHands.length) {
      this.status('Recording stopped — no hand data captured');
      return null;
    }
    const duration = this.frames[this.frames.length - 1].t;
    const fps = Math.round(this.frames.length / Math.max(duration, 1e-3));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = name ?? `${this.source}-${stamp}`;
    const rec = roundRecording(
      createRecording({
        source: this.source,
        fps: Math.min(1000, Math.max(1, fps)),
        frames: this.frames,
        meta: { name: fileName, capturedAt: new Date().toISOString(), userAgent: navigator.userAgent, duration },
      }),
      4,
    );
    const check = validateRecording(rec);
    if (!check.ok) console.warn('HandRecorder: captured data failed validation', check.errors);
    const packed = encodeRecording(rec, { decimals: 4, delta: true });
    this.lastSaved = { name: fileName, recording: rec };
    if (save) await this.save(fileName, packed);
    return rec;
  }

  toggle() {
    return this.recording ? this.stop() : this.start();
  }

  async save(name, rec) {
    const body = JSON.stringify(rec);
    try {
      const res = await fetch(SAVE_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, recording: rec }) });
      if (res.ok) {
        const { path } = await res.json();
        this.status(`Saved ${path} (${rec.frames.length} frames)`);
        return path;
      }
    } catch {
      /* no dev server: fall through to download */
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    a.download = `${name}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
    this.status(`Downloaded ${name}.json (${rec.frames.length} frames)`);
    return null;
  }

  status(text) {
    this.onStatus?.(text, this.recording);
    if (typeof document === 'undefined') return;
    let el = document.getElementById('hand-recorder-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hand-recorder-status';
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:60;padding:5px 12px;border-radius:8px;background:rgba(20,16,12,.85);color:#f3e6cc;font:12px system-ui,sans-serif;pointer-events:none';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.color = this.recording ? '#ff6b6b' : '#f3e6cc';
    el.hidden = false;
    clearTimeout(this._hide);
    if (!this.recording) this._hide = setTimeout(() => (el.hidden = true), 4000);
  }

  // A small red light above the left wrist while recording, visible in the headset.
  makeIndicator() {
    this.light = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: '#ff2a2a' }));
    this.light.visible = false;
    this.scene.add(this.light);
  }

  updateIndicator(hands) {
    if (!this.light) return;
    const h = hands.find((x) => x.joints?.wrist) ?? null;
    this.light.visible = this.recording && !!h && Math.floor(this.time * 2) % 2 === 0;
    if (h) this.light.position.set(h.joints.wrist.p[0], h.joints.wrist.p[1] + 0.05, h.joints.wrist.p[2]);
  }
}

/** One-call setup for main.js: creates the recorder, binds R, exposes window.__hearthstoneRecorder. */
export function installHandRecorder({ input, scene, key = 'r' } = {}) {
  const rec = new HandRecorder({ input, scene });
  addEventListener('keydown', (e) => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key.toLowerCase() === key && !e.repeat && !e.ctrlKey && !e.metaKey) rec.toggle();
  });
  window.__hearthstoneRecorder = rec;
  return rec;
}
