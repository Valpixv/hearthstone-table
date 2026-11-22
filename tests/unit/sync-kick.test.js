// The DM's Kick removes a player for good: their connection is returned and their rejoin number stops working.
import { describe, it, expect } from 'vitest';
import { Room } from '../../server/sync.js';

const join = (room, conn, id, hello) => { room.clients.set(conn, { conn, id, seat: room.freeSeat() }); return room.hello(conn, hello); };

describe('Room.kick', () => {
  it('returns the kicked player and forgets their rejoin number', () => {
    const room = new Room('ABCDEF');
    join(room, 'c-dm', 'dm-1', { role: 'dm', name: 'DM' });
    join(room, 'c-pl', 'pl-1', { role: 'player', name: 'Aria' });
    const rejoin = room.clients.get('c-pl').rejoin;
    const gone = room.kick('pl-1');
    expect(gone.map((c) => c.conn)).toEqual(['c-pl']);
    room.clients.set('c-new', { conn: 'c-new', id: 'x', seat: 5 });
    expect(room.hello('c-new', { role: 'player', rejoin }).ok).toBe(false);
  });
  it('never kicks the DM', () => {
    const room = new Room('ABCDEF');
    join(room, 'c-dm', 'dm-1', { role: 'dm', name: 'DM' });
    expect(room.kick('dm-1')).toEqual([]);
  });
});
