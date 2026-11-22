import * as THREE from 'three';
import '@fontsource/cinzel/500.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/cinzel-decorative/700.css';
import '@fontsource/cinzel-decorative/900.css';
import '@fontsource/im-fell-english/400.css';
import '@fontsource/im-fell-english/400-italic.css';
import '@fontsource/jetbrains-mono/500.css';
import './style.css';
import './ui/kit.css';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { setSeed } from './core/random.js';
import { audio } from './audio/AudioEngine.js';
import { Physics, TABLE_TOP, DICE_POUCH, TRAY, trayPoint } from './physics/Physics.js';
import { seatLayout, LEGACY_LAYOUT } from './table/layout.js';
import { Table } from './scene/Table.js';
import { SceneManager } from './scene/SceneManager.js';
import { Effects } from './scene/Effects.js';
import { DiceManager } from './dice/DiceManager.js';
import { DIE_TYPES } from './dice/DiceFactory.js';
import { InputManager } from './input/InputManager.js';
import { GrabSystem } from './input/GrabSystem.js';
import { MouseInput, DesktopCamera } from './input/MouseInput.js';
import { XRHandSource } from './input/XRHandSource.js';
import { WebcamHandSource } from './input/WebcamHandSource.js';
import { Weather } from './dm/Weather.js';
import { DMController } from './dm/DMController.js';
import { DMDock } from './ui/DMDock.js';
import { DiceTray } from './ui/DiceTray.js';
import { installActions } from './ui/actions.js';
import { kitIcon } from './ui/kit.js';
import { AIForge } from './ai/AIForge.js';
import { CombatManager } from './combat/CombatManager.js';
import { CombatView } from './combat/CombatView.js';
import { RollService } from './rules/RollService.js';
import { Tactics } from './table/Tactics.js';
import { TableProps } from './scene/TableProps.js';
import { Cinematic } from './fx/Cinematic.js';
import { TableSync, lastSession, clearSession } from './net/TableSync.js';
import { InitiativeBanners } from './scene/InitiativeBanners.js';
import { CharacterSheet } from './party/CharacterSheet.js';
import { SheetBuilder } from './party/SheetBuilder.js';
import { SpellFx } from './fx/SpellFx.js';
import { Caster } from './input/Caster.js';
import { StrikeFlow } from './combat/StrikeFlow.js';
import { CallCards } from './ui/CallCards.js';
import { LifeDrag } from './scene/LifeDrag.js';
import { Avatars } from './net/Avatars.js';
import { Voice } from './net/Voice.js';
import { VRUI } from './ui/vr/VRUI.js';
import { SeatProps } from './scene/SeatProps.js';
import { Handouts } from './ui/Handouts.js';
import { SpeedRing } from './table/SpeedRing.js';
import DEFAULTS from './data/tableDefaults.json';

const params = new URLSearchParams(location.search);
const REPLAY = params.get('replay');
const REPLAY_DT = 1 / 72;
setSeed(params.get('seed'));

// IWER (Meta's Immersive Web Emulation Runtime): `?iwer` emulates a Quest 3 with hand tracking
// in any desktop browser, with Meta's DevUI to drive the head and hands. Loaded only when asked.
if (params.has('iwer')) {
  const [{ XRDevice, metaQuest3 }, { DevUI }] = await Promise.all([import('iwer'), import('@iwer/devui')]);
  const xrDevice = new XRDevice(metaQuest3);
  xrDevice.installRuntime({ forceInstall: true });
  xrDevice.primaryInputMode = params.get('iwer') === 'controller' ? 'controller' : 'hand';
  // installDevUI (not `new DevUI`) so IWER mounts the panel inside its session overlay; otherwise the controls sit
  // under the canvas and the emulated view looks frozen.
  if (!params.has('nodevui')) xrDevice.installDevUI(DevUI);
  window.__iwer = xrDevice;
}

// ---------- Renderer / scene / camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.localClippingEnabled = true; // the speed ring is clipped to the battle mat
renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor');
// Quest: fixed foveated rendering keeps the frame rate up at no visible cost in the centre of view.
renderer.xr.setFoveation?.(1);
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.02, 120);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
// Desktop-only post-processing (pmndrs/postprocessing): bloom on the fire, filmic tone mapping,
// a soft vignette. WebXR renders straight to the headset without it.
const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new EffectPass(camera,
  new BloomEffect({ intensity: 1.1, luminanceThreshold: 0.75, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.7 }),
  new VignetteEffect({ offset: 0.3, darkness: 0.55 }),
  new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })));
addEventListener('resize', () => { if (renderer.xr.isPresenting) return; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); });

// ---------- Systems ----------
const $ = (id) => document.getElementById(id);
const ctx = { torchMul: 1, renderer, onSceneAssets: () => sceneMgr.applyLighting() };
const physics = new Physics(REPLAY ? { fixedStep: REPLAY_DT, deterministic: true } : {});
const table = new Table(scene);
const sceneMgr = new SceneManager({ scene, renderer, camera, audio, ctx });
const effects = new Effects(scene);
const grab = new GrabSystem();
const weather = new Weather(scene);
let dm;
let rolls;
const dice = new DiceManager({ scene, physics, effects, audio, grab, onResult: (r) => { if (rolls?.consume(r)) { hudLog(r); return; } dm.onRoll(r); hudLog(r); } });
dm = new DMController({ scene, sceneMgr, dice, table, weather, audio, grab, physics, effects });
dm.state.settings = { ...DEFAULTS.settings, ...dm.state.settings };
dm.state.session = { stage: 'play', ready: {} }; dm.state.calls = []; dm.state.strikes = [];
const input = new InputManager({ scene, physics });
const mouse = new MouseInput({ dom: renderer.domElement, camera, grab });
const deskCam = new DesktopCamera(camera, renderer.domElement);
const cinematic = new Cinematic({ scene, camera, effects, audio });
dm.cinematic = cinematic;
const combat = new CombatManager({ dm, cinematic });
const combatView = new CombatView({ scene, mgr: combat });
rolls = new RollService({ dice, effects, dm, cinematic });
const forge = new AIForge({ dm, scene, physics, grab, sceneMgr, renderer });
const tactics = new Tactics({ scene, grab, mouse, table });
dm.tactics = tactics;
if (!REPLAY && dm.state.settings.gridSnap) tactics.setGrid(true); // classic play: minis snap to the 5 ft squares
// Minis snap to the 5 ft grid when released (when grid snap is on).
const addGrab = grab.add.bind(grab);
grab.add = (it) => { if (it.kind === 'mini') { const prev = it.onRelease; it.onRelease = (sp) => { prev?.(sp); tactics.snap(it); }; } addGrab(it); };
installActions(dm); // local dm.act fallback until src/net/Requests.js installs the real one
const whoAmI = () => (dm.isDM ? 'DM' : myToken()?.name || $('player-name').value.trim() || 'Player');
const tray = new DiceTray({ dm, rolls, who: whoAmI });
const panel = new DMDock({ dm, audio, rolls, tray });
rolls.onLooseRoll = (r) => tray.showRoll(r, { label: 'Hand-thrown' }); // dice thrown by hand within ~2 s = one roll
new InitiativeBanners({ scene, dm });
new TableProps(scene); // candles and coins on the corners
const tableSync = new TableSync({ dm, combat, forge, rolls, grab, table, cinematic, effects, scene, audio, dice });
window.__tableSync = tableSync;
const myToken = () => { const id = tableSync.me?.id; return id ? (dm.state.tokens || []).find((t) => t.kind === 'pc' && t.owner === id) || null : null; };
// Gesture spells, the action loop and the character sheet (design/completion-plan.md §4, §7).
const spellFx = new SpellFx({ scene, audio });
const caster = new Caster({ dm, sync: tableSync, spellFx, scene, camera, grab, dom: renderer.domElement, effects });
const strikes = new StrikeFlow({ dm, sync: tableSync, spellFx, cinematic, effects });
const calls = new CallCards({ dm, sync: tableSync, tray });
const charSheet = new CharacterSheet({ dm, sync: tableSync, caster, tray });
panel.ui.sheet = charSheet; panel.ui.calls = calls; panel.ui.sync = tableSync;
const lifeDrag = new LifeDrag({ dm, mouse, camera, dom: renderer.domElement, sync: tableSync, scene });
window.__lifeDrag = lifeDrag; panel.ui.lifeDrag = lifeDrag; dm.lifeDrag = lifeDrag;
// Seeing and hearing each other (design/completion-plan.md §6).
const avatars = new Avatars({ scene, sync: tableSync, dm, camera, renderer, input });
const voice = new Voice({ sync: tableSync, camera, avatars, dm });
const builder = new SheetBuilder({ dm, sync: tableSync, rolls, sheetWin: charSheet, onEnterVR: () => enterVR(), canVR: () => vrSupported });
// The whole interface again, inside the headset (design/completion-plan.md §5).
const vrui = new VRUI({ scene, camera, renderer, rig, dm, sync: tableSync, audio, tray, rolls, dice, caster, calls, lifeDrag, voice, grab, input, combat, tactics, table });
// The player's own card and satchel on the table; handouts from the DM; the acting creature's speed ring.
const handouts = new Handouts({ dm, sync: tableSync, onShow: (h) => vrui.toast(`${h.title}: ${h.text}`.slice(0, 120)) });
panel.ui.handouts = handouts; vrui.handouts = handouts;
const seatProps = new SeatProps({ scene, dm, sync: tableSync, mouse, onOpen: (kind) => (renderer.xr.isPresenting ? vrui.open(kind === 'bag' ? 'bag' : 'sheet') : charSheet.open(kind === 'bag' ? 'inv' : 'sheet')) });
new SpeedRing({ scene, dm });
caster.blocked = (side) => vrui.handBusy(side);
caster.aimRay = (side) => (vrui.active ? vrui.aimRay(side) : null); // aim strikes with the stable hand ray in the headset
caster.hint = (t) => vrui.toast(t);
tableSync.onToast = (t, k) => vrui.toast(t, k);
dm.toast = (msg) => tableSync.toast(msg, 'warn'); // TokenManager warnings (life-size cap)

mouse.onClickGrabbable = (it) => { if (it.kind === 'die') dice.toss(it); else if (it.tokenId) panel.tokenClick(it.tokenId); };
input.tipFilter = (id) => !grab.tipsSuppressed(id);
// Dice pouch: pinch inside it to pull out a fresh die, already in your hand.
grab.onEmptyGrab = (h) => {
  const P = DICE_POUCH;
  if (dice.locked || Math.hypot(h.point[0] - P.x, h.point[1] - P.y, h.point[2] - P.z) > P.r) return null;
  audio.tone(500, 0.12, { type: 'triangle', gain: 0.1, freqEnd: 900 });
  return dice.spawn(P.type, h.point);
};
// The DM's enemies are the DM's to move: players cannot pick up minis the table has locked (they can still ask).
grab.canTake = (it) => !(it.kind === 'mini' && tableSync.role === 'player' && dm.tokens.find(it.netKey)?.side === 'enemy'); // only the DM moves enemy minis
mouse.addTool({ priority: true, enabled: () => dm.isDM && dm.state.map.fogPaint && table.fog.visible, targets: () => [table.fog],
  onDown: (h) => table.revealUV(h.uv.x, h.uv.y), onDrag: (h) => table.revealUV(h.uv.x, h.uv.y) });
mouse.addTool({ enabled: () => !dice.locked, targets: () => [table.pouch], onDown: () => dice.toss(dice.spawn(DICE_POUCH.type)) });
mouse.addTool({ enabled: () => dm.props.length > 0, targets: () => dm.props,
  onDown: (h) => { let o = h.object; while (o && !dm.props.includes(o)) o = o.parent; o?.userData.poke(); } });

// ---------- HUD ----------
function hudLog(r) {
  const li = document.createElement('li');
  li.textContent = r.secret ? `secret ${r.type}` : `${r.type} → ${r.value}`;
  if (!r.secret && r.type === 'd20' && r.value === 20) li.className = 'nat20';
  if (!r.secret && r.type === 'd20' && r.value === 1) li.className = 'nat1';
  $('log-list').prepend(li); while ($('log-list').children.length > 12) $('log-list').lastChild.remove();
}
function status(msg) { $('status').textContent = msg; $('status').hidden = !msg; }
dm.on((s) => { $('role-badge').textContent = s.role === 'dm' ? 'Dungeon Master' : myToken()?.name || 'Player'; $('lock-badge').hidden = !s.dice.locked; $('secret-badge').hidden = !(s.dice.secret && s.role === 'dm'); });

// ---------- Seats ----------
let mySeat = seatLayout(0);
/** Puts this person at a seat: the dice tray in front of them, the desktop camera behind them, the VR rig on the chair. */
function applySeat(seat) {
  if (REPLAY) return;
  const L = (mySeat = seatLayout(seat));
  physics.setTray(L.tray, L.pouch); table.placeTray();
  if (!LEGACY_LAYOUT) {
    // The roll log stands on the far side of the table, a little to the right, facing this seat.
    const fx = L.fwd[0], fz = L.fwd[1], rx = L.right[0], rz = L.right[1];
    table.placeLog(Math.max(-0.74, Math.min(0.74, fx * 0.5 + rx * 0.55)), Math.max(-0.56, Math.min(0.56, fz * 0.5 + rz * 0.55)), L.yaw);
    deskCam.yaw = L.yaw; deskCam.target.set(-fx * 0.12, 0.88, -fz * 0.12);
  }
  for (const d of dice.dice) if (!grab.isHeld(d)) { const [x, z] = trayPoint((Math.random() - 0.5) * TRAY.w * 0.6, (Math.random() - 0.5) * TRAY.d * 0.5); d.body.position.set(x, TABLE_TOP + 0.06, z); d.body.velocity.setZero(); d.rolling = false; }
  placeRig();
  vrui.setSeat(L); avatars.setSeat(L); seatProps.setSeat(L);
}
function placeRig() {
  if (renderer.xr.isPresenting && !REPLAY) { rig.position.set(mySeat.pos[0], 0, mySeat.pos[1]); rig.rotation.set(0, mySeat.yaw, 0); }
  else { rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); }
  rig.updateMatrixWorld(true);
}
tableSync.onSeat = applySeat;
tableSync.onFatal = (msg) => {
  clearSession();
  try { sessionStorage.setItem('hearthstone-error', msg); } catch { /* storage unavailable */ }
  location.replace(location.pathname + (params.has('join') ? `?join=${encodeURIComponent(params.get('join') || '')}` : ''));
};

// ---------- Start ----------
let started = false, vrSupported = false, webcamOn = false;
function startWorld() {
  if (started) return; started = true;
  sceneMgr.show('campfire');
  // Starter set placed in the tray (not "rolled", so no fake results are reported).
  ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'].forEach((t, i) => {
    const [x, z] = LEGACY_LAYOUT ? [0.25 + (i % 3) * 0.17, -0.08 + Math.floor(i / 3) * 0.2] : trayPoint(((i % 3) - 1) * TRAY.w * 0.27, (Math.floor(i / 3) - 0.5) * TRAY.d * 0.42);
    dice.spawn(t, [x, TABLE_TOP + 0.05, z]).rolling = false;
  });
  $('start').hidden = true; $('hud').hidden = false;
}
function showHome(error = '') {
  $('start').hidden = false; $('hud').hidden = true;
  $('home-error').textContent = error; $('home-error').hidden = !error;
  document.body.classList.remove('in-lobby');
}

/**
 * Starts a session.
 * @param {{ role: 'dm'|'player', mode?: 'desktop'|'webcam'|'vr', name?: string, code?: string|null, host?: boolean, rejoin?: string|null, test?: boolean }} o
 *   test: the shared test table, no character stage. host: a new table with a fresh code (stage 1 first).
 */
async function start({ role, mode = 'desktop', name = '', code = null, host = false, rejoin = null, test = false }) {
  if (started) return;
  audio.init(); startWorld(); dm.setRole(role); audio.setMusic('tavern');
  dm.state.session = { stage: test || !host ? dm.state.session.stage : 'lobby', ready: {} };
  if (host) dm.state.session.stage = 'lobby';
  input.addPointerSource(mouse);
  if (!REPLAY) tableSync.start(role, name, { code, host, rejoin, vr: mode === 'vr', test });
  if (role === 'player' && !test) builder.enable(name);
  $('help-dm').hidden = role !== 'dm';
  if (role === 'dm') panel.showTab('table');
  if (mode === 'vr') await enterVR();
  else if (mode === 'webcam') await startWebcam();
}

async function startWebcam() {
  const src = new WebcamHandSource({ onStatus: status });
  try { await input.setJointSource(src); webcamOn = true; setTimeout(() => status(''), 3000); }
  catch (e) { status('Webcam unavailable: using the mouse. (' + e.message + ')'); input.setJointSource(null); }
}

/** Enters the headset from wherever the session is (the home screen's test row, the stage-2 screen, or the HUD button). */
async function enterVR() {
  if (renderer.xr.isPresenting) return;
  try {
    // Ask for the microphone before the headset view takes over, so the permission prompt is never hidden behind it.
    if (!voice.enabled && tableSync.role) await voice.enable().catch(() => {});
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    // Quest 3S: ask for a steady 72 Hz (it supports 72 / 90 / 120); a missed frame is worse than a lower rate.
    try { if (session.supportedFrameRates?.includes(72)) await session.updateTargetFrameRate(72); } catch { /* not supported here */ }
    await input.setJointSource(new XRHandSource(renderer, rig));
    await renderer.xr.setSession(session);
    placeRig(); vrui.setActive(true, session); tableSync.setVR(true); document.body.classList.add('in-vr');
    session.addEventListener('end', () => {
      vrui.setActive(false); tableSync.setVR(false); document.body.classList.remove('in-vr');
      input.setJointSource(null); webcamOn = false; placeRig();
      camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
    });
  } catch (e) { status('Could not start VR: ' + e.message); setTimeout(() => status(''), 6000); }
}

// ---------- Home screen ----------
const JOIN = params.has('join'), JOIN_CODE = (params.get('join') || '').toUpperCase();
if (JOIN) { $('join-banner').hidden = false; $('join-code').value = JOIN_CODE; $('home-host').classList.add('dim'); }
const roleOf = () => document.querySelector('input[name=role]:checked').value;
const testStart = (mode) => start({ role: JOIN ? 'player' : roleOf(), mode, name: $('player-name').value.trim() || $('host-name').value.trim(), code: JOIN_CODE || params.get('room') || null, test: true }); // ?room=NAME: a named test table
$('btn-vr').onclick = () => testStart('vr');
$('btn-webcam').onclick = () => testStart('webcam');
$('btn-desktop').onclick = () => testStart('desktop');
$('btn-host').onclick = () => start({ role: 'dm', name: $('host-name').value.trim(), host: true });
$('btn-join').onclick = () => {
  const code = $('join-code').value.trim().toUpperCase(), name = $('player-name').value.trim(), rejoin = $('join-rejoin').value.trim();
  if (!code) { $('home-error').textContent = 'Type the table code your Dungeon Master gave you.'; $('home-error').hidden = false; $('join-code').focus(); return; }
  if (!name && !rejoin) { $('home-error').textContent = 'Type your name.'; $('home-error').hidden = false; $('player-name').focus(); return; }
  // On a headset browser (no mouse, VR available) a rejoin goes straight into VR.
  start({ role: 'player', name, code, rejoin: rejoin || null, mode: $('join-webcam').checked ? 'webcam' : 'desktop' });
};
for (const id of ['join-code', 'player-name', 'join-rejoin']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
$('host-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-host').click(); });
if (params.has('test')) $('home-test').open = true;
const setVrSupport = (ok, why) => { vrSupported = ok; $('btn-vr').disabled = !ok; $('btn-vr').title = ok ? '' : why; $('vr-btn').hidden = !ok; };
if (navigator.xr) navigator.xr.isSessionSupported('immersive-vr').then((ok) => setVrSupport(ok, 'WebXR VR is not available on this device')).catch(() => setVrSupport(false, 'WebXR VR is not available on this device'));
else setVrSupport(false, 'WebXR is not available in this browser');
$('vr-btn').onclick = () => enterVR();
$('mic-btn').onclick = () => voice.toggle();
// The mic button shows its state as painted art (off / on / muted) plus a short label.
const MIC_STATES = { off: ['voice/mic-off', 'Mic off', 'Voice chat: click to turn your microphone on'], on: ['voice/mic-on', 'Mic on', 'Microphone on: click to mute'], muted: ['voice/mic-muted', 'Mic muted', 'Muted: click to unmute'] };
voice.onChange = () => {
  const b = $('mic-btn'), st = !voice.enabled ? 'off' : voice.muted ? 'muted' : 'on', [icon, label, tip] = MIC_STATES[st];
  b.innerHTML = `${kitIcon(icon, { cls: 'gi' })}<span>${label}</span>`; b.title = tip; b.dataset.state = st;
  b.classList.toggle('on', st === 'on');
};
voice.onChange();
// A refresh comes back to the same seat at the same table.
const last = !REPLAY && !JOIN && !params.has('fresh') ? lastSession() : null;
if (last?.code && last.code !== 'TABLE' && !params.has('test')) start({ role: last.role, name: last.name, code: last.code, rejoin: last.rejoin });

try { const err = sessionStorage.getItem('hearthstone-error'); if (err) { sessionStorage.removeItem('hearthstone-error'); showHome(err); } } catch { /* storage unavailable */ }
const toggleCheat = (v = $('cheatsheet').hidden) => { $('cheatsheet').hidden = !v; };
$('help-btn').onclick = () => toggleCheat();
$('cheatsheet').onclick = (e) => { if (e.target.id === 'cheatsheet' || e.target.closest('[data-close]')) toggleCheat(false); };
const TYPING = 'input, select, textarea, [contenteditable]';
const PANELS = '#dm-panel, #dice-tray, #creature-editor, #cheatsheet, #char-sheet, #lobby, #call-desk';
addEventListener('keydown', (e) => {
  if (!started || e.ctrlKey || e.metaKey) return;
  const t = e.target instanceof Element ? e.target : null;
  if (t?.closest(TYPING)) return; // QA S3: never while typing in any field
  const k = e.key.toLowerCase(), digit = /^Digit[1-6]$/.test(e.code) ? Number(e.code.slice(5)) : 0;
  if (e.altKey) { if (digit && dm.isDM) { e.preventDefault(); panel.showTab(digit - 1); } return; } // Alt+1-6: DM dock tabs
  if (digit && !e.shiftKey) { if (!dice.locked) dice.toss(dice.spawn(DIE_TYPES[digit - 1])); return; } // 1-6: a d4-d20 onto the board (DM too)
  // Dock / help keys work from inside the panels; game keys do not (a focused button would also eat Space).
  if (e.key === '?' || k === 'h') { toggleCheat(); return; }
  if (k === 'escape') { toggleCheat(false); return; }
  if (k === 'm' && dm.isDM && e.shiftKey) { panel.toggle(true); panel.expand(); return; } // expand / shrink the DM panel
  if (k === 'm' && dm.isDM) { panel.toggle(); return; }
  if (k === 'k') { charSheet.toggle(); return; }
  if (k === 't') { // hide / show the dice tray (a roll result still shows)
    const tray = $('dice-tray'), off = tray.classList.toggle('collapsed');
    tableSync.toast?.(off ? 'Dice tray hidden: press T to bring it back.' : 'Dice tray shown.', 'join'); return;
  }
  if (k === 'v') { voice.pushToTalk(true); return; }
  if (t?.closest(PANELS)) return;
  if (k === ' ') { e.preventDefault(); dice.rollAll(); }
  else if (k === 'c') dice.clear();
  else if (k === 'f' && dm.isDM) dm.toggleFogPaint();
  else if (k === 'p' && tableSync.role !== 'player') dm.setRole(dm.isDM ? 'player' : 'dm');
});
addEventListener('keyup', (e) => { if (e.key.toLowerCase() === 'v') voice.pushToTalk(false); });

// ---------- Replay / test mode ----------
let replay = null, frame = 0;
if (REPLAY) {
  startWorld(); dm.setRole('player');
  // Optional module owned by the test harness – glob keeps the build working when it's absent.
  const mods = import.meta.glob('./input/ReplayInputSource.js');
  const load = mods['./input/ReplayInputSource.js'] || (() => Promise.reject(new Error('ReplayInputSource.js not present')));
  load().then(async ({ ReplayInputSource }) => {
    const src = new ReplayInputSource({ url: REPLAY, speed: Number(params.get('speed') || 1), seed: params.get('seed'), scene });
    await input.setJointSource(src); // awaits src.load()
    const setup = src.setup || {};
    if (setup.clearDice) dice.clear();
    for (const d of setup.dice || []) {
      const die = dice.spawn(d.type, d.pos);
      const q = d.rot || [0, 0, 0, 1]; die.body.quaternion.set(q[0], q[1], q[2], q[3]);
      die.body.velocity.setZero(); die.body.angularVelocity.setZero(); die.rolling = false;
    }
    replay = src;
    window.__hearthstoneTest.replayReady = true; // setup dice placed; safe to start stepping
  }).catch((e) => console.warn('Replay source unavailable:', e.message));
}
else {
  // Optional hand recorder from the test harness (exposes window.__hearthstoneRecorder).
  const rec = import.meta.glob('./input/HandRecorder.js')['./input/HandRecorder.js'];
  rec?.().then((m) => m.installHandRecorder({ input, scene, renderer })).catch((e) => console.warn('HandRecorder unavailable:', e.message));
}
window.__hearthstoneTest = {
  snapshot: () => ({
    dice: dice.dice.map((d) => ({ id: d.id, type: d.type, position: d.body.position.toArray(), velocity: d.body.velocity.toArray(), held: grab.isHeld(d), rolling: d.rolling })),
    heldObject: (() => { const h = grab.heldObject(); return h ? { id: h.id, kind: h.kind, type: h.type || h.record?.type } : null; })(),
    lastRoll: dice.lastRoll, rollCount: dice.rollCount, frame,
  }),
  dm, dice, deskCam, input, grab, forge, combat, rolls, tactics, cinematic, caster, spellFx, charSheet, builder, calls, strikes, tray, panel, lifeDrag, avatars, voice, vrui, renderer, scene, camera, sceneMgr, seatProps, handouts,
  start, enterVR, seat: () => mySeat, THREE,
  // Advance the simulation without rendering (works while the tab is hidden / rAF is paused).
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) { tick(dt); deskCam.update(); scene.updateMatrixWorld(); camera.matrixWorldInverse.copy(camera.matrixWorld).invert(); } return this.snapshot(); },
};

// ---------- Main loop ----------
let t = 0, simT = 0, last2 = performance.now();
// One simulation tick. DM state (minis, props, narration) runs on the sim clock `simT`, never
// wall-clock time, so paused + stepped replays are bit-for-bit reproducible.
function tick(dt) {
  simT += dt;
  const hands = input.update(dt);
  grab.update(hands, dt);
  physics.step(dt);
  dice.update(dt);
  dm.update(simT, dt);
  forge.update(simT);
  tactics.update(grab.items.filter((i) => i.kind === 'mini'));
  for (const h of hands) {
    if (!h.joints) continue;
    for (const tip of h.tips) dm.pokeAt(tip);
    if (dm.isDM && dm.state.map.fogPaint && table.fog.visible) table.revealWorld(h.joints['index-finger-tip'].p);
  }
  frame++;
  return hands;
}
renderer.setAnimationLoop(() => {
  const now = performance.now(), realDt = Math.min((now - last2) / 1000, 0.1); last2 = now; t += realDt;
  const xr = renderer.xr.isPresenting;
  let hands = input.hands;
  if (xr) vrui.preUpdate(realDt); // controllers become pointer hands before grabbing runs
  if (replay) { const n = replay.ticksDue ? replay.ticksDue(realDt) : 1; for (let i = 0; i < n; i++) hands = tick(REPLAY_DT); }
  else if (started) hands = tick(realDt * cinematic.timeScale); // slow-mo on crits
  if (!xr) {
    deskCam.update();
    if (cinematic.focus) camera.lookAt(cinematic.focus); // cinematic mode: frame the active creature
    camera.position.add(cinematic.shakeOffset);
  }
  cinematic.update(realDt);
  tableSync.update(realDt);
  combatView.update(t);
  sceneMgr.update(t, realDt); // purely visual from here on (no physics bodies)
  weather.update(t, realDt);
  effects.update(realDt);
  if (started) { caster.update(hands, realDt); seatProps.update(hands, realDt); lifeDrag.update(realDt); avatars.update(realDt, hands, xr); voice.update(realDt); }
  spellFx.update(realDt);
  if (xr) vrui.update(hands, realDt);
  if (xr) { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.render(scene, camera); }
  else { renderer.toneMapping = THREE.NoToneMapping; composer.render(realDt); }
});
