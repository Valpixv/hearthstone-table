#!/usr/bin/env node
// Open the dev server in replay mode.
//   npm run replay                          -> recordings/hard-throw.json
//   npm run replay -- grab-and-hold         -> recordings/grab-and-hold.json
//   npm run replay -- recordings/captured/x.json --speed 0.5 --seed 7 --loop
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
let file = 'recordings/hard-throw.json';
const opts = { speed: '1', seed: '42', loop: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--speed') opts.speed = args[++i];
  else if (a === '--seed') opts.seed = args[++i];
  else if (a === '--loop') opts.loop = true;
  else if (!a.startsWith('-')) file = a.includes('/') || a.endsWith('.json') ? a : `recordings/${a}.json`;
}
file = file.replace(/\\/g, '/').replace(/^\.\//, '');
if (!existsSync(file)) {
  console.error(`No such recording: ${file}  (generate canned ones with: npm run synth -- --all)`);
  process.exit(1);
}
const query = `?replay=${encodeURIComponent(file)}&speed=${opts.speed}&seed=${opts.seed}${opts.loop ? '&loop=1' : ''}`;
console.log(`Replaying ${file} — opening /${query}`);
const child = spawn('npx', ['vite', '--host', '--open', `/${query}`], { stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
