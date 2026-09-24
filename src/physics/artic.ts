/**
 * Articulated lorry kinematics: tractor unit + semi-trailer.
 *
 * Coordinate system: world metres, x right, y DOWN (canvas convention).
 * Headings are radians; a positive yaw rate turns clockwise on screen, i.e. a
 * right turn when driving forwards. In a body frame, +x points forwards and
 * +y points to the vehicle's RIGHT (the driver's side on a UK RHD truck).
 *
 * Tractor – kinematic bicycle model about the rear (drive) axle:
 *   ẋ = v cos θ,  ẏ = v sin θ,  θ̇ = v tan δ / L
 *
 * Trailer – standard off-axle-hitch kinematic model. The fifth wheel sits a
 * distance `a` AHEAD of the tractor rear axle; the trailer pivots about its
 * virtual axle (centre of the tri-axle bogie) a distance L₂ behind the kingpin:
 *   ψ̇ = [ v sin(θ − ψ) + a θ̇ cos(θ − ψ) ] / L₂
 *
 * The articulation (hitch) angle is φ = θ − ψ. Reversing makes φ = 0 an
 * unstable equilibrium, which is exactly why the trailer swings the opposite
 * way to the steering and has to be "caught" – just like the real thing.
 */
import { ARTICULATION, SPEED, STEERING, TRACTOR, TRAILER } from '../config/vehicle.ts';
import { DEG, MPH_TO_MS, approach, clamp, wrapAngle, type Vec2 } from '../core/math.ts';
import { obbFromFrame, type OBB } from './geometry.ts';

export type Gear = 'D' | 'R' | 'N';

export interface DriveInput {
  /**
   * 'rate'     – keyboard/buttons: `steer` in [-1, 1] turns the wheel at the
   *              configured rate; 0 means "hands off" (self-centring applies).
   * 'absolute' – touch wheel / analogue stick: `steer` in [-1, 1] is the
   *              desired fraction of full lock; the wheels chase it at the
   *              same limited rate.
   */
  steerMode: 'rate' | 'absolute';
  steer: number;
  /** +1 forward pedal, -1 reverse pedal, 0 neither. */
  throttle: number;
}

/** Per-level/weather modifiers (e.g. rain). */
export interface Conditions {
  /** Multiplier on acceleration and braking while moving forwards. */
  forwardGrip: number;
}

export const DEFAULT_CONDITIONS: Conditions = { forwardGrip: 1 };

export type ArticEvent = 'gear-forward' | 'gear-reverse' | 'jackknife';

export interface ArticSnapshot {
  x: number;
  y: number;
  heading: number;
  trailerHeading: number;
  speed: number;
  jackknifed: boolean;
}

const L1 = TRACTOR.wheelbase;
const A = TRACTOR.fifthWheelAhead;
const L2 = TRAILER.kingpinToBogie;
const MAX_STEER = STEERING.maxAngle * DEG;
const V_FWD = SPEED.maxForwardMph * MPH_TO_MS;
const V_REV = SPEED.maxReverseMph * MPH_TO_MS;

export class Artic {
  /** Tractor rear-axle centre. */
  x = 0;
  y = 0;
  /** Tractor heading θ. */
  heading = 0;
  /** Trailer heading ψ. */
  trailerHeading = 0;
  /** Signed longitudinal speed of the tractor rear axle, m/s (+ forwards). */
  speed = 0;
  /** Bicycle-model road-wheel angle δ (radians, + = right). */
  steer = 0;
  gear: Gear = 'N';
  handbrake = false;
  jackknifed = false;
  /** True while a pedal is pushing against the direction of travel. */
  braking = false;
  /** Set when the driver presses a pedal with the handbrake on. */
  handbrakeNag = false;

  conditions: Conditions = DEFAULT_CONDITIONS;

  private events: ArticEvent[] = [];

  reset(x: number, y: number, heading: number, articulationDeg = 0): void {
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.trailerHeading = heading - articulationDeg * DEG;
    this.speed = 0;
    this.steer = 0;
    this.gear = 'N';
    this.handbrake = false;
    this.jackknifed = false;
    this.braking = false;
    this.handbrakeNag = false;
    this.events.length = 0;
  }

  /**
   * Place the rig so the REAR of the trailer is at (rx, ry), with the trailer
   * pointing along `trailerHeading` and a given articulation. Handy for level
   * spawns, which are easier to author from the trailer's position.
   */
  resetFromTrailerRear(rx: number, ry: number, trailerHeading: number, articulationDeg = 0): void {
    const toKingpin = TRAILER.length - TRAILER.kingpinSetback;
    const kx = rx + Math.cos(trailerHeading) * toKingpin;
    const ky = ry + Math.sin(trailerHeading) * toKingpin;
    const heading = trailerHeading + articulationDeg * DEG;
    this.reset(kx - Math.cos(heading) * A, ky - Math.sin(heading) * A, heading, articulationDeg);
  }

  /** Articulation angle φ = θ − ψ, wrapped to (-π, π]. Positive = trailer on the tractor's RIGHT (inside of a forward right turn). */
  get articulation(): number {
    return wrapAngle(this.heading - this.trailerHeading);
  }

  get stopped(): boolean {
    return Math.abs(this.speed) < SPEED.stoppedThreshold;
  }

  /** Pose + speed, so a colliding physics step can be undone. */
  snapshot(): ArticSnapshot {
    return {
      x: this.x,
      y: this.y,
      heading: this.heading,
      trailerHeading: this.trailerHeading,
      speed: this.speed,
      jackknifed: this.jackknifed,
    };
  }

  restore(s: ArticSnapshot): void {
    this.x = s.x;
    this.y = s.y;
    this.heading = s.heading;
    this.trailerHeading = s.trailerHeading;
    this.speed = s.speed;
    this.jackknifed = s.jackknifed;
  }

  /** Drain events raised since the last call (gear changes, jackknife). */
  takeEvents(): ArticEvent[] {
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }

  step(dt: number, input: DriveInput): void {
    if (this.jackknifed) {
      this.speed = approach(this.speed, 0, SPEED.handbrakeDecel * 2 * dt);
      return;
    }
    this.updateSteering(dt, input);
    this.updateSpeed(dt, input);
    this.integrate(dt);

    if (Math.abs(this.articulation) > ARTICULATION.jackknifeAngle * DEG) {
      this.jackknifed = true;
      this.events.push('jackknife');
    }
  }

  private updateSteering(dt: number, input: DriveInput): void {
    const maxDelta = STEERING.rate * DEG * dt;
    const s = clamp(input.steer, -1, 1);
    if (input.steerMode === 'absolute') {
      this.steer = approach(this.steer, s * MAX_STEER, maxDelta);
    } else if (s !== 0) {
      this.steer = clamp(this.steer + s * maxDelta, -MAX_STEER, MAX_STEER);
    } else {
      const rate = this.speed >= 0 ? STEERING.selfCentreForward : STEERING.selfCentreReverse;
      const speedFactor = Math.min(1, Math.abs(this.speed) / STEERING.selfCentreFullSpeed);
      this.steer = approach(this.steer, 0, rate * DEG * speedFactor * dt);
    }
  }

  private updateSpeed(dt: number, input: DriveInput): void {
    const t = Math.sign(input.throttle);
    const grip = this.speed > 0 || (this.speed === 0 && t > 0) ? this.conditions.forwardGrip : 1;
    this.braking = false;
    this.handbrakeNag = this.handbrake && t !== 0;

    if (this.handbrake) {
      this.speed = approach(this.speed, 0, SPEED.handbrakeDecel * grip * dt);
      return;
    }

    if (t === 0) {
      this.speed = approach(this.speed, 0, SPEED.coastDecel * dt);
      return;
    }

    // Pedal against the direction of travel: brake to a stop first.
    if (this.speed * t < -SPEED.stoppedThreshold) {
      this.braking = true;
      this.speed = approach(this.speed, 0, SPEED.brake * grip * dt);
      if (Math.abs(this.speed) < SPEED.stoppedThreshold) this.speed = 0;
      return;
    }

    // Stopped (or already rolling the right way): select the gear and drive.
    const wanted: Gear = t > 0 ? 'D' : 'R';
    if (this.gear !== wanted) {
      this.gear = wanted;
      this.events.push(t > 0 ? 'gear-forward' : 'gear-reverse');
    }
    const vmax = t > 0 ? V_FWD : V_REV;
    const target = t * vmax;
    // Ease off near the governor so the top speed is approached smoothly.
    const headroom = clamp((vmax - Math.abs(this.speed)) / (vmax * 0.25), 0.15, 1);
    this.speed = approach(this.speed, target, SPEED.accel * grip * headroom * dt);
  }

  private integrate(dt: number): void {
    const v = this.speed;
    const theta = this.heading;
    const phi = theta - this.trailerHeading;
    const yawRate = (v * Math.tan(this.steer)) / L1;
    const trailerYawRate = (v * Math.sin(phi) + A * yawRate * Math.cos(phi)) / L2;

    // Midpoint heading for the translation keeps arcs accurate at any step size.
    const midTheta = theta + yawRate * dt * 0.5;
    this.x += v * Math.cos(midTheta) * dt;
    this.y += v * Math.sin(midTheta) * dt;
    this.heading = wrapAngle(theta + yawRate * dt);
    this.trailerHeading = wrapAngle(this.trailerHeading + trailerYawRate * dt);
  }

  // ---- Derived geometry -------------------------------------------------

  /** Fifth wheel / kingpin position. */
  get hitch(): Vec2 {
    return {
      x: this.x + Math.cos(this.heading) * A,
      y: this.y + Math.sin(this.heading) * A,
    };
  }

  get frontAxle(): Vec2 {
    return {
      x: this.x + Math.cos(this.heading) * L1,
      y: this.y + Math.sin(this.heading) * L1,
    };
  }

  /** Centre of the trailer bogie (the trailer's effective pivot). */
  get trailerAxle(): Vec2 {
    const h = this.hitch;
    return {
      x: h.x - Math.cos(this.trailerHeading) * L2,
      y: h.y - Math.sin(this.trailerHeading) * L2,
    };
  }

  /** Centre of the trailer's rear edge. */
  get trailerRear(): Vec2 {
    const h = this.hitch;
    const d = TRAILER.length - TRAILER.kingpinSetback;
    return {
      x: h.x - Math.cos(this.trailerHeading) * d,
      y: h.y - Math.sin(this.trailerHeading) * d,
    };
  }

  get tractorBox(): OBB {
    return obbFromFrame(
      this,
      this.heading,
      -TRACTOR.rearOverhang,
      L1 + TRACTOR.frontOverhang,
      TRACTOR.width / 2,
    );
  }

  get trailerBox(): OBB {
    return obbFromFrame(
      this.hitch,
      this.trailerHeading,
      -(TRAILER.length - TRAILER.kingpinSetback),
      TRAILER.kingpinSetback,
      TRAILER.width / 2,
    );
  }

  /** Current turning radius of the tractor rear axle (Infinity when straight). */
  get turningRadius(): number {
    const t = Math.tan(this.steer);
    return Math.abs(t) < 1e-6 ? Infinity : L1 / Math.abs(t);
  }
}
