# CLAUDE.md — night-racer

Browser 3D arcade racer. Zero deps, no build: `index.html` + ES modules, Three.js r160 from the jsDelivr
import map. `npm test` (node --test) · `npx serve .` to play.

## The one boundary that matters

`src/core/*` is pure (no DOM, no `three`) and holds **all** gameplay: track, physics, race rules, AI, and
the full tick (`sim.js`). Browser files only render and play sound from what `stepRace` returns as events.
New gameplay logic goes in `core/` with a test; the headless race test in `tests/race.test.js` is the
regression net for AI and physics tuning (every car must finish 3 laps without wrecking).

## Conventions

- Heading h: forward = (sin h, cos h) on XZ, right = (−cos h, sin h); steer +1 = right (heading decreases).
  Track `lat` > 0 is right of travel. The minimap flips both axes to match the top-down view.
- Physics is a fixed 120 Hz step; rendering interpolates (`prev` poses in `main.js`).
- Boost is edge-triggered: one charge per press (`playerInput.boost` is cleared after the first substep).
- Emissive/neon materials use `toneMapped: false` with colour > 1 so the bloom picks them up.
- Track changes (`layout.js` control points) must keep the "barriers never overlap" test passing.
- `window.__nr` is a read-only debug handle (race, state, pixelRatio, renderer).
- The dev machine has an Intel UHD 620, so keep fill-rate cost in mind. The adaptive pixel ratio in `main.js`
  hides some of it.
