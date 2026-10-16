// Arcade car physics — a kinematic bicycle model with a slip layer on top.
// Heading h: forward = (sin h, cos h) on XZ, right = (-cos h, sin h). steer +1 = turn right.
import { nearest } from './track.js';
import { ROAD_HALF, CURB_W, WALL, CAR_RADIUS } from './layout.js';

export const CAR = {
  wheelbase: 2.6,
  maxSteer: 0.6,         // rad, at walking pace
  latLimit: 30,          // m/s² — steering is capped so v²·tanδ/L never exceeds this
  engineAccel: 19,
  maxSpeed: 60,          // m/s ≈ 216 km/h
  reverseMax: 13,
  reverseAccel: 10,
  brakeDecel: 30,
  rolling: 1.2,
  aero: 0.00045,
  grip: 10,              // 1/s — how fast sideways velocity dies
  driftGrip: 2.6,
  handbrakeGrip: 1.1,
  handbrakeDecel: 7,
  driftYaw: 1.45,        // yaw multiplier while sliding
  driftScrub: 0.22,      // fraction of speed lost per second while drifting
  boostAccel: 22,
  boostMaxSpeed: 80,
  boostTime: 1.7,
  boostCharges: 3,
  boostRecharge: 1 / 14, // charges per second, always
  driftRecharge: 0.28,   // extra charges per second while drifting fast
  offroadDrag: 9,
  offroadTop: 0.55,
  steerRate: 5,          // input smoothing, 1/s
  steerReturn: 8,
};

export function createCar(x, z, heading, params = CAR) {
  return {
    x, z, heading, vx: 0, vz: 0,
    speed: 0,            // signed forward speed
    lateral: 0,          // sideways speed
    steer: 0,            // smoothed steering −1..1
    yawRate: 0,
    drifting: false, slip: 0,
    boost: params.boostCharges, boostTime: 0, boosting: false,
    offroad: false,
    trackHint: -1, track: {},
    p: params,
  };
}

/** Max front-wheel angle at a given speed — keeps lateral acceleration under the grip limit. */
export function maxSteerAt(v, p = CAR) {
  const a = Math.max(Math.abs(v), 1);
  return Math.min(p.maxSteer, Math.atan((p.latLimit * p.wheelbase) / (a * a)));
}

/** Try to fire one boost charge. Returns true if a boost started. */
export function triggerBoost(car) {
  if (car.boost < 1 || car.boostTime > 0) return false;
  car.boost -= 1;
  car.boostTime = car.p.boostTime;
  return true;
}

/**
 * Advance one car by dt. input = { throttle 0..1, brake 0..1, steer −1..1, handbrake bool }.
 * Does not touch walls — call collideWalls afterwards.
 */
export function stepCar(car, input, dt, surfaceOffroad = false) {
  const p = car.p;
  // Smooth steering so a keyboard tap isn't a 0→full-lock snap.
  const target = Math.max(-1, Math.min(1, input.steer || 0));
  const rate = target === 0 || Math.sign(target) !== Math.sign(car.steer) ? p.steerReturn : p.steerRate;
  car.steer += Math.max(-rate * dt, Math.min(rate * dt, target - car.steer));

  const sh = Math.sin(car.heading), ch = Math.cos(car.heading);
  let vf = car.vx * sh + car.vz * ch;    // forward
  let vl = car.vx * -ch + car.vz * sh;   // right
  const throttle = input.throttle || 0, brake = input.brake || 0;

  // Boost timer.
  if (car.boostTime > 0) car.boostTime = Math.max(0, car.boostTime - dt);
  car.boosting = car.boostTime > 0;
  const top = (car.boosting ? p.boostMaxSpeed : p.maxSpeed) * (surfaceOffroad ? p.offroadTop : 1);

  // Longitudinal.
  if (throttle > 0 && vf > -0.5) {
    const r = Math.max(0, vf) / top;
    vf += p.engineAccel * throttle * Math.max(0, 1 - r * r) * dt;
  } else if (throttle > 0) {
    vf = Math.min(0, vf + p.brakeDecel * throttle * dt);          // braking out of reverse
  }
  if (car.boosting) vf += p.boostAccel * dt * Math.max(0, 1 - Math.max(0, vf) / p.boostMaxSpeed);
  if (brake > 0) {
    if (vf > 0.5) vf = Math.max(0, vf - p.brakeDecel * brake * dt);
    else if (throttle === 0) vf = Math.max(-p.reverseMax, vf - p.reverseAccel * brake * dt); // signed reverse
  }
  // Resistance: rolling + aero, plus a soft pull back to top speed after a boost ends.
  const sgn = Math.sign(vf);
  let resist = p.rolling * (throttle > 0 ? 0.3 : 1) + p.aero * vf * vf;
  if (surfaceOffroad && Math.abs(vf) > 4) resist += p.offroadDrag;
  if (Math.abs(vf) > top) resist += (Math.abs(vf) - top) * 1.5;
  vf = sgn * Math.max(0, Math.abs(vf) - resist * dt);

  // Drift state machine: enter with handbrake + steer at speed, hold it while sliding.
  const absV = Math.hypot(vf, vl);
  if (input.handbrake && Math.abs(vf) > 12 && Math.abs(car.steer) > 0.2) car.drifting = true;
  car.slip = Math.atan2(vl, Math.max(Math.abs(vf), 1));
  if (car.drifting && (absV < 8 || (!input.handbrake && Math.abs(car.slip) < 0.1))) car.drifting = false;

  // Lateral grip. While drifting, the velocity rotates toward the heading with only light
  // scrub, so a drift keeps its momentum instead of bleeding speed like a skid.
  let grip = p.grip;
  if (input.handbrake) grip = p.handbrakeGrip;
  else if (car.drifting) grip = p.driftGrip;
  if (surfaceOffroad) grip *= 0.7;
  const before = Math.hypot(vf, vl);
  vl *= Math.exp(-grip * dt);
  if (input.handbrake) {
    vf = Math.sign(vf) * Math.max(0, Math.abs(vf) - p.handbrakeDecel * dt);
  } else if (car.drifting || Math.abs(vl) > 0.5) {
    const keep = before * (1 - (car.drifting ? p.driftScrub : 0.04) * dt);
    const f2 = keep * keep - vl * vl;
    if (f2 > 0 && Math.abs(vf) > 1) vf = Math.sign(vf) * Math.sqrt(f2);
  }

  // Bicycle yaw. Signed vf means reversing turns the car the "other" way, like a real car.
  let delta = car.steer * maxSteerAt(vf, p);
  let yaw = (vf * Math.tan(delta)) / p.wheelbase;
  if (car.drifting || input.handbrake) yaw *= p.driftYaw;
  car.yawRate = yaw;
  car.heading -= yaw * dt;

  // Recompose with the old basis: the body rotated, the momentum didn't — that is the slide.
  car.vx = sh * vf - ch * vl;
  car.vz = ch * vf + sh * vl;
  car.x += car.vx * dt;
  car.z += car.vz * dt;
  car.speed = vf;
  car.lateral = vl;

  // Boost recharge.
  let gain = p.boostRecharge;
  if (car.drifting && absV > 15) gain += p.driftRecharge;
  car.boost = Math.min(p.boostCharges, car.boost + gain * dt);
  return car;
}

/** Locate the car on the track and flag off-road. Call before stepCar each tick. */
export function locate(car, track) {
  nearest(track, car.x, car.z, car.trackHint, car.track);
  car.trackHint = car.track.index;
  car.offroad = Math.abs(car.track.lat) > ROAD_HALF + CURB_W;
  return car.track;
}

/**
 * Keep the car between the barriers. Returns null, or a contact { x, z, nx, nz, impact, scrape }
 * where impact is the speed into the wall and scrape the speed along it.
 */
export function collideWalls(car, track, dt = 1 / 120) {
  const t = nearest(track, car.x, car.z, car.trackHint, car.track);
  car.trackHint = t.index;
  const limit = WALL - CAR_RADIUS;
  if (Math.abs(t.lat) <= limit) return null;
  const side = Math.sign(t.lat);
  const nx = t.nx * side, nz = t.nz * side;        // outward
  const pen = Math.abs(t.lat) - limit;
  car.x -= nx * pen; car.z -= nz * pen;
  t.lat = side * limit;
  const vn = car.vx * nx + car.vz * nz;
  let impact = 0;
  if (vn > 0) {
    impact = vn;
    car.vx -= nx * vn * 1.25; car.vz -= nz * vn * 1.25; // small bounce
  }
  // Scrape friction along the wall.
  const vt = Math.hypot(car.vx, car.vz);
  const fr = Math.max(0.05, 1 - (0.35 + impact * 0.02));
  const loss = Math.pow(fr, dt);
  car.vx *= loss; car.vz *= loss;
  // Nudge the nose away from the wall so a scrape doesn't pin the car.
  const fwdN = Math.sin(car.heading) * nx + Math.cos(car.heading) * nz;
  if (fwdN > 0) {
    const tangSign = Math.sign(Math.sin(car.heading) * t.tx + Math.cos(car.heading) * t.tz) || 1;
    const along = Math.atan2(t.tx * tangSign, t.tz * tangSign);
    car.heading += loopAngle(along - car.heading) * Math.min(1, 5 * dt);
  }
  const sh = Math.sin(car.heading), ch = Math.cos(car.heading);
  car.speed = car.vx * sh + car.vz * ch;
  return { x: car.x + nx * CAR_RADIUS, z: car.z + nz * CAR_RADIUS, nx, nz, impact, scrape: vt };
}

export function loopAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Push two overlapping cars apart (circle vs circle). Returns impact speed or 0. */
export function collideCars(a, b, radius = 2.1) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d >= radius * 2 || d < 1e-6) return 0;
  const nx = dx / d, nz = dz / d;
  const pen = radius * 2 - d;
  a.x -= nx * pen / 2; a.z -= nz * pen / 2;
  b.x += nx * pen / 2; b.z += nz * pen / 2;
  const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
  if (rel >= 0) return 0;
  const j = -rel * 0.65; // restitution ~0.3, shared equally
  a.vx -= nx * j; a.vz -= nz * j;
  b.vx += nx * j; b.vz += nz * j;
  return -rel;
}

/** Six-speed box purely for sound and the rev needle. */
const GEARS = [0, 12, 22, 33, 45, 58, 90];
export function gearbox(speed) {
  const v = Math.abs(speed);
  if (speed < -0.5) return { gear: -1, rpm: 0.2 + Math.min(1, v / 13) * 0.6 };
  let g = 1;
  while (g < 6 && v > GEARS[g]) g++;
  const lo = GEARS[g - 1] * 0.85, hi = GEARS[g];
  return { gear: g, rpm: Math.min(1, 0.18 + 0.82 * Math.max(0, (v - lo) / (hi - lo))) };
}
