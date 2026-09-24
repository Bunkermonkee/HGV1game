/**
 * Yard Master – stage 1: handling prototype.
 * One truck, one empty yard, debug overlay. No collisions or scoring yet.
 */
import { SIMULATION } from './config/vehicle.ts';
import { loadTheme, theme } from './config/theme.ts';
import { Keyboard } from './core/input.ts';
import { DEG, damp, lerp } from './core/math.ts';
import { PROTOTYPE_YARD } from './game/yard.ts';
import { Artic } from './physics/artic.ts';
import { Camera } from './render/camera.ts';
import { DebugOverlay } from './render/debug.ts';
import { drawArtic } from './render/draw-vehicle.ts';
import { drawYard } from './render/draw-yard.ts';
import { banner, drawHud } from './render/hud.ts';

loadTheme();

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;
const pauseEl = document.getElementById('pause')!;
const focusHint = document.getElementById('focus-hint')!;

const yard = PROTOTYPE_YARD;
const artic = new Artic();
const camera = new Camera();
const keys = new Keyboard();
const debug = new DebugOverlay();

let viewW = 0;
let viewH = 0;
let dpr = 1;
let paused = false;
/** 0 → camera centred on the rig, 1 → biased towards the trailer rear. */
let lookBehind = 0;

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
  const s = yard.spawn;
  artic.resetFromTrailerRear(s.x, s.y, s.heading * DEG, s.articulation ?? 0);
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

// ---- UI wiring -----------------------------------------------------------------

document.getElementById('resume')!.addEventListener('click', () => setPaused(false));
document.getElementById('restart')!.addEventListener('click', restart);

// Auto-pause when the tab is hidden (the browser also stops rAF then).
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true);
});

// Inside an iframe the game needs focus before it gets key events.
canvas.addEventListener('pointerdown', () => canvas.focus());
window.addEventListener('focus', () => focusHint.classList.add('hidden'));
window.addEventListener('blur', () => {
  if (!paused) focusHint.classList.remove('hidden');
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
  if (keys.wasPressed('Escape')) setPaused(!paused);
  if (keys.wasPressed('KeyR')) restart();
  if (keys.wasPressed('Backquote') || keys.wasPressed('F3')) debug.enabled = !debug.enabled;
  if (paused) return;
  if (keys.wasPressed('Space')) artic.handbrake = !artic.handbrake;
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
    artic.step(h, input);
    if (debug.enabled) debug.record(artic);
  }
  artic.takeEvents(); // gear changes / jackknife: consumed by scoring in stage 2

  const wantBehind = artic.gear === 'R' ? 1 : 0;
  lookBehind += (wantBehind - lookBehind) * damp(1.5, dt);
  camera.follow(cameraTarget());
}

function render(): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = theme.yardGrass;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  camera.apply(ctx, viewW, viewH, dpr);
  drawYard(ctx, yard);
  drawArtic(ctx, artic);
  debug.drawWorld(ctx, artic);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawHud(ctx, artic, viewW, viewH);
  debug.drawScreen(ctx, artic);
  drawHelp();

  if (artic.jackknifed) {
    banner(ctx, viewW / 2, viewH * 0.4, 'JACKKNIFED', theme.uiBad, Math.min(64, viewW / 9));
    banner(ctx, viewW / 2, viewH * 0.4 + Math.min(64, viewW / 9) * 1.5, 'Press R to try again', '#fff', 18);
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
  render();
  keys.endFrame();
  requestAnimationFrame(frame);
}

restart();
canvas.focus();
requestAnimationFrame((t) => {
  last = t;
  frame(t);
});
