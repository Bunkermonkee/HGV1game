/** Cones, bollards, kerbed islands and parked trailers. */
import { TRAILER } from '../config/vehicle.ts';
import { theme } from '../config/theme.ts';
import { obbCorners } from '../physics/geometry.ts';
import type { Obstacle } from '../game/obstacles.ts';
import { drawTrailerAt } from './draw-vehicle.ts';

function fillBox(ctx: CanvasRenderingContext2D, o: Obstacle): void {
  const c = obbCorners(o.box);
  ctx.beginPath();
  ctx.moveTo(c[0].x, c[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
  ctx.closePath();
  ctx.fill();
}

function drawCone(ctx: CanvasRenderingContext2D, o: Obstacle): void {
  const { cx, cy } = o.box;
  ctx.save();
  ctx.translate(cx, cy);
  if (o.hit) {
    // Knocked over: lying on its side, skewed off its base.
    ctx.rotate(0.6);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-0.34, -0.1, 0.75, 0.3);
    ctx.fillStyle = '#ff6a00';
    ctx.beginPath();
    ctx.moveTo(-0.35, -0.2);
    ctx.lineTo(0.38, -0.05);
    ctx.lineTo(0.38, 0.05);
    ctx.lineTo(-0.35, 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(-0.05, -0.13, 0.12, 0.26);
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-0.18, -0.12, 0.45, 0.45);
    ctx.fillStyle = '#e25500';
    ctx.fillRect(-0.22, -0.22, 0.44, 0.44);
    ctx.fillStyle = '#ff7a1a';
    ctx.beginPath();
    ctx.arc(0, 0, 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.arc(0, 0, 0.11, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBollard(ctx: CanvasRenderingContext2D, o: Obstacle): void {
  const { cx, cy } = o.box;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.arc(cx + 0.08, cy + 0.12, 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = theme.yardLineYellow;
  ctx.beginPath();
  ctx.arc(cx, cy, 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(cx, cy, 0.08, 0, Math.PI * 2);
  ctx.fill();
}

function drawParkedTrailer(ctx: CanvasRenderingContext2D, o: Obstacle): void {
  const b = o.box;
  // Box centre → kingpin: forwards along the heading by half-length minus setback.
  const d = b.halfLength - TRAILER.kingpinSetback;
  const kx = b.cx + Math.cos(b.angle) * d;
  const ky = b.cy + Math.sin(b.angle) * d;
  ctx.save();
  ctx.translate(0.35, 0.5);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  fillBox(ctx, o);
  ctx.restore();
  drawTrailerAt(ctx, kx, ky, b.angle, { curtain: o.colour });
}

export function drawObstacles(ctx: CanvasRenderingContext2D, obstacles: Obstacle[]): void {
  for (const o of obstacles) {
    switch (o.kind) {
      case 'kerb':
        // Boundary kerbs are painted by the yard; islands get grass + kerb edge.
        if (o.box.halfWidth > 0.3) {
          ctx.fillStyle = theme.yardKerb;
          fillBox(ctx, o);
          ctx.fillStyle = theme.yardGrass;
          fillBox(ctx, { ...o, box: { ...o.box, halfLength: o.box.halfLength - 0.25, halfWidth: o.box.halfWidth - 0.25 } });
        }
        break;
      case 'wall':
        if (o.building) break; // buildings are drawn with the yard
        ctx.fillStyle = '#7d828a';
        fillBox(ctx, o);
        ctx.fillStyle = '#9aa0a8';
        fillBox(ctx, { ...o, box: { ...o.box, halfLength: o.box.halfLength - 0.1, halfWidth: o.box.halfWidth - 0.1 } });
        break;
      case 'cone':
        drawCone(ctx, o);
        break;
      case 'bollard':
        drawBollard(ctx, o);
        break;
      case 'trailer':
        drawParkedTrailer(ctx, o);
        break;
      case 'buffer':
        break; // drawn with the bay markings
    }
  }
}
