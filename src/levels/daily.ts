/**
 * Daily Yard: a new yard every day (UK date), the same for everyone.
 *
 * The date seeds a random generator that picks a yard type, bay, parked
 * trailers and weather. A layout is only accepted if a scripted drive OUT of
 * the target bay touches nothing with room to spare (see proof.ts); where
 * that drive-out ends becomes the spawn. If a candidate fails, the next
 * attempt is tried, so every day is guaranteed solvable.
 */
import type { DriveMove } from './parse.ts';
import type { Bay, Building, Conditions, ObstacleDef, YardLayout } from '../game/yard.ts';
import { runDriveOut } from './proof.ts';

const PREFIX = 'daily-';
const BAY_W = 3.8;
const DOCK_Y = 8;
const CLEARANCE = 0.25;
const COLOURS = ['#8a3b2f', '#3c6b44', '#6b6f76', '#2f4f7a', '#7a5c2f', '#5b3a6b', '#9a9a96'];

/** Today's date in the UK as YYYY-MM-DD (the Daily Yard changes at UK midnight). */
export function ukDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function dailyId(date = ukDate()): string {
  return PREFIX + date;
}

export function isDailyId(id: string): boolean {
  return /^daily-\d{4}-\d{2}-\d{2}$/.test(id);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Fri 25 Sep" – formatted by hand so every browser shows the same. */
export function dailyLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Small, fast, seedable PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

type Kind = 'straight' | 'ninety' | 'angled' | 'tight';

interface Candidate {
  layout: YardLayout;
  moves: DriveMove[];
  kind: Kind;
  side: 'sight' | 'blind' | 'straight';
}

/** Round to 0.01 so tiny differences between browsers can't change the layout. */
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The day's yard type and side are fixed by the date; only the details vary between attempts. */
function dayPlan(date: string): { kind: Kind; turn: number } {
  const rand = rng(hash(date));
  const kinds: Kind[] = ['straight', 'ninety', 'ninety', 'angled', 'tight'];
  const kind = kinds[Math.floor(rand() * kinds.length)];
  // Driving OUT with a right turn = the player reverses in on the sight (driver's) side.
  return { kind, turn: rand() < 0.5 ? 1 : -1 };
}

function candidate(date: string, attempt: number, kind: Kind, turn: number): Candidate {
  const rand = rng(hash(`${date}#${attempt}`));
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const range = (a: number, b: number) => r2(a + rand() * (b - a));
  const side = kind === 'straight' ? 'straight' : turn > 0 ? 'sight' : 'blind';

  const width = 90;
  const depth = kind === 'tight' ? range(38, 42) : kind === 'straight' ? 56 : kind === 'angled' ? 56 : range(44, 52);
  const count = kind === 'angled' ? 8 : 12;
  const heading = kind === 'angled' ? (turn > 0 ? 45 : 135) : 90;
  const dockY = kind === 'angled' ? 12 : DOCK_Y;
  const spacing = kind === 'angled' ? BAY_W / Math.sin(Math.PI / 4) : BAY_W;
  const x0 = r2((width - spacing * count) / 2);

  // A right turn out heads west, so the bay needs room on its west side (and vice versa).
  let targetIdx: number;
  if (kind === 'straight') targetIdx = 2 + Math.floor(rand() * (count - 4));
  else if (turn > 0) targetIdx = Math.floor(count / 2) + Math.floor(rand() * (count / 2 - 1));
  else targetIdx = 1 + Math.floor(rand() * (count / 2 - 1));

  const bays: Bay[] = [];
  const buildings: Building[] = [{ x: 0, y: 0, w: width, h: kind === 'angled' ? 8.4 : DOCK_Y }];
  for (let i = 0; i < count; i++) {
    const x = x0 + spacing * (i + 0.5);
    bays.push({ x: r2(x), y: dockY, heading, width: BAY_W, length: 16, label: String(i + 1), buffers: true, target: i === targetIdx });
    if (kind === 'angled') {
      const hr = (heading * Math.PI) / 180;
      const cx = x - Math.cos(hr) * 1.2;
      const cy = dockY - Math.sin(hr) * 1.2;
      buildings.push({ x: r2(cx - 1.2), y: r2(cy - (BAY_W + 0.6) / 2), w: 2.4, h: BAY_W + 0.6, angle: heading });
    }
  }

  // Parked trailers: neighbours often, the rest now and then.
  const obstacles: ObstacleDef[] = [];
  const busy = kind === 'tight' || kind === 'straight' ? 0.65 : 0.4;
  for (let i = 0; i < count; i++) {
    if (i === targetIdx) continue;
    const neighbour = Math.abs(i - targetIdx) === 1;
    if (rand() < (neighbour ? busy + 0.15 : 0.3)) obstacles.push({ kind: 'trailer-in-bay', bay: String(i + 1), colour: pick(COLOURS) });
  }
  // A line of cones across part of the yard on some days.
  if (kind !== 'tight' && rand() < 0.35) {
    const y = r2(depth - range(4, 7));
    const from = rand() < 0.5 ? 4 : width / 2 + 4;
    for (let x = from; x < from + width / 2 - 8; x += 4) obstacles.push({ kind: 'cone', x: r2(x), y });
  }

  const conditions: Conditions = {};
  const weather = rand();
  if (weather < 0.15) conditions.night = true;
  else if (weather < 0.3) Object.assign(conditions, { rain: true, forwardGrip: 0.7, visibility: 30 });

  // Drive-out route for this kind of yard.
  const s = turn;
  let moves: DriveMove[];
  if (kind === 'straight') {
    const lat = range(0.12, 0.25) * (rand() < 0.5 ? 1 : -1);
    moves = [
      { throttle: 1, steer: 0, dist: range(13, 15) },
      { throttle: 1, steer: lat, dist: range(3, 4) },
      { throttle: 1, steer: -lat, dist: range(3, 4) },
      { throttle: 1, steer: 0, dist: range(2, 4) },
    ];
  } else if (kind === 'ninety') {
    moves = [
      { throttle: 1, steer: 0, dist: range(7, 9) },
      { throttle: 1, steer: s * range(0.55, 0.66), dist: range(15.5, 17.5) },
      { throttle: 1, steer: 0, dist: range(12, 16) },
    ];
  } else if (kind === 'angled') {
    moves = [
      { throttle: 1, steer: 0, dist: range(11, 13) },
      { throttle: 1, steer: s * range(0.4, 0.5), dist: range(8, 10) },
      { throttle: 1, steer: 0, dist: range(10, 13) },
    ];
  } else {
    const lock = range(0.9, 1);
    moves = [
      { throttle: 1, steer: 0, dist: range(6, 8) },
      { throttle: 1, steer: s * lock, dist: range(4.5, 5.5) },
      { throttle: -1, steer: s * lock, dist: range(5, 6.5) },
      { throttle: 1, steer: s * lock, dist: range(6.5, 7.5) },
      { throttle: 1, steer: -s * range(0.8, 0.95), dist: range(4.5, 5.5) },
      { throttle: 1, steer: 0, dist: range(7, 9) },
    ];
  }

  const target = bays[targetIdx];
  const layout: YardLayout = {
    id: PREFIX + date,
    number: 0,
    name: `Daily Yard – ${dailyLabel(date)}`,
    brief: '',
    width,
    height: depth,
    buildings,
    bays,
    obstacles,
    markings: [],
    spawn: { x: target.x, y: 30, heading: 90 },
    stars: { three: { shunts: 0, time: 60 }, two: { shunts: 2, time: 110 } },
    conditions,
    tutorial: [],
  };
  return { layout, moves, kind, side };
}

function describe(c: Candidate, shunts: number): string {
  const bay = c.layout.bays.find((b) => b.target)!.label;
  const what =
    c.kind === 'straight'
      ? `Straight back onto Bay ${bay}`
      : c.kind === 'angled'
        ? `A 45° sawtooth bay – Bay ${bay}, ${c.side} side`
        : c.kind === 'tight'
          ? `A tight ${c.side}-side reverse onto Bay ${bay} – expect ${shunts === 1 ? 'a shunt' : 'shunts'}`
          : `A 90° ${c.side}-side reverse onto Bay ${bay}`;
  const cond = c.layout.conditions;
  const weather = cond.night ? ' In the dark.' : cond.rain ? ' In the rain.' : '';
  return `${what}.${weather} Same yard for everyone today – see where you rank by midnight.`;
}

const cache = new Map<string, YardLayout>();

/** The Daily Yard for a UK date (YYYY-MM-DD). */
export function generateDaily(date: string): YardLayout {
  const hit = cache.get(date);
  if (hit) return hit;
  let chosen: YardLayout | null = null;
  const plan = dayPlan(date);
  for (let attempt = 0; attempt < 60 && !chosen; attempt++) {
    // If the day's type keeps failing, fall back to a plain 90° yard.
    const kind = attempt < 40 ? plan.kind : 'ninety';
    const c = candidate(date, attempt, kind, plan.turn);
    const proof = runDriveOut(c.layout, c.moves, CLEARANCE);
    if (!proof.ok) continue;
    const end = proof.end;
    // The spawn must be on the tarmac with the whole rig in the yard.
    if (end.x < 3 || end.x > c.layout.width - 3 || end.y < DOCK_Y + 3 || end.y > c.layout.height - 3) continue;
    const three = Math.ceil((proof.pathLength / 1.2 + 6 * (proof.shunts + 1) + 8) / 5) * 5;
    chosen = {
      ...c.layout,
      spawn: end,
      stars: { three: { shunts: proof.shunts, time: three }, two: { shunts: proof.shunts + 2, time: Math.ceil((three * 1.8) / 5) * 5 } },
      brief: describe(c, proof.shunts),
    };
  }
  if (!chosen) throw new Error(`No Daily Yard could be generated for ${date}`);
  cache.set(date, chosen);
  return chosen;
}
