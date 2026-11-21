import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { getEntry, makeAnimated } from './ModelLibrary.js';

/**
 * Creature Gallery thumbnails (design/flexibility-plan.md §2): each model is rendered once into a
 * small offscreen canvas and cached as a data URL (memory + localStorage).
 * One lazily-created WebGLRenderer serves every thumbnail; call dispose() to release it.
 */

const LS_PREFIX = 'thumb:v1:';
const memo = new Map(); // cacheKey -> Promise<string>
let renderer = null, scene = null, camera = null;

function ensureRenderer(size) {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(2, 4, 3);
    const fill = new THREE.DirectionalLight(0xc8d4ff, 0.9); fill.position.set(-3, 1.5, 1);
    scene.add(key, fill, new THREE.HemisphereLight(0xffffff, 0x404040, 0.8));
  }
  const s = renderer.getSize(new THREE.Vector2());
  if (s.x !== size || s.y !== size) renderer.setSize(size, size, false);
}

/** Gives the subject its own geometries/materials so disposing them never touches shared GLB data. */
function isolate(obj) {
  obj.traverse((o) => {
    if (!o.isMesh && !o.isSprite && !o.isPoints && !o.isLine) return;
    if (o.geometry) o.geometry = o.geometry.clone();
    if (o.material) o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
  });
}

function disposeSubject(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose?.();
    for (const m of [].concat(o.material ?? [])) m.dispose?.();
  });
  obj.removeFromParent();
}

/** Renders `obj` (already posed) with a 3/4 front camera framed to its bounding box; returns a data URL. */
function renderSubject(obj, size) {
  ensureRenderer(size);
  isolate(obj);
  scene.add(obj);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj, true);
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 1e-3);
  const dist = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.02;
  const dir = new THREE.Vector3(0.65, 0.4, 1).normalize(); // 3/4 front, slightly above
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.near = Math.max(dist - radius * 2, 0.01); camera.far = dist + radius * 2;
  camera.updateProjectionMatrix();
  camera.lookAt(center);
  renderer.render(scene, camera);
  let url;
  try { url = renderer.domElement.toDataURL('image/webp', 0.9); } catch { url = ''; }
  if (!url.startsWith('data:image/webp')) url = renderer.domElement.toDataURL('image/png');
  disposeSubject(obj);
  renderer.renderLists.dispose();
  return url;
}

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* quota / private mode */ } }

/**
 * Thumbnail for a models.json key ("goblin", "heroes.wizard", "props.candle", ...).
 * Posed on the first frame of its idle clip when it has one.
 * @param {string} key
 * @param {{ size?: number }} [opts]
 * @returns {Promise<string>} data URL (webp, or png where webp encoding is unsupported)
 */
export function thumbnail(key, { size = 128 } = {}) {
  const entry = getEntry(key);
  const cacheKey = `${LS_PREFIX}${key}|${entry?.url ?? key}|${size}`;
  if (memo.has(cacheKey)) return memo.get(cacheKey);
  const stored = lsGet(cacheKey);
  const p = stored ? Promise.resolve(stored) : (async () => {
    if (!entry) throw new Error(`Thumbnails: unknown model ${key}`);
    const anim = await makeAnimated(entry); // plays idle (fade 0) when the entry has one
    anim.update(0); // apply the idle clip's first frame
    const url = renderSubject(anim.root, size);
    anim.mixer.stopAllAction();
    anim.mixer.uncacheRoot(anim.mixer.getRoot());
    lsSet(cacheKey, url);
    return url;
  })();
  memo.set(cacheKey, p);
  p.catch(() => memo.delete(cacheKey));
  return p;
}

/**
 * Thumbnail for an already-loaded object (AI Forge GLB or standee group). The object is cloned,
 * never modified. Memory-cached per object; not persisted (Forge objects have no stable URL).
 * @param {THREE.Object3D} object3d
 * @param {{ size?: number }} [opts]
 * @returns {Promise<string>}
 */
const objMemo = new WeakMap(); // object3d -> Map<size, Promise<string>>
export function thumbnailForObject(object3d, { size = 128 } = {}) {
  let bySize = objMemo.get(object3d);
  if (!bySize) objMemo.set(object3d, (bySize = new Map()));
  if (bySize.has(size)) return bySize.get(size);
  const p = Promise.resolve().then(() => {
    const clone = SkeletonUtils.clone(object3d);
    clone.position.set(0, 0, 0); clone.rotation.set(0, 0, 0); clone.visible = true;
    return renderSubject(clone, size);
  });
  bySize.set(size, p);
  p.catch(() => bySize.delete(size));
  return p;
}

const yieldToMain = () => new Promise((r) =>
  (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 200 }) : setTimeout(r, 0)));

/**
 * Renders thumbnails one at a time, yielding to the main thread between each.
 * Failures are logged and skipped. Resolves to a { key: url } map when all are done.
 * @param {string[]} keys
 * @param {(key: string, url: string) => void} [onEach]
 * @param {{ size?: number }} [opts]
 */
export async function thumbnailsFor(keys, onEach, opts = {}) {
  const out = {};
  for (const key of keys) {
    try {
      const url = await thumbnail(key, opts);
      out[key] = url;
      onEach?.(key, url);
    } catch (e) { console.warn('Thumbnails:', key, e); }
    await yieldToMain();
  }
  return out;
}

/** Releases the shared renderer and the in-memory cache (localStorage entries are kept). */
export function dispose() {
  memo.clear();
  if (!renderer) return;
  renderer.dispose();
  renderer.forceContextLoss();
  renderer = null; scene = null; camera = null;
}
