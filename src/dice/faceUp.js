// Pure settled-face detection (no three.js). q = [x,y,z,w] body quaternion.

export function rotate(q, v) {
  const [qx, qy, qz, qw] = q; const [x, y, z] = v;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

// Index of the face whose world normal points most upward.
export function faceUpIndex(faceNormals, q) {
  let best = -1, bestDot = -Infinity;
  faceNormals.forEach((n, i) => { const d = rotate(q, n)[1]; if (d > bestDot) { bestDot = d; best = i; } });
  return best;
}

// d4: the result is the vertex pointing up.
export function topVertexIndex(vertices, q) {
  let best = -1, bestY = -Infinity;
  vertices.forEach((v, i) => { const y = rotate(q, v)[1]; if (y > bestY) { bestY = y; best = i; } });
  return best;
}

// Settled = slow linear + angular speed for `frames` consecutive frames.
export function isSettled(linSpeed, angSpeed, stillFrames, frames = 18) {
  return linSpeed < 0.03 && angSpeed < 0.15 && stillFrames >= frames;
}
