import * as THREE from 'three';
import {
  BatchedRenderer, ParticleSystem, ConeEmitter, IntervalValue, ConstantValue, ColorOverLife, SizeOverLife,
  Gradient, PiecewiseBezier, Bezier, RandomColor, ApplyForce, RenderMode, Vector3 as QV3, Vector4 as QV4,
} from 'three.quarks';

// Campfire flames, embers and smoke with three.quarks (github.com/Alchemist0823/three.quarks),
// plus a flickering warm point light. update(dt) must be called every frame.

function spriteTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const fade = (pts) => new PiecewiseBezier([[new Bezier(...pts), 0]]);

export class CampFire {
  constructor(parent, position) {
    this.group = new THREE.Group();
    this.group.position.copy(position);
    parent.add(this.group);
    this.batch = new BatchedRenderer();
    parent.add(this.batch);

    const glow = spriteTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    // One shared additive material so three.quarks can batch flames, core and embers together.
    const addMat = new THREE.MeshBasicMaterial({ map: glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const additive = () => addMat;
    this._owned = [addMat, glow];

    this.flames = new ParticleSystem({
      duration: 1, looping: true, prewarm: true,
      startLife: new IntervalValue(0.5, 0.9),
      startSpeed: new IntervalValue(0.35, 0.7),
      startSize: new IntervalValue(0.22, 0.38),
      startColor: new RandomColor(new QV4(1, 0.55, 0.15, 1), new QV4(1, 0.8, 0.35, 1)),
      emissionOverTime: new ConstantValue(70),
      shape: new ConeEmitter({ radius: 0.22, angle: 0.15, thickness: 1 }),
      material: additive(glow),
      renderMode: RenderMode.BillBoard,
      behaviors: [
        new SizeOverLife(fade([1, 0.9, 0.5, 0.05])),
        new ColorOverLife(new Gradient(
          [[new QV3(1, 0.85, 0.4), 0], [new QV3(1, 0.4, 0.08), 0.5], [new QV3(0.5, 0.08, 0.02), 1]],
          [[0, 0], [0.9, 0.15], [0.6, 0.6], [0, 1]],
        )),
      ],
    });
    // Hot white-gold core: small, short-lived, fast — gives the fire a bright heart for bloom.
    this.core = new ParticleSystem({
      duration: 1, looping: true, prewarm: true,
      startLife: new IntervalValue(0.25, 0.45),
      startSpeed: new IntervalValue(0.2, 0.45),
      startSize: new IntervalValue(0.12, 0.2),
      startColor: new RandomColor(new QV4(1, 0.95, 0.75, 1), new QV4(1, 0.85, 0.5, 1)),
      emissionOverTime: new ConstantValue(30),
      shape: new ConeEmitter({ radius: 0.1, angle: 0.08, thickness: 1 }),
      material: additive(glow),
      renderMode: RenderMode.BillBoard,
      behaviors: [
        new SizeOverLife(fade([1, 0.8, 0.45, 0.1])),
        new ColorOverLife(new Gradient([[new QV3(1, 1, 0.85), 0], [new QV3(1, 0.6, 0.2), 1]], [[0, 0], [1, 0.2], [0, 1]])),
      ],
    });
    this.embers = new ParticleSystem({
      duration: 1, looping: true, prewarm: true,
      startLife: new IntervalValue(1.5, 3.2),
      startSpeed: new IntervalValue(0.6, 1.4),
      startSize: new IntervalValue(0.012, 0.028),
      startColor: new RandomColor(new QV4(1, 0.6, 0.2, 1), new QV4(1, 0.85, 0.4, 1)),
      emissionOverTime: new ConstantValue(18),
      shape: new ConeEmitter({ radius: 0.25, angle: 0.35, thickness: 1 }),
      material: additive(glow),
      renderMode: RenderMode.BillBoard,
      behaviors: [
        new ApplyForce(new QV3(0.3, 0, 0.1), new ConstantValue(0.25)),
        new ColorOverLife(new Gradient([[new QV3(1, 0.8, 0.4), 0], [new QV3(1, 0.3, 0.05), 1]], [[1, 0], [1, 0.7], [0, 1]])),
      ],
    });
    this.smoke = new ParticleSystem({
      duration: 1, looping: true, prewarm: true,
      startLife: new IntervalValue(3, 5),
      startSpeed: new IntervalValue(0.25, 0.45),
      startSize: new IntervalValue(0.4, 0.7),
      startColor: new RandomColor(new QV4(0.18, 0.16, 0.15, 0.25), new QV4(0.28, 0.25, 0.22, 0.3)),
      emissionOverTime: new ConstantValue(6),
      shape: new ConeEmitter({ radius: 0.15, angle: 0.2, thickness: 1 }),
      material: new THREE.MeshBasicMaterial({ map: spriteTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)'), transparent: true, depthWrite: false }),
      renderMode: RenderMode.BillBoard,
      behaviors: [
        new SizeOverLife(fade([0.5, 1.2, 2.0, 2.6])),
        new ApplyForce(new QV3(0.4, 0, 0.15), new ConstantValue(0.08)),
        new ColorOverLife(new Gradient([[new QV3(1, 1, 1), 0], [new QV3(1, 1, 1), 1]], [[0, 0], [0.35, 0.2], [0, 1]])),
      ],
    });
    for (const [sys, y] of [[this.flames, 0.12], [this.core, 0.08], [this.embers, 0.2], [this.smoke, 0.7]]) {
      sys.emitter.rotation.x = -Math.PI / 2; // emit upwards (+Y)
      sys.emitter.position.y = y;
      this.group.add(sys.emitter);
      this.batch.addSystem(sys);
    }

    // Ground glow: additive radial decal under the fire that breathes with the light (1 cheap draw call).
    const groundTex = spriteTexture('rgba(255,150,60,0.9)', 'rgba(255,60,0,0)');
    this.groundMat = new THREE.MeshBasicMaterial({ map: groundTex, color: '#ff8a3d', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8).rotateX(-Math.PI / 2), this.groundMat);
    this.ground.position.y = 0.01; this.ground.renderOrder = 1;
    this.group.add(this.ground);
    this._owned.push(groundTex, this.groundMat, this.ground.geometry, this.smoke.material?.map, this.smoke.material);

    this.light = new THREE.PointLight('#ff8a3a', 6, 9, 1.6);
    this.light.position.set(0, 0.6, 0);
    this.group.add(this.light);
    this.base = 6;
    this.t = 0;
  }

  update(dt) {
    this.t += dt;
    this.batch.update(dt);
    const f = Math.sin(this.t * 13) * 0.08 + Math.sin(this.t * 7.3 + 1) * 0.1 + Math.sin(this.t * 23.1) * 0.05;
    this.light.intensity = this.base * (1 + f);
    this.light.position.x = Math.sin(this.t * 5.1) * 0.04;
    this.groundMat.opacity = 0.55 + f * 1.2;
  }

  /** Removes the fire and frees its GPU resources. */
  dispose() {
    this.group.parent?.remove(this.group); this.batch.parent?.remove(this.batch);
    for (const sys of [this.flames, this.core, this.embers, this.smoke]) sys.dispose?.();
    for (const o of this._owned) o?.dispose?.();
  }
}
