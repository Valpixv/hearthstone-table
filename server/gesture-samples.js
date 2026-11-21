// Dev-only endpoint for the VR Gesture Lab (design/vr-hands-plan.md §5): the headset POSTs recorded hand samples
// and they are saved under recordings/gestures/ for tools/tune-gestures.mjs. Not part of a production build.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const SAMPLES_CFG = { dir: 'recordings/gestures', maxBytes: 40 * 1024 * 1024 };

/** True when a parsed body looks like a Gesture Lab sample file. */
export function validSamples(d) {
  return !!d && d.kind === 'gesture-samples' && Array.isArray(d.segments) && d.segments.length > 0 && d.segments.length <= 40
    && d.segments.every((s) => typeof s.label === 'string' && /^[a-z]{2,12}$/.test(s.label) && Array.isArray(s.frames));
}

export default function gestureSamples({ dir = SAMPLES_CFG.dir, maxBytes = SAMPLES_CFG.maxBytes } = {}) {
  return {
    name: 'gesture-samples', apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/dev/gesture-samples', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        let size = 0; const chunks = [];
        req.on('data', (c) => { size += c.length; if (size > maxBytes) { res.statusCode = 413; res.end(); req.destroy(); } else chunks.push(c); });
        req.on('end', () => {
          if (res.writableEnded) return;
          try {
            const d = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!validSamples(d)) throw new Error('not a sample file');
            const out = resolve(process.cwd(), dir); mkdirSync(out, { recursive: true });
            const name = `samples-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            writeFileSync(resolve(out, name), JSON.stringify(d));
            res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, file: `${dir}/${name}` }));
          } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: e.message })); }
        });
      });
    },
  };
}
