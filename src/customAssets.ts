import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { lonLatToWorld } from "./world/geo";

export interface CustomAssetPlacement {
  name: string;
  file: string;
  lat: number;
  lon: number;
  rotationDegrees?: number;
  scale?: number;
  elevation?: number;
}

export type TerrainHeightProvider = (x: number, z: number) => number;

const FLAT_TERRAIN_HEIGHT: TerrainHeightProvider = () => 0;

function sampledTerrainHeight(
  heightAt: TerrainHeightProvider,
  x: number,
  z: number,
): number {
  const height = heightAt(x, z);
  return Number.isFinite(height) ? height : 0;
}

// Add exported GLB assets here. Coordinates keep art placement independent
// from the engine's local origin and the generated map tiles.
export const customAssets: CustomAssetPlacement[] = [];

/** Re-seats already loaded rigid GLBs when their streamed terrain becomes available. */
export function groundCustomAssets(
  scene: Scene,
  heightAt: TerrainHeightProvider = FLAT_TERRAIN_HEIGHT,
): void {
  for (const asset of customAssets) {
    const anchor = scene.getTransformNodeByName(`custom-${asset.name}`);
    if (!anchor) continue;
    const world = lonLatToWorld(asset.lon, asset.lat, asset.elevation ?? 0);
    anchor.position.y = world.y + sampledTerrainHeight(heightAt, world.x, world.z);
  }
}

export async function loadCustomAssets(
  scene: Scene,
  heightAt: TerrainHeightProvider = FLAT_TERRAIN_HEIGHT,
): Promise<void> {
  if (customAssets.length === 0) return;
  await import("@babylonjs/loaders/glTF");
  await Promise.all(customAssets.map(async (asset) => {
    const separator = asset.file.lastIndexOf("/");
    const rootUrl = asset.file.slice(0, separator + 1);
    const fileName = asset.file.slice(separator + 1);
    const result = await SceneLoader.ImportMeshAsync(null, rootUrl, fileName, scene);
    const anchor = new TransformNode(`custom-${asset.name}`, scene);
    const world = lonLatToWorld(asset.lon, asset.lat, asset.elevation ?? 0);
    world.y += sampledTerrainHeight(heightAt, world.x, world.z);
    anchor.position.copyFrom(world);
    anchor.rotation.y = ((asset.rotationDegrees ?? 0) * Math.PI) / 180;
    anchor.scaling.setAll(asset.scale ?? 1);
    for (const mesh of result.meshes) {
      if (!mesh.parent) mesh.parent = anchor;
      mesh.checkCollisions = true;
    }
  }));
}
