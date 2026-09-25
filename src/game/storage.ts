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

/** Leaderboard identity: a random id (no personal data) and a display name. */
export interface Player {
  id: string;
  name: string;
  /** After the first post, post every finished run automatically. */
  autoPost: boolean;
}

export interface SaveData {
  levels: Record<string, LevelRecord>;
  player?: Player;
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
      player: data.player,
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

function randomId(): string {
  // randomUUID needs a secure (https) page and a recent browser.
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  // Fallback: RFC 4122 version 4 layout from getRandomValues.
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Kept in memory too, so the id stays the same all session even if storage is blocked.
let cachedPlayer: Player | null = null;

/** The player's leaderboard identity, creating the random id on first use. */
export function getPlayer(): Player {
  if (cachedPlayer) return cachedPlayer;
  const save = loadSave();
  if (!save.player) {
    save.player = { id: randomId(), name: '', autoPost: false };
    writeSave(save);
  }
  cachedPlayer = save.player;
  return cachedPlayer;
}

export function savePlayer(p: Player): void {
  cachedPlayer = p;
  const save = loadSave();
  save.player = p;
  writeSave(save);
}
