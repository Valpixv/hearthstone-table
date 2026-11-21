// Seeded PRNG for the harness (synthetic noise, test fixtures). The app has its own seeded
// random module (src/core/random.js); this one keeps the harness free of app imports.

/** mulberry32: tiny, fast, good-enough 32-bit PRNG. Returns () => float in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sampler (Box–Muller) on top of a uniform PRNG. */
export function gaussian(rand) {
  let spare = null;
  return function normal() {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = rand();
    const v = rand();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };
}
