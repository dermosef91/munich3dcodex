export interface PerformanceScalingEngine {
  getHardwareScalingLevel(): number;
  setHardwareScalingLevel(level: number): void;
}

export interface AdaptivePerformanceOptions {
  maxDevicePixelRatio?: number;
  maximumScalingLevel?: number;
  scalingStep?: number;
  sampleWindowMs?: number;
  warmupMs?: number;
  lowFps?: number;
  highFps?: number;
  lowSamplesBeforeChange?: number;
  highSamplesBeforeChange?: number;
  onConstrainedModeChange?: (constrained: boolean) => void;
}

export type AdaptivePerformanceMode = "quality" | "balanced" | "performance";

const EPSILON = 0.001;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundedScalingLevel(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

/**
 * Keeps exploration responsive by trading pixel density before scene detail.
 * Only after reaching the resolution floor does it request the constrained
 * mode used for the least noticeable secondary quality reductions.
 */
export class AdaptivePerformanceController {
  private bestScalingLevel: number;
  private maximumScalingLevel: number;
  private readonly configuredMaximumScalingLevel: number;
  private readonly maxDevicePixelRatio: number;
  private readonly scalingStep: number;
  private readonly sampleWindowMs: number;
  private readonly warmupMs: number;
  private readonly lowFps: number;
  private readonly highFps: number;
  private readonly lowSamplesBeforeChange: number;
  private readonly highSamplesBeforeChange: number;
  private readonly onConstrainedModeChange?: (constrained: boolean) => void;
  private startedAt: number | null = null;
  private windowStartedAt: number | null = null;
  private accumulatedFrameTime = 0;
  private accumulatedFrames = 0;
  private consecutiveLowSamples = 0;
  private consecutiveHighSamples = 0;
  private constrained = false;
  private averageFps = 0;

  constructor(
    private readonly engine: PerformanceScalingEngine,
    devicePixelRatio: number,
    options: AdaptivePerformanceOptions = {},
  ) {
    this.maxDevicePixelRatio = options.maxDevicePixelRatio ?? 1.5;
    const deviceRatioCap = this.scalingLevelForDevicePixelRatio(devicePixelRatio);
    this.bestScalingLevel = roundedScalingLevel(Math.max(
      engine.getHardwareScalingLevel(),
      deviceRatioCap,
    ));
    this.configuredMaximumScalingLevel = options.maximumScalingLevel ?? 1.25;
    this.maximumScalingLevel = Math.max(this.bestScalingLevel, this.configuredMaximumScalingLevel);
    this.scalingStep = options.scalingStep ?? 0.125;
    this.sampleWindowMs = options.sampleWindowMs ?? 1_200;
    this.warmupMs = options.warmupMs ?? 4_000;
    this.lowFps = options.lowFps ?? 50;
    this.highFps = options.highFps ?? 58;
    this.lowSamplesBeforeChange = options.lowSamplesBeforeChange ?? 2;
    this.highSamplesBeforeChange = options.highSamplesBeforeChange ?? 10;
    this.onConstrainedModeChange = options.onConstrainedModeChange;

    if (Math.abs(engine.getHardwareScalingLevel() - this.bestScalingLevel) > EPSILON) {
      engine.setHardwareScalingLevel(this.bestScalingLevel);
    }
  }

  get mode(): AdaptivePerformanceMode {
    if (this.constrained || this.currentScalingLevel >= this.maximumScalingLevel - EPSILON) {
      return "performance";
    }
    if (this.currentScalingLevel > this.bestScalingLevel + EPSILON) return "balanced";
    return "quality";
  }

  get currentScalingLevel(): number {
    return this.engine.getHardwareScalingLevel();
  }

  get renderPixelRatio(): number {
    return 1 / this.currentScalingLevel;
  }

  get sampledFps(): number {
    return this.averageFps;
  }

  update(deltaMilliseconds: number, now: number): void {
    if (!Number.isFinite(deltaMilliseconds) || deltaMilliseconds <= 0 || deltaMilliseconds > 250) {
      this.resetSampling(now);
      return;
    }
    if (this.startedAt === null) {
      this.startedAt = now;
      this.windowStartedAt = now;
    }
    if (now - this.startedAt < this.warmupMs) {
      this.resetWindow(now);
      return;
    }

    this.accumulatedFrameTime += deltaMilliseconds;
    this.accumulatedFrames += 1;
    if (this.windowStartedAt === null) this.windowStartedAt = now;
    if (now - this.windowStartedAt < this.sampleWindowMs) return;

    this.averageFps = this.accumulatedFrameTime > 0
      ? this.accumulatedFrames * 1_000 / this.accumulatedFrameTime
      : 0;
    this.resetWindow(now);
    this.evaluateSample();
  }

  resetSampling(now: number): void {
    this.startedAt = now;
    this.consecutiveLowSamples = 0;
    this.consecutiveHighSamples = 0;
    this.resetWindow(now);
  }

  handleDevicePixelRatio(devicePixelRatio: number): void {
    const previousBest = this.bestScalingLevel;
    const degradation = Math.max(0, this.currentScalingLevel - previousBest);
    this.bestScalingLevel = this.scalingLevelForDevicePixelRatio(devicePixelRatio);
    this.maximumScalingLevel = Math.max(
      this.bestScalingLevel,
      this.configuredMaximumScalingLevel,
    );
    this.setScalingLevel(this.bestScalingLevel + degradation);
  }

  private evaluateSample(): void {
    if (this.averageFps < this.lowFps) {
      this.consecutiveLowSamples += 1;
      this.consecutiveHighSamples = 0;
      if (this.consecutiveLowSamples >= this.lowSamplesBeforeChange) {
        this.consecutiveLowSamples = 0;
        this.reduceCost();
      }
      return;
    }
    if (this.averageFps > this.highFps) {
      this.consecutiveHighSamples += 1;
      this.consecutiveLowSamples = 0;
      if (this.consecutiveHighSamples >= this.highSamplesBeforeChange) {
        this.consecutiveHighSamples = 0;
        this.restoreQuality();
      }
      return;
    }
    this.consecutiveLowSamples = 0;
    this.consecutiveHighSamples = 0;
  }

  private reduceCost(): void {
    const current = this.currentScalingLevel;
    if (current < this.maximumScalingLevel - EPSILON) {
      this.setScalingLevel(Math.min(this.maximumScalingLevel, current + this.scalingStep));
      return;
    }
    this.setConstrained(true);
  }

  private restoreQuality(): void {
    if (this.constrained) {
      this.setConstrained(false);
      return;
    }
    const current = this.currentScalingLevel;
    if (current > this.bestScalingLevel + EPSILON) {
      this.setScalingLevel(Math.max(this.bestScalingLevel, current - this.scalingStep));
    }
  }

  private setScalingLevel(value: number): void {
    const next = roundedScalingLevel(clamp(
      value,
      this.bestScalingLevel,
      this.maximumScalingLevel,
    ));
    if (Math.abs(next - this.currentScalingLevel) <= EPSILON) return;
    this.engine.setHardwareScalingLevel(next);
  }

  private setConstrained(value: boolean): void {
    if (this.constrained === value) return;
    this.constrained = value;
    this.onConstrainedModeChange?.(value);
  }

  private resetWindow(now: number): void {
    this.windowStartedAt = now;
    this.accumulatedFrameTime = 0;
    this.accumulatedFrames = 0;
  }

  private scalingLevelForDevicePixelRatio(devicePixelRatio: number): number {
    const safeDevicePixelRatio = Math.max(
      1,
      Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1,
    );
    return roundedScalingLevel(1 / Math.min(safeDevicePixelRatio, this.maxDevicePixelRatio));
  }
}
