// Writes tests/fixtures/ai/item.glb: a small coloured box, the mock provider's "generated" model.
import { writeFileSync } from 'node:fs';
const p = [], n = [], idx = [];
const faces = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
for (const [ax, s] of faces) {
  const u = (ax + 1) % 3, v = (ax + 2) % 3, base = p.length / 3;
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const q = [0, 0, 0]; q[ax] = s * 0.5; q[u] = a * 0.5; q[v] = b * 0.5; p.push(...q); const m = [0, 0, 0]; m[ax] = s; n.push(...m); }
  idx.push(...(s > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]).map((i) => i + base));
}
const P = Buffer.from(new Float32Array(p).buffer), N = Buffer.from(new Float32Array(n).buffer), I = Buffer.from(new Uint16Array(idx).buffer);
const bin = Buffer.concat([P, N, I, Buffer.alloc((4 - (I.length % 4)) % 4)]);
const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
  materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.6, 0.35, 0.15, 1], metallicFactor: 0, roughnessFactor: 0.8 } }],
  buffers: [{ byteLength: bin.length }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: P.length }, { buffer: 0, byteOffset: P.length, byteLength: N.length }, { buffer: 0, byteOffset: P.length + N.length, byteLength: I.length }],
  accessors: [{ bufferView: 0, componentType: 5126, count: p.length / 3, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
    { bufferView: 1, componentType: 5126, count: n.length / 3, type: 'VEC3' }, { bufferView: 2, componentType: 5123, count: idx.length, type: 'SCALAR' }] };
let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
writeFileSync(new URL('./item.glb', import.meta.url), Buffer.concat([head, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), bin]));
