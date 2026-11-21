import { defineConfig, loadEnv } from 'vite';
import aiForge from './server/ai-forge.js';
import tableSync from './server/sync.js';
import gestureSamples from './server/gesture-samples.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { rmSync } from 'node:fs';

/** The painted kit's source sheets (public/assets/fantasy-kit-v1, 99 MB) are sliced into public/assets/kit; only the slices ship. */
// Same for the HQ creature renders (public/assets/creatures-hq-3d, 49 MB): the game uses the 512 px copies in assets/creatures.
const dropKitSources = () => ({ name: 'drop-kit-sources', apply: 'build', closeBundle() { for (const d of ['fantasy-kit-v1', 'creatures-hq-3d', 'ui-style-handoff']) rmSync(resolve(process.cwd(), `dist/assets/${d}`), { recursive: true, force: true }); } });

// Dev-only recordings endpoint from the test harness (apply: 'serve'), loaded only if present.
// Resolved from the project root because Vite bundles this config into a temp folder.
const harnessPlugin = resolve(process.cwd(), 'harness/vite-plugin-recordings.js');
const handRecordings = existsSync(harnessPlugin) ? (await import(pathToFileURL(harnessPlugin).href)).default : null;

// HTTPS is required for WebXR and webcam access on LAN devices (Quest).
// `--mode http` (npm run dev:http) serves plain http for localhost-only testing,
// which is still a secure context. `base: './'` lets dist/ run from GitHub Pages.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [dropKitSources(), tableSync(), gestureSamples(), aiForge({ ...process.env, ...loadEnv(mode, process.cwd(), '') }), ...(mode === 'http' ? [] : [basicSsl()]), ...(handRecordings ? [handRecordings()] : [])],
  // Pre-bundle the packages loaded with import() too. Otherwise Vite discovers them on first use and
  // reloads the page mid-session (it broke the first browser test on every fresh CI runner).
  optimizeDeps: { include: ['iwer', '@iwer/devui', '@mediapipe/tasks-vision'] },
  server: { host: mode === 'http' ? 'localhost' : true, port: 5173 },
  build: { chunkSizeWarningLimit: 2000 },
}));
