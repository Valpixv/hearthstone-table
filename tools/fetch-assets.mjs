#!/usr/bin/env node
// Downloads the CC0 Poly Haven assets used by the campfire scene into public/assets/polyhaven/.
// Re-run safely: existing files are skipped. Credits/licences: ASSETS.md.
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve('public/assets/polyhaven');
export const MODELS = [
  'stone_fire_pit', 'WoodenTable_01', 'wooden_stool_01', 'Lantern_01', 'wooden_crate_01',
  'wicker_basket_01', 'wooden_axe', 'tree_stump_01', 'wooden_bucket_01', 'dead_tree_trunk',
  'rock_moss_set_01', 'fern_02', 'shrub_02', 'wooden_barrels_01',
];
const HDRI = { id: 'dark_autumn_forest', res: '2k' };
const TEXTURES = [{ id: 'brown_mud_leaves_01', res: '1k', maps: ['Diffuse', 'nor_gl', 'Rough'] }];

async function get(url, path) {
  if (existsSync(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
}
const files = async (id) => (await fetch(`https://api.polyhaven.com/files/${id}`)).json();

for (const id of MODELS) {
  const g = (await files(id)).gltf['1k'].gltf;
  await get(g.url, `${OUT}/${id}/${id}.gltf`);
  for (const [rel, f] of Object.entries(g.include)) await get(f.url, `${OUT}/${id}/${rel}`);
  console.log('model', id);
}
const h = (await files(HDRI.id)).hdri[HDRI.res].hdr;
await get(h.url, `${OUT}/${HDRI.id}_${HDRI.res}.hdr`);
console.log('hdri', HDRI.id);
for (const t of TEXTURES) {
  const f = await files(t.id);
  for (const m of t.maps) {
    const e = f[m][t.res].jpg;
    await get(e.url, `${OUT}/${t.id}/${t.id}_${m}_${t.res}.jpg`);
  }
  console.log('texture', t.id);
}
