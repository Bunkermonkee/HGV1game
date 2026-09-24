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
  }
}

export class Tutorial {
  current: string | null = null;
  private ttl = 0;
  private shown = new Set<TutorialTip>();
  private tips: TutorialTip[];
  private labels: Record<string, string>;

  constructor(tips: TutorialTip[], labels: Record<string, string>) {
    this.tips = tips;
    this.labels = labels;
  }

  reset(): void {
    this.shown.clear();
    this.current = null;
    this.ttl = 0;
  }

  update(s: Session, dt: number): void {
    if (s.state !== 'driving') {
      this.current = null;
      return;
    }
    for (const tip of this.tips) {
      if (this.shown.has(tip) || !fired(tip.trigger, s)) continue;
      this.shown.add(tip);
      this.current = tip.text.replace(/\{(\w+)\}/g, (m, k: string) => this.labels[k] ?? m);
      // The opening tip stays up until the player gets going.
      this.ttl = tip.trigger === 'start' ? 30 : TIP_SECONDS;
      break;
    }
    if (this.current && (this.ttl -= dt) <= 0) this.current = null;
  }
}
