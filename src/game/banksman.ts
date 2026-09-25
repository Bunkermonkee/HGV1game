/**
 * The banksman: stands by the target bay mouth and signals the driver in.
 *
 * He reads it like an experienced driver: from where the back of the
 * trailer is, which way it's pointing and how much it's articulated, he
 * knows where the wheel ought to be, and calls the difference. Signals are
 * steering corrections ("left hand down" = steer further left), the way
 * drivers are talked in on a real dock.
 */
import { STEERING, TRACTOR, TRAILER } from '../config/vehicle.ts';
import { clamp, DEG, wrapAngle } from '../core/math.ts';
import type { OBB } from '../physics/geometry.ts';
import { inflate, obbOverlap } from '../physics/sat.ts';
import type { Artic } from '../physics/artic.ts';
import { BUFFER, type BanksmanDef, type Bay } from './yard.ts';

export type Signal = 'wave' | 'back' | 'left' | 'right' | 'steady' | 'stop' | 'forward';

export const SIGNAL_TEXT: Record<Signal, string> = {
  wave: 'OVER HERE',
  back: 'COME BACK',
  left: 'LEFT HAND DOWN',
  right: 'RIGHT HAND DOWN',
  steady: 'STEADY…',
  stop: 'STOP!',
  forward: 'PULL FORWARD',
};

/** Half-size of his collision box (metres). */
const HALF = 0.3;
/** Walking pace (m/s) when he steps out of the way. */
const WALK = 1.6;
/**
 * He moves if the rig comes within this distance (m) of where he's standing –
 * more when it's moving faster – to the nearest place along the bay mouth
 * with SAFE_EXTRA more room than that.
 */
const DANGER = 0.5;
const DANGER_PER_MS = 1.0;
const SAFE_EXTRA = 0.6;
/** A signal must hold this long (s) before he changes it, so he doesn't flap. */
const SETTLE = 0.15;
/** Wheel error (fraction of full lock) that makes him call a correction… */
const TOL_ON = 0.15;
/** …and that he's happy with again once you're correcting. */
const TOL_OFF = 0.06;

/**
 * The wheel position (fraction of full lock, + = right) a good driver would
 * want now: aim the trailer at the bay centre line, set the articulation that
 * turns it that way, and the steering that holds that articulation.
 */
function wantedSteer(artic: Artic, lateral: number, gap: number, e: number): number {
  const L1 = TRACTOR.wheelbase;
  const A = TRACTOR.fifthWheelAhead;
  const L2 = TRAILER.kingpinToBogie;
  const phi = artic.articulation;
  const look = Math.max(3, Math.min(10, gap * 0.5));
  const aim = clamp(Math.atan(lateral / look), -0.7, 0.7);
  const phiWanted = Math.asin(clamp(-L2 * 0.3 * wrapAngle(aim - e), -0.7, 0.7));
  const tanD = ((Math.sin(phi) / L2 - 0.8 * (phiWanted - phi)) * L1) / (1 - (A * Math.cos(phi)) / L2);
  return clamp(Math.atan(tanD) / (STEERING.maxAngle * DEG), -1, 1);
}

export function banksmanSpot(bay: Bay, def: BanksmanDef): { x: number; y: number } {
  const a = bay.heading * DEG;
  const along = bay.length - 1;
  // Bay-frame +lateral is the driver's right when parked in the bay.
  const lateral = (def.side === 'right' ? 1 : -1) * (bay.width / 2 + 0.7);
  return {
    x: bay.x + Math.cos(a) * along - Math.sin(a) * lateral,
    y: bay.y + Math.sin(a) * along + Math.cos(a) * lateral,
  };
}

function boxAt(x: number, y: number): OBB {
  return { cx: x, cy: y, halfLength: HALF, halfWidth: HALF, angle: 0 };
}

export function banksmanBox(bay: Bay, def: BanksmanDef): OBB {
  const p = banksmanSpot(bay, def);
  return boxAt(p.x, p.y);
}

export class Banksman {
  x: number;
  y: number;
  /** Stepping out of the way of the rig. */
  walking = false;
  /** Direction he's facing (towards the back of the trailer). */
  facing = 0;
  signal: Signal = 'wave';
  private candidate: Signal = 'wave';
  private candidateTime = 0;
  private bay: Bay;
  /** Where he can stand: his spot first, then further along the bay mouth, away from the bay. */
  private spots: { x: number; y: number }[];

  /** `statics`: the yard's fixed obstacles, so he never picks a spot inside one. */
  constructor(bay: Bay, def: BanksmanDef, statics: OBB[] = []) {
    this.bay = bay;
    const home = banksmanSpot(bay, def);
    this.x = home.x;
    this.y = home.y;
    const a = bay.heading * DEG;
    const side = def.side === 'right' ? 1 : -1;
    this.spots = [home];
    for (let k = 1; k <= 4; k++) {
      const lateral = side * (bay.width / 2 + 0.7 + 1.6 * k);
      const along = bay.length - 1;
      const p = { x: bay.x + Math.cos(a) * along - Math.sin(a) * lateral, y: bay.y + Math.sin(a) * along + Math.cos(a) * lateral };
      const b = inflate(boxAt(p.x, p.y), 0.3);
      if (statics.some((o) => obbOverlap(b, o))) break;
      this.spots.push(p);
    }
  }

  get box(): OBB {
    return boxAt(this.x, this.y);
  }

  /**
   * Keep out of the rig's way: if it comes close, walk along the bay mouth
   * to the nearest spot with room; go back to his own spot once it's clear.
   * Stepped with the physics so replays stay exact.
   */
  walk(dt: number, rig: OBB[], speed: number): void {
    const danger = DANGER + Math.abs(speed) * DANGER_PER_MS;
    const safe = danger + SAFE_EXTRA;
    const near = (x: number, y: number, m: number) => {
      const b = boxAt(x, y);
      return rig.some((r) => obbOverlap(inflate(r, m), b));
    };
    let target = this.spots[0];
    if (near(target.x, target.y, safe)) {
      if (!this.walking && !near(this.x, this.y, danger)) return;
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (const p of this.spots) {
        if (near(p.x, p.y, safe)) continue;
        const d = Math.hypot(p.x - this.x, p.y - this.y);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      // Nowhere clear: get as far along as he can.
      target = best ?? this.spots[this.spots.length - 1];
    }
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const d = Math.hypot(dx, dy);
    const stepLen = WALK * dt;
    if (d <= stepLen) {
      this.x = target.x;
      this.y = target.y;
      this.walking = false;
    } else {
      this.x += (dx / d) * stepLen;
      this.y += (dy / d) * stepLen;
      this.walking = true;
    }
  }

  /**
   * Returns the new signal when it changes, else null. `closeCall`: the rig
   * is within half a metre of hitting something.
   */
  update(artic: Artic, dt: number, closeCall = false): Signal | null {
    const bay = this.bay;
    const a = bay.heading * DEG;
    const r = artic.trailerRear;
    this.facing = Math.atan2(r.y - this.y, r.x - this.x);
    const dx = r.x - bay.x;
    const dy = r.y - bay.y;
    const along = dx * Math.cos(a) + dy * Math.sin(a);
    const lateral = -dx * Math.sin(a) + dy * Math.cos(a);
    const gap = along - (bay.buffers ? BUFFER.depth : 0);
    const e = wrapAngle(artic.trailerHeading - a);

    let want: Signal;
    if (along > bay.length + 14 || Math.abs(e) > 35 * DEG || artic.jackknifed) {
      want = 'wave';
    } else if (gap <= 0.25) {
      want = 'stop';
    } else if (closeCall) {
      // About to hit something: stop, then come forward off it.
      want = artic.speed < -0.05 ? 'stop' : 'forward';
    } else {
      const correcting = this.signal === 'left' || this.signal === 'right';
      const tol = correcting ? TOL_OFF : TOL_ON;
      const wheel = wantedSteer(artic, lateral, gap, e) - artic.steer / (STEERING.maxAngle * DEG);
      // Too far off to save: pull forward and have another go.
      if (gap < 3.5 && (Math.abs(lateral - gap * Math.sin(e)) > 0.6 || Math.abs(e) > 7 * DEG)) want = 'forward';
      else if (wheel > tol) want = 'right';
      else if (wheel < -tol) want = 'left';
      else if (gap < 2.5) want = 'steady';
      else want = 'back';
    }

    if (want !== this.candidate) {
      this.candidate = want;
      this.candidateTime = 0;
    }
    this.candidateTime += dt;
    // STOP is urgent: no settling delay.
    if (want !== this.signal && (want === 'stop' || this.candidateTime >= SETTLE)) {
      this.signal = want;
      return want;
    }
    return null;
  }
}
