import * as THREE from 'three';
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js';
import { place, loadHDRI, loadTexture } from '../scene/assets.js';
import { CampFire } from '../scene/CampFire.js';
import { TABLE_TOP } from '../physics/Physics.js';
import { rng } from '../scene/util.js';

// Forest-village campfire clearing at dusk. All models, the sky and the ground texture are CC0
// Poly Haven assets (ASSETS.md); fire is three.quarks. The player stands at z ≈ +0.75 facing -z,
// so the fire sits behind the table where it lights the dice and frames the view.

export const FIRE_POS = new THREE.Vector3(0, 0, -2.5);

export function createCampfire(ctx) {
  const g = new THREE.Group();
  const r = rng(7);

  // Ground: mud-and-leaves PBR texture, large enough to disappear into the fog.
  // Radial alpha so the textured clearing floor blends into the sky projected on the ground.
  const fadeCanvas = document.createElement('canvas');
  fadeCanvas.width = fadeCanvas.height = 128;
  const fg = fadeCanvas.getContext('2d');
  const grd = fg.createRadialGradient(64, 64, 20, 64, 64, 64);
  grd.addColorStop(0, '#fff');
  grd.addColorStop(1, '#000');
  fg.fillStyle = grd;
  fg.fillRect(0, 0, 128, 128);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(9, 64),
    new THREE.MeshStandardMaterial({
      map: loadTexture('brown_mud_leaves_01/brown_mud_leaves_01_Diffuse_1k.jpg', { repeat: 24, srgb: true }),
      normalMap: loadTexture('brown_mud_leaves_01/brown_mud_leaves_01_nor_gl_1k.jpg', { repeat: 24 }),
      roughnessMap: loadTexture('brown_mud_leaves_01/brown_mud_leaves_01_Rough_1k.jpg', { repeat: 24 }),
      roughness: 1,
      alphaMap: new THREE.CanvasTexture(fadeCanvas),
      transparent: true,
      depthWrite: false,
    }),
  );
  ground.position.y = 0.002;
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  g.add(ground);

  const fire = new CampFire(g, FIRE_POS.clone().setY(0.08));
  const add = (...a) => place(g, ...a).catch((e) => console.warn('asset failed', a[0], e.message));

  // Fire pit and seating around it.
  add('stone_fire_pit', [FIRE_POS.x, 0, FIRE_POS.z], { scale: 0.85, shadow: 'receive' });
  add('dead_tree_trunk', [0.2, 0, -3.9], { rotY: 0.08, scale: 0.9 });
  add('tree_stump_01', [-2.3, 0, -2.1], { scale: 0.45 });
  add('wooden_axe', [-2.25, 0.22, -2.1], { rotY: 0.6, scale: 0.9 });
  add('wooden_bucket_01', [1.1, 0, -2.0], { rotY: 0.4 });

  // Stools around the dice table.
  for (const [x, z, ry] of [[-0.45, -0.9, 0.2], [0.5, -0.92, -0.3], [1.2, 0.05, 1.2], [-1.2, 0.1, -0.8]]) {
    add('wooden_stool_01', [x, 0, z], { rotY: ry, shadow: 'cast' });
  }

  // Village clutter: barrels, crate, basket and a lantern on the table.
  add('wooden_barrels_01', [3.1, 0, -2.2], { part: 0, rotY: 0.3, scale: 0.8 });
  add('wooden_barrels_01', [3.5, 0, -1.3], { part: 3, rotY: 1.1, scale: 0.8 });
  add('wooden_crate_01', [3.0, 0, -0.2], { rotY: -0.9 });
  add('wicker_basket_01', [-0.62, TABLE_TOP, -0.44], { rotY: 0.25 });
  add('Lantern_01', [-0.3, TABLE_TOP, -0.46], { scale: 1.1 });
  const lanternLight = new THREE.PointLight('#ffb35c', 0.9, 2.5, 2);
  lanternLight.position.set(-0.3, TABLE_TOP + 0.16, -0.46);
  g.add(lanternLight);

  // Edge of the clearing: ferns, shrubs and mossy rocks in a loose ring.
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = 3.6 + r() * 4.5;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (z > 1.2 && Math.abs(x) < 2) continue; // keep the view behind the player clear-ish
    const pick = r();
    if (pick < 0.45) add('fern_02', [x, 0, z], { part: Math.floor(r() * 4), rotY: r() * 6.28, scale: 0.8 + r() * 0.6 });
    else if (pick < 0.75) add('shrub_02', [x, 0, z], { part: Math.floor(r() * 4), rotY: r() * 6.28, scale: 0.6 + r() * 0.5 });
    else add('rock_moss_set_01', [x, 0, z], { part: Math.floor(r() * 6), rotY: r() * 6.28, scale: 0.5 + r() * 0.5 });
  }

  const scene = {
    name: 'Campfire', group: g, ambience: 'forest', music: 'explore',
    background: null, environment: null,
    light: {
      hemiSky: '#5a6a90', hemiGround: '#20160e', hemiInt: 0.25,
      keyColor: '#ff9a4a', keyInt: 1.1, keyPos: [FIRE_POS.x, 1.6, FIRE_POS.z], // "fire" key light casts the table shadows
      fogColor: '#151821', fogDensity: 0.09, sky: '#151821',
      backgroundIntensity: 0.55, environmentIntensity: 0.45,
    },
    update(t, dt) { fire.update(dt); lanternLight.intensity = 0.9 + Math.sin(t * 9) * 0.05; },
  };

  // Photographic dusk-forest sky provides both the backdrop and image-based lighting.
  if (ctx.renderer) {
    loadHDRI(ctx.renderer, 'dark_autumn_forest_2k').then(({ background, environment }) => {
      scene.background = background;
      scene.environment = environment;
      // Project the photographic forest onto the ground so the floor meets the horizon seamlessly.
      const sky = new GroundedSkybox(background, 2.2, 40);
      sky.position.y = 2.2 - 0.01;
      sky.material.fog = false;
      sky.material.color.setScalar(scene.light.backgroundIntensity); // match the dimmed dusk backdrop
      sky.renderOrder = -1;
      g.add(sky);
      ctx.onSceneAssets?.();
    }).catch((e) => console.warn('HDRI failed', e.message));
  }
  return scene;
}
