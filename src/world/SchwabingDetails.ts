import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { ELISABETHSTRASSE_46_ID, getBuildingFacade } from "./facadeRegistry";
import {
  createHermannFriebDetails,
  groundHermannFriebDetails,
  type TerrainHeightProvider,
} from "./HermannFriebDetails";

const FLAT_TERRAIN_HEIGHT: TerrainHeightProvider = () => 0;
const terrainOffsets = new WeakMap<TransformNode, number>();

function sampledTerrainHeight(
  heightAt: TerrainHeightProvider,
  x: number,
  z: number,
): number {
  const height = heightAt(x, z);
  return Number.isFinite(height) ? height : 0;
}

function material(scene: Scene, name: string, diffuse: Color3, specular = Color3.Black()): StandardMaterial {
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = diffuse;
  result.specularColor = specular;
  return result;
}

function parentMesh(mesh: Mesh, root: TransformNode, position: Vector3, yaw = 0): Mesh {
  mesh.parent = root;
  mesh.position.copyFrom(position);
  mesh.rotation.y = yaw;
  mesh.isPickable = false;
  return mesh;
}

function createElisabethstrasse46Facade(scene: Scene, parent: TransformNode): void {
  const definition = getBuildingFacade(ELISABETHSTRASSE_46_ID);
  if (!definition?.frontEdge) return;
  const [startPoint, endPoint] = definition.frontEdge;
  const start = new Vector3(startPoint[0], 0, startPoint[1]);
  const end = new Vector3(endPoint[0], 0, endPoint[1]);
  const root = new TransformNode("elisabethstrasse-46-details", scene);
  root.parent = parent;
  const along = end.subtract(start).normalize();
  const outward = new Vector3(-along.z, 0, along.x);
  const yaw = -Math.atan2(along.z, along.x);
  const facadeLength = Vector3.Distance(start, end);
  const balconyRail = material(scene, "elisabeth-46-balcony-rail", new Color3(0.24, 0.09, 0.055), new Color3(0.08, 0.05, 0.035));
  const balconySlab = material(scene, "elisabeth-46-balcony-slab", new Color3(0.73, 0.71, 0.65));
  const eave = material(scene, "elisabeth-46-eave", new Color3(0.82, 0.81, 0.76));

  const addBalcony = (name: string, alongOffset: number, floorY: number, width: number, depth: number): void => {
    const center = start.add(along.scale(alongOffset)).add(outward.scale(depth * 0.48));
    parentMesh(
      MeshBuilder.CreateBox(`${name}-slab`, { width, height: 0.17, depth }, scene),
      root,
      center.add(new Vector3(0, floorY, 0)),
      yaw,
    ).material = balconySlab;

    const railY = floorY + 0.55;
    const frontOffset = depth * 0.96;
    const slatCount = Math.max(7, Math.round(width / 0.27));
    for (let index = 0; index < slatCount; index += 1) {
      const sideOffset = -width * 0.46 + (index / (slatCount - 1)) * width * 0.92;
      parentMesh(
        MeshBuilder.CreateBox(`${name}-front-slat-${index}`, { width: 0.055, height: 0.88, depth: 0.065 }, scene),
        root,
        center.add(along.scale(sideOffset)).add(outward.scale(frontOffset - depth * 0.48)).add(new Vector3(0, railY, 0)),
        yaw,
      ).material = balconyRail;
    }
    parentMesh(
      MeshBuilder.CreateBox(`${name}-front-cap`, { width: width * 0.96, height: 0.08, depth: 0.1 }, scene),
      root,
      center.add(outward.scale(frontOffset - depth * 0.48)).add(new Vector3(0, floorY + 1.01, 0)),
      yaw,
    ).material = balconyRail;

    for (const side of [-1, 1]) {
      const sidePosition = center.add(along.scale(side * width * 0.47));
      for (let index = 0; index < 5; index += 1) {
        const depthOffset = -depth * 0.34 + index * depth * 0.19;
        parentMesh(
          MeshBuilder.CreateBox(`${name}-side-${side}-slat-${index}`, { width: 0.055, height: 0.88, depth: 0.055 }, scene),
          root,
          sidePosition.add(outward.scale(depthOffset)).add(new Vector3(0, railY, 0)),
          yaw,
        ).material = balconyRail;
      }
    }
  };

  const balconyFloors = [3.45, 6.65, 9.85, 13.05, 16.25];
  balconyFloors.forEach((floorY, index) => {
    addBalcony(`elisabeth-46-main-balcony-${index}`, 20.4, floorY, 4.45, 1.42);
    addBalcony(`elisabeth-46-corner-balcony-${index}`, 1.35, floorY, 2.05, 1.08);
  });

  parentMesh(
    MeshBuilder.CreateBox("elisabeth-46-roof-eave", { width: facadeLength + 0.35, height: 0.18, depth: 0.72 }, scene),
    root,
    start.add(along.scale(facadeLength * 0.5)).add(outward.scale(0.25)).add(new Vector3(0, 21.02, 0)),
    yaw,
  ).material = eave;

  const plaqueTexture = new DynamicTexture("schwabing-address-46-texture", { width: 256, height: 160 }, scene, false);
  plaqueTexture.hasAlpha = false;
  plaqueTexture.drawText("46", null, 112, "bold 94px Georgia", "#24211c", "#e7dfca", true, true);
  const plaqueMaterial = new StandardMaterial("schwabing-address-46-material", scene);
  plaqueMaterial.diffuseTexture = plaqueTexture;
  plaqueMaterial.specularColor = Color3.Black();
  const plaquePosition = start.add(along.scale(22.15)).add(outward.scale(0.22)).add(new Vector3(0, 2.05, 0));
  parentMesh(
    // Babylon planes face local -Z. Turning the plaque around keeps its front
    // (and therefore its unmirrored UVs) facing the street/player side.
    MeshBuilder.CreatePlane("schwabing-address-46", { width: 0.44, height: 0.28, sideOrientation: Mesh.FRONTSIDE }, scene),
    root,
    plaquePosition,
    yaw + Math.PI,
  ).material = plaqueMaterial;
}

export function groundSchwabingDetails(
  scene: Scene,
  heightAt: TerrainHeightProvider = FLAT_TERRAIN_HEIGHT,
): void {
  const elisabethRoot = scene.getTransformNodeByName("elisabethstrasse-46-details");
  const definition = getBuildingFacade(ELISABETHSTRASSE_46_ID);
  if (elisabethRoot && definition?.frontEdge) {
    let offset = terrainOffsets.get(elisabethRoot);
    if (offset === undefined) {
      offset = elisabethRoot.position.y;
      terrainOffsets.set(elisabethRoot, offset);
    }
    const [start, end] = definition.frontEdge;
    const x = (start[0] + end[0]) * 0.5;
    const z = (start[1] + end[1]) * 0.5;
    elisabethRoot.position.y = offset + sampledTerrainHeight(heightAt, x, z);
  }
  groundHermannFriebDetails(scene, heightAt);
}

export function createSchwabingDetails(scene: Scene): TransformNode {
  const existing = scene.getTransformNodeByName("schwabing-details");
  if (existing) return existing;

  const root = new TransformNode("schwabing-details", scene);
  // Street furniture and vegetation now come exclusively from streamed OSM
  // features. This node remains only for reviewed, address-specific facade
  // details that cannot be derived from public map semantics.
  createElisabethstrasse46Facade(scene, root);
  createHermannFriebDetails(scene, root);
  groundSchwabingDetails(scene);
  return root;
}
