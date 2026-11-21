import * as THREE from 'three';
import { MAP } from '../scene/Table.js';
import { TABLE_TOP } from '../physics/Physics.js';
import { textSprite, updateTextSprite } from '../scene/util.js';

/** Metres per foot: the parchment map is 70 ft wide. */
export const FT = MAP.w / 70;
/** One 5 ft battle-grid square, in metres. */
export const CELL = 5 * FT;

const X0 = MAP.x - MAP.w / 2, Z0 = MAP.z - MAP.d / 2, X1 = MAP.x + MAP.w / 2, Z1 = MAP.z + MAP.d / 2;
const COLS = Math.floor(MAP.w / CELL + 1e-6), ROWS = Math.floor(MAP.d / CELL + 1e-6);
const TPL_COLORS = { sphere: '#ff6a2a', cone: '#ffb020', line: '#3fa9ff', cube: '#b05bff' };
const onMap = (x, z) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1;

/**
 * Tabletop tactics layer: 5 ft battle grid, snap-to-cell, a measuring ruler and
 * draggable/rotatable area-of-effect templates that tint the minis they cover.
 */
export class Tactics {
  /** @param {{ scene: THREE.Scene, grab: object, mouse: object, table: object }} deps */
  constructor({ scene, grab, mouse, table }) {
    this.scene = scene; this.grab = grab; this.mouse = mouse; this.table = table;
    this.gridOn = false; this.rulerOn = false; this.templates = [];
    this.grid = this.buildGrid(); this.grid.visible = false; scene.add(this.grid);
    // Invisible pick plane (larger than the map so drags do not drop off the edge).
    this.pick = new THREE.Mesh(new THREE.PlaneGeometry(MAP.w * 3, MAP.d * 3), new THREE.MeshBasicMaterial());
    this.pick.rotation.x = -Math.PI / 2; this.pick.position.set(MAP.x, TABLE_TOP + 0.003, MAP.z);
    this.pick.visible = false; scene.add(this.pick);
    this.buildRuler();
    this.dragTpl = null; this.dragOff = [0, 0];
    // Template dragging comes first so a template on the map wins over the ruler.
    mouse?.addTool({
      priority: true,
      enabled: () => this.templates.length > 0,
      targets: () => (this.dragTpl ? [this.pick] : this.templates.map((t) => t.mesh)),
      onDown: (hit) => {
        const tpl = this.templates.find((t) => { let o = hit.object; while (o && o !== t.mesh) o = o.parent; return !!o; });
        if (!tpl) return;
        this.dragTpl = tpl; this.dragOff = [tpl.mesh.position.x - hit.point.x, tpl.mesh.position.z - hit.point.z];
      },
      onDrag: (hit) => { if (this.dragTpl) this.dragTpl.mesh.position.set(hit.point.x + this.dragOff[0], this.dragTpl.mesh.position.y, hit.point.z + this.dragOff[1]); },
      onUp: () => { this.dragTpl = null; },
    });
    mouse?.addTool({
      priority: true,
      enabled: () => this.rulerOn,
      targets: () => [this.pick],
      onDown: (hit) => { if (onMap(hit.point.x, hit.point.z)) { this.rulerFrom = [hit.point.x, hit.point.z]; this.drawRuler(hit.point.x, hit.point.z); } },
      onDrag: (hit) => { if (this.rulerFrom) this.drawRuler(hit.point.x, hit.point.z); },
      onUp: () => this.clearRuler(),
    });
  }

  /** Builds the gold grid-line overlay, clipped to the MAP rect. */
  buildGrid() {
    const y = TABLE_TOP + 0.0015, pts = [];
    for (let i = 0; i <= COLS; i++) { const x = X0 + i * CELL; pts.push(x, y, Z0, x, y, Z1); }
    for (let j = 0; j <= ROWS; j++) { const z = Z0 + j * CELL; pts.push(X0, y, z, X1, y, z); }
    pts.push(X1, y, Z0, X1, y, Z1, X0, y, Z1, X1, y, Z1); // close the map edges
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#d4a64a', transparent: true, opacity: 0.55, depthWrite: false }));
  }

  /** Shows or hides the 5 ft battle grid. @param {boolean} on */
  setGrid(on) { this.gridOn = !!on; this.grid.visible = this.gridOn; }

  /**
   * Snaps a released item to the nearest cell centre when the grid is on and it is on the map.
   * Keeps body y; zeroes x/z velocity. @param {{ body: object }} item
   */
  snap(item) {
    const b = item?.body; if (!this.gridOn || !b) return;
    const p = b.position; if (!onMap(p.x, p.z)) return;
    const ci = Math.min(COLS - 1, Math.max(0, Math.floor((p.x - X0) / CELL)));
    const cj = Math.min(ROWS - 1, Math.max(0, Math.floor((p.z - Z0) / CELL)));
    p.x = X0 + (ci + 0.5) * CELL; p.z = Z0 + (cj + 0.5) * CELL;
    if (b.velocity) { b.velocity.x = 0; b.velocity.z = 0; }
  }

  /** Creates the ruler line and label (hidden until used). */
  buildRuler() {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    this.rulerLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#fff2b0', depthTest: false, transparent: true }));
    this.rulerLine.renderOrder = 10; this.rulerLine.frustumCulled = false; this.rulerLine.visible = false;
    this.rulerLabel = textSprite('0 ft', { scale: 0.035, depthTest: false });
    this.rulerLabel.renderOrder = 11; this.rulerLabel.visible = false;
    this.scene.add(this.rulerLine, this.rulerLabel);
  }

  /** Enables or disables the measuring ruler mouse tool. @param {boolean} on */
  setRuler(on) { this.rulerOn = !!on; if (!on) this.clearRuler(); }

  /**
   * 5e simple-grid distance in feet between two map points: max(|dx|, |dz|) in cells × 5.
   * @param {number[]} a [x, z] @param {number[]} b [x, z] @returns {number}
   */
  static distanceFt(a, b) { return Math.round(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / CELL) * 5; }

  /** Updates the ruler from its start point to (x, z). */
  drawRuler(x, z) {
    const [sx, sz] = this.rulerFrom, y = TABLE_TOP + 0.006, pos = this.rulerLine.geometry.attributes.position;
    pos.setXYZ(0, sx, y, sz); pos.setXYZ(1, x, y, z); pos.needsUpdate = true;
    updateTextSprite(this.rulerLabel, `${Tactics.distanceFt(this.rulerFrom, [x, z])} ft`);
    this.rulerLabel.position.set((sx + x) / 2, y + 0.03, (sz + z) / 2);
    this.rulerLine.visible = this.rulerLabel.visible = true;
  }

  /** Hides the ruler. */
  clearRuler() { this.rulerFrom = null; this.rulerLine.visible = this.rulerLabel.visible = false; }

  /**
   * Places a translucent AoE template on the map. Local +x is the aim direction
   * (cone and line start at pos; sphere and cube are centred on pos).
   * @param {'sphere'|'cone'|'line'|'cube'} shape @param {number} sizeFt
   * @param {number[]} [pos] [x, y, z], defaults to the map centre
   * @returns {{ shape: string, sizeFt: number, mesh: THREE.Mesh }}
   */
  placeTemplate(shape, sizeFt, pos = [MAP.x, TABLE_TOP, MAP.z]) {
    const L = sizeFt * FT, w = 2.5 * FT; let geo;
    if (shape === 'sphere') geo = new THREE.CircleGeometry(L, 48);
    else {
      const s = new THREE.Shape();
      const pts = shape === 'cone' ? [[0, 0], [L, -L / 2], [L, L / 2]]
        : shape === 'line' ? [[0, -w], [L, -w], [L, w], [0, w]]
          : [[-L / 2, -L / 2], [L / 2, -L / 2], [L / 2, L / 2], [-L / 2, L / 2]];
      pts.forEach(([u, v], i) => (i ? s.lineTo(u, v) : s.moveTo(u, v)));
      geo = new THREE.ShapeGeometry(s);
    }
    geo.rotateX(-Math.PI / 2); // (u, v) -> (x, -z); shapes are symmetric in v
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: TPL_COLORS[shape] || '#ff4040', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    mesh.position.set(pos[0], TABLE_TOP + 0.005 + this.templates.length * 0.0003, pos[2]); mesh.renderOrder = 5;
    const tpl = { shape, sizeFt, mesh }; mesh.userData.template = tpl;
    this.templates.push(tpl); this.scene.add(mesh);
    return tpl;
  }

  /** Rotates a template about its origin. @param {object} tpl @param {number} rad */
  rotate(tpl, rad) { tpl.mesh.rotation.y += rad; }

  /** Removes all templates. */
  clearTemplates() {
    for (const t of this.templates) { this.scene.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh.material.dispose(); }
    this.templates = []; this.dragTpl = null;
  }

  /**
   * True when a world point lies inside the template (2D maths in template-local x/z).
   * @param {object} tpl @param {number[]} point [x, y, z] @returns {boolean}
   */
  inside(tpl, point) {
    const m = tpl.mesh, a = m.rotation.y, dx = point[0] - m.position.x, dz = point[2] - m.position.z;
    const x = dx * Math.cos(a) - dz * Math.sin(a), z = dx * Math.sin(a) + dz * Math.cos(a);
    const L = tpl.sizeFt * FT;
    switch (tpl.shape) {
      case 'sphere': return x * x + z * z <= L * L;
      case 'cone': return x >= 0 && x <= L && Math.abs(z) <= x / 2;
      case 'line': return x >= 0 && x <= L && Math.abs(z) <= 2.5 * FT;
      case 'cube': return Math.abs(x) <= L / 2 && Math.abs(z) <= L / 2;
      default: return false;
    }
  }

  /**
   * Per-frame: tints minis inside any template emissive red and resets the rest.
   * @param {Array<{ mesh: THREE.Object3D, body: object }>} minis grab items of kind 'mini'
   */
  update(minis = []) {
    for (const it of minis) {
      const p = it.body?.position; if (!p) continue;
      const hit = this.templates.some((t) => this.inside(t, [p.x, p.y, p.z]));
      if (!!it._aoe === hit) continue;
      it._aoe = hit; this.tint(it.mesh, hit);
    }
  }

  /** Alias of update() for callers that pass the items explicitly. */
  highlight(items) { this.update(items); }

  /** Applies or removes the red emissive tint on every material under obj. */
  tint(obj, on) {
    obj.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      if (!o.userData.aoeOwn) { // clone once so shared materials are not tinted on every mini
        o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
        o.userData.aoeOwn = true;
      }
      for (const m of [].concat(o.material)) {
        if (!m.emissive) continue;
        if (!m.userData.aoeBase) m.userData.aoeBase = { c: m.emissive.clone(), i: m.emissiveIntensity };
        if (on) { m.emissive.set('#ff1a1a'); m.emissiveIntensity = 0.6; }
        else { m.emissive.copy(m.userData.aoeBase.c); m.emissiveIntensity = m.userData.aoeBase.i; }
      }
    });
  }
}
