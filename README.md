# Hearthstone Table

**An open-source, browser-based VR tabletop for Dungeons & Dragons.** A Dungeon Master hosts a table; players join with a six-letter code, build a D&D 2024 character on a desktop (12 classes, 132 preset items, spells and coins), then put on a Meta Quest and sit around one shared table. Players pick up and throw physics dice with their own tracked hands, no controllers needed. Combat follows a clear loop: the DM calls for a roll, the player throws, the DM confirms, and the player releases the attack with one of four hand signs, each paired with one of 32 spell effects. The DM shapes the world live: 24 rigged, animated creatures placed life-size, an AI Forge that turns text into new 3D creatures, initiative, 16 conditions, eight 3D scenes, weather, music and lighting. Floating panels, a palm-activated menu and pinch clicks make the interface native to VR, and each player's voice comes from their seat.

The game supplies the table and the tools. Your group brings the campaign.

| | |
|---|---|
| ![A seated player's view of the table in VR](docs/screenshots/vr-table.jpg) | ![The hand menu in VR](docs/screenshots/vr-menu.jpg) |
| ![The DM's desktop view with the creature gallery](docs/screenshots/dm-desktop.jpg) | ![The character builder](docs/screenshots/character-builder.jpg) |
| ![The DM confirms a rolled result](docs/screenshots/dm-confirm.jpg) | ![The player releases the confirmed strike](docs/screenshots/player-unleash.jpg) |

A 90-second walkthrough for a live demo: [docs/DEMO.md](docs/DEMO.md).

## Run it

```bash
npm install
```

```bash
npm run dev
```

- **Laptop / desktop:** open the `https://localhost:5173` URL Vite prints and accept the self-signed certificate. `npm run dev:http` serves plain `http://localhost:5174` for testing on one machine.
- **Meta Quest (3, 3S, 2, Pro):** put the headset on the same Wi-Fi, open the **Network** URL Vite prints (`https://192.168.x.x:5173`) in the Quest Browser, accept the certificate warning, and turn on hand tracking in the headset settings (controllers work too).
- **HTTPS is required** on other devices for VR, the microphone and the webcam. The default `npm run dev` provides it.
- **Production build:** `npm run build` writes `dist/`. Multiplayer and the AI Forge need the server (`npm run dev` or `npm run preview`), not a static host.

## A session, start to finish

1. **The DM hosts.** Home screen → **Host table**. The DM gets a 6-character table code, a link and a QR code (dock → Table tab).
2. **Players join on a desktop.** Enter the table code and a name. To throw dice with a laptop camera, check **Use webcam hands** before clicking **Join table**, then allow camera access.
3. **Stage 1: character sheets.** Each player builds a character: class (all 12), species, background, ability scores (rolled 4d6-drop-lowest, standard array or point buy), skills, hit points, details and four hand-sign spells. *Quick build* fills in a complete level 1 character. The full sheet follows the D&D 2024 character sheet block for block. Press **I'm ready**.
4. **The DM begins.** The Table tab lists everyone, how complete their sheet is and who is ready. **Begin the adventure** moves the table to stage 2.
5. **Stage 2: headsets.** Each player sees "put on your headset": *Enter VR* on a tethered headset, or, on a standalone Quest, open the same address, choose *Join table*, and type the table code plus the 4-digit **rejoin number** shown on their desktop. Their character and seat follow them. Staying on desktop works too.
6. **Play.** Everyone sits at their own seat with their own dice tray, character card and satchel. Voices come from each person's seat.

**Test mode** (home screen → *Test mode*) skips the code and the character stage: pick Player or DM and Desktop, Webcam hands or VR. Everyone in test mode on one server shares a table, so one machine with two browser tabs is enough to try everything.

## How a turn works

The DM decides; the app never enforces a rule it was not asked to.

1. **The DM calls for a roll** (*Call for a roll*, top of the DM's screen, or the Combat panel in VR): attack, saving throw, ability check, damage, initiative or anything else, for one player or several, with an optional DC, advantage or disadvantage, and a target.
2. **The player rolls.** A prompt shows what is wanted; throwing dice by hand answers it (the sheet's modifier is added), or the Roll button does.
3. **The DM confirms.** With *Rules assist* on, the card shows hit or miss against AC, success or failure against the DC, crits and fumbles. For damage the DM picks the target and amount (½ and ×2 for resistance and vulnerability; the sheet's listed resistances are suggested).
4. **The player makes their hand sign.** The target glows; one of the player's four gestures, aimed roughly at it, releases the strike. The effect flies, and the damage lands on impact, for everyone at once. On desktop: the *Unleash* button, Enter, or the spell bar.

Nothing changes anyone's hit points before step 4. The DM can also type HP directly (`-7`, `+3`, `=25`, `+5 temp`), release or cancel a strike, and switch gesture release off entirely.

## Controls

**In the headset (hands or controllers)**

| Do this | To |
|---|---|
| Pinch or make a fist near a die or mini (controller: grip) | Pick it up; let go to throw |
| Pinch inside the leather pouch | Pull out a fresh d20 |
| **Look at your left palm** for a moment (controller: menu button) | The hand menu appears beside your hand; pinch its title to float it |
| Point (the Quest's own hand ray) and pinch, then let go (controller: trigger) | Click: it acts when you let go, on what the pinch started on |
| Tap a button with your index fingertip | Click (the button glows as your finger comes near) |
| Pinch and drag inside a list, or slide a touching finger (controller: thumbstick) | Scroll |
| Pinch and hold a creature row | Open the creature editor |
| Pinch a panel's title bar and move | Drag the panel; pull it down past the table edge to close it (or tap its X; controller: B / Y) |
| Touch your character card or satchel on the table | Open Character or Bag |
| With a confirmed strike: point at the glowing target, hold a sign, then do its move | Release it: *Point & flick*, *Finger gun* (drop the thumb), *Open palm push*, *Slash* (flat hand, swipe edge-first) |
| Menu → **Practice** | Practise the signs with live feedback; record samples to tune them to your hands |
| DM: point at a life-size creature and pinch | Drag it across the floor; twist your wrist (or thumbstick) to turn it |
| DM: pinch a creature in the Creatures panel and pull it out | Place it life-size on the floor, or mini-only on the map |

Panels: Dice · Character · Bag · Spells · Voice · Handouts · Practice, and for the DM also Creatures · Combat (initiative order, reorder, edit) · Requests · World · Table · Forge · Tools (grid, ruler, area templates on the map) · Edit creature (HP, AC, speed, abilities, conditions).

Hand signs only listen while the DM has confirmed a strike for you, so moving your hands around never fires anything. Free casting (an effect with no strike) is opt-in: *Gestures on* on the spell bar or the Spells panel.

**Desktop**

| Input | Action |
|---|---|
| Left-drag a die or mini | Pick up and fling |
| Click a die / the pouch | Toss it / new d20 |
| `Space`, `1`–`6`, `C` | Roll every die, spawn d4–d20 (players), clear |
| `K` | Character sheet |
| `Shift+1…4`, then click | Cast a hand-sign spell (or release a confirmed strike) |
| `Enter` | Unleash a confirmed strike |
| `V` | Hold to talk (push-to-talk) |
| Arrows / WASD, right-drag, wheel | Turn and zoom |
| DM: `M`, `1`–`6` | Dock, and its tabs: Table · Creatures · Dice · World · Forge · Tools |
| DM: `F` | Paint the fog of war away |
| DM: drag a gallery tile onto the room | Place a creature life-size (onto the map: mini only) |
| DM: drag a life-size creature, wheel while dragging | Move it, turn it |
| `?` | All shortcuts |

## What the DM has

- **Table:** invite code and QR, the stage roster, player requests (players can ask for almost any DM action; the DM approves, edits or denies), rules switches, experience awards, party loot split, handouts to chosen players, saved setups, save / load.
- **Creatures:** one gallery (24 SRD templates, blank models, your saved creatures, forged creatures), an editor where every number is typeable, the token list with health bars and conditions, the initiative tracker, formations (line, arc, surround, scatter).
- **Dice:** any pool, any modifier, keep highest / lowest, secret rolls, saved rolls, history.
- **World:** eight backdrops with real props around the table, time of day, mood, weather, music, sound effects, narration, fog of war. The battle mat itself never changes.
- **Forge:** describe a creature, approve the picture, get a model (see below).
- **Tools:** grid snap, ruler, area-of-effect templates.

Rules switches (Table tab; defaults in `src/data/tableDefaults.json`): Rules assist, damage needs the attacker's gesture, monsters strike at once, minis and bodies move together, only the DM moves enemy minis, players see the DC.

## AI Forge (creatures only)

The Forge makes **creatures**: describe one, approve the picture, and it becomes a mini on the map and a life-size body in the room. It does not make items, props, icons or backdrops.

Providers are chosen on the server (`server/ai-forge.js`) from keys in `.env.local`:

| Key | Images | 3D |
|---|---|---|
| none | Pollinations (may refuse without an account) | cut-out painted standee |
| `FAL_KEY` | FLUX schnell | TRELLIS image-to-3D (GLB) |
| `MESHY_API_KEY` | – | Meshy image-to-3D (GLB) |
| `TRIPO_API_KEY` | – | reserved: `tripoModel()` / `tripoRig()` in `server/ai-forge.js` are stubs to fill in |

Without a key everything else works: the 24 templates and the model gallery need no AI.

## Voice chat

Click **Mic** (or the Voice panel in VR). Everyone is connected directly to everyone else (WebRTC), so it works on the same network with no extra server. Each voice comes from that person's seat; the DM can switch to an even "narrator" voice, and can mute a player. Push-to-talk is optional (`V`).

## VR without a headset

Add `?iwer` to the URL to load Meta's Immersive Web Emulation Runtime (an emulated Quest 3 with hand tracking and Meta's DevUI). `?iwer=controller` emulates controllers.

## Tests

```bash
npm run test:unit
```

```bash
npm run test:e2e
```

Set `E2E_GPU=1` to run the browser tests on the graphics card (much faster on a laptop). Unit tests (Vitest) cover the rules, the sheet, the builder, rooms and codes, the action loop, the arena and the helpers. End-to-end tests (Playwright, headless Chromium with software WebGL; slow) cover: host → join → build → begin → call → roll → confirm → release in two browsers; rejoining from a second device; the DM's critical path; the sheet; the Forge; the headset interface on the emulated Quest; every hand sign through the real gesture pipeline with synthetic hands; and voice between two browsers with fake microphones. Recorded-hand replays are described in [harness/README.md](harness/README.md).

## Tech

Vite, vanilla JS modules, three.js with WebXR (hands and controllers), cannon-es physics, MediaPipe for webcam hands, WebRTC for voice, a WebSocket room server inside the Vite dev/preview server, WebAudio for sound.

```
server/   sync.js (rooms, codes, rejoin, relays) · ai-forge.js · ai-jobs.js
src/
  table/   layout (seats, trays) · arena (where creatures stand) · Tactics (grid, ruler, templates) · SpeedRing
  party/   sheet (2024 sheet model) · CharacterSheet · SheetBuilder (stage 1) · bagActions
  combat/  strikes (call → roll → confirm → release) · StrikeFlow · CombatManager · CombatView
  net/     TableSync · Requests · Avatars (remote heads and hands) · Voice
  ui/      kit (painted art) · DMDock + panels · DiceTray · CallCards · Handouts · vr/ (XRPointer, VRUI)
  input/   InputManager · GrabSystem · gestures · castGestures · Caster · XR / webcam / mouse sources
  scene/   Table · SceneManager · LifeDrag · SeatProps · …      scenes/  campfire · hdriBackdrop · setLoader
  data/    classes · origins · items · effects · monsters · models · sets · tableDefaults · kit
```

## Credits and licence

The code is released under the [MIT licence](LICENSE). Models, skies, textures, controller profiles and fonts come from free open-source projects (CC0, MIT, OFL and W3C licences) and keep their own licences; every source is credited in [ASSETS.md](ASSETS.md). The painted interface art and creature portraits were generated for this project.
