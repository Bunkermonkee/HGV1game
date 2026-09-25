/**
 * Run recording and playback.
 *
 * The physics runs at a fixed 120 steps a second, so a run is fully described
 * by its level plus the (quantised) input at each step. Only changes are
 * stored, so a one-minute run is a few KB. A pose checkpoint is stored every
 * second: playback compares against them, which both verifies the run and
 * stops tiny floating-point differences between browsers from accumulating.
 */
import type { Artic, DriveInput } from '../physics/artic.ts';

/** Fixed physics step (seconds). */
export const STEP = 1 / 120;
export const STEPS_PER_SECOND = 120;
const CHECKPOINT_EVERY = STEPS_PER_SECOND;
/** Playback snaps back to a checkpoint if it has drifted further than this (m / rad). */
const DRIFT_POS = 0.05;
const DRIFT_ANGLE = 0.01;

export interface ReplayData {
  v: 1;
  levelId: string;
  /** Number of physics steps in the run. */
  steps: number;
  /** Input changes: [step, steerMode (0 rate / 1 absolute), steer ×127, throttle]. */
  inputs: [number, number, number, number][];
  /** Steps at which the handbrake was toggled (applied before that step). */
  handbrake: number[];
  /** [step, x mm, y mm, heading ×10⁴, trailer heading ×10⁴]. */
  checkpoints: [number, number, number, number, number][];
}

/** Round an input to what the recording can represent, so live play and playback match exactly. */
export function quantize(input: DriveInput): DriveInput {
  const throttle = Math.sign(input.throttle);
  if (input.steerMode === 'absolute') {
    return { steerMode: 'absolute', steer: Math.round(Math.max(-1, Math.min(1, input.steer)) * 127) / 127, throttle };
  }
  return { steerMode: 'rate', steer: Math.sign(input.steer), throttle };
}

function encode(step: number, input: DriveInput): [number, number, number, number] {
  return [step, input.steerMode === 'absolute' ? 1 : 0, Math.round(input.steer * 127), input.throttle];
}

function pose(step: number, a: Artic): [number, number, number, number, number] {
  return [step, Math.round(a.x * 1000), Math.round(a.y * 1000), Math.round(a.heading * 1e4), Math.round(a.trailerHeading * 1e4)];
}

export class ReplayRecorder {
  private data: ReplayData;
  private last = '';

  constructor(levelId: string) {
    this.data = { v: 1, levelId, steps: 0, inputs: [], handbrake: [], checkpoints: [] };
  }

  input(step: number, input: DriveInput): void {
    const e = encode(step, input);
    const key = e.slice(1).join(',');
    if (key !== this.last) {
      this.data.inputs.push(e);
      this.last = key;
    }
  }

  handbrake(step: number): void {
    this.data.handbrake.push(step);
  }

  /** Call after each step; stores a checkpoint every second. */
  afterStep(step: number, artic: Artic): void {
    this.data.steps = step;
    if (step % CHECKPOINT_EVERY === 0) this.data.checkpoints.push(pose(step, artic));
  }

  finish(): ReplayData {
    return this.data;
  }
}

export class ReplayPlayer {
  readonly data: ReplayData;
  /** Largest correction applied at a checkpoint (metres). */
  maxDrift = 0;
  private inputIndex = 0;
  private hbIndex = 0;
  private cpIndex = 0;
  private current: DriveInput = { steerMode: 'rate', steer: 0, throttle: 0 };

  constructor(data: ReplayData) {
    this.data = data;
  }

  /** Input for `step`, and how many handbrake toggles to apply first. */
  next(step: number): { input: DriveInput; toggles: number } {
    const ins = this.data.inputs;
    while (this.inputIndex < ins.length && ins[this.inputIndex][0] <= step) {
      const [, mode, steer, throttle] = ins[this.inputIndex++];
      this.current = { steerMode: mode ? 'absolute' : 'rate', steer: steer / 127, throttle };
    }
    let toggles = 0;
    const hb = this.data.handbrake;
    while (this.hbIndex < hb.length && hb[this.hbIndex] <= step) {
      if (hb[this.hbIndex] === step) toggles++;
      this.hbIndex++;
    }
    return { input: this.current, toggles };
  }

  /** After a step: compare with the recorded checkpoint and correct drift. */
  afterStep(step: number, artic: Artic): void {
    const cps = this.data.checkpoints;
    while (this.cpIndex < cps.length && cps[this.cpIndex][0] < step) this.cpIndex++;
    const cp = cps[this.cpIndex];
    if (!cp || cp[0] !== step) return;
    const [, x, y, h, th] = cp;
    const dx = x / 1000 - artic.x;
    const dy = y / 1000 - artic.y;
    const d = Math.hypot(dx, dy);
    this.maxDrift = Math.max(this.maxDrift, d);
    const dh = Math.abs(h / 1e4 - artic.heading) + Math.abs(th / 1e4 - artic.trailerHeading);
    if (d > DRIFT_POS || dh > DRIFT_ANGLE) {
      artic.x = x / 1000;
      artic.y = y / 1000;
      artic.heading = h / 1e4;
      artic.trailerHeading = th / 1e4;
    }
  }
}
