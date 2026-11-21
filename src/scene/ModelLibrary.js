import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import MODELS from '../data/models.json';

const loader = new GLTFLoader();
const cache = new Map(); // url -> Promise<gltf>

/** Finds a models.json entry by key: "goblin", "monsters.goblin", "heroes.wizard" or "props.candle". */
export function getEntry(key) {
  if (key.includes('.')) { const [g, k] = key.split('.'); return MODELS[g]?.[k] ?? null; }
  return MODELS.monsters[key] ?? MODELS.heroes[key] ?? MODELS.props[key] ?? null;
}

/**
 * Loads a model by models.json key (or a raw URL). Each GLB is fetched once; every call returns
 * a fresh SkeletonUtils clone, so skinned instances animate independently.
 * @returns {Promise<{ scene: THREE.Object3D, animations: THREE.AnimationClip[] }>}
 */
export async function loadModel(key) {
  const url = getEntry(key)?.url ?? key;
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url).catch((e) => { cache.delete(url); throw e; }));
  const gltf = await cache.get(url);
  const scene = SkeletonUtils.clone(gltf.scene);
  scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { scene, animations: gltf.animations };
}

/** Scales obj to `height` and wraps it so its base sits at y=0, centred on x/z (same as forgeMeshes.normalize). */
export function normalizeToHeight(obj, height = 1) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj, true), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const s = height / Math.max(size.y, 1e-6);
  obj.position.set(-c.x * s, -box.min.y * s, -c.z * s); obj.scale.multiplyScalar(s);
  const wrap = new THREE.Group(); wrap.add(obj);
  wrap.userData.footprint = Math.max(size.x, size.z) * s;
  return wrap;
}

/** Multiplies every material colour by `tint` on per-instance material clones (shared GLB materials stay untouched). */
export function applyTint(obj, tint) {
  if (!tint) return;
  const t = new THREE.Color(tint);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
    for (const m of [].concat(o.material)) m.color?.multiply(t);
  });
}

/**
 * Builds an animated instance from a models.json entry (or key).
 * play(name, { loop = true, fade = 0.2 }) accepts a role ("idle" | "attack" | "hit" | "death")
 * or an exact clip name; one-shot clips clamp on their last frame. update(dt) advances the mixer.
 * @returns {Promise<{ root: THREE.Group, mixer: THREE.AnimationMixer, play: Function, update: Function, entry: object }>}
 */
export async function makeAnimated(entryOrKey) {
  const entry = typeof entryOrKey === 'string' ? getEntry(entryOrKey) : entryOrKey;
  if (!entry) throw new Error(`ModelLibrary: unknown model ${entryOrKey}`);
  const { scene, animations } = await loadModel(entry.url);
  applyTint(scene, entry.tint);
  const root = normalizeToHeight(scene, entry.scale ?? 1);
  if (entry.yOffset) root.children[0].position.y += entry.yOffset;
  const mixer = new THREE.AnimationMixer(scene);
  let current = null;
  const play = (name, { loop = true, fade = 0.2 } = {}) => {
    const clipName = entry.clips?.[name] ?? name;
    const clip = THREE.AnimationClip.findByName(animations, clipName);
    if (!clip) { console.warn(`ModelLibrary: no clip ${clipName}`); return null; }
    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    if (current && current !== action) action.crossFadeFrom(current, fade, false);
    action.play();
    current = action;
    return action;
  };
  if (entry.clips?.idle) play('idle', { fade: 0 });
  return { root, mixer, play, update: (dt) => mixer.update(dt), entry };
}

/** A static prop (no mixer) normalised to its entry height, e.g. loadProp('candle'). */
export async function loadProp(key) {
  const entry = getEntry(key.includes('.') ? key : `props.${key}`) ?? getEntry(key);
  const { scene } = await loadModel(entry.url);
  applyTint(scene, entry.tint);
  return normalizeToHeight(scene, entry.scale ?? 1);
}
