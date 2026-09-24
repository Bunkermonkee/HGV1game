/**
 * On-screen touch controls: a steering wheel (drag to turn), forward and
 * reverse pedals, a handbrake button, plus pause / full-screen buttons.
 * Each control tracks its own pointer, so steering and pedals work together.
 */
import { STEERING } from '../config/vehicle.ts';
import { DEG, clamp } from './math.ts';
import type { DriveInput } from '../physics/artic.ts';

const MAX_ROT = STEERING.touchWheelDegreesToLock;

export interface TouchCallbacks {
  onHandbrake: () => void;
  onPause: () => void;
  onFullscreen: () => void;
  onSound: () => void;
}

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

export class TouchControls {
  /** True once the device is known to be touch-driven. */
  active = false;

  private root = $('touch');
  private wheel = $('t-wheel');
  private wheelSvg = this.wheel.querySelector('svg')!;
  private handbrakeBtn = $('t-handbrake');
  private wheelPointer: number | null = null;
  private lastAngle = 0;
  /** Wheel rotation in degrees (+ = clockwise = right). */
  private rotation = 0;
  private fwd = false;
  private rev = false;

  constructor(cb: TouchCallbacks) {
    this.active = matchMedia('(pointer: coarse)').matches;
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'touch') this.active = true;
      },
      { capture: true },
    );
    // Long-press menus and text selection get in the way of holding a pedal.
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());

    this.bindWheel();
    this.bindPedal($('t-fwd'), (on) => (this.fwd = on));
    this.bindPedal($('t-rev'), (on) => (this.rev = on));
    this.bindTap(this.handbrakeBtn, cb.onHandbrake);
    this.bindTap($('t-pause'), cb.onPause);
    this.bindTap($('t-sound'), cb.onSound);
    const fs = $('t-fullscreen');
    if (document.fullscreenEnabled) {
      fs.classList.remove('hidden');
      this.bindTap(fs, cb.onFullscreen);
    }
  }

  private bindTap(el: HTMLElement, fn: () => void): void {
    // pointerdown rather than click: no delay, and works mid-drag on another control.
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      fn();
    });
    el.addEventListener('click', (e) => {
      // Keyboard activation (Enter/Space on a focused button) still works.
      if (e.detail === 0) fn();
    });
  }

  private bindPedal(el: HTMLElement, set: (on: boolean) => void): void {
    const down = (e: PointerEvent) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('pressed');
      set(true);
    };
    const up = () => {
      el.classList.remove('pressed');
      set(false);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  private angleAt(e: PointerEvent): number {
    const r = this.wheel.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) / DEG;
  }

  private bindWheel(): void {
    const w = this.wheel;
    w.addEventListener('pointerdown', (e) => {
      if (this.wheelPointer !== null) return;
      e.preventDefault();
      w.setPointerCapture(e.pointerId);
      this.wheelPointer = e.pointerId;
      this.lastAngle = this.angleAt(e);
      w.classList.add('held');
    });
    w.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.wheelPointer) return;
      const a = this.angleAt(e);
      let d = a - this.lastAngle;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      this.lastAngle = a;
      this.rotation = clamp(this.rotation + d, -MAX_ROT, MAX_ROT);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.wheelPointer) return;
      this.wheelPointer = null;
      w.classList.remove('held');
    };
    w.addEventListener('pointerup', release);
    w.addEventListener('pointercancel', release);
    w.addEventListener('lostpointercapture', release);
  }

  setVisible(show: boolean): void {
    this.root.classList.toggle('hidden', !show);
    if (!show) {
      // Nothing stays pressed while hidden.
      this.fwd = this.rev = false;
      this.wheelPointer = null;
      this.root.querySelectorAll('.pressed').forEach((el) => el.classList.remove('pressed'));
    }
  }

  get wheelHeld(): boolean {
    return this.wheelPointer !== null;
  }

  drive(): DriveInput {
    const throttle = (this.fwd ? 1 : 0) - (this.rev ? 1 : 0);
    if (this.wheelHeld) return { steerMode: 'absolute', steer: this.rotation / MAX_ROT, throttle };
    return { steerMode: 'rate', steer: 0, throttle };
  }

  /**
   * Once per frame: when let go, the wheel follows the road wheels (so it
   * self-centres with the truck), and the handbrake lamp shows its state.
   */
  sync(steerFraction: number, handbrake: boolean): void {
    if (!this.wheelHeld) this.rotation = steerFraction * MAX_ROT;
    this.wheelSvg.style.transform = `rotate(${this.rotation.toFixed(1)}deg)`;
    this.wheel.setAttribute('aria-valuenow', String(Math.round((this.rotation / MAX_ROT) * 100)));
    this.handbrakeBtn.classList.toggle('on', handbrake);
    this.handbrakeBtn.setAttribute('aria-pressed', String(handbrake));
  }

  /** Sizes for the current viewport; also written to CSS so both agree. */
  layout(viewW: number, viewH: number): { wheel: number; pedalH: number; rightWidth: number } {
    const wheel = Math.round(clamp(Math.min(viewH * 0.44, viewW * 0.24), 120, 200));
    const pedalH = Math.round(clamp(viewH * 0.3, 90, 140));
    const pedalW = Math.round(clamp(viewW * 0.085, 64, 86));
    const hb = Math.round(clamp(viewH * 0.16, 54, 70));
    const s = this.root.style;
    s.setProperty('--wheel-size', `${wheel}px`);
    s.setProperty('--pedal-h', `${pedalH}px`);
    s.setProperty('--pedal-w', `${pedalW}px`);
    s.setProperty('--hb-size', `${hb}px`);
    return { wheel, pedalH, rightWidth: pedalW * 2 + hb + 24 + 14 };
  }
}
