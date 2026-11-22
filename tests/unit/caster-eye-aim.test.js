// Palm and slash aim from the eye through the hand: a hand held above eye level aims up, below aims down.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Caster } from '../../src/input/Caster.js';

const cam = () => { const c = new THREE.PerspectiveCamera(); c.position.set(0, 1.2, 0.8); c.updateMatrixWorld(); return c; };
const aimFrom = (y) => Caster.prototype.eyeAim.call({ camera: cam() }, { origin: [0, y, 0.4], dir: [0, -1, 0] });

describe('open-hand aim', () => {
  it('a hand raised above eye level aims upward', () => { expect(aimFrom(1.5).dir[1]).toBeGreaterThan(0); });
  it('a hand below eye level aims downward, into the table', () => { expect(aimFrom(0.9).dir[1]).toBeLessThan(0); });
  it('the aim points away from the viewer, into the scene', () => { expect(aimFrom(1.3).dir[2]).toBeLessThan(0); });
});
