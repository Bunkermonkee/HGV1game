/**
 * Yard Master – entry point: screens, game loop, camera and rendering.
 */
import { Sound } from './audio/sound.ts';
import { RULES } from './config/rules.ts';
import { SIMULATION, SPEED, STEERING } from './config/vehicle.ts';
import { loadTheme, theme } from './config/theme.ts';
import { GamepadInput, moveFocus, PAD } from './core/gamepad.ts';
import { Keyboard } from './core/input.ts';
import { DEG, MPH_TO_MS, damp, lerp, type Vec2 } from './core/math.ts';
import { TouchControls } from './core/touch.ts';
import { Session, type SessionEvent } from './game/session.ts';
import { loadSave, recordResult, saveSettings } from './game/storage.ts';
import { Tutorial } from './game/tutorial.ts';
import { LEVELS } from './levels/index.ts';
import { obbCorners } from './physics/geometry.ts';
import { Atmosphere, needsLightmap } from './render/atmosphere.ts';
import { Camera } from './render/camera.ts';
import { DebugOverlay } from './render/debug.ts';
import { drawObstacles } from './render/draw-obstacles.ts';
import { drawArtic } from './render/draw-vehicle.ts';
import { drawYard } from './render/draw-yard.ts';
import { banner, drawBayGuide, drawHud, drawRunStats, drawTip, hudHeight, Toasts } from './render/hud.ts';
import { Mirrors } from './render/mirrors.ts';
import {
  hideMenus,
  initMenus,
  setControlsNote,
  setProViewLabel,
  setSoundLabel,
  showBriefing,
  showLevelSelect,
  showTitle,
} from './ui/menus.ts';
import type { DriveInput } from './physics/artic.ts';
import { hideScreens, initScreens, isScreenOpen, showFail, showResults } from './ui/screens.ts';

loadTheme();

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;
const pauseEl = document.getElementById('pause')!;
const focusHint = document.getElementById('focus-hint')!;

/** Control names substituted into tutorial and HUD text, per input device. */
const LABELS = {
  keyboard: { left: '← / A', right: '→ / D', forward: '↑ / W', reverse: '↓ / S', handbrake: 'Space' },
  touch: { left: 'the wheel left', right: 'the wheel right', forward: 'the FWD pedal', reverse: 'the REV pedal', handbrake: 'the P button' },
  gamepad: { left: 'the stick left', right: 'the stick right', forward: 'RT', reverse: 'LT', handbrake: 'A' },
};

const camera = new Camera();
const keys = new Keyboard();
const debug = new DebugOverlay();
const sound = new Sound();
const gamepad = new GamepadInput();
const touch = new TouchControls({
  onHandbrake: () => {
    if (mode === 'play' && !paused) toggleHandbrake();
  },
  onPause: () => {
    if (mode === 'play' && !isScreenOpen()) setPaused(true);
  },
  onFullscreen: toggleFullscreen,
  onSound: () => toggleSound(),
});
const toasts = new Toasts();
const atmosphere = new Atmosphere();
const mirrors = new Mirrors();

let levelIndex = 0;
let session = new Session(LEVELS[0]);
let tutorial = new Tutorial(LEVELS[0].tutorial, LABELS.keyboard);

type Mode = 'menu' | 'briefing' | 'play';
let mode: Mode = 'menu';
let viewW = 0;
let viewH = 0;
let dpr = 1;
let paused = false;
/** 0 → camera centred on the rig, 1 → biased towards the trailer rear. */
let lookBehind = 0;
/** What to show once the end-of-run delay has passed. */
let pendingScreen: (() => void) | null = null;
let endBanner: { text: string; colour: string } | null = null;

mirrors.enabled = loadSave().settings.proView;
setProViewLabel(mirrors.enabled);
sound.muted = !loadSave().settings.sound;
setSoundLabel(!sound.muted);

// Audio may only start from a user gesture: unlock it on the first one.
for (const type of ['pointerdown', 'keydown', 'touchend']) {
  window.addEventListener(type, () => sound.unlock(), { capture: true });
}

/** Last frame's throttle, for the engine note. */
let lastThrottle = 0;

// ---- Canvas sizing / devicePixelRatio ---------------------------------------

let touchLayout = touch.layout(window.innerWidth, window.innerHeight);
let rotateDismissed = false;

function controlLabels() {
  return touch.active ? LABELS.touch : gamepad.active ? LABELS.gamepad : LABELS.keyboard;
}

/** Portrait on a touch device (also inside a landscape-shaped iframe on a portrait phone). */
function portraitPhone(): boolean {
  if (!touch.active) return false;
  const type = screen.orientation?.type;
  return type ? type.startsWith('portrait') : window.innerHeight > window.innerWidth;
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {});
    return;
  }
  document.documentElement
    .requestFullscreen()
    .then(() => {
      // Android Chrome can then hold landscape; elsewhere this just fails quietly.
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      return o.lock?.('landscape');
    })
    .catch(() => {});
}

function resize(): void {
  // Cap DPR at 2: sharper than that costs fill-rate on phones for no visible gain.
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewW = canvas.clientWidth;
  viewH = canvas.clientHeight;
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
  touchLayout = touch.layout(viewW, viewH);
}
window.addEventListener('resize', resize);
resize();

// ---- Levels and screens -----------------------------------------------------

function loadLevel(index: number): void {
  levelIndex = index;
  const level = LEVELS[index];
  session = new Session(level);
  tutorial = new Tutorial(level.tutorial, controlLabels());
  resetRun();
}

/** Put the truck back at the start of the current level. */
function resetRun(): void {
  session.reset();
  tutorial.reset();
  pendingScreen = null;
  endBanner = null;
  lookBehind = 0;
  hideScreens();
  toasts.clear();
  debug.clearTrails();
  updateCamera(0, true);
}

function openTitle(): void {
  mode = 'menu';
  setPaused(false);
  hideScreens();
  showTitle();
}

/** Testing aid: open the game with #unlock-all to play any level (not saved). */
const UNLOCK_ALL = location.hash === '#unlock-all';

function openLevelSelect(): void {
  mode = 'menu';
  setPaused(false);
  hideScreens();
  const save = loadSave();
  if (UNLOCK_ALL) save.unlocked = LEVELS.length;
  showLevelSelect(LEVELS, save, levelIndex);
}

function openBriefing(index: number): void {
  loadLevel(index);
  mode = 'briefing';
  setPaused(false);
  showBriefing(LEVELS[index]);
}

function startDriving(): void {
  hideMenus();
  mode = 'play';
  canvas.focus();
}

function restart(): void {
  resetRun();
  mode = 'play';
  setPaused(false);
}

function setPaused(p: boolean): void {
  paused = p;
  pauseEl.classList.toggle('hidden', !p);
  if (!p && mode === 'play') canvas.focus();
}

function toggleSound(): void {
  sound.setMuted(!sound.muted);
  if (!sound.muted) sound.unlock();
  setSoundLabel(!sound.muted);
  const save = loadSave();
  saveSettings({ ...save.settings, sound: !sound.muted });
}

/** Handbrake on/off, with the air-brake hiss. */
function toggleHandbrake(): void {
  if (session.state !== 'driving') return;
  session.toggleHandbrake();
  sound.airBrake(session.artic.handbrake);
}

function toggleProView(): void {
  mirrors.enabled = !mirrors.enabled;
  setProViewLabel(mirrors.enabled);
  const save = loadSave();
  saveSettings({ ...save.settings, proView: mirrors.enabled });
}

function handleEvent(e: SessionEvent): void {
  switch (e.type) {
    case 'contact':
      sound.bump(e.label === 'cone');
      toasts.show(`Contact with the ${e.label} – +${RULES.contact.penaltySeconds}s`, theme.uiWarn);
      camera.shake(0.18);
      break;
    case 'buffers':
      toasts.show('On the buffers', theme.uiGood, 1.4);
      break;
    case 'message':
      toasts.show(e.text, theme.uiWarn, 3);
      break;
    case 'fail':
      sound.crash();
      camera.shake(e.title === 'HEAVY CONTACT' ? 0.6 : 0.2);
      endBanner = { text: e.title, colour: theme.uiBad };
      pendingScreen = () => showFail(e.title, e.reason);
      break;
    case 'success': {
      const r = e.result;
      const level = LEVELS[levelIndex];
      const newBest = recordResult(r.levelId, level.number, r.stars, r.total, r.shunts);
      const best = loadSave().levels[r.levelId];
      const hasNext = levelIndex + 1 < LEVELS.length;
      endBanner = { text: 'DELIVERED', colour: theme.uiGood };
      sound.chime();
      pendingScreen = () => void showResults(r, session, best, newBest, hasNext);
      break;
    }
  }
}

// ---- UI wiring -----------------------------------------------------------------

initScreens({
  onRetry: restart,
  onNext: () => openBriefing(Math.min(levelIndex + 1, LEVELS.length - 1)),
  onLevelSelect: openLevelSelect,
});
initMenus({
  onPlay: openLevelSelect,
  onPickLevel: openBriefing,
  onStart: startDriving,
  onBackToTitle: openTitle,
  onLevelSelect: openLevelSelect,
  onToggleProView: toggleProView,
  onToggleSound: toggleSound,
});
document.getElementById('resume')!.addEventListener('click', () => setPaused(false));
document.getElementById('restart')!.addEventListener('click', restart);

// Auto-pause when the tab is hidden (the browser also stops rAF then).
document.addEventListener('visibilitychange', () => {
  sound.setPageVisible(!document.hidden);
  if (document.hidden && mode === 'play' && !isScreenOpen()) setPaused(true);
});

// Inside an iframe the game needs focus before it gets key events.
canvas.addEventListener('pointerdown', () => canvas.focus());
window.addEventListener('focus', () => focusHint.classList.add('hidden'));
window.addEventListener('blur', () => {
  if (mode === 'play' && !paused && !isScreenOpen() && !touch.active) focusHint.classList.remove('hidden');
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    camera.zoomBy(e.deltaY > 0 ? 0.9 : 1 / 0.9);
  },
  { passive: false },
);

const DRIVE_KEYS = ['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS'];

/** Gamepad buttons: menus use the d-pad + A; in the cab, A = handbrake, Start = pause. */
function handlePad(): void {
  if (gamepad.wasPressed(PAD.BACK)) toggleSound();
  const overlayOpen = mode !== 'play' || paused || isScreenOpen();
  if (overlayOpen) {
    if (gamepad.wasPressed(PAD.DOWN) || gamepad.wasPressed(PAD.RIGHT)) moveFocus(1);
    if (gamepad.wasPressed(PAD.UP) || gamepad.wasPressed(PAD.LEFT)) moveFocus(-1);
    if (gamepad.wasPressed(PAD.A)) {
      const el = document.activeElement;
      if (el instanceof HTMLButtonElement) el.click();
      else moveFocus(1);
    }
    if (gamepad.wasPressed(PAD.START) && paused) setPaused(false);
    if (mode === 'briefing' && (gamepad.wasPressed(PAD.RT) || gamepad.wasPressed(PAD.LT))) startDriving();
    return;
  }
  if (gamepad.wasPressed(PAD.A)) toggleHandbrake();
  if (gamepad.wasPressed(PAD.START)) setPaused(true);
  if (gamepad.wasPressed(PAD.Y)) restart();
  if (gamepad.wasPressed(PAD.X)) toggleProView();
}

function handleKeys(): void {
  if (keys.wasPressed('Backquote') || keys.wasPressed('F3')) debug.enabled = !debug.enabled;
  if (keys.wasPressed('KeyV')) toggleProView();
  if (keys.wasPressed('KeyM')) toggleSound();
  if (mode === 'briefing') {
    // A drive key on the briefing card starts the level straight away.
    if (DRIVE_KEYS.some((k) => keys.wasPressed(k))) startDriving();
    return;
  }
  if (mode !== 'play') return;
  if (keys.wasPressed('KeyR')) restart();
  if (isScreenOpen()) return;
  if (keys.wasPressed('Escape')) setPaused(!paused);
  if (paused) return;
  if (keys.wasPressed('Space')) toggleHandbrake();
  if (keys.wasPressed('Equal') || keys.wasPressed('NumpadAdd')) camera.zoomBy(1.15);
  if (keys.wasPressed('Minus') || keys.wasPressed('NumpadSubtract')) camera.zoomBy(1 / 1.15);
}

// ---- Camera -------------------------------------------------------------------

const MIN_VIEW = 36;
const MAX_VIEW = 64;

/**
 * Frame the rig and the target bay together when they fit; otherwise follow
 * the rig (looking behind when reversing), leaning towards the bay.
 */
function updateCamera(dt: number, snap = false): void {
  const artic = session.artic;
  const bay = session.bay;
  const r = artic.trailerRear;
  const f = artic.frontAxle;
  const mid = { x: (r.x + f.x) / 2, y: (r.y + f.y) / 2 };
  const focus = { x: lerp(mid.x, r.x, 0.45 * lookBehind), y: lerp(mid.y, r.y, 0.45 * lookBehind) };

  const a = bay.heading * DEG;
  const pts: Vec2[] = [
    ...obbCorners(artic.tractorBox),
    ...obbCorners(artic.trailerBox),
    { x: bay.x, y: bay.y },
    { x: bay.x + Math.cos(a) * bay.length, y: bay.y + Math.sin(a) * bay.length },
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  // Metres needed across the SHORTER screen side to fit the box plus margin.
  const shortPx = Math.min(viewW, viewH) || 1;
  const kx = viewW / shortPx;
  const ky = viewH / shortPx;
  const needed = Math.max((maxX - minX) / kx, (maxY - minY) / ky) + 14;
  const view = Math.min(MAX_VIEW, Math.max(MIN_VIEW, needed));
  const box = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  // 1 when everything fits, falling towards 0 as the bay gets further away.
  const fit = Math.min(1, MAX_VIEW / needed);
  const t = fit * fit;
  camera.follow({ x: lerp(focus.x, box.x, t), y: lerp(focus.y, box.y, t) }, snap);
  camera.setView(view, snap);
  if (dt > 0 || snap) camera.update(dt, viewW, viewH);
}

// ---- Main loop ---------------------------------------------------------------

/**
 * Merge keyboard, touch and gamepad. Steering: a held touch wheel or a
 * deflected stick sets the angle directly; otherwise keys/d-pad turn it at
 * the steering rate (and hands-off lets it self-centre).
 */
function readInput(): DriveInput {
  const k = keys.drive();
  const t = touch.drive();
  const g = gamepad.drive();
  const throttle = Math.sign(k.throttle + t.throttle + (g?.throttle ?? 0));
  if (t.steerMode === 'absolute') return { ...t, throttle };
  if (g?.steerMode === 'absolute') return { ...g, throttle };
  if (k.steer !== 0) return { ...k, throttle };
  return { steerMode: 'rate', steer: g?.steer ?? 0, throttle };
}

function update(dt: number): void {
  const input = readInput();
  lastThrottle = input.throttle;
  // Split the frame into equal sub-steps no larger than maxStep: stable physics
  // and no judder, whatever the display refresh rate.
  const steps = Math.max(1, Math.ceil(dt / SIMULATION.maxStep));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    session.step(h, input);
    if (debug.enabled) debug.record(session.artic);
  }
  for (const e of session.takeEvents()) handleEvent(e);
  if (session.artic.handbrakeNag) {
    toasts.show(`Handbrake on – press ${controlLabels().handbrake} to release`, theme.uiWarn, 0.6);
  }
  tutorial.update(session, dt);

  if (pendingScreen) {
    const delay = session.state === 'success' ? RULES.resultsDelay : RULES.failDelay;
    if (session.stateTime >= delay) {
      pendingScreen();
      pendingScreen = null;
    }
  }

  const wantBehind = session.artic.gear === 'R' ? 1 : 0;
  lookBehind += (wantBehind - lookBehind) * damp(1.5, dt);
}

function drawWorld(c: CanvasRenderingContext2D): void {
  drawYard(c, session.yard);
  Atmosphere.wetTarmac(c, session.yard);
  drawObstacles(c, session.obstacles);
  drawArtic(c, session.artic);
}

function render(dt: number): void {
  const yard = session.yard;
  const artic = session.artic;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = theme.yardGrass;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  camera.apply(ctx, viewW, viewH, dpr);
  drawWorld(ctx);
  if (needsLightmap(yard.conditions)) {
    atmosphere.drawLightmap(ctx, canvas.width, canvas.height, (c, k) => camera.apply(c, viewW, viewH, dpr * k), yard, artic);
  }
  camera.apply(ctx, viewW, viewH, dpr);
  debug.drawWorld(
    ctx,
    artic,
    session.obstacles.filter((o) => !o.hit).map((o) => o.box),
  );

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (yard.conditions.rain) atmosphere.drawRain(ctx, viewW, viewH, paused ? 0 : dt);
  if (mode !== 'play') return;

  const compact = touch.active;
  const hudBottom = drawHud(ctx, artic, viewW, viewH, compact);
  const statsBottom = drawRunStats(ctx, session, viewW);
  let guideBottom = statsBottom;
  if (session.state === 'driving' && session.bayCheck.near) {
    drawBayGuide(ctx, session.bayCheck, viewW, statsBottom, session.bay.label);
    guideBottom = statsBottom + 70;
  }
  if (compact) {
    // Touch: tip between the wheel and the pedals; mirrors between the top
    // HUD and the controls.
    const left = 14 + touchLayout.wheel + 12;
    const right = viewW - touchLayout.rightWidth - 12;
    if (tutorial.current) {
      if (right - left >= 200) drawTip(ctx, tutorial.current, viewW, viewH, { x: left, width: right - left, bottom: viewH - 14 });
      else drawTip(ctx, tutorial.current, viewW, viewH, { x: 12, width: viewW - 24, bottom: viewH * 0.5 });
    }
    const controlsTop = viewH - 14 - Math.max(touchLayout.wheel, touchLayout.pedalH);
    mirrors.draw(ctx, viewW, dpr, Math.max(hudBottom + 12, 64), controlsTop - 12, artic, yard, drawWorld);
  } else {
    // The tip sits above the gauges; the mirrors fit in the space above that.
    const tipTop = tutorial.current ? drawTip(ctx, tutorial.current, viewW, viewH) : viewH - hudHeight(viewW, viewH);
    mirrors.draw(ctx, viewW, dpr, Math.max(90, guideBottom - 40), tipTop - 16, artic, yard, drawWorld);
  }
  toasts.draw(ctx, paused ? 0 : dt, viewW, viewH);
  debug.drawScreen(ctx, artic);
  if (!debug.enabled && !mirrors.enabled && !touch.active && viewW > 700) drawHelp();

  if (endBanner && !isScreenOpen()) {
    banner(ctx, viewW / 2, viewH * 0.42, endBanner.text, endBanner.colour, Math.min(64, viewW / 9));
  }
}

function drawHelp(): void {
  const lines = [
    '← → / A D  steer',
    '↑ / W  forward   ↓ / S  reverse',
    'Space  handbrake   R  restart',
    'V  mirrors   Esc  pause   + −  zoom',
  ];
  ctx.save();
  ctx.font = `600 12px ${theme.uiFont}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(12,14,18,0.6)';
  ctx.fillRect(viewW - 232, 8, 224, lines.length * 17 + 10);
  ctx.fillStyle = '#e6e9ee';
  lines.forEach((l, i) => ctx.fillText(l, viewW - 16, 14 + i * 17));
  ctx.restore();
}

const rotateEl = document.getElementById('rotate')!;
document.getElementById('rotate-dismiss')!.addEventListener('click', () => (rotateDismissed = true));
let touchShown = false;
let noteForTouch = false;

let last = performance.now();
function frame(now: number): void {
  // Clamp long gaps (tab switch, breakpoint) so the truck never teleports.
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  gamepad.poll();
  handleKeys();
  handlePad();
  tutorial.labels = controlLabels();

  const rotate = portraitPhone() && !rotateDismissed;
  rotateEl.classList.toggle('hidden', !rotate);
  const showTouch = touch.active && mode === 'play' && !paused && !isScreenOpen() && !rotate;
  if (showTouch !== touchShown) {
    touch.setVisible(showTouch);
    touchShown = showTouch;
  }
  if (touch.active !== noteForTouch) {
    noteForTouch = touch.active;
    setControlsNote(noteForTouch);
  }
  if (showTouch) touch.sync(session.artic.steer / (STEERING.maxAngle * DEG), session.artic.handbrake);

  if (mode === 'play' && !paused && !rotate) update(dt);
  const a = session.artic;
  sound.update(dt, {
    running: mode === 'play' && !paused && !rotate && !isScreenOpen(),
    speedFraction: Math.min(1, Math.abs(a.speed) / (SPEED.maxForwardMph * MPH_TO_MS)),
    throttle: lastThrottle !== 0 && !a.handbrake,
    reversing: a.gear === 'R' && session.state === 'driving',
  });
  updateCamera(dt);
  debug.tickFps(dt);
  render(dt);
  keys.endFrame();
  requestAnimationFrame(frame);
}

loadLevel(0);
openTitle();
// Dev-only hook for automated play-testing; stripped from production builds.
if (import.meta.env.DEV) {
  Object.assign(window, { __game: { get session() { return session; }, openBriefing, startDriving, sound } });
}
requestAnimationFrame((t) => {
  last = t;
  frame(t);
});
