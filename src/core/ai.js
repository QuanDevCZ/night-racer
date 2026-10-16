// AI drivers: pure-pursuit steering toward a lane offset, throttle from the track's speed
// profile, a lane shift to pass slower cars, boosts on straights, and stuck recovery.
import { frameAt, sampleAt, loopDelta } from './track.js';
import { maxSteerAt } from './physics.js';
import { ROAD_HALF } from './layout.js';

export function createDriver({ lane = 0, skill = 0.95, seed = 1 } = {}) {
  return { baseLane: lane, lane, laneTarget: lane, skill, stuckT: 0, reverseT: 0, boostCd: 4 + (seed % 5), passT: 0, rubber: 1 };
}

const frame = {};

/** Decide this tick's input for one AI car. `others` = every other car (player included). */
export function drive(drv, car, track, others, dt) {
  const v = car.speed;
  const s = car.track.s;
  const input = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };

  // Lane choice: ease toward the inside of the next bend, and dodge a slower car ahead.
  drv.passT = Math.max(0, drv.passT - dt);
  if (drv.passT === 0) drv.laneTarget = drv.baseLane;
  for (const o of others) {
    const ds = loopDelta(o.track.s, s, track.length);
    if (ds > 0 && ds < 16 && Math.abs(o.track.lat - drv.lane) < 2.8 && o.speed < v + 1) {
      drv.laneTarget = o.track.lat > 0 ? o.track.lat - 4 : o.track.lat + 4;
      drv.passT = 1.5;
    }
  }
  drv.laneTarget = Math.max(-ROAD_HALF + 1.5, Math.min(ROAD_HALF - 1.5, drv.laneTarget));
  drv.lane += Math.max(-3 * dt, Math.min(3 * dt, drv.laneTarget - drv.lane));

  const look = 7 + Math.abs(v) * 0.5;
  frameAt(track, s + look, frame);
  const k = sampleAt(track.curvature, track, s + look * 1.5);
  const inside = -Math.sign(k) * Math.min(3.5, Math.abs(k) * 110);
  const lat = Math.max(-ROAD_HALF + 1.2, Math.min(ROAD_HALF - 1.2, drv.lane + inside));
  const px = frame.x + frame.nx * lat, pz = frame.z + frame.nz * lat;

  // Pure pursuit: angle to the target in the car frame → required curvature → wheel angle.
  const sh = Math.sin(car.heading), ch = Math.cos(car.heading);
  const dx = px - car.x, dz = pz - car.z;
  const df = dx * sh + dz * ch, dr = -dx * ch + dz * sh;
  const alpha = Math.atan2(dr, df);
  const Ld = Math.max(4, Math.hypot(dx, dz));
  const delta = Math.atan((2 * car.p.wheelbase * Math.sin(alpha)) / Ld);
  input.steer = Math.max(-1, Math.min(1, delta / maxSteerAt(v, car.p)));

  // Speed: the precomputed profile already contains the braking zones.
  const vt = Math.min(sampleAt(track.speed, track, s + 3), sampleAt(track.speed, track, s + 10 + v * 0.3)) * drv.skill * drv.rubber;
  if (Math.abs(alpha) > 1.2 && v > 0) input.throttle = 0.3;        // badly off line: ease off
  else if (v < vt - 1) input.throttle = 1;
  else if (v > vt + 2.5) input.brake = Math.min(1, (v - vt) / 8);
  else input.throttle = 0.45;

  // Boost when the next ~150 m is flat out.
  drv.boostCd -= dt;
  if (drv.boostCd <= 0 && car.boost >= 1 && v > 30 &&
      sampleAt(track.speed, track, s + 60) > 55 && sampleAt(track.speed, track, s + 140) > 50) {
    input.boost = true;
    drv.boostCd = 7 + ((s * 7.13) % 6);
  }

  // Stuck (against a wall or pointing backwards): back out with opposite lock.
  const fwdDot = sh * car.track.tx + ch * car.track.tz;
  if (drv.reverseT > 0) {
    drv.reverseT -= dt;
    return { throttle: 0, brake: 1, steer: -Math.sign(dr || 1), handbrake: false, boost: false };
  }
  if ((Math.abs(v) < 1.5 || fwdDot < -0.2) && input.throttle > 0) drv.stuckT += dt;
  else drv.stuckT = Math.max(0, drv.stuckT - dt);
  if (drv.stuckT > 1.2) { drv.stuckT = 0; drv.reverseT = 1.1; }
  return input;
}
