#!/usr/bin/env node
// Generate HandRecording files from gesture scripts.
//
//   npm run synth -- --script pinch-spawn        -> recordings/pinch-spawn.json
//   npm run synth -- --all                        -> every script in scripts/index.js
//   npm run synth -- --list
//   npm run synth -- --script hard-throw --encoding plain --out somewhere/
//   npm run synth -- --file path/to/my-gesture.js  (any module whose default export returns a recording)
//
// Default encoding is packed + delta (about 5x smaller than plain JSON); the app and the
// validator read both.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, basename, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SCRIPTS } from './scripts/index.js';
import { encodeRecording, validateRecording } from '../format/recording.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function parseArgs(argv) {
  const args = { scripts: [], files: [], out: resolve(ROOT, 'recordings'), encoding: 'packed', all: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--script' || a === '-s') args.scripts.push(...next().split(','));
    else if (a === '--file' || a === '-f') args.files.push(resolve(next()));
    else if (a === '--out' || a === '-o') args.out = resolve(next());
    else if (a === '--encoding' || a === '-e') args.encoding = next();
    else if (a === '--all') args.all = true;
    else if (a === '--list') args.list = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (!a.startsWith('-')) args.scripts.push(a);
    else throw new Error(`unknown option ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.all && !args.list && !args.scripts.length && !args.files.length)) {
    console.log('usage: npm run synth -- (--script <name>[,<name>] | --all | --file <module.js> | --list) [--out dir] [--encoding packed|plain]');
    console.log(`scripts: ${Object.keys(SCRIPTS).join(', ')}`);
    process.exit(args.help ? 0 : 1);
  }
  if (args.list) {
    for (const [name, load] of Object.entries(SCRIPTS)) console.log(`${name.padEnd(16)} ${(await load()).description ?? ''}`);
    return;
  }
  const jobs = [];
  for (const name of args.all ? Object.keys(SCRIPTS) : args.scripts) {
    if (!SCRIPTS[name]) throw new Error(`no script "${name}" (have: ${Object.keys(SCRIPTS).join(', ')})`);
    jobs.push({ name, load: SCRIPTS[name] });
  }
  for (const file of args.files) jobs.push({ name: basename(file).replace(/\.m?js$/, ''), load: () => import(pathToFileURL(file).href) });

  mkdirSync(args.out, { recursive: true });
  let failed = 0;
  for (const { name, load } of jobs) {
    const mod = await load();
    let rec = mod.default();
    const check = validateRecording(rec);
    if (!check.ok) {
      console.error(`✗ ${name}: generated recording is invalid:\n  ${check.errors.join('\n  ')}`);
      failed++;
      continue;
    }
    if (args.encoding === 'packed') rec = encodeRecording(rec, { decimals: 4, delta: true });
    else if (args.encoding !== 'plain') throw new Error(`--encoding must be packed or plain`);
    const path = resolve(args.out, `${name}.json`);
    const text = JSON.stringify(rec);
    writeFileSync(path, text);
    const notes = rec.meta?.notes?.length ? `  (${rec.meta.notes.join('; ')})` : '';
    console.log(`✓ ${name.padEnd(16)} ${String(rec.frames.length).padStart(4)} frames  ${(text.length / 1024).toFixed(0).padStart(4)} KB  -> ${path}${notes}`);
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
