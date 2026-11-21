import * as THREE from 'three';
import { createTavern } from '../scenes/tavern.js';
import { createDungeon } from '../scenes/dungeon.js';
import { createForest } from '../scenes/forest.js';
import { createLair } from '../scenes/lair.js';
import { createCampfire } from '../scenes/campfire.js';
import { BACKDROPS, backdropScene } from '../scenes/hdriBackdrop.js';

// The demo ships one polished scene. The older procedural scenes stay available behind ?allScenes=1.
const ALL = typeof location !== 'undefined' && new URLSearchParams(location.search).has('allScenes');
export const DEFAULT_SCENE = 'campfire';
export const SCENES = ALL
  ? { campfire: createCampfire, tavern: createTavern, dungeon: createDungeon, forest: createForest, lair: createLair }
  : { campfire: createCampfire };
export const SCENE_LABELS = ALL
  ? { campfire: 'Campfire', tavern: 'Tavern', dungeon: 'Dungeon', forest: 'Forest Clearing', lair: "Dragon's Lair" }
  : { campfire: 'Campfire' };

// Photographic backdrop presets (CC0 Poly Haven HDRIs) are always on: they are the DM's quick scene changes.
for (const [id, b] of Object.entries(BACKDROPS)) { SCENES[id] = backdropScene(id); SCENE_LABELS[id] = b.label; }

/** Adds a scene at runtime (AI Forge backdrops). It then shows up in the DM's Scenes tab. */
export function registerScene(name, label, factory) { SCENES[name] = factory; SCENE_LABELS[name] = label; }

const TOD = {
  day: { amb: 1.7, key: 1.5, fog: 0.6, fogMul: 2.2, keyColor: '#fff4e0' },
  dusk: { amb: 1.0, key: 1.0, fog: 1.0, fogMul: 1.0, keyColor: null },
  night: { amb: 0.45, key: 0.4, fog: 1.3, fogMul: 0.5, keyColor: '#7f90ff' },
};
const MOODS = {
  calm: { tint: '#ffe0b0', mix: 0.1, exposure: 1.05 },
  tense: { tint: '#6080a0', mix: 0.35, exposure: 0.9 },
  combat: { tint: '#ff3020', mix: 0.35, exposure: 1.05 },
  eerie: { tint: '#40ff90', mix: 0.4, exposure: 0.85 },
};

/** Swaps 360° environment groups around the fixed central table, with fade + rumble. */
export class SceneManager {
  constructor({ scene, renderer, camera, audio, ctx }) {
    Object.assign(this, { scene, renderer, camera, audio, ctx });
    this.cache = {}; this.current = null; this.busy = false;
    this.settings = { timeOfDay: 'dusk', torch: 1, fog: 0.5, mood: 'calm' };
    this.hemi = new THREE.HemisphereLight('#fff', '#000', 0.5); scene.add(this.hemi);
    this.key = new THREE.DirectionalLight('#fff', 1); // the single shadow-casting light
    this.key.castShadow = true; this.key.shadow.mapSize.set(1024, 1024);
    Object.assign(this.key.shadow.camera, { left: -1.5, right: 1.5, top: 1.5, bottom: -1.5, near: 0.5, far: 10 });
    this.key.shadow.bias = -0.0005; this.key.target.position.set(0, 0.78, 0);
    scene.add(this.key, this.key.target);
    this.flash = new THREE.AmbientLight('#cfe0ff', 0); scene.add(this.flash);
    scene.fog = new THREE.FogExp2('#000', 0.05);
    // Fade sphere attached to the camera works both on desktop and inside the headset.
    this.fader = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshBasicMaterial({ color: '#000', side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, fog: false }));
    this.fader.renderOrder = 999; this.fader.visible = false; camera.add(this.fader);
    this.fade = 0; this.fadeTarget = 0; this.pending = null;
  }

  get(name) {
    if (!SCENES[name]) name = DEFAULT_SCENE; // encounters may still name hidden scenes
    return (this.cache[name] ||= SCENES[name](this.ctx));
  }
  preload() { Object.keys(SCENES).forEach((n) => this.get(n)); }

  show(name) {
    if (this.current) this.scene.remove(this.current.group);
    this.current = this.get(name); this.currentName = name;
    this.scene.add(this.current.group);
    this.applyLighting();
    this.audio.setAmbience(this.current.ambience);
    this.onChange?.(name);
  }

  switchTo(name, { instant = false } = {}) {
    if (this.busy) { if (name !== this.pending) { this.pending = name; this.fadeTarget = 1; } return; } // queue during a fade
    if (!SCENES[name]) name = DEFAULT_SCENE;
    if (name === this.currentName) return;
    if (instant || !this.current) return this.show(name);
    this.busy = true; this.audio.rumble();
    this.fadeTarget = 1; this.pending = name;
  }

  set(key, value) { this.settings[key] = value; this.applyLighting(); }

  applyLighting() {
    if (!this.current) return;
    const L = this.current.light, s = this.settings, tod = TOD[s.timeOfDay], mood = MOODS[s.mood];
    const tint = new THREE.Color(mood.tint);
    this.hemi.color.set(L.hemiSky).lerp(tint, mood.mix); this.hemi.groundColor.set(L.hemiGround);
    this.hemi.intensity = L.hemiInt * tod.amb * 1.4;
    this.key.color.set(L.keyColor); if (tod.keyColor) this.key.color.lerp(new THREE.Color(tod.keyColor), 0.6);
    this.key.color.lerp(tint, mood.mix * 0.5);
    this.key.intensity = L.keyInt * tod.key * 1.5;
    this.key.position.set(...L.keyPos);
    const fc = new THREE.Color(L.fogColor).multiplyScalar(tod.fogMul).lerp(tint.clone().multiplyScalar(0.15), mood.mix * 0.5);
    this.scene.fog.color.copy(fc);
    this.scene.fog.density = L.fogDensity * tod.fog * (0.2 + s.fog * 1.6);
    if (this.current.background) {
      this.scene.background = this.current.background;
      this.scene.backgroundIntensity = (L.backgroundIntensity ?? 1) * tod.amb;
      this.scene.environment = this.current.environment;
      this.scene.environmentIntensity = (L.environmentIntensity ?? 1) * tod.amb;
    } else {
      this.scene.background = new THREE.Color(L.sky).multiplyScalar(tod.fogMul).lerp(fc, 0.5);
      this.scene.environment = null;
    }
    this.renderer.toneMappingExposure = mood.exposure;
    this.ctx.torchMul = s.torch;
  }

  lightning() { this.flashT = 0.6; }

  update(t, dt) {
    if (this.fade !== this.fadeTarget) {
      this.fade += Math.sign(this.fadeTarget - this.fade) * dt * 2.2;
      this.fade = Math.min(1, Math.max(0, this.fade));
      if (Math.abs(this.fade - this.fadeTarget) < 0.01) this.fade = this.fadeTarget;
      if (this.fade === 1 && this.pending) { this.show(this.pending); this.pending = null; this.fadeTarget = 0; }
      if (this.fade === 0 && !this.pending) this.busy = false;
    }
    this.fader.visible = this.fade > 0; this.fader.material.opacity = this.fade;
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.intensity = this.flashT > 0 ? (Math.sin(this.flashT * 40) > 0 ? 6 : 1) * this.flashT : 0;
    }
    this.current?.update(t, dt);
  }
}
