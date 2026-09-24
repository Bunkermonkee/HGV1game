/**
 * All levels, bundled at build time. To add a level, drop a new JSON file in
 * this folder – files are played in filename order (01-…, 02-…, …).
 */
import type { YardLayout } from '../game/yard.ts';
import { parseLevel, type LevelFile } from './parse.ts';

const files = import.meta.glob<LevelFile>('./*.json', { eager: true, import: 'default' });

export const LEVELS: YardLayout[] = Object.keys(files)
  .sort()
  .map((path, i) => parseLevel(files[path], i + 1));
