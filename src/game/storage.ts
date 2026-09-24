/** Progress saved in localStorage. Every access is guarded: storage can be blocked. */
const KEY = 'yardmaster.v1';

export interface LevelRecord {
  stars: number;
  bestTime: number;
  bestShunts: number;
}

export interface SaveData {
  levels: Record<string, LevelRecord>;
  unlocked: number;
}

function blank(): SaveData {
  return { levels: {}, unlocked: 1 };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const data = JSON.parse(raw) as Partial<SaveData>;
    return { levels: data.levels ?? {}, unlocked: data.unlocked ?? 1 };
  } catch {
    return blank();
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Private mode / blocked storage: progress just isn't kept.
  }
}

/** Record a finished run. Returns true if it beat the previous best time. */
export function recordResult(levelId: string, stars: number, time: number, shunts: number): boolean {
  const save = loadSave();
  const prev = save.levels[levelId];
  const newBest = !prev || time < prev.bestTime;
  save.levels[levelId] = {
    stars: Math.max(prev?.stars ?? 0, stars),
    bestTime: Math.min(prev?.bestTime ?? Infinity, time),
    bestShunts: Math.min(prev?.bestShunts ?? Infinity, shunts),
  };
  writeSave(save);
  return newBest;
}
