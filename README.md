# Yard Master – HGV reversing game for HGV1 Radio

Browser mini-game: reverse a UK artic onto a loading bay. HTML5 Canvas +
TypeScript, built with Vite into one static folder. No backend, no CDNs.

> **Status: stage 2 – collisions, scoring and share card.** One practice yard
> with a target bay (Bay 7). Levels, touch controls and audio come next. The
> full deploy/WordPress guide will be added at the end.

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

## Scoring rules (`src/config/rules.ts`)

- **Finish:** trailer on the target bay within ±3°, rear centre within
  ±0.3 m of the bay centre line, rear within 0.5 m of the dock buffers,
  truck stopped, handbrake on (Space). Applying the handbrake anywhere else
  tells you what's wrong ("1.4 m off the buffers – back up a touch").
- A live bay guide (angle / off centre / to buffers) appears once the
  trailer is at the bay.
- **Time** starts on the first pedal press. **Shunts** = each change from
  reverse back to forward after the first reversing move.
- **Contacts:** SAT collision of the tractor and trailer boxes against
  walls, kerbs, bollards, parked trailers, buffers and cones.
  - Under 2.5 mph: +5 s penalty and a small camera shake; the truck stops.
  - 2.5 mph or more: **HEAVY CONTACT**, fail.
  - Backing the trailer onto the buffers at 1.8 mph or less is correct
    docking, so there's no penalty.
  - Cones are knocked over (+5 s) but don't stop you.
- **Jackknife:** articulation past 80° = fail.
- **Stars** use per-level targets in the yard data (`stars.three` /
  `stars.two`, each `{ shunts, time }`, judged on time including penalties).
  Finishing at all is 1★; 3★ also needs zero contacts.
- Best time and stars per level are saved in localStorage (`yardmaster.v1`),
  wrapped in try/catch.

## Results and share card

The results screen is a delivery note ("Bay 7 – 38s – 2 shunts – ★★★").
Alongside it a 1080×1080 PNG is generated (`src/share/card.ts`). It shows
the logo slot, level and bay, a render of the player's actual parking job,
stars, time, shunts, contacts, and "Can you beat me?" with the URL.

- **Share** (Web Share API with the image + text) appears where the device
  supports sharing files – most phones.
- **Download image** and **Copy text** are always there as the fallback.
- The share text lives in `src/share/share.ts`.

## Brand

- Colours: `styles/theme.css` (placeholders).
- Station name, share URL and logo: `src/config/brand.ts`. For the logo, put
  the file in `public/` (e.g. `public/logo.png`) and set
  `logoSrc: './logo.png'`. It then appears on the delivery note and the share
  card; until then a "LOGO" placeholder shows.

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
src/physics/          artic kinematics, oriented boxes, SAT collision
src/render/           camera, yard/vehicle art, HUD, debug overlay
src/game/yard.ts      yard/level data format + practice yard
src/game/session.ts   one attempt: collisions, time, shunts, contacts, stars
src/game/obstacles.ts yard data → collision boxes
src/game/bay.ts       "parked correctly?" check
src/game/storage.ts   localStorage progress
src/config/rules.ts   scoring and contact rules
src/config/brand.ts   station name, share URL, logo
src/share/            share card image, share/download/copy
src/ui/screens.ts     results (delivery note) and fail screens
```
