/** Share text and the share / download / copy actions. */
import { BRAND } from '../config/brand.ts';
import type { RunResult } from '../game/session.ts';
import { formatTime } from '../render/hud.ts';

const STAR = '★';

export function starString(stars: number): string {
  return STAR.repeat(stars) + '☆'.repeat(3 - stars);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Short, friendly driver banter. */
export function shareText(r: RunResult, rank?: string): string {
  const shunts = r.shunts === 0 ? 'no shunts' : plural(r.shunts, 'shunt');
  const time = r.total < 60 ? `${Math.round(r.total)}s` : formatTime(r.total);
  const opener =
    r.stars === 3
      ? `Straight on the bay, no messing ${starString(3)}`
      : r.stars === 2
        ? `On the bay, job done ${starString(2)}`
        : `Got there in the end ${starString(1)}`;
  const onBoard = rank ? ` – ${rank} on the leaderboard` : '';
  return `${opener} – Bay ${r.bay} in ${time} with ${shunts}${onBoard}. Reckon you can do better? ${BRAND.shareUrl}`;
}

export function shareFile(blob: Blob): File {
  return new File([blob], 'yard-master.png', { type: 'image/png' });
}

/** True when the device can share an image file (most phones). */
export function canShareImage(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

export type ShareOutcome = 'shared' | 'cancelled' | 'failed';

export async function shareImage(file: File, text: string): Promise<ShareOutcome> {
  try {
    await navigator.share({ files: [file], text, title: BRAND.gameName });
    return 'shared';
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / restricted frames: fall back to a hidden textarea.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
