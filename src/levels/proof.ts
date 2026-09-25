/**
 * Solvability proof: park the rig on the target bay and drive OUT along a
 * list of moves. The kinematics are time-reversible, so a drive-out that
 * touches nothing proves the reverse-in exists, and where it ends is a fair
 * spawn. Used by the level checker and the Daily Yard generator.
 */
import { DEG } from '../core/math.ts';
import { quantize } from '../game/replay.ts';
import { Session } from '../game/session.ts';
import { BUFFER, type Spawn, type YardLayout } from '../game/yard.ts';
import { inflate, obbOverlap } from '../physics/sat.ts';
import type { DriveMove } from './parse.ts';

const DT = 1 / 120;

export interface ProofResult {
  ok: boolean;
  /** Where the drive-out ended, as a spawn (trailer rear, heading, articulation). */
  end: Spawn;
  /** Metres driven. */
  pathLength: number;
  /** Shunts the PLAYER needs (the route driven backwards, forward/reverse swapped). */
  shunts: number;
  problem?: string;
}

/** True if the rig overlaps anything (optionally with extra clearance all round). */
export function rigOverlaps(s: Session, margin = 0): string | null {
  const t = inflate(s.artic.tractorBox, margin);
  const r = inflate(s.artic.trailerBox, margin);
  for (const o of s.obstacles) {
    if (obbOverlap(t, o.box) || obbOverlap(r, o.box)) return o.kind;
  }
  return null;
}

/** Put the rig on the target bay, against the buffers. */
export function parkOnBay(s: Session): void {
  const bay = s.bay;
  const a = bay.heading * DEG;
  const gap = (bay.buffers ? BUFFER.depth : 0) + 0.05;
  s.artic.resetFromTrailerRear(bay.x + Math.cos(a) * gap, bay.y + Math.sin(a) * gap, a, 0);
}

export function playerShunts(moves: DriveMove[]): number {
  const legs = [...moves].reverse().map((m) => -m.throttle);
  const firstReverse = legs.indexOf(-1);
  return legs.filter((t, k) => t === 1 && k > firstReverse && legs[k - 1] !== 1).length;
}

/**
 * Replay a drive-out. `margin` demands that much clearance (metres) from
 * every obstacle once the rig has left the bay – the generator uses it so
 * daily yards are never razor-thin.
 */
export function runDriveOut(yard: YardLayout, moves: DriveMove[], margin = 0): ProofResult {
  const s = new Session(yard);
  s.recording = false;
  s.reset();
  parkOnBay(s);
  const fail = (problem: string): ProofResult => ({ ok: false, end: yard.spawn, pathLength: 0, shunts: 0, problem });
  const parked = rigOverlaps(s);
  if (parked) return fail(`parked position on bay ${s.bay.label} overlaps a ${parked}`);

  let pathLength = 0;
  const legs: (DriveMove | null)[] = [...moves, null];
  for (const m of legs) {
    // Finish with the handbrake so the rig stops within a couple of metres.
    if (!m && !s.artic.handbrake) s.toggleHandbrake();
    const input = quantize({ steerMode: 'absolute', steer: m ? m.steer : moves[moves.length - 1].steer, throttle: m ? m.throttle : 0 });
    let d = 0;
    for (let t = 0; t < 120; t += DT) {
      s.step(input);
      d += Math.abs(s.artic.speed) * DT;
      if (s.state !== 'driving' || s.contacts > 0) {
        const ev = s.takeEvents().find((e) => e.type === 'fail' || e.type === 'contact');
        return fail(`drive-out hit trouble: ${JSON.stringify(ev)}`);
      }
      // Clearance check once clear of the bay's own buffers.
      if (margin > 0 && pathLength + d > 3) {
        const tight = rigOverlaps(s, margin);
        if (tight) return fail(`less than ${margin} m from a ${tight}`);
      }
      if (m ? d >= m.dist : s.artic.stopped) break;
    }
    pathLength += d;
  }
  const r = s.artic.trailerRear;
  return {
    ok: true,
    end: {
      x: +r.x.toFixed(2),
      y: +r.y.toFixed(2),
      heading: +((s.artic.trailerHeading / DEG + 360) % 360).toFixed(1),
      articulation: +(s.artic.articulation / DEG).toFixed(1),
    },
    pathLength,
    shunts: playerShunts(moves),
  };
}
