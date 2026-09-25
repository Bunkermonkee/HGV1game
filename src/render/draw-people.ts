/** The banksman (hi-vis, hard hat, animated hand signals) and yard traffic. */
import { theme } from '../config/theme.ts';
import { SIGNAL_TEXT, type Banksman, type Signal } from '../game/banksman.ts';
import type { TrafficVehicle } from '../game/traffic.ts';
import type { Artic } from '../physics/artic.ts';
import type { Camera } from './camera.ts';

const HI_VIS = '#d9f23a';
const REFLECTIVE = '#e8eef2';

/** Arm angles (radians, relative to facing the truck) and reach for each signal; t animates. */
function arms(signal: Signal, t: number, pointSide: number): [number, number, number, number] {
  const beckon = Math.sin(t * 7) * 0.35;
  switch (signal) {
    case 'back': // both arms beckoning towards himself
      return [-0.5 + beckon, 0.55, 0.5 - beckon, 0.55];
    case 'left':
    case 'right': // one arm out to the side the wheel should go, the other beckoning
      return pointSide > 0 ? [-0.4 + beckon, 0.45, Math.PI / 2, 0.7] : [-Math.PI / 2, 0.7, 0.4 - beckon, 0.45];
    case 'steady': // palms out, small movements
      return [-1.1 + beckon * 0.3, 0.5, 1.1 - beckon * 0.3, 0.5];
    case 'stop': // arms crossed high
      return [0.6, 0.6, -0.6, 0.6];
    case 'forward': // pushing away
      return [-0.25, 0.7 + beckon * 0.2, 0.25, 0.7 + beckon * 0.2];
    default: // waving one arm overhead
      return [-0.3, 0.4, 1.2 + beckon * 1.5, 0.65];
  }
}

export function drawBanksman(ctx: CanvasRenderingContext2D, b: Banksman, artic: Artic, t: number): void {
  // Which way (in his frame) is the driver's left or right?
  const driverRight = artic.trailerHeading + Math.PI / 2;
  const rel = Math.sin(driverRight - b.facing);
  const pointSide = b.signal === 'right' ? Math.sign(rel) || 1 : -(Math.sign(rel) || 1);
  const [a1, r1, a2, r2] = arms(b.signal, t, pointSide);

  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0.12, 0.16, 0.34, 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(b.facing);
  // Arms (shoulders at ±0.22 across).
  ctx.strokeStyle = HI_VIS;
  ctx.lineWidth = 0.13;
  ctx.lineCap = 'round';
  for (const [side, ang, reach] of [
    [-1, a1, r1],
    [1, a2, r2],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(0, side * 0.2);
    ctx.lineTo(Math.cos(ang) * reach, side * 0.2 + Math.sin(ang) * reach);
    ctx.stroke();
  }
  // Body: hi-vis vest with reflective bands.
  ctx.fillStyle = HI_VIS;
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.2, 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = REFLECTIVE;
  ctx.fillRect(-0.05, -0.28, 0.035, 0.56);
  ctx.fillRect(0.04, -0.28, 0.035, 0.56);
  // Hard hat.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0.02, 0, 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0.1, -0.1, 0.05, 0.2);
  ctx.restore();
}

const SIGNAL_COLOUR: Record<Signal, string> = {
  wave: '#b7bec9',
  back: '#2ecc71',
  left: '#f85f00',
  right: '#f85f00',
  steady: '#ffb000',
  stop: '#ff3b30',
  forward: '#ffb000',
};

/** Speech-bubble label over the banksman, drawn in screen space so it stays readable. */
export function drawBanksmanLabel(
  ctx: CanvasRenderingContext2D,
  b: Banksman,
  camera: Camera,
  viewW: number,
  viewH: number,
): void {
  const p = camera.worldToScreen({ x: b.x, y: b.y }, viewW, viewH);
  const text = SIGNAL_TEXT[b.signal];
  ctx.save();
  ctx.font = `900 13px ${theme.uiFont}`;
  const w = ctx.measureText(text).width + 16;
  const h = 24;
  const x = Math.max(4, Math.min(viewW - w - 4, p.x - w / 2));
  const y = Math.max(4, p.y - 22 - h - camera.scale * 0.3);
  ctx.fillStyle = 'rgba(12,14,18,0.88)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 7);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(p.x - 6, y + h);
  ctx.lineTo(p.x + 6, y + h);
  ctx.lineTo(p.x, y + h + 7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = SIGNAL_COLOUR[b.signal];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2 + 1);
  ctx.restore();
}

/** The banksman's current call as a fixed HUD line, so it's never lost behind a tip or off-screen. Returns its bottom. */
export function drawBanksmanCall(ctx: CanvasRenderingContext2D, b: Banksman, viewW: number, top: number): number {
  const text = SIGNAL_TEXT[b.signal];
  ctx.save();
  const label = 'BANKSMAN  ';
  ctx.font = `700 11px ${theme.uiFont}`;
  const lw = ctx.measureText(label).width;
  ctx.font = `900 14px ${theme.uiFont}`;
  const tw = ctx.measureText(text).width;
  const w = lw + tw + 24;
  const h = 28;
  const x = viewW / 2 - w / 2;
  const y = top + 8;
  ctx.fillStyle = 'rgba(12,14,18,0.82)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `700 11px ${theme.uiFont}`;
  ctx.fillStyle = '#b7bec9';
  ctx.fillText(label, x + 12, y + h / 2 + 1);
  ctx.font = `900 14px ${theme.uiFont}`;
  ctx.fillStyle = SIGNAL_COLOUR[b.signal];
  ctx.fillText(text, x + 12 + lw, y + h / 2 + 1);
  ctx.restore();
  return y + h;
}

function beacon(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, fast: boolean): void {
  const on = Math.sin(t * (fast ? 16 : 9)) > 0;
  ctx.fillStyle = on ? '#ffae00' : '#7a4b00';
  ctx.beginPath();
  ctx.arc(x, y, 0.13, 0, Math.PI * 2);
  ctx.fill();
  if (on) {
    ctx.fillStyle = 'rgba(255,174,0,0.25)';
    ctx.beginPath();
    ctx.arc(x, y, 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawForklift(ctx: CanvasRenderingContext2D, v: TrafficVehicle, t: number): void {
  const L = v.length;
  const W = v.width;
  // Body occupies the rear 2/3; forks stick out the front.
  ctx.fillStyle = '#1a1a1a';
  for (const s of [-1, 1]) ctx.fillRect(-L / 2 + 0.3, s * (W / 2) - 0.12, 0.5, 0.24);
  ctx.fillStyle = '#f2b705';
  ctx.beginPath();
  ctx.roundRect(-L / 2, -W / 2, L * 0.68, W, 0.2);
  ctx.fill();
  ctx.fillStyle = '#3b3b3b'; // counterweight
  ctx.fillRect(-L / 2, -W / 2 + 0.1, 0.45, W - 0.2);
  ctx.strokeStyle = '#222'; // overhead guard
  ctx.lineWidth = 0.07;
  ctx.strokeRect(-L / 2 + 0.55, -W / 2 + 0.15, 0.9, W - 0.3);
  ctx.fillStyle = '#2a2a2a'; // mast
  ctx.fillRect(-L / 2 + L * 0.68 - 0.12, -W / 2 + 0.1, 0.16, W - 0.2);
  ctx.fillStyle = '#8f959c'; // forks
  for (const s of [-1, 1]) ctx.fillRect(-L / 2 + L * 0.68, s * 0.3 - 0.06, L * 0.32, 0.12);
  beacon(ctx, -L / 2 + 1.0, 0, t, v.waiting);
}

function drawShunter(ctx: CanvasRenderingContext2D, v: TrafficVehicle, t: number): void {
  const L = v.length;
  const W = v.width;
  ctx.fillStyle = '#141414';
  for (const x of [-L / 2 + 0.9, L / 2 - 1.1]) for (const s of [-1, 1]) ctx.fillRect(x - 0.5, s * (W / 2 - 0.2) - 0.18, 1.0, 0.36);
  ctx.fillStyle = '#2a2d31'; // chassis and fifth wheel deck
  ctx.fillRect(-L / 2, -0.6, L - 0.2, 1.2);
  ctx.fillStyle = '#44484e';
  ctx.beginPath();
  ctx.arc(-L / 2 + 1.2, 0, 0.6, 0, Math.PI * 2);
  ctx.fill();
  // Offset single-seat cab at the front, yellow with a white roof.
  ctx.fillStyle = '#f2b705';
  ctx.beginPath();
  ctx.roundRect(L / 2 - 2.0, -W / 2, 2.0, W * 0.62, 0.2);
  ctx.fill();
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(L / 2 - 1.8, -W / 2 + 0.15, 1.5, W * 0.62 - 0.3);
  ctx.fillStyle = '#1e2b38';
  ctx.fillRect(L / 2 - 0.25, -W / 2 + 0.15, 0.12, W * 0.62 - 0.3);
  beacon(ctx, L / 2 - 1.05, -W / 2 + W * 0.31, t, v.waiting);
}

export function drawTraffic(ctx: CanvasRenderingContext2D, traffic: TrafficVehicle[], t: number): void {
  for (const v of traffic) {
    ctx.save();
    ctx.translate(v.x + 0.25, v.y + 0.35);
    ctx.rotate(v.heading);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(-v.length / 2, -v.width / 2, v.length, v.width);
    ctx.restore();
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(v.heading);
    if (v.def.kind === 'forklift') drawForklift(ctx, v, t);
    else drawShunter(ctx, v, t);
    ctx.restore();
  }
}

/** Lights for the night light map: hi-vis glow and amber beacons. */
export function peopleLights(banksman: Banksman | null, traffic: TrafficVehicle[]): { x: number; y: number; r: number; s: number }[] {
  const out: { x: number; y: number; r: number; s: number }[] = [];
  if (banksman) out.push({ x: banksman.x, y: banksman.y, r: 2.2, s: 0.8 });
  for (const v of traffic) out.push({ x: v.x, y: v.y, r: Math.max(v.length, 3), s: 0.6 });
  return out;
}
