// The night city: road, curbs, sidewalks, neon barriers, start gantry, street lights,
// billboards, skyscrapers, mountains, sky. Everything is generated from the track + a seed.
import * as THREE from 'three';
import { frameAt, nearest } from './core/track.js';
import { ROAD_HALF, CURB_W, WALL } from './core/layout.js';
import { makeRng } from './core/rng.js';

const NEON_L = new THREE.Color(0x00e5ff);
const NEON_R = new THREE.Color(0xff2bd6);

function canvasTex(w, h, draw, { repeat = true, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function radialTex(stops = [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]) {
  return canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, { repeat: false });
}

/** Flat strip between two lateral offsets, one quad per sample (non-indexed so colours stay crisp). */
function ribbon(track, latA, latB, y, { vScale = 10, uSpan = 1, color = null, every = 1 } = {}) {
  const pos = [], uv = [], col = [], f0 = {}, f1 = {};
  for (let i = 0; i < track.N; i += every) {
    const j = i + every;
    frameAt(track, i * track.ds, f0);
    frameAt(track, j * track.ds, f1);
    const v0 = (i * track.ds) / vScale, v1 = (j * track.ds) / vScale;
    const P = (f, lat) => [f.x + f.nx * lat, y, f.z + f.nz * lat];
    const a0 = P(f0, latA), b0 = P(f0, latB), a1 = P(f1, latA), b1 = P(f1, latB);
    pos.push(...a0, ...b0, ...a1, ...b0, ...b1, ...a1);
    uv.push(0, v0, uSpan, v0, 0, v1, uSpan, v0, uSpan, v1, 0, v1);
    if (color) { const c = color(i); for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Vertical strip at a lateral offset (barrier faces, neon tubes). */
function wallStrip(track, lat, y0, y1, uScale = 4) {
  const pos = [], uv = [], f0 = {}, f1 = {};
  for (let i = 0; i < track.N; i++) {
    frameAt(track, i * track.ds, f0);
    frameAt(track, (i + 1) * track.ds, f1);
    const x0 = f0.x + f0.nx * lat, z0 = f0.z + f0.nz * lat, x1 = f1.x + f1.nx * lat, z1 = f1.z + f1.nz * lat;
    const u0 = (i * track.ds) / uScale, u1 = ((i + 1) * track.ds) / uScale;
    pos.push(x0, y0, z0, x1, y0, z1, x0, y1, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0);
    uv.push(u0, 0, u1, 0, u0, 1, u1, 0, u1, 1, u0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function roadTextures(rng) {
  // 512 px across 15 m of tarmac, one tile = 20 m of road.
  const map = canvasTex(512, 1024, (g, w, h) => {
    g.fillStyle = '#18181f'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = 18 + rng() * 26;
      g.fillStyle = `rgb(${v},${v},${v + 6})`;
      g.fillRect(rng() * w, rng() * h, 2, 2);
    }
    // Wet patches read darker.
    for (let i = 0; i < 6; i++) {
      const x = rng() * w, y = rng() * h, r = 40 + rng() * 90;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(5,5,12,0.55)'); gr.addColorStop(1, 'rgba(5,5,12,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.fillStyle = '#d9d9e0';
    g.fillRect(10, 0, 7, h); g.fillRect(w - 17, 0, 7, h);              // edge lines
    for (const lane of [1 / 3, 2 / 3]) {                              // lane dashes
      for (let y = 0; y < h; y += h / 2) g.fillRect(lane * w - 3, y + 40, 6, h / 4);
    }
  });
  const rough = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = 'rgb(150,150,150)'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) {
      const x = rng() * w, y = rng() * h, r = 20 + rng() * 60;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(25,25,25,1)'); gr.addColorStop(1, 'rgba(25,25,25,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, { srgb: false });
  return { map, rough };
}

function windowTexture(rng) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#050508'; g.fillRect(0, 0, w, h);
    const cell = 32;
    const lit = ['#ffd49a', '#ffc070', '#bcd8ff', '#9fe8ff', '#ff9ad5', '#fff2d0'];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const on = rng() < 0.32;
      g.fillStyle = on ? rng.pick(lit) : `rgb(${14 + rng() * 10},${14 + rng() * 10},${24 + rng() * 10})`;
      g.globalAlpha = on ? 0.55 + rng() * 0.45 : 1;
      g.fillRect(x * cell + 6, y * cell + 7, cell - 12, cell - 13);
    }
    g.globalAlpha = 1;
  });
}

function signTexture(text, color) {
  return canvasTex(512, 160, (g, w, h) => {
    g.fillStyle = '#07060c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = color; g.lineWidth = 6; g.shadowColor = color; g.shadowBlur = 18;
    g.strokeRect(10, 10, w - 20, h - 20);
    g.font = `700 ${text.length > 9 ? 64 : 88}px "Chakra Petch", "Segoe UI", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff'; g.shadowBlur = 26;
    g.fillText(text, w / 2, h / 2 + 4);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = color; g.globalAlpha = 0.55; g.fillRect(0, 0, w, h);
  }, { repeat: false });
}

const SKY_VERT = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }`;
const SKY_FRAG = `varying vec3 vDir;
uniform vec3 zenith; uniform vec3 mid; uniform vec3 horizon; uniform vec3 glow;
void main(){
  float h = vDir.y;
  vec3 c = mix(horizon, mid, smoothstep(0.0, 0.18, h));
  c = mix(c, zenith, smoothstep(0.15, 0.7, h));
  c += glow * exp(-max(h, 0.0) * 22.0) * 0.9;           // city light dome on the horizon
  c = mix(c, horizon * 0.6, smoothstep(0.0, -0.2, h));
  gl_FragColor = vec4(c, 1.0);
}`;

function skyMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      zenith: { value: new THREE.Color(0x03030c) }, mid: { value: new THREE.Color(0x120a2e) },
      horizon: { value: new THREE.Color(0x3a1650) }, glow: { value: new THREE.Color(0xff3d7f) },
    },
  });
}

export function buildWorld(renderer, scene, track, seed = 7) {
  const rng = makeRng(seed);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const world = { animated: [] };

  scene.background = new THREE.Color(0x05040d);
  scene.fog = new THREE.FogExp2(0x160b2a, 0.0021);

  // Sky + stars.
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), skyMaterial());
  sky.renderOrder = -1;
  scene.add(sky);
  const starPos = [];
  for (let i = 0; i < 1400; i++) {
    const th = rng() * Math.PI * 2, y = 0.12 + rng() * 0.88, r = Math.sqrt(1 - y * y);
    starPos.push(Math.cos(th) * r * 2800, y * 2800, Math.sin(th) * r * 2800);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xc8c8ff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 })));
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex([[0, 'rgba(255,250,235,1)'], [0.22, 'rgba(255,245,225,1)'], [0.28, 'rgba(200,190,255,0.35)'], [1, 'rgba(120,100,255,0)']]), fog: false, depthWrite: false }));
  moon.position.set(-1500, 900, -1700); moon.scale.setScalar(520);
  scene.add(moon);

  // Environment map: the sky plus neon panels, so paint and wet tarmac reflect the city.
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial()));
  const panel = (c, x, y, z, s) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.4, 1), new THREE.MeshBasicMaterial({ color: c }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); envScene.add(m);
  };
  panel(new THREE.Color(0xff2bd6).multiplyScalar(3), 30, 8, 10, 14);
  panel(new THREE.Color(0x00e5ff).multiplyScalar(3), -28, 6, -14, 16);
  panel(new THREE.Color(0xffb060).multiplyScalar(2.5), 6, 14, -32, 18);
  panel(new THREE.Color(0xffffff).multiplyScalar(1.5), -10, 20, 26, 10);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();

  // Lighting: cold moon + city bounce. Cars carry their own lights.
  scene.add(new THREE.HemisphereLight(0x6a6cff, 0x1a0820, 0.55));
  const moonLight = new THREE.DirectionalLight(0x9aa4ff, 0.45);
  moonLight.position.set(-300, 400, -300);
  scene.add(moonLight);

  // Ground.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0x0b0a12, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05;
  scene.add(ground);

  // Road.
  const { map, rough } = roadTextures(rng);
  map.anisotropy = rough.anisotropy = maxAniso;
  const road = new THREE.Mesh(ribbon(track, -ROAD_HALF, ROAD_HALF, 0, { vScale: 20 }),
    new THREE.MeshStandardMaterial({ map, roughnessMap: rough, roughness: 1, metalness: 0.15, envMapIntensity: 1.3 }));
  scene.add(road);

  // Curbs: red/white on corners, grey gutter on straights.
  const isCorner = (i) => {
    for (let k = -6; k <= 6; k++) if (Math.abs(track.curvature[(i + k + track.N) % track.N]) > 0.011) return true;
    return false;
  };
  const red = new THREE.Color(0xc4142c), white = new THREE.Color(0xe8e8ee), grey = new THREE.Color(0x2a2a33);
  const curbColor = (i) => (isCorner(i) ? (Math.floor(i / 2) % 2 ? red : white) : grey);
  const curbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 });
  for (const s of [-1, 1]) {
    const a = s * ROAD_HALF, b = s * (ROAD_HALF + CURB_W);
    scene.add(new THREE.Mesh(ribbon(track, Math.min(a, b), Math.max(a, b), 0.02, { color: curbColor }), curbMat));
  }

  // Sidewalk / run-off between curb and barrier.
  const tile = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#25232c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) { const v = 30 + rng() * 20; g.fillStyle = `rgb(${v},${v},${v + 8})`; g.fillRect(rng() * w, rng() * h, 1, 1); }
    g.strokeStyle = '#141219'; g.lineWidth = 3; g.strokeRect(0, 0, w, h);
  });
  const sideMat = new THREE.MeshStandardMaterial({ map: tile, roughness: 0.85 });
  const sideW = WALL - ROAD_HALF - CURB_W;
  for (const s of [-1, 1]) {
    const a = s * (ROAD_HALF + CURB_W), b = s * WALL;
    scene.add(new THREE.Mesh(ribbon(track, Math.min(a, b), Math.max(a, b), 0.01, { vScale: 3, uSpan: sideW / 3 }), sideMat));
  }

  // Barriers: concrete face, cap, and a neon tube along each side (cyan left, magenta right).
  const concrete = canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#3a3842'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 800; i++) { const v = 45 + rng() * 25; g.fillStyle = `rgb(${v},${v},${v + 6})`; g.fillRect(rng() * w, rng() * h, 1, 1); }
    g.fillStyle = '#25232b'; g.fillRect(0, 0, 2, h);
    g.fillStyle = '#d8c020'; for (let x = 0; x < w; x += 32) { g.save(); g.translate(x, h - 14); g.transform(1, 0, -0.8, 1, 0, 0); g.fillRect(0, 0, 14, 14); g.restore(); }
  });
  const barrierMat = new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.8, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    scene.add(new THREE.Mesh(wallStrip(track, s * WALL, 0, 1.1), barrierMat));
    scene.add(new THREE.Mesh(wallStrip(track, s * (WALL + 0.5), 0, 1.1), barrierMat));
    scene.add(new THREE.Mesh(ribbon(track, Math.min(s * WALL, s * (WALL + 0.5)), Math.max(s * WALL, s * (WALL + 0.5)), 1.1, { vScale: 4 }), barrierMat));
    const neon = new THREE.MeshBasicMaterial({ color: (s < 0 ? NEON_L : NEON_R).clone().multiplyScalar(2.6), side: THREE.DoubleSide, toneMapped: false });
    scene.add(new THREE.Mesh(wallStrip(track, s * (WALL - 0.03), 0.72, 0.84), neon));
    // Wet-ground spill of the neon tube.
    const spillMat = new THREE.MeshBasicMaterial({ color: s < 0 ? NEON_L : NEON_R, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, map: canvasTex(4, 64, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, { repeat: false }) });
    const spillGeo = ribbon(track, Math.min(s * (WALL - 3.2), s * (WALL - 0.02)), Math.max(s * (WALL - 3.2), s * (WALL - 0.02)), 0.03, { vScale: 1e9 });
    // Gradient runs across the strip: brightest at the wall.
    const uv = spillGeo.attributes.uv;
    for (let k = 0; k < uv.count; k++) { const u = uv.getX(k); uv.setXY(k, 0.5, s > 0 ? u : 1 - u); }
    scene.add(new THREE.Mesh(spillGeo, spillMat));
  }

  // Start / finish: checkered line, gantry with five start lights.
  const checker = canvasTex(256, 32, (g, w, h) => {
    for (let x = 0; x < w / 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#eee'; g.fillRect(x * 16, y * 16, 16, 16); }
  });
  const f0 = frameAt(track, 0, {});
  const gantry = new THREE.Group();
  gantry.position.set(f0.x, 0, f0.z); gantry.rotation.y = f0.heading;
  scene.add(gantry);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, 1.6), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.6 }));
  line.rotation.x = -Math.PI / 2; line.position.y = 0.02;
  gantry.add(line);
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2833, roughness: 0.4, metalness: 0.8 });
  for (const s of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 8, 0.9), steel);
    pillar.position.set(s * (WALL + 0.9), 4, 0); gantry.add(pillar);
  }
  const beamTex = checker.clone(); beamTex.needsUpdate = true; beamTex.repeat.set(3, 1);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(WALL * 2 + 2.6, 1.6, 1), [steel, steel, steel, steel, new THREE.MeshStandardMaterial({ map: beamTex }), new THREE.MeshStandardMaterial({ map: beamTex })]);
  beam.position.y = 8; gantry.add(beam);
  const titleSign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.2), new THREE.MeshBasicMaterial({ map: signTexture('NIGHT RACER', '#ff2bd6'), toneMapped: false, color: new THREE.Color(1.8, 1.8, 1.8) }));
  titleSign.position.set(0, 10, -0.2); titleSign.rotation.y = Math.PI; gantry.add(titleSign);
  const lampOff = new THREE.MeshStandardMaterial({ color: 0x220608, roughness: 0.3 });
  const lampRed = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.2, 0.15), toneMapped: false });
  const lampGreen = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 4, 0.6), toneMapped: false });
  const lamps = [];
  for (let k = 0; k < 5; k++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), lampOff);
    m.position.set((k - 2) * 1.3, 6.6, -0.6); gantry.add(m); lamps.push(m);
  }
  world.setStartLights = (count, green = false) => {
    lamps.forEach((m, k) => { m.material = green ? lampGreen : k < count ? lampRed : lampOff; });
  };

  // Street lights: staggered both sides, instanced, each with a warm pool on the road.
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 8, 6); poleGeo.translate(0, 4, 0);
  const armGeo = new THREE.BoxGeometry(0.14, 0.14, 3); armGeo.translate(0, 8, 1.5);
  const headGeo = new THREE.BoxGeometry(0.5, 0.18, 1.0); headGeo.translate(0, 7.9, 2.9);
  const lights = [];
  for (let s = 10; s < track.length - 20; s += 38) lights.push({ s, side: lights.length % 2 ? 1 : -1 });
  const poles = new THREE.InstancedMesh(poleGeo, steel, lights.length);
  const arms = new THREE.InstancedMesh(armGeo, steel, lights.length);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.4, 1.5), toneMapped: false }), lights.length);
  const poolTex = radialTex([[0, 'rgba(255,255,255,0.9)'], [0.4, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(18, 18).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: poolTex, color: 0xffa860, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }), lights.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  const fr = {};
  lights.forEach((L, k) => {
    frameAt(track, L.s, fr);
    const px = fr.x + fr.nx * L.side * (WALL + 1.2), pz = fr.z + fr.nz * L.side * (WALL + 1.2);
    q.setFromAxisAngle(up, Math.atan2(-fr.nx * L.side, -fr.nz * L.side)); // arm points at the road
    m4.compose(new THREE.Vector3(px, 0, pz), q, one);
    poles.setMatrixAt(k, m4); arms.setMatrixAt(k, m4); heads.setMatrixAt(k, m4);
    m4.compose(new THREE.Vector3(fr.x + fr.nx * L.side * (WALL - 2.3), 0.04 + (k % 3) * 0.002, fr.z + fr.nz * L.side * (WALL - 2.3)), new THREE.Quaternion(), one);
    pools.setMatrixAt(k, m4);
  });
  scene.add(poles, arms, heads, pools);

  // Billboards facing oncoming traffic.
  const words = [['RAMEN 24H', '#ff4d6d'], ['NEON', '#00e5ff'], ['HOTEL ★', '#ffcc33'], ['ARCADE', '#b14dff'],
    ['ネオン街', '#ff2bd6'], ['KARAOKE', '#3dff9a'], ['CLUB VOID', '#00b3ff'], ['夜', '#ff5f1f'],
    ['NIGHT MARKET', '#ffd23f'], ['SUSHI', '#ff3b8d'], ['MOTEL', '#4dfff3'], ['GARAGE 77', '#ff7a00']];
  const bbCount = 12;
  for (let k = 0; k < bbCount; k++) {
    const s = ((k + 0.35) / bbCount) * track.length + rng.range(-20, 20);
    const side = k % 2 ? 1 : -1;
    frameAt(track, s, fr);
    const [text, color] = words[k % words.length];
    const g = new THREE.Group();
    g.position.set(fr.x + fr.nx * side * (WALL + 4), 0, fr.z + fr.nz * side * (WALL + 4));
    const dx = -fr.nx * side * 0.75 - fr.tx * 0.65, dz = -fr.nz * side * 0.75 - fr.tz * 0.65;
    g.rotation.y = Math.atan2(dx, dz);
    for (const px of [-4, 4]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 9, 0.4), steel); p.position.set(px, 4.5, -0.3); g.add(p); }
    const face = new THREE.Mesh(new THREE.PlaneGeometry(13, 4.06), new THREE.MeshBasicMaterial({ map: signTexture(text, color), toneMapped: false, color: new THREE.Color(1.7, 1.7, 1.7) }));
    face.position.y = 10.5; g.add(face);
    const back = new THREE.Mesh(new THREE.BoxGeometry(13.4, 4.4, 0.4), steel); back.position.set(0, 10.5, -0.25); g.add(back);
    scene.add(g);
    // Coloured spill on the road below.
    const spill = new THREE.Mesh(new THREE.PlaneGeometry(22, 22).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: poolTex, color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
    spill.position.set(fr.x + fr.nx * side * 5, 0.05, fr.z + fr.nz * side * 5);
    scene.add(spill);
  }

  // Skyscrapers: one merged mesh with world-scaled UVs so windows are the same size everywhere.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.N; i++) { minX = Math.min(minX, track.xs[i]); maxX = Math.max(maxX, track.xs[i]); minZ = Math.min(minZ, track.zs[i]); maxZ = Math.max(maxZ, track.zs[i]); }
  const pos = [], uv = [], roofPos = [], beacons = [];
  const box = (cx, cz, w, d, h) => {
    const off = rng() * 50, x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, TU = 14, TV = 26;
    const quad = (ax, az, bx, bz, len) => {
      pos.push(ax, 0, az, bx, 0, bz, bx, h, bz, ax, 0, az, bx, h, bz, ax, h, az);
      uv.push(off, 0, off + len / TU, 0, off + len / TU, h / TV, off, 0, off + len / TU, h / TV, off, h / TV);
    };
    quad(x0, z1, x1, z1, w); quad(x1, z1, x1, z0, d); quad(x1, z0, x0, z0, w); quad(x0, z0, x0, z1, d);
    roofPos.push(x0, h, z1, x1, h, z1, x1, h, z0, x0, h, z1, x1, h, z0, x0, h, z0);
    if (h > 70) beacons.push(cx, h + 1, cz);
  };
  const near = {};
  const cell = 30;
  for (let x = minX - 380; x < maxX + 380; x += cell) {
    for (let z = minZ - 380; z < maxZ + 380; z += cell) {
      if (rng() < 0.12) continue; // plazas / gaps
      const cx = x + rng.range(-4, 4), cz = z + rng.range(-4, 4);
      const w = rng.range(12, 25), d = rng.range(12, 25);
      nearest(track, cx, cz, -1, near);
      const dist = Math.hypot(cx - near.cx, cz - near.cz);
      if (dist - Math.hypot(w, d) / 2 < WALL + 16) continue;
      const tall = rng() < 0.12 ? rng.range(80, 170) : rng.range(14, 60);
      box(cx, cz, w, d, dist < 60 ? tall * 0.8 + 10 : tall);
    }
  }
  const bGeo = new THREE.BufferGeometry();
  bGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  bGeo.computeVertexNormals();
  const winTex = windowTexture(rng);
  winTex.anisotropy = maxAniso;
  scene.add(new THREE.Mesh(bGeo, new THREE.MeshStandardMaterial({ color: 0x0d0c16, roughness: 0.55, metalness: 0.5, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.95, envMapIntensity: 0.5 })));
  const rGeo = new THREE.BufferGeometry();
  rGeo.setAttribute('position', new THREE.Float32BufferAttribute(roofPos, 3));
  rGeo.computeVertexNormals();
  scene.add(new THREE.Mesh(rGeo, new THREE.MeshStandardMaterial({ color: 0x0a0910, roughness: 0.9 })));
  // Blinking aviation beacons on the towers.
  const bcGeo = new THREE.BufferGeometry();
  bcGeo.setAttribute('position', new THREE.Float32BufferAttribute(beacons, 3));
  const bcMat = new THREE.PointsMaterial({ color: new THREE.Color(4, 0.3, 0.3), size: 3.5, map: radialTex(), transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
  scene.add(new THREE.Points(bcGeo, bcMat));
  world.animated.push((t) => { bcMat.opacity = Math.sin(t * 2.4) > 0.3 ? 1 : 0.08; });

  // Mountains: a dark low-poly ring beyond the city, lit from below by the city haze.
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const mPos = [], mCol = [];
  const lowC = new THREE.Color(0x2a1240), highC = new THREE.Color(0x07061a);
  for (let k = 0; k < 46; k++) {
    const a = (k / 46) * Math.PI * 2 + rng.range(-0.05, 0.05), R = rng.range(1500, 1900);
    const H = rng.range(120, 330);
    const geo = new THREE.ConeGeometry(rng.range(160, 320), H, rng.int(4, 7), 3).toNonIndexed();
    const p = geo.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const y = p.getY(v);
      const h = (y + H / 2) / H;
      const jx = (rng() - 0.5) * 30 * (1 - h), jz = (rng() - 0.5) * 30 * (1 - h);
      mPos.push(p.getX(v) + jx + cx + Math.cos(a) * R, y + H / 2 - 10, p.getZ(v) + jz + cz + Math.sin(a) * R);
      const c = lowC.clone().lerp(highC, Math.min(1, h * 1.4));
      mCol.push(c.r, c.g, c.b);
    }
  }
  const mGeo = new THREE.BufferGeometry();
  mGeo.setAttribute('position', new THREE.Float32BufferAttribute(mPos, 3));
  mGeo.setAttribute('color', new THREE.Float32BufferAttribute(mCol, 3));
  scene.add(new THREE.Mesh(mGeo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })));

  world.center = new THREE.Vector3(cx, 0, cz);
  world.update = (t) => { for (const fn of world.animated) fn(t); };
  return world;
}
