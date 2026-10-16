// Race bookkeeping: ordered checkpoints, laps, times, ranking, wrong-way / off-track alerts.
import { loopDelta } from './track.js';
import { CHECKPOINTS, LAPS } from './layout.js';

export function createRacer(track, startS, { checkpoints = CHECKPOINTS, laps = LAPS } = {}) {
  return {
    K: checkpoints, laps, L: track.length,
    lap: 0,                 // laps started; 0 = still on the grid behind the line
    nextCp: checkpoints,    // K means "the finish line is next"
    lastS: startS,
    dist: loopDelta(startS, 0, track.length), // unwrapped distance, negative on the grid
    lapStart: 0, lapTimes: [], best: Infinity,
    finished: false, finishTime: 0,
    wrongT: 0, wrongWay: false, offT: 0, offTrack: false,
  };
}

const cpS = (r, k) => (k % r.K) * (r.L / r.K);

/**
 * Feed the car's arc-length position each tick. Returns null or an event:
 * 'checkpoint' | 'lap' (a lap was completed) | 'start' (crossed the line the first time) | 'finish'.
 */
export function updateRacer(r, s, time) {
  const d = loopDelta(s, r.lastS, r.L);
  r.dist += d;
  let event = null;
  if (d > 0 && !r.finished) {
    const target = r.nextCp === r.K ? 0 : r.nextCp;
    const ahead = loopDelta(cpS(r, target), r.lastS, r.L);
    if (ahead > 0 && ahead <= d) {
      if (r.nextCp === r.K) {
        if (r.lap >= 1) {
          const t = time - r.lapStart;
          r.lapTimes.push(t);
          r.best = Math.min(r.best, t);
          r.lapStart = time;
          event = 'lap';
        } else event = 'start';
        r.lap++;
        r.nextCp = 1;
        if (r.lapTimes.length >= r.laps) { r.finished = true; r.finishTime = time; event = 'finish'; }
      } else {
        r.nextCp++;
        event = 'checkpoint';
      }
    }
  }
  r.lastS = s;
  return event;
}

/** Racer indices in race order: finishers by time, then everyone else by distance covered. */
export function rank(racers) {
  return racers.map((r, i) => i).sort((a, b) => {
    const A = racers[a], B = racers[b];
    if (A.finished && B.finished) return A.finishTime - B.finishTime;
    if (A.finished !== B.finished) return A.finished ? -1 : 1;
    return B.dist - A.dist;
  });
}

/**
 * fwdDot = dot(car forward, track tangent). Alerts use hysteresis so they don't flicker.
 */
export function updateAlerts(r, fwdDot, speed, offroad, dt) {
  if (fwdDot < -0.35 && Math.abs(speed) > 3) r.wrongT = Math.min(1.5, r.wrongT + dt);
  else r.wrongT = Math.max(0, r.wrongT - 2 * dt);
  r.wrongWay = r.wrongWay ? r.wrongT > 0 : r.wrongT > 0.8;

  if (offroad) r.offT = Math.min(1, r.offT + dt);
  else r.offT = Math.max(0, r.offT - 3 * dt);
  r.offTrack = r.offTrack ? r.offT > 0 : r.offT > 0.25;
}
