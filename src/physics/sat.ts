/** Separating Axis Theorem for oriented rectangles. */
import type { OBB } from './geometry.ts';

function projectRadius(b: OBB, ax: number, ay: number): number {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  return b.halfLength * Math.abs(c * ax + s * ay) + b.halfWidth * Math.abs(-s * ax + c * ay);
}

function separatedOn(a: OBB, b: OBB, ax: number, ay: number): boolean {
  const dist = Math.abs((b.cx - a.cx) * ax + (b.cy - a.cy) * ay);
  return dist > projectRadius(a, ax, ay) + projectRadius(b, ax, ay);
}

/** True if the two rectangles overlap. */
export function obbOverlap(a: OBB, b: OBB): boolean {
  // Cheap bounding-circle reject first.
  const ra = Math.hypot(a.halfLength, a.halfWidth);
  const rb = Math.hypot(b.halfLength, b.halfWidth);
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  if (dx * dx + dy * dy > (ra + rb) * (ra + rb)) return false;

  // Two rectangles have only four candidate separating axes.
  for (const box of [a, b]) {
    const c = Math.cos(box.angle);
    const s = Math.sin(box.angle);
    if (separatedOn(a, b, c, s) || separatedOn(a, b, -s, c)) return false;
  }
  return true;
}

export function inflate(b: OBB, margin: number): OBB {
  return { ...b, halfLength: b.halfLength + margin, halfWidth: b.halfWidth + margin };
}
