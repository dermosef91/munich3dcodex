import "@babylonjs/core/Collisions/collisionCoordinator";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { publicUrl } from "../../publicUrl";
import { lonLatToWorld } from "../geo";

const MICKY_STATUE_FILE = "assets/environment/MickyStatue/MickyStatueTextured.glb";

/** Load the user-supplied statue into the enclosed courtyard behind No. 46. */
export async function loadMickyStatue(scene: Scene, parent: TransformNode): Promise<readonly AbstractMesh[]> {
  const existing = scene.getTransformNodeByName("landmark-micky-statue");
  if (existing) return existing.getChildMeshes();

  await import("@babylonjs/loaders/glTF");
  const fileUrl = publicUrl(MICKY_STATUE_FILE);
  const separator = fileUrl.lastIndexOf("/");
  const result = await SceneLoader.ImportMeshAsync(
    null,
    fileUrl.slice(0, separator + 1),
    fileUrl.slice(separator + 1),
    scene,
  );

  const anchor = new TransformNode("landmark-micky-statue", scene);
  anchor.parent = parent;
  // Approximately 20 m behind the Elisabethstrasse facade, in the open gap
  // between No. 46, its eastern rear wing, and the low courtyard garage.
  anchor.position.copyFrom(lonLatToWorld(11.566_427_0, 48.159_681_3));
  anchor.rotation.y = -0.23;

  for (const mesh of result.meshes) {
    if (!mesh.parent) mesh.parent = anchor;
    mesh.checkCollisions = mesh.getTotalVertices() > 0;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
  }
  return result.meshes;
}
