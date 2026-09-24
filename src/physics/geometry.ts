import type { Vec2 } from '../core/math.ts';

/** Oriented rectangle. `angle` is the direction of the half-length axis. */
export interface OBB {
  cx: number;
  cy: number;
  halfLength: number;
  halfWidth: number;
  angle: number;
}

/**
 * Build an OBB from a body frame: `origin` + `angle` define the frame, and the
 * rectangle spans [rear, front] along the frame's x axis, ±halfWidth across.
 */
export function obbFromFrame(
  origin: Vec2,
  angle: number,
  rear: number,
  front: number,
  halfWidth: number,
): OBB {
  const mid = (rear + front) / 2;
  return {
    cx: origin.x + Math.cos(angle) * mid,
    cy: origin.y + Math.sin(angle) * mid,
    halfLength: (front - rear) / 2,
    halfWidth,
    angle,
  };
}

/** Corners in order: front-left, front-right, rear-right, rear-left. */
export function obbCorners(b: OBB): Vec2[] {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const lx = c * b.halfLength;
  const ly = s * b.halfLength;
  const wx = -s * b.halfWidth;
  const wy = c * b.halfWidth;
  return [
    { x: b.cx + lx - wx, y: b.cy + ly - wy },
    { x: b.cx + lx + wx, y: b.cy + ly + wy },
    { x: b.cx - lx + wx, y: b.cy - ly + wy },
    { x: b.cx - lx - wx, y: b.cy - ly - wy },
  ];
}
