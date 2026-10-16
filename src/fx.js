// Particles (sparks, boost flames, tyre smoke), skid marks, and camera-space speed streaks.
import * as THREE from 'three';
import { radialTex } from './world.js';

const VERT = `
attribute float size; attribute float alpha; attribute vec3 color;
varying vec3 vColor; varying float vAlpha;
uniform float scale;
void main() {
  vColor = color; vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / max(0.5, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D map; varying vec3 vColor; varying float vAlpha;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
}`;

class Pool {
  constructor(scene, cap, additive) {
    this.cap = cap; this.head = 0;
    this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap); this.alpha = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3); this.life = new Float32Array(cap); this.max = new Float32Array(cap);
    this.s0 = new Float32Array(cap); this.s1 = new Float32Array(cap);
    this.c0 = new Float32Array(cap * 3); this.c1 = new Float32Array(cap * 3);
    this.a0 = new Float32Array(cap); this.grav = new Float32Array(cap); this.drag = new Float32Array(cap);
    this.fadeIn = new Uint8Array(cap);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { map: { value: radialTex() }, scale: { value: 400 } };
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.geo = g;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, a0, grav = 0, drag = 0, fadeIn = false) {
    const i = this.head; this.head = (this.head + 1) % this.cap;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.life[i] = this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    this.c0[i3] = c0.r; this.c0[i3 + 1] = c0.g; this.c0[i3 + 2] = c0.b;
    this.c1[i3] = c1.r; this.c1[i3 + 1] = c1.g; this.c1[i3 + 2] = c1.b;
    this.a0[i] = a0; this.grav[i] = grav; this.drag[i] = drag; this.fadeIn[i] = fadeIn ? 1 : 0;
  }
  update(dt) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const i3 = i * 3, t = 1 - Math.max(0, this.life[i]) / this.max[i];
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i3 + 1] -= this.grav[i] * dt;
      this.vel[i3] *= d; this.vel[i3 + 1] *= d; this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.05) { this.pos[i3 + 1] = 0.05; this.vel[i3 + 1] *= -0.4; }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      for (let k = 0; k < 3; k++) this.col[i3 + k] = this.c0[i3 + k] + (this.c1[i3 + k] - this.c0[i3 + k]) * t;
      this.alpha[i] = this.a0[i] * (this.fadeIn[i] ? Math.min(1, t * 6) * (1 - t) : 1 - t);
    }
    for (const k of ['position', 'color', 'size', 'alpha']) this.geo.attributes[k].needsUpdate = true;
  }
  reset() { this.life.fill(0); this.alpha.fill(0); }
}

class Skids {
  constructor(scene, cap = 1600) {
    this.cap = cap; this.head = 0;
    this.pos = new Float32Array(cap * 18);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.last = new Map();
  }
  mark(id, x, z, dx, dz, active) {
    const prev = this.last.get(id);
    if (!active) { this.last.delete(id); return; }
    const w = 0.16, nx = -dz * w, nz = dx * w, y = 0.045;
    const cur = { lx: x + nx, lz: z + nz, rx: x - nx, rz: z - nz };
    if (prev && (x - prev.x) ** 2 + (z - prev.z) ** 2 > 0.25) {
      if ((x - prev.x) ** 2 + (z - prev.z) ** 2 < 16) {
        const o = this.head * 18; this.head = (this.head + 1) % this.cap;
        const P = this.pos;
        P.set([prev.lx, y, prev.lz, prev.rx, y, prev.rz, cur.lx, y, cur.lz, prev.rx, y, prev.rz, cur.rx, y, cur.rz, cur.lx, y, cur.lz], o);
        this.geo.attributes.position.needsUpdate = true;
      }
      this.last.set(id, { x, z, ...cur });
    } else if (!prev) this.last.set(id, { x, z, ...cur });
  }
  reset() { this.pos.fill(0); this.geo.attributes.position.needsUpdate = true; this.last.clear(); }
}

class Streaks {
  constructor(camera, count = 110) {
    this.count = count;
    this.seed = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) this.respawn(i, -4 - Math.random() * 80);
    this.pos = new Float32Array(count * 6);
    const col = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const c = Math.random() < 0.3 ? [1, 0.4, 0.9] : [0.6, 0.95, 1];
      col.set([...c, 0, 0, 0], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geo = g;
    this.mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.lines = new THREE.LineSegments(g, this.mat);
    this.lines.frustumCulled = false;
    camera.add(this.lines);
  }
  respawn(i, z) {
    const a = Math.random() * Math.PI * 2, r = 2.2 + Math.random() * 7;
    this.seed[i * 3] = Math.cos(a) * r; this.seed[i * 3 + 1] = Math.sin(a) * r * 0.7; this.seed[i * 3 + 2] = z;
  }
  update(dt, speed, intensity) {
    this.mat.opacity += (intensity - this.mat.opacity) * Math.min(1, dt * 6);
    this.lines.visible = this.mat.opacity > 0.01;
    if (!this.lines.visible) return;
    const len = 1 + speed * 0.12;
    for (let i = 0; i < this.count; i++) {
      this.seed[i * 3 + 2] += speed * 1.6 * dt;
      if (this.seed[i * 3 + 2] > -2) this.respawn(i, -60 - Math.random() * 25);
      const x = this.seed[i * 3], y = this.seed[i * 3 + 1], z = this.seed[i * 3 + 2];
      this.pos.set([x, y, z, x, y, z - len], i * 6);
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

const C = (r, g, b) => ({ r, g, b });
const SPARK0 = C(4, 3, 1.4), SPARK1 = C(2.5, 0.6, 0.1);
const FLAME0 = C(1.6, 2.2, 4), FLAME1 = C(3, 0.7, 0.15);
const SMOKE0 = C(0.55, 0.55, 0.62), SMOKE1 = C(0.25, 0.24, 0.3);
const DUST0 = C(0.42, 0.36, 0.34), DUST1 = C(0.2, 0.17, 0.18);

export function createFx(scene, camera) {
  const sparks = new Pool(scene, 900, true);
  const flames = new Pool(scene, 700, true);
  const smoke = new Pool(scene, 700, false);
  const skids = new Skids(scene);
  const streaks = new Streaks(camera);
  const R = Math.random;
  return {
    sparks(x, y, z, nx, nz, vx, vz, n) {
      for (let k = 0; k < n; k++) {
        sparks.emit(x, y + R() * 0.6, z,
          vx * 0.6 - nx * (2 + R() * 6) + (R() - 0.5) * 6, 1.5 + R() * 5, vz * 0.6 - nz * (2 + R() * 6) + (R() - 0.5) * 6,
          0.25 + R() * 0.4, 0.22, 0.05, SPARK0, SPARK1, 1, 14, 1.5);
      }
    },
    flame(x, y, z, dx, dz, vx, vz) {
      for (let k = 0; k < 2; k++) {
        const sp = 8 + R() * 6;
        flames.emit(x + (R() - 0.5) * 0.1, y + (R() - 0.5) * 0.1, z, vx - dx * sp + (R() - 0.5), (R() - 0.2) * 1.2, vz - dz * sp + (R() - 0.5),
          0.12 + R() * 0.12, 0.75, 0.2, FLAME0, FLAME1, 1, -2, 4);
      }
    },
    smoke(x, z, vx, vz, dust = false) {
      smoke.emit(x + (R() - 0.5) * 0.4, 0.25, z + (R() - 0.5) * 0.4, vx * 0.3 + (R() - 0.5) * 2, 0.6 + R(), vz * 0.3 + (R() - 0.5) * 2,
        1.1 + R() * 0.9, 1.0, 4.5, dust ? DUST0 : SMOKE0, dust ? DUST1 : SMOKE1, dust ? 0.32 : 0.4, -0.4, 1.2, true);
    },
    skid: (id, x, z, dx, dz, active) => skids.mark(id, x, z, dx, dz, active),
    /** pointScale = viewport height / 2 / tan(fov / 2), so particle sizes are in metres. */
    update(dt, speed, streakIntensity, pointScale) {
      for (const p of [sparks, flames, smoke]) { p.uniforms.scale.value = pointScale; p.update(dt); }
      streaks.update(dt, speed, streakIntensity);
    },
    reset() { sparks.reset(); flames.reset(); smoke.reset(); skids.reset(); },
  };
}
