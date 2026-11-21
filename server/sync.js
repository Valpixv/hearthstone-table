// Table sync: many rooms per server, each found by a short invite code. The DM's browser is the authority of its
// room; players mirror it. WebSocket at /sync on the Vite dev or preview server (the standard `ws` package).
// Protocol (JSON): see design/sync-plan.md and design/completion-plan.md §3.1.
import { WebSocketServer } from 'ws';
import { networkInterfaces } from 'node:os';
import { randomUUID, randomInt } from 'node:crypto';

/** Tuning. */
export const SYNC_CFG = {
  codeLength: 6,
  codeAlphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', // no 0/O/1/I: read aloud without mistakes
  defaultCode: 'TABLE',                             // the room test mode and code-less links share
  emptyRoomTtlMs: 10 * 60 * 1000,                   // an empty room (and its last snapshot) is kept this long
  maxRooms: 200,
  maxName: 24,
};

/** LAN URLs players can open, built from the machine's IPv4 addresses. */
export function joinUrls(proto, port, code = null) {
  const q = code && code !== SYNC_CFG.defaultCode ? `?join=${code}` : '?join';
  const urls = [];
  for (const list of Object.values(networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) urls.push(`${proto}://${a.address}:${port}/${q}`);
  return urls.length ? urls : [`${proto}://localhost:${port}/${q}`];
}

/** A fresh invite code from the unambiguous alphabet. */
export function makeCode(rand = randomInt, cfg = SYNC_CFG) {
  let s = ''; for (let i = 0; i < cfg.codeLength; i++) s += cfg.codeAlphabet[rand(cfg.codeAlphabet.length)];
  return s;
}

/** Upper-cases and strips an invite code as typed ("ab-c 123" → "ABC123"). */
export const normalizeCode = (c) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

/** Pure room logic (unit-testable): who is DM, who is present, the last snapshot, and each person's lasting identity. */
export class Room {
  constructor(code = SYNC_CFG.defaultCode) {
    this.code = code; this.clients = new Map(); this.dmId = null; this.snapshot = null; this.rev = 0; this.fog = null;
    this.identities = new Map(); // rejoin code → { id, name, seat }: lets a person move from desktop to headset
    this.emptySince = null;
  }
  presence() { return [...this.clients.values()].filter((c) => c.joined).map(({ id, name, role, charId, seat, vr }) => ({ id, name, role, charId, seat, vr: !!vr })); }
  freeSeat() {
    const used = new Set([...this.clients.values()].map((c) => c.seat));
    for (const i of this.identities.values()) used.add(i.seat);
    let s = 0; while (used.has(s)) s++; return s;
  }
  /** A new 4-digit rejoin code no one in this room holds. */
  newRejoin(rand = randomInt) { let r; do { r = String(rand(10000)).padStart(4, '0'); } while (this.identities.has(r)); return r; }
  /**
   * Seats a connection. Returns { ok, error?, replaced? }: `replaced` is the connection id this one took over
   * (the same person arriving on another device with their rejoin code).
   * A second DM is refused while the first is connected.
   */
  hello(connId, { role, name, charId, rejoin, vr } = {}) {
    const c = this.clients.get(connId); if (!c) return { ok: false, error: 'unknown client' };
    const want = role === 'dm' ? 'dm' : 'player';
    let replaced = null;
    const ident = rejoin != null ? this.identities.get(String(rejoin)) : null;
    if (rejoin != null && String(rejoin) !== '' && !ident) return { ok: false, error: 'That rejoin code is not known at this table.' };
    if (ident) {
      // The same person on a new device: keep their id (token ownership) and seat; the old connection is dropped.
      for (const o of this.clients.values()) if (o !== c && o.id === ident.id) replaced = o.conn;
      c.id = ident.id; c.seat = ident.seat; c.rejoin = String(rejoin);
      if (!name) name = ident.name;
    }
    if (want === 'dm' && this.dmId && this.dmId !== c.id) return { ok: false, error: 'This table already has a Dungeon Master.' };
    Object.assign(c, { role: want, name: String(name || 'Adventurer').slice(0, SYNC_CFG.maxName), charId: charId || null, vr: !!vr, joined: true });
    if (!c.rejoin) { c.rejoin = this.newRejoin(); }
    this.identities.set(c.rejoin, { id: c.id, name: c.name, seat: c.seat, role: c.role });
    if (c.role === 'dm') this.dmId = c.id;
    this.emptySince = null;
    return { ok: true, replaced };
  }
  /** Direct mini moves: the DM always; a player only for a token they own (per the last snapshot). */
  canMove(id, key) {
    if (id === this.dmId) return true;
    const t = this.snapshot?.tokens?.find((x) => x.id === key);
    return !t || t.owner === id;
  }
  /** Drops a connection. The person's identity (seat, id) stays so they can come back. */
  leave(connId, now = Date.now()) {
    const c = this.clients.get(connId); this.clients.delete(connId);
    if (c && this.dmId === c.id && ![...this.clients.values()].some((o) => o.id === c.id)) this.dmId = null;
    if (!this.clients.size) this.emptySince = now;
    return c || null;
  }
  byId(id) { return [...this.clients.values()].find((c) => c.id === id) || null; }
}

/** The set of rooms on this server (unit-testable). */
export class Rooms {
  constructor(cfg = SYNC_CFG) { this.cfg = cfg; this.rooms = new Map(); }
  get(code) { return this.rooms.get(normalizeCode(code) || this.cfg.defaultCode) || null; }
  /** A new room with a fresh code. */
  create(rand = randomInt) {
    let code; do { code = makeCode(rand, this.cfg); } while (this.rooms.has(code));
    const r = new Room(code); this.rooms.set(code, r); return r;
  }
  /**
   * The room for a code. The default (test mode) room is created on demand; with `create` (test mode asked for a
   * named table, so parallel test runs do not share one) any code is.
   */
  open(code, create = false) {
    const k = normalizeCode(code) || this.cfg.defaultCode;
    if (!this.rooms.has(k) && (k === this.cfg.defaultCode || (create && this.rooms.size < this.cfg.maxRooms))) this.rooms.set(k, new Room(k));
    return this.rooms.get(k) || null;
  }
  /** Drops rooms that have been empty longer than the TTL. */
  sweep(now = Date.now()) {
    for (const [k, r] of this.rooms) if (!r.clients.size && r.emptySince != null && now - r.emptySince > this.cfg.emptyRoomTtlMs) this.rooms.delete(k);
  }
}

function attach(httpServer, proto, port) {
  if (!httpServer) return;
  const wss = new WebSocketServer({ noServer: true }), rooms = new Rooms();
  const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const all = (room, msg, except = null) => { for (const c of room.clients.values()) if (c.ws !== except && c.joined) send(c.ws, msg); };
  const presence = (room) => all(room, { t: 'presence', players: room.presence(), dm: !!room.dmId });
  setInterval(() => rooms.sweep(), 60_000).unref?.();

  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/sync')) return; // leave Vite's HMR socket alone
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  wss.on('connection', (ws) => {
    const conn = randomUUID().slice(0, 8);
    let room = null;
    const me = () => room?.clients.get(conn) || null;
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.t === 'hello') {
        // Which room: a DM asking to host gets a fresh code; a code joins that room; no code is the shared test room.
        let target = null;
        if (m.host && m.role === 'dm' && !m.code) { if (rooms.rooms.size >= SYNC_CFG.maxRooms) return send(ws, { t: 'refused', error: 'This server is full.' }); target = rooms.create(); }
        else target = rooms.open(m.code, !!m.test);
        if (!target) return send(ws, { t: 'refused', error: 'No table has that code. Check it with your Dungeon Master.', fatal: true });
        if (room && room !== target) { room.leave(conn); presence(room); }
        room = target;
        if (!room.clients.has(conn)) room.clients.set(conn, { conn, id: conn, ws, role: 'player', name: 'Adventurer', charId: null, seat: room.freeSeat(), joined: false });
        const r = room.hello(conn, m);
        if (!r.ok) { const dmTaken = m.role === 'dm' && !m.rejoin; if (!dmTaken) { room.leave(conn); room = null; } return send(ws, { t: 'refused', error: r.error, fatal: !dmTaken }); }
        if (r.replaced) { const old = room.clients.get(r.replaced); if (old) { send(old.ws, { t: 'moved' }); room.clients.delete(r.replaced); try { old.ws.close(); } catch { /* already closed */ } } }
        const c = me();
        send(ws, { t: 'welcome', you: { id: c.id, role: c.role, seat: c.seat, rejoin: c.rejoin }, code: room.code, snapshot: room.snapshot, rev: room.rev, joinUrls: joinUrls(proto, port, room.code) });
        if (c.role === 'player' && room.fog) send(ws, { t: 'fog', png: room.fog });
        if (!r.replaced) all(room, { t: 'joined', player: { id: c.id, name: c.name, role: c.role, seat: c.seat } }, ws);
        return presence(room);
      }
      const c = me(); if (!c || !c.joined) return;
      const id = c.id;
      if (m.t === 'snapshot' && id === room.dmId) { room.snapshot = m.state; room.rev = m.rev; return all(room, m, ws); }
      if (m.t === 'event' && id === room.dmId) return all(room, m, ws);
      if (m.t === 'fog' && id === room.dmId) { room.fog = m.png; return all(room, m, ws); }
      if (m.t === 'move' && !room.canMove(id, m.key)) return; // only the DM and a mini's owner move it directly
      // Relayed to everyone else, stamped with who sent it: mini moves, roll results, cosmetic casts, head/hand poses.
      if (m.t === 'move' || m.t === 'roll' || m.t === 'cast' || m.t === 'pose') return all(room, { ...m, from: id, name: c.name, seat: c.seat }, ws);
      if (m.t === 'rtc') { const to = room.byId(m.to); return to && send(to.ws, { ...m, from: id }); } // voice signalling, peer to peer
      if (m.t === 'vr') { c.vr = !!m.on; return presence(room); }
      if (m.t === 'req') { // player asks, the DM's machine decides
        const dm = room.dmId && room.byId(room.dmId);
        return dm ? send(dm.ws, { ...m, from: id }) : send(ws, { t: 'reqResult', v: 1, rid: m.rid, status: 'denied', reason: 'No Dungeon Master at the table.' });
      }
      if ((m.t === 'reqResult' || m.t === 'tell') && id === room.dmId) { const to = room.byId(m.to); return to && send(to.ws, m); }
      if (m.t === 'claim') { c.charId = m.charId; return presence(room); }
    });
    ws.on('close', () => {
      if (!room) return;
      const c = room.leave(conn);
      if (c?.joined && !room.byId(c.id)) all(room, { t: 'left', player: { id: c.id, name: c.name, role: c.role } });
      presence(room);
    });
  });
}

/** Vite plugin: attaches the sync socket to `vite` (dev) and `vite preview`. */
export default function tableSync() {
  const hook = (server) => {
    const https = !!server.config.server?.https || !!server.config.preview?.https;
    server.httpServer?.once('listening', () => attach(server.httpServer, https ? 'https' : 'http', server.httpServer.address().port));
  };
  return { name: 'table-sync', configureServer: hook, configurePreviewServer: hook };
}
