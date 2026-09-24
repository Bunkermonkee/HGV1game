/**
 * In-game HUD drawn in screen space (CSS pixels): gear, speed, handbrake,
 * steering wheel and articulation gauge.
 */
import { ARTICULATION, STEERING } from '../config/vehicle.ts';
import { theme } from '../config/theme.ts';
import { DEG, MPH_TO_MS } from '../core/math.ts';
import type { Artic } from '../physics/artic.ts';

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = 'rgba(12,14,18,0.78)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 12);
  ctx.fill();
}

export function drawHud(ctx: CanvasRenderingContext2D, artic: Artic, viewW: number, viewH: number): void {
  const s = Math.min(1.25, Math.max(0.75, Math.min(viewW, viewH) / 480));
  ctx.save();
  ctx.translate(12, viewH - 12 - 110 * s);
  ctx.scale(s, s);

  panel(ctx, 0, 0, 330, 110);

  // Gear.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 54px ${theme.uiFontDisplay}`;
  ctx.fillStyle = artic.gear === 'R' ? theme.uiWarn : artic.gear === 'D' ? theme.uiGood : '#8a93a0';
  ctx.fillText(artic.gear, 42, 50);
  ctx.font = `600 11px ${theme.uiFont}`;
  ctx.fillStyle = '#b7bec9';
  ctx.fillText('GEAR', 42, 92);

  // Speed.
  const mph = Math.abs(artic.speed) / MPH_TO_MS;
  ctx.font = `800 34px ${theme.uiFont}`;
  ctx.fillStyle = theme.uiText;
  ctx.fillText(mph.toFixed(1), 112, 48);
  ctx.font = `600 11px ${theme.uiFont}`;
  ctx.fillStyle = '#b7bec9';
  ctx.fillText('MPH', 112, 92);

  // Handbrake lamp.
  ctx.beginPath();
  ctx.arc(112, 76, 9, 0, Math.PI * 2);
  ctx.fillStyle = artic.handbrake ? theme.uiBad : '#2a2f36';
  ctx.fill();
  ctx.font = `900 11px ${theme.uiFont}`;
  ctx.fillStyle = artic.handbrake ? '#fff' : '#5c6470';
  ctx.fillText('P', 112, 77);

  drawSteeringWheel(ctx, 186, 50, 30, artic.steer / (STEERING.maxAngle * DEG));
  ctx.font = `600 11px ${theme.uiFont}`;
  ctx.fillStyle = '#b7bec9';
  ctx.fillText('STEER', 186, 92);

  drawArticulationGauge(ctx, 276, 50, artic.articulation);
  ctx.font = `600 11px ${theme.uiFont}`;
  ctx.fillStyle = '#b7bec9';
  ctx.fillText('TRAILER', 276, 92);

  ctx.restore();

  if (artic.handbrakeNag) {
    banner(ctx, viewW / 2, viewH * 0.22, 'Handbrake on – press Space to release', theme.uiWarn, 18);
  }
}

function drawSteeringWheel(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, frac: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(frac * STEERING.wheelTurnsToLock * Math.PI * 2);
  ctx.strokeStyle = '#e6e9ee';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.lineTo(r, 0);
  ctx.moveTo(0, 0);
  ctx.lineTo(0, r);
  ctx.stroke();
  // Top-dead-centre marker so the number of turns is readable.
  ctx.fillStyle = theme.brandSecondary;
  ctx.fillRect(-3, -r - 4, 6, 8);
  ctx.restore();
}

/**
 * Mini top-down diagram: the tractor always points up, the trailer hangs
 * behind it at the real articulation angle, over a coloured danger arc.
 */
function drawArticulationGauge(ctx: CanvasRenderingContext2D, x: number, y: number, articulation: number): void {
  const R = 34;
  ctx.save();
  ctx.translate(x, y - 14);
  // Arc zones below the pivot (trailer side). Angle 0 = straight down.
  const zone = (from: number, to: number, colour: string) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, R, Math.PI / 2 + from * DEG, Math.PI / 2 + to * DEG);
    ctx.stroke();
  };
  const w = ARTICULATION.warnAngle;
  const d = ARTICULATION.dangerAngle;
  const j = ARTICULATION.jackknifeAngle;
  zone(-w, w, 'rgba(46,204,113,0.8)');
  zone(w, d, 'rgba(255,176,0,0.9)');
  zone(-d, -w, 'rgba(255,176,0,0.9)');
  zone(d, j, 'rgba(255,59,48,0.95)');
  zone(-j, -d, 'rgba(255,59,48,0.95)');

  // Trailer: positive articulation = trailer on the tractor's RIGHT
  // (screen right, since the tractor points up here).
  ctx.save();
  ctx.rotate(-articulation);
  ctx.fillStyle = '#dfe4ea';
  ctx.fillRect(-5, 0, 10, R - 4);
  ctx.restore();

  // Tractor.
  ctx.fillStyle = theme.cabColour;
  ctx.fillRect(-5, -16, 10, 14);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = `700 11px ${theme.uiFont}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.fillText(`${Math.abs(articulation / DEG).toFixed(0)}°`, 0, -24);
  ctx.restore();
}

export function banner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  colour: string,
  size: number,
): void {
  ctx.save();
  ctx.font = `900 ${size}px ${theme.uiFontDisplay}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + size * 1.4;
  const h = size * 1.9;
  ctx.fillStyle = 'rgba(12,14,18,0.85)';
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 10);
  ctx.fill();
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y + 1);
  ctx.restore();
}
