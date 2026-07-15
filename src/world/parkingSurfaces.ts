import { Material } from "@babylonjs/core/Materials/material";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import earcut from "earcut";
import type {
  ParkingLayout,
  ParkingLayoutSurface,
  ParkingSurfaceExclusion,
} from "./parkingLayout";
import type { Point2 } from "./types";

export interface ParkingSurfaceMeshData {
  positions: number[];
  indices: number[];
  uvs: number[];
}

export interface ParkingSurfaceGeometry {
  bands: ParkingSurfaceMeshData;
  boundaries: ParkingSurfaceMeshData;
  renderedSurfaces: number;
}

interface Bounds2 {
  minimumX: number;
  maximumX: number;
  minimumZ: number;
  maximumZ: number;
}

// Carriageways top out at 5 cm, mapped crossings at 5.2 cm, and vehicle
// anchors ride at 5.5 cm. Parking remains visible without lifting vehicles.
export const PARKING_BAND_SURFACE_Y = 0.053;
export const PARKING_BOUNDARY_SURFACE_Y = 0.054;
export const PARKING_BOUNDARY_WIDTH = 0.1;

const MITER_LIMIT = 2.4;
const EPSILON = 1e-6;

function emptyMeshData(): ParkingSurfaceMeshData {
  return { positions: [], indices: [], uvs: [] };
}

function samePoint(left: Point2, right: Point2): boolean {
  return Math.abs(left[0] - right[0]) <= EPSILON
    && Math.abs(left[1] - right[1]) <= EPSILON;
}

function cleanPolygon(points: readonly Point2[]): Point2[] {
  const result: Point2[] = [];
  for (const point of points) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    const next: Point2 = [point[0], point[1]];
    if (result.length === 0 || !samePoint(result.at(-1) as Point2, next)) result.push(next);
  }
  if (result.length > 2 && samePoint(result[0], result.at(-1) as Point2)) result.pop();
  return result;
}

function polygonArea(points: readonly Point2[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index][0] * next[1] - next[0] * points[index][1];
  }
  return area * 0.5;
}

function segmentDirection(start: Point2, end: Point2): Point2 {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const length = Math.max(Math.hypot(dx, dz), EPSILON);
  return [dx / length, dz / length];
}

function ribbonOffset(points: readonly Point2[], index: number, distance: number): Point2 {
  const previousDirection = index > 0
    ? segmentDirection(points[index - 1], points[index])
    : segmentDirection(points[index], points[index + 1]);
  const nextDirection = index < points.length - 1
    ? segmentDirection(points[index], points[index + 1])
    : previousDirection;
  const previousNormal: Point2 = [-previousDirection[1], previousDirection[0]];
  const nextNormal: Point2 = [-nextDirection[1], nextDirection[0]];
  const sumX = previousNormal[0] + nextNormal[0];
  const sumZ = previousNormal[1] + nextNormal[1];
  const sumLength = Math.hypot(sumX, sumZ);
  if (sumLength <= EPSILON) return [nextNormal[0] * distance, nextNormal[1] * distance];
  const miterX = sumX / sumLength;
  const miterZ = sumZ / sumLength;
  const alignment = miterX * nextNormal[0] + miterZ * nextNormal[1];
  if (alignment <= EPSILON) return [nextNormal[0] * distance, nextNormal[1] * distance];
  const limit = Math.abs(distance) * MITER_LIMIT;
  const miterLength = Math.max(-limit, Math.min(limit, distance / alignment));
  return [miterX * miterLength, miterZ * miterLength];
}

function offsetPoint(points: readonly Point2[], index: number, distance: number): Point2 {
  const offset = ribbonOffset(points, index, distance);
  return [points[index][0] + offset[0], points[index][1] + offset[1]];
}

function polygonBounds(points: readonly Point2[]): Bounds2 {
  return {
    minimumX: Math.min(...points.map((point) => point[0])),
    maximumX: Math.max(...points.map((point) => point[0])),
    minimumZ: Math.min(...points.map((point) => point[1])),
    maximumZ: Math.max(...points.map((point) => point[1])),
  };
}

function boundsOverlap(left: Bounds2, right: Bounds2): boolean {
  return left.minimumX <= right.maximumX + EPSILON
    && left.maximumX + EPSILON >= right.minimumX
    && left.minimumZ <= right.maximumZ + EPSILON
    && left.maximumZ + EPSILON >= right.minimumZ;
}

function crossLine(start: Point2, end: Point2, point: Point2): number {
  return (end[0] - start[0]) * (point[1] - start[1])
    - (end[1] - start[1]) * (point[0] - start[0]);
}

function lineIntersection(
  start: Point2,
  end: Point2,
  lineStart: Point2,
  lineEnd: Point2,
): Point2 {
  const startDistance = crossLine(lineStart, lineEnd, start);
  const endDistance = crossLine(lineStart, lineEnd, end);
  const denominator = startDistance - endDistance;
  const progress = Math.abs(denominator) <= EPSILON ? 0 : startDistance / denominator;
  return [
    start[0] + (end[0] - start[0]) * progress,
    start[1] + (end[1] - start[1]) * progress,
  ];
}

function clipHalfPlane(
  polygon: readonly Point2[],
  lineStart: Point2,
  lineEnd: Point2,
  keepInside: boolean,
): Point2[] {
  if (polygon.length < 3) return [];
  const result: Point2[] = [];
  const accepted = (point: Point2): boolean => {
    const distance = crossLine(lineStart, lineEnd, point);
    return keepInside ? distance >= -EPSILON : distance <= EPSILON;
  };
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const currentInside = accepted(current);
    const previousInside = accepted(previous);
    if (currentInside !== previousInside) {
      result.push(lineIntersection(previous, current, lineStart, lineEnd));
    }
    if (currentInside) result.push(current);
  }
  const clean = cleanPolygon(result);
  return clean.length >= 3 && Math.abs(polygonArea(clean)) > EPSILON ? clean : [];
}

/** Subtract one convex triangle from one convex patch without raster masks. */
function subtractTriangle(subject: readonly Point2[], triangleInput: readonly Point2[]): Point2[][] {
  let triangle = cleanPolygon(triangleInput);
  if (triangle.length !== 3) return [cleanPolygon(subject)];
  if (polygonArea(triangle) < 0) triangle = [...triangle].reverse();
  let remaining: Point2[][] = [cleanPolygon(subject)];
  const outside: Point2[][] = [];
  for (let edge = 0; edge < 3 && remaining.length > 0; edge += 1) {
    const start = triangle[edge];
    const end = triangle[(edge + 1) % 3];
    const nextRemaining: Point2[][] = [];
    for (const polygon of remaining) {
      const outsidePiece = clipHalfPlane(polygon, start, end, false);
      if (outsidePiece.length >= 3) outside.push(outsidePiece);
      const insidePiece = clipHalfPlane(polygon, start, end, true);
      if (insidePiece.length >= 3) nextRemaining.push(insidePiece);
    }
    remaining = nextRemaining;
  }
  return outside;
}

function exclusionTriangles(exclusions: readonly ParkingSurfaceExclusion[]): Point2[][] {
  const triangles: Point2[][] = [];
  for (const exclusion of exclusions) {
    const outline = cleanPolygon(exclusion.outline);
    if (outline.length < 3) continue;
    const indices = earcut(outline.flatMap(([x, z]) => [x, z]));
    for (let index = 0; index < indices.length; index += 3) {
      triangles.push([
        outline[indices[index]],
        outline[indices[index + 1]],
        outline[indices[index + 2]],
      ]);
    }
  }
  return triangles;
}

function clipPatches(patches: Point2[][], exclusions: readonly ParkingSurfaceExclusion[]): Point2[][] {
  const triangles = exclusionTriangles(exclusions).map((points) => ({
    points,
    bounds: polygonBounds(points),
  }));
  let result = patches;
  for (const exclusion of triangles) {
    result = result.flatMap((patch) => (
      boundsOverlap(polygonBounds(patch), exclusion.bounds)
        ? subtractTriangle(patch, exclusion.points)
        : [patch]
    ));
  }
  return result;
}

function surfacePatches(surface: ParkingLayoutSurface): Point2[][] {
  if (surface.kind === "polygon") {
    const outline = cleanPolygon(surface.outline);
    const indices = earcut(outline.flatMap(([x, z]) => [x, z]));
    const result: Point2[][] = [];
    for (let index = 0; index < indices.length; index += 3) {
      result.push([
        outline[indices[index]],
        outline[indices[index + 1]],
        outline[indices[index + 2]],
      ]);
    }
    return result;
  }
  const points = cleanPolygon(surface.points);
  if (points.length < 2) return [];
  const halfWidth = surface.width * 0.5;
  const result: Point2[][] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    result.push([
      offsetPoint(points, index, halfWidth),
      offsetPoint(points, index + 1, halfWidth),
      offsetPoint(points, index + 1, -halfWidth),
      offsetPoint(points, index, -halfWidth),
    ]);
  }
  return result;
}

function boundaryPatches(surface: ParkingLayoutSurface): Point2[][] {
  if (surface.kind === "ribbon") {
    const points = cleanPolygon(surface.points);
    if (points.length < 2) return [];
    const halfWidth = surface.width * 0.5;
    const inset = Math.max(0, halfWidth - PARKING_BOUNDARY_WIDTH);
    const result: Point2[][] = [];
    for (let index = 0; index < points.length - 1; index += 1) {
      result.push(
        [
          offsetPoint(points, index, halfWidth),
          offsetPoint(points, index + 1, halfWidth),
          offsetPoint(points, index + 1, inset),
          offsetPoint(points, index, inset),
        ],
        [
          offsetPoint(points, index, -inset),
          offsetPoint(points, index + 1, -inset),
          offsetPoint(points, index + 1, -halfWidth),
          offsetPoint(points, index, -halfWidth),
        ],
      );
    }
    return result;
  }

  const outline = cleanPolygon(surface.outline);
  if (outline.length < 3) return [];
  const ccw = polygonArea(outline) > 0;
  const result: Point2[][] = [];
  for (let index = 0; index < outline.length; index += 1) {
    const start = outline[index];
    const end = outline[(index + 1) % outline.length];
    const direction = segmentDirection(start, end);
    const inward: Point2 = ccw
      ? [-direction[1], direction[0]]
      : [direction[1], -direction[0]];
    result.push([
      start,
      end,
      [end[0] + inward[0] * PARKING_BOUNDARY_WIDTH, end[1] + inward[1] * PARKING_BOUNDARY_WIDTH],
      [start[0] + inward[0] * PARKING_BOUNDARY_WIDTH, start[1] + inward[1] * PARKING_BOUNDARY_WIDTH],
    ]);
  }
  return result;
}

function appendPatch(
  target: ParkingSurfaceMeshData,
  patchInput: readonly Point2[],
  y: number,
  textureRepeatMeters: number,
): void {
  const patch = cleanPolygon(patchInput);
  if (patch.length < 3 || Math.abs(polygonArea(patch)) <= EPSILON) return;
  const start = target.positions.length / 3;
  for (const point of patch) {
    target.positions.push(point[0], y, point[1]);
    target.uvs.push(point[0] / textureRepeatMeters, point[1] / textureRepeatMeters);
  }
  // A clockwise X/Z triangle has an upward normal in Babylon's RHS scene.
  for (let index = 1; index < patch.length - 1; index += 1) {
    const clockwise = polygonArea([patch[0], patch[index], patch[index + 1]]) < 0;
    target.indices.push(
      start,
      start + (clockwise ? index : index + 1),
      start + (clockwise ? index + 1 : index),
    );
  }
}

/** Build deterministic, clipped cobblestone and continuous-edge geometry. */
export function buildParkingSurfaceGeometry(
  layout: ParkingLayout | undefined,
  textureRepeatMeters: number,
): ParkingSurfaceGeometry {
  if (!Number.isFinite(textureRepeatMeters) || textureRepeatMeters <= EPSILON) {
    throw new Error("Parking texture repeat must be a positive distance");
  }
  const bands = emptyMeshData();
  const boundaries = emptyMeshData();
  for (const surface of layout?.surfaces ?? []) {
    const clippedBands = clipPatches(surfacePatches(surface), layout?.exclusions ?? []);
    const clippedBoundaries = clipPatches(boundaryPatches(surface), layout?.exclusions ?? []);
    for (const patch of clippedBands) {
      appendPatch(bands, patch, PARKING_BAND_SURFACE_Y, textureRepeatMeters);
    }
    for (const patch of clippedBoundaries) {
      appendPatch(boundaries, patch, PARKING_BOUNDARY_SURFACE_Y, textureRepeatMeters);
    }
  }
  return {
    bands,
    boundaries,
    renderedSurfaces: layout?.surfaces.length ?? 0,
  };
}

function createParkingMesh(
  name: string,
  kind: "parking-surface" | "parking-boundary",
  geometry: ParkingSurfaceMeshData,
  material: Material,
  scene: Scene,
): Mesh | null {
  if (geometry.indices.length === 0) return null;
  const normals: number[] = [];
  VertexData.ComputeNormals(geometry.positions, geometry.indices, normals, {
    useRightHandedSystem: true,
  });
  const vertexData = new VertexData();
  vertexData.positions = geometry.positions;
  vertexData.indices = geometry.indices;
  vertexData.normals = normals;
  vertexData.uvs = geometry.uvs;

  const mesh = new Mesh(name, scene);
  mesh.sideOrientation = Material.CounterClockWiseSideOrientation;
  vertexData.applyToMesh(mesh, false);
  mesh.material = material;
  mesh.checkCollisions = false;
  mesh.isPickable = false;
  mesh.metadata = kind === "parking-surface"
    ? {
      kind,
      canonicalLayout: true,
      surface: "cobblestone",
      bayDemarcation: false,
    }
    : {
      kind,
      canonicalLayout: true,
      continuous: true,
      bayDemarcation: false,
    };
  mesh.freezeWorldMatrix();
  return mesh;
}

/** Create at most one cobblestone and one continuous-boundary batch per tile. */
export function buildParkingSurfaceMeshes(
  tileId: string,
  layout: ParkingLayout | undefined,
  scene: Scene,
  cobblestoneMaterial: Material,
  boundaryMaterial: Material,
  textureRepeatMeters: number,
): Mesh[] {
  const geometry = buildParkingSurfaceGeometry(layout, textureRepeatMeters);
  return [
    createParkingMesh(
      `parking-bands-${tileId}`,
      "parking-surface",
      geometry.bands,
      cobblestoneMaterial,
      scene,
    ),
    createParkingMesh(
      `parking-boundaries-${tileId}`,
      "parking-boundary",
      geometry.boundaries,
      boundaryMaterial,
      scene,
    ),
  ].filter((mesh): mesh is Mesh => mesh !== null);
}
