// Tunes the battle-gesture thresholds to recorded hands (design/vr-hands-plan.md §5).
//   1. In the headset: menu → Practice → Record samples → Save (writes recordings/gestures/*.json).
//   2. npx vite-node tools/tune-gestures.mjs          (report only)
//      npx vite-node tools/tune-gestures.mjs --write  (also updates src/data/gestures.json)
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CAST_CFG } from '../src/input/castGestures.js';
import { tune } from '../src/input/gestureScore.js';

const DIR = resolve(process.cwd(), 'recordings/gestures'), OUT = resolve(process.cwd(), 'src/data/gestures.json');
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(resolve(DIR, f), 'utf8'))) : [];
if (!files.length) { console.log('No samples in recordings/gestures/. Record some in the headset: menu → Practice → Record samples → Save.'); process.exit(0); }
const { cfg, before, after } = tune(files, CAST_CFG);
const line = (s) => `score ${s.score} · ${s.hits}/${s.wanted} signs caught · ${s.wrong} wrong signs · ${s.idle} fired during ordinary movement`;
console.log(`${files.length} sample file(s)`);
console.log(`before: ${line(before)}`);
console.log(`after:  ${line(after)}`);
for (const [k, v] of Object.entries(after.per)) console.log(`  ${k.padEnd(6)} ${k === 'idle' ? `${v.wrong} false fires` : `${v.hits}/${v.wanted} caught, ${v.wrong} wrong`}`);
const changed = Object.keys(cfg).filter((k) => cfg[k] !== CAST_CFG[k]);
console.log(changed.length ? `changed: ${changed.map((k) => `${k} ${CAST_CFG[k]} → ${cfg[k]}`).join(', ')}` : 'no change: the current tuning is already the best found');
if (process.argv.includes('--write') && changed.length) {
  const cur = JSON.parse(readFileSync(OUT, 'utf8'));
  writeFileSync(OUT, `${JSON.stringify({ ...cur, ...cfg }, null, 2)}\n`);
  console.log('wrote src/data/gestures.json');
}
