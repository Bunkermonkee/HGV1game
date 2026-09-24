/**
 * One attempt at a yard: drives the physics, resolves collisions, counts
 * time / shunts / contacts and decides success or failure.
 */
import { RULES } from '../config/rules.ts';
import { DEG, MPH_TO_MS } from '../core/math.ts';
import { Artic, type DriveInput } from '../physics/artic.ts';
import { inflate, obbOverlap } from '../physics/sat.ts';
import { bayProblem, checkBay, type BayCheck } from './bay.ts';
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
}

export type SessionEvent =
  | { type: 'contact'; label: string }
  | { type: 'buffers' }
  | { type: 'message'; text: string }
  | { type: 'fail'; title: string; reason: string }
  | { type: 'success'; result: RunResult };

const NO_INPUT: DriveInput = { steerMode: 'rate', steer: 0, throttle: 0 };
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

  private started = false;
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
    this.artic.conditions = { forwardGrip: this.yard.conditions.forwardGrip ?? 1 };
    this.reverseDistance = 0;
    this.obstacles = buildObstacles(this.yard);
    this.state = 'driving';
    this.stateTime = 0;
    this.time = 0;
    this.shunts = 0;
    this.contacts = 0;
    this.started = false;
    this.hasReversed = false;
    this.handbrakeJudged = false;
    this.overWarned = false;
    this.touching.clear();
    this.events.length = 0;
    this.bayCheck = checkBay(this.artic, this.bay);
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
  }

  step(dt: number, input: DriveInput): void {
    this.stateTime += dt;
    if (this.state !== 'driving') {
      this.artic.step(dt, NO_INPUT);
      return;
    }

    const before = this.artic.snapshot();
    this.artic.step(dt, input);
    let articEvents = this.artic.takeEvents();

    if (this.resolveCollisions(Math.abs(before.speed))) {
      this.artic.restore(before);
      this.artic.speed = 0;
      articEvents = articEvents.filter((e) => e !== 'jackknife');
    }
    if (this.state !== 'driving') return;

    for (const e of articEvents) {
      if (e === 'gear-reverse') {
        this.hasReversed = true;
        this.started = true;
      } else if (e === 'gear-forward') {
        if (this.hasReversed) this.shunts++;
        this.started = true;
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

    if (this.started) this.time += dt;
    if (this.artic.speed < 0) this.reverseDistance -= this.artic.speed * dt;

    this.bayCheck = checkBay(this.artic, this.bay);
    this.judgeParking();
  }

  /**
   * Test both bodies against every obstacle. Returns true if the step has to
   * be undone because the truck hit something solid.
   */
  private resolveCollisions(impactSpeed: number): boolean {
    const tractor = this.artic.tractorBox;
    const trailer = this.artic.trailerBox;
    let blocked = false;
    let worst: { o: Obstacle; hard: boolean } | null = null;
    let buffered = false;

    for (const o of this.obstacles) {
      if (o.soft && o.hit) continue;
      const hitTractor = obbOverlap(tractor, o.box);
      const hitTrailer = obbOverlap(trailer, o.box);
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
          `You hit the ${OBSTACLE_NAMES[worst.o.kind]} at ${mph} mph. Anything over ${RULES.contact.hardSpeedMph} mph means a claim form and a chat with the transport manager.`,
        );
      } else {
        this.addContact(worst.o);
      }
    }

    // Forget contacts once a small gap has opened up again.
    if (this.touching.size) {
      const t = inflate(this.artic.tractorBox, RULES.contact.releaseMargin);
      const r = inflate(this.artic.trailerBox, RULES.contact.releaseMargin);
      for (const o of this.touching) {
        if (!obbOverlap(t, o.box) && !obbOverlap(r, o.box)) this.touching.delete(o);
      }
    }
    return blocked;
  }

  private addContact(o: Obstacle): void {
    this.contacts++;
    this.events.push({ type: 'contact', label: OBSTACLE_NAMES[o.kind] });
  }

  private judgeParking(): void {
    const a = this.artic;
    if (!a.handbrake || !a.stopped) return;
    if (this.bayCheck.ok) {
      this.succeed();
    } else if (!this.handbrakeJudged && this.started) {
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
