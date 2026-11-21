import * as THREE from 'three';
import { SPELL_EFFECTS } from '../fx/SpellFx.js';
import { defaultEffect, impactDelay, makeCalls, adjustDamage, STRIKE_CFG } from './strikes.js';

/**
 * Runs the last step of the action loop on the DM's machine (design/completion-plan.md §7.4): a confirmed strike is
 * released by the attacker's gesture, every table plays the effect from the attacker to each target, and when it lands
 * the damage (or healing) is applied through CombatManager, so the hit reaction, the damage number and the HP bars all
 * move together. Players' machines only play the effect; the DM's machine is the one that changes hit points.
 */
export class StrikeFlow {
  /** @param {{ dm: object, sync: object, spellFx: object, cinematic?: object, effects?: object, now?: () => number }} deps */
  constructor({ dm, sync, spellFx, cinematic = null, effects = null }) {
    Object.assign(this, { dm, sync, spellFx, cinematic, effects });
    this.timers = new Map();
    dm.strikes = this;
    sync.onEventKind.strikeFx = (fx) => this.playFx(fx);
  }

  get list() { return this.dm.state.strikes || []; }
  find(id) { return this.list.find((s) => s.id === id) || null; }

  /** A point on a token's body: the chest of its life-size body when it has one, else its mini on the map. */
  tokenPoint(id) {
    const r = this.dm.tokens?.refs?.[id];
    if (r?.life) { const b = new THREE.Box3().setFromObject(r.life); return new THREE.Vector3(r.life.position.x, Number.isFinite(b.max.y) ? b.min.y + (b.max.y - b.min.y) * 0.6 : 1.1, r.life.position.z); }
    if (r?.item?.mesh) return r.item.mesh.position.clone().add(new THREE.Vector3(0, 0.03, 0));
    return null;
  }

  /** Where a strike starts: the gesturing hand when given, else the attacker's body, else above the table. */
  originOf(strike, given) {
    if (Array.isArray(given) && given.length === 3 && given.every(Number.isFinite)) return new THREE.Vector3(...given);
    const by = this.dm.tokens?.find(strike.by), seat = by && this.sync.playerOf?.(by);
    if (seat) return this.sync.seatPos(seat.seat).setY(1.15);
    return this.tokenPoint(strike.by) || new THREE.Vector3(0, 1.4, 0);
  }

  /** A strike was just armed. Creatures nobody plays release at once when the table is set to auto-release. */
  onArmed(strike) {
    const by = this.dm.tokens?.find(strike.by), played = by && by.kind === 'pc' && by.owner && !by.away;
    if (!played && this.dm.state.settings?.autoReleaseMonsters) this.release({ id: strike.id });
    if (this.dm.state.settings?.gestureRelease === false) this.release({ id: strike.id });
  }

  /**
   * Releases an armed strike: plays the effect everywhere and applies it when it lands.
   * @param {{ id: string, effectId?: string, origin?: number[] }} p
   * @returns {boolean} whether it was released
   */
  release({ id, effectId = null, origin = null }) {
    const s = this.find(id); if (!s || s.status !== 'armed') return false;
    const fx = SPELL_EFFECTS[effectId] ? effectId : defaultEffect(s), o = this.originOf(s, origin);
    const pts = s.targets.map((t) => this.tokenPoint(t.id)).filter(Boolean);
    s.status = 'released'; s.effectId = fx;
    const dist = pts.length ? Math.max(...pts.map((p) => p.distanceTo(o))) : 0, delay = impactDelay(fx, dist);
    this.sync.event('strikeFx', { effectId: fx, origin: o.toArray(), targets: pts.map((p) => p.toArray()), by: s.by, label: s.label });
    this.dm.emit();
    this.timers.set(id, setTimeout(() => this.resolve(id), delay * 1000));
    return true;
  }

  /** Applies a strike's damage or healing now and removes it (also the DM's "resolve now" for a strike nobody released). */
  resolve(id) {
    clearTimeout(this.timers.get(id)); this.timers.delete(id);
    const s = this.find(id); if (!s) return false;
    const dm = this.dm, mgr = dm.combatMgr;
    dm.state.strikes = this.list.filter((x) => x.id !== id);
    for (const t of s.targets) {
      const tok = dm.tokens.find(t.id); if (!tok || !t.amount) continue;
      if (s.heal) mgr.damage(t.id, -t.amount);
      else {
        mgr.damage(t.id, t.amount, { crit: s.crit, type: s.damageType });
        // Concentration: damage asks the caster for a Constitution save (DC 10 or half the damage), a reminder the DM can dismiss.
        if (dm.state.settings?.rulesAssist !== false && tok.kind === 'pc' && tok.hp > 0 && (tok.conditions || []).some((c) => c.name === 'concentrating')) {
          dm.state.calls = [...(dm.state.calls || []), ...makeCalls(dm.state.tokens, { to: [t.id], kind: 'save', ability: 'con', dc: Math.max(10, Math.floor(t.amount / 2)), label: 'Concentration save' })];
        }
      }
    }
    dm.emit();
    return true;
  }

  /** Every machine: the attacker swings, the effect flies to each target. */
  playFx({ effectId, origin, targets = [], by = null, label = '' }) {
    if (!SPELL_EFFECTS[effectId] || !Array.isArray(origin)) return;
    this.dm.combatMgr?.playAnim?.(by, 'attack');
    const pts = targets.length ? targets : [origin];
    pts.forEach((t, i) => setTimeout(() => this.spellFx.play(effectId, { origin, target: t }), i * 90));
    if (label && this.effects?.label) this.effects.label(label, new THREE.Vector3(...pts[0]).add(new THREE.Vector3(0, 0.35, 0)), { scale: 0.05, life: 2.2 });
    const far = Math.max(...pts.map((p) => new THREE.Vector3(...p).distanceTo(new THREE.Vector3(...origin))));
    setTimeout(() => this.cinematic?.shake?.(0.012, 0.25), impactDelay(effectId, far) * 1000);
  }

  /** The amount a target would take after its resistances (shown on the DM's confirm card as a suggestion). */
  suggest(tokenId, amount, damageType) { return adjustDamage(this.dm.tokens?.find(tokenId), amount, damageType); }

  /** Armed strikes that have waited past the timeout. */
  stale(now = Date.now()) { return this.list.filter((s) => s.status === 'armed' && now - s.at > STRIKE_CFG.timeoutMs); }
}
