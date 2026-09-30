/**
 * Runtime yard / level description (metres, degrees). Level JSON files
 * (src/levels/*.json) are expanded into this shape by src/levels/parse.ts.
 */

/** Building footprint. x, y = top-left of the unrotated rect; `angle` rotates it about its centre. */
export interface Building {
  x: number;
  y: number;
  w: number;
  h: number;
  angle?: number;
}

export interface Bay {
  /** Centre of the bay's dock end (the buffer line). */
  x: number;
  y: number;
  /**
   * Direction pointing OUT of the bay into the yard, degrees (0 = +x/east,
   * 90 = +y/south on screen). A correctly parked trailer faces this way.
   */
  heading: number;
  width: number;
  length: number;
  label: string;
  /** The bay the player has to reverse onto. */
  target?: boolean;
  /** Rubber dock buffers at the dock end. */
  buffers?: boolean;
}

export type ObstacleDef =
  /** Traffic cone: soft – knocking one over counts as a contact but doesn't stop you. */
  | { kind: 'cone'; x: number; y: number }
  /** Steel bollard, 0.3 m square footprint. */
  | { kind: 'bollard'; x: number; y: number }
  /** Parked trailer: x, y is the centre of its rear; heading points to its front. */
  | { kind: 'trailer'; x: number; y: number; heading: number; colour?: string }
  /** Parked trailer sitting on a bay, against the buffers. */
  | { kind: 'trailer-in-bay'; bay: string; colour?: string }
  /** Wall or kerbed island: centre x, y, size along/across `angle` (degrees). */
  | { kind: 'wall' | 'kerb'; x: number; y: number; length: number; width: number; angle?: number };

/** Painted yard markings – decoration only. */
export type Marking =
  | { kind: 'text'; x: number; y: number; text: string; size?: number; angle?: number }
  | { kind: 'hatch'; x: number; y: number; w: number; h: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; colour?: 'white' | 'yellow'; dashed?: boolean };

export interface Spawn {
  /** Rear-centre of the trailer. */
  x: number;
  y: number;
  /** Trailer heading, degrees. */
  heading: number;
  /** Starting articulation, degrees. */
  articulation?: number;
}

export interface StarTarget {
  /** Maximum shunts. */
  shunts: number;
  /** Maximum total time in seconds, contact penalties included. */
  time: number;
}

export interface Conditions {
  /** Dark yard: only the truck's lights (and dim dock lamps) light the scene. */
  night?: boolean;
  /** Rain streaks, wet tarmac, fog and reduced grip on forward pull-ups. */
  rain?: boolean;
  /** Multiplier on acceleration and braking while moving forwards (rain ≈ 0.7). */
  forwardGrip?: number;
  /** Fog: metres of clear visibility around the truck. */
  visibility?: number;
}

export type TipTrigger = 'start' | 'reversing' | 'drift' | 'nearBay' | 'aligned' | 'shunt' | 'contact';

export interface TutorialTip {
  trigger: TipTrigger;
  /** {left} {right} {forward} {reverse} {handbrake} are replaced with the control names. */
  text: string;
}

export interface YardLayout {
  id: string;
  number: number;
  name: string;
  /** One or two sentences shown on the briefing card. */
  brief: string;
  width: number;
  height: number;
  buildings: Building[];
  bays: Bay[];
  obstacles: ObstacleDef[];
  markings: Marking[];
  spawn: Spawn;
  /** Finishing at all earns 1 star. 3 stars also needs zero contacts. */
  stars: { three: StarTarget; two: StarTarget };
  conditions: Conditions;
  tutorial: TutorialTip[];
}

/** Dock buffer geometry (bay frame: along = out of the bay, lateral = across). */
export const BUFFER = { depth: 0.28, width: 0.4, lateral: 0.95 };
