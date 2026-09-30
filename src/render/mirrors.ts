/**
 * "Pro view": nearside and offside mirror insets. Each is a rotated, cropped,
 * horizontally flipped view of the world looking back down the side of the
 * rig from the mirror head on the cab, like a real class II mirror. Because
 * the mirrors are fixed to the cab, the trailer swings out of one mirror and
 * into the other as the rig articulates.
 */
import { TRACTOR } from '../config/vehicle.ts';
import { theme } from '../config/theme.ts';
import type { YardLayout } from '../game/yard.ts';
import type { Artic } from '../physics/artic.ts';
import { Atmosphere } from './atmosphere.ts';

/** Metres shown across and down each mirror. */
const LATERAL_SPAN = 9;
const BACK_SPAN = 26;

interface MirrorView {
  side: -1 | 1; // -1 nearside (left), +1 offside (right, the driver's side)
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  atmosphere: Atmosphere;
}

function makeView(side: -1 | 1): MirrorView {
  const canvas = document.createElement('canvas');
  return { side, canvas, ctx: canvas.getContext('2d', { alpha: false })!, atmosphere: new Atmosphere() };
}

export class Mirrors {
  enabled = false;
  private views = [makeView(-1), makeView(1)];

  /**
   * Draw both insets. `drawWorld` paints the scene in world units; `top` and
   * `bottom` (CSS px) are the space the HUD leaves free.
   */
  draw(
    main: CanvasRenderingContext2D,
    viewW: number,
    dpr: number,
    top: number,
    bottom: number,
    artic: Artic,
    yard: YardLayout,
    drawWorld: (ctx: CanvasRenderingContext2D) => void,
  ): void {
    if (!this.enabled) return;
    const w = Math.round(Math.min(220, Math.max(110, viewW * 0.18)));
    const h = Math.round(Math.min(w * 1.45, bottom - top));
    if (h < 80) return;

    for (const v of this.views) {
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      if (v.canvas.width !== pw || v.canvas.height !== ph) {
        v.canvas.width = pw;
        v.canvas.height = ph;
      }
      const setWorld = (c: CanvasRenderingContext2D, k: number) => this.applyTransform(c, v.side, artic, w, h, dpr * k);
      v.ctx.setTransform(1, 0, 0, 1, 0, 0);
      v.ctx.fillStyle = theme.yardGrass;
      v.ctx.fillRect(0, 0, pw, ph);
      setWorld(v.ctx, 1);
      drawWorld(v.ctx);
      v.atmosphere.drawLightmap(v.ctx, pw, ph, setWorld, yard, artic);

      const x = v.side < 0 ? 10 : viewW - w - 10;
      main.save();
      main.fillStyle = '#0d0f12';
      main.beginPath();
      main.roundRect(x - 5, top - 5, w + 10, h + 10, 14);
      main.fill();
      main.beginPath();
      main.roundRect(x, top, w, h, 9);
      main.clip();
      main.drawImage(v.canvas, x, top, w, h);
      main.restore();
      main.save();
      main.font = `800 11px ${theme.uiFont}`;
      main.fillStyle = 'rgba(12,14,18,0.75)';
      main.fillRect(x + 6, top + 6, 30, 16);
      main.fillStyle = '#fff';
      main.textAlign = 'center';
      main.textBaseline = 'middle';
      main.fillText(v.side < 0 ? 'N/S' : 'O/S', x + 21, top + 14.5);
      main.restore();
    }
  }

  /** World → mirror-inset pixels (reflected). `s` = device pixels per CSS pixel. */
  private applyTransform(
    ctx: CanvasRenderingContext2D,
    side: -1 | 1,
    artic: Artic,
    w: number,
    h: number,
    s: number,
  ): void {
    const th = artic.heading;
    const c = Math.cos(th);
    const sn = Math.sin(th);
    // Mirror head on the cab.
    const lx = TRACTOR.wheelbase + TRACTOR.frontOverhang - 0.45;
    const ly = side * (TRACTOR.width / 2 + TRACTOR.mirrorReach);
    const mx = artic.x + c * lx - sn * ly;
    const my = artic.y + sn * lx + c * ly;
    const kx = w / LATERAL_SPAN;
    const ky = h / BACK_SPAN;
    // The vehicle's side sits near the inner edge of each mirror.
    const u0 = side < 0 ? w * 0.8 : w * 0.2;
    const v0 = h * 0.97;
    // u = u0 + kx·(offset to the vehicle's right), v = v0 + ky·(offset forwards).
    // Behind the mirror goes up the inset; looking backwards, the vehicle's
    // right would be on the viewer's left, so this is the mirror-image flip.
    const a = -kx * sn;
    const cc = kx * c;
    const b = ky * c;
    const d = ky * sn;
    const e = u0 - (a * mx + cc * my);
    const f = v0 - (b * mx + d * my);
    ctx.setTransform(a * s, b * s, cc * s, d * s, e * s, f * s);
  }
}
