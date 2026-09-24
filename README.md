# Yard Master – HGV reversing game for HGV1 Radio

Browser mini-game: reverse a UK artic onto a loading bay. HTML5 Canvas +
TypeScript, built with Vite into one static folder. No backend, no CDNs.

> **Status: version 1 complete.** 10 levels, night/rain, Pro-view mirrors,
> touch and gamepad controls, synthesised sound, share card. See
> [Deploying](#deploying) and [Version 2 ideas](#version-2-ideas). The full
> deploy/WordPress guide will be added at the end.

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
| V | Pro view mirrors on/off |
| M | Sound on/off |
| + / − or mouse wheel | Zoom |

### Touch (phones and tablets, landscape)

Touch mode switches on automatically on touch devices.

- **Steering wheel (bottom-left):** drag round to steer; 270° of drag is
  full lock (`STEERING.touchWheelDegreesToLock`). Let go and the truck
  self-centres, with the wheel following it back.
- **REV / FWD pedals (bottom-right):** hold to drive. They're multi-touch,
  so you can steer and pedal at once.
- **P button:** handbrake on/off.
- **Top-right buttons:** pause, sound on/off and full screen. On Android the full-screen
  button also locks landscape; the iframe needs `allow="fullscreen"`.
- **Portrait:** held upright, the phone shows a "turn your phone sideways"
  prompt (with a "Play anyway" option). This also works inside a
  landscape-shaped iframe on a portrait phone.
- **HUD:** the gauges move to a compact panel top-left, and tutorial tips
  name the on-screen controls.

### Gamepad (standard mapping – Xbox / PlayStation)

| Control | Action |
| --- | --- |
| Left stick / d-pad | Steer (the stick sets the angle directly) |
| RT / LT | Forward / reverse |
| A | Handbrake (in menus: press the highlighted button) |
| D-pad (menus) | Move between buttons |
| Start | Pause |
| Y | Restart |
| X | Pro view mirrors |
| Back / Select | Sound on/off |

The brief asked for `D` to toggle debug, but `D` is already "steer right"
under WASD, so debug uses `` ` `` / F3 instead.

## Tuning the handling

Every vehicle constant is in **`src/config/vehicle.ts`**: dimensions,
steering lock/rate/self-centring, speeds, acceleration, jackknife angle,
and the metres→pixels constant. Change a number, save, and the dev server
reloads.

## Levels (`src/levels/*.json`)

| # | Name | What's new |
| --- | --- | --- |
| 1 | First Drop | Straight back, empty dock, tutorial prompts |
| 2 | Tight Squeeze | Straight back between parked trailers, slightly off line |
| 3 | Sight Side | First 90° reverse, trailer swinging to the driver's side |
| 4 | Cone Alley | Sight side with a coned-off yard |
| 5 | Blind Side | 90° onto the nearside |
| 6 | Sawtooth | 45° angled bays in a busy yard |
| 7 | Short Run-Up | Cramped yard – shunts expected |
| 8 | Night Shift | Dark yard: headlights, reversing lights and dim dock lamps only |
| 9 | Wet Wednesday | Rain: fog, and 70% grip on forward pull-ups |
| 10 | The Monday Morning | Tight, blind side, trailers both sides, tough targets |

Levels unlock one at a time; stars and best times are saved per level.
For testing, open the game with `#unlock-all` on the end of the URL to play
any level (nothing extra is saved).

### Adding or editing a level

Levels are JSON files played in filename order. Copy one, change it, and
rebuild; no code changes are needed. The main fields:

- `width`, `height` – tarmac size in metres (x → east, y → south).
- `buildings` – `{ x, y, w, h, angle? }` rectangles.
- `docks` – rows of bays: `{ x, y, along, heading, count, width?, length?,
  spacing?, firstLabel?, buffers?, pods? }`. `heading` is the direction out
  of the bay (90 = south); `along` is the direction the row runs. For angled
  (sawtooth) docks, set `pods: true` so each bay gets its own dock block.
- `targetBay` – the label of the bay to reverse onto.
- `obstacles` – `cone`, `bollard`, `trailer` (x, y = rear centre + heading),
  `trailer-in-bay` (bay label), `wall`/`kerb` (centre, length, width, angle).
- `markings` – painted `text`, `hatch` boxes and `line`s (decoration).
- `conditions` – `night`, `rain`, `forwardGrip` (0–1), `visibility` (metres).
- `stars` – `three` and `two`, each `{ shunts, time }`.
- `tutorial` – `{ trigger, text }` prompts. The triggers are `start`,
  `reversing`, `drift`, `nearBay`, `aligned`, `shunt` and `contact`.
- `driveOut` – a list of `{ throttle: 1 | -1, steer: -1…1, dist: metres }`
  moves that drive the rig OUT of the bay. This is the level's proof that it
  can be solved.

Then run:

```bash
npm run check-levels            # validate every level
npm run check-levels -- --write # also set each spawn from the drive-out
```

The checker parks the rig on the target bay and replays the drive-out. It
fails the level if anything is touched. The vehicle model is
time-reversible, so a clean drive-out proves the reverse-in exists, and
`--write` puts the truck where the drive-out ends. It also prints the
route length and shunts as a guide for star targets. (Needs Node 22.6+.)

## Night, rain and Pro view

- **Night:** a half-resolution light map darkens the yard, with the lights
  cut out of it. These are the headlights, reversing lights, tail lights,
  the trailer's amber side markers and a dim lamp over each dock door (the
  target bay's is brighter).
- **Rain:** screen-space rain, wet tarmac and fog beyond `visibility` metres.
  `forwardGrip` scales acceleration and braking when pulling forward.
- **Pro view (V):** nearside (N/S) and offside (O/S) mirror insets. Each is a
  rotated, cropped, mirror-image view of the world from the mirror heads on
  the cab, so the trailer swings out of one mirror and into the other as
  you articulate. The setting is saved.
- **Camera:** it frames the rig and the target bay together when they fit,
  otherwise follows the rig and leans towards the bay.

## Audio (`src/audio/sound.ts`)

All sound is synthesised with the Web Audio API, so there are no audio files
and nothing extra to download:

- **Engine:** a diesel idle/rev loop that follows the pedals and road speed.
- **Air brakes:** a hiss when the handbrake goes on, a short "psst" when it
  comes off.
- **Reversing beeper:** about one beep a second while in reverse.
- **Bumps:** a thud on contact, a lighter plastic knock for cones, and a
  heavier crunch for a heavy hit or a jackknife.
- **Delivered:** a quiet two-note chime.

Sound only starts after the first tap, click or key press. It is kept quiet
(`MASTER_VOLUME` = 0.32, peaks well below clipping) because the station's
radio player may be on the same page. There's a clear mute toggle (title
screen, pause menu, the 🔊 button on touch, **M** or the gamepad's Back
button), and the choice is saved. Audio stops when the game is paused and
when the tab is hidden.

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
- **Jackknife:** reversing with the articulation past 80° = fail. Pulling
  forward past 80° is allowed (with a warning); the cab stops the trailer at 90°.
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

HGV1 Radio branding is applied:

- **Colours** (`styles/theme.css`):
  - orange `#f85f00` for buttons, stars, hazard stripes and highlights;
  - black `#0e0f11` for backgrounds;
  - white for text and the focus ring.
  - Primary buttons use black text on orange, for readability in a bright
    cab. The delivery note uses a darker orange (`#c24a00`) so text stays
    readable on the cream paper.
- **Logos** (`public/brand/`):
  - `logo-on-dark.webp` is the white version, used on the title screen and
    the share card;
  - `logo-on-light.webp` is the black version, used on the delivery note and
    painted on the player's trailer roof;
  - `favicon.png` and `apple-touch-icon.png` are the browser-tab icons, made
    from the logo's G.
- **Text** (`src/config/brand.ts`): station name "HGV1 Radio", and the share
  address. The address is **provisional**
  (`projectchimera.co.uk/yardmaster`) – confirm it before launch.
- **Player's truck:** orange cab, black curtainsider with a white roof and the
  logo. Set `trailerRoofLogo: false` in `brand.ts` to remove the roof logo.

To swap a logo, replace the file in `public/brand/` (keep the name) and
rebuild.

## How the physics works (`src/physics/artic.ts`)

- **Tractor:** kinematic bicycle model about the drive axle,
  `θ̇ = v·tan δ / L` (L = 3.8 m, δ ≤ 35°, steering rate-limited).
- **Trailer:** off-axle hitch model. The fifth wheel is `a` = 0.35 m ahead of
  the drive axle, and the trailer pivots about its tri-axle centre
  L₂ = 7.7 m behind the kingpin:
  `ψ̇ = [v·sin(θ−ψ) + a·θ̇·cos(θ−ψ)] / L₂`.
  Reversing makes straight an unstable balance, so the trailer swings
  opposite to the steering and has to be caught, as on a real artic.
- **Jackknife:** |θ − ψ| > 80° while reversing ends the attempt. Going
  forwards, a mechanical stop holds the articulation at 90°.
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
src/core/             maths helpers, keyboard, touch and gamepad input
src/physics/          artic kinematics, oriented boxes, SAT collision
src/render/           camera, yard/vehicle art, HUD, debug overlay,
                      night/rain (atmosphere.ts), mirrors (mirrors.ts)
src/levels/           level JSON files, parser, bundler glob
scripts/check-levels.ts  level validator / solvability proof
src/game/yard.ts      runtime level types
src/game/tutorial.ts  tutorial prompts
src/game/session.ts   one attempt: collisions, time, shunts, contacts, stars
src/game/obstacles.ts yard data → collision boxes
src/game/bay.ts       "parked correctly?" check
src/game/storage.ts   localStorage progress
src/config/rules.ts   scoring and contact rules
src/config/brand.ts   station name, share URL, logo
src/share/            share card image, share/download/copy
src/ui/screens.ts     results (delivery note) and fail screens
src/ui/menus.ts       title, level select, briefing
```

## Deploying

1. **Brand it first.**
   - Colours: `styles/theme.css`.
   - Station name and share URL: `src/config/brand.ts`. Point `shareUrl` at
     the page the game is embedded on.
   - Logo: put it in `public/` (e.g. `public/logo.png`) and set `logoSrc`
     to `'./logo.png'`.
2. **Build:** `npm install && npm run build`. The whole game is now in `dist/`
   (`index.html` + `assets/`), about 100 KB in total.
3. **Upload** the *contents* of `dist/` to a folder on your web server, e.g.
   `/games/yardmaster/`. Use SFTP or your host's file manager, not the
   WordPress media library. All paths are relative, so any folder works
   without rebuilding.
4. **Check** it directly at `https://your-site/games/yardmaster/`.

Tips:

- Host it on the **same domain** as the WordPress site. Some browsers
  (notably Safari) restrict storage in iframes from other domains, which
  would lose players' saved progress and stars.
- Caching: the files in `assets/` have hashed names, so they can be cached
  for a year. Keep `index.html` on a short cache so updates show up.

## Embedding in WordPress / Elementor

Add an **HTML** widget (Elementor) or a **Custom HTML** block (WordPress
editor) and paste:

```html
<div class="yardmaster-wrap">
  <iframe
    src="/games/yardmaster/"
    title="Yard Master – HGV reversing game"
    allow="fullscreen; web-share; clipboard-write; autoplay"
    allowfullscreen
    loading="lazy"></iframe>
</div>
<style>
  .yardmaster-wrap { position: relative; width: 100%; max-width: 1100px; margin: 0 auto; padding-top: 56.25%; }
  .yardmaster-wrap iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; border-radius: 12px; }
</style>
```

- The wrapper keeps a 16:9 shape at any width (`padding-top: 56.25%`).
- The `allow` attribute matters:
  - `fullscreen` enables the full-screen button.
  - `web-share` lets the Share button open the phone's share sheet.
  - `clipboard-write` makes Copy text work.
  - `autoplay` lets sound start after the first tap.
- On a phone held upright the game asks the player to turn sideways, and
  the full-screen button makes it fill the screen.

## Version 2 ideas

Station and community:

- Weekly leaderboards (needs a small backend, e.g. a serverless function +
  key-value store), with on-air shout-outs for the winners.
- A daily yard: one generated layout per day, the same for everyone.
- Challenge links: `#level-7-beat-38s` sets up a rival time to beat.
- Haulier leagues, where drivers enter a company name.
- An in-cab radio button that plays the station's live stream inside the
  game.
- Sponsor slots: curtain-side liveries on parked trailers and yard signage.

Gameplay:

- A coupling challenge: reverse under a trailer and line up the kingpin
  with the fifth wheel.
- More rigs: a rigid with a drawbar trailer (two pivots – properly hard),
  a double-decker, a steer-axle trailer, a 6x2 tractor.
- Mirrors-only mode, with no top-down view.
- A replay of each run with the wheel tracks drawn, and a ghost of your
  best run.
- A banksman giving hand signals, and moving yard traffic.
- A trailer path prediction line as a beginner assist, and a bay-guide-off
  "pro" setting.
- An accuracy score (e.g. "0.04 m off centre") on the delivery note as a
  tie-breaker.
- An in-browser level editor that exports the level JSON and runs the
  proof checker.

Technical:

- Fixed-timestep, deterministic physics, so replays, ghosts and
  server-checked leaderboard scores are possible.
- Cache the static yard in an off-screen layer (helps low-end phones,
  especially with mirrors on).
- Automated tests (physics, bay check, scoring) and a browser smoke test in
  CI alongside `check-levels`.
- Privacy-friendly analytics (with consent) to see which levels players
  fail and quit on, then tune the star times.
- Accessibility: colour-blind-safe gauge colours, an option to turn off
  camera shake, and on-screen cues for the beeper and contacts.
