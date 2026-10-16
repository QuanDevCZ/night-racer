// Bootstrap + game loop: fixed-step simulation, interpolated rendering, camera, state machine.
import * as THREE from 'three';
import { buildTrack } from './core/track.js';
import { CONTROL_POINTS } from './core/layout.js';
import { createRace, stepRace, respawn, positionOf } from './core/sim.js';
import { gearbox, loopAngle } from './core/physics.js';
import { buildWorld } from './world.js';
import { buildCar } from './cars.js';
import { createFx } from './fx.js';
import { createPost } from './post.js';
import { createAudio } from './audio.js';
import { createHud, fmt } from './hud.js';
import { createInput } from './input.js';

const DT = 1 / 120;
const MIN_PR = 0.5;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

try { await document.fonts.load('700 40px "Chakra Petch"'); } catch { /* offline: fall back */ }

// --- Renderer / scene -------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const MAX_PR = Math.min(devicePixelRatio, 1.5);
let pixelRatio = Math.min(MAX_PR, 1);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 5000);
scene.add(camera);

const track = buildTrack(CONTROL_POINTS);
const world = buildWorld(renderer, scene, track);
const fx = createFx(scene, camera);
const post = createPost(renderer, scene, camera);
const audio = createAudio();
const hud = createHud(track);
const input = createInput();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
});

// --- Race objects -----------------------------------------------------------------------
let race = null, views = null, prev = null;
function newRace() {
  race = createRace(track);
  if (!views) {
    views = race.profiles.map((p) => buildCar(p.color, { player: p.player, name: p.name }));
    views.forEach((v) => scene.add(v.root));
  }
  prev = race.cars.map((c) => ({ x: c.x, z: c.z, h: c.heading }));
  fx.reset();
}

// --- State ------------------------------------------------------------------------------
const ui = { menu: $('menu'), pause: $('pause'), results: $('results'), resultsBody: $('results-body'), resultsTitle: $('results-title') };
let state = 'menu';          // menu | countdown | racing | finished | paused
let pausedFrom = null;
let countdown = 0, lastCount = 0, goT = 0, finishT = 0, resultsShown = false;
let camMode = 0;             // 0 chase, 1 bumper
let acc = 0, scrape = 0, shake = 0, boostAmt = 0, lastGear = 1, warnT = 0;
const cam = { yaw: 0, fov: 62, look: new THREE.Vector3() };
const playerInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };

function show(el, v) { el.classList.toggle('hidden', !v); }

function startRace() {
  audio.init();
  audio.click();
  newRace();
  state = 'countdown';
  countdown = 3.999; lastCount = 4; goT = 0; finishT = 0; resultsShown = false;
  world.setStartLights(0);
  show(ui.menu, false); show(ui.results, false); show(ui.pause, false);
  hud.show(true);
  snapCamera();
}

function toMenu() {
  state = 'menu';
  show(ui.menu, true); show(ui.results, false); show(ui.pause, false);
  hud.show(false);
  newRace();
  world.setStartLights(0);
}

function setPaused(p) {
  if (p && (state === 'racing' || state === 'countdown')) { pausedFrom = state; state = 'paused'; show(ui.pause, true); }
  else if (!p && state === 'paused') { state = pausedFrom; show(ui.pause, false); acc = 0; }
}

$('btn-start').addEventListener('click', startRace);
$('btn-resume').addEventListener('click', () => setPaused(false));
$('btn-restart').addEventListener('click', startRace);
$('btn-quit').addEventListener('click', toMenu);
$('btn-again').addEventListener('click', startRace);
$('btn-menu').addEventListener('click', toMenu);
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });

// --- Events from the simulation --------------------------------------------------------
function camDist(x, z) { return Math.hypot(camera.position.x - x, camera.position.z - z); }

function handle(events) {
  const pi = race.playerIndex;
  for (const e of events) {
    if (e.type === 'wall') {
      const near = camDist(e.x, e.z) < 60;
      if (near && e.scrape > 4) {
        const c = race.cars[e.car];
        fx.sparks(e.x, 0.5, e.z, e.nx, e.nz, c.vx, c.vz, Math.min(4, Math.ceil(e.scrape / 14)));
      }
      if (e.car === pi) {
        scrape = Math.max(scrape, clamp(e.scrape / 30, 0, 1));
        if (e.impact > 5) { audio.impact(e.impact); shake = Math.max(shake, clamp(e.impact * 0.025, 0, 0.6)); }
      } else if (near && e.impact > 6) audio.impact(e.impact * 0.4);
    } else if (e.type === 'bump') {
      fx.sparks(e.x, 0.6, e.z, 0, 0, 0, 0, Math.min(14, Math.ceil(e.impact * 1.5)));
      if (e.car === pi || e.other === pi) { audio.impact(e.impact * 2); shake = Math.max(shake, clamp(e.impact * 0.06, 0, 0.5)); }
    } else if (e.type === 'boost') {
      if (e.car === pi) { audio.boost(); shake = Math.max(shake, 0.25); }
    } else if (e.type === 'race' && e.car === pi && state === 'racing') {
      const r = race.racers[pi];
      if (e.event === 'checkpoint') {
        audio.checkpoint();
        hud.split(`CHECKPOINT ${r.nextCp - 1}/${r.K - 1} &nbsp;<b>${fmt(race.time - r.lapStart)}</b>`);
      } else if (e.event === 'lap') {
        audio.lap();
        const t = r.lapTimes.at(-1), isBest = t <= r.best;
        hud.banner(r.lap === r.laps ? 'FINAL LAP' : `LAP ${r.lap}`, r.lap === r.laps ? 'final' : '');
        hud.split(`LAP ${fmt(t)}${isBest ? ' &nbsp;<b class="best">BEST</b>' : ''}`, isBest ? 'best' : '');
      } else if (e.event === 'finish') {
        audio.finish();
        const p = positionOf(race, pi);
        hud.banner(`FINISHED  P${p}`, p === 1 ? 'win' : 'final', 4);
        hud.split(`TOTAL ${fmt(r.finishTime)} &nbsp; BEST LAP <b>${fmt(r.best)}</b>`);
        state = 'finished'; finishT = 0;
      }
    }
  }
}

// --- Results ---------------------------------------------------------------------------
function renderResults() {
  const leader = race.racers[race.order[0]];
  ui.resultsBody.innerHTML = race.order.map((i, k) => {
    const r = race.racers[i], p = race.profiles[i];
    const total = r.finished ? fmt(r.finishTime) : `+${Math.max(0, leader.dist - r.dist).toFixed(0)} m`;
    const color = '#' + p.color.toString(16).padStart(6, '0');
    return `<tr class="${p.player ? 'me' : ''}"><td>${k + 1}</td><td style="color:${color}">${p.name}</td><td>${total}</td><td>${fmt(r.best)}</td></tr>`;
  }).join('');
  const p = positionOf(race, race.playerIndex);
  ui.resultsTitle.textContent = p === 1 ? 'VICTORY' : `P${p} FINISH`;
}

// --- Camera ----------------------------------------------------------------------------
function carPose(i, alpha) {
  const c = race.cars[i], p = prev[i];
  return { x: p.x + (c.x - p.x) * alpha, z: p.z + (c.z - p.z) * alpha, h: p.h + loopAngle(c.heading - p.h) * alpha };
}

function snapCamera() {
  const c = race.cars[race.playerIndex];
  cam.yaw = c.heading;
  camera.position.set(c.x - Math.sin(c.heading) * 7, 2.6, c.z - Math.cos(c.heading) * 7);
}

function updateCamera(dt, alpha) {
  if (state === 'menu') {
    // Attract mode: drift around the leader of the demo race.
    const lead = race.order[0], p = carPose(lead, alpha);
    const t = performance.now() / 1000;
    const a = p.h + Math.PI + Math.sin(t * 0.25) * 1.2;
    const want = new THREE.Vector3(p.x + Math.sin(a) * 11, 3.2 + Math.sin(t * 0.4), p.z + Math.cos(a) * 11);
    camera.position.lerp(want, 1 - Math.exp(-3 * dt));
    cam.look.set(p.x, 1, p.z);
    camera.lookAt(cam.look);
    cam.fov += (58 - cam.fov) * (1 - Math.exp(-3 * dt));
  } else {
    const i = race.playerIndex, c = race.cars[i], p = carPose(i, alpha);
    const v = c.speed;
    if (camMode === 0) {
      let target = p.h;
      if (v > 4) target = p.h + loopAngle(Math.atan2(c.vx, c.vz) - p.h) * 0.45; // lag into drifts
      cam.yaw += loopAngle(target - cam.yaw) * (1 - Math.exp(-7 * dt));
      const dist = 6.6 + Math.abs(v) * 0.022 + boostAmt * 1.1;
      const h = 2.35 + Math.abs(v) * 0.004;
      camera.position.set(p.x - Math.sin(cam.yaw) * dist, h, p.z - Math.cos(cam.yaw) * dist);
      cam.look.set(p.x + Math.sin(cam.yaw) * 5, 1.1, p.z + Math.cos(cam.yaw) * 5);
    } else {
      cam.yaw = p.h;
      camera.position.set(p.x + Math.sin(p.h) * 0.4, 1.22, p.z + Math.cos(p.h) * 0.4);
      cam.look.set(p.x + Math.sin(p.h) * 20, 1.0, p.z + Math.cos(p.h) * 20);
    }
    if (shake > 0.001) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake * 0.6;
      camera.position.z += (Math.random() - 0.5) * shake;
    }
    camera.lookAt(cam.look);
    const fovT = 62 + clamp(Math.abs(v) / 80, 0, 1) * 13 + boostAmt * 10;
    cam.fov += (fovT - cam.fov) * (1 - Math.exp(-4 * dt));
  }
  shake *= Math.exp(-7 * dt);
  camera.fov = cam.fov;
  camera.updateProjectionMatrix();
}

// --- Per-frame visuals ------------------------------------------------------------------
const tmp = new THREE.Vector3();
function updateVisuals(dt, alpha) {
  race.cars.forEach((c, i) => {
    const v = views[i], p = carPose(i, alpha);
    v.update(c, p.x, p.z, p.h, dt);
    v.root.updateMatrixWorld();
    const fx0 = Math.sin(p.h), fz0 = Math.cos(p.h);
    const near = camDist(p.x, p.z) < 140;
    if (!near) return;
    if (c.boosting) {
      for (const e of v.exhausts) {
        tmp.copy(e); v.root.localToWorld(tmp);
        fx.flame(tmp.x, tmp.y, tmp.z, fx0, fz0, c.vx, c.vz);
      }
    }
    const speed = Math.hypot(c.vx, c.vz);
    const sliding = (c.drifting || (c.input && c.input.handbrake)) && speed > 6 && Math.abs(c.slip) > 0.1;
    const dust = c.offroad && speed > 8;
    v.rearWheels.forEach((w, k) => {
      tmp.copy(w); v.root.localToWorld(tmp);
      if (sliding && Math.random() < 0.7) fx.smoke(tmp.x, tmp.z, c.vx, c.vz);
      if (dust && Math.random() < 0.5) fx.smoke(tmp.x, tmp.z, c.vx, c.vz, true);
      const len = speed || 1;
      fx.skid(i * 2 + k, tmp.x, tmp.z, c.vx / len, c.vz / len, sliding && !c.offroad);
    });
  });
}

// --- Adaptive resolution: integrated GPUs drop the pixel ratio instead of the frame rate. ---
const perf = { sum: 0, frames: 0 };
function adaptResolution(dt) {
  perf.sum += dt; perf.frames++;
  if (perf.sum < 1.2) return;
  const ms = (perf.sum / perf.frames) * 1000;
  perf.sum = 0; perf.frames = 0;
  let next = pixelRatio;
  if (ms > 21 && pixelRatio > MIN_PR) next = Math.max(MIN_PR, pixelRatio - (ms > 30 ? 0.2 : 0.1));
  else if (ms < 13 && pixelRatio < MAX_PR) next = Math.min(MAX_PR, pixelRatio + 0.05);
  if (next !== pixelRatio) {
    pixelRatio = next;
    renderer.setPixelRatio(pixelRatio);
    post.setPixelRatio(pixelRatio);
  }
}

// --- Main loop ----------------------------------------------------------------------------
newRace();
snapCamera();
hud.show(false);
let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const fired = input.poll();

  if (fired.mute) $('mute').classList.toggle('on', audio.toggleMute());
  if (state === 'menu') {
    if (fired.confirm) startRace();
  } else if (state === 'paused') {
    if (fired.pause || fired.confirm) setPaused(false);
    else if (fired.respawn) startRace();
  } else {
    if (fired.pause) setPaused(true);
    if (fired.camera) { camMode = 1 - camMode; audio.click(); }
    if (fired.respawn && state === 'racing') { respawn(race, race.playerIndex); scrape = 0; }
    if (state === 'finished' && resultsShown && fired.confirm) startRace();
  }

  // Countdown.
  if (state === 'countdown') {
    countdown -= dt;
    const n = Math.ceil(countdown);
    if (n !== lastCount && n > 0) {
      lastCount = n;
      audio.countdown(false);
      hud.banner(String(n), 'count', 0.9);
      world.setStartLights(Math.min(5, (4 - n) * 2 - 1));
    }
    if (countdown <= 0) {
      state = 'racing'; goT = 2;
      audio.countdown(true);
      hud.banner('GO!', 'go', 1);
      world.setStartLights(5, true);
    }
  }
  if (goT > 0) { goT -= dt; if (goT <= 0) world.setStartLights(0); }

  // Simulation.
  const pi = race.playerIndex;
  const running = state !== 'paused';
  if (running) {
    const s = input.state;
    playerInput.throttle = s.throttle; playerInput.brake = s.brake; playerInput.steer = s.steer;
    playerInput.handbrake = s.handbrake;
    playerInput.boost = state === 'racing' && s.boost;
    acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 8) {
      race.cars.forEach((c, i) => { prev[i].x = c.x; prev[i].z = c.z; prev[i].h = c.heading; });
      const frozen = state === 'countdown';
      handle(stepRace(race, state === 'menu' ? null : playerInput, DT, frozen));
      playerInput.boost = false; // edge-triggered: one charge per press
      acc -= DT; steps++;
    }
    if (steps === 8) acc = 0;
  }
  const alpha = running ? acc / DT : 1;

  // Finish → results after a beat, refreshed while the AI completes its laps.
  if (state === 'finished') {
    finishT += dt;
    if (finishT > 3.5) {
      if (!resultsShown) { resultsShown = true; show(ui.results, true); }
      if (Math.floor(finishT * 4) !== Math.floor((finishT - dt) * 4)) renderResults();
    }
  }

  const player = race.cars[pi], pr = race.racers[pi];
  boostAmt += ((player.boosting && state !== 'menu' ? 1 : 0) - boostAmt) * (1 - Math.exp(-6 * dt));

  if (running) updateVisuals(dt, alpha);
  updateCamera(dt, alpha);
  world.update(now / 1000);

  // Speed effects.
  const v = Math.abs(player.speed);
  const inRace = state !== 'menu';
  post.setSpeed(inRace ? clamp((v - 30) / 50, 0, 1) * 0.35 + boostAmt * 0.75 : 0);
  const pointScale = (renderer.domElement.height / renderer.getPixelRatio()) * 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  fx.update(running ? dt : 0, inRace ? v : 0, inRace ? boostAmt * 0.85 + clamp((v - 50) / 30, 0, 1) * 0.2 : 0, pointScale);

  // Sound.
  const g = gearbox(player.speed);
  if (inRace && g.gear > lastGear && g.gear > 1) audio.shift();
  lastGear = g.gear;
  const slip = (player.drifting || player.input?.handbrake) ? clamp((Math.abs(player.slip) - 0.06) * 3, 0, 1) * clamp(Math.hypot(player.vx, player.vz) / 15, 0, 1) : 0;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  audio.update({
    active: inRace && running,
    rpm: state === 'countdown' ? 0.15 + input.state.throttle * 0.75 : g.rpm,
    throttle: input.state.throttle, speed: player.speed, slip, scrape,
    offroad: player.offroad, boosting: player.boosting,
    ai: race.cars.filter((_, i) => i !== pi).map((c) => {
      const dx = c.x - camera.position.x, dz = c.z - camera.position.z, d = Math.hypot(dx, dz) || 1;
      return { dist: d, pan: (dx * right.x + dz * right.z) / d, rpm: gearbox(c.speed).rpm, throttle: c.input ? c.input.throttle : 0 };
    }),
  });
  scrape *= Math.exp(-10 * dt);

  // Wrong-way warning beeps.
  if (state === 'racing' && pr.wrongWay) { warnT -= dt; if (warnT <= 0) { audio.warn(); warnT = 1.2; } } else warnT = 0;

  if (inRace) hud.update(race, dt, { boostActive: player.boosting });
  post.render();
  adaptResolution(dt);
}
requestAnimationFrame(frame);
$('loading').remove();
// Debug handle for the console: __nr.race, __nr.state.
window.__nr = { get race() { return race; }, get state() { return state; }, get pixelRatio() { return pixelRatio; }, renderer };
