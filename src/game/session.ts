/**
 * One attempt at a yard: drives the physics, resolves collisions, counts
 * time / shunts / contacts and decides success or failure.
 */
import { RULES } from '../config/rules.ts';
import { TRAILER } from '../config/vehicle.ts';
import { DEG, MPH_TO_MS, wrapAngle } from '../core/math.ts';
import { obbFromFrame } from '../physics/geometry.ts';
import { Artic, type DriveInput } from '../physics/artic.ts';
import { inflate, obbOverlap } from '../physics/sat.ts';
import { bayProblem, checkBay, type BayCheck } from './bay.ts';
import { ReplayRecorder, STEP, type ReplayData } from './replay.ts';
import { buildObstacles, OBSTACLE_NAMES, type Obstacle } from './obstacles.ts';
import type { Bay, YardLayout } from './yard.ts';

export type SessionState = 'driving' | 'success' | 'failed';

export interface RunResult {
  levelId: string;
  levelName: string;
  bay: string;
  /** Driving time, seconds. */
  time: number;
  /** Contact penalties, seconds. */
  penalty: number;
  /** time + penalty: what star targets are judged on. */
  total: number;
  shunts: number;
  contacts: number;
  stars: number;
  /** Physics steps the run took (the time is steps / 120). */
  steps: number;
  /** The recorded run (absent when this run was itself a replay). */
  replay?: ReplayData;
}

export type SessionEvent =
  | { type: 'contact'; label: string }
  | { type: 'buffers' }
  | { type: 'message'; text: string }
  | { type: 'fail'; title: string; reason: string }
  | { type: 'coupled' }
  | { type: 'success'; result: RunResult };

/** Where the tractor's fifth wheel is relative to the parked trailer's kingpin (pick-up levels). */
export interface CouplingCheck {
  /** Close enough to show the coupling guide. */
  near: boolean;
  /** Metres still to reverse before the fifth wheel meets the kingpin. */
  toKingpin: number;
  /** Fifth wheel's sideways offset from the kingpin, metres (+ = trailer's right). */
  lateral: number;
  /** Tractor angle relative to the trailer, degrees. */
  angleErr: number;
  lateralOk: boolean;
  angleOk: boolean;
}

const NO_INPUT: DriveInput = { steerMode: 'rate', steer: 0, throttle: 0 };
const COUPLE_SPEED = RULES.coupling.maxSpeedMph * MPH_TO_MS;
const NOT_NEAR: CouplingCheck = { near: false, toKingpin: 0, lateral: 0, angleErr: 0, lateralOk: false, angleOk: false };
const HARD_SPEED = RULES.contact.hardSpeedMph * MPH_TO_MS;
const BUFFER_SAFE = RULES.contact.bufferSafeMph * MPH_TO_MS;

export class Session {
  readonly artic = new Artic();
  readonly yard: YardLayout;
  readonly bay: Bay;
  obstacles: Obstacle[] = [];
  state: SessionState = 'driving';
  time = 0;
  shunts = 0;
  contacts = 0;
  bayCheck!: BayCheck;
  /** Seconds since the state last changed (drives the results delay). */
  stateTime = 0;
  /** Metres driven in reverse this attempt (tutorial prompts use it). */
  reverseDistance = 0;
  /** Fixed physics steps taken this attempt. */
  stepCount = 0;
  /** Records the run for replays; off while playing a replay back. */
  recording = true;
  /** Pick-up levels: fifth wheel vs kingpin, for the coupling guide. */
  coupling: CouplingCheck = NOT_NEAR;
  /** Seconds left of locking on, connecting the air lines and winding up the legs. */
  couplingHold = 0;
  /** The parked trailer's legs and bogie, which the tractor's chassis can hit (body: the cab). */
  private ownTrailer: { body: Obstacle; legs: Obstacle; bogie: Obstacle } | null = null;
  private kingpinTouch = false;
  private recorder: ReplayRecorder | null = null;

  private _started = false;
  /** The truck has been put in gear this attempt (the clock is running). */
  get started(): boolean {
    return this._started;
  }
  private hasReversed = false;
  private handbrakeJudged = false;
  private overWarned = false;
  /** Hard obstacles currently in contact, so pressing against one counts once. */
  private touching = new Set<Obstacle>();
  private events: SessionEvent[] = [];

  constructor(yard: YardLayout) {
    this.yard = yard;
    const bay = yard.bays.find((b) => b.target) ?? yard.bays[0];
    this.bay = bay;
    this.reset();
  }

  reset(): void {
    const s = this.yard.spawn;
    this.artic.resetFromTrailerRear(s.x, s.y, s.heading * DEG, s.articulation ?? 0);
    this.ownTrailer = null;
    this.couplingHold = 0;
    this.kingpinTouch = false;
    this.coupling = NOT_NEAR;
    const p = this.yard.pickup;
    if (p) {
      // The trailer stands where the level's spawn puts it; the tractor starts elsewhere, uncoupled.
      const trailerHeading = this.artic.trailerHeading;
      const kingpin = this.artic.hitch;
      this.artic.reset(p.tractor.x, p.tractor.y, p.tractor.heading * DEG, 0);
      this.artic.trailerHeading = trailerHeading;
      this.artic.uncouple(kingpin);
      this.buildOwnTrailer();
    }
    this.artic.conditions = { forwardGrip: this.yard.conditions.forwardGrip ?? 1 };
    this.reverseDistance = 0;
    this.stepCount = 0;
    this.recorder = this.recording ? new ReplayRecorder(this.yard.id) : null;
    this.obstacles = buildObstacles(this.yard);
    this.state = 'driving';
    this.stateTime = 0;
    this.time = 0;
    this.shunts = 0;
    this.contacts = 0;
    this._started = false;
    this.hasReversed = false;
    this.handbrakeJudged = false;
    this.overWarned = false;
    this.touching.clear();
    this.events.length = 0;
    this.bayCheck = checkBay(this.artic, this.bay);
  }

  /** Collision parts of the parked trailer: body (cab height), landing legs and bogie (chassis height). */
  private buildOwnTrailer(): void {
    const k = this.artic.kingpin;
    const h = this.artic.trailerHeading;
    const part = (from: number, to: number, halfWidth: number): Obstacle => ({
      kind: 'trailer',
      box: obbFromFrame(k, h, from, to, halfWidth),
      soft: false,
      hit: false,
      label: 'trailer',
    });
    const bogieFront = -TRAILER.kingpinToBogie + TRAILER.axleSpacing * 1.5 + 0.5;
    this.ownTrailer = {
      body: part(-(TRAILER.length - TRAILER.kingpinSetback), TRAILER.kingpinSetback, TRAILER.width / 2),
      legs: part(-2.55, -2.25, 1.0),
      bogie: part(-(TRAILER.length - TRAILER.kingpinSetback), bogieFront, TRAILER.width / 2),
    };
  }

  /** Re-place a pick-up level's tractor (the level checker uses it for the coupling proof). */
  placeTractorUnderTrailer(): void {
    const s = this.yard.spawn;
    this.artic.resetFromTrailerRear(s.x, s.y, s.heading * DEG, s.articulation ?? 0);
    const kingpin = this.artic.hitch;
    this.artic.uncouple(kingpin);
    this.buildOwnTrailer();
  }

  get penalty(): number {
    return this.contacts * RULES.contact.penaltySeconds;
  }

  takeEvents(): SessionEvent[] {
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }

  toggleHandbrake(): void {
    if (this.state !== 'driving') return;
    this.artic.handbrake = !this.artic.handbrake;
    this.handbrakeJudged = false;
    this.recorder?.handbrake(this.stepCount);
  }

  /** Advance one fixed physics step (STEP seconds). `input` must already be quantised. */
  step(input: DriveInput): void {
    const dt = STEP;
    this.stateTime += dt;
    if (this.state !== 'driving') {
      this.artic.step(dt, NO_INPUT);
      return;
    }
    this.recorder?.input(this.stepCount, input);
    this.stepCount++;
    if (this.couplingHold > 0) {
      // Coupling up: the truck stays put while the jaws lock and the legs go up.
      this.couplingHold = Math.max(0, this.couplingHold - dt);
      this.artic.speed = 0;
      this.time += dt;
    } else {
      this.stepDriving(dt, input);
    }
    this.recorder?.afterStep(this.stepCount, this.artic);
  }

  private stepDriving(dt: number, input: DriveInput): void {
    const before = this.artic.snapshot();
    this.artic.step(dt, input);
    let articEvents = this.artic.takeEvents();

    if (this.resolveCollisions(Math.abs(before.speed))) {
      this.artic.restore(before);
      this.artic.speed = 0;
      articEvents = articEvents.filter((e) => e !== 'jackknife');
    }
    if (this.state !== 'driving') return;
    if (!this.artic.coupled && this.checkCoupling(Math.abs(before.speed))) {
      this.artic.restore(before);
      this.artic.speed = 0;
    }
    if (this.state !== 'driving') return;

    for (const e of articEvents) {
      if (e === 'gear-reverse') {
        this.hasReversed = true;
        this._started = true;
      } else if (e === 'gear-forward') {
        if (this.hasReversed) this.shunts++;
        this._started = true;
      } else if (e === 'jackknife') {
        this.fail(
          'JACKKNIFED',
          `You reversed with the trailer folded past 80°. Keep the angle out of the red, and pull forward to straighten up before it gets away from you.`,
        );
        return;
      }
    }

    // Folded past the limit while pulling forward: warn before they reverse.
    if (this.artic.overArticulated && !this.overWarned) {
      this.overWarned = true;
      this.events.push({ type: 'message', text: 'Over 80° – straighten up before you reverse' });
    } else if (!this.artic.overArticulated) {
      this.overWarned = false;
    }

    if (this._started) this.time += dt;
    if (this.artic.speed < 0 && this.artic.coupled) this.reverseDistance -= this.artic.speed * dt;

    this.bayCheck = checkBay(this.artic, this.bay);
    // Until the trailer is on, the bay guide stays hidden.
    if (!this.artic.coupled) this.bayCheck = { ...this.bayCheck, near: false, ok: false };
    this.judgeParking();
  }

  /**
   * Test both bodies against every obstacle. Returns true if the step has to
   * be undone because the truck hit something solid.
   */
  private resolveCollisions(impactSpeed: number): boolean {
    const tractor = this.artic.tractorBox;
    const coupled = this.artic.coupled;
    const trailer = this.artic.trailerBox;
    let blocked = false;
    let worst: { o: Obstacle; hard: boolean } | null = null;
    let buffered = false;

    // Uncoupled: the parked trailer is an obstacle too. Its body stands above
    // the chassis, so only the cab can hit it; the chassis can hit the legs and bogie.
    const own = this.ownTrailer && !coupled ? this.ownTrailer : null;
    const tests: [Obstacle, boolean, boolean][] = this.obstacles.map((o) => [o, obbOverlap(tractor, o.box), coupled && obbOverlap(trailer, o.box)]);
    if (own) {
      tests.push([own.body, obbOverlap(this.artic.cabBox, own.body.box), false]);
      const chassis = this.artic.chassisBox;
      tests.push([own.legs, obbOverlap(chassis, own.legs.box), false]);
      tests.push([own.bogie, obbOverlap(chassis, own.bogie.box), false]);
    }

    for (const [o, hitTractor, hitTrailer] of tests) {
      if (o.soft && o.hit) continue;
      if (!hitTractor && !hitTrailer) continue;

      if (o.soft) {
        o.hit = true;
        this.addContact(o);
        continue;
      }
      blocked = true;
      if (this.touching.has(o)) continue;
      this.touching.add(o);

      // Trailer gently onto the buffers = a proper finish, not a contact.
      if (o.kind === 'buffer' && hitTrailer && !hitTractor && impactSpeed <= BUFFER_SAFE) {
        if (!buffered) this.events.push({ type: 'buffers' });
        buffered = true;
        continue;
      }
      const hard = impactSpeed >= HARD_SPEED;
      if (!worst || (hard && !worst.hard)) worst = { o, hard };
    }

    if (worst) {
      if (worst.hard) {
        const mph = (impactSpeed / MPH_TO_MS).toFixed(1);
        this.fail(
          'HEAVY CONTACT',
          `You hit the ${worst.o.label ?? OBSTACLE_NAMES[worst.o.kind]} at ${mph} mph. Anything over ${RULES.contact.hardSpeedMph} mph means a claim form and a chat with the transport manager.`,
        );
      } else {
        this.addContact(worst.o);
      }
    }

    // Forget contacts once a small gap has opened up again.
    if (this.touching.size) {
      const t = inflate(this.artic.tractorBox, RULES.contact.releaseMargin);
      const r = coupled ? inflate(this.artic.trailerBox, RULES.contact.releaseMargin) : null;
      for (const o of this.touching) {
        if (!obbOverlap(t, o.box) && !(r && obbOverlap(r, o.box))) this.touching.delete(o);
      }
    }
    return blocked;
  }

  private addContact(o: Obstacle): void {
    this.contacts++;
    this.events.push({ type: 'contact', label: o.label ?? OBSTACLE_NAMES[o.kind] });
  }

  /**
   * Pick-up levels, after each step: update the coupling guide, and when the
   * fifth wheel reaches the kingpin either lock on (lined up and slow enough)
   * or stop against it. Returns true if the step has to be undone.
   */
  private checkCoupling(impactSpeed: number): boolean {
    const a = this.artic;
    const k = a.kingpin;
    const f = a.hitch;
    const psi = a.trailerHeading;
    const dx = f.x - k.x;
    const dy = f.y - k.y;
    const along = dx * Math.cos(psi) + dy * Math.sin(psi);
    const lateral = -dx * Math.sin(psi) + dy * Math.cos(psi);
    const ang = wrapAngle(a.heading - psi);
    const c = RULES.coupling;
    const lateralOk = Math.abs(lateral) <= c.maxLateral;
    const angleOk = Math.abs(ang) <= c.maxAngle * DEG;
    this.coupling = {
      near: along < 9 && along > -2.5 && Math.abs(lateral) < 3 && Math.abs(ang) < 45 * DEG,
      toKingpin: Math.max(0, along),
      lateral,
      angleErr: ang / DEG,
      lateralOk,
      angleOk,
    };
    if (along > 0.4) this.kingpinTouch = false;
    const under = along <= 0 && along > -2 && Math.abs(lateral) < 1.2 && Math.abs(ang) < 35 * DEG;
    if (!under || a.speed >= 0) return false;

    if (lateralOk && angleOk && impactSpeed <= COUPLE_SPEED) {
      a.couple();
      this.ownTrailer = null;
      this.hasReversed = false; // pulling away after coupling isn't a shunt
      this.couplingHold = c.holdSeconds;
      this.coupling = NOT_NEAR;
      this.events.push({ type: 'coupled' });
      return false;
    }
    if (impactSpeed >= HARD_SPEED) {
      const mph = (impactSpeed / MPH_TO_MS).toFixed(1);
      this.fail('HEAVY CONTACT', `You hit your trailer's kingpin at ${mph} mph. Back under it at walking pace – under ${c.maxSpeedMph} mph – or the coupling takes the hit.`);
      return true;
    }
    if (!this.kingpinTouch) {
      this.kingpinTouch = true;
      this.contacts++;
      this.events.push({ type: 'contact', label: 'kingpin' });
      const why = !lateralOk || !angleOk
        ? 'Missed the kingpin – pull forward, line up and try again'
        : `Too fast for the kingpin – back under at walking pace (under ${c.maxSpeedMph} mph)`;
      this.events.push({ type: 'message', text: why });
    }
    return true;
  }

  private judgeParking(): void {
    const a = this.artic;
    if (!a.handbrake || !a.stopped) return;
    if (!a.coupled) {
      if (!this.handbrakeJudged && this._started) {
        this.handbrakeJudged = true;
        this.events.push({ type: 'message', text: 'Pick your trailer up first – reverse slowly under it' });
      }
      return;
    }
    if (this.bayCheck.ok) {
      this.succeed();
    } else if (!this.handbrakeJudged && this._started) {
      this.handbrakeJudged = true;
      this.events.push({ type: 'message', text: bayProblem(this.bayCheck) });
    }
  }

  private succeed(): void {
    const total = this.time + this.penalty;
    const { three, two } = this.yard.stars;
    let stars = 1;
    if (this.shunts <= two.shunts && total <= two.time) stars = 2;
    if (this.shunts <= three.shunts && total <= three.time && this.contacts === 0) stars = 3;
    this.setState('success');
    this.events.push({
      type: 'success',
      result: {
        levelId: this.yard.id,
        levelName: this.yard.name,
        bay: this.bay.label,
        time: this.time,
        penalty: this.penalty,
        total,
        shunts: this.shunts,
        contacts: this.contacts,
        stars,
        steps: this.stepCount,
        replay: this.recorder?.finish(),
      },
    });
  }

  private fail(title: string, reason: string): void {
    this.setState('failed');
    this.events.push({ type: 'fail', title, reason });
  }

  private setState(s: SessionState): void {
    this.state = s;
    this.stateTime = 0;
  }
}
