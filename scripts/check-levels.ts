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
import { RULES } from '../src/config/rules.ts';
import { ARTICULATION } from '../src/config/vehicle.ts';
import { Session } from '../src/game/session.ts';
import { parseLevel, type LevelFile } from '../src/levels/parse.ts';
import { parkOnBay, rigOverlaps, runDriveOut, runSoloDriveOut } from '../src/levels/proof.ts';

const DIR = join(import.meta.dirname, '../src/levels');
const WRITE = process.argv.includes('--write');
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
  const hitAtSpawn = rigOverlaps(s);
  if (hitAtSpawn) problems.push(`spawn overlaps a ${hitAtSpawn}`);
  parkOnBay(s);
  const hitParked = rigOverlaps(s);
  if (hitParked) problems.push(`parked position on bay ${s.bay.label} overlaps a ${hitParked}`);

  if (file.driveOut?.length && !hitParked) {
    const proof = runDriveOut(yard, file.driveOut);
    if (!proof.ok) {
      problems.push(proof.problem ?? 'drive-out failed');
    } else {
      const end = proof.end;
      const sp = file.spawn;
      const dPos = Math.hypot(end.x - sp.x, end.y - sp.y);
      const dHead = Math.abs(((end.heading - sp.heading + 540) % 360) - 180);
      const dArt = Math.abs((end.articulation ?? 0) - (sp.articulation ?? 0));
      if (WRITE) {
        file.spawn = end;
        writeFileSync(path, pretty(file) + '\n');
        notes.push(`spawn written: ${JSON.stringify(end)}`);
      } else if (dPos > POS_TOL || dHead > ANGLE_TOL || dArt > ANGLE_TOL) {
        problems.push(`drive-out ends at ${JSON.stringify(end)}, not the spawn`);
      }
      // Pick-up level: the trailer stands at the spawn; prove the tractor can get under it.
      let soloLength = 0;
      let soloShunts = 0;
      if (file.pickup && Math.abs(end.articulation ?? 0) > RULES.coupling.maxAngle) {
        problems.push(`the trailer is left at ${end.articulation}° to the tractor – more than coupling allows (${RULES.coupling.maxAngle}°)`);
      }
      if (file.pickup) {
        const solo = file.pickup.driveOut?.length ? runSoloDriveOut(parseLevel(file, i + 1), file.pickup.driveOut) : null;
        if (!solo) problems.push('pick-up level has no pickup.driveOut proof');
        else if (!solo.ok) problems.push(solo.problem ?? 'solo drive-out failed');
        else {
          const t = file.pickup.tractor;
          if (WRITE) {
            file.pickup.tractor = solo.end;
            writeFileSync(path, pretty(file) + '\n');
            notes.push(`tractor start written: ${JSON.stringify(solo.end)}`);
          } else if (!t || Math.hypot(solo.end.x - t.x, solo.end.y - t.y) > POS_TOL || Math.abs(((solo.end.heading - t.heading + 540) % 360) - 180) > ANGLE_TOL) {
            problems.push(`solo drive-out ends at ${JSON.stringify(solo.end)}, not pickup.tractor`);
          }
          soloLength = solo.pathLength;
          soloShunts = solo.shunts;
          notes.push(`coupling route ${solo.pathLength.toFixed(0)} m, ${solo.shunts} shunt(s)`);
        }
      }
      if (Math.abs(end.articulation ?? 0) > ARTICULATION.warnAngle) notes.push('spawn articulation is large');
      // Reversing is slower than the drive-out and needs corrections: rough guide only.
      // Coupling: reverse slowly under the trailer (≈ walking pace at the end), plus the coupling-up pause.
      const pick = file.pickup ? soloLength / 1.2 + 10 + 6 * soloShunts : 0;
      const est = proof.pathLength / 1.2 + 6 * (proof.shunts + 1) + pick;
      notes.push(
        `route ${proof.pathLength.toFixed(0)} m, ${proof.shunts + soloShunts} shunt(s); rough 3★ time ≈ ${Math.ceil(est / 5) * 5}s` +
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


// ---- Daily Yard: make sure the generator copes with the coming year ---------------
{
  const { generateDaily } = await import('../src/levels/daily.ts');
  const start = Date.now();
  let bad = 0;
  for (let i = 0; i < 366; i++) {
    const date = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10);
    try {
      generateDaily(date);
    } catch {
      bad++;
      console.log(`✗ Daily Yard for ${date} could not be generated`);
    }
  }
  console.log(`${bad ? '✗' : '✓'} Daily Yard: next 366 days generated (${((Date.now() - start) / 366).toFixed(0)} ms per day)`);
  if (bad) process.exit(1);
}

if (failures) {
  console.log(`\n${failures} level(s) with problems`);
  process.exit(1);
}
