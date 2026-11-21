import * as THREE from 'three';
import { DiceFactory } from '../vendor/dice-box-threejs/DiceFactory.js';

// Dice models from dice-box-threejs (MIT, github.com/3d-dice/dice-box-threejs): chamfered
// geometry, engraved-style numbering and matching cannon-es hulls. This adapter returns the
// same template shape the app already uses (geom, mats, shape(), faceNormals/faceValues,
// vertices/vertexValues for the d4), so DiceManager, faceUp.js and the tests are unchanged.

/** Circumradius per die in metres (d6 ≈ 3.2 cm across, like before, so recordings still line up). */
const RADIUS = { d4: 0.032, d6: 0.028, d8: 0.027, d10: 0.027, d12: 0.027, d20: 0.027 };

/** Jewel-tone sets that read well by firelight. */
const COLORS = {
  d4: { background: '#1f5c3a', foreground: '#f3e3b5', outline: '#0b1f13' },
  d6: { background: '#7a1418', foreground: '#f6e7c4', outline: '#2a0507' },
  d8: { background: '#173f78', foreground: '#f1e6cc', outline: '#07142a' },
  d10: { background: '#4b1d6b', foreground: '#f3e3c0', outline: '#170824' },
  d12: { background: '#a3501a', foreground: '#fff0d4', outline: '#331503' },
  d20: { background: '#1b1b1f', foreground: '#e8c26a', outline: '#000000' },
};

let factory = null;
const cache = {};

function materialFrom(src) {
  // Swap the library's unlit-ish Phong (and its depthTest:false/transparent flags meant for a
  // 2D overlay) for PBR so the dice pick up the campfire and the sky reflections.
  const m = new THREE.MeshStandardMaterial({
    map: src.map, bumpMap: src.bumpMap ?? null, bumpScale: src.bumpMap ? 0.6 : 0,
    roughness: 0.32, metalness: 0.05, flatShading: true,
  });
  if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
  return m;
}

/** Per numbered face (materialIndex > 0): its outward normal. Groups are single triangles. */
function faceNormalsByMaterial(geom) {
  const normals = geom.getAttribute('normal').array;
  const faces = new Map();
  geom.groups.forEach((g, i) => {
    if (g.materialIndex === 0 || faces.has(g.materialIndex)) return;
    faces.set(g.materialIndex, [normals[i * 9], normals[i * 9 + 1], normals[i * 9 + 2]]);
  });
  return faces;
}

/**
 * The library numbers faces in mesh order, so e.g. its d20 has 1 opposite 15. Relabel so
 * opposite faces sum to sides + 1 like real dice (1↔20, 2↔19 …). Must run before create(),
 * which paints the labels onto the face textures.
 */
function standardNumbering(preset, geom) {
  const faces = [...faceNormalsByMaterial(geom)];
  const sides = faces.length;
  const value = new Map();
  let next = 1;
  for (const [mi, n] of faces) {
    if (value.has(mi)) continue;
    const opp = faces.find(([mj, m]) => !value.has(mj) && mj !== mi && n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < -0.99);
    value.set(mi, next);
    if (opp) value.set(opp[0], sides + 1 - next);
    next++;
    while ([...value.values()].includes(next)) next++;
  }
  for (const [mi, v] of value) {
    preset.labels[mi] = String(v);
    preset.values[mi - 2] = v;
  }
}

export function buildFancyTemplate(type) {
  if (cache[type]) return cache[type];
  factory ??= new DiceFactory({ baseScale: 100, bumpMapping: true });
  const c = COLORS[type];
  factory.applyColorSet({ id: type, ...c, edge: c.background, texture: { name: 'none', composite: 'source-over' } });

  const preset = factory.get(type);
  const r = RADIUS[type];
  factory.geometries[type] = factory.createGeometry(preset.shape, r);
  if (['d6', 'd8', 'd12', 'd20'].includes(preset.shape)) standardNumbering(preset, factory.geometries[type]);
  const mesh = factory.create(type);
  const geom = mesh.geometry;
  const mats = mesh.material.map(materialFrom);

  const faces = faceNormalsByMaterial(geom);
  const valueOf = (materialIndex) => {
    let m = materialIndex - 1;
    if (preset.shape === 'd4') return m;
    if (preset.shape === 'd10') m += 1;
    return preset.values[(m - 1) % preset.values.length];
  };
  const faceNormals = [], faceValues = [];
  for (const [mi, n] of faces) {
    faceNormals.push(n);
    faceValues.push(valueOf(mi));
  }

  const tpl = {
    type, sides: Number(type.slice(1)), geom, mats,
    shape: () => factory.createGeometry(preset.shape, r, true),
    faceNormals, faceValues,
    // d4 shows its result on the face resting on the table; expose those faces as "vertices"
    // pointing the opposite way so the existing top-vertex reader picks the face pointing down.
    vertices: preset.shape === 'd4' ? faceNormals.map((n) => n.map((v) => -v)) : [],
    vertexValues: preset.shape === 'd4' ? faceValues.slice() : [],
    radius: r,
  };
  cache[type] = tpl;
  return tpl;
}
