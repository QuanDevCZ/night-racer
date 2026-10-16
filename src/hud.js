// DOM HUD: position, laps, timers, speedometer, boost cells, minimap, standings, alerts.
import { gearbox } from './core/physics.js';
import { positionOf } from './core/sim.js';

const $ = (id) => document.getElementById(id);

export function fmt(t) {
  if (!isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

export function createHud(track) {
  const el = {
    hud: $('hud'), pos: $('pos'), posOf: $('pos-of'), lap: $('lap'), laps: $('laps'),
    total: $('t-total'), lapT: $('t-lap'), best: $('t-best'),
    alert: $('alert'), banner: $('banner'), split: $('split'), standings: $('standings'),
    cells: [...document.querySelectorAll('#boost .cell i')], boostBox: $('boost'),
  };
  const cache = {};
  const text = (node, key, v) => { if (cache[key] !== v) { cache[key] = v; node.textContent = v; } };

  // Speedometer.
  const speedo = $('speedo'), sg = speedo.getContext('2d');
  // Minimap: track path pre-rendered once.
  const mini = $('minimap'), mg = mini.getContext('2d');
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.N; i++) {
    minX = Math.min(minX, track.xs[i]); maxX = Math.max(maxX, track.xs[i]);
    minZ = Math.min(minZ, track.zs[i]); maxZ = Math.max(maxZ, track.zs[i]);
  }
  const M = mini.width, pad = 18;
  const scale = (M - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
  // Seen from above with +z up the screen, +x points left — so both axes are flipped.
  const mx = (x) => M - (pad + (x - minX) * scale + ((M - pad * 2) - (maxX - minX) * scale) / 2);
  const mz = (z) => M - (pad + (z - minZ) * scale + ((M - pad * 2) - (maxZ - minZ) * scale) / 2);
  const base = document.createElement('canvas');
  base.width = base.height = M;
  {
    const g = base.getContext('2d');
    const path = () => { g.beginPath(); for (let i = 0; i <= track.N; i++) { const j = i % track.N; i ? g.lineTo(mx(track.xs[j]), mz(track.zs[j])) : g.moveTo(mx(track.xs[j]), mz(track.zs[j])); } };
    path(); g.strokeStyle = 'rgba(255,43,214,0.35)'; g.lineWidth = 9; g.lineJoin = 'round'; g.stroke();
    path(); g.strokeStyle = 'rgba(230,230,255,0.9)'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#fff';
    g.fillRect(mx(track.xs[0]) - 1.5, mz(track.zs[0]) - 6, 3, 12);
  }

  let bannerT = 0, splitT = 0;
  const hud = {
    show(v) { el.hud.classList.toggle('hidden', !v); },
    banner(msg, cls = '', dur = 1.4) {
      el.banner.textContent = msg; el.banner.className = 'show ' + cls; bannerT = dur;
    },
    split(msg, cls = '') { el.split.innerHTML = msg; el.split.className = 'show ' + cls; splitT = 2.2; },
    clearBanner() { bannerT = 0; el.banner.className = ''; },

    update(race, dt, { boostActive }) {
      const pi = race.playerIndex, car = race.cars[pi], r = race.racers[pi];
      text(el.pos, 'pos', String(positionOf(race, pi)));
      text(el.posOf, 'posOf', '/' + race.cars.length);
      text(el.lap, 'lap', String(Math.max(1, Math.min(r.laps, r.lap))));
      text(el.laps, 'laps', '/' + r.laps);
      const t = r.finished ? r.finishTime : race.time;
      text(el.total, 'total', fmt(t));
      text(el.lapT, 'lapT', fmt(r.finished ? r.lapTimes.at(-1) : race.time - r.lapStart));
      text(el.best, 'best', fmt(r.best));

      // Boost cells fill as they recharge.
      el.cells.forEach((c, i) => {
        const f = Math.max(0, Math.min(1, car.boost - i));
        c.style.transform = `scaleX(${f.toFixed(3)})`;
        c.parentElement.classList.toggle('full', f >= 1);
      });
      el.boostBox.classList.toggle('active', boostActive);

      // Alerts.
      let alert = '';
      if (r.wrongWay) alert = 'WRONG WAY';
      else if (r.offTrack) alert = 'OFF TRACK';
      if (cache.alert !== alert) {
        cache.alert = alert;
        el.alert.textContent = alert;
        el.alert.className = alert ? (r.wrongWay ? 'show danger' : 'show warn') : '';
      }

      // Standings.
      const leader = race.racers[race.order[0]];
      const rows = race.order.map((i, k) => {
        const rr = race.racers[i], p = race.profiles[i];
        const gap = k === 0 ? 'LEADER' : rr.finished ? fmt(rr.finishTime) : `-${Math.max(0, leader.dist - rr.dist).toFixed(0)}m`;
        return `<li class="${p.player ? 'me' : ''}"><b style="color:#${p.color.toString(16).padStart(6, '0')}">${k + 1}</b><span>${p.name}</span><em>${gap}</em></li>`;
      }).join('');
      if (cache.rows !== rows) { cache.rows = rows; el.standings.innerHTML = rows; }

      bannerT -= dt; splitT -= dt;
      if (bannerT <= 0 && el.banner.className.includes('show')) el.banner.className = '';
      if (splitT <= 0 && el.split.className.includes('show')) el.split.className = '';

      this.drawSpeedo(car, boostActive);
      this.drawMinimap(race);
    },

    drawSpeedo(car, boostActive) {
      const W = speedo.width, H = speedo.height, cx = W / 2, cy = H / 2 + 10, R = W / 2 - 22;
      const kmh = Math.abs(car.speed) * 3.6;
      const { gear, rpm } = gearbox(car.speed);
      sg.clearRect(0, 0, W, H);
      const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
      sg.lineCap = 'round';
      sg.lineWidth = 14; sg.strokeStyle = 'rgba(255,255,255,0.08)';
      sg.beginPath(); sg.arc(cx, cy, R, a0, a1); sg.stroke();
      // RPM arc: cyan → magenta → red at the limiter.
      const grad = sg.createLinearGradient(0, H, W, 0);
      grad.addColorStop(0, '#00e5ff'); grad.addColorStop(0.65, '#ff2bd6'); grad.addColorStop(1, '#ff3030');
      sg.strokeStyle = grad; sg.shadowColor = rpm > 0.9 ? '#ff3030' : '#ff2bd6'; sg.shadowBlur = 16;
      sg.beginPath(); sg.arc(cx, cy, R, a0, a0 + (a1 - a0) * rpm); sg.stroke();
      sg.shadowBlur = 0;
      // Speed ticks.
      sg.lineWidth = 2; sg.strokeStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i <= 12; i++) {
        const a = a0 + (a1 - a0) * (i / 12);
        sg.beginPath(); sg.moveTo(cx + Math.cos(a) * (R - 16), cy + Math.sin(a) * (R - 16)); sg.lineTo(cx + Math.cos(a) * (R - 24), cy + Math.sin(a) * (R - 24)); sg.stroke();
      }
      // Speed needle (0–300 km/h).
      const sa = a0 + (a1 - a0) * Math.min(1, kmh / 300);
      sg.strokeStyle = boostActive ? '#7df9ff' : '#fff'; sg.lineWidth = 3;
      sg.beginPath(); sg.moveTo(cx + Math.cos(sa) * 18, cy + Math.sin(sa) * 18); sg.lineTo(cx + Math.cos(sa) * (R - 20), cy + Math.sin(sa) * (R - 20)); sg.stroke();
      sg.fillStyle = '#fff'; sg.textAlign = 'center';
      sg.font = '700 54px "Chakra Petch", sans-serif';
      sg.shadowColor = boostActive ? '#00e5ff' : 'transparent'; sg.shadowBlur = boostActive ? 20 : 0;
      sg.fillText(String(Math.round(kmh)), cx, cy + 18);
      sg.shadowBlur = 0;
      sg.font = '600 14px "Chakra Petch", sans-serif'; sg.fillStyle = 'rgba(255,255,255,0.55)';
      sg.fillText('KM/H', cx, cy + 40);
      sg.font = '700 24px "Chakra Petch", sans-serif'; sg.fillStyle = gear < 0 ? '#ff4d6d' : '#ff2bd6';
      sg.fillText(gear < 0 ? 'R' : String(gear), cx, cy + R - 4);
    },

    drawMinimap(race) {
      mg.clearRect(0, 0, M, M);
      mg.drawImage(base, 0, 0);
      race.cars.forEach((c, i) => {
        if (i === race.playerIndex) return;
        mg.fillStyle = '#' + race.profiles[i].color.toString(16).padStart(6, '0');
        mg.beginPath(); mg.arc(mx(c.x), mz(c.z), 4.5, 0, Math.PI * 2); mg.fill();
      });
      const p = race.cars[race.playerIndex];
      mg.save();
      mg.translate(mx(p.x), mz(p.z));
      // World forward (sin h, cos h) lands on screen as (−sin h, −cos h): a rotation by −h.
      mg.rotate(-p.heading);
      mg.fillStyle = '#ff2a6d'; mg.shadowColor = '#ff2a6d'; mg.shadowBlur = 10;
      mg.beginPath(); mg.moveTo(0, -8); mg.lineTo(6, 6); mg.lineTo(0, 3); mg.lineTo(-6, 6); mg.closePath(); mg.fill();
      mg.restore();
    },
  };
  return hud;
}
