/**
 * ALL vehicle tuning lives here. Every distance is in metres, every angle in
 * degrees, every speed in mph (converted internally), unless noted.
 *
 * Reference vehicle: UK right-hand-drive 4x2 tractor unit coupled to a
 * 13.6 m tri-axle curtainsider.
 */

/** World-to-screen scale before camera zoom: 1 metre = this many CSS pixels. */
export const PIXELS_PER_METRE = 10;

export const TRACTOR = {
  /** Front axle to rear (drive) axle. */
  wheelbase: 3.8,
  /** Front axle to front bumper. */
  frontOverhang: 1.45,
  /** Rear axle to the back of the chassis. */
  rearOverhang: 0.8,
  /** Overall body width (cab), mirrors excluded. */
  width: 2.5,
  /** Length of the cab, measured back from the front bumper. */
  cabLength: 2.35,
  /** Fifth wheel (coupling) position AHEAD of the rear axle. */
  fifthWheelAhead: 0.35,
  /** Wheel centre-to-centre across an axle. */
  track: 2.05,
  wheelDiameter: 1.0,
  wheelWidth: 0.32,
  /** How far each mirror head sticks out beyond the cab side. */
  mirrorReach: 0.32,
};

export const TRAILER = {
  length: 13.6,
  width: 2.55,
  /** Front of the trailer to the kingpin. */
  kingpinSetback: 1.2,
  /**
   * Kingpin to the centre of the tri-axle bogie. With three axles dragging,
   * the trailer's effective (virtual) rear pivot is the centre axle.
   */
  kingpinToBogie: 7.7,
  axleCount: 3,
  axleSpacing: 1.31,
  track: 2.05,
  wheelDiameter: 0.95,
  wheelWidth: 0.4,
};

export const STEERING = {
  /** Road-wheel lock angle (bicycle-model equivalent). */
  maxAngle: 35,
  /** How fast the road wheels can be turned, degrees/second (no snapping). */
  rate: 30,
  /**
   * Self-centring rate when steering is released, degrees/second at full
   * speed. Scaled by road speed – a stationary truck does not self-centre,
   * so drivers can "dry steer" to set the wheel before moving.
   */
  selfCentreForward: 14,
  /** Caster works against you in reverse, so it barely self-centres. */
  selfCentreReverse: 3,
  /** Speed (m/s) at which self-centring reaches the full rate above. */
  selfCentreFullSpeed: 2.0,
  /** Turns of the steering wheel from centre to full lock (HUD wheel only). */
  wheelTurnsToLock: 1.25,
  /** On-screen touch wheel: degrees of drag from centre to full lock (shorter than a real wheel). */
  touchWheelDegreesToLock: 270,
};

export const SPEED = {
  /** Governed maximums. */
  maxForwardMph: 8,
  maxReverseMph: 5,
  /** Acceleration with throttle held, m/s². */
  accel: 0.9,
  /** Service brake when pressing the opposite direction, m/s². */
  brake: 3.0,
  /** Natural slowdown with no pedal pressed (engine braking/rolling), m/s². */
  coastDecel: 0.7,
  /** Deceleration when the handbrake is applied while rolling, m/s². */
  handbrakeDecel: 4.0,
  /** Below this speed (m/s) the truck counts as stopped. */
  stoppedThreshold: 0.03,
};

export const ARTICULATION = {
  /** Hitch angle beyond which the rig is jackknifed – instant fail, but only when reversing. */
  jackknifeAngle: 80,
  /** Physical limit: the cab touches the trailer's front corner. */
  mechanicalStop: 90,
  /** HUD gauge turns amber / red at these angles. */
  warnAngle: 45,
  dangerAngle: 65,
};

export const SIMULATION = {
  /** Largest physics sub-step (seconds). Frames are split into equal sub-steps. */
  maxStep: 1 / 120,
};
