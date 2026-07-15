import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { publicUrl } from "../publicUrl";
import earcut from "earcut";
import type {
  MunichTile,
  ParkingRowFeature,
  Point2,
  RoadFeature,
  RoadParkingSide,
} from "./types";

export type StreetSurfaceBatchKind = "surface" | "patch" | "utility" | "paint";

export type StreetSurfaceDetailKind =
  | "gutter"
  | "tree-pit"
  | "parking-band"
  | "crossing"
  | "stop-line"
  | "drain"
  | "manhole"
  | "asphalt-patch"
  | "worn-marking";

export interface StreetSurfaceBatchGeometry {
  positions: number[];
  indices: number[];
  colors: number[];
  uvs: number[];
}

export interface StreetSurfaceDetailPlacement {
  kind: StreetSurfaceDetailKind;
  point: Point2;
  radius: number;
  sourceId?: string;
}

export interface StreetSurfaceControlPoint {
  kind: "crossing";
  point: Point2;
  radius: number;
  sourceId?: string;
  crossing?: string;
  painted: boolean;
  signalized: boolean;
  roadTangent: Point2;
  roadWidth: number;
  crossingWidth: number;
  /** Height of the carriageway beneath this crossing. */
  surfaceY: number;
}

export interface StreetSurfaceDetailGeometry {
  batches: Record<StreetSurfaceBatchKind, StreetSurfaceBatchGeometry>;
  counts: Record<StreetSurfaceDetailKind, number>;
  placements: StreetSurfaceDetailPlacement[];
  controlPoints: StreetSurfaceControlPoint[];
}

export interface StreetSurfaceDetailGeometryOptions {
  /** Applies only when parking bands are explicitly enabled. */
  includeMunicipalParkingBands?: boolean;
  /** Opt in only for callers without the canonical parking renderer. */
  includeParkingBands?: boolean;
  /**
   * Opt-in stop-bar derivation from explicit stop/give-way signs or mapped
   * signal-controlled crossings. Road hierarchy alone never creates paint.
   */
  inferStopLines?: boolean;
  /** Opt-in center dashes, limited to mapped multi-lane or major roads. */
  includeWornCenterMarkings?: boolean;
  /** Disable the repair-atlas decals when a cleaner road surface is preferred. */
  includeAsphaltPatches?: boolean;
}

export interface StreetSurfaceDetailBuildOptions extends StreetSurfaceDetailGeometryOptions {
  /** Caller-owned overrides. Geometry always includes vertex colors and metre-scaled UVs. */
  materials?: Partial<Record<StreetSurfaceBatchKind, Material>>;
  /** Optional repeating art hook; vertex colors continue to tint these textures. */
  textureUrls?: Partial<Record<StreetSurfaceBatchKind, string>>;
}

export interface StreetSurfaceDetailMeshSet {
  meshes: Mesh[];
  /** Underlying road meshes receive shadows; detail overlays stay lightweight. */
  shadowReceivers: Mesh[];
  counts: Record<StreetSurfaceDetailKind, number>;
  controlPoints: StreetSurfaceControlPoint[];
}

type Color = readonly [number, number, number, number];

interface RoadChain {
  id: string;
  road: RoadFeature;
  points: Point2[];
}

interface PolylineMetrics {
  points: Point2[];
  cumulative: number[];
  length: number;
}

interface PolylineSample {
  point: Point2;
  tangent: Point2;
}

interface RoadSegment {
  chainId: string;
  road: RoadFeature;
  start: Point2;
  end: Point2;
  tangent: Point2;
  length: number;
  halfWidth: number;
}

interface SegmentProjection {
  segment: RoadSegment;
  closest: Point2;
  distance: number;
}

interface CircleExclusion {
  point: Point2;
  radius: number;
}

interface LinearExclusion {
  points: Point2[];
  radius: number;
}

const CARRIAGEWAY_KINDS = new Set([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "unclassified",
  "residential",
  "living_street",
  "service",
  "road",
]);
const MAJOR_ROAD_KINDS = new Set([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
]);
const NON_ASPHALT_SURFACES = /(?:cobblestone|pebblestone|sett|paving_stones|grass|sand|gravel|dirt|earth)/;

const LOCAL_ROAD_SURFACE_Y = 0.04;
const MAJOR_ROAD_SURFACE_Y = 0.05;
const MAPPED_CROSSING_SURFACE_Y = 0.052;

// These exported values describe the highest (major-road) case. Local-road
// details are derived from their parent road at runtime so they never float a
// centimetre above residential asphalt.
export const STREET_SURFACE_DETAIL_HEIGHTS = {
  parking: 0.053,
  gutter: 0.0506,
  patch: 0.0509,
  utility: 0.0511,
  paint: 0.0514,
  crossingPaint: 0.0534,
  treePitBorder: 0.163,
  treePitSoil: 0.1615,
} as const;

const DETAIL_OFFSETS = {
  gutter: STREET_SURFACE_DETAIL_HEIGHTS.gutter - MAJOR_ROAD_SURFACE_Y,
  patch: STREET_SURFACE_DETAIL_HEIGHTS.patch - MAJOR_ROAD_SURFACE_Y,
  utility: STREET_SURFACE_DETAIL_HEIGHTS.utility - MAJOR_ROAD_SURFACE_Y,
  paint: STREET_SURFACE_DETAIL_HEIGHTS.paint - MAJOR_ROAD_SURFACE_Y,
} as const;

function roadSurfaceY(road: RoadFeature): number {
  return MAJOR_ROAD_KINDS.has(road.kind) ? MAJOR_ROAD_SURFACE_Y : LOCAL_ROAD_SURFACE_Y;
}

function detailHeight(road: RoadFeature, kind: keyof typeof DETAIL_OFFSETS): number {
  return roadSurfaceY(road) + DETAIL_OFFSETS[kind];
}

export const ASPHALT_REPAIR_ATLAS_URL = "/assets/textures/materials/munich-asphalt-repair-atlas-v1.png";
export const WORN_ROAD_PAINT_URL = "/assets/textures/materials/munich-worn-road-paint-v1.png";

const UV_REPEAT_METERS = 4;
const EPSILON = 1e-6;
const MITER_LIMIT = 2.4;
const MAX_SAMPLES_PER_CHAIN = 512;

const COLORS = {
  gutter: [0.17, 0.185, 0.18, 1] as Color,
  parking: [0.29, 0.305, 0.30, 1] as Color,
  patch: [0.88, 0.885, 0.86, 1] as Color,
  pitBorder: [0.47, 0.465, 0.43, 1] as Color,
  pitSoil: [0.16, 0.115, 0.07, 1] as Color,
  drain: [0.105, 0.115, 0.11, 1] as Color,
  drainSlot: [0.24, 0.25, 0.235, 1] as Color,
  manhole: [0.135, 0.145, 0.138, 1] as Color,
  manholeInset: [0.205, 0.21, 0.195, 1] as Color,
  paint: [0.73, 0.71, 0.635, 1] as Color,
} as const;

const materialCache = new WeakMap<Scene, Map<string, StandardMaterial>>();

function emptyBatch(): StreetSurfaceBatchGeometry {
  return { positions: [], indices: [], colors: [], uvs: [] };
}

function emptyCounts(): Record<StreetSurfaceDetailKind, number> {
  return {
    gutter: 0,
    "tree-pit": 0,
    "parking-band": 0,
    crossing: 0,
    "stop-line": 0,
    drain: 0,
    manhole: 0,
    "asphalt-patch": 0,
    "worn-marking": 0,
  };
}

function finitePoint(point: Point2): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function cleanPolyline(points: readonly Point2[]): Point2[] {
  const result: Point2[] = [];
  for (const point of points) {
    if (!finitePoint(point)) continue;
    const previous = result.at(-1);
    if (previous && Math.hypot(point[0] - previous[0], point[1] - previous[1]) <= EPSILON) continue;
    result.push([point[0], point[1]]);
  }
  return result;
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function random01(key: string, salt = 0): number {
  let value = (hashString(key) ^ salt) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 0x1_0000_0000;
}

function variedColor(color: Color, key: string, amount = 0.045): Color {
  const scale = 1 - amount + random01(key, 0x5f31) * amount * 2;
  return [
    Math.max(0, Math.min(1, color[0] * scale)),
    Math.max(0, Math.min(1, color[1] * scale)),
    Math.max(0, Math.min(1, color[2] * scale)),
    color[3],
  ];
}

function pushVertex(
  target: StreetSurfaceBatchGeometry,
  point: Point2,
  y: number,
  color: Color,
  uv?: Point2,
): number {
  const index = target.positions.length / 3;
  target.positions.push(point[0], y, point[1]);
  target.colors.push(color[0], color[1], color[2], color[3]);
  target.uvs.push(
    uv?.[0] ?? point[0] / UV_REPEAT_METERS,
    uv?.[1] ?? point[1] / UV_REPEAT_METERS,
  );
  return index;
}

function normalOf(tangent: Point2): Point2 {
  return [-tangent[1], tangent[0]];
}

function direction(start: Point2, end: Point2): Point2 {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const length = Math.hypot(dx, dz);
  return length > EPSILON ? [dx / length, dz / length] : [1, 0];
}

function addQuad(
  target: StreetSurfaceBatchGeometry,
  center: Point2,
  forward: Point2,
  length: number,
  width: number,
  y: number,
  color: Color,
  uvs?: readonly [Point2, Point2, Point2, Point2],
): void {
  const right = normalOf(forward);
  const halfLength = length * 0.5;
  const halfWidth = width * 0.5;
  const points: Point2[] = [
    [center[0] - forward[0] * halfLength - right[0] * halfWidth, center[1] - forward[1] * halfLength - right[1] * halfWidth],
    [center[0] - forward[0] * halfLength + right[0] * halfWidth, center[1] - forward[1] * halfLength + right[1] * halfWidth],
    [center[0] + forward[0] * halfLength + right[0] * halfWidth, center[1] + forward[1] * halfLength + right[1] * halfWidth],
    [center[0] + forward[0] * halfLength - right[0] * halfWidth, center[1] + forward[1] * halfLength - right[1] * halfWidth],
  ];
  const start = target.positions.length / 3;
  points.forEach((point, index) => pushVertex(target, point, y, color, uvs?.[index]));
  target.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

function ribbonOffset(points: readonly Point2[], index: number, offset: number): Point2 {
  const previous = index > 0
    ? direction(points[index - 1], points[index])
    : direction(points[index], points[index + 1]);
  const next = index < points.length - 1
    ? direction(points[index], points[index + 1])
    : previous;
  const previousNormal = normalOf(previous);
  const nextNormal = normalOf(next);
  const sum: Point2 = [previousNormal[0] + nextNormal[0], previousNormal[1] + nextNormal[1]];
  const sumLength = Math.hypot(sum[0], sum[1]);
  if (sumLength <= EPSILON) return [nextNormal[0] * offset, nextNormal[1] * offset];
  const miter: Point2 = [sum[0] / sumLength, sum[1] / sumLength];
  const alignment = miter[0] * nextNormal[0] + miter[1] * nextNormal[1];
  if (Math.abs(alignment) <= EPSILON) return [nextNormal[0] * offset, nextNormal[1] * offset];
  const rawLength = offset / alignment;
  const limit = Math.abs(offset) * MITER_LIMIT;
  const miterLength = Math.max(-limit, Math.min(limit, rawLength));
  return [miter[0] * miterLength, miter[1] * miterLength];
}

function offsetPolyline(points: readonly Point2[], offset: number): Point2[] {
  if (points.length < 2 || Math.abs(offset) <= EPSILON) return points.map((point) => [...point] as Point2);
  return points.map((point, index) => {
    const offsetVector = ribbonOffset(points, index, offset);
    return [point[0] + offsetVector[0], point[1] + offsetVector[1]];
  });
}

function addRibbon(
  target: StreetSurfaceBatchGeometry,
  points: readonly Point2[],
  width: number,
  y: number,
  color: Color,
): void {
  if (points.length < 2 || width <= EPSILON) return;
  const halfWidth = width * 0.5;
  const left = offsetPolyline(points, halfWidth);
  const right = offsetPolyline(points, -halfWidth);
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = target.positions.length / 3;
    pushVertex(target, left[index], y, color);
    pushVertex(target, left[index + 1], y, color);
    pushVertex(target, right[index + 1], y, color);
    pushVertex(target, right[index], y, color);
    target.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
}

function addPolygon(
  target: StreetSurfaceBatchGeometry,
  ring: readonly Point2[],
  y: number,
  color: Color,
): void {
  const clean = cleanPolyline(ring);
  if (clean.length < 3) return;
  if (clean.length > 3) {
    const first = clean[0];
    const last = clean.at(-1)!;
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= EPSILON) clean.pop();
  }
  if (clean.length < 3) return;
  const triangles = earcut(clean.flat());
  const start = target.positions.length / 3;
  for (const point of clean) pushVertex(target, point, y, color);
  for (let index = 0; index < triangles.length; index += 3) {
    const first = triangles[index];
    const second = triangles[index + 1];
    const third = triangles[index + 2];
    const [ax, az] = clean[first];
    const [bx, bz] = clean[second];
    const [cx, cz] = clean[third];
    const normalY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    target.indices.push(
      start + first,
      start + (normalY >= 0 ? second : third),
      start + (normalY >= 0 ? third : second),
    );
  }
}

function addDisk(
  target: StreetSurfaceBatchGeometry,
  center: Point2,
  radius: number,
  y: number,
  color: Color,
  segments = 12,
  rotation = 0,
): void {
  const centerIndex = pushVertex(target, center, y, color);
  const ring: number[] = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = rotation + (index / segments) * Math.PI * 2;
    ring.push(pushVertex(
      target,
      [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius],
      y,
      color,
    ));
  }
  for (let index = 0; index < segments; index += 1) {
    target.indices.push(centerIndex, ring[(index + 1) % segments], ring[index]);
  }
}

function addWornRectangle(
  target: StreetSurfaceBatchGeometry,
  center: Point2,
  forward: Point2,
  length: number,
  width: number,
  y: number,
  key: string,
): void {
  // The texture supplies chips and edge wear. Splitting one dash into several
  // quads created a misleading burst of short markings between normal gaps.
  const wear = 0.035 + random01(key, 0x1700) * Math.min(0.16, length * 0.06);
  addQuad(
    target,
    center,
    forward,
    Math.max(0.04, length - wear),
    width * (0.9 + random01(key, 0x2710) * 0.1),
    y,
    variedColor(COLORS.paint, key, 0.08),
    [[0.015, 0.015], [0.985, 0.015], [0.985, 0.985], [0.015, 0.985]],
  );
}

function pointsMatch(first: Point2, second: Point2): boolean {
  return Math.abs(first[0] - second[0]) < 1e-3 && Math.abs(first[1] - second[1]) < 1e-3;
}

function buildRoadChains(roads: readonly RoadFeature[]): RoadChain[] {
  interface Piece { start: Point2; end: Point2; order: number }
  interface Group { key: string; road: RoadFeature; pieces: Piece[] }
  const groups = new Map<string, Group>();
  roads.forEach((road, roadIndex) => {
    const profile = [road.kind, road.width, road.surface, road.footway, JSON.stringify(road.parking ?? null)].join("|");
    const key = road.sourceId ? `${road.sourceId}:${profile}` : `anonymous:${roadIndex}:${profile}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, road, pieces: [] };
      groups.set(key, group);
    }
    for (let pointIndex = 0; pointIndex < road.points.length - 1; pointIndex += 1) {
      const start = road.points[pointIndex];
      const end = road.points[pointIndex + 1];
      if (!finitePoint(start) || !finitePoint(end) || pointsMatch(start, end)) continue;
      group.pieces.push({ start: [...start], end: [...end], order: group.pieces.length });
    }
  });

  const chains: RoadChain[] = [];
  for (const group of [...groups.values()].sort((left, right) => left.key.localeCompare(right.key))) {
    const unused = new Set(group.pieces.map((_, index) => index));
    let chainIndex = 0;
    while (unused.size > 0) {
      let seed = [...unused].sort((left, right) => group.pieces[left].order - group.pieces[right].order)[0];
      for (const candidate of unused) {
        const start = group.pieces[candidate].start;
        const hasIncoming = [...unused].some((other) => (
          other !== candidate && pointsMatch(group.pieces[other].end, start)
        ));
        if (!hasIncoming) {
          seed = candidate;
          break;
        }
      }

      const seedPiece = group.pieces[seed];
      const points: Point2[] = [[...seedPiece.start], [...seedPiece.end]];
      unused.delete(seed);
      while (true) {
        const current = points.at(-1)!;
        const previous = points[points.length - 2];
        const incoming = direction(previous, current);
        let nextIndex = -1;
        let nextPoint: Point2 | null = null;
        let bestAlignment = Number.NEGATIVE_INFINITY;
        for (const candidate of unused) {
          const piece = group.pieces[candidate];
          const forward = pointsMatch(piece.start, current);
          const reversed = pointsMatch(piece.end, current);
          if (!forward && !reversed) continue;
          const other = forward ? piece.end : piece.start;
          const outgoing = direction(current, other);
          const alignment = incoming[0] * outgoing[0] + incoming[1] * outgoing[1];
          if (alignment > bestAlignment) {
            bestAlignment = alignment;
            nextIndex = candidate;
            nextPoint = other;
          }
        }
        if (nextIndex < 0 || !nextPoint) break;
        points.push([...nextPoint]);
        unused.delete(nextIndex);
      }
      if (points.length >= 2) chains.push({ id: `${group.key}:${chainIndex}`, road: group.road, points });
      chainIndex += 1;
    }
  }
  return chains;
}

function measurePolyline(points: readonly Point2[]): PolylineMetrics | null {
  const clean = cleanPolyline(points);
  if (clean.length < 2) return null;
  const cumulative = [0];
  for (let index = 1; index < clean.length; index += 1) {
    cumulative.push(cumulative[index - 1] + Math.hypot(
      clean[index][0] - clean[index - 1][0],
      clean[index][1] - clean[index - 1][1],
    ));
  }
  const length = cumulative.at(-1) ?? 0;
  return length > EPSILON ? { points: clean, cumulative, length } : null;
}

function samplePolyline(metrics: PolylineMetrics, distanceAlong: number): PolylineSample {
  const distanceValue = Math.max(0, Math.min(metrics.length, distanceAlong));
  let index = 0;
  while (index < metrics.cumulative.length - 2 && metrics.cumulative[index + 1] < distanceValue) index += 1;
  const start = metrics.points[index];
  const end = metrics.points[index + 1];
  const segmentLength = Math.max(metrics.cumulative[index + 1] - metrics.cumulative[index], EPSILON);
  const amount = Math.max(0, Math.min(1, (distanceValue - metrics.cumulative[index]) / segmentLength));
  return {
    point: [start[0] + (end[0] - start[0]) * amount, start[1] + (end[1] - start[1]) * amount],
    tangent: direction(start, end),
  };
}

function sampleDistances(metrics: PolylineMetrics, spacing: number, margin: number, key: string): number[] {
  if (metrics.length <= margin * 2) return [];
  const result: number[] = [];
  let distanceValue = margin + random01(key, 0x944d) * Math.max(1, spacing - margin);
  while (distanceValue < metrics.length - margin && result.length < MAX_SAMPLES_PER_CHAIN) {
    result.push(distanceValue);
    distanceValue += spacing * (0.86 + random01(`${key}:${result.length}`, 0x62f1) * 0.28);
  }
  if (result.length === 0) result.push(metrics.length * 0.5);
  return result;
}

function roadSegments(chains: readonly RoadChain[]): RoadSegment[] {
  const result: RoadSegment[] = [];
  for (const chain of chains) {
    for (let index = 0; index < chain.points.length - 1; index += 1) {
      const start = chain.points[index];
      const end = chain.points[index + 1];
      const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (length <= EPSILON) continue;
      result.push({
        chainId: chain.id,
        road: chain.road,
        start,
        end,
        tangent: direction(start, end),
        length,
        halfWidth: Math.max(1.2, chain.road.width) * 0.5,
      });
    }
  }
  return result;
}

function projectToSegment(point: Point2, segment: RoadSegment): SegmentProjection {
  const dx = segment.end[0] - segment.start[0];
  const dz = segment.end[1] - segment.start[1];
  const lengthSquared = Math.max(dx * dx + dz * dz, EPSILON);
  const amount = Math.max(0, Math.min(1,
    ((point[0] - segment.start[0]) * dx + (point[1] - segment.start[1]) * dz) / lengthSquared,
  ));
  const closest: Point2 = [segment.start[0] + dx * amount, segment.start[1] + dz * amount];
  return { segment, closest, distance: Math.hypot(point[0] - closest[0], point[1] - closest[1]) };
}

function closestRoadProjection(point: Point2, segments: readonly RoadSegment[]): SegmentProjection | null {
  let best: SegmentProjection | null = null;
  for (const segment of segments) {
    const projection = projectToSegment(point, segment);
    if (!best || projection.distance < best.distance) best = projection;
  }
  return best;
}

function distanceToPolyline(point: Point2, points: readonly Point2[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index += 1) {
    const fake: RoadSegment = {
      chainId: "distance",
      road: { kind: "road", width: 1, points: [] },
      start: points[index],
      end: points[index + 1],
      tangent: direction(points[index], points[index + 1]),
      length: Math.hypot(points[index + 1][0] - points[index][0], points[index + 1][1] - points[index][1]),
      halfWidth: 0,
    };
    best = Math.min(best, projectToSegment(point, fake).distance);
  }
  return best;
}

function isBlocked(
  point: Point2,
  radius: number,
  circles: readonly CircleExclusion[],
  lines: readonly LinearExclusion[] = [],
): boolean {
  if (circles.some((exclusion) => (
    Math.hypot(point[0] - exclusion.point[0], point[1] - exclusion.point[1]) < radius + exclusion.radius
  ))) return true;
  return lines.some((exclusion) => distanceToPolyline(point, exclusion.points) < radius + exclusion.radius);
}

function furnitureExclusions(tile: MunichTile, segments: readonly RoadSegment[]): CircleExclusion[] {
  const result: CircleExclusion[] = [];
  for (const lamp of tile.streetLamps ?? []) {
    let renderedPoint: Point2 = [...lamp.point];
    const projection = closestRoadProjection(lamp.point, segments);
    if (projection && projection.distance <= projection.segment.halfWidth + 0.3) {
      let outward: Point2;
      if (projection.distance > 0.15) {
        outward = [
          (lamp.point[0] - projection.closest[0]) / projection.distance,
          (lamp.point[1] - projection.closest[1]) / projection.distance,
        ];
      } else {
        const normal = normalOf(projection.segment.tangent);
        // Match streetFurniture's deterministic choice for a lamp mapped
        // exactly on a road centre line.
        outward = [-normal[0], -normal[1]];
      }
      renderedPoint = [
        projection.closest[0] + outward[0] * (projection.segment.halfWidth + 0.3),
        projection.closest[1] + outward[1] * (projection.segment.halfWidth + 0.3),
      ];
    }
    result.push({ point: renderedPoint, radius: 0.72 });
  }
  for (const bench of tile.benches ?? []) {
    const width = Math.max(1.45, Math.min(3.2, (bench.seats ?? 3) * 0.57));
    result.push({ point: bench.point, radius: width * 0.5 + 0.42 });
  }
  return result;
}

function record(
  geometry: StreetSurfaceDetailGeometry,
  kind: StreetSurfaceDetailKind,
  point?: Point2,
  radius = 0,
  sourceId?: string,
): void {
  geometry.counts[kind] += 1;
  if (point) geometry.placements.push({ kind, point: [...point], radius, sourceId });
}

function parkingSideAllowed(side: RoadParkingSide | undefined): boolean {
  if (!side?.position) return false;
  if (/^(?:no|separate|no_parking|no_stopping|no_standing)$/.test(side.position)) return false;
  return !side.restriction?.match(/no_(?:parking|stopping|standing)/)
    && !side.condition?.match(/no_(?:parking|stopping|standing)/);
}

function parkingSides(road: RoadFeature): Array<{ physicalSign: -1 | 1; side: RoadParkingSide }> {
  if (!road.parking) return [];
  if (parkingSideAllowed(road.parking.both)) {
    return [
      { physicalSign: -1, side: road.parking.both! },
      { physicalSign: 1, side: road.parking.both! },
    ];
  }
  const result: Array<{ physicalSign: -1 | 1; side: RoadParkingSide }> = [];
  if (parkingSideAllowed(road.parking.left)) result.push({ physicalSign: -1, side: road.parking.left! });
  if (parkingSideAllowed(road.parking.right)) result.push({ physicalSign: 1, side: road.parking.right! });
  return result;
}

function parkingBandWidth(side: RoadParkingSide): number {
  if (side.orientation === "perpendicular") return 4.7;
  if (side.orientation === "diagonal") return 3.55;
  return 2.18;
}

function parkingOffset(roadWidth: number, side: RoadParkingSide, angled: boolean): number {
  const edge = roadWidth * 0.5;
  switch (side.position) {
    case "yes":
    case "lane":
      return Math.max(0.75, edge - (angled ? 1.55 : 1.05));
    case "half_on_kerb":
      return edge + 0.28;
    case "on_kerb":
      return edge + 0.82;
    case "shoulder":
    case "street_side":
      return edge + (angled ? 1.9 : 1.08);
    default:
      return edge + (angled ? 1.8 : 1.05);
  }
}

function rowMetrics(row: ParkingRowFeature): PolylineMetrics | null {
  return measurePolyline(row.points);
}

function nearParkingRows(points: readonly Point2[], rows: readonly ParkingRowFeature[], threshold: number): boolean {
  const metrics = measurePolyline(points);
  if (!metrics) return false;
  const probes = [0, metrics.length * 0.5, metrics.length].map((distanceValue) => samplePolyline(metrics, distanceValue).point);
  return rows.some((row) => probes.some((point) => distanceToPolyline(point, row.points) < threshold));
}

function addMunicipalParking(
  geometry: StreetSurfaceDetailGeometry,
  rows: readonly ParkingRowFeature[],
  blockers: readonly CircleExclusion[],
): void {
  for (const row of [...rows].sort((left, right) => left.id.localeCompare(right.id))) {
    const metrics = rowMetrics(row);
    if (!metrics) continue;
    addRibbon(
      geometry.batches.surface,
      metrics.points,
      2.28,
      STREET_SURFACE_DETAIL_HEIGHTS.parking,
      variedColor(COLORS.parking, row.id, 0.035),
    );
    record(geometry, "parking-band");

    const capacity = Math.max(0, Math.floor(row.sourceCapacity));
    if (capacity < 2 || row.sourceLengthMeters <= EPSILON) continue;
    const pitch = row.sourceLengthMeters / capacity;
    const pieceEnd = row.sourceStartMeters + metrics.length;
    for (let slot = 1; slot < capacity; slot += 1) {
      const sourceDistance = slot * pitch;
      if (sourceDistance < row.sourceStartMeters - 1e-5) continue;
      if (sourceDistance >= pieceEnd - 1e-5) break;
      const sample = samplePolyline(metrics, sourceDistance - row.sourceStartMeters);
      if (isBlocked(sample.point, 0.35, blockers)) continue;
      addWornRectangle(
        geometry.batches.paint,
        sample.point,
        normalOf(sample.tangent),
        1.88,
        0.085,
        STREET_SURFACE_DETAIL_HEIGHTS.paint,
        `${row.id}:bay:${slot}`,
      );
      record(geometry, "worn-marking", sample.point, 0.95, row.sourceId);
    }
  }
}

function addParkingFeaturePolygons(
  geometry: StreetSurfaceDetailGeometry,
  tile: MunichTile,
  rows: readonly ParkingRowFeature[],
): void {
  const features = [...(tile.parking ?? [])].sort((left, right) => left.id.localeCompare(right.id));
  for (const feature of features) {
    if (!feature.outline?.length) continue;
    if (feature.kind !== "parking_space" && feature.parking !== "street_side") continue;
    if (nearParkingRows(feature.outline, rows, 2.2)) continue;
    addPolygon(
      geometry.batches.surface,
      feature.outline,
      STREET_SURFACE_DETAIL_HEIGHTS.parking,
      variedColor(COLORS.parking, feature.id, 0.04),
    );
    record(geometry, "parking-band");
  }
}

function addRoadParkingBands(
  geometry: StreetSurfaceDetailGeometry,
  chains: readonly RoadChain[],
  rows: readonly ParkingRowFeature[],
): void {
  for (const chain of chains) {
    for (const { physicalSign, side } of parkingSides(chain.road)) {
      const width = parkingBandWidth(side);
      const angled = side.orientation === "perpendicular" || side.orientation === "diagonal";
      const offset = parkingOffset(chain.road.width, side, angled) * physicalSign;
      const centerline = offsetPolyline(chain.points, offset);
      if (nearParkingRows(centerline, rows, Math.max(1.4, width * 0.55))) continue;
      addRibbon(
        geometry.batches.surface,
        centerline,
        width,
        STREET_SURFACE_DETAIL_HEIGHTS.parking,
        variedColor(COLORS.parking, `${chain.id}:parking:${physicalSign}`, 0.035),
      );
      record(geometry, "parking-band");
    }
  }
}

function addGutters(
  geometry: StreetSurfaceDetailGeometry,
  chains: readonly RoadChain[],
): void {
  for (const chain of chains) {
    const halfWidth = Math.max(1.2, chain.road.width) * 0.5;
    const gutterY = detailHeight(chain.road, "gutter");
    for (const side of [-1, 1] as const) {
      const centerline = offsetPolyline(chain.points, side * Math.max(0.15, halfWidth - 0.14));
      addRibbon(
        geometry.batches.surface,
        centerline,
        0.28,
        gutterY,
        variedColor(COLORS.gutter, `${chain.id}:gutter:${side}`, 0.055),
      );
      record(geometry, "gutter");
    }
  }
}

function addTreePits(
  geometry: StreetSurfaceDetailGeometry,
  tile: MunichTile,
  segments: readonly RoadSegment[],
  furniture: readonly CircleExclusion[],
): CircleExclusion[] {
  const accepted: CircleExclusion[] = [];
  const trees = [...(tile.trees ?? [])].sort((left, right) => left.id - right.id);
  for (const tree of trees) {
    const projection = closestRoadProjection(tree.point, segments);
    if (!projection) continue;
    const minDistance = Math.max(0.5, projection.segment.halfWidth - 0.45);
    const maxDistance = projection.segment.halfWidth + 3.8;
    if (projection.distance < minDistance || projection.distance > maxDistance) continue;
    const outerRadius = 0.68 + random01(`tree-pit:${tree.id}`, 0x8117) * 0.16;
    if (isBlocked(tree.point, outerRadius, furniture) || isBlocked(tree.point, outerRadius, accepted)) continue;
    const rotation = Math.atan2(projection.segment.tangent[1], projection.segment.tangent[0]) + Math.PI / 8;
    addDisk(
      geometry.batches.surface,
      tree.point,
      outerRadius,
      STREET_SURFACE_DETAIL_HEIGHTS.treePitBorder,
      variedColor(COLORS.pitBorder, `tree-pit-border:${tree.id}`, 0.035),
      8,
      rotation,
    );
    addDisk(
      geometry.batches.surface,
      tree.point,
      Math.max(0.42, outerRadius - 0.18),
      STREET_SURFACE_DETAIL_HEIGHTS.treePitSoil,
      variedColor(COLORS.pitSoil, `tree-pit-soil:${tree.id}`, 0.1),
      8,
      rotation,
    );
    accepted.push({ point: tree.point, radius: outerRadius });
    record(geometry, "tree-pit", tree.point, outerRadius, String(tree.id));
  }
  return accepted;
}

type CrossingPaintTreatment = "zebra" | "lines" | "dashes";

function crossingPaintTreatment(road: RoadFeature): CrossingPaintTreatment | null {
  const crossing = road.crossing?.trim().toLowerCase();
  const markings = road.crossingMarkings
    ?.toLowerCase()
    .split(/[;,|]/)
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
  // Explicit negative evidence always wins over legacy or positive values.
  if (crossing === "unmarked" || markings.some((value) => ["no", "none", "unmarked"].includes(value))) {
    return null;
  }
  if (markings.some((value) => ["dashes", "dots", "dashed"].includes(value))) return "dashes";
  if (markings.some((value) => ["lines", "line"].includes(value))) return "lines";
  if (markings.some((value) => ["yes", "zebra", "ladder", "continental", "blocks", "barred"].includes(value))) {
    return "zebra";
  }
  const legacyReferences = road.crossingRef
    ?.toLowerCase()
    .split(/[;,|]/)
    .map((value) => value.trim()) ?? [];
  return legacyReferences.includes("zebra") ? "zebra" : null;
}

function crossingIsSignalized(road: RoadFeature): boolean {
  return ["traffic_signals", "pedestrian_signals"].includes(
    road.crossing?.trim().toLowerCase() ?? "",
  );
}

function addCrossings(
  geometry: StreetSurfaceDetailGeometry,
  crossingChains: readonly RoadChain[],
  segments: readonly RoadSegment[],
): LinearExclusion[] {
  const exclusions: LinearExclusion[] = [];
  for (const chain of crossingChains) {
    const metrics = measurePolyline(chain.points);
    if (!metrics || metrics.length < 2) continue;
    const middle = samplePolyline(metrics, metrics.length * 0.5);
    const projection = closestRoadProjection(middle.point, segments);
    if (!projection || projection.distance > projection.segment.halfWidth + 1.5) continue;
    const crossingWidth = Math.max(1.8, Math.min(4.5, chain.road.width));
    const usableLength = Math.min(metrics.length, projection.segment.halfWidth * 2 + 0.8);
    if (usableLength < 2) continue;
    const treatment = crossingPaintTreatment(chain.road);
    exclusions.push({ points: metrics.points, radius: crossingWidth * 0.5 });
    geometry.controlPoints.push({
      kind: "crossing",
      point: [...middle.point],
      radius: Math.max(crossingWidth, usableLength) * 0.5,
      sourceId: chain.road.sourceId,
      crossing: chain.road.crossing,
      painted: treatment !== null,
      signalized: crossingIsSignalized(chain.road),
      roadTangent: [...projection.segment.tangent],
      roadWidth: projection.segment.halfWidth * 2,
      crossingWidth,
      surfaceY: roadSurfaceY(projection.segment.road),
    });
    if (!treatment) continue;

    const across = normalOf(middle.tangent);
    const paintY = Math.max(
      MAPPED_CROSSING_SURFACE_Y,
      roadSurfaceY(projection.segment.road),
    ) + DETAIL_OFFSETS.paint;
    if (treatment === "zebra") {
      const stripeWidth = 0.42;
      const stripePitch = 0.72;
      const stripeCount = Math.max(2, Math.floor((crossingWidth + 0.3) / stripePitch));
      for (let stripe = 0; stripe < stripeCount; stripe += 1) {
        const offset = (stripe - (stripeCount - 1) * 0.5) * stripePitch;
        const stripeCenter: Point2 = [
          middle.point[0] + across[0] * offset,
          middle.point[1] + across[1] * offset,
        ];
        addWornRectangle(
          geometry.batches.paint,
          stripeCenter,
          middle.tangent,
          usableLength,
          stripeWidth,
          paintY,
          `${chain.id}:crossing:zebra:${stripe}`,
        );
      }
    } else if (treatment === "lines") {
      for (const side of [-1, 1] as const) {
        const edgeOffset = side * Math.max(0.3, crossingWidth * 0.5 - 0.12);
        const center: Point2 = [
          middle.point[0] + across[0] * edgeOffset,
          middle.point[1] + across[1] * edgeOffset,
        ];
        addWornRectangle(
          geometry.batches.paint,
          center,
          middle.tangent,
          usableLength,
          0.16,
          paintY,
          `${chain.id}:crossing:line:${side}`,
        );
      }
    } else {
      const dashPitch = 1.1;
      const dashCount = Math.max(2, Math.floor(usableLength / dashPitch));
      for (const side of [-1, 1] as const) {
        for (let dash = 0; dash < dashCount; dash += 1) {
          const along = (dash - (dashCount - 1) * 0.5) * dashPitch;
          const edgeOffset = side * Math.max(0.3, crossingWidth * 0.5 - 0.12);
          const center: Point2 = [
            middle.point[0] + middle.tangent[0] * along + across[0] * edgeOffset,
            middle.point[1] + middle.tangent[1] * along + across[1] * edgeOffset,
          ];
          addWornRectangle(
            geometry.batches.paint,
            center,
            middle.tangent,
            0.52,
            0.16,
            paintY,
            `${chain.id}:crossing:dash:${side}:${dash}`,
          );
        }
      }
    }
    record(geometry, "crossing", middle.point, Math.max(crossingWidth, usableLength) * 0.5, chain.road.sourceId);
  }
  return exclusions;
}

function hasExplicitStopEvidence(road: RoadFeature): boolean {
  const tokens = road.trafficSign
    ?.toLowerCase()
    .split(/[;,|]/)
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
  return tokens.some((token) => (
    /(?:^|:)20[56](?:\[|$)/.test(token)
    || ["stop", "give_way", "give-way", "give way", "yield"].includes(token)
  ));
}

function addStopLines(
  geometry: StreetSurfaceDetailGeometry,
  chains: readonly RoadChain[],
  segments: readonly RoadSegment[],
  circles: CircleExclusion[],
  crossings: readonly LinearExclusion[],
): void {
  for (const chain of chains) {
    if (!hasExplicitStopEvidence(chain.road)) continue;
    const metrics = measurePolyline(chain.points);
    if (!metrics || metrics.length < 4) continue;
    const paintY = detailHeight(chain.road, "paint");
    const endpoints: Array<{ point: Point2; tangent: Point2; inward: Point2; allowed: boolean }> = [
      {
        point: metrics.points[0],
        tangent: direction(metrics.points[0], metrics.points[1]),
        inward: direction(metrics.points[0], metrics.points[1]),
        allowed: chain.road.oneway !== 1,
      },
      {
        point: metrics.points.at(-1)!,
        tangent: direction(metrics.points.at(-2)!, metrics.points.at(-1)!),
        inward: direction(metrics.points.at(-1)!, metrics.points.at(-2)!),
        allowed: chain.road.oneway !== -1,
      },
    ];

    endpoints.forEach((endpoint, endpointIndex) => {
      if (!endpoint.allowed) return;
      let target: RoadSegment | null = null;
      let targetDistance = Number.POSITIVE_INFINITY;
      for (const segment of segments) {
        if (
          segment.chainId === chain.id
          || (chain.road.sourceId !== undefined && segment.road.sourceId === chain.road.sourceId)
        ) continue;
        const projection = projectToSegment(endpoint.point, segment);
        const alignment = Math.abs(endpoint.tangent[0] * segment.tangent[0] + endpoint.tangent[1] * segment.tangent[1]);
        if (alignment > 0.94 || projection.distance > segment.halfWidth + 0.85) continue;
        if (projection.distance >= targetDistance) continue;
        target = segment;
        targetDistance = projection.distance;
      }
      if (!target) return;
      let center: Point2 = [
        endpoint.point[0] + endpoint.inward[0] * 1.15,
        endpoint.point[1] + endpoint.inward[1] * 1.15,
      ];
      if (isBlocked(center, 0.75, [], crossings)) {
        center = [center[0] + endpoint.inward[0] * 2.2, center[1] + endpoint.inward[1] * 2.2];
      }
      const halfSpan = Math.max(1.2, chain.road.width * 0.41);
      if (isBlocked(center, halfSpan * 0.35, circles)) return;
      addWornRectangle(
        geometry.batches.paint,
        center,
        normalOf(endpoint.tangent),
        halfSpan * 2,
        0.34,
        paintY,
        `${chain.id}:stop:${endpointIndex}`,
      );
      circles.push({ point: center, radius: Math.min(1.1, halfSpan * 0.45) });
      record(geometry, "stop-line", center, halfSpan, chain.road.sourceId);
    });
  }

  // A signal-controlled mapped crossing is source evidence for stop bars even
  // when the crossing itself is explicitly unmarked. Keep each bar on the
  // right-hand approach lane and outside the crossing footprint.
  for (const [controlIndex, control] of geometry.controlPoints.entries()) {
    if (!control.signalized) continue;
    const roadNormal = normalOf(control.roadTangent);
    const approachDistance = control.crossingWidth * 0.5 + 0.85;
    const lineLength = Math.max(1.5, control.roadWidth * 0.42);
    for (const side of [-1, 1] as const) {
      const center: Point2 = [
        control.point[0]
          + control.roadTangent[0] * side * approachDistance
          + roadNormal[0] * -side * control.roadWidth * 0.24,
        control.point[1]
          + control.roadTangent[1] * side * approachDistance
          + roadNormal[1] * -side * control.roadWidth * 0.24,
      ];
      if (isBlocked(center, Math.min(1, lineLength * 0.35), circles)) continue;
      addWornRectangle(
        geometry.batches.paint,
        center,
        roadNormal,
        lineLength,
        0.34,
        control.surfaceY + DETAIL_OFFSETS.paint,
        `${control.sourceId ?? "signal-crossing"}:signal-stop:${controlIndex}:${side}`,
      );
      circles.push({ point: center, radius: Math.min(1.1, lineLength * 0.4) });
      record(geometry, "stop-line", center, lineLength * 0.5, control.sourceId);
    }
  }
}

function addDrain(
  geometry: StreetSurfaceDetailGeometry,
  center: Point2,
  tangent: Point2,
  utilityY: number,
  key: string,
  sourceId?: string,
): void {
  addQuad(
    geometry.batches.utility,
    center,
    tangent,
    0.66,
    0.36,
    utilityY,
    variedColor(COLORS.drain, key, 0.06),
  );
  const across = normalOf(tangent);
  for (const offset of [-0.18, -0.06, 0.06, 0.18]) {
    const slotCenter: Point2 = [center[0] + tangent[0] * offset, center[1] + tangent[1] * offset];
    addQuad(
      geometry.batches.utility,
      slotCenter,
      across,
      0.24,
      0.025,
      utilityY + 0.0003,
      COLORS.drainSlot,
    );
  }
  record(geometry, "drain", center, 0.43, sourceId);
}

function addUtilities(
  geometry: StreetSurfaceDetailGeometry,
  chains: readonly RoadChain[],
  circles: CircleExclusion[],
  crossings: readonly LinearExclusion[],
): void {
  for (const chain of chains) {
    const metrics = measurePolyline(chain.points);
    if (!metrics) continue;
    const halfWidth = Math.max(1.2, chain.road.width) * 0.5;
    const utilityY = detailHeight(chain.road, "utility");
    if (metrics.length >= 14) {
      for (const side of [-1, 1] as const) {
        const distances = sampleDistances(metrics, 27, 4, `${chain.id}:drains:${side}`);
        for (const distanceValue of distances) {
          const sample = samplePolyline(metrics, distanceValue);
          const normal = normalOf(sample.tangent);
          const center: Point2 = [
            sample.point[0] + normal[0] * side * Math.max(0.2, halfWidth - 0.29),
            sample.point[1] + normal[1] * side * Math.max(0.2, halfWidth - 0.29),
          ];
          if (isBlocked(center, 0.43, circles, crossings)) continue;
          addDrain(
            geometry,
            center,
            sample.tangent,
            utilityY,
            `${chain.id}:drain:${side}:${distanceValue.toFixed(2)}`,
            chain.road.sourceId,
          );
          circles.push({ point: center, radius: 0.43 });
        }
      }
    }

    if (metrics.length < 24) continue;
    for (const distanceValue of sampleDistances(metrics, 54, 6, `${chain.id}:manholes`)) {
      const sample = samplePolyline(metrics, distanceValue);
      const normal = normalOf(sample.tangent);
      const lateral = (random01(`${chain.id}:manhole:${distanceValue}`, 0xa341) - 0.5)
        * Math.max(0.4, Math.min(2.2, halfWidth * 0.75));
      const center: Point2 = [sample.point[0] + normal[0] * lateral, sample.point[1] + normal[1] * lateral];
      if (isBlocked(center, 0.52, circles, crossings)) continue;
      const rotation = random01(`${chain.id}:manhole-rotation:${distanceValue}`, 0xd119) * Math.PI;
      addDisk(
        geometry.batches.utility,
        center,
        0.48,
        utilityY,
        variedColor(COLORS.manhole, `${chain.id}:manhole:${distanceValue}`, 0.05),
        14,
        rotation,
      );
      addDisk(
        geometry.batches.utility,
        center,
        0.36,
        utilityY + 0.0003,
        variedColor(COLORS.manholeInset, `${chain.id}:manhole-inset:${distanceValue}`, 0.05),
        14,
        rotation,
      );
      circles.push({ point: center, radius: 0.52 });
      record(geometry, "manhole", center, 0.52, chain.road.sourceId);
    }
  }
}

function atlasPatchUvs(variant: number): readonly [Point2, Point2, Point2, Point2] {
  // Texture loading uses Babylon's normal image inversion, so V=0 addresses
  // the source image's top row. A small inset prevents cross-quadrant bleed.
  const inset = 0.008;
  const column = variant % 2;
  const row = Math.floor(variant / 2);
  const u0 = column * 0.5 + inset;
  const u1 = (column + 1) * 0.5 - inset;
  const v0 = row * 0.5 + inset;
  const v1 = (row + 1) * 0.5 - inset;
  return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
}

function addAtlasPatch(
  target: StreetSurfaceBatchGeometry,
  center: Point2,
  tangent: Point2,
  length: number,
  width: number,
  patchY: number,
  variant: number,
  key: string,
): void {
  addQuad(
    target,
    center,
    tangent,
    length,
    width,
    patchY,
    variedColor(COLORS.patch, key, 0.055),
    atlasPatchUvs(variant),
  );
}

function addAsphaltPatches(
  geometry: StreetSurfaceDetailGeometry,
  chains: readonly RoadChain[],
  circles: CircleExclusion[],
  crossings: readonly LinearExclusion[],
): void {
  for (const chain of chains) {
    if (chain.road.surface && NON_ASPHALT_SURFACES.test(chain.road.surface)) continue;
    const metrics = measurePolyline(chain.points);
    if (!metrics || metrics.length < 18) continue;
    const halfWidth = Math.max(1.2, chain.road.width) * 0.5;
    const patchY = detailHeight(chain.road, "patch");
    for (const distanceValue of sampleDistances(metrics, 42, 5, `${chain.id}:patches`)) {
      const key = `${chain.id}:patch:${distanceValue.toFixed(2)}`;
      const sample = samplePolyline(metrics, distanceValue);
      const normal = normalOf(sample.tangent);
      const lateral = (random01(key, 0x18a7) - 0.5) * Math.max(0.2, halfWidth * 0.9);
      const center: Point2 = [sample.point[0] + normal[0] * lateral, sample.point[1] + normal[1] * lateral];
      const requestedLength = 1.2 + random01(key, 0x28bf) * 2.4;
      const requestedWidth = 0.55 + random01(key, 0x3c19) * 1.15;
      const variant = Math.floor(random01(key, 0x7af1) * 4) % 4;
      // The trench and seam quadrants are intentionally slender. Rectangular
      // and irregular variants retain a squarer surveyed-repair footprint.
      const slender = variant === 0 || variant === 2;
      const length = slender ? Math.max(requestedLength, requestedWidth * 2.6) : requestedLength;
      const width = slender ? Math.min(requestedWidth, length * 0.34) : requestedWidth;
      const radius = Math.hypot(length, width) * 0.5;
      if (isBlocked(center, radius, circles, crossings)) continue;
      addAtlasPatch(geometry.batches.patch, center, sample.tangent, length, width, patchY, variant, key);
      circles.push({ point: center, radius });
      record(geometry, "asphalt-patch", center, radius, chain.road.sourceId);
    }
  }
}

function addCenterMarkings(
  geometry: StreetSurfaceDetailGeometry,
  chains: readonly RoadChain[],
  circles: readonly CircleExclusion[],
  crossings: readonly LinearExclusion[],
): void {
  for (const chain of chains) {
    if (["no", "none", "false"].includes(chain.road.laneMarkings?.trim().toLowerCase() ?? "")) continue;
    const markedRoad = MAJOR_ROAD_KINDS.has(chain.road.kind)
      || ((chain.road.lanes ?? 0) >= 2 && chain.road.width >= 8.5);
    if (!markedRoad) continue;
    const metrics = measurePolyline(chain.points);
    if (!metrics) continue;
    const paintY = detailHeight(chain.road, "paint");
    for (const distanceValue of sampleDistances(metrics, 8.4, 2.4, `${chain.id}:center-dashes`)) {
      const sample = samplePolyline(metrics, distanceValue);
      if (isBlocked(sample.point, 1.7, circles, crossings)) continue;
      addWornRectangle(
        geometry.batches.paint,
        sample.point,
        sample.tangent,
        3,
        0.12,
        paintY,
        `${chain.id}:center-dash:${distanceValue.toFixed(2)}`,
      );
      record(geometry, "worn-marking", sample.point, 1.55, chain.road.sourceId);
    }
  }
}

/**
 * Produces deterministic, Babylon-independent geometry. Continuous source
 * features are joined before offsetting so gutters and parking bands do not
 * reveal a seam at every OSM segment boundary.
 */
export function buildStreetSurfaceDetailGeometry(
  tile: MunichTile,
  options: StreetSurfaceDetailGeometryOptions = {},
): StreetSurfaceDetailGeometry {
  const geometry: StreetSurfaceDetailGeometry = {
    batches: {
      surface: emptyBatch(),
      patch: emptyBatch(),
      utility: emptyBatch(),
      paint: emptyBatch(),
    },
    counts: emptyCounts(),
    placements: [],
    controlPoints: [],
  };
  const carriageways = buildRoadChains(tile.roads.filter((road) => CARRIAGEWAY_KINDS.has(road.kind)));
  const crossings = buildRoadChains(tile.roads.filter((road) => road.footway === "crossing"));
  const segments = roadSegments(carriageways);
  if (segments.length === 0) return geometry;

  const furniture = furnitureExclusions(tile, segments);
  addGutters(geometry, carriageways);
  const treePits = addTreePits(geometry, tile, segments, furniture);
  const fixedBlockers: CircleExclusion[] = [...furniture, ...treePits];

  const parkingRows = tile.parkingRows ?? [];
  if (options.includeParkingBands === true) {
    if (options.includeMunicipalParkingBands !== false) {
      addMunicipalParking(geometry, parkingRows, fixedBlockers);
    }
    addParkingFeaturePolygons(geometry, tile, parkingRows);
    addRoadParkingBands(geometry, carriageways, parkingRows);
  }

  const crossingExclusions = addCrossings(geometry, crossings, segments);
  const generatedBlockers = [...fixedBlockers];
  if (options.inferStopLines === true) {
    addStopLines(geometry, carriageways, segments, generatedBlockers, crossingExclusions);
  }
  addUtilities(geometry, carriageways, generatedBlockers, crossingExclusions);
  if (options.includeAsphaltPatches !== false) {
    addAsphaltPatches(geometry, carriageways, generatedBlockers, crossingExclusions);
  }
  if (options.includeWornCenterMarkings === true) {
    addCenterMarkings(geometry, carriageways, generatedBlockers, crossingExclusions);
  }
  return geometry;
}

function detailTexture(scene: Scene, url: string, transparentDecal: boolean): Texture {
  const texture = new Texture(publicUrl(url), scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  texture.wrapU = transparentDecal ? Texture.CLAMP_ADDRESSMODE : Texture.WRAP_ADDRESSMODE;
  texture.wrapV = transparentDecal ? Texture.CLAMP_ADDRESSMODE : Texture.WRAP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 8;
  texture.hasAlpha = transparentDecal;
  return texture;
}

function defaultMaterial(
  scene: Scene,
  kind: StreetSurfaceBatchKind,
  textureUrl: string | undefined,
): StandardMaterial {
  let sceneMaterials = materialCache.get(scene);
  if (!sceneMaterials) {
    sceneMaterials = new Map();
    materialCache.set(scene, sceneMaterials);
  }
  const resolvedTextureUrl = textureUrl
    ?? (kind === "patch" ? ASPHALT_REPAIR_ATLAS_URL : kind === "paint" ? WORN_ROAD_PAINT_URL : undefined);
  const key = `${kind}:${resolvedTextureUrl ?? "vertex-color"}`;
  const cached = sceneMaterials.get(key);
  if (cached) return cached;

  const material = new StandardMaterial(`street-surface-${kind}-material`, scene);
  material.diffuseColor = Color3.White();
  material.ambientColor = kind === "paint"
    ? new Color3(0.64, 0.63, 0.57)
    : new Color3(0.48, 0.49, 0.46);
  material.specularColor = kind === "utility"
    ? new Color3(0.075, 0.08, 0.075)
    : new Color3(0.035, 0.035, 0.032);
  material.specularPower = kind === "utility" ? 36 : 24;
  material.backFaceCulling = true;
  if (resolvedTextureUrl) {
    material.diffuseTexture = detailTexture(scene, resolvedTextureUrl, kind === "patch" || kind === "paint");
  }
  if (kind === "patch" || kind === "paint") {
    material.useAlphaFromDiffuseTexture = true;
    material.transparencyMode = Material.MATERIAL_ALPHATESTANDBLEND;
    material.alphaCutOff = kind === "paint" ? 0.055 : 0.08;
    material.needDepthPrePass = true;
  }
  // Textures load asynchronously. Freezing a decal material before that
  // upload completes can lock Babylon into its black fallback sampler.
  // Keep textured paint/repair materials live; the small shared cache still
  // limits them to one material per scene and detail batch.
  if (!resolvedTextureUrl) material.freeze();
  sceneMaterials.set(key, material);
  return material;
}

function createBatchMesh(
  tileId: string,
  kind: StreetSurfaceBatchKind,
  batch: StreetSurfaceBatchGeometry,
  material: Material,
  scene: Scene,
  counts: Record<StreetSurfaceDetailKind, number>,
): Mesh | null {
  if (batch.indices.length === 0) return null;
  const normals: number[] = [];
  VertexData.ComputeNormals(batch.positions, batch.indices, normals, { useRightHandedSystem: true });
  const data = new VertexData();
  data.positions = batch.positions;
  data.indices = batch.indices;
  data.normals = normals;
  data.colors = batch.colors;
  data.uvs = batch.uvs;

  const mesh = new Mesh(`street-surface-${kind}-${tileId}`, scene);
  mesh.sideOrientation = Material.CounterClockWiseSideOrientation;
  data.applyToMesh(mesh, false);
  mesh.material = material;
  mesh.useVertexColors = true;
  mesh.checkCollisions = false;
  mesh.isPickable = false;
  mesh.metadata = { kind: "street-surface-details", batch: kind, inferred: true, counts };
  mesh.freezeWorldMatrix();
  return mesh;
}

/** Build at most four non-colliding draw-call batches for one streamed tile. */
export function buildStreetSurfaceDetails(
  tile: MunichTile,
  scene: Scene,
  options: StreetSurfaceDetailBuildOptions = {},
): StreetSurfaceDetailMeshSet {
  const geometry = buildStreetSurfaceDetailGeometry(tile, options);
  const meshes: Mesh[] = [];
  for (const kind of ["surface", "patch", "utility", "paint"] as const) {
    if (geometry.batches[kind].indices.length === 0) continue;
    const mesh = createBatchMesh(
      tile.id,
      kind,
      geometry.batches[kind],
      options.materials?.[kind] ?? defaultMaterial(scene, kind, options.textureUrls?.[kind]),
      scene,
      geometry.counts,
    );
    if (mesh) meshes.push(mesh);
  }
  return {
    meshes,
    shadowReceivers: [],
    counts: geometry.counts,
    controlPoints: geometry.controlPoints,
  };
}
