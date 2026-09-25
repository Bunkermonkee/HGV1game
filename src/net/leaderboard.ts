/**
 * Leaderboard API client (server code: server/api). If the API isn't there –
 * e.g. the game is hosted without it – `available` stays false and the game
 * simply hides the leaderboard.
 */
import type { ReplayData } from '../game/replay.ts';

const BASE: string = import.meta.env.VITE_API_BASE || './api/index.php';
const DISABLED = import.meta.env.VITE_NEUTRAL_BRAND === '1';
const TIMEOUT_MS = 8000;

export type Period = 'week' | 'all';

export interface BoardEntry {
  pos: number;
  name: string;
  stars: number;
  totalMs: number;
  shunts: number;
  contacts: number;
  /** Score id, for watching the replay (0 on the overall board). */
  id: number;
  you: boolean;
}

export interface Board {
  level: string;
  period: 'week' | 'all' | 'day';
  entries: BoardEntry[];
  you: BoardEntry | null;
  total: number;
}

export interface SubmitPayload {
  playerId: string;
  name: string;
  levelId: string;
  stars: number;
  timeMs: number;
  shunts: number;
  contacts: number;
  steps: number;
  replay: ReplayData;
}

export interface SubmitResult {
  improved: boolean;
  stars: number;
  week: { pos: number | null; total: number; best: BoardEntry | null };
  all: { pos: number | null; total: number };
}

export interface StoredReplay {
  name: string;
  levelId: string;
  stars: number;
  totalMs: number;
  timeMs: number;
  shunts: number;
  contacts: number;
  replay: ReplayData;
}

/** Server error codes: bad_name, slow_down, banned, too_fast, network, … */
export class ApiError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

async function call<T>(query: string, body?: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE}?${query}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('network');
  } finally {
    clearTimeout(timer);
  }
  let data: { ok?: boolean; error?: string } & T;
  try {
    data = await res.json();
  } catch {
    // Not JSON: usually a server error page (e.g. a PHP fatal error).
    throw new ApiError(res.ok ? 'bad_response' : `http_${res.status}`);
  }
  if (!data.ok) throw new ApiError(data.error ?? 'server_error');
  return data;
}

export const leaderboard = {
  available: false,

  /** Is the API installed and connected to its database? */
  async check(): Promise<boolean> {
    if (DISABLED) return false;
    try {
      await call('action=ping');
      this.available = true;
    } catch {
      this.available = false;
    }
    return this.available;
  },

  board(level: string, period: Period, playerId: string): Promise<Board> {
    const q = new URLSearchParams({ action: 'board', level, period, player: playerId });
    return call<Board>(q.toString());
  },

  submit(p: SubmitPayload): Promise<SubmitResult> {
    return call<SubmitResult>('action=submit', p);
  },

  replay(id: number): Promise<StoredReplay> {
    return call<StoredReplay>(`action=replay&id=${encodeURIComponent(String(id))}`);
  },
};

/** Friendly wording for an API error. */
export function errorText(e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'network';
  switch (code) {
    case 'bad_name':
      return "That name isn't allowed – try another (2–20 letters or numbers).";
    case 'slow_down':
      return 'Lots of posts from here – try again in a few minutes.';
    case 'banned':
      return "Scores from this player aren't being accepted.";
    case 'too_fast':
    case 'bad_time':
    case 'bad_replay':
      return "That run couldn't be verified, so it wasn't posted.";
    case 'bad_level':
      return 'This yard has closed – scores for it are no longer taken.';
    case 'network':
      return "Couldn't reach the leaderboard. Check your connection and try again.";
    default:
      // Server-side problem: show the code so it can be looked up (see the README).
      return `The leaderboard had a problem (${code}). Please try again later.`;
  }
}
