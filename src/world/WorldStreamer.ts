import type { Scene } from "@babylonjs/core/scene";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { buildTileMeshSet } from "./meshBuilders";
import { createFallbackTile } from "./fallback";
import {
  decodeLod2Geometry,
  LOD2_BINARY_FORMAT,
  LOD2_BINARY_VERSION,
} from "./lod2Binary.mjs";
import { loadTreeAssets, type TreeAssetRenderer } from "./treeAssets";
import { fetchTerrainHeightGrid, terrainGridContains, terrainHeightFromGrids } from "./terrain";
import type { ParkingLayout } from "./parkingLayout";
import type { MunichManifest, MunichTile, TerrainHeightGrid, TileManifestEntry } from "./types";

type StatusCallback = (message: string, loaded: number, total: number) => void;
type WorldPosition = Pick<Vector3, "x" | "z">;

export interface StreamedTileShadowMeshes {
  buildingCasters: readonly AbstractMesh[];
  treeCasters: readonly AbstractMesh[];
  receivers: readonly AbstractMesh[];
}

interface LoadedTileMeshes {
  meshes: AbstractMesh[];
  shadows: StreamedTileShadowMeshes;
  terrain?: TerrainHeightGrid;
}

export class WorldStreamer {
  private manifest: MunichManifest | null = null;
  private loaded = new Map<string, LoadedTileMeshes>();
  private loading = new Set<string>();
  private lastUpdate = 0;
  private loadGeneration = 0;
  private latestPosition: WorldPosition = { x: 0, z: 0 };
  private treeAssets: TreeAssetRenderer | null = null;
  private onTileLoaded?: (
    tile: MunichTile,
    shadows: StreamedTileShadowMeshes,
    parkingLayout: ParkingLayout,
  ) => void;
  private onTileUnloaded?: (tileId: string) => void;

  constructor(
    private readonly scene: Scene,
    private readonly onStatus: StatusCallback,
    private readonly loadRadius = 780,
    private readonly unloadRadius = 1_120,
  ) {}

  async initialize(position: Vector3): Promise<void> {
    const treeAssetsPromise = loadTreeAssets(this.scene).catch((error: unknown) => {
      console.warn("Tree assets could not be prepared.", error);
      return null;
    });
    try {
      const response = await fetch("/data/manifest.json");
      if (!response.ok) throw new Error(`Manifest returned ${response.status}`);
      this.manifest = (await response.json()) as MunichManifest;
    } catch (error) {
      console.warn("Using the local fallback city because map data is unavailable.", error);
      this.manifest = this.fallbackManifest(position);
    }

    this.treeAssets = await treeAssetsPromise;
    await this.loadAround(position, true);
  }

  setTileLifecycleHandlers(
    onTileLoaded: (
      tile: MunichTile,
      shadows: StreamedTileShadowMeshes,
      parkingLayout: ParkingLayout,
    ) => void,
    onTileUnloaded: (tileId: string) => void,
  ): void {
    this.onTileLoaded = onTileLoaded;
    this.onTileUnloaded = onTileUnloaded;
  }

  async loadAround(position: Vector3, immediate = false): Promise<void> {
    if (!this.manifest) return;
    this.latestPosition = { x: position.x, z: position.z };
    const now = performance.now();
    if (!immediate && now - this.lastUpdate < 450) return;
    this.lastUpdate = now;
    const generation = ++this.loadGeneration;
    const target = { ...this.latestPosition };
    const requestedClearance = position.y;

    const nearby = this.manifest.tiles
      .filter((tile) => Math.hypot(target.x - tile.center[0], target.z - tile.center[1]) <= this.loadRadius)
      .sort((a, b) => this.distanceTo(a, target) - this.distanceTo(b, target));

    const required = nearby.filter((tile) => !this.loaded.has(tile.id) && !this.loading.has(tile.id));
    if (required.length > 0) {
      this.onStatus("Streaming city blocks", this.loaded.size, this.manifest.tiles.length);
      await Promise.all(required.map((tile) => this.loadTile(tile)));
      if (this.treeAssets) {
        this.onStatus("Preparing vegetation", this.loaded.size, this.manifest.tiles.length);
        await this.treeAssets.whenReady();
      }
    }

    // If another pass started while tiles were downloading, clean up against
    // the newest requested position. An older pass must never evict the
    // district the player just teleported or drove into.
    const unloadPosition = generation === this.loadGeneration ? target : this.latestPosition;
    for (const [id, loadedTile] of this.loaded) {
      const entry = this.manifest.tiles.find((tile) => tile.id === id);
      if (!entry || this.distanceTo(entry, unloadPosition) > this.unloadRadius) {
        try {
          this.onTileUnloaded?.(id);
        } catch (error) {
          console.error(`Tile unload lifecycle failed for ${id}.`, error);
        } finally {
          // Tile meshes share scene-level materials; unloading releases only
          // geometry and per-tile instance buffers.
          for (const mesh of loadedTile.meshes) mesh.dispose(false, false);
          this.loaded.delete(id);
        }
      }
    }

    if (generation === this.loadGeneration) {
      if (immediate
        && Math.hypot(position.x - target.x, position.z - target.z) < 0.25) {
        const terrainHeight = this.terrainHeightAt(target.x, target.z);
        if (terrainHeight !== undefined) position.y = terrainHeight + requestedClearance;
      }
      this.onStatus("Munich is ready", this.loaded.size, this.manifest.tiles.length);
    }
  }

  getAttribution(): string {
    return this.manifest?.attribution ?? "Map data © OpenStreetMap contributors";
  }

  /** Surveyed local world Y at a loaded point; flat legacy coverage is zero. */
  heightAt(x: number, z: number): number {
    return terrainHeightFromGrids(
      [...this.loaded.values()].map((tile) => tile.terrain),
      x,
      z,
    );
  }

  private terrainHeightAt(x: number, z: number): number | undefined {
    for (const loaded of this.loaded.values()) {
      if (loaded.terrain && terrainGridContains(loaded.terrain, x, z)) {
        return terrainHeightFromGrids([loaded.terrain], x, z);
      }
    }
    return undefined;
  }

  private distanceTo(tile: TileManifestEntry, position: WorldPosition): number {
    return Math.hypot(position.x - tile.center[0], position.z - tile.center[1]);
  }

  private async loadTile(entry: TileManifestEntry): Promise<void> {
    if (!this.manifest) return;
    this.loading.add(entry.id);
    try {
      let tile: MunichTile;
      try {
        const response = await fetch(entry.file);
        if (!response.ok) throw new Error(`Tile ${entry.id} returned ${response.status}`);
        tile = (await response.json()) as MunichTile;
      } catch (error) {
        console.warn(`Generating fallback tile ${entry.id}.`, error);
        tile = createFallbackTile(entry.id, entry.center, this.manifest.tileSize);
      }

      await Promise.all([
        this.loadLod2Geometry(tile),
        this.loadTerrain(tile),
      ]);

      const built = buildTileMeshSet(tile, this.manifest.tileSize, this.scene);
      const meshes: AbstractMesh[] = [...built.meshes];
      let treeMeshes = { meshes: [] as AbstractMesh[], shadowCasters: [] as AbstractMesh[] };
      try {
        treeMeshes = this.treeAssets?.createTileMeshes(entry.id, tile.trees, tile.terrainData) ?? treeMeshes;
        meshes.push(...treeMeshes.meshes);
      } catch (error) {
        for (const mesh of meshes) mesh.dispose(false, false);
        throw error;
      }
      const shadows: StreamedTileShadowMeshes = {
        buildingCasters: built.buildingShadowCasters,
        treeCasters: treeMeshes.shadowCasters,
        receivers: built.shadowReceivers,
      };
      this.loaded.set(entry.id, { meshes, shadows, terrain: tile.terrainData });
      try {
        this.onTileLoaded?.(tile, shadows, built.parkingLayout);
      } catch (error) {
        console.error(`Tile load lifecycle failed for ${entry.id}.`, error);
      }
    } catch (error) {
      console.error(`Unable to build tile ${entry.id}.`, error);
    } finally {
      this.loading.delete(entry.id);
    }
  }

  private async loadLod2Geometry(tile: MunichTile): Promise<void> {
    const sidecar = tile.lod2Geometry;
    if (!sidecar) return;
    try {
      if (sidecar.format !== LOD2_BINARY_FORMAT || sidecar.version !== LOD2_BINARY_VERSION) {
        throw new Error(`Unsupported format ${sidecar.format} v${sidecar.version}`);
      }
      if (!Number.isSafeInteger(sidecar.byteLength) || sidecar.byteLength <= 0) {
        throw new Error(`Invalid declared byte length ${sidecar.byteLength}`);
      }
      if (!Number.isSafeInteger(sidecar.buildingCount) || sidecar.buildingCount <= 0) {
        throw new Error(`Invalid declared building count ${sidecar.buildingCount}`);
      }

      const response = await fetch(sidecar.file);
      if (!response.ok) throw new Error(`Sidecar returned ${response.status}`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== sidecar.byteLength) {
        throw new Error(`Expected ${sidecar.byteLength} bytes, received ${bytes.byteLength}`);
      }
      const decoded = decodeLod2Geometry(bytes);
      if (decoded.records.length !== sidecar.buildingCount) {
        throw new Error(`Expected ${sidecar.buildingCount} buildings, decoded ${decoded.records.length}`);
      }

      const buildingsById = new Map(tile.buildings.map((building) => [building.id, building]));
      const assignments = decoded.records.map((record) => {
        const building = buildingsById.get(record.buildingId);
        if (!building) throw new Error(`Sidecar references missing building ${record.buildingId}`);
        return { building, geometry: record.geometry };
      });
      for (const { building, geometry } of assignments) building.geometry = geometry;
    } catch (error) {
      // Tile JSON remains authoritative for footprints and metadata. A missing
      // or corrupt optional sidecar therefore degrades only its semantic LoD2
      // meshes to the ordinary footprint extrusion path.
      console.warn(`LoD2 geometry unavailable for tile ${tile.id}; using building footprints.`, error);
    }
  }

  private async loadTerrain(tile: MunichTile): Promise<void> {
    if (!tile.terrain) return;
    try {
      tile.terrainData = await fetchTerrainHeightGrid(tile.terrain);
    } catch (error) {
      // Terrain is optional at runtime. A failed grid must not take its tile,
      // buildings, or transport network down with it.
      delete tile.terrainData;
      console.warn(`Terrain unavailable for tile ${tile.id}; using flat ground.`, error);
    }
  }

  private fallbackManifest(position: Vector3): MunichManifest {
    const tileSize = 500;
    const tiles: TileManifestEntry[] = [];
    const baseX = Math.floor(position.x / tileSize);
    const baseZ = Math.floor(position.z / tileSize);
    for (let x = baseX - 3; x <= baseX + 3; x += 1) {
      for (let z = baseZ - 3; z <= baseZ + 3; z += 1) {
        const id = `${x}_${z}`;
        tiles.push({ id, center: [(x + 0.5) * tileSize, (z + 0.5) * tileSize], file: `/data/tiles/${id}.json`, buildings: 0 });
      }
    }
    return {
      generatedAt: new Date().toISOString(),
      source: "Procedural fallback",
      attribution: "Prototype fallback geometry",
      origin: { lat: 48.151, lon: 11.572 },
      tileSize,
      bounds: { south: 48.13, west: 11.54, north: 48.18, east: 11.60 },
      tiles,
    };
  }
}
