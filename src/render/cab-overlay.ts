/**
 * First-person overlays drawn on the 2D canvas above the 3D view: where the
 * mirror insets go, their housings, and the steering wheel in front of the
 * driver.
 */
import { STEERING } from '../config/vehicle.ts';
import { theme } from '../config/theme.ts';
import { DEG } from '../core/math.ts';
import type { Artic } from '../physics/artic.ts';
import type { MirrorRect } from '../render3d/first-person.ts';

/** Nearside (left) and offside (right) mirror insets between `top` and `bottom` (CSS px). */
export function mirrorRects(viewW: number, top: number, bottom: number): MirrorRect[] {
  const w = Math.round(Math.min(250, Math.max(110, viewW * 0.19)));
  const h = Math.round(Math.min(w * 1.75, bottom - top));
  if (h < 80) return [];
  return [
    { side: -1, x: 12, y: top, w, h },
    { side: 1, x: viewW - w - 12, y: top, w, h },
  ];
}

/** Black mirror housings round each inset, with N/S and O/S labels. */
export function drawMirrorFrames(ctx: CanvasRenderingContext2D, rects: MirrorRect[]): void {
  for (const r of rects) {
    ctx.save();
    ctx.fillStyle = '#0d0f12';
    ctx.beginPath();
    ctx.roundRect(r.x - 6, r.y - 6, r.w + 12, r.h + 12, 16);
    ctx.roundRect(r.x, r.y, r.w, r.h, 10);
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(r.x - 6, r.y - 6, r.w + 12, r.h + 12, 16);
    ctx.stroke();
    ctx.font = `800 11px ${theme.uiFont}`;
    ctx.fillStyle = 'rgba(12,14,18,0.75)';
    ctx.fillRect(r.x + 6, r.y + 6, 30, 16);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(r.side < 0 ? 'N/S' : 'O/S', r.x + 21, r.y + 14.5);
    ctx.restore();
  }
}

/** The steering wheel, low in the middle of the view, turning with the road wheels. */
export function drawCabWheel(ctx: CanvasRenderingContext2D, artic: Artic, viewW: number, viewH: number): void {
  const R = Math.min(viewW * 0.22, viewH * 0.36);
  const cx = viewW / 2;
  const cy = viewH + R * 0.28;
  const turn = (artic.steer / (STEERING.maxAngle * DEG)) * STEERING.wheelTurnsToLock * Math.PI * 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(turn);
  // Spokes and hub.
  ctx.strokeStyle = '#26292d';
  ctx.lineWidth = R * 0.1;
  ctx.lineCap = 'round';
  for (const a of [Math.PI, 0, Math.PI / 2]) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * R * 0.92, Math.sin(a) * R * 0.92);
    ctx.stroke();
  }
  ctx.fillStyle = '#1d1f22';
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = theme.brandPrimary;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.07, 0, Math.PI * 2);
  ctx.fill();
  // Rim with a soft highlight, and the top-centre marker.
  ctx.lineWidth = R * 0.14;
  ctx.strokeStyle = '#17191c';
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = R * 0.03;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.arc(0, 0, R - R * 0.04, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
  ctx.lineWidth = R * 0.14;
  ctx.strokeStyle = theme.brandPrimary;
  ctx.beginPath();
  ctx.arc(0, 0, R, -Math.PI / 2 - 0.06, -Math.PI / 2 + 0.06);
  ctx.stroke();
  ctx.restore();
}
