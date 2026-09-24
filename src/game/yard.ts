/**
 * Yard layout description. This shape will become the level JSON format, so
 * everything here is plain data (metres, degrees).
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
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
  /** Whether this is the bay the player has to reverse onto. */
  target?: boolean;
  /** Draw rubber dock buffers at the dock end. */
  buffers?: boolean;
}

export interface Spawn {
  /** Rear-centre of the trailer. */
  x: number;
  y: number;
  /** Trailer heading, degrees. */
  heading: number;
  /** Starting articulation, degrees. */
  articulation?: number;
}

export interface YardLayout {
  name: string;
  width: number;
  height: number;
  buildings: Rect[];
  bays: Bay[];
  spawn: Spawn;
}

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

/** Stage 1: one empty yard with a row of dock bays for handling practice. */
export const PROTOTYPE_YARD: YardLayout = {
  name: 'Practice Yard',
  width: 110,
  height: 80,
  buildings: [{ x: 0, y: 0, w: 110, h: 8 }],
  bays: dockRow(10, 36, 8, 3.8, 6),
  spawn: { x: 36 + 3.8 * 6.5, y: 34, heading: 90 },
};
