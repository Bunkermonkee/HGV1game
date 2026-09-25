/**
 * 1080×1080 share image: logo slot, level, a render of the actual parking
 * job, stars, stats and the "Can you beat me?" call to action.
 */
import { BRAND, brandLogo } from '../config/brand.ts';
import { theme } from '../config/theme.ts';
import { DEG } from '../core/math.ts';
import type { RunResult, Session } from '../game/session.ts';
import { drawObstacles } from '../render/draw-obstacles.ts';
import { drawBanksman, drawTraffic } from '../render/draw-people.ts';
import { drawArtic } from '../render/draw-vehicle.ts';
import { drawYard } from '../render/draw-yard.ts';
import { formatTime } from '../render/hud.ts';

const SIZE = 1080;

export function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function hazardBand(ctx: CanvasRenderingContext2D, y: number, h: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, y, SIZE, h);
  ctx.clip();
  ctx.fillStyle = theme.brandSecondary;
  ctx.fillRect(0, y, SIZE, h);
  ctx.fillStyle = '#111418';
  for (let x = -h; x < SIZE + h; x += h * 1.6) {
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x + h * 0.8, y + h);
    ctx.lineTo(x + h * 1.6, y);
    ctx.lineTo(x + h * 0.8, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function logoSlot(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const img = brandLogo('onDark');
  if (img) {
    const k = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const iw = img.naturalWidth * k;
    const ih = img.naturalHeight * k;
    ctx.drawImage(img, x, y + (h - ih) / 2, iw, ih);
    return;
  }
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.setLineDash([12, 10]);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 16);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `900 34px ${theme.uiFontDisplay}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('LOGO', x + w / 2, y + h / 2);
  ctx.restore();
}

/** Top-down render of the finished job, framed on the target bay. */
function scene(ctx: CanvasRenderingContext2D, session: Session, x: number, y: number, w: number, h: number): void {
  const bay = session.bay;
  const a = bay.heading * DEG;
  // Frame the whole rig: dock on the left, tractor on the right.
  const cx = bay.x + Math.cos(a) * 10.5;
  const cy = bay.y + Math.sin(a) * 10.5;
  const metresAcross = 25;
  const k = w / metresAcross;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 24);
  ctx.clip();
  ctx.translate(x + w / 2, y + h / 2);
  // Rotate so the bay runs left-to-right out of the dock, whatever its heading.
  ctx.rotate(-a);
  ctx.scale(k, k);
  ctx.translate(-cx, -cy);
  drawYard(ctx, session.yard);
  drawObstacles(ctx, session.obstacles);
  drawTraffic(ctx, session.traffic, 0);
  if (session.banksman) drawBanksman(ctx, session.banksman, session.artic, 0);
  drawArtic(ctx, session.artic);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 24);
  ctx.stroke();
}

function statBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, label: string, value: string): void {
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, 118, 18);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 54px ${theme.uiFont}`;
  ctx.fillText(value, x + w / 2, y + 50);
  ctx.fillStyle = '#b7bec9';
  ctx.font = `700 22px ${theme.uiFont}`;
  ctx.fillText(label, x + w / 2, y + 96);
}

export function renderShareCard(result: RunResult, session: Session, rankText?: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = '#111418';
  ctx.fillRect(0, 0, SIZE, SIZE);
  hazardBand(ctx, 0, 26);

  // Header: logo slot left, game name right.
  logoSlot(ctx, 60, 58, 250, 110);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 76px ${theme.uiFontDisplay}`;
  ctx.fillText(BRAND.gameName.toUpperCase(), SIZE - 60, 128);
  ctx.fillStyle = theme.brandSecondary;
  ctx.font = `700 26px ${theme.uiFont}`;
  ctx.fillText(`${result.levelName} · Bay ${result.bay}${rankText ? ` · ${rankText}` : ''}`, SIZE - 60, 166);

  scene(ctx, session, 60, 200, SIZE - 120, 400);

  // Stars.
  for (let i = 0; i < 3; i++) {
    starPath(ctx, SIZE / 2 + (i - 1) * 120, 680, 50);
    ctx.fillStyle = i < result.stars ? theme.brandSecondary : 'rgba(255,255,255,0.14)';
    ctx.fill();
  }

  const bw = (SIZE - 120 - 40) / 3;
  statBox(ctx, 60, 760, bw, 'TIME', formatTime(result.total));
  statBox(ctx, 60 + bw + 20, 760, bw, 'SHUNTS', String(result.shunts));
  statBox(ctx, 60 + 2 * (bw + 20), 760, bw, 'CONTACTS', String(result.contacts));

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 56px ${theme.uiFontDisplay}`;
  ctx.fillText('Can you beat me?', SIZE / 2, 972);
  ctx.fillStyle = theme.brandPrimary;
  ctx.font = `800 38px ${theme.uiFont}`;
  ctx.fillText(BRAND.shareUrlText, SIZE / 2, 1026);
  hazardBand(ctx, SIZE - 18, 18);
  return c;
}

export function canvasToBlob(c: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
}
