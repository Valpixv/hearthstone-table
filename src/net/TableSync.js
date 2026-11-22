import * as THREE from 'three';
import QRCode from 'qrcode';
import { migrateState } from '../tokens/TokenManager.js';
import { TABLE_TOP } from '../physics/Physics.js';
import { seatLayout } from '../table/layout.js';
import { Requests, claimPlayerToken, markAway, hpBand } from './Requests.js';

const SNAPSHOT_MS = 250, MOVE_MS = 100, FOG_MS = 500;
const SESSION_KEY = 'hearthstone-session';

/**
 * Strips what players must not see from a DM state snapshot: secret rolls, the DM's role, the difficulty of open calls,
 * and HP per token.hpVisibility ('exact' default: shown; 'approx': hp/maxHp/tempHp replaced by hpBand
 * healthy|bloodied|critical; 'hidden': stripped).
 */
export function publicState(state) {
  const s = JSON.parse(JSON.stringify(state));
  delete s.secretRolls; delete s.role; delete s.rollLog;
  for (const t of s.tokens || []) {
    if (t.hpVisibility === 'approx') t.hpBand = hpBand(t);
    if (t.hpVisibility === 'approx' || t.hpVisibility === 'hidden') { delete t.hp; delete t.maxHp; delete t.tempHp; delete t.deathSaves; }
  }
  for (const c of s.calls || []) { if (!c.showDc) delete c.dc; }
  return s;
}

/** WebSocket with auto-reconnect. on(type, fn) handlers; status(fn) gets 'connecting'|'online'|'offline'. */
class SyncClient {
  constructor(url) { this.url = url; this.handlers = {}; this.delay = 1000; this.onStatus = () => {}; this.stopped = false; }
  on(t, fn) { (this.handlers[t] ||= []).push(fn); }
  connect(hello) {
    this.hello = hello; this.onStatus('connecting');
    const ws = (this.ws = new WebSocket(this.url));
    ws.onopen = () => { this.delay = 1000; ws.send(JSON.stringify({ t: 'hello', ...this.hello })); this.onStatus('online'); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } for (const f of this.handlers[m.t] || []) { try { f(m); } catch (err) { console.warn('[sync] handler', m.t, err); } } };
    ws.onclose = () => { this.onStatus('offline'); if (!this.stopped) setTimeout(() => this.connect(this.hello), (this.delay = Math.min(this.delay * 1.6, 6000))); };
    ws.onerror = () => ws.close();
  }
  stop() { this.stopped = true; try { this.ws?.close(); } catch { /* closed */ } }
  send(m) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); }
}

/**
 * DM → players table sync (design/sync-plan.md, design/completion-plan.md §3). The DM broadcasts snapshots of dm.state and
 * one-shot events; players apply them through the same DMController / CombatManager methods the DM uses, so there is one
 * rendering path. Minis move for everyone; rolls stay local and only their outcome is shared. Also owns the table code,
 * seats and the multiplayer HUD. Other modules (voice, avatars, casting) listen with on(type, fn).
 */
export class TableSync {
  constructor(deps) {
    Object.assign(this, deps); // dm, combat, forge, rolls, grab, table, cinematic, effects, scene, audio, dice
    this.role = null; this.rev = 0; this.applying = false; this.pending = null; this.code = null; this.joinUrl = null;
    this.targets = new Map(); this.lastNarrAt = null; this.seats = new Map(); this.players = []; this.pendingHandlers = [];
    this.onSeat = null;      // (seat) → void: main.js moves the camera, the rig and the dice tray to the seat
    this.onFatal = null;     // (message) → void: back to the home screen (unknown code, moved to another device)
    this.onEventKind = {};   // kind → fn(args): extra one-shot DM events (strike effects)
    this.buildHud();
    // dm.act(type, payload): executes on the DM, becomes a request on a player (design/flexibility-plan.md §5b).
    this.requests = new Requests({ dm: this.dm, send: (m) => this.client?.send(m), isDM: () => this.role !== 'player', me: () => this.me?.id ?? null,
      name: () => this.name, toast: (t, k) => this.toast(t, k), move: (id, x, z) => this.moveToken(id, x, z) }).install();
    this.requests.onChange(() => this.requests.render());
    this.requests.onResolved = (r) => { if (r.type === 'move' && r.status === 'denied' && r.origin) this.targets.set(r.payload.id, { ...r.origin, qy: null, t: performance.now() }); };
    this.dm.on(() => this.requests.render());
  }

  /** Listens for a message type (before or after the socket exists). */
  on(type, fn) { if (this.client) this.client.on(type, fn); else this.pendingHandlers.push([type, fn]); }
  send(m) { this.client?.send(m); }
  /** DM only: a one-shot event every table plays (and this one too). */
  event(kind, ...args) { if (this.role === 'dm') this.client?.send({ t: 'event', kind, args }); this.onEventKind[kind]?.(...args); }

  // ---------- lifecycle ----------
  /**
   * Connects. opts: { code } joins that table, { host: true } opens a new one (DM), neither joins the shared test table;
   * { rejoin } takes over a seat from another device.
   */
  start(role, name, { code = null, host = false, rejoin = null, vr = false, test = false } = {}) {
    this.role = role; this.name = name || (role === 'dm' ? 'Dungeon Master' : 'Adventurer'); this.testMode = !!test;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sync`;
    const c = (this.client = new SyncClient(url));
    for (const [t, f] of this.pendingHandlers.splice(0)) c.on(t, f);
    c.onStatus = (s) => this.setStatus(s);
    c.on('welcome', (m) => this.onWelcome(m));
    c.on('refused', (m) => this.onRefused(m));
    c.on('moved', () => { c.stop(); this.onFatal?.('This seat moved to another device. You can close this window.'); });
    c.on('snapshot', (m) => this.queueApply(m.state));
    c.on('event', (m) => this.onEvent(m));
    c.on('fog', (m) => this.applyFog(m.png));
    c.on('move', (m) => { if (this.moveAllowed(m)) this.targets.set(m.key, { x: m.x, y: m.y, z: m.z, qy: m.qy, t: performance.now() }); });
    c.on('roll', (m) => this.onRemoteRoll(m));
    c.on('req', (m) => this.requests.receive(m, this.players.find((p) => p.id === m.from)));
    c.on('reqResult', (m) => this.requests.onResult(m));
    c.on('presence', (m) => this.onPresence(m));
    c.on('joined', (m) => this.onJoined(m.player));
    c.on('left', (m) => this.onLeft(m.player));
    const hello = { role, name: this.name, vr };
    if (code) hello.code = code; if (host) hello.host = true; if (rejoin) hello.rejoin = rejoin; if (test) hello.test = true;
    c.connect(hello);
    this.hookLocal();
    setInterval(() => this.sendMoves(), MOVE_MS);
  }

  onWelcome(m) {
    this.me = m.you; this.role = m.you.role; this.code = m.code;
    // Reconnects (and a refresh) come back as the same person at the same table.
    this.client.hello = { ...this.client.hello, code: m.code, rejoin: m.you.rejoin, host: false };
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code: m.code, rejoin: m.you.rejoin, role: this.role, name: this.name })); } catch { /* storage unavailable */ }
    this.onSeat?.(m.you.seat);
    if (this.role === 'player') {
      this.lockPlayer();
      if (m.snapshot) { this.lastNarrAt = m.snapshot.narration?.at ?? null; this.queueApply(m.snapshot); }
      else this.waiting(true);
    } else { this.joinUrl = m.joinUrls[0]; this.renderInvite(); this.sendSnapshot(true); }
    this.joinUrl = m.joinUrls?.[0] || this.joinUrl;
    this.renderCode();
    if (!this.welcomed) this.toast(this.role === 'dm' ? 'Your table is open. Share the code with your players.' : `You take a seat at the table, ${this.name}.`, 'join');
    this.welcomed = true;
    this.dm.emit();
  }

  onRefused(m) {
    if (m.fatal) { this.client.stop(); this.onFatal?.(m.error); return; }
    // The DM chair is taken: sit down as a player instead.
    this.toast(`${m.error} You joined as a player.`, 'warn'); this.role = 'player'; this.dm.setRole('player');
    this.client.hello = { ...this.client.hello, role: 'player', host: false }; this.client.ws.close();
  }

  /** Tells the table whether this person is in a headset (shown on the roster). */
  setVR(on) { this.client?.send({ t: 'vr', on: !!on }); }
  /** DM only: sends a player home; their rejoin number stops working. */
  kick(playerId) { if (this.role === 'dm' && playerId) this.client?.send({ t: 'kick', id: playerId }); }

  // ---------- local changes going out ----------
  hookLocal() {
    const dm = this.dm, self = this;
    let timer = null;
    dm.on(() => { if (self.role !== 'dm' || self.applying) return; if (!timer) timer = setTimeout(() => { timer = null; self.sendSnapshot(); }, SNAPSHOT_MS); });
    // One-shot DM events (sounds and lightning have no state to snapshot).
    const ev = (kind, fn) => function (...args) { if (self.role === 'dm' && !self.applying) self.client.send({ t: 'event', kind, args }); return fn.apply(this, args); };
    dm.sfx = ev('sfx', dm.sfx); dm.lightning = ev('lightning', dm.lightning);
    // Fog of war: DM paint → PNG at most twice a second.
    for (const method of ['revealUV', 'resetFog']) {
      const paint = this.table[method].bind(this.table);
      this.table[method] = (...args) => { paint(...args); if (self.role === 'dm') self.fogDirty = true; };
    }
    setInterval(() => { if (this.fogDirty && this.role === 'dm') { this.fogDirty = false; this.client.send({ t: 'fog', png: this.table.fogCanvas.toDataURL('image/png') }); } }, FOG_MS);
    // Roll outcomes and plain die results are shared; secret rolls never are.
    const finish = this.rolls.finish.bind(this.rolls);
    this.rolls.finish = (g) => { finish(g); const txt = this.dm.state.rollLog.at(-1)?.text; if (txt && !this.applying) this.client.send({ t: 'roll', text: txt, crit: !!g.lastCrit }); };
    const onRoll = dm.onRoll.bind(dm);
    dm.onRoll = (r) => { onRoll(r); if (!r.secret) this.client.send({ t: 'roll', text: `${r.type}: ${r.value}`, crit: r.type === 'd20' && r.value === 20 }); };
    // Dice-tray results (and the ability scores rolled while building a character).
    const prev = this.rolls.onAnnounce;
    this.rolls.onAnnounce = (a) => { prev?.(a); if (!a.secret) this.client.send({ t: 'roll', text: a.text, crit: false }); };
  }

  sendSnapshot(force = false) {
    if (this.role !== 'dm') return;
    this.dm.serialize(); // refreshes mini positions in state.tokens
    this.client.send({ t: 'snapshot', state: publicState(this.dm.state), rev: ++this.rev, force });
  }

  sendMoves() {
    for (const it of Object.values(this.grab.held)) {
      if (it.kind !== 'mini' || !it.netKey) continue;
      if (!it.wasHeld) it.netOrigin = { x: it.body.position.x, y: it.body.position.y, z: it.body.position.z };
      if (!this.ownsMini(it)) { it.wasHeld = true; continue; } // someone else's mini: ask on release
      const p = it.body.position, q = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(it.body.quaternion.x, it.body.quaternion.y, it.body.quaternion.z, it.body.quaternion.w));
      it.wasHeld = true;
      this.client.send({ t: 'move', key: it.netKey, x: p.x, y: p.y, z: p.z, qy: q.y });
    }
    // Final resting position after a release, so everyone ends in the same place.
    for (const it of this.grab.items) if (it.wasHeld && !this.grab.isHeld(it) && it.body.velocity.length() < 0.02) {
      it.wasHeld = false; const p = it.body.position;
      if (!this.ownsMini(it)) { const rid = this.dm.act('move', { id: it.netKey, x: p.x, z: p.z }); const r = this.requests.mine.get(rid); if (r) r.origin = it.netOrigin; continue; }
      this.client.send({ t: 'move', key: it.netKey, x: p.x, y: p.y, z: p.z, qy: null });
      this.onMiniMoved?.(it);
    }
  }

  // ---------- players: applying the DM's world ----------
  lockPlayer() {
    if (this.locked) return; this.locked = true;
    const setRole = this.dm.setRole.bind(this.dm);
    this.dm.setRole = () => setRole('player'); this.dm.setRole('player');
    // Damage / death saves / initiative a player rolls become requests the DM approves.
    this.dm.damage = (id, n, o = {}) => {
      const roll = this.dm.state.rollLog?.at(-1)?.text ?? null;
      if (o.deathSave != null) return this.dm.act('deathSave', { id, d20: o.deathSave }, { roll });
      if (o.initiative != null) return this.dm.act('initiative', { id, value: o.initiative }, { roll });
      return this.dm.act('hp', { id, expr: n >= 0 ? `-${n}` : `+${-n}`, crit: !!o.crit }, { roll });
    };
  }

  /** Only the DM and a mini's owner move it directly; everything else is a request (§5b). */
  moveAllowed(m) {
    const dmId = this.players.find((p) => p.role === 'dm')?.id;
    if (!m.from || m.from === dmId) return true;
    const t = this.dm.tokens?.find(m.key);
    return !t || t.owner === m.from;
  }
  ownsMini(it) { if (this.role !== 'player') return true; const t = this.dm.tokens?.find(it.netKey); return !t || t.owner === this.me?.id; }

  /** DM: executes an approved move request and tells every table. */
  moveToken(id, x, z) {
    const b = this.dm.tokens?.refs[id]?.item?.body; if (!b) return null;
    b.position.x = x; b.position.z = z; b.velocity?.set(0, 0, 0);
    this.client?.send({ t: 'move', key: id, x, y: b.position.y, z, qy: null });
    return true;
  }

  queueApply(state) {
    this.pending = state; this.waiting(false);
    if (this.applyingAsync) return;
    this.applyingAsync = true;
    (async () => { while (this.pending) { const s = this.pending; this.pending = null; try { await this.apply(s); } catch (e) { console.warn('[sync] apply failed', e); } } this.applyingAsync = false; })();
  }

  async apply(s) {
    const dm = this.dm, mgr = this.combat;
    this.applying = true;
    try {
      dm.state.forge.library = (s.forge?.library || []).filter((e) => e.kind === 'creature');
      if (s.scene && s.scene !== dm.state.scene && s.scene !== this.sceneWanted) { this.sceneWanted = s.scene; dm.setScene(s.scene); }
      for (const [k, v] of Object.entries(s.lighting || {})) if (dm.state.lighting[k] !== v) dm.setLighting(k, v);
      for (const [k, v] of Object.entries(s.weather || {})) if (!!dm.state.weather[k] !== !!v) dm.setWeather(k, v);
      if (s.map && s.map.fogOfWar !== dm.state.map.fogOfWar) dm.setFogOfWar(s.map.fogOfWar);
      if (s.music && s.music !== dm.state.music) dm.setMusic(s.music);
      if (s.narration && s.narration.at !== this.lastNarrAt) { this.lastNarrAt = s.narration.at; dm.narrate(s.narration.text); }
      if (s.dice) { this.dice.locked = s.dice.locked; dm.state.dice.locked = s.dice.locked; }
      dm.state.party = s.party || [];
      dm.state.savedDefs = s.savedDefs || [];
      dm.state.settings = { rulesAssist: true, ...(s.settings || {}) };
      dm.state.session = s.session || { stage: 'play', ready: {} };
      dm.state.calls = s.calls || []; dm.state.strikes = s.strikes || [];

      // Tokens: diff by id through TokenManager (the same spawn path as the DM): spawn new, update changed, remove gone.
      const T = dm.tokens, incoming = migrateState(s).tokens || [], ids = new Set(incoming.map((t) => t.id));
      for (const t of [...T.list]) if (!ids.has(t.id)) T.remove(t.id, { emit: false });
      for (const t of incoming) {
        const old = T.find(t.id);
        if (!old) { T.spawn(t, { id: t.id, emit: false, join: false }); continue; }
        // HP changes animate (damage numbers, falls) before the new numbers land.
        if (t.hp != null && t.hp !== old.hp) { const r = mgr.refs[t.id], pos = r?.life?.position.clone().setY(1.5) || r?.item?.mesh.position.clone(); if (pos) this.cinematic.damageNumber(pos.setY(pos.y + 0.08), Math.abs(old.hp - t.hp), { heal: t.hp > old.hp }); }
        if (t.hp != null) { if (t.hp <= 0 && old.hp > 0) mgr.down(old); else if (t.hp > 0 && old.hp <= 0) mgr.standUp(old); }
        if (t.model !== old.model || !!t.life !== old.life || (t.forge ?? null) !== (old.forge ?? null)) T.update(t.id, { model: t.model, life: t.life, forge: t.forge ?? null });
        if (t.lifePos && String(t.lifePos) !== String(old.lifePos)) { const L = mgr.refs[t.id]?.life; if (L) L.userData.glideTo = t.lifePos; }
        const { pos: _pos, ...rest } = JSON.parse(JSON.stringify(t)); Object.assign(old, rest);
      }
      const C = s.combat || {};
      Object.assign(T.combat, { active: !!C.active, round: C.round ?? 1, turn: C.turn ?? 0, acted: !!C.acted, order: (C.order || []).filter((id) => T.find(id)) });
      dm.emit();
    } finally { this.applying = false; }
  }

  applyFog(png) {
    const img = new Image();
    img.onload = () => { const g = this.table.fogCanvas.getContext('2d'); g.clearRect(0, 0, img.width, img.height); g.drawImage(img, 0, 0); this.table.fogTex.needsUpdate = true; };
    img.src = png;
  }

  onEvent(m) {
    this.applying = true;
    try {
      if (m.kind === 'sfx') this.dm.sfx(...m.args);
      else if (m.kind === 'lightning') this.dm.lightning();
      else this.onEventKind[m.kind]?.(...(m.args || []));
    } finally { this.applying = false; }
  }

  // ---------- per-frame: smooth remote mini moves ----------
  update(dt) {
    for (const it of this.targets.size ? this.grab.items : []) {
      const t = it.netKey && this.targets.get(it.netKey); if (!t || this.grab.isHeld(it)) continue;
      const b = it.body, k = 1 - Math.exp(-dt * 14); // critically-damped glide, not a teleport
      b.position.x += (t.x - b.position.x) * k; b.position.z += (t.z - b.position.z) * k; b.position.y += (Math.max(t.y, TABLE_TOP + 0.02) - b.position.y) * k;
      b.velocity.set(0, 0, 0);
      if (t.qy != null) b.quaternion.setFromEuler(0, t.qy, 0);
      if (Math.hypot(t.x - b.position.x, t.z - b.position.z) < 0.001 && performance.now() - t.t > 400) this.targets.delete(it.netKey);
    }
  }

  // ---------- presence ----------
  /** Floor point of a seat. */
  seatPos(seat) { const [x, z] = seatLayout(seat).pos; return new THREE.Vector3(x, 0.02, z); }
  /** The connected person who owns a token, if any. */
  playerOf(token) { return token?.owner ? this.players.find((p) => p.id === token.owner) || null : null; }

  onPresence(m) {
    this.players = m.players; this.renderPlayers();
    if (this.role === 'dm' && this.dm.tokens) { // the DM's machine owns player tokens: auto-join, reclaim on rejoin, away on leave
      const present = new Set(m.players.map((p) => p.id));
      for (const p of m.players) if (p.role === 'player') claimPlayerToken(this.dm.tokens, p, present);
      markAway(this.dm.tokens, present);
    }
    if (this.role === 'player') this.waiting(!m.dm);
    this.onPlayers?.(m.players);
    this.dm.emit();
  }
  onJoined(p) {
    this.toast(`${p.name} ${p.role === 'dm' ? 'takes the Dungeon Master’s chair' : 'joins the table'}`, 'join');
    const pos = this.seatPos(p.seat);
    this.cinematic.summon(pos, { radius: 0.45, color: '#f3d58a' }); this.effects.burst?.(pos.clone().setY(0.9), '#ff8a3d', { count: 80, speed: 0.8 });
    this.audio.tone?.(520, 0.25, { type: 'triangle', gain: 0.08, freqEnd: 880 });
  }
  onLeft(p) { this.toast(`${p.name} leaves the table`, 'leave'); }

  /** Someone else's roll: an ember label rises over their seat; a crit flares for everyone. */
  onRemoteRoll(m) {
    const pos = this.seatPos(m.seat ?? 0).setY(1.15);
    const crit = m.crit || /CRITICAL|NAT 20/.test(m.text);
    this.effects.label(`${m.name}: ${m.text}`, pos, { scale: 0.05, life: 4.5, glow: crit ? '#ffd34d' : /MISS|FAIL|FUMBLE/.test(m.text) ? '#ff4040' : /HIT|SUCCESS/.test(m.text) ? '#3cff7a' : '#ff8a3d' });
    if (crit) this.cinematic.critMoment(pos); else this.effects.burst?.(pos, '#ff8a3d', { count: 40, speed: 0.5 });
    this.dm.state.rollLog.push({ text: `${m.name} · ${m.text}`, color: crit ? '#a07800' : null }); if (this.dm.state.rollLog.length > 30) this.dm.state.rollLog.shift();
    this.table.setLog(this.dm.state.rollLog);
    const li = document.createElement('li'); li.textContent = `${m.name}: ${m.text}`; li.className = crit ? 'nat20 remote' : 'remote';
    const list = document.getElementById('log-list'); if (list) { list.prepend(li); while (list.children.length > 12) list.lastChild.remove(); }
  }

  // ---------- HUD ----------
  buildHud() {
    const hud = document.getElementById('hud'); if (!hud) return;
    // The connection pill joins the top-right badges; notices and the waiting screen stay on the HUD itself.
    (document.getElementById('badges') || hud).insertAdjacentHTML('afterbegin', '<div id="net-badge" class="offline" title="Table connection"><i></i><span>Solo</span></div>');
    hud.insertAdjacentHTML('beforeend', `<div id="net-toasts" aria-live="polite"></div>
      <div id="net-wait" hidden><div class="embers"></div><div class="msg"><b>Waiting for the Dungeon Master…</b><small>The table will light up when they arrive.</small></div></div>`);
  }
  setStatus(s) {
    const b = document.getElementById('net-badge'); if (!b) return;
    b.className = s; b.querySelector('span').textContent = s === 'online' ? `${this.role === 'dm' ? 'Hosting' : 'At the table'} · ${this.players.length || 1}` : s === 'connecting' ? 'Connecting…' : 'Reconnecting…';
  }
  renderPlayers() { this.setStatus(this.client?.ws?.readyState === 1 ? 'online' : 'offline'); this.renderInvite(); }
  renderCode() {
    const b = document.getElementById('code-badge'); if (!b) return;
    const real = this.code && this.code !== 'TABLE' && !this.testMode;
    b.hidden = !real; if (real) b.textContent = `Code ${this.code}`;
  }
  waiting(on) { const w = document.getElementById('net-wait'); if (w) w.hidden = !on; }
  toast(text, kind = 'join') {
    this.onToast?.(text, kind); // the VR ribbon shows the same message
    const box = document.getElementById('net-toasts'); if (!box) return;
    const t = document.createElement('div'); t.className = `net-toast ${kind}`; t.innerHTML = `<span>${String(text).replace(/</g, '&lt;')}</span>`;
    box.appendChild(t); setTimeout(() => t.classList.add('out'), 3800); setTimeout(() => t.remove(), 4600);
  }

  /** DM panel invite card: the table code, the join link, a QR code, and who is seated. */
  async renderInvite() {
    const el = document.getElementById('dm-invite'); if (!el || this.role !== 'dm') return;
    if (this.joinUrl && el.dataset.url !== this.joinUrl) {
      el.dataset.url = this.joinUrl;
      try { el.querySelector('img').src = await QRCode.toDataURL(this.joinUrl, { margin: 1, width: 168, color: { dark: '#1a0802', light: '#f3e2b8' } }); } catch { /* QR optional */ }
      el.querySelector('code').textContent = this.joinUrl;
    }
    const codeEl = el.querySelector('.invite-code'); if (codeEl) codeEl.textContent = this.code && this.code !== 'TABLE' ? this.code : 'test table';
    el.querySelector('ul').innerHTML = this.players.map((p) => `<li class="${p.role}">${p.vr ? '🥽 ' : ''}${p.name.replace(/</g, '&lt;')}${p.role === 'dm' ? ' (DM)' : ''}</li>`).join('') || '<li class="hint">Nobody yet.</li>';
  }
}

/** The table this browser tab was last seated at (for a refresh), or null. */
export function lastSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } }
export function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* storage unavailable */ } }
