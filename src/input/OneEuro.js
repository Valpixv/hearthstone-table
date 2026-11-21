// One Euro filter (Casiez et al. 2012): smooths jitter when still, follows quickly when moving.
// Used for hand rays and aim: a fixed lerp either lags on fast motion or still jitters at rest.

/** Scalar One Euro filter. */
export class OneEuro {
  /** @param {{ minCutoff?: number, beta?: number, dCutoff?: number }} [o] minCutoff Hz at rest, beta speed gain */
  constructor({ minCutoff = 1.2, beta = 0.6, dCutoff = 1.0 } = {}) { this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff; this.reset(); }
  reset() { this.x = null; this.dx = 0; }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  /** @param {number} v new sample @param {number} dt seconds since the last sample */
  filter(v, dt) {
    if (this.x == null || !(dt > 0)) { this.x = v; this.dx = 0; return v; }
    const d = (v - this.x) / dt, ad = OneEuro.alpha(this.dCutoff, dt);
    this.dx = this.dx + ad * (d - this.dx);
    const a = OneEuro.alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt);
    this.x = this.x + a * (v - this.x);
    return this.x;
  }
}

/** Filters an [x, y, z] vector component-wise; `unit` renormalises the result (directions). */
export class OneEuroVec3 {
  constructor(opts = {}, unit = false) { this.f = [new OneEuro(opts), new OneEuro(opts), new OneEuro(opts)]; this.unit = unit; }
  reset() { this.f.forEach((f) => f.reset()); }
  filter(v, dt) {
    const o = v.map((x, i) => this.f[i].filter(x, dt));
    if (!this.unit) return o;
    const l = Math.hypot(...o) || 1; return o.map((x) => x / l);
  }
}
