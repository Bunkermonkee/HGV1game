/**
 * Level JSON → runtime YardLayout. Kept free of browser/Vite APIs so the
 * level checker (scripts/check-levels.ts) can use it under Node too.
 */
import { DEG } from '../core/math.ts';
import type {
  Bay,
  Building,
  Conditions,
  Marking,
  ObstacleDef,
  Spawn,
  StarTarget,
  TutorialTip,
  YardLayout,
} from '../game/yard.ts';

/** A row of bays generated along a dock face. */
export interface DockRow {
  /** Start of the row on the buffer line. */
  x: number;
  y: number;
  /** Direction the row runs in, degrees (0 = east). */
  along: number;
  /** Direction pointing out of each bay into the yard, degrees. */
  heading: number;
  count: number;
  width?: number;
  length?: number;
  /** Distance between bay centres along the row (default: width, adjusted for angled bays). */
  spacing?: number;
  firstLabel?: number;
  buffers?: boolean;
  /**
   * Give every bay its own dock "pod" (a short building block behind the
   * buffers) – needed for angled/sawtooth docks.
   */
  pods?: boolean;
}

/** One leg of the proof drive-out: see scripts/check-levels.ts. */
export interface DriveMove {
  /** +1 forward, -1 reverse. */
  throttle: 1 | -1;
  /** Steering target as a fraction of full lock (-1 left … +1 right). */
  steer: number;
  /** Metres travelled by the tractor rear axle. */
  dist: number;
}

export interface LevelFile {
  id: string;
  name: string;
  brief: string;
  width: number;
  height: number;
  buildings?: Building[];
  docks?: DockRow[];
  bays?: Bay[];
  targetBay: string;
  obstacles?: ObstacleDef[];
  markings?: Marking[];
  spawn: Spawn;
  stars: { three: StarTarget; two: StarTarget };
  conditions?: Conditions;
  tutorial?: TutorialTip[];
  /** Proof that the level is solvable: a drive OUT of the target bay to the spawn. */
  driveOut?: DriveMove[];
}

const POD_DEPTH = 2.4;

function expandDock(row: DockRow, pods: Building[]): Bay[] {
  const width = row.width ?? 3.8;
  const skew = Math.abs(Math.sin((row.heading - row.along) * DEG));
  const spacing = row.spacing ?? width / Math.max(0.3, skew);
  const ax = Math.cos(row.along * DEG);
  const ay = Math.sin(row.along * DEG);
  const hx = Math.cos(row.heading * DEG);
  const hy = Math.sin(row.heading * DEG);
  const bays: Bay[] = [];
  for (let i = 0; i < row.count; i++) {
    const x = row.x + ax * spacing * (i + 0.5);
    const y = row.y + ay * spacing * (i + 0.5);
    bays.push({
      x,
      y,
      heading: row.heading,
      width,
      length: row.length ?? 16,
      label: String((row.firstLabel ?? 1) + i),
      buffers: row.buffers ?? true,
    });
    if (row.pods) {
      const w = width + 0.6;
      const cx = x - hx * (POD_DEPTH / 2);
      const cy = y - hy * (POD_DEPTH / 2);
      pods.push({ x: cx - POD_DEPTH / 2, y: cy - w / 2, w: POD_DEPTH, h: w, angle: row.heading });
    }
  }
  return bays;
}

export function parseLevel(file: LevelFile, number: number): YardLayout {
  const buildings = [...(file.buildings ?? [])];
  const bays: Bay[] = [];
  for (const row of file.docks ?? []) bays.push(...expandDock(row, buildings));
  bays.push(...(file.bays ?? []));

  const target = bays.find((b) => b.label === file.targetBay);
  if (!target) throw new Error(`Level ${file.id}: target bay "${file.targetBay}" not found`);
  for (const b of bays) b.target = b === target;

  if (!(file.stars?.three && file.stars?.two)) throw new Error(`Level ${file.id}: missing star targets`);

  return {
    id: file.id,
    number,
    name: file.name,
    brief: file.brief,
    width: file.width,
    height: file.height,
    buildings,
    bays,
    obstacles: file.obstacles ?? [],
    markings: file.markings ?? [],
    spawn: file.spawn,
    stars: file.stars,
    conditions: file.conditions ?? {},
    tutorial: file.tutorial ?? [],
  };
}
