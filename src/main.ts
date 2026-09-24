/**
 * Yard Master – stage 2: collisions, scoring, results and share card.
 */
import { RULES } from './config/rules.ts';
import { SIMULATION } from './config/vehicle.ts';
import { loadTheme, theme } from './config/theme.ts';
import { Keyboard } from './core/input.ts';
import { damp, lerp } from './core/math.ts';
import { Session, type SessionEvent } from './game/session.ts';
import { loadSave, recordResult } from './game/storage.ts';
import { PROTOTYPE_YARD } from './game/yard.ts';
import { Camera } from './render/camera.ts';
import { DebugOverlay } from './render/debug.ts';
import { drawObstacles } from './render/draw-obstacles.ts';
import { drawArtic } from './render/draw-vehicle.ts';
import { drawYard } from './render/draw-yard.ts';
import { banner, drawBayGuide, drawHud, drawRunStats, Toasts } from './render/hud.ts';
import { hideScreens, initScreens, isScreenOpen, showFail, showResults } from './ui/screens.ts';

loadTheme();

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;
const pauseEl = document.getElementById('pause')!;
const focusHint = document.getElementById('focus-hint')!;

const session = new Session(PROTOTYPE_YARD);
const artic = session.artic;
const camera = new Camera();
const keys = new Keyboard();
const debug = new DebugOverlay();
const toasts = new Toasts();

let viewW = 0;
let viewH = 0;
let dpr = 1;
let paused = false;
/** 0 → camera centred on the rig, 1 → biased towards the trailer rear. */
let lookBehind = 0;
/** What to show once the end-of-run delay has passed. */
let pendingScreen: (() => void) | null = null;
let endBanner: { text: string; colour: string } | null = null;

// ---- Canvas sizing / devicePixelRatio ---------------------------------------

function resize(): void {
  // Cap DPR at 2: sharper than that costs fill-rate on phones for no visible gain.
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewW = canvas.clientWidth;
  viewH = canvas.clientHeight;
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
}
window.addEventListener('resize', resize);
resize();

// ---- Game state -------------------------------------------------------------

function restart(): void {
  session.reset();
  pendingScreen = null;
  endBanner = null;
  lookBehind = 0;
  hideScreens();
  toasts.clear();
  debug.clearTrails();
  camera.follow(cameraTarget(), true);
  setPaused(false);
}

function setPaused(p: boolean): void {
  paused = p;
  pauseEl.classList.toggle('hidden', !p);
  if (!p) canvas.focus();
}

function cameraTarget() {
  const r = artic.trailerRear;
  const f = artic.frontAxle;
  const mid = { x: (r.x + f.x) / 2, y: (r.y + f.y) / 2 };
  return { x: lerp(mid.x, r.x, 0.45 * lookBehind), y: lerp(mid.y, r.y, 0.45 * lookBehind) };
}

function handleEvent(e: SessionEvent): void {
  switch (e.type) {
    case 'contact':
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
      camera.shake(e.title === 'HEAVY CONTACT' ? 0.6 : 0.2);
      endBanner = { text: e.title, colour: theme.uiBad };
      pendingScreen = () => showFail(e.title, e.reason);
      break;
    case 'success': {
      const r = e.result;
      const newBest = recordResult(r.levelId, r.stars, r.total, r.shunts);
      const best = loadSave().levels[r.levelId];
      endBanner = { text: 'DELIVERED', colour: theme.uiGood };
      pendingScreen = () => void showResults(r, session, best, newBest);
      break;
    }
  }
}

// ---- UI wiring -----------------------------------------------------------------

initScreens({ onRetry: restart });
document.getElementById('resume')!.addEventListener('click', () => setPaused(false));
document.getElementById('restart')!.addEventListener('click', restart);

// Auto-pause when the tab is hidden (the browser also stops rAF then).
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !isScreenOpen()) setPaused(true);
});

// Inside an iframe the game needs focus before it gets key events.
canvas.addEventListener('pointerdown', () => canvas.focus());
window.addEventListener('focus', () => focusHint.classList.add('hidden'));
window.addEventListener('blur', () => {
  if (!paused && !isScreenOpen()) focusHint.classList.remove('hidden');
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    camera.zoomBy(e.deltaY > 0 ? 0.9 : 1 / 0.9);
  },
  { passive: false },
);

function handleKeys(): void {
  if (keys.wasPressed('KeyR')) restart();
  if (keys.wasPressed('Backquote') || keys.wasPressed('F3')) debug.enabled = !debug.enabled;
  if (isScreenOpen()) return;
  if (keys.wasPressed('Escape')) setPaused(!paused);
  if (paused) return;
  if (keys.wasPressed('Space')) session.toggleHandbrake();
  if (keys.wasPressed('Equal') || keys.wasPressed('NumpadAdd')) camera.zoomBy(1.15);
  if (keys.wasPressed('Minus') || keys.wasPressed('NumpadSubtract')) camera.zoomBy(1 / 1.15);
}

// ---- Main loop ---------------------------------------------------------------

function update(dt: number): void {
  const input = keys.drive();
  // Split the frame into equal sub-steps no larger than maxStep: stable physics
  // and no judder, whatever the display refresh rate.
  const steps = Math.max(1, Math.ceil(dt / SIMULATION.maxStep));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    session.step(h, input);
    if (debug.enabled) debug.record(artic);
  }
  for (const e of session.takeEvents()) handleEvent(e);
  if (artic.handbrakeNag) toasts.show('Handbrake on – press Space to release', theme.uiWarn, 0.6);

  if (pendingScreen) {
    const delay = session.state === 'success' ? RULES.resultsDelay : RULES.failDelay;
    if (session.stateTime >= delay) {
      pendingScreen();
      pendingScreen = null;
    }
  }

  const wantBehind = artic.gear === 'R' ? 1 : 0;
  lookBehind += (wantBehind - lookBehind) * damp(1.5, dt);
  camera.follow(cameraTarget());
}

function render(dt: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = theme.yardGrass;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  camera.apply(ctx, viewW, viewH, dpr);
  drawYard(ctx, session.yard);
  drawObstacles(ctx, session.obstacles);
  drawArtic(ctx, artic);
  debug.drawWorld(
    ctx,
    artic,
    session.obstacles.filter((o) => !o.hit).map((o) => o.box),
  );

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawHud(ctx, artic, viewW, viewH);
  const statsBottom = drawRunStats(ctx, session, viewW);
  if (session.state === 'driving' && session.bayCheck.near) {
    drawBayGuide(ctx, session.bayCheck, viewW, statsBottom, session.bay.label);
  }
  toasts.draw(ctx, paused ? 0 : dt, viewW, viewH);
  debug.drawScreen(ctx, artic);
  if (!debug.enabled && viewW > 700) drawHelp();

  if (endBanner && !isScreenOpen()) {
    banner(ctx, viewW / 2, viewH * 0.42, endBanner.text, endBanner.colour, Math.min(64, viewW / 9));
  }
}

function drawHelp(): void {
  const lines = [
    '← → / A D  steer',
    '↑ / W  forward   ↓ / S  reverse',
    'Space  handbrake   R  restart',
    'Esc  pause   `  debug   + −  zoom',
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

let last = performance.now();
function frame(now: number): void {
  // Clamp long gaps (tab switch, breakpoint) so the truck never teleports.
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  handleKeys();
  if (!paused) update(dt);
  camera.update(dt, viewW, viewH);
  debug.tickFps(dt);
  render(dt);
  keys.endFrame();
  requestAnimationFrame(frame);
}

restart();
// Dev-only hook for automated play-testing; stripped from production builds.
if (import.meta.env.DEV) (window as unknown as { __session: Session }).__session = session;
// In an iframe the page often starts without keyboard focus: say so up front.
if (!document.hasFocus()) focusHint.classList.remove('hidden');
requestAnimationFrame((t) => {
  last = t;
  frame(t);
});
