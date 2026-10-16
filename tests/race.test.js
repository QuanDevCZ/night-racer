import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRacer, updateRacer, rank, updateAlerts } from '../src/core/race.js';
import { buildTrack } from '../src/core/track.js';
import { CONTROL_POINTS } from '../src/core/layout.js';
import { createRace, stepRace } from '../src/core/sim.js';

const track = { length: 1200 };
const step = 1.5;

// Drive a racer forward from s0 for `meters`, one small step at a time.
function drive(r, s0, meters, t0 = 0) {
  const events = [];
  let s = s0, t = t0;
  for (let d = 0; d < meters; d += step) {
    s = (s + step) % track.length; t += 0.05;
    const e = updateRacer(r, s, t);
    if (e) events.push(e);
  }
  return { events, s, t };
}

test('first crossing starts lap 1, full laps are timed, 3 laps finish', () => {
  const r = createRacer(track, track.length - 10, { checkpoints: 12, laps: 3 });
  const { events } = drive(r, track.length - 10, 10 + 3 * track.length + 5);
  assert.equal(events[0], 'start');
  assert.equal(events.filter((e) => e === 'checkpoint').length, 3 * 11);
  assert.equal(events.filter((e) => e === 'lap').length, 2);
  assert.equal(events.at(-1), 'finish');
  assert.ok(r.finished && r.lapTimes.length === 3);
  assert.ok(Math.abs(r.lapTimes[1] - (track.length / step) * 0.05) < 0.2);
});

test('the line does not count without the checkpoints in order', () => {
  const r = createRacer(track, track.length - 10);
  drive(r, track.length - 10, 20); // crossed: lap 1, next = checkpoint 1
  assert.equal(r.lap, 1);
  // Reverse back over the line, then forward again: no lap credit.
  let s = r.lastS;
  for (let i = 0; i < 12; i++) { s = (s - step + track.length) % track.length; updateRacer(r, s, 1); }
  const { events } = drive(r, s, 30, 2);
  assert.ok(!events.includes('lap'));
  assert.equal(r.lap, 1);
  assert.equal(r.nextCp, 1);
});

test('rank puts finishers first by time, then by distance', () => {
  const a = { finished: false, dist: 500 }, b = { finished: true, finishTime: 90, dist: 3000 },
        c = { finished: true, finishTime: 80, dist: 3000 }, d = { finished: false, dist: 900 };
  assert.deepEqual(rank([a, b, c, d]), [2, 1, 3, 0]);
});

test('wrong-way alert needs to persist, then clears', () => {
  const r = createRacer(track, 0);
  updateAlerts(r, -0.9, 10, false, 0.5);
  assert.equal(r.wrongWay, false);
  updateAlerts(r, -0.9, 10, false, 0.5);
  assert.equal(r.wrongWay, true);
  updateAlerts(r, 1, 10, false, 0.3);
  assert.equal(r.wrongWay, true, 'hysteresis');
  updateAlerts(r, 1, 10, false, 1);
  assert.equal(r.wrongWay, false);
  updateAlerts(r, -0.9, 1, false, 5);
  assert.equal(r.wrongWay, false, 'standing still is not wrong way');
});

test('off-track alert', () => {
  const r = createRacer(track, 0);
  updateAlerts(r, 1, 20, true, 0.3);
  assert.equal(r.offTrack, true);
  updateAlerts(r, 1, 20, false, 1);
  assert.equal(r.offTrack, false);
});

test('headless race: 3 AI rivals (and the autopilot) finish 3 laps without wrecking', () => {
  const real = buildTrack(CONTROL_POINTS);
  const race = createRace(real);
  const dt = 1 / 120;
  let wallHits = 0;
  for (let i = 0; i < 120 * 300 && !race.racers.every((r) => r.finished); i++) {
    for (const e of stepRace(race, null, dt)) if (e.type === 'wall' && e.impact > 3) wallHits++;
  }
  for (const r of race.racers) {
    assert.ok(r.finished, 'every car finishes');
    for (const t of r.lapTimes) assert.ok(t > 30 && t < 70, `lap ${t}`);
  }
  assert.ok(wallHits < 10, `hard wall hits ${wallHits}`);
  assert.equal(new Set(race.order).size, 4);
});

test('countdown freeze: nothing moves', () => {
  const race = createRace(buildTrack(CONTROL_POINTS));
  const x = race.cars.map((c) => c.x);
  stepRace(race, { throttle: 1 }, 0.5, true);
  assert.deepEqual(race.cars.map((c) => c.x), x);
  assert.equal(race.time, 0);
});
