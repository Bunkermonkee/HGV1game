/**
 * After `vite build`: copy the leaderboard API (server/api) into dist/api and
 * write dist/api/levels.json – the level ids, names, star targets and a
 * minimum possible time for each level, which the server checks scores against.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPEED } from '../src/config/vehicle.ts';
import { DEG, MPH_TO_MS } from '../src/core/math.ts';
import { BUFFER } from '../src/game/yard.ts';
import { parseLevel, type LevelFile } from '../src/levels/parse.ts';

const root = join(import.meta.dirname, '..');
const src = join(root, 'server/api');
const out = join(root, 'dist/api');
mkdirSync(out, { recursive: true });
for (const f of readdirSync(src)) {
  // Never ship a real config.php: it lives only on the server.
  if (f === 'config.php') continue;
  copyFileSync(join(src, f), join(out, f));
}

const levelDir = join(root, 'src/levels');
const vmax = SPEED.maxForwardMph * MPH_TO_MS;
const meta = readdirSync(levelDir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f, i) => {
    const level = parseLevel(JSON.parse(readFileSync(join(levelDir, f), 'utf8')) as LevelFile, i + 1);
    const bay = level.bays.find((b) => b.target)!;
    const a = bay.heading * DEG;
    const gap = bay.buffers ? BUFFER.depth : 0;
    // The trailer's rear has to cover at least the straight-line distance to
    // the buffers, and nothing moves faster than the forward speed limit.
    const dist = Math.hypot(level.spawn.x - (bay.x + Math.cos(a) * gap), level.spawn.y - (bay.y + Math.sin(a) * gap));
    return { id: level.id, name: `${level.number}. ${level.name}`, stars: level.stars, minTimeMs: Math.floor((dist / vmax) * 1000) };
  });
writeFileSync(join(out, 'levels.json'), JSON.stringify(meta, null, 2) + '\n');
console.log(`api: copied ${readdirSync(src).length} files, wrote levels.json (${meta.length} levels)`);
