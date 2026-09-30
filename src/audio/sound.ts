/**
 * All game audio, synthesised with the Web Audio API – no sound files to
 * download. Deliberately quiet: the station's live radio player may be
 * playing on the same page.
 *
 * Browsers only allow audio after a user gesture, so nothing is created
 * until `unlock()` is called from a tap / click / key press.
 */

/** Overall loudness (0–1). Kept low on purpose. */
const MASTER_VOLUME = 0.32;
/** Beeper: on/off period in seconds (a real reversing alarm is ~1 beep/s). */
const BEEP_ON = 0.45;
const BEEP_PERIOD = 0.9;

export interface EngineState {
  /** Engine should be audible (playing, not paused, tab visible). */
  running: boolean;
  /** Road speed as a fraction of the governed maximum (0–1). */
  speedFraction: number;
  /** A drive pedal is pressed. */
  throttle: boolean;
  /** In reverse gear: the beeper sounds. */
  reversing: boolean;
}

export class Sound {
  muted = false;

  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private oscMain!: OscillatorNode;
  private oscSub!: OscillatorNode;
  private beepGain!: GainNode;
  private nextBeep = 0;
  private beeping = false;
  /** Smoothed engine load, 0 = idle, 1 = working hard. */
  private load = 0;

  /** Create / resume the audio graph. Call from inside a user gesture. */
  unlock(): void {
    if (this.muted) return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.build(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
  }

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(m ? 0 : MASTER_VOLUME, this.ctx.currentTime, 0.05);
    if (m) {
      // Give the fade a moment, then stop the audio thread entirely.
      setTimeout(() => {
        if (this.muted) void this.ctx?.suspend().catch(() => {});
      }, 200);
    } else {
      void this.ctx.resume().catch(() => {});
    }
  }

  /** Suspend when the tab is hidden; resume when it's back (unless muted). */
  setPageVisible(visible: boolean): void {
    if (!this.ctx) return;
    if (!visible) void this.ctx.suspend().catch(() => {});
    else if (!this.muted) void this.ctx.resume().catch(() => {});
  }

  private build(ctx: AudioContext): void {
    this.master = ctx.createGain();
    this.master.gain.value = MASTER_VOLUME;
    this.master.connect(ctx.destination);

    // One second of white noise, reused by every noisy sound.
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Engine: a low sawtooth "firing" note plus a sub-octave square and a
    // band of rumble noise, all through a low-pass filter that opens with load.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 220;
    this.engineFilter.Q.value = 1.2;
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);

    this.oscMain = ctx.createOscillator();
    this.oscMain.type = 'sawtooth';
    this.oscMain.frequency.value = 30;
    const mainLevel = ctx.createGain();
    mainLevel.gain.value = 0.55;
    this.oscMain.connect(mainLevel).connect(this.engineFilter);

    this.oscSub = ctx.createOscillator();
    this.oscSub.type = 'square';
    this.oscSub.frequency.value = 15;
    const subLevel = ctx.createGain();
    subLevel.gain.value = 0.35;
    this.oscSub.connect(subLevel).connect(this.engineFilter);

    const rumble = ctx.createBufferSource();
    rumble.buffer = this.noise;
    rumble.loop = true;
    const rumbleBand = ctx.createBiquadFilter();
    rumbleBand.type = 'bandpass';
    rumbleBand.frequency.value = 140;
    rumbleBand.Q.value = 0.7;
    const rumbleLevel = ctx.createGain();
    rumbleLevel.gain.value = 0.5;
    rumble.connect(rumbleBand).connect(rumbleLevel).connect(this.engineFilter);

    // Diesel lope: wobble the level slightly at half the firing rate.
    const lope = ctx.createOscillator();
    lope.frequency.value = 7;
    const lopeDepth = ctx.createGain();
    lopeDepth.gain.value = 0.25;
    lope.connect(lopeDepth).connect(mainLevel.gain);

    this.oscMain.start();
    this.oscSub.start();
    rumble.start();
    lope.start();

    // Reversing beeper: a steady tone gated on and off.
    const beep = ctx.createOscillator();
    beep.type = 'square';
    beep.frequency.value = 1150;
    const beepTone = ctx.createBiquadFilter();
    beepTone.type = 'lowpass';
    beepTone.frequency.value = 2400;
    this.beepGain = ctx.createGain();
    this.beepGain.gain.value = 0;
    beep.connect(beepTone).connect(this.beepGain).connect(this.master);
    beep.start();
  }

  /** Call every frame. */
  update(dt: number, s: EngineState): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;

    const targetLoad = s.throttle ? 0.45 + 0.55 * s.speedFraction : 0.12 * s.speedFraction;
    this.load += (targetLoad - this.load) * Math.min(1, dt * 3);
    const firing = 28 + this.load * 34; // ≈ 560–1240 rpm on a six-cylinder
    this.oscMain.frequency.setTargetAtTime(firing, t, 0.08);
    this.oscSub.frequency.setTargetAtTime(firing / 2, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(200 + this.load * 650, t, 0.1);
    this.engineGain.gain.setTargetAtTime(s.running ? 0.22 + this.load * 0.16 : 0, t, s.running ? 0.15 : 0.08);

    const wantBeep = s.running && s.reversing;
    if (wantBeep) {
      if (!this.beeping) {
        this.beeping = true;
        this.nextBeep = t + 0.05;
      }
      // Schedule a little ahead so beeps stay evenly spaced whatever the frame rate.
      while (this.nextBeep < t + 0.2) {
        const g = this.beepGain.gain;
        g.setValueAtTime(0, this.nextBeep);
        g.linearRampToValueAtTime(0.09, this.nextBeep + 0.01);
        g.setValueAtTime(0.09, this.nextBeep + BEEP_ON - 0.01);
        g.linearRampToValueAtTime(0, this.nextBeep + BEEP_ON);
        this.nextBeep += BEEP_PERIOD;
      }
    } else if (this.beeping) {
      this.beeping = false;
      this.beepGain.gain.cancelScheduledValues(t);
      this.beepGain.gain.setTargetAtTime(0, t, 0.01);
    }
  }

  private noiseBurst(filterType: BiquadFilterType, freq: number, q: number, peak: number, attack: number, decay: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + attack + decay + 0.05);
  }

  private thump(fromHz: number, toHz: number, peak: number, length: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(fromHz, t);
    o.frequency.exponentialRampToValueAtTime(toHz, t + length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + length + 0.05);
  }

  /** Air brake: a big hiss when the handbrake goes on, a short "psst" when released. */
  airBrake(applied: boolean): void {
    if (applied) this.noiseBurst('highpass', 2600, 0.7, 0.32, 0.015, 0.9);
    else this.noiseBurst('bandpass', 3500, 1.2, 0.18, 0.01, 0.25);
  }

  /** Light contact. Cones are plastic: a higher, lighter knock. */
  bump(cone = false): void {
    if (cone) {
      this.thump(420, 180, 0.35, 0.12);
      this.noiseBurst('bandpass', 1800, 2, 0.12, 0.003, 0.08);
    } else {
      this.thump(120, 45, 0.7, 0.28);
      this.noiseBurst('lowpass', 900, 0.8, 0.3, 0.004, 0.12);
    }
  }

  /** Heavy contact / jackknife. */
  crash(): void {
    this.thump(90, 30, 0.9, 0.5);
    this.noiseBurst('lowpass', 1400, 0.6, 0.55, 0.005, 0.6);
    this.noiseBurst('bandpass', 3000, 3, 0.15, 0.01, 0.35);
  }

  /** Delivered: a gentle two-note chime. */
  chime(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    [660, 880].forEach((hz, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = hz;
      const g = ctx.createGain();
      const start = t + i * 0.16;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.7);
      o.connect(g).connect(this.master);
      o.start(start);
      o.stop(start + 0.75);
    });
  }
}
