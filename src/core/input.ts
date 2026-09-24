/**
 * Keyboard input. Uses `KeyboardEvent.code`, so WASD works on any layout.
 * Touch and gamepad sources will feed the same DriveInput later.
 */
import type { DriveInput } from '../physics/artic.ts';

const LEFT = ['ArrowLeft', 'KeyA'];
const RIGHT = ['ArrowRight', 'KeyD'];
const FORWARD = ['ArrowUp', 'KeyW'];
const REVERSE = ['ArrowDown', 'KeyS'];

/** Keys whose default browser action (scrolling the host page) we block. */
const CAPTURED = new Set([...LEFT, ...RIGHT, ...FORWARD, ...REVERSE, 'Space']);

export class Keyboard {
  private down = new Set<string>();
  private pressed = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (CAPTURED.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    // Losing focus (e.g. clicking the host page) must not leave keys stuck.
    target.addEventListener('blur', () => this.down.clear());
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  /** True once per physical key press. */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Call at the end of each frame. */
  endFrame(): void {
    this.pressed.clear();
  }

  drive(): DriveInput {
    const steer = (this.isDown(...RIGHT) ? 1 : 0) - (this.isDown(...LEFT) ? 1 : 0);
    const throttle = (this.isDown(...FORWARD) ? 1 : 0) - (this.isDown(...REVERSE) ? 1 : 0);
    return { steerMode: 'rate', steer, throttle };
  }
}
