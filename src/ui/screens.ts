/** DOM screens: results (delivery note) and fail. */
import { BRAND } from '../config/brand.ts';
import { showLogo } from './menus.ts';
import { RULES } from '../config/rules.ts';
import type { RunResult, Session } from '../game/session.ts';
import { getPlayer, savePlayer, type LevelRecord } from '../game/storage.ts';
import { errorText, leaderboard, type SubmitResult } from '../net/leaderboard.ts';
import { formatTime } from '../render/hud.ts';
import { canvasToBlob, renderShareCard } from '../share/card.ts';
import { canShareImage, copyText, downloadBlob, shareFile, shareImage, shareText, starString } from '../share/share.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const resultsEl = $('results');
const failEl = $('fail');
const msgEl = $('share-msg');
const shareBtn = $<HTMLButtonElement>('btn-share');
const previewImg = $<HTMLImageElement>('share-preview');

let current: { text: string; blob: Blob | null; file: File | null } = { text: '', blob: null, file: null };
let previewUrl = '';
/** The run on the results screen (for posting and re-rendering the share card). */
let shown: { result: RunResult; session: Session } | null = null;

const lbPanel = $('lb-panel');
const lbForm = $<HTMLFormElement>('lb-form');
const lbName = $<HTMLInputElement>('lb-name');
const lbStatus = $('lb-status');
const lbLinks = lbPanel.querySelector<HTMLElement>('.lb-links')!;

export interface ScreenCallbacks {
  onRetry: () => void;
  onNext: () => void;
  onLevelSelect: () => void;
  onViewBoard: (levelId: string) => void;
}

export function initScreens(cb: ScreenCallbacks): void {
  $('btn-again').addEventListener('click', cb.onRetry);
  $('btn-retry').addEventListener('click', cb.onRetry);
  $('btn-next').addEventListener('click', cb.onNext);
  $('btn-levels').addEventListener('click', cb.onLevelSelect);
  $('btn-fail-levels').addEventListener('click', cb.onLevelSelect);

  shareBtn.addEventListener('click', async () => {
    if (!current.file) return;
    const outcome = await shareImage(current.file, current.text);
    if (outcome === 'shared') say('Shared – nice one.');
    else if (outcome === 'failed') say("Couldn't open sharing here. Use Download image and Copy text instead.");
  });

  $('btn-download').addEventListener('click', () => {
    if (!current.blob) return;
    downloadBlob(current.blob, 'yard-master.png');
    say('Image saved. Post it with the copied text.');
  });

  lbForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = lbName.value.trim().replace(/\s+/g, ' ');
    if (name.length < 2) {
      lbStatus.textContent = 'Names need at least 2 characters.';
      lbName.focus();
      return;
    }
    savePlayer({ ...getPlayer(), name });
    void post();
  });
  $('lb-change').addEventListener('click', () => {
    lbName.value = getPlayer().name;
    lbForm.classList.remove('hidden');
    lbName.focus();
    lbName.select();
  });
  $('lb-view').addEventListener('click', () => {
    if (shown) cb.onViewBoard(shown.result.levelId);
  });

  $('btn-copy').addEventListener('click', async () => {
    const ok = await copyText(current.text);
    say(ok ? 'Text copied – paste it with your image.' : current.text);
  });
}

function say(text: string): void {
  msgEl.textContent = text;
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
function ordinal(n: number): string {
  const t = n % 100;
  const u = n % 10;
  const suffix = t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

/** Offer (or automatically make) a leaderboard post for this run. */
function setupLeaderboard(r: RunResult): void {
  const canPost = leaderboard.available && !!r.replay;
  lbPanel.classList.toggle('hidden', !canPost);
  if (!canPost) return;
  const player = getPlayer();
  lbStatus.textContent = '';
  lbLinks.classList.add('hidden');
  if (player.name && player.autoPost) {
    lbForm.classList.add('hidden');
    void post();
  } else {
    lbForm.classList.remove('hidden');
    lbName.value = player.name;
  }
}

async function post(): Promise<void> {
  if (!shown?.result.replay) return;
  const r = shown.result;
  const player = getPlayer();
  lbForm.classList.add('hidden');
  lbStatus.textContent = `Posting as ${player.name}…`;
  let res: SubmitResult;
  try {
    res = await leaderboard.submit({
      playerId: player.id,
      name: player.name,
      levelId: r.levelId,
      stars: r.stars,
      timeMs: Math.round(r.time * 1000),
      shunts: r.shunts,
      contacts: r.contacts,
      steps: r.steps,
      replay: r.replay!,
    });
  } catch (err) {
    lbStatus.textContent = errorText(err);
    lbForm.classList.remove('hidden');
    lbName.value = player.name;
    lbLinks.classList.remove('hidden');
    return;
  }
  if (shown?.result !== r) return; // moved on to another run meanwhile
  savePlayer({ ...player, autoPost: true });
  const daily = r.levelId.startsWith('daily-');
  const when = daily ? 'today' : 'this week';
  const pos = res.week.pos;
  if (pos) {
    const allTime = !daily && res.all.pos ? ` · ${ordinal(res.all.pos)} all time` : '';
    const lead = res.improved
      ? `Posted as ${escapeHtml(player.name)}: <strong>${ordinal(pos)}</strong> ${when}`
      : `Your best ${when} is still ${formatTime((res.week.best?.totalMs ?? 0) / 1000)}: <strong>${ordinal(pos)}</strong>`;
    lbStatus.innerHTML = `${lead} of ${res.week.total}${allTime}`;
    const rankText = `#${pos} ${when}`;
    current.text = shareText(r, rankText);
    await renderCard(r, shown.session, rankText);
  } else {
    lbStatus.textContent = 'Posted.';
  }
  lbLinks.classList.remove('hidden');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function renderCard(r: RunResult, session: Session, rankText?: string): Promise<void> {
  const card = renderShareCard(r, session, rankText);
  const blob = await canvasToBlob(card);
  current.blob = blob;
  current.file = blob ? shareFile(blob) : null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = blob ? URL.createObjectURL(blob) : '';
  previewImg.src = previewUrl;
}

/** "38s" under a minute, else "1:12.4". */
function shortTime(s: number): string {
  return s < 60 ? `${Math.round(s)}s` : formatTime(s);
}

export function hideScreens(): void {
  resultsEl.classList.add('hidden');
  failEl.classList.add('hidden');
}

export function isScreenOpen(): boolean {
  return !resultsEl.classList.contains('hidden') || !failEl.classList.contains('hidden');
}

export async function showResults(
  r: RunResult,
  session: Session,
  best: LevelRecord | undefined,
  newBest: boolean,
  hasNext: boolean,
): Promise<void> {
  $('btn-next').classList.toggle('hidden', !hasNext);
  const now = new Date();
  $('note-no').textContent = `No. YM-${now.getTime().toString(36).slice(-6).toUpperCase()}`;
  $('note-date').textContent = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const shuntWord = `${r.shunts} shunt${r.shunts === 1 ? '' : 's'}`;
  $('note-summary').textContent = `Bay ${r.bay} – ${shortTime(r.total)} – ${shuntWord} – ${'★'.repeat(r.stars)}`;
  $('note-consignor').textContent = `${BRAND.stationName} · ${BRAND.gameName}`;
  $('note-point').textContent = `${r.levelName}, Bay ${r.bay}`;
  $('note-time').textContent = formatTime(r.time);
  $('note-contacts').textContent = r.contacts
    ? `${r.contacts} (+${r.penalty}s at ${RULES.contact.penaltySeconds}s each)`
    : 'None';
  $('note-total').textContent = formatTime(r.total);
  $('note-shunts').textContent = String(r.shunts);
  const bestEl = $('note-best');
  bestEl.textContent = newBest ? 'New best!' : best ? `${formatTime(best.bestTime)}` : '–';
  bestEl.classList.toggle('new-best', newBest);

  const stars = $('note-stars');
  stars.innerHTML = '';
  stars.setAttribute('aria-label', `${r.stars} out of 3 stars`);
  for (let i = 0; i < 3; i++) {
    const s = document.createElement('span');
    s.textContent = '★';
    if (i >= r.stars) s.className = 'off';
    stars.appendChild(s);
  }

  showLogo($('note-logo'), 'onLight');

  say('');
  current = { text: shareText(r), blob: null, file: null };
  shown = { result: r, session };
  failEl.classList.add('hidden');
  resultsEl.classList.remove('hidden');
  resultsEl.scrollTop = 0;

  await renderCard(r, session);
  setupLeaderboard(r);
  previewImg.alt = `Share card: ${r.levelName}, Bay ${r.bay}, ${shortTime(r.total)}, ${shuntWord}, ${starString(r.stars)}`;
  // Web Share with files on phones; download + copy everywhere else.
  shareBtn.classList.toggle('hidden', !(current.file && canShareImage(current.file)));
  (hasNext ? $('btn-next') : shareBtn.classList.contains('hidden') ? $('btn-download') : shareBtn).focus();
}

export function showFail(title: string, reason: string): void {
  $('fail-title').textContent = title;
  $('fail-reason').textContent = reason;
  resultsEl.classList.add('hidden');
  failEl.classList.remove('hidden');
  $('btn-retry').focus();
}
