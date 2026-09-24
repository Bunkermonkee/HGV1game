import { PIXELS_PER_METRE } from '../config/vehicle.ts';
import { damp, type Vec2 } from '../core/math.ts';

/**
 * North-up top-down camera with smooth damping. `viewMetres` is how many
 * metres fit across the SHORTER screen dimension at zoom 1.
 */
export class Camera {
  x = 0;
  y = 0;
  /** CSS pixels per metre, including zoom. */
  scale = PIXELS_PER_METRE;
  viewMetres = 42;
  userZoom = 1;

  private targetX = 0;
  private targetY = 0;

  follow(target: Vec2, snap = false): void {
    this.targetX = target.x;
    this.targetY = target.y;
    if (snap) {
      this.x = target.x;
      this.y = target.y;
    }
  }

  update(dt: number, viewW: number, viewH: number): void {
    const k = damp(3, dt);
    this.x += (this.targetX - this.x) * k;
    this.y += (this.targetY - this.y) * k;
    const fit = Math.min(viewW, viewH) / (this.viewMetres * PIXELS_PER_METRE);
    this.scale = PIXELS_PER_METRE * fit * this.userZoom;
  }

  zoomBy(factor: number): void {
    this.userZoom = Math.min(3, Math.max(0.4, this.userZoom * factor));
  }

  /** Apply the world transform (metres → device pixels). */
  apply(ctx: CanvasRenderingContext2D, viewW: number, viewH: number, dpr: number): void {
    const s = this.scale * dpr;
    ctx.setTransform(s, 0, 0, s, (viewW / 2 - this.x * this.scale) * dpr, (viewH / 2 - this.y * this.scale) * dpr);
  }

  worldToScreen(p: Vec2, viewW: number, viewH: number): Vec2 {
    return {
      x: (p.x - this.x) * this.scale + viewW / 2,
      y: (p.y - this.y) * this.scale + viewH / 2,
    };
  }
}
