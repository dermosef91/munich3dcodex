export interface DistanceLodProfile {
  enableDistance: number;
  disableDistance: number;
}

export interface DistanceLodTarget {
  readonly position: { x: number; z: number };
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
}

export const STOREFRONT_DETAIL_LOD: Readonly<DistanceLodProfile> = {
  enableDistance: 350,
  disableDistance: 400,
};

/**
 * Applies a two-threshold distance gate without allocating per target.
 * Enabled details remain visible through the outer threshold; once hidden,
 * they must cross the inner threshold before returning, preventing pop-flap.
 */
export function updateDistanceLod(
  targets: readonly DistanceLodTarget[],
  observer: { x: number; z: number },
  profile: Readonly<DistanceLodProfile>,
): number {
  const enableDistanceSquared = profile.enableDistance * profile.enableDistance;
  const disableDistanceSquared = profile.disableDistance * profile.disableDistance;
  let visibleCount = 0;

  for (const target of targets) {
    const wasEnabled = target.isEnabled();
    const dx = target.position.x - observer.x;
    const dz = target.position.z - observer.z;
    const thresholdSquared = wasEnabled ? disableDistanceSquared : enableDistanceSquared;
    const enabled = dx * dx + dz * dz <= thresholdSquared;
    if (enabled !== wasEnabled) target.setEnabled(enabled);
    if (enabled) visibleCount += 1;
  }

  return visibleCount;
}
