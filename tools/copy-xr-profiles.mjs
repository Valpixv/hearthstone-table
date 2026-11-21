// Copies the WebXR controller profiles this game needs (Meta Quest Touch controllers and the generic fallback) from
// the @webxr-input-profiles/assets package (W3C Immersive Web Working Group, MIT) into public/assets/xr-profiles/,
// so the real controller models load from our own server: a headset on the LAN has no need for the public CDN.
// Run: node tools/copy-xr-profiles.mjs
import { cpSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve('node_modules/@webxr-input-profiles/assets/dist/profiles');
const OUT = resolve('public/assets/xr-profiles');
/** Quest 3 / 3S ship Touch Plus; the others cover Quest 2, Quest Pro and anything unknown. */
export const PROFILES = ['meta-quest-touch-plus', 'meta-quest-touch-plus-v2', 'meta-quest-touch-pro', 'oculus-touch-v3', 'oculus-touch-v2', 'oculus-touch', 'generic-trigger'];

if (!existsSync(SRC)) throw new Error('Install first: npm i @webxr-input-profiles/assets');
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
cpSync(resolve(SRC, 'profilesList.json'), resolve(OUT, 'profilesList.json'));
for (const p of PROFILES) cpSync(resolve(SRC, p), resolve(OUT, p), { recursive: true });
console.log(`copied ${PROFILES.length} controller profiles → public/assets/xr-profiles`);
