/** Debug overlay: collision boxes, pivot points, wheel tracks and live numbers. */
import { ARTICULATION, TRACTOR } from '../config/vehicle.ts';
import { DEG, MPH_TO_MS, type Vec2 } from '../core/math.ts';
import { obbCorners, type OBB } from '../physics/geometry.ts';
import type { Artic } from '../physics/artic.ts';

const TRAIL_LEN = 900;

export class DebugOverlay {
  enabled = false;
  private frontTrail: Vec2[] = [];
  private trailerTrail: Vec2[] = [];
  private fps = 60;

  clearTrails(): void {
    this.frontTrail.length = 0;
    this.trailerTrail.length = 0;
  }

  /** Record wheel tracks (only while moving, spaced ~10 cm apart). */
  record(artic: Artic): void {
    push(this.frontTrail, artic.frontAxle);
    push(this.trailerTrail, artic.trailerAxle);
  }

  tickFps(dt: number): void {
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
  }

  drawWorld(ctx: CanvasRenderingContext2D, artic: Artic, obstacles: OBB[] = []): void {
    if (!this.enabled) return;
    ctx.save();
    ctx.lineWidth = 0.06;

    trail(ctx, this.frontTrail, 'rgba(0,229,255,0.7)');
    trail(ctx, this.trailerTrail, 'rgba(255,214,0,0.8)');

    box(ctx, artic.tractorBox, '#00e5ff');
    box(ctx, artic.trailerBox, '#ff4fd8');
    for (const o of obstacles) box(ctx, o, '#ff9100');

    // Centre lines of each body.
    const h = artic.hitch;
    const ta = artic.trailerAxle;
    const fa = artic.frontAxle;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.moveTo(fa.x, fa.y);
    ctx.lineTo(artic.x, artic.y);
    ctx.lineTo(h.x, h.y);
    ctx.lineTo(ta.x, ta.y);
    ctx.stroke();

    // Turning centre of the tractor (on the rear-axle line).
    if (Number.isFinite(artic.turningRadius) && artic.turningRadius < 40) {
      const side = Math.sign(artic.steer);
      const nx = -Math.sin(artic.heading) * side;
      const ny = Math.cos(artic.heading) * side;
      const cx = artic.x + nx * artic.turningRadius;
      const cy = artic.y + ny * artic.turningRadius;
      ctx.setLineDash([0.4, 0.4]);
      ctx.strokeStyle = 'rgba(0,229,255,0.35)';
      ctx.beginPath();
      ctx.moveTo(artic.x, artic.y);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.setLineDash([]);
      dot(ctx, { x: cx, y: cy }, 0.2, '#00e5ff');
    }

    dot(ctx, fa, 0.18, '#00e5ff');
    dot(ctx, artic, 0.18, '#00e5ff');
    dot(ctx, h, 0.22, '#ffffff');
    dot(ctx, ta, 0.22, '#ffd600');
    ctx.restore();
  }

  drawScreen(ctx: CanvasRenderingContext2D, artic: Artic): void {
    if (!this.enabled) return;
    const art = artic.articulation / DEG;
    const lines = [
      `DEBUG  (\` or F3 to hide)`,
      `fps          ${this.fps.toFixed(0)}`,
      `articulation ${fmt(art, 1)}°  (limit ±${ARTICULATION.jackknifeAngle}°)`,
      `speed        ${fmt(artic.speed / MPH_TO_MS, 2)} mph  ${fmt(artic.speed, 2)} m/s`,
      `steer (road) ${fmt(artic.steer / DEG, 1)}°`,
      `steer radius ${Number.isFinite(artic.turningRadius) ? artic.turningRadius.toFixed(1) + ' m' : '∞'}`,
      `gear         ${artic.gear}   handbrake ${artic.handbrake ? 'ON' : 'off'}`,
      `tractor hdg  ${fmt(artic.heading / DEG, 1)}°`,
      `trailer hdg  ${fmt(artic.trailerHeading / DEG, 1)}°`,
      `rear axle    ${artic.x.toFixed(2)}, ${artic.y.toFixed(2)}`,
      `wheelbase ${TRACTOR.wheelbase} m  5th wheel +${TRACTOR.fifthWheelAhead} m`,
    ];
    ctx.save();
    ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
    const w = 300;
    const lh = 16;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(8, 8, w, lines.length * lh + 12);
    ctx.fillStyle = '#9ef';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, 16, 14 + i * lh));
    ctx.restore();
  }
}

function fmt(v: number, dp: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(dp);
}

function push(arr: Vec2[], p: Vec2): void {
  const last = arr[arr.length - 1];
  if (last && Math.hypot(last.x - p.x, last.y - p.y) < 0.1) return;
  arr.push({ x: p.x, y: p.y });
  if (arr.length > TRAIL_LEN) arr.shift();
}

function trail(ctx: CanvasRenderingContext2D, pts: Vec2[], colour: string): void {
  if (pts.length < 2) return;
  ctx.strokeStyle = colour;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function box(ctx: CanvasRenderingContext2D, b: OBB, colour: string): void {
  const c = obbCorners(b);
  ctx.strokeStyle = colour;
  ctx.beginPath();
  ctx.moveTo(c[0].x, c[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
  ctx.closePath();
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, p: Vec2, r: number, colour: string): void {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
}
