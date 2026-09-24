/** Is the trailer parked correctly on the target bay? */
import { RULES } from '../config/rules.ts';
import { DEG, wrapAngle } from '../core/math.ts';
import type { Artic } from '../physics/artic.ts';
import { BUFFER, type Bay } from './yard.ts';

export interface BayCheck {
  /** Trailer rear is somewhere in or just in front of the bay (guide shown). */
  near: boolean;
  angleErr: number; // degrees, signed
  lateral: number; // metres, signed
  rearGap: number; // metres to the buffer face (negative = pressed into it)
  angleOk: boolean;
  lateralOk: boolean;
  gapOk: boolean;
  ok: boolean;
}

export function checkBay(artic: Artic, bay: Bay): BayCheck {
  const a = bay.heading * DEG;
  const r = artic.trailerRear;
  const dx = r.x - bay.x;
  const dy = r.y - bay.y;
  const along = dx * Math.cos(a) + dy * Math.sin(a);
  const lateral = -dx * Math.sin(a) + dy * Math.cos(a);
  const rearGap = along - (bay.buffers ? BUFFER.depth : 0);
  const angleErr = wrapAngle(artic.trailerHeading - a) / DEG;

  const angleOk = Math.abs(angleErr) <= RULES.bay.maxAngle;
  const lateralOk = Math.abs(lateral) <= RULES.bay.maxLateral;
  const gapOk = rearGap >= -0.05 && rearGap <= RULES.bay.maxRearGap;
  return {
    near: along > -1 && along < bay.length + 8 && Math.abs(lateral) < bay.width * 1.5,
    angleErr,
    lateral,
    rearGap,
    angleOk,
    lateralOk,
    gapOk,
    ok: angleOk && lateralOk && gapOk,
  };
}

/** Plain-English reason the bay check failed, for the handbrake feedback. */
export function bayProblem(c: BayCheck): string {
  if (!c.near) return "You're not on the bay yet";
  if (c.rearGap > 3) return `Not on the bay yet – ${c.rearGap.toFixed(0)} m to the buffers`;
  if (!c.gapOk) return c.rearGap > 0 ? `${c.rearGap.toFixed(1)} m off the buffers – back up a touch` : 'Too far back';
  if (!c.angleOk) return `Trailer ${Math.abs(c.angleErr).toFixed(1)}° off straight – needs ±${RULES.bay.maxAngle}°`;
  if (!c.lateralOk) return `${Math.abs(c.lateral).toFixed(2)} m off centre – needs ±${RULES.bay.maxLateral} m`;
  return '';
}
