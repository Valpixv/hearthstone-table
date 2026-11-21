import { describe, expect, it, vi } from 'vitest';
import { VRUI } from '../../src/ui/vr/VRUI.js';

function playerUI() {
  return Object.assign(Object.create(VRUI.prototype), {
    dm: { isDM: false, state: { tokens: [{ id: 'rogue', kind: 'pc', owner: 'guest' }, { id: 'mage', kind: 'pc', owner: 'me' }] } },
    sync: { me: { id: 'me' } }, sel: {}, windows: new Map(), toggle: vi.fn(),
  });
}
describe('VR player interaction routes', () => {
  it('opens each player menu destination with its own action', () => {
    const ui = playerUI(), tiles = vi.fn();
    ui.paintMenu({ tiles, text: vi.fn() });
    const entries = tiles.mock.calls[0][0];
    for (const entry of entries) entry.run();
    expect(ui.toggle.mock.calls.flat()).toEqual(['dice','sheet','bag','spells','voice','handouts','lab']);
  });
  it('binds sheet and inventory to the owner through joining and reconnection', () => {
    const ui = playerUI();
    expect(ui.pc.id).toBe('mage');
    ui.sync.me = null;
    expect(ui.pc).toBeNull();
    ui.dm.isDM = true;
    ui.sel.pc = 'rogue';
    expect(ui.pc.id).toBe('rogue');
  });
  it('keeps every gift recipient reachable from the player bag', () => {
    const ui = playerUI(), own = ui.pc, send = vi.fn();
    own.inventory = [{ id:'rope', name:'Rope', qty:2 }];
    for(let i=0;i<7;i++) ui.dm.state.tokens.push({ kind:'pc', id:'pc'+i, name:'Player '+i });
    ui.sel.item='rope'; ui.do=send;
    const buttons=vi.fn();
    ui.paintBag({ buttons, text:vi.fn(), tiles:vi.fn(), heading:vi.fn() });
    buttons.mock.calls.flatMap(([row])=>row).find(b=>b.label==='Give to Player 6').run();
    expect(send).toHaveBeenCalledWith('give',{ id:'mage', to:'pc6', itemId:'rope', qty:1 });
  });
});
