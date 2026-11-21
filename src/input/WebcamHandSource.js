import { TABLE_TOP, trayPoint } from '../physics/Physics.js';

// MediaPipe HandLandmarker (webcam) -> { left, right } WebXR-style joint maps.
// The camera image is mapped onto the table top: image x -> table x (mirrored),
// image y -> table depth, landmark depth -> height above the table. Each hand is
// rescaled so wrist->middle-knuckle is 9 cm, so pinch thresholds match real hands.
const VERSION = '1.2.2'; // must match the installed @mediapipe/tasks-vision
// Served locally (public/assets/mediapipe) so webcam hands work offline; the CDN is only a fallback.
const LOCAL = `${import.meta.env?.BASE_URL || '/'}assets/mediapipe`;
const WASM = [`${LOCAL}/wasm`, `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`];
const MODEL = [`${LOCAL}/hand_landmarker.task`, 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'];

// MediaPipe 21-landmark index for each WebXR joint (metacarpals interpolated).
const MAP = {
  wrist: 0, 'thumb-metacarpal': 1, 'thumb-phalanx-proximal': 2, 'thumb-phalanx-distal': 3, 'thumb-tip': 4,
  'index-finger-metacarpal': [0, 5], 'index-finger-phalanx-proximal': 5, 'index-finger-phalanx-intermediate': 6, 'index-finger-phalanx-distal': 7, 'index-finger-tip': 8,
  'middle-finger-metacarpal': [0, 9], 'middle-finger-phalanx-proximal': 9, 'middle-finger-phalanx-intermediate': 10, 'middle-finger-phalanx-distal': 11, 'middle-finger-tip': 12,
  'ring-finger-metacarpal': [0, 13], 'ring-finger-phalanx-proximal': 13, 'ring-finger-phalanx-intermediate': 14, 'ring-finger-phalanx-distal': 15, 'ring-finger-tip': 16,
  'pinky-finger-metacarpal': [0, 17], 'pinky-finger-phalanx-proximal': 17, 'pinky-finger-phalanx-intermediate': 18, 'pinky-finger-phalanx-distal': 19, 'pinky-finger-tip': 20,
};

export class WebcamHandSource {
  constructor({ onStatus } = {}) { this.onStatus = onStatus || (() => {}); this.last = {}; this.lastTime = -1; }

  async load() {
    this.onStatus('Starting webcam…');
    this.video = document.createElement('video');
    this.video.className = 'webcam-preview'; this.video.playsInline = true; this.video.muted = true;
    document.body.appendChild(this.video);
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    this.video.srcObject = stream; await this.video.play();
    this.onStatus('Loading hand model…');
    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
    let err;
    for (let i = 0; i < WASM.length && !this.lm; i++) {
      try {
        const fs = await FilesetResolver.forVisionTasks(WASM[i]);
        this.lm = await HandLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: MODEL[i], delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 2 });
      } catch (e) { err = e; }
    }
    if (!this.lm) throw err;
    this.onStatus('Webcam hands ready – pinch to grab!');
  }

  update() {
    if (!this.lm || this.video.readyState < 2) return this.last;
    if (this.video.currentTime === this.lastTime) return this.last;
    this.lastTime = this.video.currentTime;
    const res = this.lm.detectForVideo(this.video, performance.now());
    const out = {};
    (res.landmarks || []).forEach((lms, i) => {
      // Raw (unmirrored) image: MediaPipe's label is flipped relative to the user.
      const label = res.handedness?.[i]?.[0]?.categoryName === 'Left' ? 'right' : 'left';
      out[label] = this.toJoints(lms);
    });
    this.last = out;
    return out;
  }

  toJoints(l) {
    const ax = 640 / 480; // keep proportions: x is wider than y
    const w = l[0], m = l[9];
    const span = Math.hypot((m.x - w.x) * ax, m.y - w.y) || 0.1;
    const s = 0.09 / span;
    const baseX = (0.5 - w.x) * 1.1, baseZ = (w.y - 0.5) * 0.75;
    // Hand position is mirrored (move right -> virtual hand moves right), but the hand SHAPE is
    // turned 180° about its finger axis instead of mirrored: the palm you show the camera
    // faces down onto the table, and a right hand stays a right hand (thumb on the correct side).
    const P = (k) => {
      const [x, z] = trayPoint(baseX + (l[k].x - w.x) * ax * s, baseZ + (l[k].y - w.y) * s);
      return [x, TABLE_TOP + 0.08 + (l[k].z - w.z) * ax * s, z];
    };
    const j = {};
    for (const [name, k] of Object.entries(MAP)) {
      const p = Array.isArray(k) ? P(k[0]).map((v, i) => v * 0.4 + P(k[1])[i] * 0.6) : P(k);
      j[name] = { p, q: [0, 0, 0, 1], r: 0.008 };
    }
    return j;
  }

  dispose() { this.video?.srcObject?.getTracks().forEach((t) => t.stop()); this.video?.remove(); this.lm?.close(); }
}
