/**
 * Standard-mapping gamepad (Xbox / PlayStation layout):
 * left stick or d-pad = steer, RT = forward, LT = reverse, A = handbrake,
 * Start = pause, Y = restart, X = mirrors. In menus the d-pad moves between
 * buttons and A presses the focused one.
 */
import type { DriveInput } from '../physics/artic.ts';

const DEADZONE = 0.18;
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LT: 6, RT: 7, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

export class GamepadInput {
  /** True once a pad has been used this session. */
  active = false;
  private prev: boolean[] = [];
  private pressed = new Set<number>();
  private state: DriveInput | null = null;

  poll(): void {
    this.pressed.clear();
    this.state = null;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(pads).find((p) => p && p.connected && p.mapping === 'standard') ?? null;
    if (!gp) return;
    const down = gp.buttons.map((b) => b.pressed || b.value > 0.5);
    down.forEach((d, i) => {
      if (d && !this.prev[i]) this.pressed.add(i);
    });
    this.prev = down;

    const stick = gp.axes[0] ?? 0;
    const rt = gp.buttons[PAD.RT]?.value ?? 0;
    const lt = gp.buttons[PAD.LT]?.value ?? 0;
    const throttle = rt > 0.2 ? 1 : lt > 0.2 ? -1 : 0;
    const dpad = (down[PAD.RIGHT] ? 1 : 0) - (down[PAD.LEFT] ? 1 : 0);
    if (Math.abs(stick) > DEADZONE) {
      // Rescale past the deadzone so small movements still give fine control.
      const s = (Math.abs(stick) - DEADZONE) / (1 - DEADZONE);
      this.state = { steerMode: 'absolute', steer: Math.sign(stick) * s, throttle };
    } else {
      this.state = { steerMode: 'rate', steer: dpad, throttle };
    }
    if (this.pressed.size || throttle || Math.abs(stick) > DEADZONE) this.active = true;
  }

  wasPressed(button: number): boolean {
    return this.pressed.has(button);
  }

  drive(): DriveInput | null {
    return this.state;
  }
}

/** Move focus between the visible buttons of the open screen (gamepad d-pad). */
export function moveFocus(step: 1 | -1): void {
  const open = Array.from(document.querySelectorAll<HTMLElement>('.overlay:not(.hidden)')).pop();
  if (!open) return;
  const buttons = Array.from(open.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')).filter(
    (b) => b.offsetParent !== null,
  );
  if (!buttons.length) return;
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
  buttons[(i + step + buttons.length) % buttons.length].focus();
}
