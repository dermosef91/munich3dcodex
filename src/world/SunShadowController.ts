import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import type { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import type { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

export const SHADOW_QUALITIES = ["off", "low", "medium", "high"] as const;
export type ShadowQuality = (typeof SHADOW_QUALITIES)[number];

export interface ShadowProfile {
  mapSize: number;
  cascades: number;
  maxDistance: number;
  refreshRate: number;
  filteringQuality: number;
  includeTrees: boolean;
  darkness: number;
}

export const SHADOW_PROFILES: Readonly<Record<Exclude<ShadowQuality, "off">, ShadowProfile>> = {
  low: {
    mapSize: 1_024,
    cascades: 2,
    maxDistance: 90,
    refreshRate: RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYTWOFRAMES,
    filteringQuality: ShadowGenerator.QUALITY_LOW,
    includeTrees: true,
    darkness: 0.24,
  },
  medium: {
    mapSize: 1_024,
    cascades: 2,
    maxDistance: 150,
    refreshRate: RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYTWOFRAMES,
    filteringQuality: ShadowGenerator.QUALITY_LOW,
    includeTrees: true,
    // Keep shade legible beneath the brighter sky fill; the sun direction is
    // still visible without the near-black street canyons of the old grade.
    darkness: 0.12,
  },
  high: {
    mapSize: 2_048,
    cascades: 3,
    maxDistance: 240,
    refreshRate: RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME,
    filteringQuality: ShadowGenerator.QUALITY_MEDIUM,
    includeTrees: true,
    darkness: 0.12,
  },
};

export interface TileShadowMeshes {
  buildingCasters: readonly AbstractMesh[];
  treeCasters: readonly AbstractMesh[];
  receivers: readonly AbstractMesh[];
}

interface RegisteredTile {
  buildingCasters: AbstractMesh[];
  treeCasters: AbstractMesh[];
  receivers: AbstractMesh[];
}

export function parseShadowQuality(value: string | null | undefined): ShadowQuality | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  return SHADOW_QUALITIES.find((quality) => quality === normalized) ?? null;
}

export function resolveShadowQuality(
  searchParams: URLSearchParams,
): ShadowQuality {
  return parseShadowQuality(searchParams.get("shadows"))
    ?? "medium";
}

/** Keeps the expensive sun-shadow work local while streamed city geometry stays broad. */
export class SunShadowController {
  readonly profile: ShadowProfile | null;
  readonly generator: CascadedShadowGenerator | null;
  private readonly tiles = new Map<string, RegisteredTile>();
  private readonly dynamicCasters = new Map<string, AbstractMesh[]>();
  private treeCastersEnabled: boolean;

  constructor(
    private readonly scene: Scene,
    private readonly camera: UniversalCamera,
    private readonly sun: DirectionalLight,
    readonly quality: ShadowQuality,
  ) {
    this.profile = quality === "off" ? null : SHADOW_PROFILES[quality];
    this.treeCastersEnabled = this.profile?.includeTrees ?? false;
    if (!this.profile || !CascadedShadowGenerator.IsSupported) {
      this.generator = null;
      if (this.profile) console.warn("Cascaded sun shadows are unavailable on this graphics device.");
      return;
    }

    const generator = new CascadedShadowGenerator(
      this.profile.mapSize,
      this.sun,
      false,
      this.camera,
    );
    generator.numCascades = this.profile.cascades;
    generator.shadowMaxZ = this.profile.maxDistance;
    generator.lambda = 0.72;
    generator.stabilizeCascades = true;
    generator.cascadeBlendPercentage = 0.08;
    generator.usePercentageCloserFiltering = true;
    generator.filteringQuality = this.profile.filteringQuality;
    generator.bias = 0.0007;
    generator.normalBias = 0.022;
    generator.darkness = this.profile.darkness;
    generator.frustumEdgeFalloff = 0.12;
    const shadowMap = generator.getShadowMap();
    if (shadowMap) shadowMap.refreshRate = this.profile.refreshRate;
    this.generator = generator;

    this.scene.onDisposeObservable.addOnce(() => this.dispose());
  }

  get enabled(): boolean {
    return this.generator !== null;
  }

  get maxDistance(): number {
    return this.profile?.maxDistance ?? 0;
  }

  get casterCount(): number {
    return this.generator?.getShadowMap()?.renderList?.length ?? 0;
  }

  get treeShadowsEnabled(): boolean {
    return this.generator !== null && this.treeCastersEnabled;
  }

  registerTile(tileId: string, meshes: TileShadowMeshes): void {
    this.unregisterTile(tileId);
    if (!this.generator || !this.profile) return;

    const buildingCasters = [...meshes.buildingCasters].filter((mesh) => !mesh.isDisposed());
    const treeCasters = this.profile.includeTrees
      ? [...meshes.treeCasters].filter((mesh) => !mesh.isDisposed())
      : [];
    const receivers = [...meshes.receivers].filter((mesh) => !mesh.isDisposed());

    for (const receiver of receivers) receiver.receiveShadows = true;
    for (const caster of buildingCasters) this.generator.addShadowCaster(caster, false);
    if (this.treeCastersEnabled) {
      for (const caster of treeCasters) this.generator.addShadowCaster(caster, false);
    }
    this.tiles.set(tileId, { buildingCasters, treeCasters, receivers });
    this.refreshCasterBounds();
  }

  unregisterTile(tileId: string): void {
    const registered = this.tiles.get(tileId);
    if (!registered) return;
    if (this.generator) {
      for (const caster of [...registered.buildingCasters, ...registered.treeCasters]) {
        if (!caster.isDisposed()) this.generator.removeShadowCaster(caster, false);
      }
      for (const receiver of registered.receivers) {
        if (!receiver.isDisposed()) receiver.receiveShadows = false;
      }
    }
    this.tiles.delete(tileId);
    this.refreshCasterBounds();
  }

  /** Removes the broad tree pass before sacrificing nearby building shadows. */
  setTreeCastersEnabled(enabled: boolean): void {
    const next = Boolean(this.generator && this.profile?.includeTrees && enabled);
    if (next === this.treeCastersEnabled) return;
    this.treeCastersEnabled = next;
    if (!this.generator) return;
    for (const tile of this.tiles.values()) {
      for (const caster of tile.treeCasters) {
        if (caster.isDisposed()) continue;
        if (next) this.generator.addShadowCaster(caster, false);
        else this.generator.removeShadowCaster(caster, false);
      }
    }
    this.refreshCasterBounds();
  }

  registerDynamicCasters(id: string, meshes: readonly AbstractMesh[]): void {
    this.unregisterDynamicCasters(id);
    if (!this.generator) return;

    const casters = meshes.filter((mesh) => (
      !mesh.isDisposed()
      && mesh.getTotalVertices() > 0
    ));
    for (const caster of casters) this.generator.addShadowCaster(caster, false);
    if (casters.length > 0) this.dynamicCasters.set(id, casters);
    this.refreshCasterBounds();
  }

  unregisterDynamicCasters(id: string): void {
    const casters = this.dynamicCasters.get(id);
    if (!casters) return;
    if (this.generator) {
      for (const caster of casters) {
        if (!caster.isDisposed()) this.generator.removeShadowCaster(caster, false);
      }
    }
    this.dynamicCasters.delete(id);
    this.refreshCasterBounds();
  }

  async compile(): Promise<void> {
    if (!this.generator || this.casterCount === 0) return;
    // Building batches use the regular shadow variant while tree batches use
    // thin instances. Warm both before the first rendered frame so neither
    // shader path can introduce an exploration-time hitch.
    await Promise.all([
      this.generator.forceCompilationAsync({ useInstances: false }),
      this.generator.forceCompilationAsync({ useInstances: true }),
    ]);
  }

  dispose(): void {
    for (const id of [...this.dynamicCasters.keys()]) this.unregisterDynamicCasters(id);
    for (const tileId of [...this.tiles.keys()]) this.unregisterTile(tileId);
    this.generator?.dispose();
  }

  private refreshCasterBounds(): void {
    if (!this.generator || this.casterCount === 0) return;
    // Static streamed geometry can keep cached bounds. Moving vehicle casters
    // need live bounds so the cascades continue to include them as they drive.
    this.generator.freezeShadowCastersBoundingInfo = false;
    if (this.dynamicCasters.size === 0) {
      this.generator.freezeShadowCastersBoundingInfo = true;
    }
    this.generator.getShadowMap()?.resetRefreshCounter();
  }
}
