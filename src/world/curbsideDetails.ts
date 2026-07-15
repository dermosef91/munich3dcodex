import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type {
  BusinessFeature,
  MunichTile,
  ParkingRowFeature,
  Point2,
  RoadFeature,
} from "./types";

type Point3 = [number, number, number];

interface Batch {
  positions: number[];
  indices: number[];
  colors: number[];
}

interface RoadProjection {
  point: Point2;
  tangent: Point2;
  towardRoad: Point2;
  distance: number;
  road: RoadFeature;
}

interface PolylineMetrics {
  points: Point2[];
  cumulative: number[];
  length: number;
}

interface RackPlacement {
  id: string;
  point: Point2;
  tangent: Point2;
  bikeCount: number;
  seed: number;
}

interface ParkingSignPlacement {
  id: string;
  point: Point2;
  facing: Point2;
}

interface TrafficSignalPlacement {
  id: string;
  point: Point2;
  facing: Point2;
  active: "red" | "green";
}

interface BinPlacement {
  id: string;
  point: Point2;
  facing: Point2;
}

export interface CurbsidePlacements {
  racks: RackPlacement[];
  parkingSigns: ParkingSignPlacement[];
  trafficSignals: TrafficSignalPlacement[];
  bins: BinPlacement[];
}

interface CurbsideMaterials {
  structure: StandardMaterial;
  emissive: StandardMaterial;
}

interface JunctionArm {
  direction: Point2;
  width: number;
  kind: string;
  roadKey: string;
}

interface JunctionCandidate {
  key: string;
  point: Point2;
  arms: JunctionArm[];
  importance: number;
}

const materialsByScene = new WeakMap<Scene, CurbsideMaterials>();

const EPSILON = 1e-6;
const MAX_RACKS_PER_TILE = 10;
const MAX_SIGNS_PER_TILE = 14;
const MAX_SIGNAL_JUNCTIONS_PER_TILE = 3;
const MAX_BINS_PER_TILE = 12;

const MOTOR_ROAD_KINDS = new Set([
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
  "residential",
  "living_street",
  "unclassified",
]);

const SIGNAL_ROAD_IMPORTANCE: Readonly<Record<string, number>> = {
  motorway: 5,
  motorway_link: 4,
  trunk: 5,
  trunk_link: 4,
  primary: 4,
  primary_link: 3,
  secondary: 3,
  secondary_link: 2,
  tertiary: 2,
  tertiary_link: 1,
  residential: 1,
  living_street: 0,
  unclassified: 0,
};

const METAL = new Color4(0.105, 0.12, 0.125, 1);
const STEEL = new Color4(0.42, 0.45, 0.46, 1);
const RUBBER = new Color4(0.025, 0.028, 0.03, 1);
const SIGNAL_DARK = new Color4(0.035, 0.05, 0.045, 1);
const SIGN_BLUE = new Color4(0.02, 0.20, 0.62, 1);
const SIGN_WHITE = new Color4(0.94, 0.96, 0.94, 1);
const BIN_BODY = new Color4(0.13, 0.19, 0.17, 1);
const BIN_TRIM = new Color4(0.86, 0.49, 0.10, 1);
const RED_DARK = new Color4(0.18, 0.025, 0.02, 1);
const AMBER_DARK = new Color4(0.18, 0.105, 0.015, 1);
const GREEN_DARK = new Color4(0.015, 0.13, 0.045, 1);
const RED_LIGHT = new Color4(1, 0.055, 0.025, 1);
const GREEN_LIGHT = new Color4(0.035, 1, 0.21, 1);

const BIKE_COLORS = [
  new Color4(0.54, 0.055, 0.035, 1),
  new Color4(0.04, 0.16, 0.38, 1),
  new Color4(0.07, 0.31, 0.20, 1),
  new Color4(0.78, 0.43, 0.055, 1),
  new Color4(0.34, 0.10, 0.36, 1),
  new Color4(0.52, 0.54, 0.51, 1),
] as const;

function batch(): Batch {
  return { positions: [], indices: [], colors: [] };
}

function hashText(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function random01(seed: number, salt: number): number {
  let value = (seed ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 0x1_0000_0000;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalize2(value: Point2, fallback: Point2 = [1, 0]): Point2 {
  const length = Math.hypot(value[0], value[1]);
  return length > EPSILON ? [value[0] / length, value[1] / length] : fallback;
}

function add2(point: Point2, direction: Point2, distance: number): Point2 {
  return [point[0] + direction[0] * distance, point[1] + direction[1] * distance];
}

function rightOf(forward: Point2): Point2 {
  return [forward[1], -forward[0]];
}

function isFinitePoint(point: Point2): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function isSeparated(point: Point2, points: readonly Point2[], minimumDistance: number): boolean {
  return points.every((other) => Math.hypot(point[0] - other[0], point[1] - other[1]) >= minimumDistance);
}

function spatiallyCap<T extends { id: string; point: Point2 }>(
  values: readonly T[],
  limit: number,
  cellSize = 110,
): T[] {
  if (values.length <= limit) return [...values];
  const buckets = new Map<string, T[]>();
  for (const value of values) {
    const key = `${Math.floor(value.point[0] / cellSize)}:${Math.floor(value.point[1] / cellSize)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(value);
    buckets.set(key, bucket);
  }
  const keys = [...buckets.keys()].sort((left, right) => hashText(`cell:${left}`) - hashText(`cell:${right}`));
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => hashText(left.id) - hashText(right.id));
  }
  const result: T[] = [];
  let depth = 0;
  while (result.length < limit) {
    let added = false;
    for (const key of keys) {
      const value = buckets.get(key)?.[depth];
      if (!value) continue;
      result.push(value);
      added = true;
      if (result.length >= limit) break;
    }
    if (!added) break;
    depth += 1;
  }
  return result;
}

function cleanPolyline(points: readonly Point2[]): Point2[] {
  const result: Point2[] = [];
  for (const point of points) {
    if (!isFinitePoint(point)) continue;
    const previous = result.at(-1);
    if (previous && Math.hypot(point[0] - previous[0], point[1] - previous[1]) <= EPSILON) continue;
    result.push([point[0], point[1]]);
  }
  return result;
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

function samplePolyline(metrics: PolylineMetrics, distance: number): { point: Point2; tangent: Point2 } {
  const target = clamp(distance, 0, metrics.length);
  let index = 0;
  while (index < metrics.cumulative.length - 2 && metrics.cumulative[index + 1] < target) index += 1;
  const start = metrics.points[index];
  const end = metrics.points[index + 1];
  const segmentLength = Math.max(metrics.cumulative[index + 1] - metrics.cumulative[index], EPSILON);
  const amount = clamp((target - metrics.cumulative[index]) / segmentLength, 0, 1);
  return {
    point: [
      start[0] + (end[0] - start[0]) * amount,
      start[1] + (end[1] - start[1]) * amount,
    ],
    tangent: [(end[0] - start[0]) / segmentLength, (end[1] - start[1]) / segmentLength],
  };
}

function closestRoadProjection(point: Point2, roads: readonly RoadFeature[]): RoadProjection | null {
  let best: RoadProjection | null = null;
  for (const road of roads) {
    for (let index = 0; index < road.points.length - 1; index += 1) {
      const start = road.points[index];
      const end = road.points[index + 1];
      const dx = end[0] - start[0];
      const dz = end[1] - start[1];
      const lengthSquared = dx * dx + dz * dz;
      if (lengthSquared <= EPSILON) continue;
      const amount = clamp(
        ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared,
        0,
        1,
      );
      const projected: Point2 = [start[0] + dx * amount, start[1] + dz * amount];
      const offset: Point2 = [projected[0] - point[0], projected[1] - point[1]];
      const distance = Math.hypot(offset[0], offset[1]);
      if (best && distance >= best.distance) continue;
      const tangent = normalize2([dx, dz]);
      best = {
        point: projected,
        tangent,
        towardRoad: distance > 0.12 ? [offset[0] / distance, offset[1] / distance] : rightOf(tangent),
        distance,
        road,
      };
    }
  }
  return best;
}

function businessRackPoint(business: BusinessFeature, roads: readonly RoadFeature[]): Point2 | null {
  const frontage = business.frontage;
  if (!frontage || !isFinitePoint(frontage.anchor)) return null;
  const outward = normalize2(frontage.outward);
  const projection = closestRoadProjection(frontage.anchor, roads);
  let offset = 1.25;
  if (projection) {
    const alignment = outward[0] * projection.towardRoad[0] + outward[1] * projection.towardRoad[1];
    if (alignment > 0.25) {
      const sidewalkDepth = projection.distance - Math.max(projection.road.width, 1.2) * 0.5;
      offset = clamp(sidewalkDepth * 0.48, 0.8, 1.7);
    }
  }
  return add2(frontage.anchor, outward, offset);
}

function deriveRackPlacements(tile: MunichTile): RackPlacement[] {
  const businesses = [...(tile.businesses ?? [])]
    .filter((business) => business.frontage !== undefined)
    .sort((left, right) => hashText(`rack:${left.id}`) - hashText(`rack:${right.id}`));
  const targetCount = Math.min(MAX_RACKS_PER_TILE, Math.max(1, Math.ceil(businesses.length / 15)));
  const result: RackPlacement[] = [];
  const occupied: Point2[] = [];
  for (const business of businesses) {
    if (result.length >= targetCount) break;
    const point = businessRackPoint(business, tile.roads);
    if (!point || !isSeparated(point, occupied, 13)) continue;
    const seed = hashText(`rack:${tile.id}:${business.id}`);
    const tangent = normalize2(business.frontage?.tangent ?? [1, 0]);
    result.push({
      id: `business-${business.id}`,
      point,
      tangent,
      bikeCount: 1 + (seed % 3),
      seed,
    });
    occupied.push(point);
  }

  // Quiet tiles can still receive one useful scale cue beside a mapped bench.
  if (result.length === 0) {
    const bench = [...(tile.benches ?? [])].sort((left, right) => left.id - right.id)[0];
    if (bench) {
      const projection = closestRoadProjection(bench.point, tile.roads);
      const tangent = projection?.tangent ?? [1, 0];
      const seed = hashText(`rack:${tile.id}:bench:${bench.id}`);
      result.push({
        id: `bench-${bench.id}`,
        point: add2(bench.point, tangent, 1.45),
        tangent,
        bikeCount: 1 + (seed % 2),
        seed,
      });
    }
  }
  return result;
}

function parkingRowSignSamples(row: ParkingRowFeature): Array<{ point: Point2; tangent: Point2 }> {
  const metrics = measurePolyline(row.points);
  if (!metrics) return [];
  const phase = 7 + (hashText(`parking-sign-phase:${row.sourceId}`) % 24);
  const spacing = 72;
  const pieceStart = row.sourceStartMeters;
  const pieceEnd = pieceStart + metrics.length;
  const firstIndex = Math.max(0, Math.ceil((pieceStart - phase) / spacing));
  const result: Array<{ point: Point2; tangent: Point2 }> = [];
  for (let index = firstIndex; result.length < 2; index += 1) {
    const sourceDistance = phase + index * spacing;
    if (sourceDistance >= pieceEnd - 0.1) break;
    if (sourceDistance < pieceStart + 0.1) continue;
    result.push(samplePolyline(metrics, sourceDistance - pieceStart));
  }
  if (result.length === 0 && pieceStart <= 0.1 && metrics.length >= 12) {
    result.push(samplePolyline(metrics, Math.min(5, metrics.length * 0.32)));
  }
  return result;
}

function deriveParkingSignPlacements(tile: MunichTile): ParkingSignPlacement[] {
  const result: ParkingSignPlacement[] = [];
  const occupied: Point2[] = [];
  const rows = [...(tile.parkingRows ?? [])].sort((left, right) => left.id.localeCompare(right.id));
  for (const row of rows) {
    for (const [sampleIndex, sample] of parkingRowSignSamples(row).entries()) {
      const projection = closestRoadProjection(sample.point, tile.roads);
      let away = projection
        ? ([-projection.towardRoad[0], -projection.towardRoad[1]] as Point2)
        : rightOf(sample.tangent);
      if (projection && projection.distance < 0.15) {
        const signSeed = hashText(`${row.id}:${sampleIndex}`);
        const signSide = signSeed % 2 === 0 ? 1 : -1;
        away = add2([0, 0], rightOf(sample.tangent), signSide);
      }
      const point = add2(sample.point, normalize2(away), 1.35);
      if (!isSeparated(point, occupied, 18)) continue;
      result.push({
        id: `row-${row.id}-${sampleIndex}`,
        point,
        facing: normalize2(sample.tangent),
      });
      occupied.push(point);
    }
  }

  // Keep these source-adjacent: a curb-parking tag establishes parking space,
  // but it does not prove that a legal sign stands in this streamed tile.
  // Municipal rows are the only available placement evidence used here.
  return spatiallyCap(result, MAX_SIGNS_PER_TILE);
}

function junctionKey(point: Point2): string {
  const quantum = 0.6;
  return `${Math.round(point[0] / quantum)}:${Math.round(point[1] / quantum)}`;
}

function addJunctionArm(
  groups: Map<string, { sumX: number; sumZ: number; count: number; arms: JunctionArm[] }>,
  point: Point2,
  direction: Point2,
  road: RoadFeature,
  roadIndex: number,
): void {
  const normalized = normalize2(direction, [0, 0]);
  if (Math.hypot(normalized[0], normalized[1]) <= EPSILON) return;
  const key = junctionKey(point);
  let group = groups.get(key);
  if (!group) {
    group = { sumX: 0, sumZ: 0, count: 0, arms: [] };
    groups.set(key, group);
  }
  group.sumX += point[0];
  group.sumZ += point[1];
  group.count += 1;
  const roadKey = road.sourceId ?? `road-${roadIndex}`;
  const duplicate = group.arms.some((arm) => (
    arm.roadKey === roadKey
    && arm.direction[0] * normalized[0] + arm.direction[1] * normalized[1] > 0.985
  ));
  if (!duplicate) {
    group.arms.push({
      direction: normalized,
      width: Math.max(road.width, 3.2),
      kind: road.kind,
      roadKey,
    });
  }
}

function junctionCandidates(roads: readonly RoadFeature[]): JunctionCandidate[] {
  const groups = new Map<string, { sumX: number; sumZ: number; count: number; arms: JunctionArm[] }>();
  for (let roadIndex = 0; roadIndex < roads.length; roadIndex += 1) {
    const road = roads[roadIndex];
    if (!MOTOR_ROAD_KINDS.has(road.kind) || road.points.length < 2) continue;
    for (let index = 0; index < road.points.length; index += 1) {
      const point = road.points[index];
      if (index > 0) {
        addJunctionArm(groups, point, [road.points[index - 1][0] - point[0], road.points[index - 1][1] - point[1]], road, roadIndex);
      }
      if (index < road.points.length - 1) {
        addJunctionArm(groups, point, [road.points[index + 1][0] - point[0], road.points[index + 1][1] - point[1]], road, roadIndex);
      }
    }
  }

  const result: JunctionCandidate[] = [];
  for (const [key, group] of groups) {
    const uniqueRoads = new Set(group.arms.map((arm) => arm.roadKey));
    if (group.arms.length < 3 || uniqueRoads.size < 2) continue;
    const importance = group.arms.reduce(
      (maximum, arm) => Math.max(maximum, SIGNAL_ROAD_IMPORTANCE[arm.kind] ?? 0),
      0,
    );
    if (importance < 2 && hashText(`local-signal:${key}`) % 5 !== 0) continue;
    result.push({
      key,
      point: [group.sumX / group.count, group.sumZ / group.count],
      arms: group.arms,
      importance,
    });
  }
  return result.sort((left, right) => right.importance - left.importance
    || hashText(`junction:${left.key}`) - hashText(`junction:${right.key}`));
}

function deriveTrafficSignalPlacements(tile: MunichTile): TrafficSignalPlacement[] {
  const result: TrafficSignalPlacement[] = [];
  const selectedPoints: Point2[] = [];
  const evidence = tile.roads
    .filter((road) => road.footway === "crossing" && road.crossing === "traffic_signals")
    .map((road) => measurePolyline(road.points))
    .filter((metrics): metrics is PolylineMetrics => metrics !== null)
    .map((metrics) => samplePolyline(metrics, metrics.length * 0.5).point);
  if (evidence.length === 0) return result;
  // Crossing ways retain the mapped signal control even when explicit OSM
  // signal nodes were not part of the cached extract. Only junctions near
  // that source evidence receive inferred vehicle signal heads.
  const candidates = junctionCandidates(tile.roads).filter((junction) => (
    evidence.some((point) => Math.hypot(point[0] - junction.point[0], point[1] - junction.point[1]) <= 22)
  ));
  let junctionCount = 0;
  for (const junction of candidates) {
    if (junctionCount >= MAX_SIGNAL_JUNCTIONS_PER_TILE) break;
    if (!isSeparated(junction.point, selectedPoints, 46)) continue;
    const phase = hashText(`signal-phase:${junction.key}`) % 2;
    const arms = [...junction.arms]
      .sort((left, right) => Math.atan2(left.direction[1], left.direction[0])
        - Math.atan2(right.direction[1], right.direction[0]))
      .slice(0, 4);
    for (let index = 0; index < arms.length; index += 1) {
      const arm = arms[index];
      const outward = arm.direction;
      const approachRight = [-rightOf(outward)[0], -rightOf(outward)[1]] as Point2;
      const longitudinal = Math.max(3.1, arm.width * 0.62);
      const lateral = arm.width * 0.5 + 0.62;
      const point = add2(add2(junction.point, outward, longitudinal), approachRight, lateral);
      const axis = Math.abs(outward[0]) >= Math.abs(outward[1]) ? 0 : 1;
      const active = axis === phase ? "green" : "red";
      result.push({
        id: `${junction.key}-${index}`,
        point,
        facing: outward,
        active,
      });
    }
    selectedPoints.push(junction.point);
    junctionCount += 1;
  }
  return result;
}

function deriveBinPlacements(tile: MunichTile, blocked: readonly Point2[]): BinPlacement[] {
  const result: BinPlacement[] = [];
  const occupied = [...blocked];
  const benches = [...(tile.benches ?? [])].sort((left, right) => hashText(`bin:${left.id}`) - hashText(`bin:${right.id}`));
  for (const bench of benches) {
    if (hashText(`bin-bench:${bench.id}`) % 3 === 0) continue;
    const projection = closestRoadProjection(bench.point, tile.roads);
    const facing = projection?.tangent ?? [1, 0];
    const direction = hashText(`bin-side:${bench.id}`) % 2 === 0 ? 1 : -1;
    const point = add2(bench.point, facing, direction * 1.05);
    if (!isSeparated(point, occupied, 8)) continue;
    result.push({ id: `bench-${bench.id}`, point, facing });
    occupied.push(point);
    if (result.length >= MAX_BINS_PER_TILE) return result;
  }

  // Lamps provide a low-density fallback on streets without mapped benches.
  const lamps = [...(tile.streetLamps ?? [])].sort((left, right) => hashText(`bin-lamp:${left.id}`) - hashText(`bin-lamp:${right.id}`));
  for (const lamp of lamps) {
    if (hashText(`bin-lamp-select:${lamp.id}`) % 7 !== 0) continue;
    const projection = closestRoadProjection(lamp.point, tile.roads);
    const facing = projection?.tangent ?? [1, 0];
    const point = add2(lamp.point, facing, 0.72);
    if (!isSeparated(point, occupied, 10)) continue;
    result.push({ id: `lamp-${lamp.id}`, point, facing });
    occupied.push(point);
    if (result.length >= MAX_BINS_PER_TILE) break;
  }
  return result;
}

/**
 * Derive stable curbside props from existing map semantics. These placements
 * are visual inferences, not claims that a specific rack, sign, signal or bin
 * exists at the generated coordinate.
 */
export function deriveCurbsidePlacements(tile: MunichTile): CurbsidePlacements {
  const racks = deriveRackPlacements(tile);
  const parkingSigns = deriveParkingSignPlacements(tile);
  const trafficSignals = deriveTrafficSignalPlacements(tile);
  const blocked = [
    ...racks.map((placement) => placement.point),
    ...parkingSigns.map((placement) => placement.point),
    ...trafficSignals.map((placement) => placement.point),
  ];
  const bins = deriveBinPlacements(tile, blocked);
  return { racks, parkingSigns, trafficSignals, bins };
}

function pushVertex(target: Batch, point: Point3, color: Color4): number {
  const index = target.positions.length / 3;
  target.positions.push(point[0], point[1], point[2]);
  target.colors.push(color.r, color.g, color.b, color.a);
  return index;
}

function appendQuad(
  target: Batch,
  a: Point3,
  b: Point3,
  c: Point3,
  d: Point3,
  color: Color4,
): void {
  const start = pushVertex(target, a, color);
  pushVertex(target, b, color);
  pushVertex(target, c, color);
  pushVertex(target, d, color);
  target.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

function localPoint(
  center: Point2,
  right: Point2,
  forward: Point2,
  localX: number,
  y: number,
  localZ: number,
): Point3 {
  return [
    center[0] + right[0] * localX + forward[0] * localZ,
    y,
    center[1] + right[1] * localX + forward[1] * localZ,
  ];
}

function appendBox(
  target: Batch,
  center: Point2,
  forwardValue: Point2,
  width: number,
  bottom: number,
  height: number,
  depth: number,
  color: Color4,
  localX = 0,
  localZ = 0,
): void {
  const forward = normalize2(forwardValue);
  const right = rightOf(forward);
  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;
  const top = bottom + height;
  const lbb = localPoint(center, right, forward, localX - halfWidth, bottom, localZ - halfDepth);
  const rbb = localPoint(center, right, forward, localX + halfWidth, bottom, localZ - halfDepth);
  const lfb = localPoint(center, right, forward, localX - halfWidth, bottom, localZ + halfDepth);
  const rfb = localPoint(center, right, forward, localX + halfWidth, bottom, localZ + halfDepth);
  const lbt = localPoint(center, right, forward, localX - halfWidth, top, localZ - halfDepth);
  const rbt = localPoint(center, right, forward, localX + halfWidth, top, localZ - halfDepth);
  const lft = localPoint(center, right, forward, localX - halfWidth, top, localZ + halfDepth);
  const rft = localPoint(center, right, forward, localX + halfWidth, top, localZ + halfDepth);
  appendQuad(target, lbt, lft, rft, rbt, color);
  appendQuad(target, lbb, rbb, rfb, lfb, color);
  appendQuad(target, lfb, rfb, rft, lft, color);
  appendQuad(target, rbb, lbb, lbt, rbt, color);
  appendQuad(target, rfb, rbb, rbt, rft, color);
  appendQuad(target, lbb, lfb, lft, lbt, color);
}

function add3(left: Point3, right: Point3): Point3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function subtract3(left: Point3, right: Point3): Point3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function scale3(value: Point3, amount: number): Point3 {
  return [value[0] * amount, value[1] * amount, value[2] * amount];
}

function dot3(left: Point3, right: Point3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross3(left: Point3, right: Point3): Point3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalize3(value: Point3, fallback: Point3 = [1, 0, 0]): Point3 {
  const length = Math.sqrt(dot3(value, value));
  return length > EPSILON ? scale3(value, 1 / length) : fallback;
}

function appendTube(
  target: Batch,
  start: Point3,
  end: Point3,
  radius: number,
  color: Color4,
  segments = 6,
): void {
  const axis = normalize3(subtract3(end, start));
  const reference: Point3 = Math.abs(axis[1]) > 0.88 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize3(cross3(axis, reference), [0, 0, 1]);
  const v = normalize3(cross3(axis, u), [0, 1, 0]);
  const first = target.positions.length / 3;
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    const radial = add3(scale3(u, Math.cos(angle) * radius), scale3(v, Math.sin(angle) * radius));
    pushVertex(target, add3(start, radial), color);
    pushVertex(target, add3(end, radial), color);
  }
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    const startCurrent = first + index * 2;
    const endCurrent = startCurrent + 1;
    const startNext = first + next * 2;
    const endNext = startNext + 1;
    target.indices.push(startCurrent, startNext, endNext, startCurrent, endNext, endCurrent);
  }
  const startCenter = pushVertex(target, start, color);
  const endCenter = pushVertex(target, end, color);
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    target.indices.push(startCenter, first + index * 2, first + next * 2);
    target.indices.push(endCenter, first + next * 2 + 1, first + index * 2 + 1);
  }
}

function appendTorus(
  target: Batch,
  center: Point3,
  planeAValue: Point3,
  planeBValue: Point3,
  majorRadius: number,
  tubeRadius: number,
  color: Color4,
  ringSegments = 12,
  tubeSegments = 4,
): void {
  const planeA = normalize3(planeAValue);
  const planeB = normalize3(planeBValue);
  const planeNormal = normalize3(cross3(planeA, planeB));
  const first = target.positions.length / 3;
  for (let ringIndex = 0; ringIndex < ringSegments; ringIndex += 1) {
    const ringAngle = (ringIndex / ringSegments) * Math.PI * 2;
    const radial = normalize3(add3(
      scale3(planeA, Math.cos(ringAngle)),
      scale3(planeB, Math.sin(ringAngle)),
    ));
    const ringCenter = add3(center, scale3(radial, majorRadius));
    for (let tubeIndex = 0; tubeIndex < tubeSegments; tubeIndex += 1) {
      const tubeAngle = (tubeIndex / tubeSegments) * Math.PI * 2;
      const offset = add3(
        scale3(radial, Math.cos(tubeAngle) * tubeRadius),
        scale3(planeNormal, Math.sin(tubeAngle) * tubeRadius),
      );
      pushVertex(target, add3(ringCenter, offset), color);
    }
  }
  for (let ringIndex = 0; ringIndex < ringSegments; ringIndex += 1) {
    const nextRing = (ringIndex + 1) % ringSegments;
    for (let tubeIndex = 0; tubeIndex < tubeSegments; tubeIndex += 1) {
      const nextTube = (tubeIndex + 1) % tubeSegments;
      const a = first + ringIndex * tubeSegments + tubeIndex;
      const b = first + nextRing * tubeSegments + tubeIndex;
      const c = first + nextRing * tubeSegments + nextTube;
      const d = first + ringIndex * tubeSegments + nextTube;
      target.indices.push(a, b, c, a, c, d);
    }
  }
}

function appendRack(target: Batch, placement: RackPlacement): void {
  const rackRight = normalize2(placement.tangent);
  const rackForward: Point2 = [-rackRight[1], rackRight[0]];
  const hoopCount = Math.max(2, placement.bikeCount + 1);
  const spacing = 0.62;
  for (let index = 0; index < hoopCount; index += 1) {
    const localX = (index - (hoopCount - 1) * 0.5) * spacing;
    const left = localPoint(placement.point, rackRight, rackForward, localX, 0.07, -0.31);
    const right = localPoint(placement.point, rackRight, rackForward, localX, 0.07, 0.31);
    const leftTop = localPoint(placement.point, rackRight, rackForward, localX, 0.77, -0.31);
    const rightTop = localPoint(placement.point, rackRight, rackForward, localX, 0.77, 0.31);
    appendTube(target, left, leftTop, 0.028, STEEL, 6);
    appendTube(target, leftTop, rightTop, 0.028, STEEL, 6);
    appendTube(target, rightTop, right, 0.028, STEEL, 6);
  }
}

function appendBicycle(
  target: Batch,
  placement: RackPlacement,
  bikeIndex: number,
): void {
  const rackRight = normalize2(placement.tangent);
  let bikeForward: Point2 = [-rackRight[1], rackRight[0]];
  if (random01(placement.seed, 0x31a + bikeIndex) > 0.5) bikeForward = [-bikeForward[0], -bikeForward[1]];
  const bikeRight = rightOf(bikeForward);
  const offset = (bikeIndex - (placement.bikeCount - 1) * 0.5) * 0.62;
  const jitter = (random01(placement.seed, 0x8d1 + bikeIndex) - 0.5) * 0.12;
  const center = add2(add2(placement.point, rackRight, offset), bikeForward, jitter);
  const wheelRadius = 0.34;
  const wheelSpacing = 1.08;
  const rearHub = localPoint(center, bikeRight, bikeForward, 0, wheelRadius + 0.055, -wheelSpacing * 0.5);
  const frontHub = localPoint(center, bikeRight, bikeForward, 0, wheelRadius + 0.055, wheelSpacing * 0.5);
  const planeForward: Point3 = [bikeForward[0], 0, bikeForward[1]];
  const frameColor = BIKE_COLORS[(placement.seed + bikeIndex * 3) % BIKE_COLORS.length];
  appendTorus(target, rearHub, planeForward, [0, 1, 0], wheelRadius, 0.018, RUBBER);
  appendTorus(target, frontHub, planeForward, [0, 1, 0], wheelRadius, 0.018, RUBBER);

  const crank = localPoint(center, bikeRight, bikeForward, 0, 0.40, -0.04);
  const seatJoint = localPoint(center, bikeRight, bikeForward, 0, 0.78, -0.20);
  const handleJoint = localPoint(center, bikeRight, bikeForward, 0, 0.83, 0.38);
  for (const [start, end] of [
    [rearHub, crank],
    [crank, seatJoint],
    [seatJoint, rearHub],
    [seatJoint, handleJoint],
    [handleJoint, frontHub],
    [crank, handleJoint],
  ] as Array<[Point3, Point3]>) {
    appendTube(target, start, end, 0.024, frameColor, 6);
  }
  appendTube(
    target,
    handleJoint,
    localPoint(center, bikeRight, bikeForward, 0, 0.98, 0.41),
    0.021,
    STEEL,
    6,
  );
  appendTube(
    target,
    localPoint(center, bikeRight, bikeForward, -0.24, 0.98, 0.41),
    localPoint(center, bikeRight, bikeForward, 0.24, 0.98, 0.41),
    0.018,
    STEEL,
    6,
  );
  appendBox(target, center, bikeForward, 0.26, 0.79, 0.065, 0.12, RUBBER, 0, -0.24);
}

function appendParkingSign(target: Batch, placement: ParkingSignPlacement): void {
  const facing = normalize2(placement.facing);
  appendTube(
    target,
    [placement.point[0], 0.04, placement.point[1]],
    [placement.point[0], 2.55, placement.point[1]],
    0.038,
    STEEL,
    8,
  );
  appendBox(target, placement.point, facing, 0.58, 1.82, 0.70, 0.055, SIGN_BLUE, 0, 0.035);
  // White border and a low-poly P remain legible without allocating a unique
  // dynamic texture for every inferred sign.
  for (const [width, height, x, y] of [
    [0.50, 0.035, 0, 1.875],
    [0.50, 0.035, 0, 2.457],
    [0.035, 0.58, -0.25, 2.166],
    [0.035, 0.58, 0.25, 2.166],
  ] as const) {
    appendBox(target, placement.point, facing, width, y, height, 0.025, SIGN_WHITE, x, 0.068);
  }
  appendBox(target, placement.point, facing, 0.065, 1.96, 0.40, 0.025, SIGN_WHITE, -0.10, 0.071);
  appendBox(target, placement.point, facing, 0.22, 2.29, 0.065, 0.025, SIGN_WHITE, 0.005, 0.071);
  appendBox(target, placement.point, facing, 0.065, 2.17, 0.18, 0.025, SIGN_WHITE, 0.095, 0.071);
  appendBox(target, placement.point, facing, 0.21, 2.11, 0.06, 0.025, SIGN_WHITE, -0.005, 0.071);
}

function appendTrafficSignal(
  structure: Batch,
  emissive: Batch,
  placement: TrafficSignalPlacement,
): void {
  const facing = normalize2(placement.facing);
  const right = rightOf(facing);
  appendTube(
    structure,
    [placement.point[0], 0.04, placement.point[1]],
    [placement.point[0], 3.18, placement.point[1]],
    0.055,
    METAL,
    8,
  );
  appendBox(structure, placement.point, facing, 0.34, 2.20, 0.92, 0.23, SIGNAL_DARK, 0, 0.02);
  const lensHeights = [2.91, 2.66, 2.41] as const;
  const lensColors = [RED_DARK, AMBER_DARK, GREEN_DARK] as const;
  for (let index = 0; index < lensHeights.length; index += 1) {
    const center = localPoint(placement.point, right, facing, 0, lensHeights[index], 0.145);
    const end = add3(center, [facing[0] * 0.045, 0, facing[1] * 0.045]);
    appendTube(structure, center, end, 0.095, lensColors[index], 12);
  }
  const activeIndex = placement.active === "green" ? 2 : 0;
  const activeCenter = localPoint(placement.point, right, facing, 0, lensHeights[activeIndex], 0.194);
  const activeEnd = add3(activeCenter, [facing[0] * 0.018, 0, facing[1] * 0.018]);
  appendTube(
    emissive,
    activeCenter,
    activeEnd,
    0.078,
    placement.active === "green" ? GREEN_LIGHT : RED_LIGHT,
    12,
  );
}

function appendBin(target: Batch, placement: BinPlacement): void {
  const facing = normalize2(placement.facing);
  appendBox(target, placement.point, facing, 0.48, 0.06, 0.76, 0.42, BIN_BODY);
  appendBox(target, placement.point, facing, 0.52, 0.82, 0.11, 0.46, METAL);
  appendBox(target, placement.point, facing, 0.36, 0.61, 0.055, 0.025, BIN_TRIM, 0, 0.225);
  appendBox(target, placement.point, facing, 0.22, 0.075, 0.06, 0.24, METAL);
}

function curbsideMaterials(scene: Scene): CurbsideMaterials {
  const cached = materialsByScene.get(scene);
  if (cached) return cached;

  const structure = new StandardMaterial("curbside-detail-structure", scene);
  structure.diffuseColor = Color3.White();
  structure.ambientColor = new Color3(0.4, 0.41, 0.39);
  structure.specularColor = new Color3(0.2, 0.21, 0.2);
  structure.specularPower = 42;
  structure.backFaceCulling = false;
  structure.freeze();

  const emissive = new StandardMaterial("curbside-detail-emissive", scene);
  emissive.diffuseColor = Color3.White();
  emissive.emissiveColor = new Color3(0.72, 0.72, 0.72);
  emissive.specularColor = Color3.Black();
  emissive.disableLighting = true;
  emissive.backFaceCulling = false;
  emissive.freeze();

  const materials = { structure, emissive };
  materialsByScene.set(scene, materials);
  return materials;
}

function createBatchMesh(
  name: string,
  scene: Scene,
  target: Batch,
  material: Material,
): Mesh | null {
  if (target.positions.length === 0) return null;
  const normals: number[] = [];
  VertexData.ComputeNormals(target.positions, target.indices, normals, { useRightHandedSystem: true });
  const vertexData = new VertexData();
  vertexData.positions = target.positions;
  vertexData.indices = target.indices;
  vertexData.normals = normals;
  vertexData.colors = target.colors;
  const mesh = new Mesh(name, scene);
  mesh.sideOrientation = Material.CounterClockWiseSideOrientation;
  vertexData.applyToMesh(mesh, false);
  mesh.material = material;
  mesh.useVertexColors = true;
  mesh.hasVertexAlpha = false;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.freezeWorldMatrix();
  return mesh;
}

/**
 * Build all inferred bikes, racks, signs, signals and bins in at most two
 * draw-call-oriented meshes for a streamed tile. Callers should dispose the
 * returned geometry with the rest of that tile; the materials are scene-owned.
 */
export function buildCurbsideDetailMeshes(tile: MunichTile, scene: Scene): Mesh[] {
  const placements = deriveCurbsidePlacements(tile);
  const structure = batch();
  const emissive = batch();
  for (const rack of placements.racks) {
    appendRack(structure, rack);
    for (let index = 0; index < rack.bikeCount; index += 1) appendBicycle(structure, rack, index);
  }
  for (const sign of placements.parkingSigns) appendParkingSign(structure, sign);
  for (const signal of placements.trafficSignals) appendTrafficSignal(structure, emissive, signal);
  for (const bin of placements.bins) appendBin(structure, bin);

  const materials = curbsideMaterials(scene);
  const safeTileId = tile.id.replace(/[^a-zA-Z0-9_-]/g, "-");
  const counts = {
    racks: placements.racks.length,
    bicycles: placements.racks.reduce((sum, rack) => sum + rack.bikeCount, 0),
    parkingSigns: placements.parkingSigns.length,
    trafficSignals: placements.trafficSignals.length,
    bins: placements.bins.length,
  };
  const meshes = [
    createBatchMesh(`curbside-details-${safeTileId}`, scene, structure, materials.structure),
    createBatchMesh(`curbside-signal-lights-${safeTileId}`, scene, emissive, materials.emissive),
  ].filter((mesh): mesh is Mesh => mesh !== null);
  for (const mesh of meshes) mesh.metadata = { ...(mesh.metadata ?? {}), curbsideDetails: counts, inferred: true };
  return meshes;
}
