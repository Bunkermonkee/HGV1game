/** Leaderboard screen: pick a board, This week / All time, watch replays. */
import { getPlayer } from '../game/storage.ts';
import { errorText, leaderboard, type Board, type BoardEntry, type Period } from '../net/leaderboard.ts';
import { formatTime } from '../render/hud.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const boardEl = $('board');
const select = $<HTMLSelectElement>('board-level');
const tabWeek = $<HTMLButtonElement>('tab-week');
const tabAll = $<HTMLButtonElement>('tab-all');
const note = $('board-note');
const rows = $('board-rows');

export interface BoardChoice {
  id: string;
  name: string;
}

export interface BoardCallbacks {
  onClose: () => void;
  onWatch: (scoreId: number) => void;
}

let period: Period = 'week';
let request = 0;

export function initBoard(cb: BoardCallbacks): void {
  $('board-back').addEventListener('click', cb.onClose);
  select.addEventListener('change', () => void load());
  tabWeek.addEventListener('click', () => setPeriod('week'));
  tabAll.addEventListener('click', () => setPeriod('all'));
  rows.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-score]');
    if (btn) cb.onWatch(Number(btn.dataset.score));
  });
}

function setPeriod(p: Period): void {
  period = p;
  tabWeek.setAttribute('aria-selected', String(p === 'week'));
  tabAll.setAttribute('aria-selected', String(p === 'all'));
  void load();
}

export function isBoardOpen(): boolean {
  return !boardEl.classList.contains('hidden');
}

export function hideBoard(): void {
  boardEl.classList.add('hidden');
}

/** Open the leaderboard on a particular board. */
export function showBoard(choices: BoardChoice[], levelId: string): void {
  select.innerHTML = choices.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  select.value = choices.some((c) => c.id === levelId) ? levelId : choices[0].id;
  boardEl.classList.remove('hidden');
  select.focus();
  void load();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function stars(n: number, overall: boolean): string {
  return overall ? `★ ${n}` : '★'.repeat(n);
}

function row(e: BoardEntry, overall: boolean): string {
  const watch = e.id
    ? `<button class="watch" type="button" data-score="${e.id}" aria-label="Watch ${escapeHtml(e.name)}'s run">▶ Watch</button>`
    : '';
  return `<tr class="${e.you ? 'you' : ''}">
    <td>${e.pos}</td>
    <td>${escapeHtml(e.name)}${e.you ? ' (you)' : ''}</td>
    <td aria-label="${e.stars} stars">${stars(e.stars, overall)}</td>
    <td>${formatTime(e.totalMs / 1000)}</td>
    <td>${e.shunts}</td>
    <td>${watch}</td>
  </tr>`;
}

async function load(): Promise<void> {
  const level = select.value;
  const daily = level.startsWith('daily-');
  const overall = level === 'overall';
  // A Daily Yard only lasts a day, so it has a single board.
  tabWeek.textContent = daily ? 'Today' : 'This week';
  tabAll.disabled = daily;
  const p: Period = daily ? 'week' : period;
  note.textContent = daily
    ? "Today's yard only – there's a new one tomorrow."
    : overall
      ? 'Total stars across all 10 yards (time breaks ties). Only drivers who have finished every yard appear.'
      : p === 'week'
        ? 'Best run per driver this week. The weekly board resets on Monday at midnight.'
        : 'Best run per driver, ever.';

  const mine = ++request;
  rows.innerHTML = '<tr><td colspan="6" class="empty">Loading…</td></tr>';
  let board: Board;
  try {
    board = await leaderboard.board(level, p, getPlayer().id);
  } catch (err) {
    if (mine === request) rows.innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(errorText(err))}</td></tr>`;
    return;
  }
  if (mine !== request) return;
  if (!board.entries.length) {
    rows.innerHTML = `<tr><td colspan="6" class="empty">No runs posted ${p === 'week' && !daily ? 'this week' : ''} yet. Be the first!</td></tr>`;
    return;
  }
  let html = board.entries.map((e) => row(e, overall)).join('');
  if (board.you && !board.entries.some((e) => e.you)) {
    html += `<tr class="gap"><td colspan="6">⋯</td></tr>` + row(board.you, overall);
  }
  rows.innerHTML = html;
  const total = board.total;
  note.textContent += ` ${total} driver${total === 1 ? '' : 's'} on this board.`;
}
