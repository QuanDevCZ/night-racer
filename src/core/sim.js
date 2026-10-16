// One race = cars + AI drivers + race bookkeeping. stepRace is the whole simulation tick;
// the browser only renders what it produces, and the Node tests drive it headless.
import { createCar, stepCar, locate, collideWalls, collideCars, triggerBoost, CAR } from './physics.js';
import { createRacer, updateRacer, updateAlerts, rank } from './race.js';
import { createDriver, drive } from './ai.js';
import { frameAt } from './track.js';
import { START_OFFSET } from './layout.js';

export const AI_PROFILES = [
  { name: 'VOLT',  color: 0x19e3ff, lane: -2.5, skill: 0.97 },
  { name: 'NOVA',  color: 0xffb020, lane: 2.5,  skill: 0.94 },
  { name: 'RAZOR', color: 0x8cff3a, lane: 0,    skill: 0.91 },
];
export const PLAYER_PROFILE = { name: 'YOU', color: 0xff2a6d };

export function createRace(track, { aiCount = 3, playerSlot = 3 } = {}) {
  const profiles = [];
  let ai = 0;
  for (let slot = 0; slot < aiCount + 1; slot++) {
    profiles.push(slot === playerSlot ? { ...PLAYER_PROFILE, player: true } : { ...AI_PROFILES[ai++ % AI_PROFILES.length] });
  }
  const f = {};
  const cars = [], drivers = [], racers = [];
  profiles.forEach((prof, slot) => {
    const row = Math.floor(slot / 2), side = slot % 2 ? 1 : -1;
    const s = track.length - START_OFFSET - row * 9 - (side > 0 ? 3 : 0);
    frameAt(track, s, f);
    const car = createCar(f.x + f.nx * side * 3, f.z + f.nz * side * 3, f.heading, CAR);
    locate(car, track);
    cars.push(car);
    drivers.push(prof.player ? null : createDriver({ lane: prof.lane, skill: prof.skill, seed: slot + 3 }));
    racers.push(createRacer(track, car.track.s));
  });
  const playerIndex = profiles.findIndex((p) => p.player);
  return {
    track, cars, drivers, racers, profiles, time: 0, playerIndex,
    autopilot: createDriver({ lane: 0, skill: 0.9 }),
    order: rank(racers),
  };
}

/**
 * Advance the race by dt. playerInput may be null (headless runs). While frozen (countdown),
 * nothing moves. Returns an array of events for sound and effects.
 */
export function stepRace(race, playerInput, dt, frozen = false) {
  const { track, cars, drivers, racers } = race;
  const events = [];
  if (frozen) return events;
  race.time += dt;
  const pIdx = race.playerIndex;
  const player = cars[pIdx];

  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    locate(car, track);
    const others = cars.filter((c) => c !== car);
    let input;
    if (drivers[i]) {
      // Gentle rubber band so the pack stays in sight of the player.
      if (player && i !== pIdx) {
        const gap = racers[i].dist - racers[pIdx].dist;
        const want = gap > 60 ? 0.95 : gap < -80 ? 1.04 : 1;
        drivers[i].rubber += (want - drivers[i].rubber) * Math.min(1, dt * 0.5);
      }
      input = drive(drivers[i], car, track, others, dt);
    } else if (racers[i].finished || !playerInput) {
      input = drive(race.autopilot, car, track, others, dt); // cool-down lap on autopilot
    } else input = playerInput;

    if (input.boost && triggerBoost(car)) events.push({ type: 'boost', car: i });
    stepCar(car, input, dt, car.offroad);
    car.input = input;
    const hit = collideWalls(car, track, dt);
    if (hit) events.push({ type: 'wall', car: i, ...hit });
  }

  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const impact = collideCars(cars[i], cars[j]);
      if (impact > 1) events.push({ type: 'bump', car: i, other: j, impact, x: (cars[i].x + cars[j].x) / 2, z: (cars[i].z + cars[j].z) / 2 });
    }
  }

  for (let i = 0; i < cars.length; i++) {
    const car = cars[i], r = racers[i];
    locate(car, track);
    const ev = updateRacer(r, car.track.s, race.time);
    if (ev) events.push({ type: 'race', car: i, event: ev, lap: r.lap });
    const fwdDot = Math.sin(car.heading) * car.track.tx + Math.cos(car.heading) * car.track.tz;
    updateAlerts(r, fwdDot, car.speed, car.offroad, dt);
  }
  race.order = rank(racers);
  return events;
}

export function positionOf(race, i) {
  return race.order.indexOf(i) + 1;
}

/** Put a car back on the centre line, facing forward, at its current track position. */
export function respawn(race, i) {
  const car = race.cars[i];
  const f = frameAt(race.track, car.track.s, {});
  car.x = f.x; car.z = f.z; car.heading = f.heading;
  car.vx = car.vz = car.speed = car.lateral = 0;
  car.drifting = false; car.steer = 0;
}
