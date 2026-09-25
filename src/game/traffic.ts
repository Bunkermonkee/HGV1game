/**
 * Yard traffic: forklifts and shunters driving fixed routes.
 *
 * They are stepped with the physics (so replays stay exact) and they give
 * way: if their next move would bring them within a metre or so of the
 * player's rig, they wait. The player can still drive into them.
 */
import type { OBB } from '../physics/geometry.ts';
import { inflate, obbOverlap } from '../physics/sat.ts';
import type { TrafficDef } from './yard.ts';

export const TRAFFIC_SIZE: Record<TrafficDef['kind'], { length: number; width: number; label: string }> = {
  forklift: { length: 2.8, width: 1.25, label: 'forklift' },
  shunter: { length: 5.4, width: 2.5, label: 'yard shunter' },
};

/** Clearance the traffic keeps from the rig (m). */
const GIVE_WAY = 1.2;

export class TrafficVehicle {
  readonly def: TrafficDef;
  readonly length: number;
  readonly width: number;
  x = 0;
  y = 0;
  heading = 0;
  /** Giving way to the player (drawn with brake lights and a flashing beacon). */
  waiting = false;
  /** Moving backwards along a pingpong route. */
  reversing = false;

  private cum: number[] = [0];
  private total = 0;
  private s: number;
  private dir: 1 | -1 = 1;
  private pause = 0;

  constructor(def: TrafficDef) {
    this.def = def;
    const size = TRAFFIC_SIZE[def.kind];
    this.length = size.length;
    this.width = size.width;
    const pts = this.points();
    for (let i = 1; i < pts.length; i++) {
      this.total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      this.cum.push(this.total);
    }
    this.s = Math.min(def.start ?? 0, this.total);
    this.place(this.s);
  }

  /** Route points; a loop is closed back to its first point. */
  private points(): [number, number][] {
    const p = this.def.path;
    return this.def.mode === 'loop' ? [...p, p[0]] : p;
  }

  private pointAt(s: number): [number, number] {
    const pts = this.points();
    if (this.def.mode === 'loop') s = ((s % this.total) + this.total) % this.total;
    else s = Math.max(0, Math.min(this.total, s));
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < s) i++;
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const t = (s - this.cum[i - 1]) / seg;
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  }

  /** Pose at distance s: heading from a point just behind to just ahead, so corners are rounded. */
  private poseAt(s: number): { x: number; y: number; heading: number } {
    const [x, y] = this.pointAt(s);
    const a = this.pointAt(s - 1.5);
    const b = this.pointAt(s + 1.5);
    const heading = Math.atan2(b[1] - a[1], b[0] - a[0]);
    return { x, y, heading };
  }

  private place(s: number): void {
    const p = this.poseAt(s);
    this.x = p.x;
    this.y = p.y;
    this.heading = p.heading;
  }

  boxAt(x: number, y: number, heading: number): OBB {
    return { cx: x, cy: y, halfLength: this.length / 2, halfWidth: this.width / 2, angle: heading };
  }

  get box(): OBB {
    return this.boxAt(this.x, this.y, this.heading);
  }

  step(dt: number, blockers: OBB[]): void {
    if (this.pause > 0) {
      this.pause -= dt;
      this.waiting = false;
      return;
    }
    let ns = this.s + this.def.speed * dt * this.dir;
    let nextDir = this.dir;
    let pause = 0;
    if (this.def.mode !== 'loop') {
      if (ns >= this.total) {
        ns = this.total;
        nextDir = -1;
        pause = this.def.pause ?? 2;
      } else if (ns <= 0) {
        ns = 0;
        nextDir = 1;
        pause = this.def.pause ?? 2;
      }
    }
    // Look a little ahead in the direction of travel before moving.
    const p = this.poseAt(ns);
    const ahead = this.dir * 1.0;
    const probe = inflate(
      this.boxAt(p.x + Math.cos(p.heading) * ahead, p.y + Math.sin(p.heading) * ahead, p.heading),
      GIVE_WAY,
    );
    if (blockers.some((b) => obbOverlap(probe, b))) {
      this.waiting = true;
      return;
    }
    this.waiting = false;
    this.reversing = this.dir < 0;
    this.s = ns;
    this.dir = nextDir;
    this.pause = pause;
    this.x = p.x;
    this.y = p.y;
    this.heading = p.heading;
  }
}
