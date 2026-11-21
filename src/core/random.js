// Global RNG. Unseeded = Math.random; seeded (e.g. ?seed=42 for replay tests) = mulberry32.
let gen = Math.random;

export function setSeed(seed) {
  if (seed === null || seed === undefined || seed === '') { gen = Math.random; return; }
  let a = Number(seed) >>> 0;
  gen = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const random = () => gen();
export const randRange = (a, b) => a + (b - a) * gen();
export const pick = (arr) => arr[Math.floor(gen() * arr.length)];
