/** Turns yard data into collision obstacles (oriented boxes). */
import { TRAILER } from '../config/vehicle.ts';
import { DEG } from '../core/math.ts';
import { obbFromFrame, type OBB } from '../physics/geometry.ts';
import { banksmanBox } from './banksman.ts';
import { BUFFER, type YardLayout } from './yard.ts';

export type ObstacleKind = 'wall' | 'kerb' | 'cone' | 'bollard' | 'trailer' | 'buffer' | 'person' | 'vehicle';

export interface Obstacle {
  kind: ObstacleKind;
  box: OBB;
  /** Soft obstacles (cones) get knocked over instead of stopping the truck. */
  soft: boolean;
  /** Knocked over (cones only). */
  hit: boolean;
  /** Parked trailers: paint colour. */
  colour?: string;
  /** Part of a building (drawn with the yard, not as an obstacle). */
  building?: boolean;
  /** Name used in messages, when more specific than the kind (e.g. "forklift"). */
  label?: string;
}

/** What the driver hit, for the fail message. */
export const OBSTACLE_NAMES: Record<ObstacleKind, string> = {
  wall: 'warehouse wall',
  kerb: 'kerb',
  cone: 'cone',
  bollard: 'bollard',
  trailer: 'parked trailer',
  buffer: 'dock buffers',
  person: 'banksman',
  vehicle: 'vehicle',
};

const CONE = 0.22;
const BOLLARD = 0.15;
const KERB_THICKNESS = 0.5;

function box(cx: number, cy: number, halfLength: number, halfWidth: number, angle = 0): OBB {
  return { cx, cy, halfLength, halfWidth, angle };
}

function parkedTrailerBox(rx: number, ry: number, heading: number): OBB {
  return obbFromFrame({ x: rx, y: ry }, heading, 0, TRAILER.length, TRAILER.width / 2);
}

function make(kind: ObstacleKind, b: OBB, colour?: string): Obstacle {
  return { kind, box: b, soft: kind === 'cone', hit: false, colour };
}

export function buildObstacles(yard: YardLayout): Obstacle[] {
  const out: Obstacle[] = [];

  for (const r of yard.buildings) {
    const wall = make('wall', box(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, (r.angle ?? 0) * DEG));
    wall.building = true;
    out.push(wall);
  }

  // Yard boundary kerbs, just outside the tarmac.
  const t = KERB_THICKNESS / 2;
  const { width: W, height: H } = yard;
  out.push(make('kerb', box(W / 2, -t, W / 2 + 2 * t, t)));
  out.push(make('kerb', box(W / 2, H + t, W / 2 + 2 * t, t)));
  out.push(make('kerb', box(-t, H / 2, t, H / 2)));
  out.push(make('kerb', box(W + t, H / 2, t, H / 2)));

  for (const bay of yard.bays) {
    if (!bay.buffers) continue;
    const a = bay.heading * DEG;
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (const side of [-1, 1]) {
      const along = BUFFER.depth / 2;
      const lat = side * BUFFER.lateral;
      out.push(
        make('buffer', box(bay.x + c * along - s * lat, bay.y + s * along + c * lat, BUFFER.depth / 2, BUFFER.width / 2, a)),
      );
    }
  }

  const target = yard.bays.find((b) => b.target);
  if (yard.banksman && target) out.push(make('person', banksmanBox(target, yard.banksman)));

  for (const o of yard.obstacles ?? []) {
    switch (o.kind) {
      case 'cone':
        out.push(make('cone', box(o.x, o.y, CONE, CONE)));
        break;
      case 'bollard':
        out.push(make('bollard', box(o.x, o.y, BOLLARD, BOLLARD)));
        break;
      case 'trailer':
        out.push(make('trailer', parkedTrailerBox(o.x, o.y, o.heading * DEG), o.colour));
        break;
      case 'trailer-in-bay': {
        const bay = yard.bays.find((b) => b.label === o.bay);
        if (!bay) break;
        const a = bay.heading * DEG;
        const gap = (bay.buffers ? BUFFER.depth : 0) + 0.05;
        out.push(make('trailer', parkedTrailerBox(bay.x + Math.cos(a) * gap, bay.y + Math.sin(a) * gap, a), o.colour));
        break;
      }
      case 'wall':
      case 'kerb':
        out.push(make(o.kind, box(o.x, o.y, o.length / 2, o.width / 2, (o.angle ?? 0) * DEG)));
        break;
    }
  }
  return out;
}
