// Closed track built from control points: a centripetal Catmull-Rom spline, resampled to
// uniform arc length. Every query here is pure maths, so it runs the same in Node and the browser.
import { SAMPLE_SPACING } from './layout.js';

const ALPHA = 0.5; // centripetal: no cusps or self-loops on tight control-point clusters

function catmull(p0, p1, p2, p3, u) {
  const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), ALPHA) || 1e-4;
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const lerp = (a, b, ta, tb) => {
    const w = (t - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const a1 = lerp(p0, p1, t0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

export const wrap = (i, n) => ((i % n) + n) % n;

/** Signed shortest difference a - b on a loop of length L, in (-L/2, L/2]. */
export function loopDelta(a, b, L) {
  let d = (a - b) % L;
  if (d > L / 2) d -= L;
  if (d <= -L / 2) d += L;
  return d;
}

export function buildTrack(points, { spacing = SAMPLE_SPACING, latAccel = 26, brakeDecel = 22, vmax = 60 } = {}) {
  const n = points.length;
  // Dense polyline first, then resample so every sample is the same arc length apart.
  const dense = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[wrap(i - 1, n)], p1 = points[i], p2 = points[wrap(i + 1, n)], p3 = points[wrap(i + 2, n)];
    for (let k = 0; k < 120; k++) dense.push(catmull(p0, p1, p2, p3, k / 120));
  }
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1], b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cum[dense.length];
  const N = Math.round(length / spacing);
  const ds = length / N;

  const xs = new Float64Array(N), zs = new Float64Array(N);
  let j = 0;
  for (let i = 0; i < N; i++) {
    const s = i * ds;
    while (cum[j + 1] < s) j++;
    const w = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    const a = dense[j], b = dense[(j + 1) % dense.length];
    xs[i] = a[0] + (b[0] - a[0]) * w;
    zs[i] = a[1] + (b[1] - a[1]) * w;
  }

  const tx = new Float64Array(N), tz = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = wrap(i - 1, N), b = wrap(i + 1, N);
    const dx = xs[b] - xs[a], dz = zs[b] - zs[a];
    const l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l; tz[i] = dz / l;
  }

  // Signed curvature (positive = bends to the left of travel, i.e. away from the right normal).
  const rawK = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = wrap(i - 1, N), b = wrap(i + 1, N);
    const cross = tx[a] * tz[b] - tz[a] * tx[b];
    rawK[i] = -cross / (2 * ds);
  }
  const curvature = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let sum = 0;
    for (let k = -3; k <= 3; k++) sum += rawK[wrap(i + k, N)];
    curvature[i] = sum / 7;
  }

  // Speed profile for the AI: corner limit, then two backward passes so braking starts early.
  const speed = new Float64Array(N);
  for (let i = 0; i < N; i++) speed[i] = Math.min(vmax, Math.sqrt(latAccel / Math.max(Math.abs(curvature[i]), 1e-6)));
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const next = speed[wrap(i + 1, N)];
      speed[i] = Math.min(speed[i], Math.sqrt(next * next + 2 * brakeDecel * ds));
    }
  }

  return { N, ds, length, xs, zs, tx, tz, curvature, speed };
}

/** Interpolated centre-line frame at arc length s (wraps). */
export function frameAt(track, s, out = {}) {
  const { N, ds, length, xs, zs, tx, tz } = track;
  const sw = ((s % length) + length) % length;
  const f = sw / ds;
  const i = Math.floor(f) % N, k = (i + 1) % N, w = f - Math.floor(f);
  out.x = xs[i] + (xs[k] - xs[i]) * w;
  out.z = zs[i] + (zs[k] - zs[i]) * w;
  let ttx = tx[i] + (tx[k] - tx[i]) * w, ttz = tz[i] + (tz[k] - tz[i]) * w;
  const l = Math.hypot(ttx, ttz) || 1;
  out.tx = ttx / l; out.tz = ttz / l;
  out.nx = -out.tz; out.nz = out.tx; // right-hand normal
  out.heading = Math.atan2(out.tx, out.tz);
  out.s = sw;
  out.index = i;
  return out;
}

export function sampleAt(arr, track, s) {
  const { N, ds, length } = track;
  const sw = ((s % length) + length) % length;
  const f = sw / ds, i = Math.floor(f) % N, w = f - Math.floor(f);
  return arr[i] + (arr[(i + 1) % N] - arr[i]) * w;
}

/**
 * Closest point on the centre line to (x, z). With a hint index only a local window is
 * searched, so a car can never snap to a different part of the circuit.
 * Returns s (arc length), lat (signed lateral offset, + = right of travel), tangent and normal.
 */
export function nearest(track, x, z, hint = -1, out = {}) {
  const { N, ds, xs, zs, tx, tz } = track;
  let best = 0, bestD = Infinity;
  const lo = hint < 0 ? 0 : hint - 20, hi = hint < 0 ? N - 1 : hint + 20;
  for (let k = lo; k <= hi; k++) {
    const i = wrap(k, N);
    const dx = x - xs[i], dz = z - zs[i];
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  // Project onto the better of the two adjacent segments.
  let bi = best, bt = 0, bd = Infinity;
  for (const a of [wrap(best - 1, N), best]) {
    const b = wrap(a + 1, N);
    const sx = xs[b] - xs[a], sz = zs[b] - zs[a];
    const t = Math.max(0, Math.min(1, ((x - xs[a]) * sx + (z - zs[a]) * sz) / (sx * sx + sz * sz)));
    const cx = xs[a] + sx * t, cz = zs[a] + sz * t;
    const d = (x - cx) ** 2 + (z - cz) ** 2;
    if (d < bd) { bd = d; bi = a; bt = t; }
  }
  const b = wrap(bi + 1, N);
  const cx = xs[bi] + (xs[b] - xs[bi]) * bt, cz = zs[bi] + (zs[b] - zs[bi]) * bt;
  let ttx = tx[bi] + (tx[b] - tx[bi]) * bt, ttz = tz[bi] + (tz[b] - tz[bi]) * bt;
  const l = Math.hypot(ttx, ttz) || 1;
  ttx /= l; ttz /= l;
  out.index = bt < 0.5 ? bi : b;
  out.s = (bi + bt) * ds;
  out.cx = cx; out.cz = cz;
  out.tx = ttx; out.tz = ttz;
  out.nx = -ttz; out.nz = ttx;
  out.lat = (x - cx) * out.nx + (z - cz) * out.nz;
  return out;
}
