export const EASINGS = {
  linear: (u) => u,
  inQuad: (u) => u * u,
  outQuad: (u) => 1 - (1 - u) * (1 - u),
  inOutQuad: (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2),
  inCubic: (u) => u * u * u,
  outCubic: (u) => 1 - (1 - u) ** 3,
  inOutCubic: (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2),
  inOutSine: (u) => -(Math.cos(Math.PI * u) - 1) / 2,
};

export function ease(name) {
  if (typeof name === 'function') return name;
  const f = EASINGS[name];
  if (!f) throw new Error(`unknown easing "${name}" (have: ${Object.keys(EASINGS).join(', ')})`);
  return f;
}
