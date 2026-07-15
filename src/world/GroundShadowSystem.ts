import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

interface GroundShadowRegistration {
  node: TransformNode;
  width: number;
  length: number;
  groundY: number;
}

export interface GroundShadowOptions {
  width: number;
  length: number;
  groundY?: number;
}

const SEGMENTS = 24;
const INITIAL_CAPACITY = 32;

function createBlobMesh(scene: Scene): Mesh {
  const positions: number[] = [0, 0, 0];
  const indices: number[] = [];
  const normals: number[] = [0, 1, 0];
  const colors: number[] = [0, 0, 0, 0.30];

  for (const [radius, alpha] of [[0.62, 0.23], [1, 0]] as const) {
    for (let index = 0; index < SEGMENTS; index += 1) {
      const angle = (index / SEGMENTS) * Math.PI * 2;
      positions.push(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
      normals.push(0, 1, 0);
      colors.push(0, 0, 0, alpha);
    }
  }

  for (let index = 0; index < SEGMENTS; index += 1) {
    const next = (index + 1) % SEGMENTS;
    const inner = 1 + index;
    const innerNext = 1 + next;
    const outer = 1 + SEGMENTS + index;
    const outerNext = 1 + SEGMENTS + next;
    indices.push(0, innerNext, inner);
    indices.push(inner, innerNext, outerNext, inner, outerNext, outer);
  }

  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.colors = colors;

  const mesh = new Mesh("ground-contact-shadow-batch", scene);
  vertexData.applyToMesh(mesh, false);
  mesh.useVertexColors = true;
  mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.alwaysSelectAsActiveMesh = true;
  // Stay in the default render group: transparent submeshes already render
  // after opaque geometry there, while later groups clear depth by default
  // and would let these blobs show through cars or buildings.
  mesh.renderingGroupId = 0;

  const material = new StandardMaterial("ground-contact-shadow-material", scene);
  material.diffuseColor = Color3.Black();
  material.emissiveColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.disableLighting = true;
  material.backFaceCulling = false;
  material.freeze();
  mesh.material = material;
  return mesh;
}

/** One transparent thin-instance draw grounds every nearby vehicle and tram. */
export class GroundShadowSystem {
  private readonly registrations = new Map<string, GroundShadowRegistration>();
  private readonly mesh: Mesh;
  private matrixData = new Float32Array(INITIAL_CAPACITY * 16);
  private bufferInstalled = false;
  private disposed = false;
  visibleCount = 0;

  constructor(
    scene: Scene,
    private readonly camera: UniversalCamera,
    readonly maxDistance: number,
  ) {
    this.mesh = createBlobMesh(scene);
    this.mesh.thinInstanceSetBuffer("matrix", this.matrixData, 16, false);
    this.mesh.thinInstanceCount = 0;
    this.bufferInstalled = true;
    scene.onDisposeObservable.addOnce(() => this.dispose());
  }

  register(id: string, node: TransformNode, options: GroundShadowOptions): void {
    this.registrations.set(id, {
      node,
      width: options.width,
      length: options.length,
      groundY: options.groundY ?? 0.072,
    });
  }

  unregister(id: string): void {
    this.registrations.delete(id);
  }

  update(): void {
    if (this.disposed || this.maxDistance <= 0) {
      this.setVisibleCount(0);
      return;
    }

    const maxDistanceSquared = this.maxDistance * this.maxDistance;
    const camera = this.camera.position;
    const visible: GroundShadowRegistration[] = [];
    for (const registration of this.registrations.values()) {
      if (!registration.node.isEnabled() || registration.node.isDisposed()) continue;
      registration.node.computeWorldMatrix(true);
      const position = registration.node.getAbsolutePosition();
      const dx = position.x - camera.x;
      const dz = position.z - camera.z;
      if (dx * dx + dz * dz <= maxDistanceSquared) visible.push(registration);
    }

    this.ensureCapacity(visible.length);
    const scale = new Vector3();
    const translation = new Vector3();
    const matrix = new Matrix();
    for (let index = 0; index < visible.length; index += 1) {
      const registration = visible[index];
      const position = registration.node.getAbsolutePosition();
      scale.set(registration.width * 0.5, 1, registration.length * 0.5);
      translation.set(position.x, registration.groundY, position.z);
      Matrix.ComposeToRef(
        scale,
        registration.node.absoluteRotationQuaternion,
        translation,
        matrix,
      );
      matrix.copyToArray(this.matrixData, index * 16);
    }

    this.setVisibleCount(visible.length);
    if (visible.length > 0) this.mesh.thinInstanceBufferUpdated("matrix");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.registrations.clear();
    this.mesh.material?.dispose(false, false);
    this.mesh.dispose(false, false);
  }

  private ensureCapacity(count: number): void {
    if (count * 16 <= this.matrixData.length) return;
    let capacity = this.matrixData.length / 16;
    while (capacity < count) capacity *= 2;
    this.matrixData = new Float32Array(capacity * 16);
    this.mesh.thinInstanceSetBuffer("matrix", this.matrixData, 16, false);
    this.bufferInstalled = true;
  }

  private setVisibleCount(count: number): void {
    this.visibleCount = count;
    if (this.bufferInstalled) this.mesh.thinInstanceCount = count;
    this.mesh.setEnabled(count > 0);
  }
}
