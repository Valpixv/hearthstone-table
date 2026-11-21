import * as THREE from 'three';
import { std, makeFlame, textSprite, updateTextSprite, planksTex } from '../scene/util.js';
import { pick } from '../core/random.js';

// Interactive room props. Each returns { group, poke(), update(t) }. Poke = fingertip touch or mouse click.
const NPC_LINES = ['Welcome, travellers!', 'Beware the woods at night…', 'Got coin? I got rumours.', 'The dragon stirs again.', 'Mind the traps, friend.', 'Ale\'s on the house!'];

export function makeObject(type, audio, ctx) {
  const g = new THREE.Group(); let update = () => {}, poke = () => {};
  if (type === 'chest') {
    const wood = std('#fff', { map: planksTex('#7b4a20', { repeat: [1, 1] }) }), iron = std('#444', { metalness: 0.8, roughness: 0.4 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.45), wood); base.position.y = 0.2; base.castShadow = true; g.add(base);
    const hinge = new THREE.Group(); hinge.position.set(0, 0.4, -0.225); g.add(hinge);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.7, 16, 1, false, 0, Math.PI), wood); lid.rotation.set(0, 0, Math.PI / 2); lid.position.z = 0.225; hinge.add(lid);
    for (const x of [-0.25, 0.25]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.47), iron); b.position.set(x, 0.2, 0); g.add(b); }
    const gold = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.38), std('#ffcc33', { emissive: '#ffaa00', emissiveIntensity: 0.6, metalness: 1, roughness: 0.3 })); gold.position.y = 0.38; gold.visible = false; g.add(gold);
    let open = false, ang = 0;
    poke = () => { open = !open; gold.visible = true; audio.creak(); if (open) setTimeout(() => audio.chime(), 400); };
    update = (t, dt) => { ang += ((open ? -1.9 : 0) - ang) * Math.min(1, dt * 4); hinge.rotation.x = ang; };
  } else if (type === 'campfire') {
    const logs = new THREE.Group();
    for (let i = 0; i < 5; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.6, 7), std('#3b2210')); l.rotation.set(Math.PI / 2 - 0.4, (i / 5) * Math.PI * 2, 0); l.position.set(Math.cos((i / 5) * 6.28) * 0.12, 0.12, Math.sin((i / 5) * 6.28) * 0.12); logs.add(l); }
    g.add(logs);
    for (let i = 0; i < 8; i++) { const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.08), std('#555')); s.position.set(Math.cos(i * 0.8) * 0.38, 0.04, Math.sin(i * 0.8) * 0.38); g.add(s); }
    const f = makeFlame('#ff7a20', { size: 0.6, intensity: 3, distance: 6, ctx }); f.position.y = 0.35; g.add(f);
    update = (t) => f.userData.update(t);
    poke = () => audio.noise(0.6, { type: 'highpass', freq: 2000, gain: 0.2 });
  } else if (type === 'door') {
    const frameM = std('#555', { roughness: 0.9 });
    for (const x of [-0.6, 0.6]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.3, 0.3), frameM); p.position.set(x, 1.15, 0); g.add(p); }
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 0.3), frameM); top.position.y = 2.3; g.add(top);
    const pivot = new THREE.Group(); pivot.position.set(-0.5, 0, 0); g.add(pivot);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.2, 0.08), std('#fff', { map: planksTex('#5a3518', { repeat: [1, 2] }) })); door.position.set(0.5, 1.1, 0); door.castShadow = true; pivot.add(door);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04), std('#c9a227', { metalness: 1 })); knob.position.set(0.88, 1.1, 0.06); pivot.add(knob);
    let open = false; poke = () => { open = !open; audio.creak(); };
    update = (t, dt) => { pivot.rotation.y += ((open ? -1.6 : 0) - pivot.rotation.y) * Math.min(1, dt * 3); };
  } else if (type === 'trap') {
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 20), std('#4a4038', { metalness: 0.4 })); plate.position.y = 0.02; g.add(plate);
    const spikes = new THREE.Group(); g.add(spikes);
    for (let i = 0; i < 12; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.3, 6), std('#999', { metalness: 0.9, roughness: 0.3 })); s.position.set(Math.cos(i) * (0.1 + (i % 3) * 0.1), 0.15, Math.sin(i) * (0.1 + (i % 3) * 0.1)); spikes.add(s); }
    spikes.position.y = -0.3; let fire = 0;
    poke = () => { fire = 1.2; audio.snap(); };
    update = (t, dt) => { fire = Math.max(0, fire - dt); spikes.position.y = fire > 0.3 ? 0 : -0.3 + (fire / 0.3) * 0.3; };
  } else if (type === 'npc') {
    const robe = std(pick(['#3949ab', '#8e24aa', '#00897b', '#6d4c41']));
    const b = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.3, 12), robe); b.position.y = 0.65; b.castShadow = true; g.add(b);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), std('#e0b48a')); head.position.y = 1.42; g.add(head);
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.45, 12), robe); hat.position.y = 1.7; g.add(hat);
    const beard = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 8), std('#ddd')); beard.position.set(0, 1.25, 0.1); beard.rotation.x = Math.PI; g.add(beard);
    const bubble = textSprite(pick(NPC_LINES), { w: 768, h: 192, font: 'bold 54px Georgia', color: '#2a1a0a', glow: null, bg: 'rgba(255,248,225,0.95)', scale: 0.35 });
    bubble.position.y = 2.15; g.add(bubble);
    poke = () => { updateTextSprite(bubble, pick(NPC_LINES)); audio.tone(300, 0.15, { type: 'triangle', gain: 0.1 }); audio.tone(360, 0.15, { type: 'triangle', gain: 0.1, when: 0.15 }); };
    update = (t) => { head.rotation.y = Math.sin(t * 0.8) * 0.4; bubble.position.y = 2.15 + Math.sin(t * 2) * 0.02; };
  }
  g.userData = { type, poke, update };
  return g;
}

export const OBJECT_TYPES = ['chest', 'campfire', 'door', 'trap', 'npc'];
