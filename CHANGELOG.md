# Changelog

What has changed in Hearthstone Table, newest first.

## Documentation and release checks
- Added the illustrated Play & Test Field Guide (PDF, 21 pages).
- Rewrote the README for sponsors: quick start, screenshot tour, controls, Quest setup, troubleshooting.
- Removed the MIT licence: all rights reserved; third-party credits kept in ASSETS.md.
- Removed the demo script (replaced by the Field Guide).

## Fixes found by testing a fresh download
- No more page reload in the middle of a session the first time a server runs.
- A wrong table code now shows its error straight away.
- Browser tests made stable: one at a time, split across machines, no hang when closing, voice can connect on test machines.

## Play and interface
- Dungeon Master window can expand to full screen.
- New painted coins (copper, silver, electrum, gold, platinum) and microphone icons.
- Removed doubled, blurry captions under icons everywhere.
- Unleash button no longer hidden behind the dice tray.
- Painted UI reskin across desktop and VR panels.

## VR and hands
- Quest hand tracking with the system hand ray, pinch-to-click and fingertip taps.
- Palm-activated hand menu; floating panels you can drag, scroll and toss away.
- Four hand signs (point and flick, finger gun, palm push, slash) tied to 32 spell effects.
- Practice mode with live feedback and calibration.
- Webcam hand tracking on laptops (MediaPipe).
- Meta's emulated Quest (`?iwer`) for testing without a headset.

## Core game
- Host a table and join with a six-letter code or QR; rejoin on another device with a 4-digit number.
- D&D 2024 character builder: 12 classes, 132 items, spells, coins, Quick build.
- Physical dice thrown by hand, mouse or controller.
- Turn flow: DM calls a roll, player throws, DM confirms, player releases the strike.
- DM tools: 24 animated life-size creatures, editor, 16 conditions, initiative, requests, handouts, save and load.
- 8 3D scenes, weather, music, sound effects, narration and fog of war.
- Voice chat from each seat.
- AI Forge: describe a creature, approve the picture, get a 3D model.
