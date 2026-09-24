/** Procedural yard: tarmac, kerbs, dock building, doors, buffers and bay lines. */
import { theme } from '../config/theme.ts';
import { DEG } from '../core/math.ts';
import type { Bay, Marking, YardLayout } from '../game/yard.ts';

// Patterns belong to the context that made them (main view, share card…).
const tarmacPatterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern | null>();
const PATTERN_PX_PER_M = 24;

function makeTarmacPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = theme.yardTarmac;
  g.fillRect(0, 0, size, size);
  // Deterministic speckle so the pattern is identical every load.
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) {
    const v = rnd();
    g.fillStyle = v > 0.5 ? `rgba(255,255,255,${0.03 + rnd() * 0.05})` : `rgba(0,0,0,${0.05 + rnd() * 0.08})`;
    g.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
  const p = ctx.createPattern(c, 'repeat');
  p?.setTransform(new DOMMatrix().scaleSelf(1 / PATTERN_PX_PER_M, 1 / PATTERN_PX_PER_M));
  return p;
}

/** Text drawn in world units (metres), independent of browser minimum font sizes. */
export function worldText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  sizeM: number,
  angle: number,
  colour: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const k = sizeM / 100;
  ctx.scale(k, k);
  ctx.fillStyle = colour;
  ctx.font = `900 100px ${theme.uiFontDisplay}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function drawMarking(ctx: CanvasRenderingContext2D, m: Marking): void {
  switch (m.kind) {
    case 'text':
      worldText(ctx, m.text, m.x, m.y, m.size ?? 1.6, (m.angle ?? 0) * DEG, 'rgba(242,242,242,0.8)');
      break;
    case 'hatch': {
      ctx.save();
      ctx.beginPath();
      ctx.rect(m.x, m.y, m.w, m.h);
      ctx.clip();
      ctx.strokeStyle = theme.yardLineYellow;
      ctx.lineWidth = 0.15;
      ctx.strokeRect(m.x, m.y, m.w, m.h);
      ctx.beginPath();
      for (let d = -m.h; d < m.w; d += 1.2) {
        ctx.moveTo(m.x + d, m.y + m.h);
        ctx.lineTo(m.x + d + m.h, m.y);
      }
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'line':
      ctx.save();
      ctx.strokeStyle = m.colour === 'yellow' ? theme.yardLineYellow : theme.yardLineWhite;
      ctx.lineWidth = 0.12;
      if (m.dashed) ctx.setLineDash([1.5, 1.5]);
      ctx.beginPath();
      ctx.moveTo(m.x1, m.y1);
      ctx.lineTo(m.x2, m.y2);
      ctx.stroke();
      ctx.restore();
      break;
  }
}

function drawBay(ctx: CanvasRenderingContext2D, bay: Bay): void {
  const a = bay.heading * DEG;
  ctx.save();
  ctx.translate(bay.x, bay.y);
  // Bay frame: +x runs out of the bay into the yard, +y across it.
  ctx.rotate(a);
  const hw = bay.width / 2;
  const line = 0.12;

  if (bay.target) {
    // Target bay: hatched approach box and green-tinted floor.
    ctx.fillStyle = 'rgba(46, 204, 113, 0.16)';
    ctx.fillRect(0, -hw, bay.length, bay.width);
  }

  ctx.fillStyle = theme.yardLineYellow;
  ctx.fillRect(0, -hw - line / 2, bay.length, line);
  ctx.fillRect(0, hw - line / 2, bay.length, line);

  // Centre guide line (dashed, white) – many real bays have one.
  ctx.fillStyle = 'rgba(242,242,242,0.55)';
  for (let x = 1.5; x < bay.length - 1; x += 2) ctx.fillRect(x, -0.05, 1, 0.1);

  // Bay number painted at the open end, readable when approaching.
  worldText(ctx, bay.label, bay.length - 1.4, 0, 1.5, -Math.PI / 2, 'rgba(242,242,242,0.85)');

  if (bay.buffers) {
    ctx.fillStyle = '#111';
    for (const s of [-1, 1]) ctx.fillRect(0, s * 0.95 - 0.2, 0.28, 0.4);
  }
  ctx.restore();
}

export function drawYard(ctx: CanvasRenderingContext2D, yard: YardLayout): void {
  if (!tarmacPatterns.has(ctx)) tarmacPatterns.set(ctx, makeTarmacPattern(ctx));
  const tarmacPattern = tarmacPatterns.get(ctx);

  // Grass verge surrounding the yard.
  ctx.fillStyle = theme.yardGrass;
  ctx.fillRect(-60, -60, yard.width + 120, yard.height + 120);

  // Tarmac.
  ctx.fillStyle = tarmacPattern ?? theme.yardTarmac;
  ctx.fillRect(0, 0, yard.width, yard.height);

  // Kerb.
  ctx.strokeStyle = theme.yardKerb;
  ctx.lineWidth = 0.3;
  ctx.strokeRect(-0.15, -0.15, yard.width + 0.3, yard.height + 0.3);

  for (const m of yard.markings) drawMarking(ctx, m);

  // Buildings (warehouse, dock pods). Rotated about their centres.
  for (const b of yard.buildings) {
    ctx.save();
    ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
    ctx.rotate((b.angle ?? 0) * DEG);
    const x0 = -b.w / 2;
    const y0 = -b.h / 2;
    ctx.fillStyle = theme.yardBuilding;
    ctx.fillRect(x0, y0, b.w, b.h);
    // Roof sheets run across the short side.
    ctx.strokeStyle = theme.yardBuildingRoof;
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    if (b.w >= b.h) {
      for (let x = x0 + 2; x < -x0; x += 2) {
        ctx.moveTo(x, y0);
        ctx.lineTo(x, -y0);
      }
    } else {
      for (let y = y0 + 2; y < -y0; y += 2) {
        ctx.moveTo(x0, y);
        ctx.lineTo(-x0, y);
      }
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 0.25;
    ctx.strokeRect(x0, y0, b.w, b.h);
    ctx.restore();
  }

  // Dock doors: a lighter recess at the building face behind each buffered bay.
  for (const bay of yard.bays) {
    if (!bay.buffers) continue;
    ctx.save();
    ctx.translate(bay.x, bay.y);
    ctx.rotate(bay.heading * DEG);
    ctx.fillStyle = theme.yardDockDoor;
    ctx.fillRect(-0.5, -(bay.width - 0.9) / 2, 0.5, bay.width - 0.9);
    ctx.fillStyle = bay.target ? '#2ecc71' : '#ffb000';
    ctx.fillRect(-0.12, (bay.width - 0.9) / 2 - 0.25, 0.12, 0.25);
    ctx.restore();
  }

  for (const bay of yard.bays) drawBay(ctx, bay);
}
