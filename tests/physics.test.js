import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCar, stepCar, collideWalls, collideCars, triggerBoost, gearbox, locate, CAR } from '../src/core/physics.js';
import { buildTrack, frameAt } from '../src/core/track.js';
import { CONTROL_POINTS, WALL, CAR_RADIUS } from '../src/core/layout.js';

const dt = 1 / 120;
const run = (car, input, seconds) => { for (let t = 0; t < seconds; t += dt) stepCar(car, input, dt); return car; };

test('accelerates and settles near top speed', () => {
  const car = run(createCar(0, 0, 0), { throttle: 1 }, 3);
  assert.ok(car.speed > 30, `3 s: ${car.speed}`);
  run(car, { throttle: 1 }, 30);
  assert.ok(car.speed > CAR.maxSpeed * 0.9 && car.speed <= CAR.maxSpeed + 0.5, `top ${car.speed}`);
  assert.ok(car.z > 100 && Math.abs(car.x) < 1e-6, 'heading 0 drives along +z');
});

test('brake stops the car, then reverses with a signed negative speed', () => {
  const car = run(createCar(0, 0, 0), { throttle: 1 }, 2);
  run(car, { brake: 1 }, 1.5);
  assert.ok(car.speed <= 0.5);
  run(car, { brake: 1 }, 4);
  assert.ok(car.speed < -10 && car.speed >= -CAR.reverseMax - 1e-9, `reverse ${car.speed}`);
  assert.equal(gearbox(car.speed).gear, -1);
});

test('steer right turns toward screen-right (heading decreases)', () => {
  const car = run(createCar(0, 0, 0), { throttle: 1 }, 1);
  run(car, { throttle: 0.5, steer: 1 }, 0.5);
  assert.ok(car.heading < -0.1, `heading ${car.heading}`);
  assert.ok(car.x < 0, 'right of +z travel is −x');
});

test('reversing with the same steer turns the body the other way', () => {
  const car = createCar(0, 0, 0);
  run(car, { brake: 1 }, 2);
  run(car, { brake: 1, steer: 1 }, 1);
  assert.ok(car.heading > 0.1, `reverse heading ${car.heading}`);
});

test('steering is limited by lateral grip at speed', () => {
  const car = run(createCar(0, 0, 0), { throttle: 1 }, 20);
  run(car, { throttle: 1, steer: 1 }, 1);
  const latAcc = Math.abs(car.yawRate * car.speed);
  assert.ok(latAcc <= CAR.latLimit * CAR.driftYaw + 1e-6, `lat ${latAcc}`);
  assert.ok(!car.drifting);
});

test('handbrake + steer at speed starts a drift with real slip, which then recovers', () => {
  const car = run(createCar(0, 0, 0), { throttle: 1 }, 3);
  run(car, { throttle: 1, steer: 1, handbrake: true }, 0.6);
  assert.ok(car.drifting);
  assert.ok(Math.abs(car.slip) > 0.15, `slip ${car.slip}`);
  const speedInDrift = Math.hypot(car.vx, car.vz);
  assert.ok(speedInDrift > 20, 'a drift keeps momentum');
  run(car, { throttle: 1 }, 2);
  assert.ok(!car.drifting && Math.abs(car.slip) < 0.1);
});

test('boost: 3 charges, timed, raises speed, recharges and caps at 3', () => {
  const car = createCar(0, 0, 0);
  assert.equal(car.boost, 3);
  run(car, { throttle: 1 }, 25);
  const cruise = car.speed;
  assert.ok(triggerBoost(car));
  assert.ok(!triggerBoost(car), 'no stacking while active');
  run(car, { throttle: 1 }, CAR.boostTime - 0.05);
  assert.ok(car.boosting && car.speed > cruise + 5, `boost ${car.speed} vs ${cruise}`);
  run(car, { throttle: 1 }, 0.1);
  assert.ok(!car.boosting);
  assert.ok(car.boost < 2.2);
  car.boost = 0;
  run(car, { throttle: 1 }, 1 / CAR.boostRecharge + 0.5);
  assert.ok(car.boost >= 1);
  run(car, { throttle: 1 }, 200);
  assert.equal(car.boost, 3);
});

test('drifting recharges boost faster than driving straight', () => {
  const a = run(createCar(0, 0, 0), { throttle: 1 }, 3);
  const b = run(createCar(0, 0, 0), { throttle: 1 }, 3);
  a.boost = b.boost = 0;
  run(a, { throttle: 1, steer: 1, handbrake: true }, 1);
  run(b, { throttle: 1 }, 1);
  assert.ok(a.boost > b.boost * 2);
});

test('off-road surface caps speed lower', () => {
  const car = createCar(0, 0, 0);
  for (let t = 0; t < 20; t += dt) stepCar(car, { throttle: 1 }, dt, true);
  assert.ok(car.speed < CAR.maxSpeed * CAR.offroadTop + 1);
});

test('walls keep the car inside and report a scrape', () => {
  const track = buildTrack(CONTROL_POINTS);
  const f = frameAt(track, 100, {});
  const car = createCar(f.x, f.z, f.heading);
  locate(car, track);
  car.heading += -0.5; // aim at the right-hand wall
  let contact = null;
  for (let t = 0; t < 4; t += dt) {
    stepCar(car, { throttle: 1 }, dt);
    const c = collideWalls(car, track, dt);
    if (c) contact = c;
    assert.ok(Math.abs(car.track.lat) <= WALL - CAR_RADIUS + 1e-6);
  }
  assert.ok(contact && contact.scrape > 1);
});

test('overlapping cars are pushed apart and exchange momentum', () => {
  const a = createCar(0, 0, 0), b = createCar(0, 3, 0);
  a.vz = 20;
  const impact = collideCars(a, b);
  assert.ok(impact > 0);
  assert.ok(Math.hypot(b.x - a.x, b.z - a.z) >= 4.2 - 1e-9);
  assert.ok(b.vz > 0 && a.vz < 20);
});

test('gearbox climbs with speed and rpm stays in 0..1', () => {
  let last = 1;
  for (let v = 0; v < 80; v += 1) {
    const g = gearbox(v);
    assert.ok(g.gear >= last && g.rpm >= 0 && g.rpm <= 1);
    last = g.gear;
  }
  assert.equal(last, 6);
});
