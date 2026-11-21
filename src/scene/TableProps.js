import * as THREE from 'three';
import { loadProp } from './ModelLibrary.js';
import { TABLE_TOP, TABLE } from '../physics/Physics.js';
import { LEGACY_LAYOUT } from '../table/layout.js';

// [propKey, x, z, rotY]. DM sits at -z: coins + chest + open book there; candles on the four corners.
// The log board stands at x≈0.42, z≈-0.5, so the DM-end props keep to x < 0.15.
const CX = TABLE.w / 2 - 0.07, CZ = TABLE.d / 2 - 0.07;
const LAYOUT = LEGACY_LAYOUT ? [
  ['chest', -0.66, -0.5, 0.35],
  ['coins', -0.47, -0.52, 0], ['coins', -0.4, -0.44, 1.1],
  ['lectern', -0.12, -0.5, 0],
  ['candleTriple', -CX, -CZ, 0.4], ['candleTriple', CX, -CZ, -0.4],
  ['candle', -CX, CZ, 0], ['candle', CX, CZ, 0],
] : [
  // Centred battle mat: every edge may hold someone's tray, so the dressing keeps to the four corners.
  ['candleTriple', -CX, -CZ, 0.4], ['candleTriple', CX, -CZ, -0.4],
  ['candle', -CX, CZ, 0], ['candle', CX, CZ, 0],
  ['coins', -CX + 0.1, -CZ + 0.02, 0.6],
];

/**
 * Static set dressing on the table top. Geometry/materials are shared ModelLibrary clones, matrices are frozen
 * after placement (no per-frame cost), and only the key light (the scene's single shadow caster) casts their shadows.
 */
export class TableProps {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.group = new THREE.Group(); this.group.name = 'TableProps'; scene.add(this.group);
    this.ready = Promise.all(LAYOUT.map(([key, x, z, ry]) => loadProp(key).then((o) => {
      o.position.set(x, TABLE_TOP, z); o.rotation.y = ry;
      o.updateMatrixWorld(true); o.traverse((c) => { c.matrixAutoUpdate = false; });
      this.group.add(o);
    }).catch((e) => console.warn(`[TableProps] ${key} failed:`, e))));
  }
}
