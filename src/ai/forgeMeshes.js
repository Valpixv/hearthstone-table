import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Turns AI Forge outputs into scene objects. Every mesh comes back normalised: 1 unit tall,
 * centred on x/z, standing on y = 0, so callers only pick a height.
 */

/** Scales and re-centres `obj` inside a wrapper so it is `height` tall with its base at y = 0. */
export function normalize(obj, height = 1) {
  const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const s = height / Math.max(size.y, 1e-6);
  obj.position.set(-c.x * s, -box.min.y * s, -c.z * s); obj.scale.multiplyScalar(s);
  const wrap = new THREE.Group(); wrap.add(obj);
  wrap.userData.footprint = Math.max(size.x, size.z) * s; // width of its base, for physics
  return wrap;
}

export async function loadModel(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return normalize(gltf.scene, 1);
}

function loadImage(url) {
  return new Promise((ok, bad) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => bad(new Error('image failed to load')); i.src = url; });
}

/**
 * Removes a plain light background by flood-filling from the borders (pure, testable on any
 * RGBA buffer). Returns the bounding box of what is left.
 */
export function cutBackground(data, w, h, tol = 38) {
  const seen = new Uint8Array(w * h), stack = [];
  const bg = [data[0], data[1], data[2]];
  const near = (i) => Math.abs(data[i * 4] - bg[0]) + Math.abs(data[i * 4 + 1] - bg[1]) + Math.abs(data[i * 4 + 2] - bg[2]) < tol * 3;
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop();
    if (seen[i] || !near(i)) continue;
    seen[i] = 1; data[i * 4 + 3] = 0;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1); if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w); if (y < h - 1) stack.push(i + w);
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return x1 < 0 ? { x: 0, y: 0, w, h } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** No 3D provider: a cut-out painted standee, like a cardboard mini. */
export async function makeStandee(url) {
  const img = await loadImage(url), N = 512;
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, N, N);
  const px = g.getImageData(0, 0, N, N), b = cutBackground(px.data, N, N);
  g.putImageData(px, 0, 0);
  const out = document.createElement('canvas'); out.width = b.w; out.height = b.h;
  out.getContext('2d').drawImage(c, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
  const tex = new THREE.CanvasTexture(out); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const aspect = b.w / b.h, root = new THREE.Group();
  const card = new THREE.Mesh(new THREE.PlaneGeometry(aspect, 1), new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 }));
  card.position.y = 0.5; card.castShadow = true; root.add(card); // no added base: the cut-out stands on its own feet
  root.userData.standee = card; // turned to face the viewer each frame
  return normalize(root, 1);
}
