# Night Racer

A 3D arcade street racer that runs in the browser. It's a night-city circuit with you against 3 AI rivals over 3 laps.
All the geometry, textures and lighting are procedural, and every sound is synthesized live with the Web Audio
API. There are no asset files.

## Run

```bash
npx serve .      # then open the printed http://localhost URL
npm test         # 25 Node tests, zero dependencies
```

ES modules need `http://`, not `file://`. Three.js r160 loads from jsDelivr through an import map, so the
first load needs network.

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Throttle / brake–reverse | W / S or ↑ / ↓ | RT / LT |
| Steer | A / D or ← / → | left stick |
| Handbrake drift | Space | A |
| Boost (3 charges) | Shift | B or X |
| Camera (chase / bumper) | C | Y |
| Respawn on track | R | Back |
| Pause | Esc / P | Start |
| Mute | M | — |

Drifting refills boost faster than the passive recharge.

## How it's built

- `src/core/` is pure logic with no DOM and no Three.js, so it runs in Node:
  - `track.js`: Catmull-Rom spline, arc-length sampling, nearest-point queries and the AI speed profile.
  - `physics.js`: the kinematic bicycle model, drift, boost, walls and gearbox.
  - `race.js`: checkpoints, laps, ranking, and the wrong-way and off-track alerts.
  - `ai.js`: pure-pursuit driving with overtaking and stuck recovery.
  - `sim.js`: the whole race tick.
- The browser side only renders what the simulation produces:
  - `world.js`: the city.
  - `cars.js`: the car meshes.
  - `fx.js`: particles, skid marks and speed streaks.
  - `post.js`: bloom and the speed blur.
  - `audio.js`: the synth.
  - `hud.js`: the HUD.
  - `input.js`: keyboard and gamepad.
  - `main.js`: the loop and the state machine.
- Physics runs at a fixed 120 Hz and rendering is interpolated. The pixel ratio adapts to hold the frame rate
  on integrated GPUs.
