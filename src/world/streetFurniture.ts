import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type {
  BenchFeature,
  Point2,
  RoadFeature,
  StreetLampFeature,
} from "./types";

interface Batch {
  positions: number[];
  indices: number[];
  colors: number[];
}

interface FurnitureMaterials {
  structure: StandardMaterial;
  light: StandardMaterial;
}

const materialsByScene = new WeakMap<Scene, FurnitureMaterials>();
const METAL = new Color4(0.075, 0.085, 0.08, 1);
const WOOD = new Color4(0.32, 0.19, 0.105, 1);
const WARM_LIGHT = new Color4(1, 0.76, 0.42, 1);

function batch(): Batch {
  return { positions: [], indices: [], colors: [] };
}

function addVertex(target: Batch, point: [number, number, number], color: Color4): number {
  const index = target.positions.length / 3;
  target.positions.push(point[0], point[1], point[2]);
  target.colors.push(color.r, color.g, color.b, color.a);
  return index;
}

function addQuad(
  target: Batch,
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  d: [number, number, number],
  color: Color4,
): void {
  const start = addVertex(target, a, color);
  addVertex(target, b, color);
  addVertex(target, c, color);
  addVertex(target, d, color);
  target.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

function point3(
  center: Point2,
  right: Point2,
  forward: Point2,
  localX: number,
  y: number,
  localZ: number,
): [number, number, number] {
  return [
    center[0] + right[0] * localX + forward[0] * localZ,
    y,
    center[1] + right[1] * localX + forward[1] * localZ,
  ];
}

function addBox(
  target: Batch,
  center: Point2,
  right: Point2,
  forward: Point2,
  width: number,
  bottom: number,
  height: number,
  depth: number,
  color: Color4,
): void {
  const x = width / 2;
  const z = depth / 2;
  const top = bottom + height;
  const lbb = point3(center, right, forward, -x, bottom, -z);
  const rbb = point3(center, right, forward, x, bottom, -z);
  const lfb = point3(center, right, forward, -x, bottom, z);
  const rfb = point3(center, right, forward, x, bottom, z);
  const lbt = point3(center, right, forward, -x, top, -z);
  const rbt = point3(center, right, forward, x, top, -z);
  const lft = point3(center, right, forward, -x, top, z);
  const rft = point3(center, right, forward, x, top, z);

  addQuad(target, lbt, lft, rft, rbt, color); // top
  addQuad(target, lbb, rbb, rfb, lfb, color); // bottom
  addQuad(target, lfb, rfb, rft, lft, color); // front
  addQuad(target, rbb, lbb, lbt, rbt, color); // back
  addQuad(target, rfb, rbb, rbt, rft, color); // right
  addQuad(target, lbb, lfb, lft, lbt, color); // left
}

function addCylinder(
  target: Batch,
  center: Point2,
  bottom: number,
  height: number,
  radius: number,
  color: Color4,
  segments = 8,
): void {
  const top = bottom + height;
  const topCenter = addVertex(target, [center[0], top, center[1]], color);
  const bottomCenter = addVertex(target, [center[0], bottom, center[1]], color);
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    const nextAngle = ((index + 1) / segments) * Math.PI * 2;
    const current: Point2 = [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius];
    const next: Point2 = [center[0] + Math.cos(nextAngle) * radius, center[1] + Math.sin(nextAngle) * radius];
    addQuad(
      target,
      [current[0], bottom, current[1]],
      [current[0], top, current[1]],
      [next[0], top, next[1]],
      [next[0], bottom, next[1]],
      color,
    );
    const topCurrent = addVertex(target, [current[0], top, current[1]], color);
    const topNext = addVertex(target, [next[0], top, next[1]], color);
    target.indices.push(topCenter, topNext, topCurrent);
    const bottomCurrent = addVertex(target, [current[0], bottom, current[1]], color);
    const bottomNext = addVertex(target, [next[0], bottom, next[1]], color);
    target.indices.push(bottomCenter, bottomCurrent, bottomNext);
  }
}

interface RoadProjection {
  tangent: Point2;
  towardRoad: Point2;
  closest: Point2;
  distance: number;
  road: RoadFeature | null;
}

function closestRoadProjection(point: Point2, roads: RoadFeature[]): RoadProjection {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestTangent: Point2 = [1, 0];
  let bestToward: Point2 = [0, -1];
  let bestClosest: Point2 = [point[0], point[1]];
  let bestRoad: RoadFeature | null = null;

  for (const road of roads) {
    for (let index = 0; index < road.points.length - 1; index += 1) {
      const start = road.points[index];
      const end = road.points[index + 1];
      const dx = end[0] - start[0];
      const dz = end[1] - start[1];
      const lengthSquared = dx * dx + dz * dz;
      if (lengthSquared < 0.01) continue;
      const amount = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared));
      const closest: Point2 = [start[0] + dx * amount, start[1] + dz * amount];
      const offset: Point2 = [closest[0] - point[0], closest[1] - point[1]];
      const distance = Math.hypot(offset[0], offset[1]);
      if (distance >= bestDistance) continue;
      const length = Math.sqrt(lengthSquared);
      bestDistance = distance;
      bestTangent = [dx / length, dz / length];
      bestClosest = closest;
      bestRoad = road;
      bestToward = distance > 0.15
        ? [offset[0] / distance, offset[1] / distance]
        : [-dz / length, dx / length];
    }
  }

  return {
    tangent: bestTangent,
    towardRoad: bestToward,
    closest: bestClosest,
    distance: bestDistance,
    road: bestRoad,
  };
}

function closestRoadDirection(point: Point2, roads: RoadFeature[]): { tangent: Point2; towardRoad: Point2 } {
  const { tangent, towardRoad } = closestRoadProjection(point, roads);
  return { tangent, towardRoad };
}

function lampPolePosition(lamp: StreetLampFeature, roads: RoadFeature[]): Point2 {
  const projection = closestRoadProjection(lamp.point, roads);
  if (!projection.road) return lamp.point;

  const roadHalfWidth = Math.max(projection.road.width, 1.2) / 2;
  const curbClearance = 0.3;
  if (projection.distance > roadHalfWidth + curbClearance) return lamp.point;

  // OSM lamps are normally mapped on the pavement, but imperfectly aligned
  // road centre lines can put them inside our rendered carriageway. Move only
  // those lamps to the nearest curb, preserving the mapped side of the road.
  const outward: Point2 = [-projection.towardRoad[0], -projection.towardRoad[1]];
  return [
    projection.closest[0] + outward[0] * (roadHalfWidth + curbClearance),
    projection.closest[1] + outward[1] * (roadHalfWidth + curbClearance),
  ];
}

function addStreetLamp(
  structure: Batch,
  lights: Batch,
  lamp: StreetLampFeature,
  roads: RoadFeature[],
): void {
  const height = Math.max(3, Math.min(12, lamp.height ?? 5.7));
  const polePosition = lampPolePosition(lamp, roads);
  const { towardRoad } = closestRoadDirection(polePosition, roads);
  const right: Point2 = [towardRoad[1], -towardRoad[0]];
  const headCenter: Point2 = [
    polePosition[0] + towardRoad[0] * 0.34,
    polePosition[1] + towardRoad[1] * 0.34,
  ];
  const lensCenter: Point2 = [
    polePosition[0] + towardRoad[0] * 0.54,
    polePosition[1] + towardRoad[1] * 0.54,
  ];

  addCylinder(structure, polePosition, 0, height, 0.075, METAL, 8);
  addBox(structure, headCenter, right, towardRoad, 0.38, height - 0.05, 0.16, 0.72, METAL);
  addBox(lights, lensCenter, right, towardRoad, 0.28, height - 0.065, 0.035, 0.28, WARM_LIGHT);
}

function benchFrame(bench: BenchFeature, roads: RoadFeature[]): { right: Point2; forward: Point2 } {
  if (bench.direction !== undefined) {
    const radians = (bench.direction * Math.PI) / 180;
    const forward: Point2 = [Math.sin(radians), -Math.cos(radians)];
    // Keep the local X/Z basis positive so batched CCW faces retain outward
    // normals in the right-handed world frame.
    return { right: [forward[1], -forward[0]], forward };
  }
  const { tangent, towardRoad } = closestRoadDirection(bench.point, roads);
  const dot = tangent[0] * towardRoad[1] - tangent[1] * towardRoad[0];
  const right: Point2 = dot >= 0 ? tangent : [-tangent[0], -tangent[1]];
  return { right, forward: towardRoad };
}

function addBench(target: Batch, bench: BenchFeature, roads: RoadFeature[]): void {
  const { right, forward } = benchFrame(bench, roads);
  const width = Math.max(1.45, Math.min(3.2, (bench.seats ?? 3) * 0.57));
  const seatCenter: Point2 = [bench.point[0], bench.point[1]];
  const backCenter: Point2 = [
    bench.point[0] - forward[0] * 0.19,
    bench.point[1] - forward[1] * 0.19,
  ];
  addBox(target, seatCenter, right, forward, width, 0.46, 0.09, 0.48, WOOD);
  if (bench.backrest !== false) addBox(target, backCenter, right, forward, width, 0.63, 0.48, 0.09, WOOD);

  for (const along of [-0.36, 0.36]) {
    const legCenter: Point2 = [
      bench.point[0] + right[0] * width * along,
      bench.point[1] + right[1] * width * along,
    ];
    addBox(target, legCenter, right, forward, 0.09, 0, 0.48, 0.32, METAL);
  }
}

function furnitureMaterials(scene: Scene): FurnitureMaterials {
  const cached = materialsByScene.get(scene);
  if (cached) return cached;

  const structure = new StandardMaterial("street-furniture-structure", scene);
  structure.diffuseColor = Color3.White();
  structure.specularColor = new Color3(0.18, 0.18, 0.16);
  structure.ambientColor = new Color3(0.38, 0.38, 0.34);
  structure.freeze();

  const light = new StandardMaterial("street-furniture-light", scene);
  light.diffuseColor = new Color3(1, 0.78, 0.48);
  light.emissiveColor = new Color3(0.52, 0.31, 0.13);
  light.specularColor = Color3.White();
  light.freeze();

  const materials = { structure, light };
  materialsByScene.set(scene, materials);
  return materials;
}

function createMesh(name: string, scene: Scene, target: Batch, material: Material): Mesh | null {
  if (target.positions.length === 0) return null;
  const normals: number[] = [];
  VertexData.ComputeNormals(target.positions, target.indices, normals, { useRightHandedSystem: true });
  const data = new VertexData();
  data.positions = target.positions;
  data.indices = target.indices;
  data.normals = normals;
  data.colors = target.colors;
  const mesh = new Mesh(name, scene);
  mesh.sideOrientation = Material.CounterClockWiseSideOrientation;
  data.applyToMesh(mesh, false);
  mesh.material = material;
  mesh.useVertexColors = true;
  // One render batch spans a full tile. Making that mesh a collider would
  // force the collision coordinator through every remote lamp and bench in
  // the tile; dedicated local proxies can be added later if gameplay needs it.
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.freezeWorldMatrix();
  return mesh;
}

export function buildStreetFurniture(
  tileId: string,
  streetLamps: StreetLampFeature[] | undefined,
  benches: BenchFeature[] | undefined,
  roads: RoadFeature[],
  scene: Scene,
): Mesh[] {
  if (!streetLamps?.length && !benches?.length) return [];
  const structure = batch();
  const lights = batch();
  for (const lamp of streetLamps ?? []) addStreetLamp(structure, lights, lamp, roads);
  for (const bench of benches ?? []) addBench(structure, bench, roads);
  const materials = furnitureMaterials(scene);
  return [
    createMesh(`street-furniture-${tileId}`, scene, structure, materials.structure),
    createMesh(`street-lights-${tileId}`, scene, lights, materials.light),
  ].filter((mesh): mesh is Mesh => mesh !== null);
}
