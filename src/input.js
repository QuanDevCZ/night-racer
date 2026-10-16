// Keyboard + gamepad merged into one analog input, plus edge-triggered actions.
const ACTIONS = {
  boost: ['ShiftLeft', 'ShiftRight'],
  camera: ['KeyC'],
  pause: ['Escape', 'KeyP'],
  respawn: ['KeyR'],
  mute: ['KeyM'],
  confirm: ['Enter', 'NumpadEnter'],
};
// Standard gamepad mapping: 0 A, 1 B, 2 X, 3 Y, 6 LT, 7 RT, 8 Back, 9 Start.
const PAD = { boost: [1, 2], camera: [3], pause: [9], respawn: [8], confirm: [0, 9] };

export function createInput() {
  const keys = new Set();
  const prev = {};
  const state = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, pad: false };

  addEventListener('keydown', (e) => {
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    keys.add(e.code);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  const k = (...codes) => codes.some((c) => keys.has(c));
  const dead = (v, d = 0.12) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));

  function pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  return {
    state,
    /** Poll once per frame. Returns the edge-triggered actions pressed this frame. */
    poll() {
      const p = pad();
      const btn = (i) => !!(p && p.buttons[i] && p.buttons[i].pressed);
      const val = (i) => (p && p.buttons[i] ? p.buttons[i].value : 0);
      let steer = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0);
      if (p) steer += dead(p.axes[0] || 0);
      state.steer = Math.max(-1, Math.min(1, steer));
      state.throttle = Math.max(k('KeyW', 'ArrowUp') ? 1 : 0, val(7));
      state.brake = Math.max(k('KeyS', 'ArrowDown') ? 1 : 0, val(6));
      state.handbrake = k('Space') || btn(0);
      state.pad = !!p;
      const fired = {};
      for (const a of Object.keys(ACTIONS)) {
        const down = k(...ACTIONS[a]) || (PAD[a] || []).some(btn);
        fired[a] = down && !prev[a];
        prev[a] = down;
      }
      state.boost = fired.boost;
      return fired;
    },
  };
}
