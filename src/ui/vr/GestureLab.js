// Gesture practice and sample recording in the headset (design/vr-hands-plan.md §5).
//  - Practise: shows live which battle sign each hand makes and counts the moves it recognises.
//  - Record: walks through each sign (8 tries) and 30 s of ordinary movement, then saves the samples to the dev
//    server (recordings/gestures/) or downloads them, for tools/tune-gestures.mjs. It also measures the player's hand
//    so the distance thresholds fit it (saved on this device).
import { GestureTracker, CAST_CFG, handLength, scaledConfig, savedHandLength, HAND_KEY } from '../../input/castGestures.js';
import { GESTURES, GESTURE_LABELS } from '../../party/sheet.js';

export const LAB_CFG = { stepSeconds: 14, idleSeconds: 30, rate: 36, reps: 8 };
const HOW = {
  point: 'Index finger out, others curled. Hold it a moment, then flick it forward.',
  gun: 'Index and thumb out. Hold it, then drop your thumb onto your middle finger.',
  palm: 'Open hand, fingers out. Hold it, then push it fast toward where your palm faces.',
  slash: 'Open flat hand. Hold it, then swipe it sideways fast, edge first, like a sword cut.',
  idle: 'Just move normally: wave, reach, grab, point at things. Nothing should fire.',
};

export { savedHandLength };

/** Rounds a joint map to millimetres (keeps sample files small): { name: [x, y, z] }. */
export function packJoints(j) { const o = {}; for (const [k, v] of Object.entries(j || {})) if (v?.p) o[k] = v.p.map((x) => Math.round(x * 1000) / 1000); return o; }
/** The inverse of packJoints: { name: { p } }. */
export function unpackJoints(o) { const j = {}; for (const [k, p] of Object.entries(o || {})) j[k] = { p }; return j; }

export class GestureLab {
  constructor(ui) {
    this.ui = ui; this.mode = null; this.step = 0; this.segments = []; this.cur = null; this.counts = {}; this.live = { left: null, right: null }; this.msg = '';
    this.makeTrackers(savedHandLength()); this.lens = [];
  }
  makeTrackers(len) { const cfg = scaledConfig(CAST_CFG, len); this.trackers = { left: new GestureTracker('left', cfg), right: new GestureTracker('right', cfg) }; }
  get steps() { return [...GESTURES, 'idle']; }
  dirty() { const w = this.ui.windows?.get('lab'); if (w) w.dirty = true; }

  start(mode) { this.mode = mode; this.step = 0; this.segments = []; this.counts = {}; this.lens = []; this.msg = ''; if (mode === 'record') this.begin(); this.dirty(); }
  begin() { const label = this.steps[this.step]; this.cur = { label, frames: [], fires: [], t: 0, acc: 0, dur: label === 'idle' ? LAB_CFG.idleSeconds : LAB_CFG.stepSeconds }; this.ui.audio?.chime?.(); }
  next() { if (this.cur) { const { acc, ...seg } = this.cur; this.segments.push(seg); } this.cur = null; this.step++; if (this.step < this.steps.length) this.begin(); else { this.mode = 'done'; this.finishHand(); } this.dirty(); }
  stop() { this.mode = null; this.cur = null; this.dirty(); }
  finishHand() {
    if (!this.lens.length) return;
    const s = [...this.lens].sort((a, b) => a - b), med = s[Math.floor(s.length / 2)];
    try { globalThis.localStorage?.setItem(HAND_KEY, String(med)); } catch { /* storage unavailable */ }
    this.makeTrackers(med);
  }

  /** Per frame (VRUI.update): runs the trackers while the panel is open and records when asked. */
  update(hands, dt) {
    if (!this.ui.windows?.get('lab')?.visible || !this.mode || this.mode === 'done') return;
    let changed = false;
    for (const side of ['left', 'right']) {
      const h = hands.find((x) => x.handedness === side && x.joints);
      const r = this.trackers[side].update(h?.joints || null, dt);
      const shown = r.armed || r.shape || null; if (shown !== this.live[side]) { this.live[side] = shown; changed = true; }
      if (r.fire) { this.counts[r.fire.gesture] = (this.counts[r.fire.gesture] || 0) + 1; this.cur?.fires.push({ t: +this.cur.t.toFixed(3), side, gesture: r.fire.gesture }); this.ui.audio?.click?.(); changed = true; }
      if (h && this.mode === 'record') { const L = handLength(h.joints); if (L) this.lens.push(L); }
    }
    const c = this.cur;
    if (c) {
      c.t += dt; c.acc += dt;
      if (c.acc >= 1 / LAB_CFG.rate) { c.acc = 0; const f = { t: +c.t.toFixed(3) }; for (const h of hands) if (h.joints && (h.handedness === 'left' || h.handedness === 'right')) f[h.handedness] = packJoints(h.joints); c.frames.push(f); }
      if (c.t >= c.dur) { this.next(); changed = true; } else if (Math.floor(c.t) !== Math.floor(c.t - dt)) changed = true;
    }
    if (changed) this.dirty();
  }

  /** The recorded file (see server/gesture-samples.js). */
  file() { return { kind: 'gesture-samples', version: 1, recordedAt: new Date().toISOString(), rate: LAB_CFG.rate, handLength: savedHandLength(), cfg: CAST_CFG, segments: this.segments }; }
  async save() {
    const body = JSON.stringify(this.file()); this.msg = 'Saving…'; this.dirty();
    try {
      const r = await fetch(`${import.meta.env?.BASE_URL ?? '/'}api/dev/gesture-samples`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      const j = await r.json().catch(() => ({})); if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      this.msg = `Saved to ${j.file}. Tell Claude to tune the gestures.`;
    } catch (e) { // no dev server (a built copy): download it instead
      try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' })); a.download = 'gesture-samples.json'; a.click(); this.msg = 'Downloaded gesture-samples.json.'; }
      catch { this.msg = `Could not save: ${e.message}`; }
    }
    this.dirty();
  }

  paint(p) {
    const gold = '#f3d58a', dim = '#cbb994';
    const liveTxt = (s) => (this.live[s] ? (GESTURE_LABELS[this.live[s]] || this.live[s]) : '—');
    if (!this.mode) {
      p.text('Practise the four battle signs. Keep your hands at chest height, in front of you.', { size: 28 });
      for (const g of GESTURES) { p.heading(GESTURE_LABELS[g]); p.text(HOW[g], { size: 24, color: dim }); }
      p.buttons([{ label: 'Practise', primary: true, key: 'lab-practise', run: () => this.start('practise') }, { label: 'Record samples (2 min)', key: 'lab-record', run: () => this.start('record') }], { cols: 2, h: 84 });
      return;
    }
    if (this.mode === 'practise') {
      p.text(`Left hand: ${liveTxt('left')}     Right hand: ${liveTxt('right')}`, { size: 32, color: gold });
      p.heading('Recognised moves');
      for (const g of GESTURES) p.row({ icon: `gesture/${g}`, text: `${GESTURE_LABELS[g]}: ${this.counts[g] || 0}`, h: 70, bw: 120, buttons: [] });
      p.buttons([{ label: 'Reset counts', key: 'lab-reset', run: () => { this.counts = {}; } }, { label: 'Done', key: 'lab-stop', run: () => this.stop() }], { cols: 2 });
      return;
    }
    if (this.mode === 'record' && this.cur) {
      const c = this.cur, left = Math.max(0, Math.ceil(c.dur - c.t)), name = c.label === 'idle' ? 'Ordinary movement' : GESTURE_LABELS[c.label];
      const n = c.fires.filter((f) => c.label === 'idle' || f.gesture === c.label).length;
      p.text(`Step ${this.step + 1} of ${this.steps.length}: ${name}`, { size: 34, color: gold });
      p.text(c.label === 'idle' ? HOW.idle : `${HOW[c.label]} Do it ${LAB_CFG.reps} times.`, { size: 28 });
      p.text(`${left} s left · recognised ${n}${c.label === 'idle' ? ' (should stay 0)' : ''}`, { size: 30, color: dim });
      p.buttons([{ label: 'Next step', key: 'lab-next', run: () => this.next() }, { label: 'Cancel', key: 'lab-cancel', run: () => this.stop() }], { cols: 2 });
      return;
    }
    p.text('All signs recorded.', { size: 34, color: gold });
    for (const s of this.segments) { const n = s.fires.filter((f) => s.label === 'idle' || f.gesture === s.label).length; p.text(`${s.label === 'idle' ? 'Ordinary movement' : GESTURE_LABELS[s.label]}: ${n} recognised${s.label === 'idle' ? ' (false fires)' : ` of ${LAB_CFG.reps}`}`, { size: 28 }); }
    const L = savedHandLength(); if (L) p.text(`Your hand: ${Math.round(L * 1000)} mm (thresholds adjusted).`, { size: 26, color: dim });
    if (this.msg) p.text(this.msg, { size: 26, color: dim });
    p.buttons([{ label: 'Save samples', primary: true, key: 'lab-save', run: () => this.save() }, { label: 'Back', key: 'lab-back', run: () => this.stop() }], { cols: 2 });
  }
}
