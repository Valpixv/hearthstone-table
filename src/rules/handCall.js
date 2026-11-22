// The dice a DM's call needs thrown by hand (design/completion-plan.md §7, the action loop).
// Each physical die of the call is a slot. A thrown die of a needed type fills an empty slot of that type; once
// every slot of that type is full, a re-throw replaces the oldest throw of that type (the last throw counts).
// Dice of other types are not part of the call. Pure logic: no DOM, no physics.
import { parse, split, fromResults } from './dicePool.js';

export class HandCall {
  /** @param {string} expr the call's dice, e.g. '2d6+3' or '2d20kh1+5' (throws on an unreadable expression) */
  constructor(expr) {
    this.pool = parse(expr);
    const { physical, digital } = split(this.pool);
    /** Only calls made entirely of physical dice can be thrown by hand; the rest use the Roll button. */
    this.ok = !digital.length && physical.length > 0;
    this.slots = physical.map((p) => ({ sides: p.sides, part: p.part ?? null, value: null, at: 0 }));
    this.tick = 0;
  }

  /** Die types to lay out in the tray, e.g. ['d6', 'd6']. */
  get types() { return this.slots.map((s) => `d${s.sides}`); }

  /** True when every required die has been thrown at least once. */
  get complete() { return this.slots.every((s) => s.value != null); }

  /**
   * One settled die. @param {number} sides @param {number} value (a d10 reading 0 counts as 10)
   * @returns {boolean} true when the call needed a die of that type
   */
  add(sides, value) {
    const same = this.slots.filter((s) => s.sides === sides);
    if (!same.length) return false;
    const slot = same.find((s) => s.value == null) ?? same.reduce((a, b) => (a.at <= b.at ? a : b));
    slot.value = sides === 10 && value === 0 ? 10 : value; slot.at = ++this.tick;
    return true;
  }

  /** Progress per die type, in call order: [{ sides, have, need }]. */
  progress() {
    const out = [];
    for (const s of this.slots) {
      let p = out.find((x) => x.sides === s.sides);
      if (!p) out.push((p = { sides: s.sides, have: 0, need: 0 }));
      p.need++; if (s.value != null) p.have++;
    }
    return out;
  }

  /** The finished roll (a dicePool roll with the call's modifier and keep rules). Only when complete. */
  result() {
    return fromResults(this.pool, this.slots.map((s) => (s.part === 'tens' && s.value === 10 ? 0 : s.value)));
  }
}
