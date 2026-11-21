import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

// Loads the CC0 Poly Haven assets fetched by tools/fetch-assets.mjs (see ASSETS.md).
const BASE = `${import.meta.env.BASE_URL}assets/polyhaven/`;
const gltfLoader = new GLTFLoader();
const cache = new Map();

export function loadModel(id) {
  if (!cache.has(id)) cache.set(id, gltfLoader.loadAsync(`${BASE}${id}/${id}.gltf`).then((g) => g.scene));
  return cache.get(id);
}

/**
 * Place a copy of a model (or one variant of a multi-object asset set) in `parent`.
 * The copy is re-centred so its footprint centre sits at `pos` with its base on `pos.y`.
 * opts: part (index of a mesh child to use), rotY, scale (number or [x,y,z]), shadow ('cast'|'receive'|'both'|false)
 */
export async function place(parent, id, pos, { part, rotY = 0, scale = 1, shadow = false } = {}) {
  const src = await loadModel(id);
  let obj;
  if (part !== undefined) {
    const meshes = [];
    src.traverse((o) => o.isMesh && meshes.push(o));
    const m = meshes[part % meshes.length];
    obj = new THREE.Mesh(m.geometry, m.material);
  } else obj = src.clone(true);
  const inner = new THREE.Group();
  inner.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
  const wrap = new THREE.Group();
  wrap.add(inner);
  const s = Array.isArray(scale) ? scale : [scale, scale, scale];
  inner.scale.set(...s);
  wrap.position.set(...pos);
  wrap.rotation.y = rotY;
  wrap.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = shadow === 'cast' || shadow === 'both';
    o.receiveShadow = shadow === 'receive' || shadow === 'both';
  });
  parent.add(wrap);
  return wrap;
}

export function loadHDRI(renderer, id) {
  return new HDRLoader().loadAsync(`${BASE}${id}.hdr`).then((tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose();
    return { background: tex, environment: env };
  });
}

export function loadTexture(path, { repeat = 1, srgb = false } = {}) {
  const t = new THREE.TextureLoader().load(`${BASE}${path}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
