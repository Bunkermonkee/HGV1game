/**
 * Night and rain. A half-resolution "light map" is filled with darkness (or
 * fog) and then has the lights cut out of it, and is laid over the frame.
 * Works for any view (main camera or a mirror) via a `setWorld` callback.
 */
import { TRACTOR, TRAILER } from '../config/vehicle.ts';
import { DEG } from '../core/math.ts';
import type { Conditions, YardLayout } from '../game/yard.ts';
import type { Artic } from '../physics/artic.ts';

/** Sets `ctx`'s transform to the view's world transform, scaled by `k`. */
export type SetWorld = (ctx: CanvasRenderingContext2D, k: number) => void;

const LIGHTMAP_SCALE = 0.5;
const CAB_FRONT = TRACTOR.wheelbase + TRACTOR.frontOverhang;
const T_REAR = -(TRAILER.length - TRAILER.kingpinSetback);

export function needsLightmap(c: Conditions): boolean {
  return !!c.night || !!c.visibility;
}

/** Soft circular light. */
function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, strength: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(0,0,0,${strength})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Light cone from (x, y) along `angle`, half-width `spread` (radians). */
function beam(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, spread: number, reach: number, strength: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, reach);
  g.addColorStop(0, `rgba(0,0,0,${strength})`);
  g.addColorStop(0.6, `rgba(0,0,0,${strength * 0.7})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, reach, angle - spread, angle + spread);
  ctx.closePath();
  ctx.fill();
}

/** Point in a body frame → world. */
function local(ox: number, oy: number, heading: number, lx: number, ly: number): [number, number] {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return [ox + c * lx - s * ly, oy + s * lx + c * ly];
}

function cutNightLights(ctx: CanvasRenderingContext2D, yard: YardLayout, artic: Artic): void {
  const th = artic.heading;
  // Headlights.
  for (const side of [-1, 1]) {
    const [hx, hy] = local(artic.x, artic.y, th, CAB_FRONT, side * 0.9);
    beam(ctx, hx, hy, th + side * 4 * DEG, 24 * DEG, 30, 1);
  }
  // Cab marker / interior spill so the tractor itself stays readable.
  const [cx, cy] = local(artic.x, artic.y, th, CAB_FRONT - 1.2, 0);
  glow(ctx, cx, cy, 3.4, 0.55);

  // Trailer: reversing lights, tail lights and amber side markers.
  const h = artic.hitch;
  const ph = artic.trailerHeading;
  const [rx, ry] = local(h.x, h.y, ph, T_REAR, 0);
  if (artic.gear === 'R' && !artic.jackknifed) beam(ctx, rx, ry, ph + Math.PI, 60 * DEG, 13, 0.95);
  glow(ctx, rx, ry, 2.4, artic.braking || artic.handbrake ? 0.6 : 0.35);
  for (let d = T_REAR + 1.5; d < TRAILER.kingpinSetback - 1; d += 3) {
    for (const side of [-1, 1]) {
      const [mx, my] = local(h.x, h.y, ph, d, side * (TRAILER.width / 2 + 0.1));
      glow(ctx, mx, my, 0.9, 0.35);
    }
  }

  // Dim lamps over each dock door; the target bay's is brighter.
  for (const bay of yard.bays) {
    if (!bay.buffers) continue;
    glow(ctx, bay.x, bay.y, bay.target ? 6 : 4, bay.target ? 0.75 : 0.45);
  }
}

export class Atmosphere {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private drops: { x: number; y: number; len: number; speed: number }[] = [];

  /**
   * Lay darkness / fog over a view that is `w`×`h` device pixels.
   * `setWorld(ctx, k)` must apply the view's world transform scaled by k.
   */
  drawLightmap(
    target: CanvasRenderingContext2D,
    w: number,
    h: number,
    setWorld: SetWorld,
    yard: YardLayout,
    artic: Artic,
    extra: { x: number; y: number; r: number; s: number }[] = [],
  ): void {
    const c = yard.conditions;
    if (!needsLightmap(c)) return;
    const lw = Math.max(1, Math.round(w * LIGHTMAP_SCALE));
    const lh = Math.max(1, Math.round(h * LIGHTMAP_SCALE));
    if (this.canvas.width !== lw || this.canvas.height !== lh) {
      this.canvas.width = lw;
      this.canvas.height = lh;
    }
    const l = this.ctx;
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = 'source-over';
    l.clearRect(0, 0, lw, lh);
    l.fillStyle = c.night ? 'rgba(3,6,16,0.93)' : 'rgba(150,158,168,0.9)';
    l.fillRect(0, 0, lw, lh);

    l.globalCompositeOperation = 'destination-out';
    setWorld(l, LIGHTMAP_SCALE);
    if (c.night) {
      cutNightLights(l, yard, artic);
      for (const e of extra) glow(l, e.x, e.y, e.r, e.s);
    } else if (c.visibility) {
      // Fog: clear around the rig, thickening with distance.
      const r = artic.trailerRear;
      const f = artic.frontAxle;
      const mx = (r.x + f.x) / 2;
      const my = (r.y + f.y) / 2;
      const g = l.createRadialGradient(mx, my, c.visibility * 0.45, mx, my, c.visibility);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      l.fillStyle = g;
      l.fillRect(mx - c.visibility, my - c.visibility, c.visibility * 2, c.visibility * 2);
    }

    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.drawImage(this.canvas, 0, 0, w, h);
    target.restore();
  }

  /** Wet-tarmac tint, drawn in world space after the yard, before vehicles. */
  static wetTarmac(ctx: CanvasRenderingContext2D, yard: YardLayout): void {
    if (!yard.conditions.rain) return;
    ctx.fillStyle = 'rgba(10,22,38,0.22)';
    ctx.fillRect(0, 0, yard.width, yard.height);
  }

  /** Screen-space rain streaks (CSS pixels). */
  drawRain(ctx: CanvasRenderingContext2D, viewW: number, viewH: number, dt: number): void {
    const want = Math.round(Math.min(220, (viewW * viewH) / 6000));
    while (this.drops.length < want) {
      this.drops.push({
        x: Math.random() * viewW,
        y: Math.random() * viewH,
        len: 10 + Math.random() * 14,
        speed: 700 + Math.random() * 400,
      });
    }
    this.drops.length = want;
    ctx.save();
    ctx.strokeStyle = 'rgba(210,222,240,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of this.drops) {
      d.y += d.speed * dt;
      d.x -= d.speed * 0.18 * dt;
      if (d.y > viewH + 20) {
        d.y = -20;
        d.x = Math.random() * (viewW + 60);
      }
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.len * 0.18, d.y + d.len);
    }
    ctx.stroke();
    ctx.restore();
  }
}
