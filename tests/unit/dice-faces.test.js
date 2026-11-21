import { describe, it, expect, beforeAll } from 'vitest';
import { faceUpIndex, topVertexIndex, rotate } from '../../src/dice/faceUp.js';
import { qFromUnitVectors, qFromAxisAngle, qMul, normalize, cross, DEG } from '../../harness/math.js';
import { mulberry32 } from '../../harness/rng.js';

// DiceFactory paints face numbers onto canvases; give Node a no-op canvas so the template
// (face normals, values, hull) can be built without a browser.
function installFakeCanvas() {
  const ctx = new Proxy({}, {
    get: (_, k) => {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 10, actualBoundingBoxAscent: 5, actualBoundingBoxDescent: 5 });
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return () => {};
    },
    set: () => true,
  });
  globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
}

let DIE_TYPES;
const TEMPLATES = {};
beforeAll(async () => {
  installFakeCanvas();
  globalThis.HTMLImageElement ??= class {};
  let buildDieTemplate;
  ({ buildDieTemplate, DIE_TYPES } = await import('../../src/dice/DiceFactory.js'));
  const { buildFancyTemplate } = await import('../../src/dice/fancyDice.js');
  TEMPLATES.classic = buildDieTemplate;
  TEMPLATES['dice-box-threejs'] = buildFancyTemplate;
});

const UP = [0, 1, 0];
const rand = mulberry32(1234);
/** A rotation putting local direction `n` straight up, plus a random spin about the vertical. */
function upright(n, spin = rand() * 2 * Math.PI) {
  return qMul(qFromAxisAngle(UP, spin), qFromUnitVectors(normalize(n), UP));
}
/** Small tilt about a random horizontal axis, like a die resting slightly askew on felt. */
function tilt(q, maxDeg) {
  const a = rand() * 2 * Math.PI;
  return qMul(qFromAxisAngle([Math.cos(a), 0, Math.sin(a)], (rand() * 2 - 1) * maxDeg * DEG), q);
}

const SIDES = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20 };

for (const kind of ['classic', 'dice-box-threejs']) describe(`dice face detection (${kind} dice)`, () => {
  const buildDieTemplate = (t) => TEMPLATES[kind](t);
  it('covers every die type the app can spawn', () => {
    expect(DIE_TYPES).toEqual(Object.keys(SIDES));
  });

  for (const type of ['d6', 'd8', 'd10', 'd12', 'd20']) {
    describe(type, () => {
      it(`has ${SIDES[type]} faces numbered 1..${SIDES[type]} exactly once`, () => {
        const tpl = buildDieTemplate(type);
        expect(tpl.faceNormals).toHaveLength(SIDES[type]);
        expect([...tpl.faceValues].sort((a, b) => a - b)).toEqual(Array.from({ length: SIDES[type] }, (_, i) => i + 1));
      });

      it('reads the correct number for every face turned up (with spin and a 10° tilt)', () => {
        const tpl = buildDieTemplate(type);
        tpl.faceNormals.forEach((n, i) => {
          for (const q of [upright(n, 0), upright(n), tilt(upright(n), 10)]) {
            const idx = faceUpIndex(tpl.faceNormals, q);
            expect(idx, `${type} face ${i}`).toBe(i);
            expect(tpl.faceValues[idx]).toBe(tpl.faceValues[i]);
            expect(rotate(q, n)[1]).toBeGreaterThan(0.95);
          }
        });
      });

      if (type !== 'd10') {
        it('opposite faces sum to sides + 1 (standard numbering)', () => {
          const tpl = buildDieTemplate(type);
          tpl.faceNormals.forEach((n, i) => {
            const opp = tpl.faceNormals.findIndex((m) => m[0] * n[0] + m[1] * n[1] + m[2] * n[2] < -0.999);
            expect(opp).toBeGreaterThanOrEqual(0);
            expect(tpl.faceValues[i] + tpl.faceValues[opp]).toBe(SIDES[type] + 1);
          });
        });
      }
    });
  }

  describe('d4 (reads the top vertex)', () => {
    it('has 4 vertices numbered 1..4', () => {
      const tpl = buildDieTemplate('d4');
      expect(tpl.vertices).toHaveLength(4);
      expect([...tpl.vertexValues].sort()).toEqual([1, 2, 3, 4]);
    });

    it('reads the correct number for every vertex turned up', () => {
      const tpl = buildDieTemplate('d4');
      tpl.vertices.forEach((v, i) => {
        for (const q of [upright(v, 0), upright(v), tilt(upright(v), 10)]) {
          expect(topVertexIndex(tpl.vertices, q)).toBe(i);
        }
      });
    });

    it('resting on a face, the result is the one vertex not touching the table', () => {
      const tpl = buildDieTemplate('d4');
      tpl.faceNormals.forEach((n) => {
        // Face normal pointing straight down = resting on that face.
        const q = qFromUnitVectors(normalize(n), [0, -1, 0]);
        const top = topVertexIndex(tpl.vertices, q);
        // The three vertices of the resting face share the largest projection on its outward
        // normal; the apex is the one pointing the other way (smallest projection).
        const proj = tpl.vertices.map((v) => v[0] * n[0] + v[1] * n[1] + v[2] * n[2]);
        const apex = proj.indexOf(Math.min(...proj));
        expect(top).toBe(apex);
      });
    });
  });

});

describe('dice maths', () => {
  it('cross-check: rotate() agrees with a hand-computed 90° turn', () => {
    const q = qFromAxisAngle([0, 0, 1], 90 * DEG);
    const v = rotate(q, [1, 0, 0]);
    expect(v[0]).toBeCloseTo(0, 9);
    expect(v[1]).toBeCloseTo(1, 9);
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
  });
});
