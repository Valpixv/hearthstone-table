// AI Forge: dev/preview-server endpoints that turn a DM prompt into an image, and an approved
// image into a 3D model (GLB). Keys stay on the server (read from .env.local); the browser only
// ever sees local /api/ai/asset/<file> URLs, which also avoids CORS and canvas tainting.
//
// Providers (picked automatically from the keys present, override with AI_IMAGE / AI_MODEL):
//   image: fal (FAL_KEY, FLUX schnell) · pollinations (free, no key) · mock (tests, offline)
//   model: fal (FAL_KEY, TRELLIS) · meshy (MESHY_API_KEY) · standee (no key: the client builds
//          a cut-out cardboard standee from the image) · mock (tests)
import { mkdirSync, writeFileSync, existsSync, createReadStream, copyFileSync } from 'node:fs';
import { resolve, extname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JobQueue } from './ai-jobs.js';

export const CACHE = resolve(process.cwd(), 'ai-cache');
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };

/** Prompt shaping: one isolated creature on a plain background (what image-to-3D needs). The Forge makes creatures only. */
export function shapePrompt(kind, prompt) {
  const p = String(prompt || '').trim().slice(0, 400);
  return `${p}, a single fantasy creature, full body, standing, 3/4 view, centered, isolated on a plain pure white background, painted fantasy art style, no base, no pedestal, no stand, no ground, highly detailed, soft studio lighting, no text, no shadow`;
}

export function pickProviders(env) {
  return {
    image: env.AI_IMAGE || (env.FAL_KEY ? 'fal' : 'pollinations'),
    model: env.AI_MODEL || (env.TRIPO_API_KEY ? 'tripo' : env.FAL_KEY ? 'fal' : env.MESHY_API_KEY ? 'meshy' : 'standee'),
    rig: env.AI_RIG || (env.TRIPO_API_KEY ? 'tripo' : 'none'),
  };
}

// ---------- Tripo (PLACEHOLDER, design/feature-expansion-plan.md §7) ----------
// To link Tripo: implement these two with the Tripo API (image-to-model task, then the rig / animate task),
// download the GLB with download(url, '.glb') and return the shapes below. Until then a TRIPO_API_KEY makes
// jobs fail loudly with this message instead of silently doing nothing.
const TRIPO_TODO = 'Tripo is not linked yet: implement tripoModel()/tripoRig() in server/ai-forge.js';
/** @returns {Promise<{ url: string, provider: 'tripo' }>} */
export async function tripoModel(_env, _file) { throw new Error(TRIPO_TODO); }
/** @returns {Promise<{ url: string, rigged: boolean, clips: Record<string,string>, provider: 'tripo' }>} clips: role → GLB clip name (idle, walk, attack, hit, death) */
export async function tripoRig(_env, _modelUrl) { throw new Error(TRIPO_TODO); }

/** Rigs a generated model (humanoids). Provider 'none' returns it unrigged; the client gives it a procedural idle. */
export async function rigModel(env, { model }) {
  const provider = pickProviders(env).rig;
  if (provider === 'none' || provider === 'mock') return { url: model, rigged: false, clips: {}, provider };
  if (provider === 'tripo') return tripoRig(env, model);
  throw new Error(`unknown rig provider ${provider}`);
}

async function download(url, ext) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const type = r.headers.get('content-type') || '';
  const e = ext || (type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : type.includes('gltf') ? '.glb' : '.jpg');
  const name = randomUUID() + e;
  writeFileSync(resolve(CACHE, name), buf);
  return `/api/ai/asset/${name}`;
}

const localPath = (url) => resolve(CACHE, basename(url));

async function falRun(env, endpoint, input) {
  const { fal } = await import('@fal-ai/client');
  fal.config({ credentials: env.FAL_KEY });
  const { data } = await fal.subscribe(endpoint, { input, logs: false });
  return data;
}

async function falUpload(env, file) {
  const { fal } = await import('@fal-ai/client');
  fal.config({ credentials: env.FAL_KEY });
  const { readFileSync } = await import('node:fs');
  const ext = extname(file).toLowerCase();
  return fal.storage.upload(new Blob([readFileSync(file)], { type: TYPES[ext] || 'image/jpeg' }));
}

export async function generateImage(env, { kind, prompt, seed }) {
  const provider = pickProviders(env).image, full = shapePrompt(kind, prompt);
  const [w, h] = [1024, 1024];
  let url;
  if (provider === 'mock') {
    const name = randomUUID() + '.jpg';
    copyFileSync(resolve(process.cwd(), 'tests/fixtures/ai/item.jpg'), resolve(CACHE, name));
    url = `/api/ai/asset/${name}`;
  } else if (provider === 'fal') {
    const data = await falRun(env, 'fal-ai/flux/schnell', { prompt: full, image_size: { width: w, height: h }, num_images: 1, seed });
    url = await download(data.images[0].url);
  } else {
    const q = new URLSearchParams({ width: w, height: h, nologo: 'true', seed: String(seed ?? Math.floor(Math.random() * 1e9)) });
    url = await download(`https://image.pollinations.ai/prompt/${encodeURIComponent(full)}?${q}`);
  }
  return { url, provider, prompt: full };
}

export async function generateModel(env, { image }) {
  const provider = pickProviders(env).model;
  if (provider === 'standee') return { url: null, provider };
  if (provider === 'mock') {
    const name = randomUUID() + '.glb';
    copyFileSync(resolve(process.cwd(), 'tests/fixtures/ai/item.glb'), resolve(CACHE, name));
    return { url: `/api/ai/asset/${name}`, provider };
  }
  const file = localPath(image);
  if (!existsSync(file)) throw new Error('approved image not found');
  if (provider === 'tripo') return tripoModel(env, file);
  if (provider === 'fal') {
    const image_url = await falUpload(env, file);
    const data = await falRun(env, 'fal-ai/trellis', { image_url, texture_size: 1024, mesh_simplify: 0.95 });
    return { url: await download(data.model_mesh.url, '.glb'), provider };
  }
  if (provider === 'meshy') {
    const { readFileSync } = await import('node:fs');
    const dataUri = `data:${TYPES[extname(file).toLowerCase()] || 'image/jpeg'};base64,${readFileSync(file).toString('base64')}`;
    const auth = { Authorization: `Bearer ${env.MESHY_API_KEY}`, 'Content-Type': 'application/json' };
    const r = await fetch('https://api.meshy.ai/openapi/v1/image-to-3d', { method: 'POST', headers: auth, body: JSON.stringify({ image_url: dataUri, enable_pbr: false, should_texture: true, target_polycount: 20000 }) });
    if (!r.ok) throw new Error(`meshy ${r.status}: ${await r.text()}`);
    const { result: id } = await r.json();
    for (let i = 0; i < 120; i++) { // up to ~6 minutes
      await new Promise((ok) => setTimeout(ok, 3000));
      const t = await (await fetch(`https://api.meshy.ai/openapi/v1/image-to-3d/${id}`, { headers: auth })).json();
      if (t.status === 'SUCCEEDED') return { url: await download(t.model_urls.glb, '.glb'), provider };
      if (t.status === 'FAILED' || t.status === 'CANCELED') throw new Error(`meshy task ${t.status}`);
    }
    throw new Error('meshy timed out');
  }
  throw new Error(`unknown model provider ${provider}`);
}

function readJson(req) {
  return new Promise((ok, bad) => { let s = ''; req.on('data', (c) => { s += c; if (s.length > 1e5) bad(new Error('body too large')); }); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { bad(e); } }); });
}

function middleware(baseEnv) {
  mkdirSync(CACHE, { recursive: true });
  const queues = new Map(); // env flavour (real / mock) → JobQueue
  const queueFor = (env) => {
    const k = env.AI_MODEL === 'mock' ? 'mock' : 'real';
    if (!queues.has(k)) queues.set(k, new JobQueue({ runners: { model: (j) => generateModel(env, { image: j.image }), rig: (j) => rigModel(env, { model: j.model }) },
      persist: (list) => { try { writeFileSync(resolve(CACHE, `jobs-${k}.json`), JSON.stringify(list)); } catch { /* best effort */ } } }));
    return queues.get(k);
  };
  return async (req, res, next) => {
    if (!req.url.startsWith('/api/ai/')) return next();
    // Tests ask for the mock providers per request, so they never depend on keys or the network.
    const env = req.headers['x-ai-mock'] === '1' ? { ...baseEnv, AI_IMAGE: 'mock', AI_MODEL: 'mock', AI_RIG: 'mock' } : baseEnv;
    const send = (code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
    try {
      const path = req.url.split('?')[0];
      if (path === '/api/ai/status') return send(200, { providers: pickProviders(env) });
      if (path.startsWith('/api/ai/jobs/') && req.method === 'GET') { const j = queueFor(env).get(path.slice('/api/ai/jobs/'.length)); return j ? send(200, j) : send(404, { error: 'no such job' }); }
      if (path.startsWith('/api/ai/asset/')) {
        const file = resolve(CACHE, basename(decodeURIComponent(path)));
        if (!existsSync(file)) return send(404, { error: 'not found' });
        res.setHeader('Content-Type', TYPES[extname(file).toLowerCase()] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'max-age=31536000, immutable');
        return createReadStream(file).pipe(res);
      }
      if (req.method !== 'POST') return send(405, { error: 'POST only' });
      const body = await readJson(req);
      if (path === '/api/ai/image') {
        if (body.kind !== 'creature') return send(400, { error: 'The Forge makes creatures only.' });
        if (!String(body.prompt || '').trim()) return send(400, { error: 'prompt required' });
        return send(200, await generateImage(env, body));
      }
      if (path === '/api/ai/model') return send(200, await generateModel(env, body));
      if (path === '/api/ai/jobs') return send(200, queueFor(env).create(body));
      return send(404, { error: 'unknown endpoint' });
    } catch (e) {
      console.error('[ai-forge]', e);
      send(502, { error: e.message });
    }
  };
}

/** Vite plugin: serves the AI Forge API from `vite` (dev) and `vite preview`. */
export default function aiForge(env) {
  return {
    name: 'ai-forge',
    configureServer(server) { server.middlewares.use(middleware(env)); },
    configurePreviewServer(server) { server.middlewares.use(middleware(env)); },
  };
}
