# Third-party assets and libraries

Everything listed here is free to use, including commercially. Re-download the Poly Haven files with `node tools/fetch-assets.mjs`.

## 3D models, sky and textures: Poly Haven (CC0)

All of these are from [polyhaven.com](https://polyhaven.com), licensed [CC0 1.0](https://polyhaven.com/license) (public domain, no attribution required; credited here anyway). Models are the 1k-texture glTF versions, stored in `public/assets/polyhaven/<id>/`.

| Asset | Used for | Link |
|---|---|---|
| `dark_autumn_forest` (HDRI, 2k) | Sky, ground projection and image-based lighting | https://polyhaven.com/a/dark_autumn_forest |
| `brown_mud_leaves_01` (texture, 1k) | Clearing floor | https://polyhaven.com/a/brown_mud_leaves_01 |
| `WoodenTable_01` | The dice table (two pushed together) | https://polyhaven.com/a/WoodenTable_01 |
| `stone_fire_pit` | Campfire | https://polyhaven.com/a/stone_fire_pit |
| `wooden_stool_01` | Stools around the table | https://polyhaven.com/a/wooden_stool_01 |
| `Lantern_01` | Lantern on the table | https://polyhaven.com/a/Lantern_01 |
| `wicker_basket_01` | Basket on the table | https://polyhaven.com/a/wicker_basket_01 |
| `wooden_barrels_01` | Barrels | https://polyhaven.com/a/wooden_barrels_01 |
| `wooden_crate_01` | Crate | https://polyhaven.com/a/wooden_crate_01 |
| `wooden_bucket_01` | Bucket by the fire | https://polyhaven.com/a/wooden_bucket_01 |
| `tree_stump_01` | Chopping stump | https://polyhaven.com/a/tree_stump_01 |
| `wooden_axe` | Axe in the stump | https://polyhaven.com/a/wooden_axe |
| `dead_tree_trunk` | Log seat behind the fire | https://polyhaven.com/a/dead_tree_trunk |
| `fern_02` | Ferns | https://polyhaven.com/a/fern_02 |
| `shrub_02` | Shrubs | https://polyhaven.com/a/shrub_02 |
| `rock_moss_set_01` | Mossy rocks | https://polyhaven.com/a/rock_moss_set_01 |

## Hands: WebXR Input Profiles

`public/assets/hands/left.glb` and `right.glb` are the `generic-hand` meshes from [immersive-web/webxr-input-profiles](https://github.com/immersive-web/webxr-input-profiles), under the [W3C Software and Document License](https://www.w3.org/Consortium/Legal/copyright-software) (copy in `public/assets/hands/LICENSE.md`).

## Dice: dice-box-threejs (MIT)

`src/vendor/dice-box-threejs/` is the dice factory from [3d-dice/dice-box-threejs](https://github.com/3d-dice/dice-box-threejs), © Frank Ali, MIT (copy in that folder's `LICENSE`). It is vendored rather than installed because the npm package pins three 0.143. Our changes are made only in `src/dice/fancyDice.js`, the adapter around it:
- PBR materials instead of the library's overlay materials.
- Standard numbering, so opposite faces sum to sides + 1.
- Metre-scale sizes that match the app's physics.

## npm libraries

| Library | Licence | Used for |
|---|---|---|
| [three.js](https://github.com/mrdoob/three.js) (incl. GLTFLoader, HDRLoader, GroundedSkybox) | MIT | Rendering |
| [cannon-es](https://github.com/pmndrs/cannon-es) | MIT | Physics |
| [three.quarks](https://github.com/Alchemist0823/three.quarks) | MIT | Fire, embers and smoke particles |
| [postprocessing](https://github.com/pmndrs/postprocessing) | Zlib | Bloom, vignette and tone mapping (desktop only) |
| [@mediapipe/tasks-vision](https://github.com/google-ai-edge/mediapipe) | Apache-2.0 | Webcam hand tracking. Its WASM files and the `hand_landmarker.task` model (Apache-2.0) are copied into `public/assets/mediapipe/` so webcam hands work offline. |
| [Vitest](https://github.com/vitest-dev/vitest), [Playwright](https://github.com/microsoft/playwright) | MIT, Apache-2.0 | Tests |

Procedural content that remains:
- The parchment map, the roll-log board, the dice pouch and the felt tray are still generated in code.
- All audio is still synthesised with WebAudio.
- The older tavern, dungeon and lair scenes are hidden behind `?allScenes=1`.
- The battle mat is one fixed gridded parchment drawn in code (`src/scene/Table.js`).


## Backdrop presets (CC0, Poly Haven HDRIs)

- `castle_zavelstein_cellar_2k.hdr` — https://polyhaven.com/a/castle_zavelstein_cellar (CC0)
- `sepulchral_chapel_rotunda_2k.hdr` — https://polyhaven.com/a/sepulchral_chapel_rotunda (CC0)
- `monkstown_castle_2k.hdr` — https://polyhaven.com/a/monkstown_castle (CC0)
- `neurathen_rock_castle_2k.hdr` — https://polyhaven.com/a/neurathen_rock_castle (CC0)
- `forest_cave_2k.hdr` — https://polyhaven.com/a/forest_cave (CC0)
- `mossy_forest_2k.hdr` — https://polyhaven.com/a/mossy_forest (CC0)
- `qwantani_moonrise_2k.hdr` — https://polyhaven.com/a/qwantani_moonrise (CC0)


## 3D models (public/assets/models/)

All CC0 1.0 (public domain); credit given as courtesy. Textures resized to <=1024 px and re-encoded to WebP with `@gltf-transform/cli optimize`.

- **KayKit Character Pack: Adventurers 1.0** by Kay Lousberg (CC0) — Knight, Mage, Rogue, Rogue_Hooded, Barbarian (heroes; bandit, bandit-captain, cultist). https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
- **KayKit Character Pack: Skeletons 1.0** by Kay Lousberg (CC0) — Skeleton_Warrior, Skeleton_Mage, Skeleton_Rogue (skeleton, wight). https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0
- **KayKit Dungeon Remastered 1.0** by Kay Lousberg (CC0) — candle_lit, candle_triple, chest_gold, coin_stack_large. https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0
- **Quaternius** (CC0), via Poly Pizza:
  - Goblin https://poly.pizza/m/OdCOFSmEhl (goblin, goblin-boss, kobold)
  - Orc https://poly.pizza/m/5vO2YJsPEf (orc, hobgoblin, bugbear)
  - Giant https://poly.pizza/m/BldaiPtyJa (ogre, troll)
  - Zombie https://poly.pizza/m/VlXjG0N8Eg (zombie, ghoul, mummy)
  - Wolf https://poly.pizza/m/P1gU3Qkr9r (wolf, dire-wolf, werewolf)
  - Yeti https://poly.pizza/m/ceRHrn8HHE (owlbear)
  - Demon https://poly.pizza/m/IkB63XOPvr (minotaur)
  - Spider https://poly.pizza/m/yRYJiAJyiM (giant-spider)
  - Rat https://poly.pizza/m/iltq5bVNaV (giant-rat)
  - Dragon https://poly.pizza/m/VBvzjFIYws (young-red-dragon)
  - Book https://poly.pizza/m/h3Wh4fxSQX, Book Open https://poly.pizza/m/JO0bV6osMQ (book, lectern stand-in)

## Scenery sets (CC0, Poly Haven models)

Every photographic backdrop also has real geometry around the table (`src/data/sets.json`, `src/scenes/setLoader.js`), built only from the Poly Haven models listed above. No new assets were added for them.

## Painted fantasy kit (project artwork)

`public/assets/kit/` holds the painted interface art: every emblem, frame, icon, creature portrait, item icon and spell icon, used in the DOM and on the in-world and VR panels. It was generated for this project and sliced from larger painted source sheets, which are kept out of this repository. The `*-sym` images are the same emblems with their painted word ribbon cropped off, for small buttons that carry a live text label.

## Preset creature pictures (project artwork)

`public/assets/kit/creature/`: 512 px renders of the preset creatures, made for this project from the painted kit's creature designs (the full-size sources are kept out of this repository).

## Controller models: WebXR Input Profiles (MIT)

`public/assets/xr-profiles/` holds the Meta Quest Touch controller profiles and models (Touch Plus for Quest 3 / 3S, Touch Pro, Touch v2 / v3, and the generic fallback), copied by `node tools/copy-xr-profiles.mjs` from the npm package [`@webxr-input-profiles/assets`](https://github.com/immersive-web/webxr-input-profiles) (W3C Immersive Web Working Group, MIT). three.js's `XRControllerModelFactory` loads them from this folder, so a headset on the LAN does not need the public CDN.

## Fonts (SIL Open Font License 1.1)

Self-hosted through the [Fontsource](https://fontsource.org) npm packages, bundled by Vite (no request to Google Fonts):

| Font | Package | Used for |
|---|---|---|
| Cinzel | `@fontsource/cinzel` | Headings, buttons |
| Cinzel Decorative | `@fontsource/cinzel-decorative` | Titles, big numbers |
| IM Fell English | `@fontsource/im-fell-english` | Body text |
| JetBrains Mono | `@fontsource/jetbrains-mono` | Codes and dice expressions |

## Rules text: System Reference Document 5.2 (CC BY 4.0)

Class, species, background, feat, item and monster names and numbers in `src/data/classes.json`, `origins.json`, `items.json` and `monsters.json` come from the *System Reference Document 5.2* by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd and licensed under the Creative Commons Attribution 4.0 International License (https://creativecommons.org/licenses/by/4.0/). Feature and trait descriptions are short summaries written for this project. This project is not affiliated with or endorsed by Wizards of the Coast.

## More npm libraries

| Library | Licence | Used for |
|---|---|---|
| [ws](https://github.com/websockets/ws) | MIT | Table sync server (rooms, codes, relays) |
| [qrcode](https://github.com/soldair/node-qrcode) | MIT | Invite QR code |
| [iwer](https://github.com/meta-quest/immersive-web-emulation-runtime), [@iwer/devui](https://github.com/meta-quest/immersive-web-emulation-runtime) | MIT | Meta's emulated Quest for tests and for trying VR without a headset (`?iwer`) |
| [sharp](https://github.com/lovell/sharp) (dev) | Apache-2.0 | Slicing the painted kit |
| [@fal-ai/client](https://github.com/fal-ai/fal-js) | MIT | Optional AI Forge provider |
