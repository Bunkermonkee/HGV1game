/** Level tutorial prompts, each shown once when its trigger first fires. */
import { DEG } from '../core/math.ts';
import type { Session } from './session.ts';
import type { TipTrigger, TutorialTip } from './yard.ts';

const TIP_SECONDS = 9;

function fired(t: TipTrigger, s: Session): boolean {
  switch (t) {
    case 'start':
      return true;
    case 'reversing':
      return s.reverseDistance > 2;
    case 'drift':
      return s.reverseDistance > 3 && Math.abs(s.artic.articulation) > 4 * DEG;
    case 'nearBay':
      return s.bayCheck.near && s.bayCheck.rearGap < 8;
    case 'aligned':
      return s.bayCheck.ok && !s.artic.handbrake;
    case 'shunt':
      return s.shunts > 0;
    case 'contact':
      return s.contacts > 0;
    case 'banksman':
      return !!s.banksman && s.banksman.signal !== 'wave';
  }
}

export class Tutorial {
  current: string | null = null;
  private ttl = 0;
  /** Seconds the current tip has been up, and whether it's the opening one. */
  private age = 0;
  private opening = false;
  private shown = new Set<TutorialTip>();
  private tips: TutorialTip[];
  /** Control names for {placeholders}; updated when the input device changes. */
  labels: Record<string, string>;

  constructor(tips: TutorialTip[], labels: Record<string, string>) {
    this.tips = tips;
    this.labels = labels;
  }

  reset(): void {
    this.shown.clear();
    this.current = null;
    this.ttl = 0;
    this.age = 0;
  }

  update(s: Session, dt: number): void {
    if (s.state !== 'driving') {
      this.current = null;
      return;
    }
    this.age += dt;
    // Give a tip a few seconds to be read before the next one replaces it.
    const busy = this.current !== null && !this.opening && this.age < 4;
    for (const tip of busy ? [] : this.tips) {
      if (this.shown.has(tip) || !fired(tip.trigger, s)) continue;
      this.shown.add(tip);
      this.current = tip.text.replace(/\{(\w+)\}/g, (m, k: string) => this.labels[k] ?? m);
      // The opening tip stays up until the player gets going.
      this.ttl = tip.trigger === 'start' ? 30 : TIP_SECONDS;
      this.opening = tip.trigger === 'start';
      this.age = 0;
      break;
    }
    if (this.current && (this.ttl -= dt) <= 0) this.current = null;
  }
}
