import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { buildDieTemplate } from './DiceFactory.js';
import { buildFancyTemplate } from './fancyDice.js';

// ?classicDice=1 brings back the original procedural dice.
const CLASSIC = typeof location !== 'undefined' && new URLSearchParams(location.search).has('classicDice');
export const dieTemplate = (type) => (CLASSIC ? buildDieTemplate(type) : buildFancyTemplate(type));
import { faceUpIndex, topVertexIndex, isSettled } from './faceUp.js';
import { TABLE_TOP, TRAY, trayPoint } from '../physics/Physics.js';
import { random, randRange } from '../core/random.js';

let nextId = 1;

export class DiceManager {
  constructor({ scene, physics, effects, audio, grab, onResult }) {
    Object.assign(this, { scene, physics, effects, audio, grab, onResult });
    this.dice = []; this.locked = false; this.secret = false; this.lastRoll = null; this.rollCount = 0;
  }

  spawn(type, pos) {
    const tpl = dieTemplate(type);
    const mesh = new THREE.Mesh(tpl.geom, tpl.mats);
    mesh.castShadow = true; mesh.name = type;
    const body = new CANNON.Body({ mass: 0.02, material: this.physics.mDice, shape: tpl.shape(), linearDamping: 0.1, angularDamping: 0.1 });
    body.sleepSpeedLimit = 0.05; body.sleepTimeLimit = 0.4;
    const [sx, sz] = trayPoint(randRange(-0.32, 0.32) * TRAY.w, randRange(-0.3, 0.3) * TRAY.d);
    const p = pos || [sx, TABLE_TOP + 0.08, sz];
    body.position.set(...p);
    body.quaternion.setFromEuler(random() * 6, random() * 6, random() * 6);
    let lastClack = 0;
    body.addEventListener('collide', (e) => {
      const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
      const now = performance.now();
      if (v > 0.25 && now - lastClack > 45) { lastClack = now; this.audio.clack(v); }
    });
    this.physics.world.addBody(body); this.scene.add(mesh);
    const die = {
      id: nextId++, kind: 'die', type, tpl, mesh, body, rolling: true, still: 0, grabOffsetY: 0,
      canGrab: () => !this.locked,
      onGrab: () => { die.rolling = false; },
      onRelease: () => { die.rolling = true; die.still = 0; },
    };
    this.dice.push(die); this.grab.add(die);
    return die;
  }

  toss(die) {
    const b = die.body;
    if (this.grab.isHeld(die)) return;
    // Thrown from the player's edge of the tray toward its far wall (tray space: -z is away from the player).
    const [tx, tz] = trayPoint(randRange(-0.27, 0.18) * TRAY.w, TRAY.d / 2 - 0.08), k = TRAY.d / 0.5;
    const c = Math.cos(TRAY.yaw || 0), s = Math.sin(TRAY.yaw || 0), vx = randRange(-0.3, 0.3), vz = randRange(-1.4, -0.9) * Math.max(0.6, k);
    b.position.set(tx, TABLE_TOP + 0.15, tz);
    b.velocity.set(vx * c + vz * s, randRange(0.4, 0.9), -vx * s + vz * c);
    b.angularVelocity.set(randRange(-25, 25), randRange(-25, 25), randRange(-25, 25));
    b.wakeUp(); die.rolling = true; die.still = 0;
  }

  /** Spawns dice of the given types and throws them together; returns them (for RollService groups). */
  spawnGroup(types) { return types.map((t, i) => { const d = this.spawn(t); setTimeout(() => this.toss(d), i * 30); return d; }); }

  rollAll() { if (this.locked) return; this.dice.forEach((d, i) => setTimeout(() => this.toss(d), i * 40)); }

  remove(die) { this.physics.world.removeBody(die.body); this.scene.remove(die.mesh); this.grab.remove(die); this.dice = this.dice.filter((d) => d !== die); }
  clear() { [...this.dice].forEach((d) => this.remove(d)); }

  valueOf(die) {
    const bq = die.body.quaternion, q = [bq.x, bq.y, bq.z, bq.w];
    if (die.type === 'd4') return die.tpl.vertexValues[topVertexIndex(die.tpl.vertices, q)];
    return die.tpl.faceValues[faceUpIndex(die.tpl.faceNormals, q)];
  }

  update(dt) {
    for (const d of this.dice) {
      const b = d.body;
      d.mesh.position.copy(b.position); d.mesh.quaternion.copy(b.quaternion);
      if (!this.grab.isHeld(d) && (b.position.y < 0.5 || Math.abs(b.position.x) > 3 || Math.abs(b.position.z) > 3)) {
        this.toss(d); // fell off the table – bounce it back into the tray so the roll still counts
      }
      if (!d.rolling || this.grab.isHeld(d)) continue;
      const lin = b.velocity.length(), ang = b.angularVelocity.length();
      d.still = lin < 0.03 && ang < 0.15 ? d.still + 1 : 0;
      if (isSettled(lin, ang, d.still) || b.sleepState === CANNON.Body.SLEEPING) {
        d.rolling = false; this.report(d, this.valueOf(d));
      }
    }
  }

  report(die, value) {
    const pos = die.mesh.position.clone().add(new THREE.Vector3(0, 0.07, 0));
    const secret = this.secret || !!die.secret; // die.secret: a secret tray roll
    this.lastRoll = { type: die.type, value, secret, id: die.id }; this.rollCount++;
    if (!secret) {
      const nat20 = die.type === 'd20' && value === 20, nat1 = die.type === 'd20' && value === 1;
      this.effects.label(`${value}`, pos, nat20 ? { glow: '#ffd700', color: '#ffe680' } : nat1 ? { glow: '#ff0000', color: '#ff8080' } : {});
      if (nat20) { this.effects.burst(pos, '#ffd34d', { count: 180, speed: 1.4 }); this.audio.fanfare(); }
      if (nat1) { this.effects.puff(pos); this.audio.sadTrombone(); }
    } else {
      this.effects.label('?', pos, { glow: '#8a2be2' });
    }
    this.onResult?.({ id: die.id, type: die.type, value, secret });
  }
}
