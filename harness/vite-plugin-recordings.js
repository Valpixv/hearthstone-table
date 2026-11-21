// Dev-server endpoint for HandRecorder: POST /__harness/recordings { name, recording }
// validates the recording and writes it to recordings/captured/<name>.json.
// Only active in `vite dev` (apply: 'serve'); never part of a production build.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateRecording } from './format/recording.js';

export default function handRecordingsPlugin({ dir = 'recordings/captured', maxBytes = 50 * 1024 * 1024 } = {}) {
  return {
    name: 'hearthstone-hand-recordings',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__harness/recordings', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
          size += c.length;
          if (size > maxBytes) req.destroy();
          else chunks.push(c);
        });
        req.on('end', () => {
          const send = (code, obj) => {
            res.statusCode = code;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(obj));
          };
          try {
            const { name, recording } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const check = validateRecording(recording);
            if (!check.ok) return send(400, { error: 'invalid recording', errors: check.errors });
            const safe = String(name || 'capture').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 80);
            const outDir = resolve(server.config.root, dir);
            mkdirSync(outDir, { recursive: true });
            writeFileSync(resolve(outDir, `${safe}.json`), JSON.stringify(recording));
            send(200, { path: `${dir}/${safe}.json` });
          } catch (e) {
            send(400, { error: String(e.message || e) });
          }
        });
      });
    },
  };
}
