import {
  CreateAudioEngineAsync,
  CreateSoundSourceAsync,
  type AudioEngineV2,
} from "@babylonjs/core/AudioV2";
import type { AbstractSoundSource } from "@babylonjs/core/AudioV2/abstractAudio/abstractSoundSource";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function smoothParameter(
  parameter: AudioParam,
  value: number,
  now: number,
  timeConstant: number,
): void {
  parameter.cancelAndHoldAtTime(now);
  parameter.setTargetAtTime(value, now, timeConstant);
}

function createNoiseBuffer(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const samples = buffer.getChannelData(0);
  let state = 0x6d2b79f5;
  for (let index = 0; index < samples.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    samples[index] = ((state >>> 0) / 0xffff_ffff) * 2 - 1;
  }
  return buffer;
}

/** Procedural, muted-by-default audio feedback for the player vehicle. */
export class VehicleAudio {
  private initialization: Promise<void> | null = null;
  private audioEngine: AudioEngineV2 | null = null;
  private context: AudioContext | null = null;
  private output: AbstractSoundSource | null = null;
  private fundamental: OscillatorNode | null = null;
  private harmonic: OscillatorNode | null = null;
  private tireNoise: AudioBufferSourceNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private engineLevel: GainNode | null = null;
  private tireLevel: GainNode | null = null;
  private driveLevel: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private tireFilter: BiquadFilterNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private driving = false;
  private disposed = false;
  private warned = false;

  initialize(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.initialization ??= this.initializeInternal();
    return this.initialization;
  }

  async unlock(): Promise<void> {
    await this.initialize();
    if (this.disposed || !this.audioEngine) return;
    try {
      await this.audioEngine.unlockAsync();
    } catch (error) {
      this.warnUnavailable(error);
    }
  }

  startDriving(): void {
    if (this.disposed) return;
    this.driving = true;
    this.setDriveLevel(1, 0.055);
  }

  stopDriving(): void {
    this.driving = false;
    this.setDriveLevel(0, 0.075);
  }

  update(speed01: number, throttle: number, slip01: number): void {
    const context = this.context;
    if (!context || this.disposed) return;

    const speed = clamp01(speed01);
    const load = clamp01(throttle);
    const slip = clamp01(slip01);
    const now = context.currentTime;
    const engineFrequency = 48 + speed * 95 + load * 12;

    if (this.fundamental) {
      smoothParameter(this.fundamental.frequency, engineFrequency, now, 0.045);
    }
    if (this.harmonic) {
      smoothParameter(this.harmonic.frequency, engineFrequency * 2.01, now, 0.045);
    }
    if (this.engineLevel) {
      smoothParameter(this.engineLevel.gain, 0.46 + speed * 0.12 + load * 0.28, now, 0.05);
    }
    if (this.engineFilter) {
      smoothParameter(this.engineFilter.frequency, 420 + speed * 750 + load * 350, now, 0.06);
    }
    if (this.tireLevel) {
      const rollingLevel = 0.002 + speed ** 1.5 * 0.014 + slip ** 1.2 * 0.042;
      smoothParameter(this.tireLevel.gain, rollingLevel, now, 0.045);
    }
    if (this.tireFilter) {
      smoothParameter(this.tireFilter.frequency, 850 + speed * 850 + slip * 600, now, 0.06);
    }
  }

  impact(strength: number): void {
    const context = this.context;
    const compressor = this.compressor;
    const noiseBuffer = this.noiseBuffer;
    const amount = clamp01(strength);
    if (!context || !compressor || !noiseBuffer || context.state !== "running" || amount < 0.04) return;

    const now = context.currentTime;
    const duration = 0.09 + amount * 0.09;
    const thump = context.createOscillator();
    const thumpLevel = context.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(105 - amount * 20, now);
    thump.frequency.exponentialRampToValueAtTime(42, now + duration);
    thumpLevel.gain.setValueAtTime(0.0001, now);
    thumpLevel.gain.linearRampToValueAtTime(0.035 + amount * 0.055, now + 0.006);
    thumpLevel.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    thump.connect(thumpLevel).connect(compressor);

    const scrape = context.createBufferSource();
    const scrapeFilter = context.createBiquadFilter();
    const scrapeLevel = context.createGain();
    scrape.buffer = noiseBuffer;
    scrapeFilter.type = "bandpass";
    scrapeFilter.frequency.value = 540 + amount * 620;
    scrapeFilter.Q.value = 0.8;
    scrapeLevel.gain.setValueAtTime(0.025 + amount * 0.035, now);
    scrapeLevel.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.7);
    scrape.connect(scrapeFilter).connect(scrapeLevel).connect(compressor);

    thump.onended = () => {
      thump.disconnect();
      thumpLevel.disconnect();
    };
    scrape.onended = () => {
      scrape.disconnect();
      scrapeFilter.disconnect();
      scrapeLevel.disconnect();
    };
    const maximumOffset = Math.max(0, noiseBuffer.duration - duration);
    scrape.start(now, Math.random() * maximumOffset, duration);
    thump.start(now);
    thump.stop(now + duration);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.driving = false;
    this.safeStop(this.fundamental);
    this.safeStop(this.harmonic);
    this.safeStop(this.tireNoise);
    this.output?.dispose();
    this.audioEngine?.dispose();
    this.clearGraphReferences();
  }

  private async initializeInternal(): Promise<void> {
    if (typeof AudioContext === "undefined") return;
    let context: AudioContext | null = null;

    try {
      context = new AudioContext({ latencyHint: "interactive" });
      const audioEngine = await CreateAudioEngineAsync({
        audioContext: context,
        disableDefaultUI: true,
        parameterRampDuration: 0.025,
        resumeOnInteraction: true,
        resumeOnPause: true,
        volume: 0.55,
      });
      if (this.disposed) {
        audioEngine.dispose();
        return;
      }

      this.context = context;
      this.audioEngine = audioEngine;
      this.buildGraph(context);
      const compressor = this.compressor;
      if (!compressor) throw new Error("Vehicle audio graph could not be created");
      this.output = await CreateSoundSourceAsync(
        "player-vehicle-audio",
        compressor,
        { volume: 0.7 },
        audioEngine,
      );
      if (this.disposed) {
        this.output.dispose();
        audioEngine.dispose();
        this.clearGraphReferences();
        return;
      }

      this.fundamental?.start();
      this.harmonic?.start();
      this.tireNoise?.start();
      this.setDriveLevel(this.driving ? 1 : 0, 0.055);
    } catch (error) {
      this.safeStop(this.fundamental);
      this.safeStop(this.harmonic);
      this.safeStop(this.tireNoise);
      this.output?.dispose();
      this.audioEngine?.dispose();
      if (!this.audioEngine && context && context.state !== "closed") void context.close();
      this.clearGraphReferences();
      this.warnUnavailable(error);
    }
  }

  private buildGraph(context: AudioContext): void {
    const fundamental = context.createOscillator();
    const harmonic = context.createOscillator();
    const fundamentalLevel = context.createGain();
    const harmonicLevel = context.createGain();
    const engineLevel = context.createGain();
    const engineFilter = context.createBiquadFilter();
    const tireNoise = context.createBufferSource();
    const tireLevel = context.createGain();
    const tireFilter = context.createBiquadFilter();
    const driveLevel = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const noiseBuffer = createNoiseBuffer(context);

    fundamental.type = "sawtooth";
    fundamental.frequency.value = 48;
    harmonic.type = "triangle";
    harmonic.frequency.value = 96.5;
    fundamentalLevel.gain.value = 0.04;
    harmonicLevel.gain.value = 0.018;
    engineLevel.gain.value = 0.46;
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 420;
    engineFilter.Q.value = 0.75;

    tireNoise.buffer = noiseBuffer;
    tireNoise.loop = true;
    tireLevel.gain.value = 0.002;
    tireFilter.type = "bandpass";
    tireFilter.frequency.value = 850;
    tireFilter.Q.value = 0.55;
    driveLevel.gain.value = 0;

    compressor.threshold.value = -18;
    compressor.knee.value = 10;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.16;

    fundamental.connect(fundamentalLevel).connect(engineLevel);
    harmonic.connect(harmonicLevel).connect(engineLevel);
    engineLevel.connect(engineFilter).connect(driveLevel);
    tireNoise.connect(tireFilter).connect(tireLevel).connect(driveLevel);
    driveLevel.connect(compressor);

    this.fundamental = fundamental;
    this.harmonic = harmonic;
    this.tireNoise = tireNoise;
    this.noiseBuffer = noiseBuffer;
    this.engineLevel = engineLevel;
    this.tireLevel = tireLevel;
    this.driveLevel = driveLevel;
    this.engineFilter = engineFilter;
    this.tireFilter = tireFilter;
    this.compressor = compressor;
  }

  private setDriveLevel(value: number, timeConstant: number): void {
    if (!this.context || !this.driveLevel) return;
    smoothParameter(this.driveLevel.gain, value, this.context.currentTime, timeConstant);
  }

  private safeStop(node: OscillatorNode | AudioBufferSourceNode | null): void {
    if (!node) return;
    try {
      node.stop();
    } catch {
      // A source can only be stopped after it has started, and only once.
    }
    node.disconnect();
  }

  private clearGraphReferences(): void {
    this.initialization = null;
    this.audioEngine = null;
    this.context = null;
    this.output = null;
    this.fundamental = null;
    this.harmonic = null;
    this.tireNoise = null;
    this.noiseBuffer = null;
    this.engineLevel = null;
    this.tireLevel = null;
    this.driveLevel = null;
    this.engineFilter = null;
    this.tireFilter = null;
    this.compressor = null;
  }

  private warnUnavailable(error: unknown): void {
    if (this.warned || this.disposed) return;
    this.warned = true;
    console.warn("Procedural vehicle audio is unavailable.", error);
  }
}
