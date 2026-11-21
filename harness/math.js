// Tiny dependency-free vector / quaternion helpers on plain arrays.
// Vectors are [x, y, z]; quaternions are [x, y, z, w] (same order as WebXR / three.js).
// Kept separate from three.js so the harness runs in plain Node (CLI, Vitest) quickly.

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const normalize = (a) => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const lerpNum = (a, b, t) => a + (b - a) * t;
export const mirrorX = (a) => [-a[0], a[1], a[2]];

export const DEG = Math.PI / 180;

// ---- quaternions -------------------------------------------------------

export const qIdentity = () => [0, 0, 0, 1];

export function qNormalize(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return l > 1e-12 ? [q[0] / l, q[1] / l, q[2] / l, q[3] / l] : [0, 0, 0, 1];
}

export function qMul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function qFromAxisAngle(axis, angle) {
  const n = normalize(axis);
  const s = Math.sin(angle / 2);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(angle / 2)];
}

export function qRotate(q, v) {
  // v' = q * v * q^-1, expanded.
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const ix = qw * vx + qy * vz - qz * vy;
  const iy = qw * vy + qz * vx - qx * vz;
  const iz = qw * vz + qx * vy - qy * vx;
  const iw = -qx * vx - qy * vy - qz * vz;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

export function qConjugate(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** Shortest rotation taking unit vector a onto unit vector b. */
export function qFromUnitVectors(a, b) {
  let r = dot(a, b) + 1;
  let x, y, z;
  if (r < 1e-8) {
    r = 0;
    if (Math.abs(a[0]) > Math.abs(a[2])) [x, y, z] = [-a[1], a[0], 0];
    else [x, y, z] = [0, -a[2], a[1]];
  } else {
    [x, y, z] = cross(a, b);
  }
  return qNormalize([x, y, z, r]);
}

export function qSlerp(a, b, t) {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  if (cos > 0.9995) {
    return qNormalize([
      a[0] + (bx - a[0]) * t,
      a[1] + (by - a[1]) * t,
      a[2] + (bz - a[2]) * t,
      a[3] + (bw - a[3]) * t,
    ]);
  }
  const theta = Math.acos(cos);
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

/** Quaternion from an orthonormal basis given as column vectors x, y, z. */
export function qFromBasis(x, y, z) {
  const m00 = x[0], m10 = x[1], m20 = x[2];
  const m01 = y[0], m11 = y[1], m21 = y[2];
  const m02 = z[0], m12 = z[1], m22 = z[2];
  const trace = m00 + m11 + m22;
  let q;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return qNormalize(q);
}

/** Euler angles in degrees, applied in YXZ order (yaw, then pitch, then roll) — same as three.js 'YXZ'. */
export function qFromEulerDeg([pitch, yaw, roll]) {
  const qy = qFromAxisAngle([0, 1, 0], yaw * DEG);
  const qx = qFromAxisAngle([1, 0, 0], pitch * DEG);
  const qz = qFromAxisAngle([0, 0, 1], roll * DEG);
  return qMul(qMul(qy, qx), qz);
}

export const round = (n, decimals) => {
  const f = 10 ** decimals;
  const r = Math.round(n * f) / f;
  return r === 0 ? 0 : r; // avoid -0 in JSON
};
