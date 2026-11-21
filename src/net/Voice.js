import * as THREE from 'three';
import CFG from '../data/tableDefaults.json';

const V = CFG.voice;
const PREF_KEY = 'hearthstone-voice';

/**
 * Who starts a connection between two people: the one whose id sorts first offers; the other is "polite" and gives way
 * when both sides offer at once (WebRTC perfect negotiation). Pure.
 */
export const isPolite = (myId, otherId) => String(myId) > String(otherId);

/** RMS level 0..1 of an analyser's time-domain bytes. Pure. */
export function levelOf(bytes) {
  let s = 0; for (let i = 0; i < bytes.length; i++) { const v = (bytes[i] - 128) / 128; s += v * v; }
  return Math.sqrt(s / Math.max(1, bytes.length));
}

/**
 * Voice chat (design/completion-plan.md §6.2). Everyone at the table is connected to everyone else directly (WebRTC mesh,
 * signalled as `rtc` messages over the table socket; works on the same network, no relay server). Each voice plays from
 * that person's head, so it comes from their seat. The DM can switch to a "narrator" voice that is heard evenly by all.
 * Controls: mute, push-to-talk (hold V), per-person volume, and the DM can mute a player.
 */
export class Voice {
  /** @param {{ sync: object, camera: THREE.Camera, avatars?: object, dm?: object, rtc?: typeof RTCPeerConnection, media?: MediaDevices }} deps */
  constructor({ sync, camera, avatars = null, dm = null, rtc = globalThis.RTCPeerConnection, media = globalThis.navigator?.mediaDevices }) {
    Object.assign(this, { sync, camera, avatars, dm, RTC: rtc, media });
    this.peers = new Map(); this.enabled = false; this.muted = false; this.ptt = false; this.pttDown = false; this.narrator = false;
    this.stream = null; this.listener = null; this.level = 0; this.levelT = 0; this.onChange = null; this.forcedMute = false;
    try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); this.ptt = !!p.ptt; this.volumes = p.volumes || {}; } catch { this.volumes = {}; }
    sync.on('rtc', (m) => this.onSignal(m).catch((e) => console.warn('[voice] signal', e)));
    sync.on('tell', (m) => { if (m.kind === 'mute') { this.forcedMute = !!m.on; this.apply(); sync.toast?.(m.on ? 'The DM muted your microphone.' : 'The DM unmuted your microphone.', 'warn'); } });
    const prev = sync.onPlayers;
    sync.onPlayers = (players) => { prev?.(players); this.reconcile(players); };
  }

  get supported() { return !!this.RTC && !!this.media?.getUserMedia; }
  get me() { return this.sync.me?.id ?? null; }
  /** Is my microphone actually sending right now? */
  get live() { return this.enabled && !this.muted && !this.forcedMute && (!this.ptt || this.pttDown); }
  savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify({ ptt: this.ptt, volumes: this.volumes })); } catch { /* storage unavailable */ } }
  changed() { try { this.onChange?.(this); } catch (e) { console.warn('[voice]', e); } }

  ensureListener() {
    if (this.listener) return this.listener;
    this.listener = new THREE.AudioListener(); this.camera.add(this.listener);
    return this.listener;
  }

  /** Turns the microphone on (asks permission the first time) and connects to everyone present. */
  async enable() {
    if (this.enabled) return true;
    if (!this.supported) { this.sync.toast?.('Voice chat is not available in this browser.', 'warn'); return false; }
    try {
      this.stream = await this.media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { this.sync.toast?.(`Microphone unavailable: ${e.message}. You can still listen.`, 'warn'); this.stream = null; }
    const L = this.ensureListener(); if (L.context.state === 'suspended') await L.context.resume().catch(() => {});
    if (this.stream) {
      const src = L.context.createMediaStreamSource(this.stream); this.localAnalyser = L.context.createAnalyser(); this.localAnalyser.fftSize = 256; src.connect(this.localAnalyser);
      for (const p of this.peers.values()) this.addTracks(p);
    }
    this.enabled = !!this.stream; this.apply(); this.changed();
    return this.enabled;
  }

  /** The HUD mic button: off → on → muted → on … */
  async toggle() { if (!this.enabled) return this.enable(); this.setMuted(!this.muted); return true; }
  setMuted(on) { this.muted = !!on; this.apply(); this.changed(); }
  setPushToTalk(on) { this.ptt = !!on; this.pttDown = false; this.savePrefs(); this.apply(); this.changed(); }
  pushToTalk(down) { if (this.pttDown === !!down) return; this.pttDown = !!down; this.apply(); }
  /** DM: one even "narrator" voice for everyone instead of a voice from the DM's seat. */
  setNarrator(on) { this.narrator = !!on; for (const id of this.peers.keys()) this.sync.send({ t: 'rtc', to: id, kind: 'state', narrator: this.narrator }); this.changed(); }
  setVolume(id, v) { this.volumes[id] = Math.max(0, Math.min(2, v)); const p = this.peers.get(id); if (p?.gain) p.gain.gain.value = this.volumes[id]; this.savePrefs(); }
  /** DM: mute or unmute a player's microphone. */
  muteOther(id, on) { if (this.sync.role === 'dm') this.sync.send({ t: 'tell', to: id, kind: 'mute', on: !!on }); }

  apply() { for (const t of this.stream?.getAudioTracks() || []) t.enabled = this.live; }

  // ---------- peers ----------
  reconcile(players) {
    if (!this.RTC || !this.me) return;
    const ids = new Set(players.filter((p) => p.id !== this.me).map((p) => p.id));
    for (const [id, p] of this.peers) if (!ids.has(id)) this.drop(id, p);
    for (const id of ids) if (!this.peers.has(id)) this.connect(id);
  }

  /**
   * One connection per other person. Exactly one side ever makes offers (the one whose id sorts first), so two offers can
   * never cross. The connection always carries one two-way audio line; a microphone turned on later is attached to it
   * with replaceTrack, which needs no renegotiation.
   */
  connect(id) {
    const pc = new this.RTC({ iceServers: V.iceServers });
    const p = { id, pc, offerer: !isPolite(this.me, id), narrator: false, tx: null, pending: [] };
    this.peers.set(id, p);
    pc.onicecandidate = ({ candidate }) => { if (candidate) this.sync.send({ t: 'rtc', to: id, kind: 'ice', candidate }); };
    pc.ontrack = (e) => this.onTrack(p, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' && p.offerer) this.offer(p, true); this.changed(); };
    if (p.offerer) { p.tx = pc.addTransceiver('audio', { direction: 'sendrecv' }); this.attach(p); this.offer(p); }
    if (this.narrator) this.sync.send({ t: 'rtc', to: id, kind: 'state', narrator: true });
    return p;
  }

  /** Offerer only: (re)starts the handshake. */
  async offer(p, iceRestart = false) {
    try { await p.pc.setLocalDescription(await p.pc.createOffer({ iceRestart })); this.sync.send({ t: 'rtc', to: p.id, kind: 'sdp', description: p.pc.localDescription }); }
    catch (e) { console.warn('[voice] offer', e); }
  }

  /** Puts my microphone on a connection's audio line (or takes it off when there is none). */
  attach(p) {
    const track = this.stream?.getAudioTracks()[0] || null;
    if (p.tx && p.tx.sender.track !== track) p.tx.sender.replaceTrack(track).catch((e) => console.warn('[voice] attach', e));
  }
  addTracks(p) { this.attach(p); }

  drop(id, p) { try { p.pc.close(); } catch { /* closed */ } p.audio?.disconnect?.(); p.el?.remove?.(); p.anchor?.removeFromParent?.(); this.peers.delete(id); }

  /** Handles an offer / answer / ICE candidate / state note from another player. */
  async onSignal(m) {
    if (!this.RTC || !m.from || m.from === this.me) return;
    const p = this.peers.get(m.from) || this.connect(m.from), pc = p.pc;
    if (m.kind === 'state') { p.narrator = !!m.narrator; this.route(p); return; }
    if (m.kind === 'sdp' && m.description) {
      if (m.description.type === 'offer') {
        if (p.offerer) return; // only the other side offers; a stray offer is ignored
        await pc.setRemoteDescription(m.description);
        p.tx = pc.getTransceivers()[0] || null;
        if (p.tx) { p.tx.direction = 'sendrecv'; this.attach(p); }
        await pc.setLocalDescription(await pc.createAnswer());
        this.sync.send({ t: 'rtc', to: m.from, kind: 'sdp', description: pc.localDescription });
      } else if (pc.signalingState === 'have-local-offer') await pc.setRemoteDescription(m.description);
      for (const c of p.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
    } else if (m.kind === 'ice' && m.candidate) {
      // Candidates can arrive before the description they belong to: keep them until it is set.
      if (!pc.remoteDescription) p.pending.push(m.candidate); else await pc.addIceCandidate(m.candidate).catch((e) => console.warn('[voice] ice', e));
    }
  }

  /** A remote voice arrived: play it from that person's head. */
  onTrack(p, stream) {
    const L = this.ensureListener();
    // Chrome only feeds a remote WebRTC stream into Web Audio once an (muted) media element is playing it.
    if (!p.el && typeof document !== 'undefined') { p.el = document.createElement('audio'); p.el.muted = true; p.el.autoplay = true; p.el.srcObject = stream; p.el.style.display = 'none'; document.body.appendChild(p.el); p.el.play?.().catch(() => {}); }
    const ctx = L.context, src = ctx.createMediaStreamSource(stream);
    p.gain = ctx.createGain(); p.gain.gain.value = this.volumes[p.id] ?? 1;
    p.analyser = ctx.createAnalyser(); p.analyser.fftSize = 256;
    src.connect(p.gain); p.gain.connect(p.analyser);
    // Two routes: positional (from the seat) and flat (the DM's narrator voice).
    p.audio = new THREE.PositionalAudio(L); p.audio.setRefDistance(V.refDistance); p.audio.setRolloffFactor(V.rolloff); p.audio.setDistanceModel('inverse');
    p.spatial = ctx.createGain(); p.flat = ctx.createGain(); p.flat.gain.value = 0;
    p.gain.connect(p.spatial); p.spatial.connect(p.audio.panner); // PositionalAudio wires panner → gain → listener itself
    p.gain.connect(p.flat); p.flat.connect(L.getInput());
    p.anchor = new THREE.Object3D(); p.anchor.add(p.audio);
    this.route(p); this.changed();
  }

  route(p) { if (!p.spatial) return; p.spatial.gain.value = p.narrator ? 0 : 1; p.flat.gain.value = p.narrator ? V.narratorGain : 0; }

  /** Per frame: voices follow heads; speaking levels drive the rings (about ten times a second). */
  update(dt) {
    for (const p of this.peers.values()) {
      if (!p.anchor) continue;
      const head = this.avatars?.headOf(p.id);
      if (head && p.anchor.parent !== head) head.add(p.anchor);
    }
    this.levelT += dt; if (this.levelT < 0.1) return; this.levelT = 0;
    const buf = (this.buf ||= new Uint8Array(128));
    if (this.localAnalyser) { this.localAnalyser.getByteTimeDomainData(buf); this.level = this.live ? levelOf(buf) : 0; }
    for (const p of this.peers.values()) {
      if (!p.analyser) continue;
      p.analyser.getByteTimeDomainData(buf); p.level = levelOf(buf);
      this.avatars?.setSpeaking(p.id, p.level > V.speakingThreshold ? Math.min(1, p.level * 6) : 0);
    }
  }

  /** Rows for the voice panel: [{ id, name, connected, level, volume }]. */
  roster() {
    return (this.sync.players || []).filter((pl) => pl.id !== this.me).map((pl) => { const p = this.peers.get(pl.id);
      return { id: pl.id, name: pl.name, role: pl.role, connected: p?.pc.connectionState === 'connected', level: p?.level || 0, volume: this.volumes[pl.id] ?? 1 }; });
  }
}
