import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// Builds procedural polyhedral dice: flat-shaded faces, one canvas texture per face
// (number drawn at the face centre, or corner numbers for the d4), plus a matching
// cannon-es ConvexPolyhedron. Faces are found by grouping coplanar triangles.

export const DIE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
const COLORS = { d4: '#2e7d32', d6: '#b71c1c', d8: '#1565c0', d10: '#6a1b9a', d12: '#e65100', d20: '#263238' };
const R = 0.022; // ~4.4 cm across – big enough to pinch comfortably in VR

function d10Geometry(r) {
  const h = r * 1.15, z0 = (h * (1 - Math.cos(Math.PI / 5))) / (1 + Math.cos(Math.PI / 5));
  const top = [0, h, 0], bot = [0, -h, 0], ring = [];
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5;
    ring.push([Math.cos(a) * r, i % 2 === 0 ? z0 : -z0, Math.sin(a) * r]);
  }
  const tris = [];
  for (let k = 0; k < 5; k++) {
    const u0 = ring[2 * k], l0 = ring[2 * k + 1], u1 = ring[(2 * k + 2) % 10], lp = ring[(2 * k + 9) % 10];
    tris.push([top, u0, l0], [top, l0, u1]);       // upper kite
    tris.push([bot, l0, u0], [bot, u0, lp]);       // lower kite (shares u0)
  }
  const pos = new Float32Array(tris.flat(2));
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return g;
}

function baseGeometry(type) {
  switch (type) {
    case 'd4': return new THREE.TetrahedronGeometry(R * 1.25);
    case 'd6': return new THREE.BoxGeometry(R * 1.45, R * 1.45, R * 1.45).toNonIndexed();
    case 'd8': return new THREE.OctahedronGeometry(R * 1.05);
    case 'd10': return d10Geometry(R);
    case 'd12': return new THREE.DodecahedronGeometry(R * 1.05);
    case 'd20': return new THREE.IcosahedronGeometry(R * 1.1);
  }
}

const V = (a, i) => new THREE.Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);

function analyse(geom) {
  const pos = geom.attributes.position.array;
  const triCount = pos.length / 9;
  const faces = []; // {normal, tris:[[v0,v1,v2]]}
  for (let t = 0; t < triCount; t++) {
    let a = V(pos, t * 3), b = V(pos, t * 3 + 1), c = V(pos, t * 3 + 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const cen = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    if (n.dot(cen) < 0) { [b, c] = [c, b]; n.negate(); } // force outward winding
    let f = faces.find((f) => f.normal.dot(n) > 0.999);
    if (!f) { f = { normal: n, tris: [] }; faces.push(f); }
    f.tris.push([a, b, c]);
  }
  for (const f of faces) {
    const verts = [];
    f.tris.flat().forEach((v) => { if (!verts.some((u) => u.distanceTo(v) < 1e-6)) verts.push(v); });
    f.verts = verts;
    f.center = verts.reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(1 / verts.length);
    f.u = new THREE.Vector3().subVectors(verts[0], f.center).normalize();
    f.w = new THREE.Vector3().crossVectors(f.normal, f.u);
    f.extent = Math.max(...verts.map((v) => v.distanceTo(f.center)));
  }
  return faces;
}

function faceUV(f, p) {
  const d = new THREE.Vector3().subVectors(p, f.center);
  const s = 0.5 / f.extent;
  return [0.5 + d.dot(f.u) * s, 0.5 + d.dot(f.w) * s];
}

function faceTexture(type, f, value, cornerValues) {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = COLORS[type]; g.fillRect(0, 0, S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S * 0.7);
  grad.addColorStop(0, 'rgba(255,255,255,0.12)'); grad.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  g.fillStyle = '#fff4d6'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 3;
  if (cornerValues) {
    // d4: number by each corner, oriented so its top points to the corner.
    cornerValues.forEach(({ v, p }) => {
      const [u, w] = faceUV(f, p);
      const cx = S / 2 + (u * S - S / 2) * 0.55, cy = S / 2 - (w * S - S / 2) * 0.55;
      const ang = Math.atan2(cx - S / 2, -(cy - S / 2));
      g.save(); g.translate(cx, cy); g.rotate(ang);
      g.font = `bold ${S * 0.22}px Georgia`; g.fillText(String(v), 0, 0); g.restore();
    });
  } else {
    const txt = String(value);
    const size = { d6: 0.5, d8: 0.36, d10: 0.3, d12: 0.34, d20: 0.28 }[type] * S;
    g.font = `bold ${size}px Georgia`;
    g.fillText(txt, S / 2, S / 2 + (type === 'd8' || type === 'd20' ? S * 0.06 : 0));
    if (txt === '6' || txt === '9') g.fillRect(S / 2 - size * 0.25, S / 2 + size * 0.48, size * 0.5, size * 0.07);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

const cache = {};

export function buildDieTemplate(type) {
  if (cache[type]) return cache[type];
  const faces = analyse(baseGeometry(type));
  const sides = Number(type.slice(1));
  // Assign values: opposite faces sum to sides+1 where possible (d6/d8/d12/d20).
  const values = new Array(faces.length).fill(0);
  if (type !== 'd4') {
    let next = 1;
    faces.forEach((f, i) => {
      if (values[i]) return;
      values[i] = next;
      const opp = faces.findIndex((g, j) => !values[j] && g.normal.dot(f.normal) < -0.999);
      if (opp >= 0 && type !== 'd10') values[opp] = sides + 1 - next;
      next++;
      while (values.includes(next) && next <= sides) next++;
    });
    if (type === 'd10') faces.forEach((_, i) => (values[i] = i + 1));
  }
  // d4: vertices carry values; result = top vertex.
  const allVerts = [];
  faces.forEach((f) => f.verts.forEach((v) => { if (!allVerts.some((u) => u.distanceTo(v) < 1e-6)) allVerts.push(v); }));
  const vertValue = (p) => allVerts.findIndex((u) => u.distanceTo(p) < 1e-6) + 1;

  // Build render geometry with per-face material groups and planar UVs.
  const pos = [], nrm = [], uv = [], geom = new THREE.BufferGeometry();
  const mats = [];
  faces.forEach((f, fi) => {
    const start = pos.length / 3;
    f.tris.forEach((tri) => tri.forEach((p) => { pos.push(p.x, p.y, p.z); nrm.push(f.normal.x, f.normal.y, f.normal.z); uv.push(...faceUV(f, p)); }));
    geom.addGroup(start, f.tris.length * 3, fi);
    const corner = type === 'd4' ? f.verts.map((p) => ({ v: vertValue(p), p })) : null;
    mats.push(new THREE.MeshStandardMaterial({ map: faceTexture(type, f, values[fi], corner), roughness: 0.35, metalness: 0.1 }));
  });
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geom.computeBoundingSphere();

  // Convex hull for cannon: unique verts + CCW faces (angle-sorted around the face centre).
  const cv = allVerts.map((v) => new CANNON.Vec3(v.x, v.y, v.z));
  const cf = faces.map((f) => f.verts
    .map((p) => ({ i: allVerts.findIndex((u) => u.distanceTo(p) < 1e-6), a: Math.atan2(new THREE.Vector3().subVectors(p, f.center).dot(f.w), new THREE.Vector3().subVectors(p, f.center).dot(f.u)) }))
    .sort((a, b) => a.a - b.a).map((o) => o.i));

  cache[type] = {
    type, sides, geom, mats,
    shape: () => new CANNON.ConvexPolyhedron({ vertices: cv.map((v) => v.clone()), faces: cf.map((f) => f.slice()) }),
    faceNormals: faces.map((f) => f.normal.toArray()),
    faceValues: values,
    vertices: allVerts.map((v) => v.toArray()),
    vertexValues: allVerts.map((_, i) => i + 1),
    radius: geom.boundingSphere.radius,
  };
  return cache[type];
}
