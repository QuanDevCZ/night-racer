// Every sound is synthesized live: engines, tyre screech, wall scrape, wind, boost whoosh,
// impacts, and UI chimes. Nothing is loaded from a file.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createAudio() {
  let ctx = null, master = null, muted = false;
  let noise = null;
  const voices = {};
  const ai = [];

  function noiseBuffer() {
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function loopNoise() {
    const s = ctx.createBufferSource();
    s.buffer = noise; s.loop = true; s.start(0, Math.random() * 1.9);
    return s;
  }
  const set = (param, v, tc = 0.05) => param.setTargetAtTime(v, ctx.currentTime, tc);

  function engineVoice(out, gainLevel) {
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'sawtooth'; o3.type = 'square';
    const g1 = ctx.createGain(), g2 = ctx.createGain(), g3 = ctx.createGain();
    g1.gain.value = 0.5; g2.gain.value = 0.35; g3.gain.value = 0.12;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 2.2); }
    shaper.curve = curve;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 2.5;
    const gain = ctx.createGain(); gain.gain.value = 0;
    o1.connect(g1); o2.connect(g2); o3.connect(g3);
    g1.connect(shaper); g2.connect(shaper); g3.connect(shaper);
    shaper.connect(lp); lp.connect(gain); gain.connect(out);
    for (const o of [o1, o2, o3]) o.start();
    return {
      gainLevel,
      set(rpm, load, level) {
        const f = 38 + rpm * 165;
        set(o1.frequency, f, 0.03); set(o2.frequency, f * 0.502, 0.03); set(o3.frequency, f * 2.01, 0.03);
        set(lp.frequency, 380 + rpm * 1700 + load * 1600, 0.05);
        set(gain.gain, level * gainLevel * (0.55 + load * 0.45), 0.05);
      },
    };
  }

  function filteredNoise(type, freq, q, out) {
    const src = loopNoise();
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(out);
    return { f, g };
  }

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    noise = noiseBuffer();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8;
    master.connect(comp); comp.connect(ctx.destination);

    voices.engine = engineVoice(master, 0.32);
    voices.screech = filteredNoise('bandpass', 2100, 7, master);
    voices.screech2 = filteredNoise('bandpass', 3300, 9, master);
    voices.scrape = filteredNoise('bandpass', 2800, 1.5, master);
    voices.wind = filteredNoise('bandpass', 500, 0.8, master);
    voices.rumble = filteredNoise('lowpass', 140, 1, master);
    voices.jet = filteredNoise('bandpass', 900, 1.2, master);
    for (let i = 0; i < 3; i++) {
      const pan = ctx.createStereoPanner();
      pan.connect(master);
      ai.push({ v: engineVoice(pan, 0.16), pan });
    }
  }

  function oneShot(fn) { if (ctx && !muted) fn(ctx.currentTime); }

  function beep(freq, dur, { type = 'sine', vol = 0.25, at = 0, slide = 0 } = {}) {
    oneShot((t0) => {
      const t = t0 + at;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.05);
    });
  }

  return {
    init,
    get ready() { return !!ctx; },
    toggleMute() {
      muted = !muted;
      if (master) set(master.gain, muted ? 0 : 0.8, 0.05);
      return muted;
    },
    /** Called every frame with the player's state. */
    update(s) {
      if (!ctx) return;
      voices.engine.set(s.rpm, s.throttle, s.active ? 1 : 0.6);
      const sl = s.active ? clamp(s.slip, 0, 1) : 0;
      set(voices.screech.g.gain, sl * 0.22);
      set(voices.screech2.g.gain, sl * 0.1);
      set(voices.screech.f.frequency, 1900 + Math.random() * 400, 0.02);
      set(voices.scrape.g.gain, clamp(s.scrape, 0, 1) * 0.35, 0.02);
      set(voices.scrape.f.frequency, 2200 + Math.random() * 1600, 0.01);
      const sp = clamp(Math.abs(s.speed) / 80, 0, 1);
      set(voices.wind.g.gain, sp * sp * 0.22);
      set(voices.wind.f.frequency, 300 + sp * 900);
      set(voices.rumble.g.gain, s.offroad ? clamp(Math.abs(s.speed) / 30, 0, 1) * 0.5 : 0);
      set(voices.jet.g.gain, s.boosting ? 0.18 : 0, 0.1);
      s.ai.forEach((a, i) => {
        if (!ai[i]) return;
        const level = s.active ? clamp(18 / (a.dist + 12), 0, 1) : 0;
        ai[i].v.set(a.rpm, a.throttle, level);
        set(ai[i].pan.pan, clamp(a.pan, -1, 1), 0.05);
      });
    },
    boost() {
      oneShot((t) => {
        const src = ctx.createBufferSource(); src.buffer = noise;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.4;
        f.frequency.setValueAtTime(250, t); f.frequency.exponentialRampToValueAtTime(3800, t + 0.5);
        f.frequency.exponentialRampToValueAtTime(600, t + 1.3);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.12);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
        src.connect(f); f.connect(g); g.connect(master);
        src.start(t); src.stop(t + 1.5);
      });
      beep(70, 0.5, { vol: 0.5, slide: 0.5 });
    },
    impact(strength) {
      const v = clamp(strength / 20, 0.15, 1);
      beep(140, 0.3, { vol: 0.6 * v, slide: 0.3 });
      oneShot((t) => {
        const src = ctx.createBufferSource(); src.buffer = noise;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.5 * v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        src.connect(f); f.connect(g); g.connect(master);
        src.start(t, Math.random()); src.stop(t + 0.3);
      });
    },
    shift() { beep(90, 0.08, { type: 'square', vol: 0.06 }); },
    countdown(go) { go ? beep(1046, 0.7, { type: 'triangle', vol: 0.35 }) : beep(523, 0.25, { type: 'triangle', vol: 0.3 }); },
    checkpoint() { beep(880, 0.12, { vol: 0.16 }); beep(1320, 0.18, { vol: 0.14, at: 0.08 }); },
    lap() { [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.3, { type: 'triangle', vol: 0.22, at: i * 0.09 })); },
    finish() { [523, 659, 784, 988, 1175, 1568].forEach((f, i) => beep(f, i === 5 ? 1.2 : 0.35, { type: 'triangle', vol: 0.25, at: i * 0.12 })); },
    warn() { beep(330, 0.14, { type: 'square', vol: 0.07 }); beep(262, 0.14, { type: 'square', vol: 0.07, at: 0.16 }); },
    click() { beep(660, 0.08, { type: 'triangle', vol: 0.18 }); },
  };
}
