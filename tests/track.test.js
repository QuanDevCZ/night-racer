import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack, nearest, frameAt, loopDelta } from '../src/core/track.js';
import { CONTROL_POINTS, WALL } from '../src/core/layout.js';

const track = buildTrack(CONTROL_POINTS);

test('track is a closed loop with uniform spacing', () => {
  const { N, xs, zs, ds } = track;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const d = Math.hypot(xs[j] - xs[i], zs[j] - zs[i]);
    assert.ok(Math.abs(d - ds) < 0.15, `gap ${d} at ${i}`);
  }
  assert.ok(track.length > 1500 && track.length < 2600, `length ${track.length}`);
});

test('distant parts of the circuit never come close enough for the barriers to overlap', () => {
  const { N, xs, zs, ds } = track;
  const sep = Math.round(80 / ds);
  for (let i = 0; i < N; i += 2) {
    for (let j = i + sep; j < N; j += 2) {
      if (N - (j - i) < sep) continue;
      const d = Math.hypot(xs[i] - xs[j], zs[i] - zs[j]);
      assert.ok(d > 2 * WALL + 4, `points ${i} and ${j} only ${d.toFixed(1)} m apart`);
    }
  }
});

test('nearest() recovers arc length and signed lateral offset', () => {
  const f = {};
  for (const s of [0, 123.4, 777, track.length - 3]) {
    frameAt(track, s, f);
    for (const lat of [-6, 0, 4.5]) {
      const q = nearest(track, f.x + f.nx * lat, f.z + f.nz * lat);
      assert.ok(Math.abs(loopDelta(q.s, s, track.length)) < 0.6, `s ${q.s} vs ${s}`);
      assert.ok(Math.abs(q.lat - lat) < 0.25, `lat ${q.lat} vs ${lat}`);
    }
  }
});

test('hinted nearest() stays local', () => {
  const f = frameAt(track, 500, {});
  const q = nearest(track, f.x, f.z, f.index);
  assert.ok(Math.abs(q.s - 500) < 0.6);
});

test('loopDelta wraps across the line', () => {
  assert.equal(loopDelta(2, 98, 100), 4);
  assert.equal(loopDelta(98, 2, 100), -4);
});

test('speed profile is positive, capped, and brakes before the hairpin', () => {
  let min = Infinity, max = 0;
  for (const v of track.speed) { min = Math.min(min, v); max = Math.max(max, v); }
  assert.ok(min > 15 && max <= 60);
  // Braking pass: no sample may need more than the brake limit to reach the next one.
  for (let i = 0; i < track.N; i++) {
    const a = track.speed[i], b = track.speed[(i + 1) % track.N];
    assert.ok(a * a - b * b <= 2 * 22 * track.ds + 1e-6);
  }
});
