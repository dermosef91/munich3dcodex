import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { lonLatToWorld } from "./world/geo";
import { publicUrl } from "./publicUrl";

export interface CustomAssetPlacement {
  name: string;
  file: string;
  lat: number;
  lon: number;
  rotationDegrees?: number;
  scale?: number;
  elevation?: number;
}

// Add exported GLB assets here. Coordinates keep art placement independent
// from the engine's local origin and the generated map tiles.
export const customAssets: CustomAssetPlacement[] = [];

export async function loadCustomAssets(scene: Scene): Promise<void> {
  if (customAssets.length === 0) return;
  await import("@babylonjs/loaders/glTF");
  await Promise.all(customAssets.map(async (asset) => {
    const fileUrl = publicUrl(asset.file);
    const separator = fileUrl.lastIndexOf("/");
    const rootUrl = fileUrl.slice(0, separator + 1);
    const fileName = fileUrl.slice(separator + 1);
    const result = await SceneLoader.ImportMeshAsync(null, rootUrl, fileName, scene);
    const anchor = new TransformNode(`custom-${asset.name}`, scene);
    anchor.position.copyFrom(lonLatToWorld(asset.lon, asset.lat, asset.elevation ?? 0));
    anchor.rotation.y = ((asset.rotationDegrees ?? 0) * Math.PI) / 180;
    anchor.scaling.setAll(asset.scale ?? 1);
    for (const mesh of result.meshes) {
      if (!mesh.parent) mesh.parent = anchor;
      mesh.checkCollisions = true;
    }
  }));
}
