# Hand-tracking test harness

Test grab, throw, pinch, poke and flick interactions **without a VR headset**. Hands are either
generated from code (synthetic) or captured from a real Quest / webcam session, saved as
`HandRecording v1` JSON, and replayed into the real app through the same input path as live
tracking. Vitest checks the pure logic; Playwright replays recordings in headless Chromium and
asserts on the physics outcome.

```
npm run test           # unit + e2e
npm run test:unit      # Vitest, ~3 s
npm run test:e2e       # Playwright, headless Chromium, ~2 min
npm run synth -- --all # regenerate recordings/*.json from harness/synth/scripts
npm run replay -- hard-throw --speed 0.5   # watch a recording in the dev server
```

| Path | What it is |
| --- | --- |
| `harness/format/` | Recording format: joint names, validator, packed/delta encoding, MediaPipe mapper |
| `harness/synth/` | Hand skeleton, gesture/motion primitives, fluent scripting API, noise, CLI |
| `harness/synth/scripts/` | The canned gestures (one file each) + `index.js` registry |
| `recordings/` | Generated recordings (committed); `recordings/captured/` = real captures |
| `src/input/ReplayInputSource.js` | Feeds a recording to `InputManager` like a live source |
| `src/input/GhostHands.js`, `replayControls.js` | Ghost-hand rendering and the replay transport bar |
| `src/input/HandRecorder.js` | Live recorder (R key / VR panel button) |
| `tests/unit/`, `tests/e2e/` | Vitest suites and Playwright replay specs |

---

## 1. The recording format (`HandRecording v1`)

```jsonc
{
  "version": 1,
  "source": "webxr" | "mediapipe" | "synthetic",
  "fps": 72,                        // nominal; every frame carries its own t
  "meta": {                         // optional, free-form
    "name": "hard-throw",
    "setup": { "clearDice": true, "dice": [{ "type": "d20", "pos": [0, 0.80, 0.33] }] }
  },
  "frames": [
    { "t": 0.0, "right": { "wrist": { "p": [x, y, z], "q": [x, y, z, w], "r": 0.02 }, /* …25 joints */ } },
    { "t": 0.013889, "left": { … }, "right": { … } },
    { "t": 0.027778 }               // no hands tracked this frame
  ]
}
```

* **Joints**: the 25 WebXR hand joints (`wrist`, `thumb-metacarpal` … `pinky-finger-tip`, see
  `harness/format/joints.js`), world space, metres. `q` follows WebXR: −Z along the bone toward the
  fingertip, +Y out of the back of the hand. `r` is the joint radius.
* **Frames**: `t` in seconds, strictly increasing. A missing `left`/`right` means tracking lost.
* **`meta.setup`**: scene preparation the app applies before the first tick (dice cleared and
  placed at exact positions, at rest), so scripts can target known positions.
* **On disk** recordings are *packed*: same header plus `encoding: { type: "packed", decimals: 4,
  delta: true, joints, fields }`, each hand a flat array of 200 integers (25 joints ×
  `px py pz qx qy qz qw r` × 10⁴), delta-encoded against that hand's previous frame. About 5×
  smaller than plain JSON. Everything (`parseRecording`, the app, the validator) accepts both
  forms; `decodeRecording()` / `encodeRecording()` convert.
* **Validate** with `validateRecording(obj)` → `{ ok, errors[] }` (checks version, source, fps,
  timestamps, all 25 joints present, finite numbers, unit quaternions, radii, packed array
  shapes). A JSON Schema for documentation lives in `harness/format/hand-recording.schema.json`.
* **MediaPipe**: `mediapipeToWebXR(landmarks21, { handedness, axes, scale, offset })` maps the 21
  landmarks onto the 25 joints; the four finger metacarpals are interpolated 25 % of the way from
  the wrist to each knuckle, rotations are derived from bone directions, radii use Quest
  defaults.

## 2. Writing a synthetic gesture

Create `harness/synth/scripts/my-gesture.js`:

```js
import { hand } from '../hand.js';
import { onTable, above, setupDice, TRAY_CENTER, GRIP_CLEARANCE } from '../scene.js';

export const description = 'Grab a d8 and lob it into the tray with a high arc.';
const DIE = onTable(0.1, 0.32);

export default function build() {
  return hand('right')
    .at([0.06, 1.0, 0.52], { anchor: 'palm' })        // start pose (palm centre at this point)
    .moveTo(above(DIE, 0.15), 0.5)                       // anchor defaults to 'grip'
    .moveTo(above(DIE, GRIP_CLEARANCE), 0.35, { ease: 'outCubic' })
    .grab(0.2)
    .arcThrow(DIE, TRAY_CENTER, 2.2, { arc: 'high' })    // winds up, releases at 2.2 m/s
    .open()
    .record({ name: 'my-gesture', description, setup: setupDice(['d8', DIE]) });
}
```

Register it in `harness/synth/scripts/index.js`, then `npm run synth -- --script my-gesture`
writes `recordings/my-gesture.json`. Watch it with `npm run replay -- my-gesture`.

**Primitives** (all chainable; durations in seconds):

| Gestures | Motion | Other |
| --- | --- | --- |
| `open(d)`, `fist(d)` / `grab(d)` | `at(pos, {anchor, rot})` (teleport) | `wait(d)` / `hold(d)` |
| `pinch(d, {gap})`, `releasePinch(d)` | `moveTo(pos, d, {anchor, ease, pose, rot, lift})` | `hide()` / `show()` (tracking loss) |
| `point(d)`, `curl(k, d)` (0 open … 1 fist) | `moveBy(delta, d, opts)`, `rotateTo(rot, d, {pivot})` | `noise({...})` |
| `pose(nameOrSpec, d)` | `arcThrow(from, to, speed, opts)` | `record({fps, name, setup, …})` |
| | `flick(dir, {distance, duration, ease})`, `poke(target, opts)` | `recordHands([left, right], opts)` |

* **Anchors** say which point of the hand lands on the target: `'grip'` (where the app holds a
  die in a fist — default), `'pinch-grip'` (closed-pinch midpoint), `'pinch'` (current thumb/index
  midpoint), `'palm'`, `'wrist'`, any joint name, or a local `[x,y,z]`.
* **Rotations** are a quaternion `[x,y,z,w]` or Euler degrees `[pitch, yaw, roll]` (YXZ). Identity
  = palm down, fingers pointing −Z (away from the player).
* **Two hands**: build each with `hand('left')` / `hand('right')` and call
  `recordHands([l, r], opts)`; the shorter one holds its last state.
* **Noise** (applied at record time, seeded): `jitter` (m per joint), `drift` (m, slow
  wander), `rotJitter` (deg), `spikeProb`/`spikeSize` (one joint jumps), `dropoutProb`/
  `dropoutFrames` (hand missing), `seed`.
* **Gotchas** learned the hard way: fingertips are physics colliders, so close a fist ≥ 6 cm
  above a die (`GRIP_CLEARANCE`) or the curling fingers knock it away; a fast fingertip moving
  > ~1.5 cm per 1/72 s tick can tunnel into a die (use an accelerating ease for flicks); the app
  grabs with a pinch whenever thumb and index tips are < 2 cm apart, so keep the thumb tucked away
  in point/flick poses.

## 3. Recording real hands on Quest

1. `npm run dev` on your PC; on the Quest browser open `https://<pc-ip>:5173` and accept the
   certificate. Enter VR with hand tracking on.
2. Open the VR panel's **Story** tab → **● Rec hands**. A red light blinks above your wrist.
   Perform the interaction, then **■ Stop rec**.
3. The recording is POSTed to the dev server and saved as
   `recordings/captured/webxr-<timestamp>.json` (packed, validated). Without the dev server
   (e.g. a static build) the browser downloads the file instead.

Desktop/webcam: press **R** to start and stop. Webcam (MediaPipe) recordings get rotations
derived from joint positions automatically.

## 4. Turning a recording into a regression test

1. Move the file into `recordings/` with a descriptive name, e.g.
   `recordings/quest-overhand-throw.json`. If the interaction depends on dice being somewhere
   specific, add a `meta.setup` block (same shape as above) so the replay starts from that
   state — otherwise the replay uses the app's default starter dice (seeded via `?seed=`).
2. Add an entry to `CASES` in `tests/e2e/replays.spec.js`:

   ```js
   'quest-overhand-throw': async ({ start, trace }) => {
     const id = start.dice[0].id;
     expect(firstTick(trace, (s) => dieById(s, id).held)).toBeGreaterThan(0);
     expect(inTray(dieById(trace.at(-1), id).position)).toBe(true);
     expect(trace.at(-1).rollCount).toBeGreaterThan(start.rollCount ?? 0);
   },
   ```

   `trace` has one snapshot per 1/72 s tick: `{ tick, replayFrame, done, dice: [{ id, type,
   position, velocity, held, rolling }], heldObject, lastRoll, rollCount, frame }`. Every case
   also checks the replay finished and the console had zero errors.
3. `npx playwright test -g quest-overhand-throw`. Replays are deterministic (fixed timestep,
   seeded RNG), so a pass stays a pass.

To check it by eye: `npm run replay -- recordings/quest-overhand-throw.json --speed 0.25`
(keys: **K** play/pause, **.** step one tick, **[ / ]** speed, **L** loop). Ghost hands show
exactly what the recording contains.

## 5. Tuning thresholds

The app's gesture thresholds live in `src/input/gestures.js` and `src/input/GrabSystem.js`:

| Constant | Meaning | Test that guards it |
| --- | --- | --- |
| `PINCH_ON` (2 cm) / `PINCH_OFF` (3.5 cm) | thumb–index distance to start / end a pinch | `gestures.test.js › pinch detection` |
| `isFist`: wrist→index tip < 10 cm, middle tip < 9.5 cm, ring tip < 9 cm | fist = grab (pointing is not) | `gestures.test.js › half-curl boundary` |
| grab reach 6 cm (pinch) / 9 cm (fist) | how close the grab point must be to a die | e2e `grab-and-hold`, `pinch-spawn` |
| `averageVelocity(history, 5)`, clamp 4 m/s | throw velocity | `gestures.test.js › throw velocity`, `synth.test.js › arcThrow` |
| `DROPOUT_GRACE` (0.15 s), `TIP_COOLDOWN` (0.2 s) | tracking-loss tolerance, fingertip collider pause after release | e2e `dropout-grab`, `hard-throw` |

Workflow: change a threshold, run `npm run test:unit` (fast boundary tests), then
`npm run test:e2e`. To explore a boundary, sweep it with synthetic hands — e.g.
`hand('right').curl(0.7)` for a partial fist, `pinch(0.2, { gap: 0.018 })` for a near-threshold
pinch, or `noise({ jitter: 0.004, seed })` with a few seeds to see how much tracking error a
threshold survives. Real captures from `recordings/captured/` are the best check that new
thresholds still work for actual hands.
