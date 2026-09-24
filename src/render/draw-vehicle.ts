/**
 * Procedural top-down art for the tractor unit and curtainsider trailer.
 * Everything is drawn in metres in the vehicle's own body frame
 * (+x forwards, +y to the vehicle's right).
 */
import { TRACTOR, TRAILER } from '../config/vehicle.ts';
import { BRAND, brandLogo } from '../config/brand.ts';
import { theme } from '../config/theme.ts';
import { obbCorners, type OBB } from '../physics/geometry.ts';
import type { Artic } from '../physics/artic.ts';

const L = TRACTOR.wheelbase;
const CAB_FRONT = L + TRACTOR.frontOverhang;
const CAB_REAR = CAB_FRONT - TRACTOR.cabLength;
const HW = TRACTOR.width / 2;
const T_REAR = -(TRAILER.length - TRAILER.kingpinSetback);
const T_FRONT = TRAILER.kingpinSetback;
const THW = TRAILER.width / 2;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wheel(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, wid: number, angle = 0): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = '#141414';
  roundRect(ctx, -len / 2, -wid / 2, len, wid, 0.08);
  ctx.fill();
  ctx.fillStyle = '#2c2c2c';
  ctx.fillRect(-len / 2 + 0.12, -wid / 2 + 0.05, len - 0.24, 0.05);
  ctx.restore();
}

function polygon(ctx: CanvasRenderingContext2D, box: OBB): void {
  const c = obbCorners(box);
  ctx.beginPath();
  ctx.moveTo(c[0].x, c[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
  ctx.closePath();
}

/** Soft drop shadows, offset in WORLD space so the "sun" stays put. */
export function drawVehicleShadows(ctx: CanvasRenderingContext2D, artic: Artic): void {
  ctx.save();
  ctx.translate(0.35, 0.5);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  polygon(ctx, artic.trailerBox);
  ctx.fill();
  polygon(ctx, artic.tractorBox);
  ctx.fill();
  ctx.restore();
}

/** Tractor chassis, wheels and fifth wheel – drawn BEFORE the trailer. */
export function drawTractorChassis(ctx: CanvasRenderingContext2D, artic: Artic): void {
  ctx.save();
  ctx.translate(artic.x, artic.y);
  ctx.rotate(artic.heading);

  // Rear twin wheels.
  const tw = TRACTOR.track / 2;
  for (const s of [-1, 1]) wheel(ctx, 0, s * tw, TRACTOR.wheelDiameter, 0.6);

  // Front wheels with Ackermann geometry (inner wheel turns more).
  const d = artic.steer;
  let inner = d;
  let outer = d;
  if (Math.abs(d) > 1e-4) {
    const r = L / Math.tan(Math.abs(d));
    inner = Math.sign(d) * Math.atan(L / (r - tw));
    outer = Math.sign(d) * Math.atan(L / (r + tw));
  }
  // Turning right (d > 0): the right-hand (+y) wheel is the inner one.
  wheel(ctx, L, tw, TRACTOR.wheelDiameter, TRACTOR.wheelWidth, d > 0 ? inner : outer);
  wheel(ctx, L, -tw, TRACTOR.wheelDiameter, TRACTOR.wheelWidth, d > 0 ? outer : inner);

  // Chassis rails.
  ctx.fillStyle = '#26282b';
  ctx.fillRect(-TRACTOR.rearOverhang, -0.45, CAB_REAR - -TRACTOR.rearOverhang + 0.2, 0.9);

  // Rear wings.
  ctx.fillStyle = '#34373b';
  for (const s of [-1, 1]) ctx.fillRect(-0.62, s > 0 ? 0.45 : -1.28, 1.24, 0.83);

  // Fuel tank (nearside) and battery/AdBlue box (offside).
  ctx.fillStyle = '#b9bec4';
  roundRect(ctx, 1.1, -1.18, 1.5, 0.66, 0.25);
  ctx.fill();
  ctx.fillStyle = '#3a3e44';
  ctx.fillRect(1.2, 0.52, 1.0, 0.62);

  // Catwalk behind the cab.
  ctx.fillStyle = '#5a5f66';
  ctx.fillRect(CAB_REAR - 0.7, -0.9, 0.7, 1.8);

  // Fifth wheel coupling plate.
  ctx.fillStyle = '#1b1c1e';
  ctx.beginPath();
  ctx.arc(TRACTOR.fifthWheelAhead, 0, 0.72, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3d4046';
  ctx.fillRect(TRACTOR.fifthWheelAhead - 0.8, -0.12, 0.8, 0.24);

  // Rear marker lights on the chassis.
  ctx.fillStyle = '#8a1010';
  ctx.fillRect(-TRACTOR.rearOverhang, -1.0, 0.1, 0.3);
  ctx.fillRect(-TRACTOR.rearOverhang, 0.7, 0.1, 0.3);

  ctx.restore();
}

/** The cab – drawn AFTER the trailer so it sits on top at tight angles. */
export function drawCab(ctx: CanvasRenderingContext2D, artic: Artic): void {
  ctx.save();
  ctx.translate(artic.x, artic.y);
  ctx.rotate(artic.heading);

  // Mirror arms and heads (both sides; a UK truck has class II + IV each side).
  const mx = CAB_FRONT - 0.45;
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#1d1f22';
    ctx.fillRect(mx - 0.04, s > 0 ? HW : -HW - TRACTOR.mirrorReach, 0.08, TRACTOR.mirrorReach);
    roundRect(ctx, mx - 0.2, s > 0 ? HW + TRACTOR.mirrorReach - 0.14 : -HW - TRACTOR.mirrorReach, 0.34, 0.14, 0.04);
    ctx.fill();
  }

  // Cab shell.
  ctx.fillStyle = theme.cabColour;
  roundRect(ctx, CAB_REAR, -HW, TRACTOR.cabLength, TRACTOR.width, 0.28);
  ctx.fill();

  // Roof panel with air deflector at the front.
  ctx.fillStyle = theme.cabRoof;
  roundRect(ctx, CAB_REAR + 0.12, -HW + 0.14, TRACTOR.cabLength - 0.5, TRACTOR.width - 0.28, 0.2);
  ctx.fill();
  const g = ctx.createLinearGradient(CAB_FRONT - 1.1, 0, CAB_FRONT - 0.35, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(255,255,255,0.22)');
  ctx.fillStyle = g;
  roundRect(ctx, CAB_FRONT - 1.1, -HW + 0.25, 0.75, TRACTOR.width - 0.5, 0.2);
  ctx.fill();

  // Roof hatch.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(CAB_REAR + 0.7, -0.35, 0.6, 0.7);

  // Windscreen / sun-visor line and bumper.
  ctx.fillStyle = '#1e2b38';
  ctx.fillRect(CAB_FRONT - 0.3, -HW + 0.12, 0.16, TRACTOR.width - 0.24);
  ctx.fillStyle = '#111';
  ctx.fillRect(CAB_FRONT - 0.1, -HW + 0.05, 0.1, TRACTOR.width - 0.1);

  // Headlights and indicators.
  ctx.fillStyle = '#fff6d0';
  ctx.fillRect(CAB_FRONT - 0.08, -HW + 0.12, 0.08, 0.4);
  ctx.fillRect(CAB_FRONT - 0.08, HW - 0.52, 0.08, 0.4);
  ctx.fillStyle = '#ffa000';
  ctx.fillRect(CAB_FRONT - 0.2, -HW, 0.14, 0.08);
  ctx.fillRect(CAB_FRONT - 0.2, HW - 0.08, 0.14, 0.08);

  ctx.restore();
}

export interface TrailerLook {
  reversing?: boolean;
  braking?: boolean;
  curtain?: string;
  /** Logo painted on the roof (the player's trailer only). */
  roofLogo?: HTMLImageElement | null;
}

export function drawTrailer(ctx: CanvasRenderingContext2D, artic: Artic): void {
  const h = artic.hitch;
  drawTrailerAt(ctx, h.x, h.y, artic.trailerHeading, {
    reversing: artic.gear === 'R' && !artic.jackknifed,
    braking: artic.braking || artic.handbrake,
    roofLogo: BRAND.trailerRoofLogo ? brandLogo('onLight') : null,
  });
}

/** Draw a trailer with its kingpin at (kx, ky), pointing along `heading`. */
export function drawTrailerAt(
  ctx: CanvasRenderingContext2D,
  kx: number,
  ky: number,
  heading: number,
  look: TrailerLook = {},
): void {
  ctx.save();
  ctx.translate(kx, ky);
  ctx.rotate(heading);

  // Tri-axle bogie (mostly hidden under the body; peeks out when viewed tight).
  const tw = TRAILER.track / 2;
  for (let i = 0; i < TRAILER.axleCount; i++) {
    const ax = -TRAILER.kingpinToBogie + (i - (TRAILER.axleCount - 1) / 2) * TRAILER.axleSpacing;
    for (const s of [-1, 1]) wheel(ctx, ax, s * tw, TRAILER.wheelDiameter, TRAILER.wheelWidth);
  }

  // Curtain sides (seen as a thin band from above) and the roof.
  ctx.fillStyle = look.curtain ?? theme.trailerCurtain;
  ctx.fillRect(T_REAR, -THW, TRAILER.length, TRAILER.width);
  ctx.fillStyle = theme.trailerRoof;
  ctx.fillRect(T_REAR + 0.12, -THW + 0.16, TRAILER.length - 0.24, TRAILER.width - 0.32);

  // Roof bows.
  ctx.strokeStyle = 'rgba(0,0,0,0.09)';
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  for (let x = T_REAR + 0.9; x < T_FRONT - 0.3; x += 1.15) {
    ctx.moveTo(x, -THW + 0.16);
    ctx.lineTo(x, THW - 0.16);
  }
  ctx.stroke();

  if (look.roofLogo) {
    // Centred on the roof, reading along the trailer.
    const h = TRAILER.width - 0.7;
    const w = h * (look.roofLogo.naturalWidth / look.roofLogo.naturalHeight);
    ctx.drawImage(look.roofLogo, (T_REAR + T_FRONT) / 2 - w / 2, -h / 2, w, h);
  }

  // Front bulkhead and rear door frame.
  ctx.fillStyle = '#5b6068';
  ctx.fillRect(T_FRONT - 0.14, -THW, 0.14, TRAILER.width);
  ctx.fillStyle = '#3a3e44';
  ctx.fillRect(T_REAR, -THW, 0.16, TRAILER.width);

  // Rear light clusters: reversing (white) inboard, stop/tail (red) outboard.
  const reversing = !!look.reversing;
  const braking = !!look.braking;
  for (const s of [-1, 1]) {
    ctx.fillStyle = braking ? '#ff2a2a' : '#8e1414';
    ctx.fillRect(T_REAR - 0.04, s > 0 ? THW - 0.42 : -THW + 0.06, 0.08, 0.36);
    ctx.fillStyle = reversing ? '#ffffff' : '#9aa0a6';
    ctx.fillRect(T_REAR - 0.04, s > 0 ? THW - 0.62 : -THW + 0.42, 0.08, 0.2);
  }

  ctx.restore();
}

/** Additive glows for reversing / brake lights (subtle by day, key at night). */
export function drawLightGlows(ctx: CanvasRenderingContext2D, artic: Artic, strength = 0.35): void {
  const reversing = artic.gear === 'R' && !artic.jackknifed;
  const braking = artic.braking || artic.handbrake;
  if (!reversing && !braking) return;
  const h = artic.hitch;
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.rotate(artic.trailerHeading);
  ctx.globalCompositeOperation = 'lighter';
  if (reversing) {
    const g = ctx.createRadialGradient(T_REAR, 0, 0.2, T_REAR, 0, 7);
    g.addColorStop(0, `rgba(255,255,240,${0.55 * strength})`);
    g.addColorStop(1, 'rgba(255,255,240,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(T_REAR, -THW);
    ctx.lineTo(T_REAR - 7, -THW - 3);
    ctx.lineTo(T_REAR - 7, THW + 3);
    ctx.lineTo(T_REAR, THW);
    ctx.closePath();
    ctx.fill();
  }
  if (braking) {
    for (const s of [-1, 1]) {
      const y = s * (THW - 0.24);
      const g = ctx.createRadialGradient(T_REAR, y, 0, T_REAR, y, 1.2);
      g.addColorStop(0, `rgba(255,40,40,${0.7 * strength})`);
      g.addColorStop(1, 'rgba(255,40,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(T_REAR - 1.2, y - 1.2, 1.4, 2.4);
    }
  }
  ctx.restore();
}

export function drawArtic(ctx: CanvasRenderingContext2D, artic: Artic): void {
  drawVehicleShadows(ctx, artic);
  drawTractorChassis(ctx, artic);
  drawTrailer(ctx, artic);
  drawCab(ctx, artic);
  drawLightGlows(ctx, artic);
}
