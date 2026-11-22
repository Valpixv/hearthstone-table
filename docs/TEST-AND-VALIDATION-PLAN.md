# Hearthstone Table: Test and Validation Plan

Goal: show by April 30, 2027 that a group can run a full D&D session on a real Quest 3.

## 1. How it is tested

| Level | What it checks | Where |
| --- | --- | --- |
| Automated | Rules, sheet, dice, gestures, two-player flows | Laptop and GitHub, every change |
| Hands-on | Every feature done by hand | Laptop, second device, emulated Quest |
| Headset | Frame rate, hand input, comfort | Meta Quest 3 |
| Playtests | Real groups play a full session | 5 sessions with local D&D players |

## 2. Where it stands

| Check | Result |
| --- | --- |
| Unit tests | 435 pass |
| Browser tests | 26 of 26 pass on the laptop; 21 of 26 on GitHub |
| Fresh download from GitHub | Installs, builds and runs; no missing files |
| 60-minute multiplayer soak | 719 rounds, 59 reconnects, no lost seats or rolls |
| Hand-sign test set | 624 of 672 recognised (93%) |
| Emulated Quest 3 | Menus, panels, dice and strikes work |
| Real Quest 3 | Not tested yet |

## 3. Success targets

| # | Target | How it is measured |
| --- | --- | --- |
| 1 | 30-minute Quest 3 session (DM, 3 players, 6 creatures, weather): ≥ 95% of one-second samples at 72 FPS, ≤ 1% frames dropped | Meta OVR Metrics Tool |
| 2 | ≥ 90% of 100+ hand-thrown dice picked up and thrown on the first try | Observer tally |
| 3 | 5 sessions of 45–60 min, ≥ 3 players each | Session log |
| 4 | Fewer than 1 in 10 hand gestures misread on the first try | Observer tally |
| 5 | ≥ 80% player satisfaction with Forge-generated creatures | Questionnaire |
| 6 | In ≥ 3 of 5 sessions, experienced players finish 5 rounds of combat with no instructions | Observer |
| 7 | In ≥ 4 of 5 sessions, players get the code and finish a character sheet in under 15 min with no help | Stopwatch |
| 8 | ≥ 90% of disconnects recover within 30 s without restarting | Session log |

## 4. Playtest session

1. DM hosts; players join with the code and build characters (time it: target 7).
2. DM places a goblin, a wolf and a skeleton plus one Forge creature, and starts combat.
3. Play at least 5 rounds. The observer only helps if someone is stuck over 60 s.
4. Players fill in a short questionnaire (1–5): turn clarity, dice feel, gestures, Forge creatures (target 5).

The observer counts throws (target 2), misread gestures (target 4), help given (target 6) and disconnects (target 8).

## 5. Key hands-on checks

- [ ] Host, join with the code, wrong code is refused, rejoin on a second device
- [ ] Build a character three ways (roll, standard array, Quick build)
- [ ] Throw dice by mouse, webcam and Quest hands; results match the dice
- [ ] Full turn: call, roll, confirm, release; HP changes only when the strike lands
- [ ] All 4 hand signs fire on a confirmed strike; nothing fires when idle or when the hand closes into a fist
- [ ] Palm menu, pinch clicks, fingertip taps, move and close panels
- [ ] Same actions with Quest controllers
- [ ] Place, move and edit creatures; conditions; initiative
- [ ] All 8 scenes, weather, music, fog
- [ ] Voice between two devices; voice comes from the seat
- [ ] Save, reload, load; Wi-Fi drop and reconnect
- [ ] Forge one creature and place it

## 6. Risks and mitigation

| Risk | Mitigation |
| --- | --- |
| Hand tracking is not reliable enough on real hands | Switch the main input to Quest controllers (already supported); keep hands as an option |
| Gestures fire by accident or are missed (fist still fires, practice and combat disagree, frame rate changes results) | Fix cancel and calibration first; tune with recorded hand samples |
| Quest drops below 72 FPS in busy scenes | Profile on the headset; shrink textures and unused animations; fewer creatures |
| Never tested on a real headset | First week with the Quest is a full hardware pass |
| Webcam tracking fails in poor light or the camera is denied | Mouse and on-screen Roll button always work |
| Quest cannot connect (Wi-Fi, certificate warning) | Setup steps in the README and Field Guide; phone hotspot as backup |
| Motion sickness | Seated play only; comfort question after each session |
| AI generation costs money or a provider fails | 24 ready-made creatures need no AI; Tripo rigging still unfinished |
| Not enough playtesters | Recruit from campus D&D groups early; keep spare sessions |
| Laptop runs out of memory running many 3D tests | Run browser tests one at a time |
| GitHub tests unreliable without a graphics card | Run the 5 heavy tests on the laptop before each release |
| Fog of war lost after save and load | Fix before playtests |

## 7. Open defects

| Defect | Fix |
| --- | --- |
| An open hand closed into a fist can still cast | Cancel when the hand shape changes |
| Practice and combat use different calibration | One shared calibration |
| Frame rate changes which flicks register | Measure motion over time, not frames |
| A lost tracking frame resets a sign | Short grace period |
| Fog lost on save and load | Save the fog with the table |
| Two-die throws show no progress | Show "1 of 2" |
| No camera retry mid-session | Input switch on screen |

## 8. Sign-off

| Milestone | Targets | Done |
| --- | --- | --- |
| Gesture fixes | 4 | |
| Headset performance | 1, 2 | |
| Playtests | 3, 5, 6, 7, 8 | |
