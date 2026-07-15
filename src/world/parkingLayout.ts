import type {
  MunichTile,
  ParkingFeature,
  ParkingRowFeature,
  Point2,
  RoadFeature,
  RoadParkingSide,
} from "./types";

export type ParkingLayoutSource =
  | "municipal-row"
  | "osm-parking-space"
  | "osm-parking-area"
  | "osm-road-side";

interface ParkingLayoutSurfaceBase {
  id: string;
  source: ParkingLayoutSource;
  sourceId: string;
}

export interface ParkingRibbonSurface extends ParkingLayoutSurfaceBase {
  kind: "ribbon";
  points: Point2[];
  width: number;
}

export interface ParkingPolygonSurface extends ParkingLayoutSurfaceBase {
  kind: "polygon";
  outline: Point2[];
}

export type ParkingLayoutSurface = ParkingRibbonSurface | ParkingPolygonSurface;

export interface ParkingSurfaceExclusion {
  id: string;
  outline: Point2[];
  reason?: string;
}

export type ParkingSlotMembership =
  | {
    kind: "ribbon";
    maximumDistanceMeters: number;
  }
  | {
    kind: "polygon";
  };

export interface ParkingLayoutSlot {
  id: string;
  tileId: string;
  source: ParkingLayoutSource;
  sourceId: string;
  surfaceId: string;
  point: Point2;
  /** Unit direction followed by the parked vehicle's longitudinal axis. */
  tangent: Point2;
  membership: ParkingSlotMembership;
}

export interface ParkingLayout {
  slots: ParkingLayoutSlot[];
  surfaces: ParkingLayoutSurface[];
  /** Polygon masks applied by both renderers and parking-state queries. */
  exclusions: ParkingSurfaceExclusion[];
}

export interface ParkingLayoutOptions {
  municipalRibbonWidth?: number;
  roadSideRibbonWidth?: number;
  roadSideSlotSpacingMeters?: number;
  municipalCoverageMeters?: number;
  deduplicationMeters?: number;
  pedestrianClearanceMeters?: number;
  maxSlotsPerSurface?: number;
  exclusions?: readonly ParkingSurfaceExclusion[];
}

interface PolylineSample {
  point: Point2;
  tangent: Point2;
}

interface RoadChain {
  road: RoadFeature;
  sourceId: string;
  points: Point2[];
  component: number;
}

interface RoadParkingChoice {
  name: "left" | "right";
  metadata: RoadParkingSide;
}

const EPSILON = 1e-6;
const DEFAULT_RIBBON_WIDTH = 2.4;
const DEFAULT_ROAD_SLOT_SPACING_METERS = 5.5;
const DEFAULT_MUNICIPAL_COVERAGE_METERS = 4;
const DEFAULT_DEDUPLICATION_METERS = 1.25;
const DEFAULT_PEDESTRIAN_CLEARANCE_METERS = 2.5;
const DEFAULT_MAX_SLOTS_PER_SURFACE = 256;
const MAX_MUNICIPAL_SOURCE_CAPACITY = 2_048;
const MINIMUM_ROAD_CHAIN_LENGTH_METERS = 4.5;
const POINT_SPACE_LENGTH_METERS = 5;
const POINT_SPACE_WIDTH_METERS = 2.5;
const OFF_STREET_LONGITUDINAL_SPACING_METERS = 5.05;
const OFF_STREET_LATERAL_SPACING_METERS = 2.65;
const OFF_STREET_LONGITUDINAL_MARGIN_METERS = 2.35;
const OFF_STREET_LATERAL_MARGIN_METERS = 1.15;

const DRIVABLE_KINDS = new Set([
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
  "service",
]);

const PEDESTRIAN_CONFLICT_KINDS = new Set([
  "footway",
  "path",
  "pedestrian",
  "steps",
]);

function finitePositive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > EPSILON ? value as number : fallback;
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? -1) >= 0 ? value as number : fallback;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value as number : fallback;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value ?? -1) >= 0 ? value as number : fallback;
}

function isFinitePoint(point: Point2 | undefined): point is Point2 {
  return Boolean(point && Number.isFinite(point[0]) && Number.isFinite(point[1]));
}

function samePoint(left: Point2, right: Point2): boolean {
  return Math.abs(left[0] - right[0]) <= EPSILON
    && Math.abs(left[1] - right[1]) <= EPSILON;
}

function cleanPolyline(points: readonly Point2[] | undefined): Point2[] {
  const result: Point2[] = [];
  for (const point of points ?? []) {
    if (!isFinitePoint(point)) continue;
    const next: Point2 = [point[0], point[1]];
    if (result.length === 0 || !samePoint(result.at(-1) as Point2, next)) result.push(next);
  }
  return result;
}

function cleanPolygon(points: readonly Point2[] | undefined): Point2[] {
  const result = cleanPolyline(points);
  if (result.length > 2 && samePoint(result[0], result.at(-1) as Point2)) result.pop();
  return result;
}

function squaredDistanceToSegment(point: Point2, start: Point2, end: Point2): number {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= EPSILON * EPSILON) {
    const pointDx = point[0] - start[0];
    const pointDz = point[1] - start[1];
    return pointDx * pointDx + pointDz * pointDz;
  }
  const progress = Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared,
  ));
  const projectedX = start[0] + dx * progress;
  const projectedZ = start[1] + dz * progress;
  const pointDx = point[0] - projectedX;
  const pointDz = point[1] - projectedZ;
  return pointDx * pointDx + pointDz * pointDz;
}

function pointOnSegment(point: Point2, start: Point2, end: Point2): boolean {
  return squaredDistanceToSegment(point, start, end) <= EPSILON * EPSILON;
}

/** Boundary-inclusive polygon membership in Munich3D's X/Z plane. */
export function pointInPolygon(point: Point2, outline: readonly Point2[]): boolean {
  const polygon = cleanPolygon(outline);
  if (!isFinitePoint(point) || polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    if (pointOnSegment(point, previousPoint, currentPoint)) return true;
    if ((currentPoint[1] > point[1]) === (previousPoint[1] > point[1])) continue;
    const crossingX = ((previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1]))
      / (previousPoint[1] - currentPoint[1]) + currentPoint[0];
    if (point[0] < crossingX) inside = !inside;
  }
  return inside;
}

/** Shortest planar distance to a point/polyline. */
export function distanceToPolyline(point: Point2, points: readonly Point2[]): number {
  const line = cleanPolyline(points);
  if (!isFinitePoint(point) || line.length === 0) return Number.POSITIVE_INFINITY;
  if (line.length === 1) return Math.hypot(point[0] - line[0][0], point[1] - line[0][1]);
  let minimumSquared = Number.POSITIVE_INFINITY;
  for (let index = 1; index < line.length; index += 1) {
    minimumSquared = Math.min(minimumSquared, squaredDistanceToSegment(point, line[index - 1], line[index]));
  }
  return Math.sqrt(minimumSquared);
}

export function parkingSurfaceContainsPoint(surface: ParkingLayoutSurface, point: Point2): boolean {
  if (surface.kind === "polygon") return pointInPolygon(point, surface.outline);
  return distanceToPolyline(point, surface.points) <= surface.width * 0.5 + EPSILON;
}

export function parkingLayoutContainsPoint(layout: ParkingLayout, point: Point2): boolean {
  return !(layout.exclusions ?? []).some((exclusion) => pointInPolygon(point, exclusion.outline))
    && layout.surfaces.some((surface) => parkingSurfaceContainsPoint(surface, point));
}

export function parkingSlotContainsPoint(
  slot: ParkingLayoutSlot,
  surface: ParkingLayoutSurface,
  point: Point2 = slot.point,
): boolean {
  return slot.surfaceId === surface.id
    && slot.membership.kind === surface.kind
    && parkingSurfaceContainsPoint(surface, point);
}

/**
 * Reject a curb slot whose vehicle-length clearance reaches a mapped crossing
 * or a pedestrian-only path. Explicit sidewalk centerlines are not exclusions:
 * the municipal row itself decides which side of that curb is parkable.
 */
export function parkingConflictsWithPedestrian(
  tile: MunichTile,
  point: Point2,
  clearanceMeters = DEFAULT_PEDESTRIAN_CLEARANCE_METERS,
): boolean {
  const clearance = finiteNonNegative(clearanceMeters, DEFAULT_PEDESTRIAN_CLEARANCE_METERS);
  for (const road of tile.roads ?? []) {
    const isCrossing = road.footway === "crossing";
    const isPedestrianOnly = road.footway !== "sidewalk" && PEDESTRIAN_CONFLICT_KINDS.has(road.kind);
    if (!isCrossing && !isPedestrianOnly) continue;
    const halfWidth = Math.max(finitePositive(road.width, 1.2), 1.2) * 0.5;
    if (distanceToPolyline(point, road.points) <= halfWidth + clearance + EPSILON) return true;
  }
  return false;
}

function polylineLength(points: readonly Point2[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
    );
  }
  return length;
}

function normalizeDirection(x: number, z: number): Point2 {
  const length = Math.hypot(x, z);
  return length > EPSILON ? [x / length, z / length] : [1, 0];
}

function samplePolyline(points: readonly Point2[], distanceMeters: number): PolylineSample | null {
  const line = cleanPolyline(points);
  if (line.length < 2) return null;
  const totalLength = polylineLength(line);
  if (totalLength <= EPSILON) return null;
  let remaining = Math.max(0, Math.min(totalLength, distanceMeters));
  for (let index = 1; index < line.length; index += 1) {
    const start = line[index - 1];
    const end = line[index];
    const dx = end[0] - start[0];
    const dz = end[1] - start[1];
    const length = Math.hypot(dx, dz);
    if (length <= EPSILON) continue;
    if (remaining <= length + EPSILON || index === line.length - 1) {
      const progress = Math.max(0, Math.min(1, remaining / length));
      return {
        point: [start[0] + dx * progress, start[1] + dz * progress],
        tangent: [dx / length, dz / length],
      };
    }
    remaining -= length;
  }
  return null;
}

function longestPolygonAxis(outline: readonly Point2[]): Point2 {
  let tangent: Point2 = [1, 0];
  let longest = 0;
  for (let index = 0; index < outline.length; index += 1) {
    const next = outline[(index + 1) % outline.length];
    const dx = next[0] - outline[index][0];
    const dz = next[1] - outline[index][1];
    const length = Math.hypot(dx, dz);
    if (length <= longest) continue;
    longest = length;
    tangent = normalizeDirection(dx, dz);
  }
  return tangent;
}

function polygonArea(outline: readonly Point2[]): number {
  let sum = 0;
  for (let index = 0; index < outline.length; index += 1) {
    const next = outline[(index + 1) % outline.length];
    sum += outline[index][0] * next[1] - next[0] * outline[index][1];
  }
  return Math.abs(sum) * 0.5;
}

function polygonCentroid(outline: readonly Point2[]): Point2 {
  let signedArea = 0;
  let x = 0;
  let z = 0;
  for (let index = 0; index < outline.length; index += 1) {
    const next = outline[(index + 1) % outline.length];
    const cross = outline[index][0] * next[1] - next[0] * outline[index][1];
    signedArea += cross;
    x += (outline[index][0] + next[0]) * cross;
    z += (outline[index][1] + next[1]) * cross;
  }
  if (Math.abs(signedArea) <= EPSILON) {
    return [
      outline.reduce((sum, point) => sum + point[0], 0) / outline.length,
      outline.reduce((sum, point) => sum + point[1], 0) / outline.length,
    ];
  }
  return [x / (3 * signedArea), z / (3 * signedArea)];
}

function interiorPolygonPoint(feature: ParkingFeature, outline: readonly Point2[]): Point2 {
  if (isFinitePoint(feature.point) && pointInPolygon(feature.point, outline)) {
    return [feature.point[0], feature.point[1]];
  }
  const centroid = polygonCentroid(outline);
  if (pointInPolygon(centroid, outline)) return centroid;
  // The midpoint between a boundary vertex and a known interior candidate is
  // deterministic and succeeds for ordinary concave parking polygons.
  for (const vertex of outline) {
    const candidate: Point2 = [(vertex[0] + centroid[0]) * 0.5, (vertex[1] + centroid[1]) * 0.5];
    if (pointInPolygon(candidate, outline)) return candidate;
  }
  return [outline[0][0], outline[0][1]];
}

function orientedRectangle(center: Point2, tangent: Point2, length: number, width: number): Point2[] {
  const direction = normalizeDirection(tangent[0], tangent[1]);
  const normal: Point2 = [-direction[1], direction[0]];
  const halfLength = length * 0.5;
  const halfWidth = width * 0.5;
  return [
    [center[0] - direction[0] * halfLength - normal[0] * halfWidth,
      center[1] - direction[1] * halfLength - normal[1] * halfWidth],
    [center[0] + direction[0] * halfLength - normal[0] * halfWidth,
      center[1] + direction[1] * halfLength - normal[1] * halfWidth],
    [center[0] + direction[0] * halfLength + normal[0] * halfWidth,
      center[1] + direction[1] * halfLength + normal[1] * halfWidth],
    [center[0] - direction[0] * halfLength + normal[0] * halfWidth,
      center[1] - direction[1] * halfLength + normal[1] * halfWidth],
  ];
}

function roadAllowsMotorVehicles(road: RoadFeature): boolean {
  if (!DRIVABLE_KINDS.has(road.kind)) return false;
  const access = String(road.motorcar ?? road.motorVehicle ?? road.vehicle ?? road.access ?? "").toLowerCase();
  return access !== "no" && access !== "private";
}

function parkingSideAllowed(side: RoadParkingSide | undefined): side is RoadParkingSide {
  if (!side?.position) return false;
  const position = side.position.trim().toLowerCase();
  if (/^(?:no|none|separate|no_parking|no_stopping|no_standing)$/.test(position)) return false;
  if (/no_(?:parking|stopping|standing)/i.test(side.restriction ?? "")) return false;
  if (/no_(?:parking|stopping|standing)/i.test(side.condition ?? "")) return false;
  return true;
}

function parkingChoices(road: RoadFeature): RoadParkingChoice[] {
  const tagged = road.parking;
  if (!tagged) return [];
  if (parkingSideAllowed(tagged.both)) {
    return [
      { name: "left", metadata: tagged.both },
      { name: "right", metadata: tagged.both },
    ];
  }
  const choices: RoadParkingChoice[] = [];
  if (parkingSideAllowed(tagged.left)) choices.push({ name: "left", metadata: tagged.left });
  if (parkingSideAllowed(tagged.right)) choices.push({ name: "right", metadata: tagged.right });
  return choices;
}

function parkingLateralOffset(roadWidth: number, metadata: RoadParkingSide): number {
  const edge = Math.max(roadWidth, 3.5) * 0.5;
  const angled = metadata.orientation === "diagonal" || metadata.orientation === "perpendicular";
  switch (metadata.position) {
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

function rotateDirection(direction: Point2, angle: number): Point2 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return normalizeDirection(
    direction[0] * cosine + direction[1] * sine,
    direction[1] * cosine - direction[0] * sine,
  );
}

function orientedParkingTangent(direction: Point2, choice: RoadParkingChoice): Point2 {
  const angle = choice.metadata.orientation === "perpendicular"
    ? Math.PI / 2
    : choice.metadata.orientation === "diagonal" ? Math.PI / 4 : 0;
  return rotateDirection(direction, angle * (choice.name === "left" ? 1 : -1));
}

function segmentDirection(start: Point2, end: Point2): Point2 {
  return normalizeDirection(end[0] - start[0], end[1] - start[1]);
}

function offsetPolyline(points: readonly Point2[], choice: RoadParkingChoice, distance: number): Point2[] {
  const line = cleanPolyline(points);
  if (line.length < 2) return [];
  const sideSign = choice.name === "left" ? 1 : -1;
  const result: Point2[] = [];
  for (let index = 0; index < line.length; index += 1) {
    const previousDirection = index > 0
      ? segmentDirection(line[index - 1], line[index])
      : segmentDirection(line[index], line[index + 1]);
    const nextDirection = index < line.length - 1
      ? segmentDirection(line[index], line[index + 1])
      : previousDirection;
    const previousNormal: Point2 = [previousDirection[1] * sideSign, -previousDirection[0] * sideSign];
    const nextNormal: Point2 = [nextDirection[1] * sideSign, -nextDirection[0] * sideSign];
    const average = normalizeDirection(
      previousNormal[0] + nextNormal[0],
      previousNormal[1] + nextNormal[1],
    );
    const alignment = Math.max(0.42, average[0] * nextNormal[0] + average[1] * nextNormal[1]);
    const miterLength = Math.min(distance / alignment, distance * 2.4);
    result.push([
      line[index][0] + average[0] * miterLength,
      line[index][1] + average[1] * miterLength,
    ]);
  }
  return result;
}

function pointKey(point: Point2): string {
  return `${point[0].toFixed(3)},${point[1].toFixed(3)}`;
}

function roadGroupKey(road: RoadFeature, index: number): string {
  if (!road.sourceId) return `tile-road-${index}`;
  return [
    road.sourceId,
    road.kind,
    finitePositive(road.width, 3.5).toFixed(2),
    JSON.stringify(road.parking ?? {}),
  ].join("|");
}

/** Join source-way edges before sampling so shared OSM vertices cannot create duplicate bays. */
function roadChains(tile: MunichTile): RoadChain[] {
  const groups = new Map<string, Array<{ road: RoadFeature; points: Point2[]; index: number }>>();
  for (let index = 0; index < (tile.roads ?? []).length; index += 1) {
    const road = tile.roads[index];
    if (!roadAllowsMotorVehicles(road) || parkingChoices(road).length === 0) continue;
    const points = cleanPolyline(road.points);
    if (points.length < 2) continue;
    const key = roadGroupKey(road, index);
    const group = groups.get(key) ?? [];
    for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
      group.push({ road, points: [points[pointIndex - 1], points[pointIndex]], index });
    }
    groups.set(key, group);
  }

  const result: RoadChain[] = [];
  for (const [groupKey, segments] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
    const unused = [...segments].sort((left, right) => {
      const leftKey = `${pointKey(left.points[0])}:${pointKey(left.points[1])}`;
      const rightKey = `${pointKey(right.points[0])}:${pointKey(right.points[1])}`;
      return leftKey.localeCompare(rightKey) || left.index - right.index;
    });
    const components: Array<{ road: RoadFeature; points: Point2[] }> = [];
    while (unused.length > 0) {
      const endKeys = new Set(unused.map((segment) => pointKey(segment.points[1])));
      let firstIndex = unused.findIndex((segment) => !endKeys.has(pointKey(segment.points[0])));
      if (firstIndex < 0) firstIndex = 0;
      const first = unused.splice(firstIndex, 1)[0];
      const points = [...first.points] as Point2[];
      while (true) {
        const endKey = pointKey(points.at(-1) as Point2);
        const nextIndex = unused.findIndex((segment) => pointKey(segment.points[0]) === endKey);
        if (nextIndex < 0) break;
        const next = unused.splice(nextIndex, 1)[0];
        points.push(next.points[1]);
      }
      components.push({ road: first.road, points });
    }
    components.sort((left, right) => {
      const leftKey = `${pointKey(left.points[0])}:${pointKey(left.points.at(-1) as Point2)}`;
      const rightKey = `${pointKey(right.points[0])}:${pointKey(right.points.at(-1) as Point2)}`;
      return leftKey.localeCompare(rightKey);
    });
    components.forEach((component, componentIndex) => {
      result.push({
        ...component,
        sourceId: component.road.sourceId ?? `${tile.id}:${groupKey}`,
        component: componentIndex,
      });
    });
  }
  return result;
}

function nearestRoadTangent(tile: MunichTile, point: Point2): Point2 {
  let nearestDistance = Number.POSITIVE_INFINITY;
  let tangent: Point2 = [1, 0];
  for (const road of tile.roads ?? []) {
    if (!roadAllowsMotorVehicles(road)) continue;
    const points = cleanPolyline(road.points);
    for (let index = 1; index < points.length; index += 1) {
      const distance = squaredDistanceToSegment(point, points[index - 1], points[index]);
      if (distance >= nearestDistance) continue;
      nearestDistance = distance;
      tangent = segmentDirection(points[index - 1], points[index]);
    }
  }
  return tangent;
}

function offStreetCandidates(outline: readonly Point2[], tangent: Point2): Point2[] {
  const normal: Point2 = [-tangent[1], tangent[0]];
  const along = outline.map((point) => point[0] * tangent[0] + point[1] * tangent[1]);
  const across = outline.map((point) => point[0] * normal[0] + point[1] * normal[1]);
  const minimumAlong = Math.min(...along);
  const maximumAlong = Math.max(...along);
  const minimumAcross = Math.min(...across);
  const maximumAcross = Math.max(...across);
  const result: Point2[] = [];
  for (
    let acrossPosition = minimumAcross + OFF_STREET_LATERAL_MARGIN_METERS;
    acrossPosition <= maximumAcross - OFF_STREET_LATERAL_MARGIN_METERS + EPSILON;
    acrossPosition += OFF_STREET_LATERAL_SPACING_METERS
  ) {
    for (
      let alongPosition = minimumAlong + OFF_STREET_LONGITUDINAL_MARGIN_METERS;
      alongPosition <= maximumAlong - OFF_STREET_LONGITUDINAL_MARGIN_METERS + EPSILON;
      alongPosition += OFF_STREET_LONGITUDINAL_SPACING_METERS
    ) {
      const point: Point2 = [
        tangent[0] * alongPosition + normal[0] * acrossPosition,
        tangent[1] * alongPosition + normal[1] * acrossPosition,
      ];
      if (pointInPolygon(point, outline)) result.push(point);
    }
  }
  return result;
}

function eligibleParkingFeature(feature: ParkingFeature): boolean {
  return !["underground", "multi-storey", "carports"].includes(feature.parking ?? "")
    && feature.access !== "no"
    && feature.access !== "private"
    && isFinitePoint(feature.point);
}

function municipalSlotCandidates(
  tile: MunichTile,
  row: ParkingRowFeature,
  surface: ParkingRibbonSurface,
  pedestrianClearanceMeters: number,
): ParkingLayoutSlot[] {
  const points = cleanPolyline(row.points);
  const pieceLength = polylineLength(points);
  const sourceCapacity = Math.min(
    positiveInteger(row.sourceCapacity, 0),
    MAX_MUNICIPAL_SOURCE_CAPACITY,
  );
  const pieceCapacity = Math.min(
    nonNegativeInteger(row.capacity, 0),
    sourceCapacity,
  );
  const sourceLength = finitePositive(row.sourceLengthMeters, 0);
  const sourceStart = finiteNonNegative(row.sourceStartMeters, 0);
  if (
    points.length < 2
    || pieceLength <= EPSILON
    || sourceCapacity === 0
    || pieceCapacity === 0
    || sourceLength <= EPSILON
  ) return [];
  const pieceEnd = sourceStart + pieceLength;
  const slots: ParkingLayoutSlot[] = [];
  const sourceSpacing = sourceLength / sourceCapacity;
  // Ingestion rounds piece geometry and offsets to centimetres after assigning
  // capacity. Around a tile seam that rounding can make one source-wide center
  // appear inside both pieces. The allocated piece capacity removes that
  // ambiguity: choose its contiguous source ordinals around the piece midpoint.
  const midpointOrdinal = ((sourceStart + pieceEnd) * 0.5) / sourceSpacing - 0.5;
  const firstOrdinal = Math.max(0, Math.min(
    sourceCapacity - pieceCapacity,
    Math.round(midpointOrdinal - (pieceCapacity - 1) * 0.5),
  ));
  for (let ordinal = firstOrdinal; ordinal < firstOrdinal + pieceCapacity; ordinal += 1) {
    const sourceDistance = (ordinal + 0.5) * sourceLength / sourceCapacity;
    const sample = samplePolyline(points, sourceDistance - sourceStart);
    if (!sample || parkingConflictsWithPedestrian(tile, sample.point, pedestrianClearanceMeters)) continue;
    slots.push({
      id: `parking-slot:municipal:${row.sourceId}:${ordinal}`,
      tileId: tile.id,
      source: "municipal-row",
      sourceId: row.sourceId,
      surfaceId: surface.id,
      point: sample.point,
      tangent: sample.tangent,
      membership: { kind: "ribbon", maximumDistanceMeters: surface.width * 0.5 },
    });
  }
  return slots;
}

/**
 * Build the one canonical ambient-parking contract for a streamed tile.
 * Renderers consume `surfaces`; vehicle systems consume the linked `slots`.
 */
export function deriveParkingLayout(tile: MunichTile, options: ParkingLayoutOptions = {}): ParkingLayout {
  const municipalRibbonWidth = finitePositive(options.municipalRibbonWidth, DEFAULT_RIBBON_WIDTH);
  const roadSideRibbonWidth = Math.max(
    DEFAULT_RIBBON_WIDTH,
    finitePositive(options.roadSideRibbonWidth, DEFAULT_RIBBON_WIDTH),
  );
  const roadSpacing = finitePositive(options.roadSideSlotSpacingMeters, DEFAULT_ROAD_SLOT_SPACING_METERS);
  const municipalCoverage = finiteNonNegative(
    options.municipalCoverageMeters,
    DEFAULT_MUNICIPAL_COVERAGE_METERS,
  );
  const deduplicationMeters = finiteNonNegative(
    options.deduplicationMeters,
    DEFAULT_DEDUPLICATION_METERS,
  );
  const pedestrianClearance = finiteNonNegative(
    options.pedestrianClearanceMeters,
    DEFAULT_PEDESTRIAN_CLEARANCE_METERS,
  );
  const maxSlotsPerSurface = Math.min(
    2_048,
    positiveInteger(options.maxSlotsPerSurface, DEFAULT_MAX_SLOTS_PER_SURFACE),
  );

  const slots: ParkingLayoutSlot[] = [];
  const surfaces = new Map<string, ParkingLayoutSurface>();
  const slotIds = new Set<string>();
  const exclusions = [...(options.exclusions ?? [])]
    .map((exclusion) => ({
      id: exclusion.id,
      outline: cleanPolygon(exclusion.outline),
      ...(exclusion.reason ? { reason: exclusion.reason } : {}),
    }))
    .filter((exclusion) => exclusion.id.length > 0 && exclusion.outline.length >= 3)
    .sort((left, right) => left.id.localeCompare(right.id));
  const addSurface = (surface: ParkingLayoutSurface): void => {
    if (!surfaces.has(surface.id)) surfaces.set(surface.id, surface);
  };
  const addSlot = (slot: ParkingLayoutSlot): boolean => {
    if (slotIds.has(slot.id)) return false;
    if (exclusions.some((exclusion) => pointInPolygon(slot.point, exclusion.outline))) return false;
    const duplicate = slots.some((existing) => (
      existing.source !== slot.source
      && Math.hypot(existing.point[0] - slot.point[0], existing.point[1] - slot.point[1])
        < deduplicationMeters - EPSILON
    ));
    if (duplicate) return false;
    const surface = surfaces.get(slot.surfaceId);
    if (!surface || !parkingSlotContainsPoint(slot, surface)) return false;
    slotIds.add(slot.id);
    slots.push(slot);
    return true;
  };

  const municipalRows = [...(tile.parkingRows ?? [])].sort((left, right) => (
    left.sourceId.localeCompare(right.sourceId)
    || left.sourceStartMeters - right.sourceStartMeters
    || left.id.localeCompare(right.id)
  ));
  const municipalLines: Point2[][] = [];
  for (const row of municipalRows) {
    const points = cleanPolyline(row.points);
    if (points.length < 2 || polylineLength(points) <= EPSILON) continue;
    const surface: ParkingRibbonSurface = {
      kind: "ribbon",
      id: `parking-surface:municipal:${row.id}`,
      source: "municipal-row",
      sourceId: row.sourceId,
      points,
      width: municipalRibbonWidth,
    };
    addSurface(surface);
    municipalLines.push(points);
    for (const slot of municipalSlotCandidates(tile, row, surface, pedestrianClearance)) addSlot(slot);
  }

  const features = [...(tile.parking ?? [])]
    .filter(eligibleParkingFeature)
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "parking_space" ? -1 : 1;
      return left.id.localeCompare(right.id);
    });
  for (const feature of features) {
    const source: ParkingLayoutSource = feature.kind === "parking_space"
      ? "osm-parking-space"
      : "osm-parking-area";
    const sourceId = feature.id;
    const outline = cleanPolygon(feature.outline);
    const tangent = outline.length >= 3
      ? longestPolygonAxis(outline)
      : nearestRoadTangent(tile, feature.point);
    const surfaceOutline = outline.length >= 3
      ? outline
      : orientedRectangle(feature.point, tangent, POINT_SPACE_LENGTH_METERS, POINT_SPACE_WIDTH_METERS);
    const surface: ParkingPolygonSurface = {
      kind: "polygon",
      id: `parking-surface:osm:${feature.id}`,
      source,
      sourceId,
      outline: surfaceOutline,
    };
    addSurface(surface);

    let candidates: Point2[];
    if (feature.kind === "parking_space" || outline.length < 3) {
      candidates = [outline.length >= 3
        ? interiorPolygonPoint(feature, outline)
        : [feature.point[0], feature.point[1]]];
    } else {
      const grid = offStreetCandidates(outline, tangent);
      if (grid.length === 0) grid.push(interiorPolygonPoint(feature, outline));
      const estimatedCapacity = positiveInteger(
        feature.capacity,
        Math.max(1, Math.floor(polygonArea(outline) / 13)),
      );
      const count = Math.min(estimatedCapacity, grid.length, maxSlotsPerSurface);
      candidates = [];
      for (let ordinal = 0; ordinal < count; ordinal += 1) {
        const index = Math.min(grid.length - 1, Math.floor((ordinal + 0.5) * grid.length / count));
        candidates.push(grid[index]);
      }
    }
    candidates.slice(0, maxSlotsPerSurface).forEach((point, ordinal) => {
      addSlot({
        id: `parking-slot:osm:${feature.id}:${ordinal}`,
        tileId: tile.id,
        source,
        sourceId,
        surfaceId: surface.id,
        point,
        tangent,
        membership: { kind: "polygon" },
      });
    });
  }

  for (const chain of roadChains(tile)) {
    const choices = parkingChoices(chain.road);
    for (const choice of choices) {
      const offset = parkingLateralOffset(finitePositive(chain.road.width, 3.5), choice.metadata);
      const points = offsetPolyline(chain.points, choice, offset);
      const length = polylineLength(points);
      if (points.length < 2 || length < MINIMUM_ROAD_CHAIN_LENGTH_METERS) continue;
      // The same OSM way can contribute disconnected components to several
      // streamed tiles. Tile + component keeps IDs globally unique while the
      // source ID still provides their semantic grouping.
      const sourceKey = `${chain.sourceId}:${tile.id}:${chain.component}:${choice.name}`;
      const surface: ParkingRibbonSurface = {
        kind: "ribbon",
        id: `parking-surface:osm-road-side:${sourceKey}`,
        source: "osm-road-side",
        sourceId: chain.sourceId,
        points,
        width: roadSideRibbonWidth,
      };
      const count = Math.min(maxSlotsPerSurface, Math.max(1, Math.floor(length / roadSpacing)));
      const candidates: ParkingLayoutSlot[] = [];
      for (let ordinal = 0; ordinal < count; ordinal += 1) {
        const sample = samplePolyline(points, (ordinal + 0.5) * length / count);
        if (!sample) continue;
        if (municipalLines.some((line) => distanceToPolyline(sample.point, line) <= municipalCoverage)) continue;
        if (parkingConflictsWithPedestrian(tile, sample.point, pedestrianClearance)) continue;
        candidates.push({
          id: `parking-slot:osm-road-side:${sourceKey}:${ordinal}`,
          tileId: tile.id,
          source: "osm-road-side",
          sourceId: chain.sourceId,
          surfaceId: surface.id,
          point: sample.point,
          tangent: orientedParkingTangent(sample.tangent, choice),
          membership: { kind: "ribbon", maximumDistanceMeters: surface.width * 0.5 },
        });
      }
      // A completely covered road-side source is represented by its preferred
      // municipal row only. Partial fallbacks retain their source ribbon so the
      // renderer can clip it at crossings with the shared conflict predicate.
      if (candidates.length === 0) continue;
      addSurface(surface);
      for (const slot of candidates) addSlot(slot);
    }
  }

  return {
    slots: slots.sort((left, right) => left.id.localeCompare(right.id)),
    surfaces: [...surfaces.values()].sort((left, right) => left.id.localeCompare(right.id)),
    exclusions,
  };
}
