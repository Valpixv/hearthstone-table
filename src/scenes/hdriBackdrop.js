import * as THREE from 'three';
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js';
import { loadHDRI } from '../scene/assets.js';
import { buildSet } from './setLoader.js';

/**
 * Photographic 360° backdrop presets around the fixed table. All CC0 Poly Haven HDRIs
 * (public/assets/polyhaven/<id>_2k.hdr, credited in ASSETS.md). Each preset carries its own
 * lighting so the table reads right: `indoor` ones get warm torch-like keys, a smaller ground
 * projection and denser fog.
 */
export const BACKDROPS = {
  castle_cellar: { hdri: 'castle_zavelstein_cellar', label: 'Castle Cellar', indoor: true, ambience: 'dungeon', music: 'eerie', key: '#ffb070', fog: '#1a1410' },
  crypt: { hdri: 'sepulchral_chapel_rotunda', label: 'Crypt Rotunda', indoor: true, ambience: 'dungeon', music: 'eerie', key: '#d8c8a8', fog: '#14141a' },
  castle_ruins: { hdri: 'monkstown_castle', label: 'Castle Ruins', ambience: 'forest', music: 'explore', key: '#fff0d8', fog: '#7a8090' },
  rock_castle: { hdri: 'neurathen_rock_castle', label: 'Cliff Fortress', ambience: 'forest', music: 'explore', key: '#ffb468', fog: '#8a6a58' },
  forest_cave: { hdri: 'forest_cave', label: 'Forest Cave', ambience: 'forest', music: 'explore', key: '#e8f0d0', fog: '#3a4430' },
  mossy_forest: { hdri: 'mossy_forest', label: 'Fey Forest', ambience: 'forest', music: 'explore', key: '#f0ffd8', fog: '#2c3a24' },
  moonrise: { hdri: 'qwantani_moonrise', label: 'Moonrise Plains', ambience: 'forest', music: 'eerie', key: '#a8b8ff', fog: '#202634' },
};

/** Returns a SceneManager scene factory for one preset. */
export function backdropScene(id) {
  const b = BACKDROPS[id];
  return (ctx) => {
    const g = new THREE.Group();
    const scene = {
      name: b.label, group: g, ambience: b.ambience, music: b.music, background: null, environment: null,
      light: {
        hemiSky: '#a0a8c0', hemiGround: '#2a2018', hemiInt: b.indoor ? 0.3 : 0.45,
        keyColor: b.key, keyInt: b.indoor ? 0.9 : 1.1, keyPos: [1.4, 3, 1.0],
        fogColor: b.fog, fogDensity: b.indoor ? 0.05 : 0.025, sky: b.fog,
        backgroundIntensity: b.indoor ? 0.7 : 0.9, environmentIntensity: 0.6,
      },
      update(t) { set?.update(t); },
    };
    // 3D scenery set: ground, props and lights within reach, so the photo is only the sky (src/data/sets.json).
    const set = typeof document !== 'undefined' ? buildSet(g, id) : null;
    scene.set = set;
    if (ctx.renderer) {
      loadHDRI(ctx.renderer, `${b.hdri}_2k`).then(({ background, environment }) => {
        scene.background = background; scene.environment = environment;
        const sky = new GroundedSkybox(background, b.indoor ? 1.6 : 2.2, b.indoor ? 12 : 40);
        sky.position.y = (b.indoor ? 1.6 : 2.2) - 0.01; sky.material.fog = false; sky.renderOrder = -1;
        sky.material.color.setScalar(scene.light.backgroundIntensity);
        g.add(sky);
        ctx.onSceneAssets?.();
      }).catch((e) => console.warn('HDRI failed', b.hdri, e.message));
    }
    return scene;
  };
}
