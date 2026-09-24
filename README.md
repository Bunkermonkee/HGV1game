# Yard Master – HGV reversing game for HGV1 Radio

Browser mini-game: reverse a UK artic onto a loading bay. HTML5 Canvas +
TypeScript, built with Vite into one static folder. No backend, no CDNs.

> **Status: stage 1 – handling prototype.** One truck, one empty yard, debug
> overlay. Collisions, scoring, levels, touch controls, audio and the share
> card come in later stages. The full deploy/WordPress guide will be added at
> the end.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (also on your LAN IP for phones)
npm run build      # static output in dist/
npm run preview    # serve dist/ locally
```

## Controls (desktop)

| Key | Action |
| --- | --- |
| ← → / A D | Steer (wheel turns at a limited rate; self-centres slowly) |
| ↑ / W | Forward (brakes first if rolling backwards) |
| ↓ / S | Reverse (brakes first if rolling forwards) |
| Space | Handbrake on/off |
| R | Restart |
| Esc | Pause |
| `` ` `` or F3 | Debug overlay |
| + / − or mouse wheel | Zoom |

The brief asked for `D` to toggle debug, but `D` is already "steer right"
under WASD, so debug uses `` ` `` / F3 instead.

## Tuning the handling

Every vehicle constant is in **`src/config/vehicle.ts`**: dimensions,
steering lock/rate/self-centring, speeds, acceleration, jackknife angle,
and the metres→pixels constant. Change a number, save, and the dev server
reloads.

## How the physics works (`src/physics/artic.ts`)

- **Tractor:** kinematic bicycle model about the drive axle,
  `θ̇ = v·tan δ / L` (L = 3.8 m, δ ≤ 35°, steering rate-limited).
- **Trailer:** off-axle hitch model. The fifth wheel is `a` = 0.35 m ahead of
  the drive axle, and the trailer pivots about its tri-axle centre
  L₂ = 7.7 m behind the kingpin:
  `ψ̇ = [v·sin(θ−ψ) + a·θ̇·cos(θ−ψ)] / L₂`.
  Reversing makes straight an unstable balance, so the trailer swings
  opposite to the steering and has to be caught, as on a real artic.
- **Jackknife:** |θ − ψ| > 80° ends the attempt.
- Frames are split into equal ≤ 1/120 s sub-steps, so the handling is the
  same at 60, 90, 120 or 144 Hz.

## Project layout

```
index.html            page shell + DOM overlays
styles/theme.css      ALL brand colours (placeholders) – single theme file
styles/main.css       UI styles
src/main.ts           bootstrap, loop, DPR, auto-pause
src/config/vehicle.ts vehicle tuning constants
src/config/theme.ts   reads theme.css variables for the canvas
src/core/             maths helpers, keyboard input
src/physics/          artic kinematics, oriented-box geometry
src/render/           camera, yard/vehicle art, HUD, debug overlay
src/game/yard.ts      yard layout data (becomes the level JSON format)
```
