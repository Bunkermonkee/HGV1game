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

function hudScale(viewW: number, viewH: number): number {
  return Math.min(1.25, Math.max(0.75, Math.min(viewW, viewH) / 480));
}

/**
 * Gauges. Desktop: bottom-left, with a steering-wheel indicator. Compact
 * (touch): top-left, without it – the on-screen wheel shows the steering.
 * Returns the panel's bottom edge (CSS px).
 */
export function drawHud(ctx: CanvasRenderingContext2D, artic: Artic, viewW: number, viewH: number, compact = false): number {
  const s = hudScale(viewW, viewH) * (compact ? 0.8 : 1);
  const top = compact ? 10 : viewH - 12 - 110 * s;
  ctx.save();
  ctx.translate(12, top);
  ctx.scale(s, s);

  panel(ctx, 0, 0, compact ? 240 : 330, 110);

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

  if (!compact) {
    drawSteeringWheel(ctx, 186, 50, 30, artic.steer / (STEERING.maxAngle * DEG));
    ctx.font = `600 11px ${theme.uiFont}`;
    ctx.fillStyle = '#b7bec9';
    ctx.fillText('STEER', 186, 92);
  }

  const gx = compact ? 186 : 276;
  drawArticulationGauge(ctx, gx, 50, artic.articulation);
  ctx.font = `600 11px ${theme.uiFont}`;
  ctx.fillStyle = '#b7bec9';
  ctx.fillText('TRAILER', gx, 92);

  ctx.restore();
  return top + 110 * s;
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

// ---- Run stats, bay guide and messages ---------------------------------------

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

export interface RunStats {
  time: number;
  penalty: number;
  shunts: number;
  contacts: number;
}

/** Time / shunts / contacts across the top centre. */
export function drawRunStats(ctx: CanvasRenderingContext2D, stats: RunStats, viewW: number): number {
  const s = Math.min(1.15, Math.max(0.8, viewW / 900));
  const w = 300;
  const h = 56;
  ctx.save();
  ctx.translate(viewW / 2 - (w * s) / 2, 10);
  ctx.scale(s, s);
  panel(ctx, 0, 0, w, h);
  const cell = (x: number, label: string, value: string, colour: string) => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 22px ${theme.uiFont}`;
    ctx.fillStyle = colour;
    ctx.fillText(value, x, 22);
    ctx.font = `600 10px ${theme.uiFont}`;
    ctx.fillStyle = '#b7bec9';
    ctx.fillText(label, x, 44);
  };
  const penalty = stats.penalty > 0 ? ` +${stats.penalty}s` : '';
  cell(62, 'TIME', formatTime(stats.time) + penalty, theme.uiText);
  cell(172, 'SHUNTS', String(stats.shunts), theme.uiText);
  cell(250, 'CONTACTS', String(stats.contacts), stats.contacts ? theme.uiWarn : theme.uiText);
  ctx.restore();
  return 10 + h * s;
}

export interface BayGuide {
  angleErr: number;
  lateral: number;
  rearGap: number;
  angleOk: boolean;
  lateralOk: boolean;
  gapOk: boolean;
  ok: boolean;
}

/** Live alignment read-out once the trailer is at the bay. */
export function drawBayGuide(ctx: CanvasRenderingContext2D, g: BayGuide, viewW: number, top: number, bayLabel: string): void {
  const s = Math.min(1.15, Math.max(0.8, viewW / 900));
  const w = 300;
  const h = 50;
  ctx.save();
  ctx.translate(viewW / 2 - (w * s) / 2, top + 6);
  ctx.scale(s, s);
  panel(ctx, 0, 0, w, h);
  const pill = (x: number, label: string, value: string, ok: boolean) => {
    ctx.fillStyle = ok ? 'rgba(46,204,113,0.22)' : 'rgba(255,176,0,0.18)';
    ctx.beginPath();
    ctx.roundRect(x, 6, 92, 38, 8);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 15px ${theme.uiFont}`;
    ctx.fillStyle = ok ? theme.uiGood : theme.uiWarn;
    ctx.fillText(value, x + 46, 19);
    ctx.font = `600 9px ${theme.uiFont}`;
    ctx.fillStyle = '#d0d5dc';
    ctx.fillText(label, x + 46, 35);
  };
  pill(6, 'ANGLE', `${Math.abs(g.angleErr).toFixed(1)}°`, g.angleOk);
  pill(104, 'OFF CENTRE', `${Math.abs(g.lateral).toFixed(2)} m`, g.lateralOk);
  pill(202, 'TO BUFFERS', `${Math.max(0, g.rearGap).toFixed(1)} m`, g.gapOk);
  ctx.restore();
  if (g.ok) {
    banner(ctx, viewW / 2, top + 6 + h * s + 24, `On Bay ${bayLabel} – stop and apply the handbrake`, theme.uiGood, 15);
  }
}

interface Toast {
  text: string;
  colour: string;
  ttl: number;
}

/** Short-lived messages ("Contact! +5s", "On the buffers", …). */
export class Toasts {
  private items: Toast[] = [];

  show(text: string, colour: string, seconds = 2.2): void {
    this.items = this.items.filter((t) => t.text !== text);
    this.items.push({ text, colour, ttl: seconds });
    if (this.items.length > 3) this.items.shift();
  }

  clear(): void {
    this.items.length = 0;
  }

  draw(ctx: CanvasRenderingContext2D, dt: number, viewW: number, viewH: number): void {
    this.items = this.items.filter((t) => (t.ttl -= dt) > 0);
    this.items.forEach((t, i) => {
      ctx.save();
      ctx.globalAlpha = Math.min(1, t.ttl / 0.3);
      banner(ctx, viewW / 2, viewH * 0.62 - i * 40, t.text, t.colour, 16);
      ctx.restore();
    });
  }
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export interface TipArea {
  /** Left edge and available width (CSS px). */
  x: number;
  width: number;
  /** The tip's bottom edge sits here. */
  bottom: number;
}

/**
 * Tutorial tip panel. Default: just above the desktop gauges (bottom-left).
 * Returns its top edge (CSS px).
 */
export function drawTip(ctx: CanvasRenderingContext2D, text: string, viewW: number, viewH: number, area?: TipArea): number {
  const s = hudScale(viewW, viewH);
  const w = area ? Math.min(360, area.width / s) : 330;
  ctx.save();
  ctx.font = `600 14px ${theme.uiFont}`;
  const lines = wrapLines(ctx, text, w - 34);
  const h = lines.length * 19 + 20;
  const top = (area ? area.bottom : viewH - 12 - 110 * s - 10) - h * s;
  const left = area ? area.x + (area.width - w * s) / 2 : 12;
  ctx.translate(left, top);
  ctx.scale(s, s);
  ctx.fillStyle = 'rgba(12,14,18,0.88)';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 12);
  ctx.fill();
  ctx.fillStyle = theme.brandSecondary;
  ctx.fillRect(0, 10, 5, h - 20);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, 18, 11 + i * 19));
  ctx.restore();
  return top;
}

/** Height (CSS px) of the bottom-left gauge panel, for laying out around it. */
export function hudHeight(viewW: number, viewH: number): number {
  return 12 + 110 * hudScale(viewW, viewH);
}
