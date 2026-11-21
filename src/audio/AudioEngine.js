// 100% procedural WebAudio: SFX, per-scene ambience and music mood loops. No audio files.
export class AudioEngine {
  constructor() { this.ctx = null; this.ambNodes = []; this.ambTimers = []; this.musicMood = 'none'; this.musicTimer = null; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.8; this.master.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.amb = c.createGain(); this.amb.gain.value = 0.5; this.amb.connect(this.master);
    this.mus = c.createGain(); this.mus.gain.value = 0.35; this.mus.connect(this.master);
    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  get ok() { return !!this.ctx; }
  get now() { return this.ctx.currentTime; }

  tone(freq, dur, { type = 'sine', gain = 0.3, when = 0, dest, attack = 0.005, freqEnd, vibrato = 0, filter } = {}) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    if (vibrato) {
      const l = c.createOscillator(); l.frequency.value = 6; const lg = c.createGain(); lg.gain.value = vibrato;
      l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + 0.1);
    }
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; o.connect(f); node = f; }
    node.connect(g); g.connect(dest || this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noise(dur, { type = 'bandpass', freq = 1000, q = 1, gain = 0.3, when = 0, dest, attack = 0.005, freqEnd } = {}) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime + when;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.sfx);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  // ---------- SFX ----------
  clack(v = 1) {
    const g = Math.min(0.25, 0.04 + v * 0.06);
    this.noise(0.04, { type: 'highpass', freq: 2500, gain: g });
    this.tone(1400 + Math.random() * 900, 0.05, { type: 'triangle', gain: g * 0.6 });
  }
  rumble() { this.noise(1.1, { type: 'lowpass', freq: 160, gain: 0.7, attack: 0.15 }); this.tone(42, 1.0, { gain: 0.5, attack: 0.1 }); }
  fanfare() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i === 3 ? 1.2 : 0.25, { type: 'triangle', gain: 0.25, when: i * 0.13 }));
    [523, 659, 784].forEach((f) => this.tone(f, 1.2, { type: 'square', gain: 0.05, when: 0.52, filter: 2500 }));
  }
  sadTrombone() {
    [[392, 0.35], [370, 0.35], [349, 0.35], [330, 1.1]].forEach(([f, d], i) =>
      this.tone(f / 2, d, { type: 'sawtooth', gain: 0.22, when: i * 0.38, filter: 900, vibrato: i === 3 ? 6 : 0, attack: 0.03 }));
  }
  thunder() {
    this.noise(0.3, { type: 'highpass', freq: 1200, gain: 0.4 });
    this.noise(3.5, { type: 'lowpass', freq: 400, freqEnd: 60, gain: 0.9, when: 0.05, attack: 0.05 });
  }
  creak() { this.tone(110, 1.3, { type: 'sawtooth', gain: 0.15, freqEnd: 190, vibrato: 25, filter: 900, attack: 0.1 }); }
  roar() {
    this.noise(2.2, { type: 'bandpass', freq: 320, q: 0.8, gain: 0.8, attack: 0.2, freqEnd: 140 });
    this.tone(70, 2.0, { type: 'sawtooth', gain: 0.3, vibrato: 12, filter: 500, attack: 0.2, freqEnd: 50 });
  }
  swordClash() {
    [2400, 3730, 5110, 6820].forEach((f) => this.tone(f, 0.9, { gain: 0.08 }));
    this.noise(0.12, { type: 'highpass', freq: 3000, gain: 0.4 });
  }
  cheer() {
    this.noise(2.8, { type: 'bandpass', freq: 1400, q: 0.7, gain: 0.35, attack: 0.5 });
    for (let i = 0; i < 6; i++) this.tone(500 + Math.random() * 500, 0.5, { type: 'triangle', gain: 0.05, when: Math.random() * 1.5, freqEnd: 900 + Math.random() * 400 });
  }
  drone() { [55, 55.6, 82.4, 110.7].forEach((f) => this.tone(f, 6, { type: 'sawtooth', gain: 0.09, filter: 380, attack: 1.2 })); }
  chime() { [1318, 1568, 1976, 2637].forEach((f, i) => this.tone(f, 0.8, { gain: 0.08, when: i * 0.07 })); }
  click() { this.tone(900, 0.04, { type: 'square', gain: 0.05, filter: 3000 }); }
  sparkle() { for (let i = 0; i < 8; i++) this.tone(1800 + Math.random() * 2400, 0.4, { gain: 0.04, when: i * 0.06 }); }
  snap() { this.noise(0.15, { type: 'highpass', freq: 1500, gain: 0.5 }); this.tone(180, 0.2, { type: 'square', gain: 0.2, filter: 800 }); }

  // ---------- Ambience ----------
  stopAmbience() {
    if (!this.ok) return;
    const t = this.now;
    this.ambNodes.forEach(({ src, g }) => { g.gain.setTargetAtTime(0.0001, t, 0.3); src.stop(t + 1.5); });
    this.ambTimers.forEach(clearInterval);
    this.ambNodes = []; this.ambTimers = [];
  }
  bed(type, freq, q, gain) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = 0.0001; g.gain.setTargetAtTime(gain, this.now, 0.8);
    s.connect(f); f.connect(g); g.connect(this.amb); s.start();
    this.ambNodes.push({ src: s, g });
  }
  every(ms, fn) { this.ambTimers.push(setInterval(() => { if (this.ctx.state === 'running') fn(); }, ms)); }

  setAmbience(name) {
    if (!this.ok) return;
    this.stopAmbience();
    const r = Math.random;
    if (name === 'tavern') {
      this.bed('bandpass', 500, 0.6, 0.12); // murmuring crowd
      this.every(90, () => { if (r() < 0.5) this.noise(0.03, { type: 'highpass', freq: 2000 + r() * 3000, gain: 0.05 + r() * 0.08, dest: this.amb }); }); // hearth crackle
      this.every(1400, () => { if (r() < 0.3) this.tone(900 + r() * 400, 0.06, { type: 'triangle', gain: 0.04, dest: this.amb }); }); // mugs
    } else if (name === 'dungeon') {
      this.bed('lowpass', 180, 0.5, 0.2);
      this.every(700, () => { if (r() < 0.45) this.tone(1400 + r() * 900, 0.18, { gain: 0.12, freqEnd: 500 + r() * 300, dest: this.amb }); }); // drips
      this.every(5000, () => { if (r() < 0.3) this.tone(60, 3, { type: 'sawtooth', gain: 0.03, filter: 200, attack: 1, dest: this.amb }); });
    } else if (name === 'forest') {
      this.bed('bandpass', 700, 0.4, 0.07); // wind in leaves
      this.every(260, () => { if (r() < 0.6) { const f = 4200 + r() * 600; for (let k = 0; k < 3; k++) this.tone(f, 0.04, { gain: 0.025, when: k * 0.06, dest: this.amb }); } }); // crickets
      this.every(6000, () => { if (r() < 0.4) { this.tone(420, 0.35, { type: 'triangle', gain: 0.05, dest: this.amb, freqEnd: 380 }); this.tone(380, 0.5, { type: 'triangle', gain: 0.05, when: 0.4, dest: this.amb, freqEnd: 340 }); } }); // owl
    } else if (name === 'lair') {
      this.bed('lowpass', 90, 0.7, 0.35);
      this.every(400, () => { if (r() < 0.35) this.tone(80 + r() * 120, 0.25, { gain: 0.12, freqEnd: 200 + r() * 100, dest: this.amb }); }); // lava bubbles
    }
  }

  // ---------- Music ----------
  setMusic(mood) {
    this.musicMood = mood;
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (!this.ok || mood === 'none') return;
    const c = this.ctx; const r = Math.random;
    const bpm = { tavern: 150, explore: 70, combat: 140, eerie: 50 }[mood] || 100;
    const stepDur = 60 / bpm / 2; // eighth notes
    let step = 0; let next = c.currentTime + 0.1;
    const D = [293.7, 329.6, 349.2, 392, 440, 493.9, 523.3, 587.3];
    const chords = [[220, 261.6, 329.6], [174.6, 220, 261.6], [261.6, 329.6, 392], [196, 246.9, 293.7]];
    const tick = () => {
      while (next < c.currentTime + 0.25) {
        const w = next - c.currentTime, s = step;
        if (mood === 'tavern') {
          if (s % 3 !== 2 || r() < 0.4) this.tone(D[Math.floor(r() * D.length)], stepDur * 0.9, { type: 'triangle', gain: 0.12, when: w, dest: this.mus });
          if (s % 6 === 0) this.tone(146.8, stepDur * 2.5, { type: 'triangle', gain: 0.15, when: w, dest: this.mus });
          if (s % 6 === 3) this.tone(110, stepDur * 2.5, { type: 'triangle', gain: 0.12, when: w, dest: this.mus });
        } else if (mood === 'explore') {
          if (s % 16 === 0) chords[(s / 16) % 4].forEach((f) => this.tone(f, stepDur * 16, { gain: 0.06, when: w, attack: 1, dest: this.mus }));
          if (s % 4 === 2 && r() < 0.5) this.tone(D[Math.floor(r() * D.length)] * 2, stepDur * 3, { gain: 0.03, when: w, dest: this.mus });
        } else if (mood === 'combat') {
          if (s % 4 === 0) { this.tone(120, 0.18, { gain: 0.45, freqEnd: 40, when: w, dest: this.mus }); }
          if (s % 4 === 2) this.noise(0.12, { type: 'highpass', freq: 1500, gain: 0.25, when: w, dest: this.mus });
          const bass = [82.4, 82.4, 98, 82.4, 110, 82.4, 98, 73.4][s % 8];
          this.tone(bass, stepDur * 0.9, { type: 'sawtooth', gain: 0.12, filter: 600, when: w, dest: this.mus });
          if (s % 16 === 0) [329.6, 392, 493.9].forEach((f) => this.tone(f, stepDur * 6, { type: 'square', gain: 0.03, filter: 1500, when: w, dest: this.mus }));
        } else if (mood === 'eerie') {
          if (s % 8 === 0) this.tone(55 * (r() < 0.5 ? 1 : 1.06), stepDur * 10, { type: 'sawtooth', gain: 0.06, filter: 300, attack: 1.5, when: w, dest: this.mus });
          if (r() < 0.2) this.tone(800 + r() * 900, stepDur * 4, { gain: 0.025, when: w, vibrato: 8, attack: 0.5, dest: this.mus });
        }
        next += stepDur; step++;
      }
    };
    tick();
    this.musicTimer = setInterval(tick, 80);
  }
}

export const audio = new AudioEngine();
