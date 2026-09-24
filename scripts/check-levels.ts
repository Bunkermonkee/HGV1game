/**
 * Level checker – run with `npm run check-levels` (Node 22.6+).
 *
 * For every src/levels/*.json it:
 *  1. parses it (target bay exists, star targets present),
 *  2. checks the spawn position and the parked position are clear of obstacles,
 *  3. replays the level's `driveOut` proof: starting parked on the target bay,
 *     it drives OUT along the listed moves and must not touch anything.
 *     The vehicle model is time-reversible, so a clean drive-out proves the
 *     reverse-in exists. The drive-out must finish at the level's spawn.
 *
 * `npm run check-levels -- --write` copies each drive-out's end position into
 * the level's `spawn`, which is the easy way to author a new level.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARTICULATION } from '../src/config/vehicle.ts';
import { DEG } from '../src/core/math.ts';
import { Session } from '../src/game/session.ts';
import { BUFFER } from '../src/game/yard.ts';
import { parseLevel, type LevelFile } from '../src/levels/parse.ts';
import { obbOverlap } from '../src/physics/sat.ts';

const DIR = join(import.meta.dirname, '../src/levels');
const WRITE = process.argv.includes('--write');
const DT = 1 / 120;
const POS_TOL = 0.3;
const ANGLE_TOL = 2;

/** One-line JSON with a space after each colon and comma. */
function inline(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
  if (v && typeof v === 'object') {
    const e = Object.entries(v as Record<string, unknown>).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`);
    return `{ ${e.join(', ')} }`;
  }
  return JSON.stringify(v);
}

/** Compact JSON: short objects/arrays stay on one line. */
function pretty(v: unknown, indent = ''): string {
  const flat = inline(v);
  if (flat.length + indent.length <= 100 || v === null || typeof v !== 'object') return flat;
  const next = indent + '  ';
  if (Array.isArray(v)) return `[\n${v.map((x) => next + pretty(x, next)).join(',\n')}\n${indent}]`;
  const entries = Object.entries(v as Record<string, unknown>).map(
    ([k, x]) => `${next}${JSON.stringify(k)}: ${pretty(x, next)}`,
  );
  return `{\n${entries.join(',\n')}\n${indent}}`;
}

function overlapsAnything(s: Session): string | null {
  const t = s.artic.tractorBox;
  const r = s.artic.trailerBox;
  for (const o of s.obstacles) {
    if (obbOverlap(t, o.box) || obbOverlap(r, o.box)) return o.kind;
  }
  return null;
}

let failures = 0;
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

files.forEach((name, i) => {
  const path = join(DIR, name);
  const file = JSON.parse(readFileSync(path, 'utf8')) as LevelFile;
  const problems: string[] = [];
  const notes: string[] = [];
  let yard;
  try {
    yard = parseLevel(file, i + 1);
  } catch (e) {
    console.log(`✗ ${name}: ${(e as Error).message}`);
    failures++;
    return;
  }

  const s = new Session(yard);
  const hitAtSpawn = overlapsAnything(s);
  if (hitAtSpawn) problems.push(`spawn overlaps a ${hitAtSpawn}`);

  // Parked on the target bay, against the buffers.
  const bay = s.bay;
  const a = bay.heading * DEG;
  const gap = (bay.buffers ? BUFFER.depth : 0) + 0.05;
  s.artic.resetFromTrailerRear(bay.x + Math.cos(a) * gap, bay.y + Math.sin(a) * gap, a, 0);
  const hitParked = overlapsAnything(s);
  if (hitParked) problems.push(`parked position on bay ${bay.label} overlaps a ${hitParked}`);

  if (file.driveOut?.length && !hitParked) {
    let pathLength = 0;
    let ok = true;
    // The player drives the route backwards with forward/reverse swapped:
    // a shunt is each forward leg after their first reversing leg.
    const playerLegs = [...file.driveOut].reverse().map((m) => -m.throttle);
    const firstReverse = playerLegs.indexOf(-1);
    const shunts = playerLegs.filter((t, k) => t === 1 && k > firstReverse && playerLegs[k - 1] !== 1).length;
    const moves = [...file.driveOut, null];
    for (const m of moves) {
      const input = m
        ? { steerMode: 'absolute' as const, steer: m.steer, throttle: m.throttle }
        : { steerMode: 'absolute' as const, steer: file.driveOut[file.driveOut.length - 1].steer, throttle: 0 };
      // Finish with the handbrake so the rig stops within a couple of metres.
      if (!m && !s.artic.handbrake) s.toggleHandbrake();
      let d = 0;
      for (let t = 0; t < 120; t += DT) {
        s.step(DT, input);
        d += Math.abs(s.artic.speed) * DT;
        if (s.state !== 'driving' || s.contacts > 0) {
          const ev = s.takeEvents().find((e) => e.type === 'fail' || e.type === 'contact');
          problems.push(`drive-out hit trouble: ${JSON.stringify(ev)}`);
          ok = false;
          break;
        }
        if (m ? d >= m.dist : s.artic.stopped) break;
      }
      pathLength += d;
      if (!ok) break;
    }
    if (ok) {
      const r = s.artic.trailerRear;
      const end = {
        x: +r.x.toFixed(2),
        y: +r.y.toFixed(2),
        heading: +((s.artic.trailerHeading / DEG + 360) % 360).toFixed(1),
        articulation: +(s.artic.articulation / DEG).toFixed(1),
      };
      const sp = file.spawn;
      const dPos = Math.hypot(end.x - sp.x, end.y - sp.y);
      const dHead = Math.abs(((end.heading - sp.heading + 540) % 360) - 180);
      const dArt = Math.abs(end.articulation - (sp.articulation ?? 0));
      if (WRITE) {
        file.spawn = end;
        writeFileSync(path, pretty(file) + '\n');
        notes.push(`spawn written: ${JSON.stringify(end)}`);
      } else if (dPos > POS_TOL || dHead > ANGLE_TOL || dArt > ANGLE_TOL) {
        problems.push(`drive-out ends at ${JSON.stringify(end)}, not the spawn`);
      }
      if (Math.abs(end.articulation) > ARTICULATION.warnAngle) notes.push('spawn articulation is large');
      // Reversing is slower than the drive-out and needs corrections: rough guide only.
      const est = pathLength / 1.2 + 6 * (shunts + 1);
      notes.push(
        `route ${pathLength.toFixed(0)} m, ${shunts} shunt(s); rough 3★ time ≈ ${Math.ceil(est / 5) * 5}s` +
          ` (level says ${file.stars.three.time}s / ${file.stars.three.shunts} shunts)`,
      );
    }
  } else if (!file.driveOut?.length) {
    notes.push('no driveOut proof');
  }

  if (problems.length) failures++;
  console.log(`${problems.length ? '✗' : '✓'} ${name} – ${yard.name}`);
  for (const p of problems) console.log(`    problem: ${p}`);
  for (const n of notes) console.log(`    ${n}`);
});

if (failures) {
  console.log(`\n${failures} level(s) with problems`);
  process.exit(1);
}
