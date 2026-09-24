/**
 * Yard / level description. Plain data (metres, degrees) so levels can be
 * written as JSON files without code changes.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Bay {
  /** Centre of the bay's dock end (the building face / buffer line). */
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
  /** Whether this is the bay the player has to reverse onto. */
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

export interface YardLayout {
  id: string;
  name: string;
  width: number;
  height: number;
  buildings: Rect[];
  bays: Bay[];
  obstacles?: ObstacleDef[];
  spawn: Spawn;
  /** Finishing at all earns 1 star. 3 stars also needs zero contacts. */
  stars: { three: StarTarget; two: StarTarget };
}

/** Dock buffer geometry (bay frame: along = out of the bay, lateral = across). */
export const BUFFER = { depth: 0.28, width: 0.4, lateral: 0.95 };

function dockRow(count: number, firstX: number, dockY: number, width: number, targetIndex: number): Bay[] {
  return Array.from({ length: count }, (_, i) => ({
    x: firstX + width * (i + 0.5),
    y: dockY,
    heading: 90,
    width,
    length: 16,
    label: String(i + 1),
    target: i === targetIndex,
    buffers: true,
  }));
}

const PRACTICE_BAY_X0 = 36;
const BAY_W = 3.8;
const bayX = (n: number) => PRACTICE_BAY_X0 + BAY_W * (n - 0.5);

/** Practice yard: a row of dock bays, a few parked trailers, cones and bollards. */
export const PROTOTYPE_YARD: YardLayout = {
  id: 'practice',
  name: 'Practice Yard',
  width: 110,
  height: 80,
  buildings: [{ x: 0, y: 0, w: 110, h: 8 }],
  bays: dockRow(10, PRACTICE_BAY_X0, 8, BAY_W, 6),
  obstacles: [
    { kind: 'trailer-in-bay', bay: '4', colour: '#8a3b2f' },
    { kind: 'trailer-in-bay', bay: '10', colour: '#3c6b44' },
    { kind: 'trailer', x: 12, y: 62, heading: -90, colour: '#6b6f76' },
    { kind: 'trailer', x: 16, y: 62, heading: -90, colour: '#2f4f7a' },
    { kind: 'bollard', x: bayX(1) - BAY_W / 2, y: 8.4 },
    { kind: 'bollard', x: bayX(10) + BAY_W / 2, y: 8.4 },
    { kind: 'cone', x: bayX(6) + 1.3, y: 27 },
    { kind: 'cone', x: bayX(8) - 1.3, y: 27 },
    { kind: 'kerb', x: 92, y: 50, length: 10, width: 4 },
  ],
  spawn: { x: bayX(7), y: 34, heading: 90 },
  stars: {
    three: { shunts: 0, time: 45 },
    two: { shunts: 2, time: 90 },
  },
};
