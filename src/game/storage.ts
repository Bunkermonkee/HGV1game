/** Progress and settings saved in localStorage. Every access is guarded: storage can be blocked. */
const KEY = 'yardmaster.v1';

export interface LevelRecord {
  stars: number;
  bestTime: number;
  bestShunts: number;
}

export interface Settings {
  proView: boolean;
  sound: boolean;
}

export interface SaveData {
  levels: Record<string, LevelRecord>;
  /** Highest level number the player may start (levels unlock in order). */
  unlocked: number;
  settings: Settings;
}

function blank(): SaveData {
  return { levels: {}, unlocked: 1, settings: { proView: false, sound: true } };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const data = JSON.parse(raw) as Partial<SaveData>;
    return {
      levels: data.levels ?? {},
      unlocked: Math.max(1, data.unlocked ?? 1),
      settings: { ...blank().settings, ...data.settings },
    };
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

/**
 * Record a finished run and unlock the next level.
 * Returns true if it beat the previous best time.
 */
export function recordResult(levelId: string, levelNumber: number, stars: number, time: number, shunts: number): boolean {
  const save = loadSave();
  const prev = save.levels[levelId];
  const newBest = !prev || time < prev.bestTime;
  save.levels[levelId] = {
    stars: Math.max(prev?.stars ?? 0, stars),
    bestTime: Math.min(prev?.bestTime ?? Infinity, time),
    bestShunts: Math.min(prev?.bestShunts ?? Infinity, shunts),
  };
  save.unlocked = Math.max(save.unlocked, levelNumber + 1);
  writeSave(save);
  return newBest;
}

export function saveSettings(settings: Settings): void {
  const save = loadSave();
  save.settings = settings;
  writeSave(save);
}
