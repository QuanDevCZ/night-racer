// Procedural low-poly street racer. Local frame: +z forward, +x = driver's left, y up.
import * as THREE from 'three';
import { radialTex } from './world.js';

let shared = null;
function sharedAssets() {
  if (shared) return shared;
  const wheelGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.32, 14).rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.34, 6).rotateZ(Math.PI / 2);
  shared = {
    wheelGeo, rimGeo,
    tire: new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.85 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x9a9aa8, metalness: 1, roughness: 0.25 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x080a12, metalness: 0.9, roughness: 0.06, clearcoat: 1 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x111116, roughness: 0.6, metalness: 0.4 }),
    head: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.2, 3.6), toneMapped: false }),
    glow: radialTex(),
    shadow: radialTex([[0, 'rgba(0,0,0,0.85)'], [0.6, 'rgba(0,0,0,0.5)'], [1, 'rgba(0,0,0,0)']]),
    beam: radialTex([[0, 'rgba(255,250,235,0.9)'], [0.5, 'rgba(255,245,220,0.35)'], [1, 'rgba(255,240,210,0)']]),
  };
  return shared;
}

function shapedBox(w, h, d, shape) {
  const g = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = shape(p.getX(i), p.getY(i), p.getZ(i));
    p.setXYZ(i, v[0], v[1], v[2]);
  }
  g.computeVertexNormals();
  return g;
}

function nameTag(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '700 38px "Chakra Petch", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = 12;
  g.fillStyle = color; g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
  s.scale.set(3.2, 0.8, 1);
  s.position.y = 2.4;
  return s;
}

export function buildCar(color, { player = false, name = '' } = {}) {
  const A = sharedAssets();
  const col = new THREE.Color(color);
  const css = '#' + col.getHexString();
  const paint = new THREE.MeshPhysicalMaterial({ color: col, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
  const neon = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2.4), toneMapped: false });
  const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 0.05, 0.08), toneMapped: false });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // Chassis with a sloped nose and tapered tail.
  const chassis = new THREE.Mesh(shapedBox(1.94, 0.52, 4.4, (x, y, z) => {
    if (y > 0 && z > 0) y -= 0.2 * (z / 2.2);
    if (y > 0 && z < -1.6) y -= 0.06;
    if (z > 1.8) x *= 0.92;
    return [x, y, z];
  }), paint);
  chassis.position.y = 0.58;
  body.add(chassis);

  // Cabin (glass) with a painted roof.
  const cabin = new THREE.Mesh(shapedBox(1.6, 0.5, 2.1, (x, y, z) => {
    if (y > 0) { x *= 0.8; z = z > 0 ? z * 0.45 - 0.15 : z * 0.75; }
    return [x, y, z];
  }), A.glass);
  cabin.position.set(0, 1.08, -0.35);
  body.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.05, 1.15), paint);
  roof.position.set(0, 1.345, -0.55);
  body.add(roof);

  // Side neon strips, splitter, spoiler.
  for (const s of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 3.2), neon);
    strip.position.set(s * 0.985, 0.42, 0);
    body.add(strip);
  }
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.3), A.dark);
  splitter.position.set(0, 0.3, 2.15);
  body.add(splitter);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.45), paint);
  wing.position.set(0, 1.18, -2.0);
  body.add(wing);
  for (const s of [-0.6, 0.6]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.2), A.dark);
    post.position.set(s, 1.0, -2.0);
    body.add(post);
  }

  // Lights.
  for (const s of [-0.6, 0.6]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.06), A.head);
    hl.position.set(s, 0.66, 2.12);
    body.add(hl);
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.25, 8).rotateX(Math.PI / 2), A.dark);
    ex.position.set(s * 0.7, 0.34, -2.2);
    body.add(ex);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.09, 0.05), tailMat);
  tail.position.set(0, 0.74, -2.2);
  body.add(tail);

  // Wheels: front pair inside steering pivots.
  const wheels = [], pivots = [];
  for (const [x, z] of [[0.9, 1.36], [-0.9, 1.36], [0.9, -1.36], [-0.9, -1.36]]) {
    const w = new THREE.Group();
    w.add(new THREE.Mesh(A.wheelGeo, A.tire), new THREE.Mesh(A.rimGeo, A.rim));
    if (z > 0) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.37, z);
      pivot.add(w);
      root.add(pivot);
      pivots.push(pivot);
    } else {
      w.position.set(x, 0.37, z);
      root.add(w);
    }
    wheels.push(w);
  }

  // Underglow, contact shadow, fake headlight pool on the road.
  const under = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 6).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: A.glow, color: col, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  under.position.y = 0.06;
  root.add(under);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 5.2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: A.shadow, transparent: true, depthWrite: false }));
  shadow.position.y = 0.05;
  root.add(shadow);
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(6, 18).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: A.beam, transparent: true, opacity: player ? 0.25 : 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.position.set(0, 0.07, 11);
  root.add(beam);

  if (player) {
    const spot = new THREE.SpotLight(0xfff4e0, 300, 90, 0.55, 0.6, 1.3);
    spot.position.set(0, 0.9, 1.8);
    spot.target.position.set(0, 0, 25);
    root.add(spot, spot.target);
  } else if (name) {
    root.add(nameTag(name, css));
  }

  const view = {
    root, body, tailMat, css,
    exhausts: [new THREE.Vector3(0.42, 0.34, -2.35), new THREE.Vector3(-0.42, 0.34, -2.35)],
    rearWheels: [new THREE.Vector3(0.9, 0.02, -1.36), new THREE.Vector3(-0.9, 0.02, -1.36)],
    pitch: 0, roll: 0, lastSpeed: 0,
  };

  /** Pose from interpolated physics state; dt drives wheel spin and body motion. */
  view.update = (car, x, z, heading, dt) => {
    root.position.set(x, 0, z);
    root.rotation.y = heading;
    const accel = dt > 0 ? (car.speed - view.lastSpeed) / dt : 0;
    view.lastSpeed = car.speed;
    const lat = car.yawRate * car.speed;
    const k = 1 - Math.exp(-dt * 8);
    view.roll += (Math.max(-0.07, Math.min(0.07, -lat * 0.0028)) - view.roll) * k;
    view.pitch += (Math.max(-0.05, Math.min(0.05, -accel * 0.0022)) - view.pitch) * k;
    body.rotation.set(view.pitch, 0, view.roll);
    body.position.y = Math.sin(performance.now() * 0.03 + x) * Math.min(0.012, Math.abs(car.speed) * 0.0003);
    const spin = (car.speed / 0.37) * dt;
    for (const w of wheels) w.rotation.x += spin;
    for (const p of pivots) p.rotation.y = -car.steer * 0.5;
    const braking = car.input && car.input.brake > 0 && car.speed > 0.5;
    tailMat.color.setRGB(braking ? 4 : 1.4, braking ? 0.15 : 0.05, braking ? 0.2 : 0.08);
  };
  return view;
}
