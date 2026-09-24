/** DOM screens: results (delivery note) and fail. */
import { BRAND, brandLogo } from '../config/brand.ts';
import { RULES } from '../config/rules.ts';
import type { RunResult, Session } from '../game/session.ts';
import type { LevelRecord } from '../game/storage.ts';
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

export interface ScreenCallbacks {
  onRetry: () => void;
}

export function initScreens(cb: ScreenCallbacks): void {
  $('btn-again').addEventListener('click', cb.onRetry);
  $('btn-retry').addEventListener('click', cb.onRetry);

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

  $('btn-copy').addEventListener('click', async () => {
    const ok = await copyText(current.text);
    say(ok ? 'Text copied – paste it with your image.' : current.text);
  });
}

function say(text: string): void {
  msgEl.textContent = text;
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
): Promise<void> {
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

  const logo = brandLogo();
  const slot = $('note-logo');
  slot.textContent = logo ? '' : 'LOGO';
  if (logo) slot.appendChild(logo.cloneNode());

  say('');
  current = { text: shareText(r), blob: null, file: null };
  failEl.classList.add('hidden');
  resultsEl.classList.remove('hidden');
  resultsEl.scrollTop = 0;

  const card = renderShareCard(r, session);
  const blob = await canvasToBlob(card);
  current.blob = blob;
  current.file = blob ? shareFile(blob) : null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = blob ? URL.createObjectURL(blob) : '';
  previewImg.src = previewUrl;
  previewImg.alt = `Share card: ${r.levelName}, Bay ${r.bay}, ${shortTime(r.total)}, ${shuntWord}, ${starString(r.stars)}`;
  // Web Share with files on phones; download + copy everywhere else.
  shareBtn.classList.toggle('hidden', !(current.file && canShareImage(current.file)));
  (shareBtn.classList.contains('hidden') ? $('btn-download') : shareBtn).focus();
}

export function showFail(title: string, reason: string): void {
  $('fail-title').textContent = title;
  $('fail-reason').textContent = reason;
  resultsEl.classList.add('hidden');
  failEl.classList.remove('hidden');
  $('btn-retry').focus();
}
