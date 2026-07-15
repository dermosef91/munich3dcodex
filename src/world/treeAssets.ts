import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import "@babylonjs/core/Meshes/instancedMesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { TreeFeature } from "./types";

const MIN_TREE_HEIGHT = 2.5;
const MAX_TREE_HEIGHT = 22;

interface TreeTemplates {
  stem: Mesh;
  leaves: Mesh;
  baseHeight: number;
  baseCrownWidth: number;
  materials: StandardMaterial[];
  mode: "selfmade-low-poly";
}

interface TreeTransform {
  id: number;
  position: Vector3;
  rotation: Quaternion;
  scaling: Vector3;
}

export interface TreeTileMeshes {
  meshes: AbstractMesh[];
  shadowCasters: AbstractMesh[];
}

const renderers = new WeakMap<Scene, Promise<TreeAssetRenderer>>();

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function random01(id: number, salt: number): number {
  let value = (Math.trunc(id) ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 0x1_0000_0000;
}

function createTreeTemplates(scene: Scene): TreeTemplates {
  const bark = new StandardMaterial("selfmade-tree-bark", scene);
  bark.diffuseColor = new Color3(0.2, 0.185, 0.17);
  bark.ambientColor = new Color3(0.38, 0.36, 0.33);
  bark.specularColor = Color3.Black();
  bark.backFaceCulling = true;

  const foliage = new StandardMaterial("selfmade-tree-foliage", scene);
  // A muted, slightly cool green shares the overcast scene's blue-gray cast.
  // The ambient response also keeps the faceted canopy from becoming nearly
  // black on its unlit faces.
  foliage.diffuseColor = new Color3(0.24, 0.29, 0.23);
  foliage.ambientColor = new Color3(0.42, 0.46, 0.41);
  foliage.specularColor = Color3.Black();
  foliage.backFaceCulling = true;

  // A tapered trunk and two forks remain one instanced mesh and one draw call.
  // The forks break the old "canopy on a pole" silhouette for little geometry.
  const trunk = MeshBuilder.CreateCylinder(
    "selfmade-tree-template-trunk",
    { height: 7.1, diameterTop: 0.3, diameterBottom: 0.64, tessellation: 6 },
    scene,
  );
  trunk.position.y = 3.55;
  trunk.bakeCurrentTransformIntoVertices();

  const branchSpecs = [
    { x: -0.58, y: 7.05, z: 0.08, rotationX: -0.12, rotationZ: 0.55 },
    { x: 0.55, y: 7.12, z: -0.12, rotationX: 0.16, rotationZ: -0.52 },
  ];
  const branches = branchSpecs.map((spec, index) => {
    const branch = MeshBuilder.CreateCylinder(
      `selfmade-tree-template-branch-${index}`,
      { height: 2.35, diameterTop: 0.17, diameterBottom: 0.34, tessellation: 5 },
      scene,
    );
    branch.position.set(spec.x, spec.y, spec.z);
    branch.rotation.set(spec.rotationX, 0, spec.rotationZ);
    branch.bakeCurrentTransformIntoVertices();
    return branch;
  });
  const stemParts = [trunk, ...branches];
  const stem = Mesh.MergeMeshes(stemParts, true, true, undefined, false, false);
  if (!stem) {
    for (const part of stemParts) part.dispose(false, false);
    bark.dispose(false, false);
    foliage.dispose(false, false);
    throw new Error("Unable to create the self-made tree trunk");
  }
  stem.name = "selfmade-tree-template-stem";
  stem.id = stem.name;
  stem.material = bark;
  stem.isPickable = false;

  // Four overlapping, deliberately uneven lobes form one wider crown. Random
  // per-tree yaw turns this single asymmetric template into many silhouettes.
  const canopySpecs = [
    { x: -1.25, y: 8.25, z: 0.12, scale: new Vector3(1.16, 0.72, 1.04) },
    { x: 1.18, y: 8.38, z: -0.28, scale: new Vector3(1.1, 0.76, 0.98) },
    { x: 0.05, y: 8.85, z: 1.05, scale: new Vector3(1.12, 0.8, 0.96) },
    { x: -0.18, y: 10.02, z: 0.08, scale: new Vector3(0.94, 0.76, 0.9) },
  ];
  const lobes = canopySpecs.map((spec, index) => {
    const lobe = MeshBuilder.CreateIcoSphere(
      `selfmade-tree-template-canopy-lobe-${index}`,
      { radius: 2.05, subdivisions: 1, flat: true },
      scene,
    );
    lobe.position.set(spec.x, spec.y, spec.z);
    lobe.scaling.copyFrom(spec.scale);
    lobe.bakeCurrentTransformIntoVertices();
    return lobe;
  });
  const leaves = Mesh.MergeMeshes(lobes, true, true, undefined, false, false);
  if (!leaves) {
    stem.dispose(false, false);
    bark.dispose(false, false);
    foliage.dispose(false, false);
    throw new Error("Unable to create the self-made tree canopy");
  }
  leaves.name = "selfmade-tree-template-foliage";
  leaves.id = leaves.name;
  leaves.material = foliage;
  leaves.isPickable = false;
  stem.setEnabled(false);
  leaves.setEnabled(false);

  return {
    stem,
    leaves,
    baseHeight: 11.58,
    baseCrownWidth: 6.95,
    materials: [bark, foliage],
    mode: "selfmade-low-poly",
  };
}

function createTreeTransforms(
  trees: readonly TreeFeature[],
  baseHeight: number,
  baseCrownWidth: number,
): TreeTransform[] {
  const transforms: TreeTransform[] = [];

  for (const tree of trees) {
    if (!Number.isFinite(tree.point[0]) || !Number.isFinite(tree.point[1])) continue;
    if (!Number.isFinite(tree.height) || tree.height <= 0) continue;

    const height = clamp(tree.height, MIN_TREE_HEIGHT, MAX_TREE_HEIGHT);
    const verticalScale = height / baseHeight;
    const naturalWidth = baseCrownWidth * verticalScale;
    const requestedWidth = tree.crownDiameter && Number.isFinite(tree.crownDiameter)
      ? tree.crownDiameter
      : naturalWidth * (0.86 + random01(tree.id, 0x729a) * 0.28);
    const horizontalScale = clamp(
      requestedWidth / baseCrownWidth,
      verticalScale * 0.62,
      verticalScale * 1.48,
    );
    const yaw = random01(tree.id, 0x4af3) * Math.PI * 2;
    const rotation = new Quaternion();
    Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, rotation);
    transforms.push({
      id: tree.id,
      position: new Vector3(
        tree.point[0],
        0,
        tree.point[1],
      ),
      rotation,
      scaling: new Vector3(horizontalScale, verticalScale, horizontalScale),
    });
  }

  return transforms;
}

/** Scene-level self-made low-poly templates with per-tile hardware-instance batches. */
export class TreeAssetRenderer {
  readonly mode: TreeTemplates["mode"];
  private readonly liveMeshes = new Set<AbstractMesh>();
  private readonly compilationTasks = new Map<string, Promise<void>>();
  private disposed = false;

  private constructor(
    private readonly scene: Scene,
    private readonly templates: TreeTemplates,
  ) {
    this.mode = templates.mode;
  }

  static async Load(scene: Scene): Promise<TreeAssetRenderer> {
    return new TreeAssetRenderer(scene, createTreeTemplates(scene));
  }

  private prepareMaterial(mesh: Mesh, useInstances: boolean): void {
    const material = mesh.material;
    if (!material) return;
    const key = `${material.uniqueId}:${Number(useInstances)}:${mesh.getVerticesDataKinds().sort().join(",")}`;
    if (this.compilationTasks.has(key)) return;
    const task = material.forceCompilationAsync(mesh, { useInstances }).catch((error: unknown) => {
      console.warn(`Tree material ${material.name} could not be prepared.`, error);
    });
    this.compilationTasks.set(key, task);
  }

  /** Resolves after every tree material variant queued by loaded tiles is drawable. */
  async whenReady(): Promise<void> {
    await Promise.all(this.compilationTasks.values());
  }

  private createBatch(
    batchName: string,
    stemTemplate: Mesh,
    leafTemplate: Mesh,
    transforms: readonly TreeTransform[],
  ): TreeTileMeshes {
    if (transforms.length === 0) return { meshes: [], shadowCasters: [] };

    const stem = stemTemplate.clone(`selfmade-tree-stems-${batchName}`, null, true);
    const leaves = leafTemplate.clone(`selfmade-tree-foliage-${batchName}`, null, true);
    if (!stem || !leaves) {
      stem?.dispose(false, false);
      leaves?.dispose(false, false);
      return { meshes: [], shadowCasters: [] };
    }

    for (const mesh of [stem, leaves]) {
      mesh.setEnabled(true);
      mesh.isVisible = true;
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      mesh.position.setAll(0);
      mesh.rotation.setAll(0);
      mesh.rotationQuaternion = null;
      mesh.scaling.setAll(1);
    }
    const track = (mesh: AbstractMesh): void => {
      mesh.isVisible = true;
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      this.liveMeshes.add(mesh);
      mesh.onDisposeObservable.addOnce(() => this.liveMeshes.delete(mesh));
    };

    const applyTransform = (mesh: AbstractMesh, transform: TreeTransform): void => {
      mesh.position.copyFrom(transform.position);
      mesh.rotationQuaternion = transform.rotation.clone();
      mesh.scaling.copyFrom(transform.scaling);
    };
    for (const mesh of [stem, leaves]) {
      applyTransform(mesh, transforms[0]);
      for (let index = 1; index < transforms.length; index += 1) {
        const instance = mesh.createInstance(`${mesh.name}-${index}`);
        instance.isPickable = false;
        instance.checkCollisions = false;
        applyTransform(instance, transforms[index]);
      }
    }
    track(stem);
    track(leaves);

    // One trunk source and one canopy source per tile. Babylon renders their
    // ordinary instances as two hardware-instanced batches, including shadows.
    this.prepareMaterial(stem, true);
    this.prepareMaterial(leaves, true);
    return { meshes: [stem, leaves], shadowCasters: [stem, leaves] };
  }

  createTileMeshes(
    tileId: string,
    trees: readonly TreeFeature[] | undefined,
  ): TreeTileMeshes {
    if (this.disposed || !trees || trees.length === 0) return { meshes: [], shadowCasters: [] };
    const safeTileId = tileId.replace(/[^a-zA-Z0-9_-]/g, "-");
    const transforms = createTreeTransforms(
      trees,
      this.templates.baseHeight,
      this.templates.baseCrownWidth,
    );
    return this.createBatch(safeTileId, this.templates.stem, this.templates.leaves, transforms);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of [...this.liveMeshes]) mesh.dispose(false, false);
    this.liveMeshes.clear();
    this.templates.stem.dispose(false, false);
    this.templates.leaves.dispose(false, false);
    for (const material of this.templates.materials) material.dispose(false, false);
    this.compilationTasks.clear();
    renderers.delete(this.scene);
  }
}

/** Loads one shared self-made tree renderer per scene. */
export function loadTreeAssets(scene: Scene): Promise<TreeAssetRenderer> {
  const cached = renderers.get(scene);
  if (cached) return cached;
  const renderer = TreeAssetRenderer.Load(scene);
  renderers.set(scene, renderer);
  void renderer.then((value) => {
    if (scene.isDisposed) value.dispose();
    else scene.onDisposeObservable.addOnce(() => value.dispose());
  }).catch(() => {
    renderers.delete(scene);
  });
  return renderer;
}
