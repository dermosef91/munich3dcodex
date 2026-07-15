import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { publicUrl } from "../publicUrl";
import earcut from "earcut";
import { getBuildingFacade, type BuildingFacadeDefinition } from "./facadeRegistry";
import {
  deriveFacadeSpec,
  type FacadeAttributes,
  type FacadeColor,
  type FacadeSpec,
  type MunichDistrict,
} from "./facadeSpecs";
import { closestDistrict } from "./geo";
import {
  getPhotorealFacadeMaterial,
  selectPhotorealFacadeBundle,
  type FacadeTextureBundleId,
  type FacadeTextureLayer,
} from "./photorealFacadeMaterials";
import { buildStreetFurniture } from "./streetFurniture";
import { buildStorefronts } from "./storefronts";
import { buildParkingSurfaceMeshes } from "./parkingSurfaces";
import { buildStreetSurfaceDetails } from "./streetSurfaceDetails";
import { buildCurbsideDetailMeshes } from "./curbsideDetails";
import {
  deriveParkingLayout,
  type ParkingLayout,
  type ParkingSurfaceExclusion,
} from "./parkingLayout";
import { isLandmarkReplacementBuilding } from "./landmarkRegistry";
import type {
  BuildingFeature,
  GreenFeature,
  MunichTile,
  Point2,
  RoadFeature,
  SurfaceMeshData,
} from "./types";

interface Buffers {
  positions: number[];
  indices: number[];
  colors: number[];
  uvs: number[];
}

interface SurfaceVertex {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
}

interface BuildingFacadeBuffers {
  definition: BuildingFacadeDefinition;
  buildingId: number;
  front: Buffers;
  sides: Buffers;
  backing: Buffers;
}

interface FacadeMaterialBuffers {
  bundleId: FacadeTextureBundleId;
  layer: FacadeTextureLayer;
  target: Buffers;
}

interface SharedMaterials {
  curbFace: StandardMaterial;
  curbTop: StandardMaterial;
  ground: StandardMaterial;
  roadFallback: StandardMaterial;
  roofs: StandardMaterial;
  roofTiles: StandardMaterial;
  surfaces: Record<TexturedSurfaceKind, StandardMaterial>;
  water: StandardMaterial;
}

export interface TileMeshSet {
  meshes: Mesh[];
  buildingShadowCasters: Mesh[];
  detailMeshes: Mesh[];
  shadowReceivers: Mesh[];
  parkingLayout: ParkingLayout;
}

type TexturedSurfaceKind = "asphalt" | "cobblestone" | "compacted" | "grass" | "sidewalk";
type RoadSurfaceKind = TexturedSurfaceKind | "fallback";

interface SurfaceMaterialProfile {
  textureUrl: string;
  diffuseColor: Color3;
  specularColor: Color3;
}

interface RoadChain {
  road: RoadFeature;
  points: Point2[];
}

interface CarriagewaySegment {
  start: Point2;
  end: Point2;
  halfWidth: number;
  surfaceY: number;
}

interface ParallelCarriagewayMatch {
  curbSide: -1 | 1;
  distance: number;
  halfWidth: number;
  surfaceY: number;
}

interface BuiltRoads {
  meshes: Mesh[];
  parkingExclusions: ParkingSurfaceExclusion[];
}

interface ParkingExclusionCapture {
  target: ParkingSurfaceExclusion[];
  idPrefix: string;
  reason: "sidewalk" | "crossing";
}

const sharedMaterialsByScene = new WeakMap<Scene, SharedMaterials>();
const customMaterialsByScene = new WeakMap<
  Scene,
  Map<number, { front: PBRMaterial; sides: PBRMaterial; backing: PBRMaterial }>
>();

// OSM paths, cycleways and carriageways frequently cross or partially overlap.
// The lower layers keep coincident ribbons stable. Mapped sidewalks use a
// separate real-world profile: a roughly 11 cm kerb above the carriageway and
// short ramps wherever a mapped crossing meets the walking surface.
const GREEN_SURFACE_Y = 0.01;
const PEDESTRIAN_SURFACE_Y = 0.02;
const CYCLEWAY_SURFACE_Y = 0.03;
const LOCAL_ROAD_SURFACE_Y = 0.04;
const MAJOR_ROAD_SURFACE_Y = 0.05;
const CROSSING_SURFACE_Y = MAJOR_ROAD_SURFACE_Y + 0.002;
const SIDEWALK_SURFACE_Y = 0.16;
const SIDEWALK_RAMP_LENGTH = 1.35;
const SIDEWALK_OUTER_REACH = 1.9;
const MAX_SIDEWALK_STREET_REACH = 6;
const MAX_PARALLEL_ROAD_DISTANCE = 18;
const PARALLEL_ALIGNMENT_THRESHOLD = 0.72;
const CURB_WIDTH = 0.22;
const CURB_TOP_RISE = 0.006;
const MITER_LIMIT = 2.4;

const WINDOWLESS_BUILDING_KINDS = new Set([
  "bridge",
  "carport",
  "container",
  "fence",
  "garage",
  "garages",
  "greenhouse",
  "retaining_wall",
  "roof",
  "shed",
  "silo",
  "wall",
]);

// Official AdV function codes carried by the Bavarian LoD2 feed. These are
// non-occupied structures and must never inherit a residential window sheet.
const WINDOWLESS_LOD2_FUNCTIONS = new Set([
  "51009_1610", // Ueberdachung / canopy
  "51009_1700", // Mauer / freestanding wall
  "31001_2463", // garage
]);
const GROUND_REPEAT_METERS = 8;
const GROUND_TEXTURE_URL = "/assets/textures/materials/munich-urban-ground-v2.png";
const ROOF_REPEAT_METERS = 3;
const ROOF_TEXTURE_URL = "/assets/textures/materials/roof_tiles.jpg";
const FLAT_ROOF_TEXTURE_URL = "/assets/textures/materials/munich-flat-roof-v1.png";
const WATER_REPEAT_METERS = 12;
const WATER_TEXTURE_URL = "/assets/textures/materials/munich-water-v1.png";

// Reviewed art direction for buildings that need a known facade module while
// retaining their native LoD2 geometry and independently placed storefronts.
const FACADE_BUNDLE_OVERRIDES = new Map<number, FacadeTextureBundleId>([
  [116102238, "elisabeth-postwar-yellow"], // Tengstrasse 31 / Dompierre
  [116756186, "elisabeth-postwar-yellow"], // Elisabethstrasse 39 / Torso + Benyou
]);

const MAJOR_ROAD_KINDS = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);
const PEDESTRIAN_ROAD_KINDS = new Set(["footway", "pedestrian", "path", "steps"]);
const SIDEWALK_ROAD_KINDS = new Set([
  ...PEDESTRIAN_ROAD_KINDS,
  "bus_stop",
  "corridor",
  "elevator",
  "platform",
]);
const CARRIAGEWAY_ROAD_KINDS = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "living_street",
  "service",
  "road",
]);
const ASPHALT_SURFACES = new Set(["asphalt", "chipseal"]);
const COBBLESTONE_SURFACES = new Set([
  "cobblestone",
  "pebblestone",
  "sett",
  "unhewn_cobblestone",
]);
const COMPACTED_SURFACES = new Set([
  "compacted",
  "dirt",
  "earth",
  "fine_gravel",
  "gravel",
  "ground",
  "sand",
]);
const GRASS_SURFACES = new Set(["grass"]);
const SIDEWALK_SURFACES = new Set([
  "concrete",
  "concrete:plates",
  "paving_stones",
  "stone",
]);

const SURFACE_MATERIAL_PROFILES: Record<TexturedSurfaceKind, SurfaceMaterialProfile> = {
  asphalt: {
    textureUrl: "/assets/textures/materials/munich-asphalt-v1.png",
    diffuseColor: new Color3(0.94, 0.94, 0.92),
    specularColor: new Color3(0.055, 0.055, 0.05),
  },
  cobblestone: {
    textureUrl: "/assets/textures/materials/munich-cobblestone-v1.png",
    diffuseColor: new Color3(0.91, 0.89, 0.84),
    specularColor: new Color3(0.045, 0.045, 0.04),
  },
  compacted: {
    textureUrl: "/assets/textures/materials/munich-compacted-gravel-v1.png",
    diffuseColor: new Color3(0.92, 0.90, 0.85),
    specularColor: new Color3(0.025, 0.025, 0.022),
  },
  grass: {
    textureUrl: "/assets/textures/materials/munich-park-grass-v2.png",
    diffuseColor: new Color3(0.78, 0.86, 0.72),
    specularColor: Color3.Black(),
  },
  sidewalk: {
    textureUrl: "/assets/textures/materials/munich-sidewalk-v2.png",
    // Compensate for the warm directional sun so the in-world slabs retain
    // the cool neutral grey of the photographed pavement.
    diffuseColor: new Color3(0.78, 0.88, 1.0),
    specularColor: new Color3(0.04, 0.04, 0.035),
  },
};

const SURFACE_REPEAT_METERS: Record<TexturedSurfaceKind, number> = {
  asphalt: 10,
  cobblestone: 4,
  compacted: 5,
  grass: 8,
  // The source sheet contains eight staggered courses. A 3.2 m repeat gives
  // the roughly 40–50 cm rectangular slabs visible on Munich pavements.
  sidewalk: 3.2,
};

function isMappedSidewalk(road: RoadFeature): boolean {
  return road.footway === "sidewalk";
}

function isMappedCrossing(road: RoadFeature): boolean {
  return road.footway === "crossing";
}

function roadSurfaceElevation(road: RoadFeature): number {
  if (isMappedSidewalk(road)) return SIDEWALK_SURFACE_Y;
  if (isMappedCrossing(road)) return CROSSING_SURFACE_Y;
  if (PEDESTRIAN_ROAD_KINDS.has(road.kind)) return PEDESTRIAN_SURFACE_Y;
  if (road.kind === "cycleway") return CYCLEWAY_SURFACE_Y;
  return MAJOR_ROAD_KINDS.has(road.kind) ? MAJOR_ROAD_SURFACE_Y : LOCAL_ROAD_SURFACE_Y;
}

function classifiedSurfaceKind(
  surface: string | undefined,
  fallback: RoadSurfaceKind,
): RoadSurfaceKind {
  const surfaces = surface
    ?.split(";")
    .map((surface) => surface.trim())
    .filter(Boolean) ?? [];
  if (surfaces.some((surface) => COBBLESTONE_SURFACES.has(surface))) return "cobblestone";
  if (surfaces.some((surface) => ASPHALT_SURFACES.has(surface))) return "asphalt";
  if (surfaces.some((surface) => COMPACTED_SURFACES.has(surface))) return "compacted";
  if (surfaces.some((surface) => GRASS_SURFACES.has(surface))) return "grass";
  if (surfaces.some((surface) => SIDEWALK_SURFACES.has(surface))) return "sidewalk";
  if (surfaces.length > 0 && !surfaces.every((surface) => surface === "paved")) return "fallback";
  return fallback;
}

function roadSurfaceKind(road: RoadFeature): RoadSurfaceKind {
  const fallback = SIDEWALK_ROAD_KINDS.has(road.kind) ? "sidewalk" : "asphalt";
  const pedestrianSurface = (isMappedSidewalk(road) || isMappedCrossing(road))
    ? road.footwaySurface ?? road.surface
    : road.surface;
  return classifiedSurfaceKind(pedestrianSurface, fallback);
}

function worldSurfaceUv(point: Point2, kind: TexturedSurfaceKind): Point2 {
  const repeat = SURFACE_REPEAT_METERS[kind];
  return [point[0] / repeat, point[1] / repeat];
}

function groundSurfaceUv(point: Point2): Point2 {
  return [point[0] / GROUND_REPEAT_METERS, point[1] / GROUND_REPEAT_METERS];
}

function applyWorldGroundUvs(ground: Mesh, center: Point2): void {
  const positions = ground.getVerticesData(VertexBuffer.PositionKind);
  if (!positions) throw new Error(`Ground mesh ${ground.name} has no positions`);
  const uvs: number[] = [];
  for (let index = 0; index < positions.length; index += 3) {
    const uv = groundSurfaceUv([
      positions[index] + center[0],
      positions[index + 2] + center[1],
    ]);
    uvs.push(uv[0], uv[1]);
  }
  ground.setVerticesData(VertexBuffer.UVKind, uvs);
}

function roadSurfaceUv(
  point: Point2,
  kind: RoadSurfaceKind,
  distanceAcross: number,
  distanceAlong: number,
): Point2 {
  if (kind === "fallback") return [0, 0];
  if (kind === "sidewalk") {
    const repeat = SURFACE_REPEAT_METERS.sidewalk;
    return [distanceAcross / repeat, distanceAlong / repeat];
  }
  return worldSurfaceUv(point, kind);
}

function roadTint(road: RoadFeature): Color4 {
  return road.kind === "cycleway"
    ? new Color4(0.78, 0.91, 0.82, 1)
    : new Color4(1, 1, 1, 1);
}

function fallbackRoadColor(kind: string): Color4 {
  if (["motorway", "trunk", "primary", "secondary"].includes(kind)) return new Color4(0.26, 0.28, 0.27, 1);
  if (SIDEWALK_ROAD_KINDS.has(kind)) return new Color4(0.49, 0.47, 0.42, 1);
  if (kind === "cycleway") return new Color4(0.34, 0.42, 0.39, 1);
  return new Color4(0.34, 0.35, 0.33, 1);
}

function buffers(): Buffers {
  return { positions: [], indices: [], colors: [], uvs: [] };
}

function pushVertex(
  target: Buffers,
  point: Point2,
  y: number,
  color: Color4,
  uv: Point2 = [0, 0],
): number {
  const index = target.positions.length / 3;
  target.positions.push(point[0], y, point[1]);
  target.colors.push(color.r, color.g, color.b, color.a);
  target.uvs.push(uv[0], uv[1]);
  return index;
}

function cleanRing(points: Point2[]): Point2[] {
  if (points.length < 3) return [];
  const ring = points.slice();
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) ring.pop();
  return ring;
}

function facadeColor([red, green, blue]: FacadeColor): Color4 {
  return new Color4(red, green, blue, 1);
}

function facadeTint([red, green, blue]: FacadeColor): Color4 {
  const strength = 0.22;
  return new Color4(
    1 - (1 - red) * strength,
    1 - (1 - green) * strength,
    1 - (1 - blue) * strength,
    1,
  );
}

function ringCenter(points: Point2[]): Point2 {
  return points.reduce(
    (sum, [x, z]) => [sum[0] + x / points.length, sum[1] + z / points.length] as Point2,
    [0, 0] as Point2,
  );
}

function signedRingArea(points: Point2[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area * 0.5;
}

function ringPerimeter(points: Point2[]): number {
  let perimeter = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    perimeter += Math.hypot(next[0] - current[0], next[1] - current[1]);
  }
  return perimeter;
}

function effectiveFootprintThickness(points: Point2[]): number {
  const perimeter = ringPerimeter(points);
  return perimeter > 1e-6 ? (2 * Math.abs(signedRingArea(points))) / perimeter : 0;
}

function minimumWindowedSpan(spec: FacadeSpec): number {
  return Math.max(
    spec.windows.widthM + 0.4,
    spec.facade.preferredBayWidthM * 0.7,
  );
}

function canFitWindowBay(span: number, spec: FacadeSpec): boolean {
  return span >= minimumWindowedSpan(spec);
}

function isWindowlessBuilding(
  building: BuildingFeature,
  ring: Point2[],
  spec: FacadeSpec,
): boolean {
  const kind = building.kind?.toLowerCase() ?? "";
  const minimumWindowHeight = spec.windows.sillHeightM + spec.windows.heightM + 0.25;
  const thinLowStructure = building.height <= 4
    && effectiveFootprintThickness(ring) < 1.25;
  return WINDOWLESS_LOD2_FUNCTIONS.has(building.lod2Function ?? "")
    || WINDOWLESS_BUILDING_KINDS.has(kind)
    || building.height < minimumWindowHeight
    || thinLowStructure;
}

function outwardOrientedEdge(current: Point2, next: Point2, ringArea: number): [Point2, Point2] {
  const dx = next[0] - current[0];
  const dz = next[1] - current[1];
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return [current, next];

  // Ring winding, unlike a centroid test, stays correct on concave outlines.
  // Positive XZ area has its exterior on the edge's right; negative area on
  // its left.
  const winding = ringArea >= 0 ? 1 : -1;
  const normalX = (dz / length) * winding;
  const normalZ = (-dx / length) * winding;

  // In the right-handed world frame, up × outward is screen-right when the
  // player faces the wall. U must increase in that direction to avoid mirrors.
  const tangentX = normalZ;
  const tangentZ = -normalX;
  return dx * tangentX + dz * tangentZ >= 0 ? [current, next] : [next, current];
}

function largestEdge(points: Point2[]): number {
  let largest = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    largest = Math.max(largest, Math.hypot(next[0] - current[0], next[1] - current[1]));
  }
  return largest;
}

function buildingDistrict(points: Point2[]): MunichDistrict {
  const center = ringCenter(points);
  const district = closestDistrict(new Vector3(center[0], 0, center[1]));
  return district === "center" ? "altstadt" : district;
}

function constructionYear(value: string | undefined): number | undefined {
  const match = value?.match(/(?:1[5-9]|20)\d{2}/)?.[0];
  return match ? Number.parseInt(match, 10) : undefined;
}

function facadeSpecFor(building: BuildingFeature, ring: Point2[]): FacadeSpec {
  const source = building.sourceRefs?.find((reference) => reference.dataset.includes("Bavarian"))
    ?? building.sourceRefs?.[0];
  const attributes: FacadeAttributes = {
    district: buildingDistrict(ring),
    constructionYear: constructionYear(building.startDate),
    levels: building.levels,
    roofLevels: building.roofLevels,
    frontageWidthM: largestEdge(ring),
    buildingUse: building.kind,
    buildingMaterial: building.wallMaterial,
    roofShape: building.roofShape,
    wallColor: building.wallColor,
    roofColor: building.roofColor,
    source: source
      ? {
          dataset: source.dataset,
          featureId: source.id,
          observedAt: source.observedAt,
          license: source.license,
        }
      : undefined,
  };
  return deriveFacadeSpec(building.id, attributes);
}

function surfaceVertexAt(surface: SurfaceMeshData, index: number): SurfaceVertex {
  const y = surface.positions[index * 3 + 1];
  const hasUvs = surface.uvs?.length === (surface.positions.length / 3) * 2;
  return {
    x: surface.positions[index * 3],
    y,
    z: surface.positions[index * 3 + 2],
    u: hasUvs ? surface.uvs![index * 2] : 0,
    v: hasUvs ? surface.uvs![index * 2 + 1] : y / 3,
  };
}

function interpolateSurfaceVertex(
  start: SurfaceVertex,
  end: SurfaceVertex,
  t: number,
): SurfaceVertex {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    z: start.z + (end.z - start.z) * t,
    u: start.u + (end.u - start.u) * t,
    v: start.v + (end.v - start.v) * t,
  };
}

function clipSurfacePolygonAtHeight(
  polygon: SurfaceVertex[],
  height: number,
  keepBelow: boolean,
): SurfaceVertex[] {
  if (polygon.length === 0) return [];
  const result: SurfaceVertex[] = [];
  const inside = (vertex: SurfaceVertex): boolean => keepBelow
    ? vertex.y <= height + 1e-5
    : vertex.y >= height - 1e-5;

  let previous = polygon[polygon.length - 1];
  let previousInside = inside(previous);
  for (const current of polygon) {
    const currentInside = inside(current);
    if (currentInside !== previousInside) {
      const delta = current.y - previous.y;
      const t = Math.abs(delta) < 1e-9 ? 0 : (height - previous.y) / delta;
      result.push(interpolateSurfaceVertex(previous, current, t));
    }
    if (currentInside) result.push(current);
    previous = current;
    previousInside = currentInside;
  }
  return result;
}

function appendSurfacePolygon(
  target: Buffers,
  polygon: SurfaceVertex[],
  color: Color4,
  spec: FacadeSpec,
): void {
  if (polygon.length < 3) return;
  const uScale = 3 / spec.facade.preferredBayWidthM;
  const vScale = 3 / spec.floors.floorHeightM;

  for (let index = 1; index < polygon.length - 1; index += 1) {
    const triangle = [polygon[0], polygon[index], polygon[index + 1]];
    const ab = {
      x: triangle[1].x - triangle[0].x,
      y: triangle[1].y - triangle[0].y,
      z: triangle[1].z - triangle[0].z,
    };
    const ac = {
      x: triangle[2].x - triangle[0].x,
      y: triangle[2].y - triangle[0].y,
      z: triangle[2].z - triangle[0].z,
    };
    const crossX = ab.y * ac.z - ab.z * ac.y;
    const crossY = ab.z * ac.x - ab.x * ac.z;
    const crossZ = ab.x * ac.y - ab.y * ac.x;
    if (crossX * crossX + crossY * crossY + crossZ * crossZ < 1e-10) continue;

    const vertexIndices = triangle.map((vertex) => {
      const vertexIndex = target.positions.length / 3;
      target.positions.push(vertex.x, vertex.y, vertex.z);
      target.uvs.push(vertex.u * uScale, vertex.v * vScale);
      target.colors.push(color.r, color.g, color.b, color.a);
      return vertexIndex;
    });
    target.indices.push(...vertexIndices);
  }
}

function surfaceTriangleComponents(surface: SurfaceMeshData): number[][] {
  const triangleCount = Math.floor(surface.indices.length / 3);
  const trianglesByVertex = new Map<number, number[]>();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = surface.indices[triangle * 3 + corner];
      const uses = trianglesByVertex.get(vertex);
      if (uses) uses.push(triangle);
      else trianglesByVertex.set(vertex, [triangle]);
    }
  }

  const visited = new Set<number>();
  const components: number[][] = [];
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    if (visited.has(triangle)) continue;
    const queue = [triangle];
    const component: number[] = [];
    visited.add(triangle);
    while (queue.length > 0) {
      const current = queue.pop()!;
      component.push(current);
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = surface.indices[current * 3 + corner];
        for (const neighbor of trianglesByVertex.get(vertex) ?? []) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    components.push(component);
  }
  return components;
}

function componentVertexIds(surface: SurfaceMeshData, triangles: number[]): number[] {
  const vertices = new Set<number>();
  for (const triangle of triangles) {
    vertices.add(surface.indices[triangle * 3]);
    vertices.add(surface.indices[triangle * 3 + 1]);
    vertices.add(surface.indices[triangle * 3 + 2]);
  }
  return [...vertices];
}

function componentHorizontalSpan(surface: SurfaceMeshData, vertexIds: number[]): number {
  let span = 0;
  for (let first = 0; first < vertexIds.length; first += 1) {
    const a = surfaceVertexAt(surface, vertexIds[first]);
    for (let second = first + 1; second < vertexIds.length; second += 1) {
      const b = surfaceVertexAt(surface, vertexIds[second]);
      span = Math.max(span, Math.hypot(b.x - a.x, b.z - a.z));
    }
  }
  return span;
}

function componentEaveHeight(
  surface: SurfaceMeshData,
  vertexIds: number[],
  spec: FacadeSpec,
): number | undefined {
  const heights = vertexIds.map((vertex) => surface.positions[vertex * 3 + 1]);
  const minimum = Math.min(...heights);
  const maximum = Math.max(...heights);
  const span = maximum - minimum;
  if (span < 1) return undefined;

  const upperHeights = heights.filter((height) => height >= minimum + span * 0.55);
  if (upperHeights.length < 2) return undefined;
  const eave = Math.min(...upperHeights);
  const minimumCapHeight = Math.max(0.75, spec.floors.floorHeightM * 0.24);
  return maximum - eave >= minimumCapHeight ? eave : undefined;
}

function appendLayeredWallSurface(
  upperTarget: Buffers,
  neutralTarget: Buffers,
  surface: SurfaceMeshData,
  color: Color4,
  spec: FacadeSpec,
  whollyNeutral: boolean,
): void {
  if (whollyNeutral) {
    appendSurfaceMesh(neutralTarget, surface, color, spec, true);
    return;
  }

  for (const component of surfaceTriangleComponents(surface)) {
    const vertexIds = componentVertexIds(surface, component);
    const narrow = !canFitWindowBay(componentHorizontalSpan(surface, vertexIds), spec);
    const eave = narrow ? undefined : componentEaveHeight(surface, vertexIds, spec);
    for (const triangle of component) {
      const polygon = [0, 1, 2].map((corner) => surfaceVertexAt(
        surface,
        surface.indices[triangle * 3 + corner],
      ));
      if (narrow) {
        appendSurfacePolygon(neutralTarget, polygon, color, spec);
      } else if (eave === undefined) {
        appendSurfacePolygon(upperTarget, polygon, color, spec);
      } else {
        appendSurfacePolygon(
          upperTarget,
          clipSurfacePolygonAtHeight(polygon, eave, true),
          color,
          spec,
        );
        appendSurfacePolygon(
          neutralTarget,
          clipSurfacePolygonAtHeight(polygon, eave, false),
          color,
          spec,
        );
      }
    }
  }
}

function appendSurfaceMesh(
  target: Buffers,
  surface: SurfaceMeshData,
  color: Color4,
  spec: FacadeSpec,
  rescaleFacadeUvs: boolean,
): void {
  if (surface.positions.length === 0 || surface.indices.length === 0) return;
  const vertexOffset = target.positions.length / 3;
  const vertexCount = surface.positions.length / 3;
  target.positions.push(...surface.positions);
  target.indices.push(...surface.indices.map((index) => index + vertexOffset));
  if (surface.uvs?.length === vertexCount * 2) {
    const uScale = rescaleFacadeUvs ? 3 / spec.facade.preferredBayWidthM : 1;
    const vScale = rescaleFacadeUvs ? 3 / spec.floors.floorHeightM : 1;
    for (let index = 0; index < surface.uvs.length; index += 2) {
      target.uvs.push(surface.uvs[index] * uScale, surface.uvs[index + 1] * vScale);
    }
  } else {
    target.uvs.push(...new Array(vertexCount * 2).fill(0));
  }
  for (let index = 0; index < vertexCount; index += 1) {
    target.colors.push(color.r, color.g, color.b, color.a);
  }
}

function appendRoofSurfaceMesh(
  target: Buffers,
  surface: SurfaceMeshData,
  color: Color4,
): void {
  if (surface.positions.length === 0 || surface.indices.length === 0) return;
  const vertexOffset = target.positions.length / 3;
  const vertexCount = surface.positions.length / 3;
  target.positions.push(...surface.positions);
  target.indices.push(...surface.indices.map((index) => index + vertexOffset));
  // LoD2 source UVs are in the source coordinate reference system rather than
  // a metre-based surface mapping. Projecting them in world X/Z keeps the tile
  // scale consistent for both surveyed geometry and footprint extrusions.
  for (let index = 0; index < surface.positions.length; index += 3) {
    target.uvs.push(
      surface.positions[index] / ROOF_REPEAT_METERS,
      surface.positions[index + 2] / ROOF_REPEAT_METERS,
    );
  }
  for (let index = 0; index < vertexCount; index += 1) {
    target.colors.push(color.r, color.g, color.b, color.a);
  }
}

function usesRoofTileTexture(building: BuildingFeature): boolean {
  return building.roofColor?.trim().toLowerCase() === "red";
}

function addBuilding(
  walls: Buffers,
  neutralWalls: Buffers,
  roofs: Buffers,
  tiledRoofs: Buffers,
  building: BuildingFeature,
  spec: FacadeSpec,
  customFacade?: BuildingFacadeBuffers,
  whollyNeutral = false,
): void {
  const ring = cleanRing(building.outline);
  if (ring.length < 3) return;
  const holes = (building.holes ?? []).map(cleanRing).filter((hole) => hole.length >= 3);

  const wallColor = facadeTint(spec.colors.wall);
  const tiledRoof = usesRoofTileTexture(building);
  const roofTarget = tiledRoof ? tiledRoofs : roofs;
  const roof = tiledRoof ? new Color4(1, 1, 1, 1) : facadeColor(spec.colors.roof);

  if (building.geometry && !customFacade) {
    appendLayeredWallSurface(
      walls,
      neutralWalls,
      building.geometry.walls,
      wallColor,
      spec,
      whollyNeutral,
    );
    appendRoofSurfaceMesh(roofTarget, building.geometry.roofs, roof);
    return;
  }

  const roofStart = roofTarget.positions.length / 3;
  const roofRings = [ring, ...holes];
  const roofPoints = roofRings.flat();
  const holeIndices: number[] = [];
  let roofVertexOffset = ring.length;
  for (let index = 1; index < roofRings.length; index += 1) {
    holeIndices.push(roofVertexOffset);
    roofVertexOffset += roofRings[index].length;
  }

  for (const point of roofPoints) {
    const uv: Point2 = [point[0] / ROOF_REPEAT_METERS, point[1] / ROOF_REPEAT_METERS];
    pushVertex(roofTarget, point, building.height, roof, uv);
  }

  const triangles = earcut(roofPoints.flatMap(([x, z]) => [x, z]), holeIndices, 2);
  for (let index = 0; index < triangles.length; index += 3) {
    const first = triangles[index];
    const second = triangles[index + 1];
    const third = triangles[index + 2];
    const [ax, az] = roofPoints[first];
    const [bx, bz] = roofPoints[second];
    const [cx, cz] = roofPoints[third];
    const normalY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    roofTarget.indices.push(
      roofStart + first,
      roofStart + (normalY >= 0 ? second : third),
      roofStart + (normalY >= 0 ? third : second),
    );
  }

  for (let ringIndex = 0; ringIndex < roofRings.length; ringIndex += 1) {
    const wallRing = roofRings[ringIndex];
    // A courtyard wall faces into the void, which is the inverse of the
    // ordinary outer-ring direction.
    const wallArea = signedRingArea(wallRing) * (ringIndex === 0 ? 1 : -1);
    for (let index = 0; index < wallRing.length; index += 1) {
      const current = wallRing[index];
      const next = wallRing[(index + 1) % wallRing.length];
      const [start, end] = outwardOrientedEdge(current, next, wallArea);
      const edgeLength = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (edgeLength < 1e-6) continue;
      const horizontalRepeat = Math.max(0.25, edgeLength / spec.facade.preferredBayWidthM);
      const verticalRepeat = Math.max(1, building.height / spec.floors.floorHeightM);
      const isCustomFront = ringIndex === 0 && customFacade?.definition.frontEdgeIndex === index;
      const wallTarget = customFacade
        ? (isCustomFront ? customFacade.front : customFacade.sides)
        : whollyNeutral || !canFitWindowBay(edgeLength, spec)
          ? neutralWalls
          : walls;
      const edgeColor = customFacade ? new Color4(1, 1, 1, 1) : wallColor;
      // The reviewed No. 46 texture is applied to every exterior elevation, not
      // just the street edge. Map each wall to the complete facade artwork so a
      // side never falls back to the untextured base colour.
      const uMax = customFacade ? 1 : horizontalRepeat;
      const vMax = customFacade ? 1 : verticalRepeat;
      const a = pushVertex(wallTarget, start, 0, edgeColor, [0, 0]);
      const b = pushVertex(wallTarget, end, 0, edgeColor, [uMax, 0]);
      const c = pushVertex(wallTarget, end, building.height, edgeColor, [uMax, vMax]);
      const d = pushVertex(wallTarget, start, building.height, edgeColor, [0, vMax]);
      wallTarget.indices.push(a, b, c, a, c, d);

      if (customFacade) {
        // The custom facade artwork has transparent regions around the roofline.
        // A slightly inset opaque wall preserves the building volume there without
        // competing with the textured elevation in the depth buffer.
        const dx = next[0] - current[0];
        const dz = next[1] - current[1];
        const winding = wallArea >= 0 ? 1 : -1;
        const inset = 0.025;
        const inwardStart: Point2 = [
          start[0] - (dz / edgeLength) * winding * inset,
          start[1] + (dx / edgeLength) * winding * inset,
        ];
        const inwardEnd: Point2 = [
          end[0] - (dz / edgeLength) * winding * inset,
          end[1] + (dx / edgeLength) * winding * inset,
        ];
        const backingColor = new Color4(1, 1, 1, 1);
        const backingA = pushVertex(customFacade.backing, inwardStart, 0, backingColor, [0, 0]);
        const backingB = pushVertex(customFacade.backing, inwardEnd, 0, backingColor, [0, 0]);
        const backingC = pushVertex(customFacade.backing, inwardEnd, building.height, backingColor, [0, 0]);
        const backingD = pushVertex(customFacade.backing, inwardStart, building.height, backingColor, [0, 0]);
        customFacade.backing.indices.push(backingA, backingB, backingC, backingA, backingC, backingD);
      }
    }
  }
}

/**
 * Adds a shallow textured shell over the lower storey. Keeping it a separate
 * mesh works for both footprint extrusions and LoD2 walls while preserving the
 * address-specific custom facade path.
 */
function addGroundFacadeSkirt(
  target: Buffers,
  building: BuildingFeature,
  spec: FacadeSpec,
): void {
  const ring = cleanRing(building.outline);
  if (ring.length < 3 || building.height <= 0.8) return;

  const ringArea = signedRingArea(ring);
  const height = Math.min(building.height, Math.max(0.8, spec.floors.groundFloorHeightM));
  const color = facadeTint(spec.colors.wall);
  const outwardOffset = 0.018;

  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    const dx = next[0] - current[0];
    const dz = next[1] - current[1];
    const edgeLength = Math.hypot(dx, dz);
    if (edgeLength < 1e-6 || !canFitWindowBay(edgeLength, spec)) continue;

    const winding = ringArea >= 0 ? 1 : -1;
    const outwardX = (dz / edgeLength) * winding;
    const outwardZ = (-dx / edgeLength) * winding;
    const [orientedStart, orientedEnd] = outwardOrientedEdge(current, next, ringArea);
    const start: Point2 = [
      orientedStart[0] + outwardX * outwardOffset,
      orientedStart[1] + outwardZ * outwardOffset,
    ];
    const end: Point2 = [
      orientedEnd[0] + outwardX * outwardOffset,
      orientedEnd[1] + outwardZ * outwardOffset,
    ];
    const horizontalRepeat = Math.max(0.25, edgeLength / spec.facade.preferredBayWidthM);

    const a = pushVertex(target, start, 0, color, [0, 0]);
    const b = pushVertex(target, end, 0, color, [horizontalRepeat, 0]);
    const c = pushVertex(target, end, height, color, [horizontalRepeat, 1]);
    const d = pushVertex(target, start, height, color, [0, 1]);
    target.indices.push(a, b, c, a, c, d);
  }
}

function createVertexMesh(name: string, scene: Scene, target: Buffers, material: Material): Mesh | null {
  if (target.positions.length === 0) return null;

  const normals: number[] = [];
  // All runtime geometry is authored with mathematical CCW winding in the
  // X=east, Y=up, Z=south right-handed frame.
  VertexData.ComputeNormals(target.positions, target.indices, normals, {
    useRightHandedSystem: true,
  });

  const data = new VertexData();
  data.positions = target.positions;
  data.indices = target.indices;
  data.normals = normals;
  data.colors = target.colors;
  data.uvs = target.uvs;

  const mesh = new Mesh(name, scene);
  // These buffers use conventional mathematical CCW winding. Babylon's mesh
  // builders manage their own scene-dependent winding; only this manual buffer
  // path opts into CCW front faces explicitly.
  mesh.sideOrientation = Material.CounterClockWiseSideOrientation;
  data.applyToMesh(mesh, false);
  mesh.material = material;
  mesh.useVertexColors = true;
  return mesh;
}

function buildBuildings(
  tile: MunichTile,
  scene: Scene,
  roofMaterial: StandardMaterial,
  roofTileMaterial: StandardMaterial,
): Mesh[] {
  const facadeBuffers = new Map<string, FacadeMaterialBuffers>();
  const roofBuffers = buffers();
  const tiledRoofBuffers = buffers();
  const customFacades: BuildingFacadeBuffers[] = [];
  const retailBuildingIds = new Set(
    tile.businesses
      ?.map((business) => business.frontage?.buildingId)
      .filter((buildingId): buildingId is number => buildingId !== undefined)
      ?? [],
  );

  const buffersFor = (
    bundleId: FacadeTextureBundleId,
    layer: FacadeTextureLayer,
  ): Buffers => {
    const key = `${bundleId}:${layer}`;
    const existing = facadeBuffers.get(key);
    if (existing) return existing.target;
    const target = buffers();
    facadeBuffers.set(key, { bundleId, layer, target });
    return target;
  };

  for (const building of tile.buildings) {
    if (isLandmarkReplacementBuilding(building.id)) continue;
    const ring = cleanRing(building.outline);
    if (ring.length < 3) continue;
    const spec = facadeSpecFor(building, ring);
    const definition = getBuildingFacade(building.id);
    const customFacade = definition
      ? {
        definition,
        buildingId: building.id,
        front: buffers(),
        sides: buffers(),
        backing: buffers(),
      }
      : undefined;
    if (customFacade) {
      customFacades.push(customFacade);
      addBuilding(buffers(), buffers(), roofBuffers, tiledRoofBuffers, building, spec, customFacade);
      continue;
    }

    const derivedSelection = selectPhotorealFacadeBundle(spec.family, spec.seed);
    const selection = {
      ...derivedSelection,
      id: FACADE_BUNDLE_OVERRIDES.get(building.id) ?? derivedSelection.id,
    };
    const upper = buffersFor(selection.id, "upper");
    const neutral = buffersFor(selection.id, "neutral");
    const whollyNeutral = isWindowlessBuilding(building, ring, spec);
    addBuilding(upper, neutral, roofBuffers, tiledRoofBuffers, building, spec, undefined, whollyNeutral);
    if (!whollyNeutral) {
      const groundLayer: FacadeTextureLayer = retailBuildingIds.has(building.id)
        ? "ground-retail"
        : "ground-residential";
      addGroundFacadeSkirt(buffersFor(selection.id, groundLayer), building, spec);
    }
  }

  const roofs = createVertexMesh(`building-roofs-${tile.id}`, scene, roofBuffers, roofMaterial);
  const tiledRoofs = createVertexMesh(
    `building-red-tile-roofs-${tile.id}`,
    scene,
    tiledRoofBuffers,
    roofTileMaterial,
  );
  const result = [roofs, tiledRoofs].filter((mesh): mesh is Mesh => mesh !== null);

  for (const [key, facade] of facadeBuffers) {
    const material = getPhotorealFacadeMaterial(scene, facade.bundleId, facade.layer);
    const walls = createVertexMesh(
      `building-walls-${key}-${tile.id}`,
      scene,
      facade.target,
      material,
    );
    if (walls) result.push(walls);
  }

  for (const facade of customFacades) {
    const materials = createCustomFacadeMaterials(tile.id, scene, facade);
    const front = createVertexMesh(
      `building-facade-front-${facade.buildingId}-${tile.id}`,
      scene,
      facade.front,
      materials.front,
    );
    const sides = createVertexMesh(
      `building-facade-sides-${facade.buildingId}-${tile.id}`,
      scene,
      facade.sides,
      materials.sides,
    );
    const backing = createVertexMesh(
      `building-facade-backing-${facade.buildingId}-${tile.id}`,
      scene,
      facade.backing,
      materials.backing,
    );
    if (front) result.push(front);
    if (sides) result.push(sides);
    if (backing) result.push(backing);
  }

  for (const mesh of result) {
    mesh.checkCollisions = true;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
  }
  return result;
}

function createCustomFacadeMaterials(
  _tileId: string,
  scene: Scene,
  facade: BuildingFacadeBuffers,
): { front: PBRMaterial; sides: PBRMaterial; backing: PBRMaterial } {
  let cache = customMaterialsByScene.get(scene);
  if (!cache) {
    cache = new Map();
    customMaterialsByScene.set(scene, cache);
  }
  const cached = cache.get(facade.buildingId);
  if (cached) return cached;

  const front = new PBRMaterial(`building-facade-front-material-${facade.buildingId}`, scene);
  front.albedoColor = Color3.White();
  front.metallic = 0;
  front.roughness = 0.78;
  front.directIntensity = 0.95;
  front.environmentIntensity = 0.7;
  front.specularIntensity = 0.44;
  front.backFaceCulling = true;

  const texture = new Texture(
    publicUrl(facade.definition.textureUrl),
    scene,
    false,
    true,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 8;
  texture.hasAlpha = true;
  front.albedoTexture = texture;
  front.useAlphaFromAlbedoTexture = true;

  const [red, green, blue] = facade.definition.sideColor;
  const sides = new PBRMaterial(`building-facade-sides-material-${facade.buildingId}`, scene);
  sides.albedoColor = new Color3(red, green, blue);
  sides.metallic = 0;
  sides.roughness = 0.88;
  sides.directIntensity = 0.95;
  sides.environmentIntensity = 0.65;
  sides.specularIntensity = 0.34;
  sides.backFaceCulling = true;

  const sideTexture = new Texture(
    publicUrl(facade.definition.textureUrl),
    scene,
    false,
    true,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  sideTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
  sideTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
  sideTexture.anisotropicFilteringLevel = 8;
  sideTexture.hasAlpha = true;
  sides.albedoTexture = sideTexture;
  sides.useAlphaFromAlbedoTexture = true;

  const backing = new PBRMaterial(`building-facade-backing-material-${facade.buildingId}`, scene);
  backing.albedoColor = new Color3(red, green, blue);
  backing.metallic = 0;
  backing.roughness = 0.88;
  backing.directIntensity = 0.95;
  backing.environmentIntensity = 0.65;
  backing.specularIntensity = 0.34;
  backing.backFaceCulling = true;

  const materials = { front, sides, backing };
  cache.set(facade.buildingId, materials);
  return materials;
}

function pointKey(point: Point2): string {
  return `${point[0].toFixed(3)}:${point[1].toFixed(3)}`;
}

function pointsMatch(first: Point2, second: Point2): boolean {
  return Math.abs(first[0] - second[0]) < 1e-3
    && Math.abs(first[1] - second[1]) < 1e-3;
}

/**
 * The data pipeline deliberately stores roads as tile-local two-point pieces.
 * Rejoining pieces from one OSM way before offsetting them removes the open
 * wedges and rectangular ends that previously exposed the pale base ground at
 * every bend.
 */
function buildRoadChains(roads: RoadFeature[]): RoadChain[] {
  const groups = new Map<string, { road: RoadFeature; pieces: Array<[Point2, Point2]> }>();
  roads.forEach((road, roadIndex) => {
    const profile = [
      road.kind,
      road.width,
      road.surface,
      road.footway,
      road.footwaySurface,
      road.cyclewaySurface,
      road.cyclewayWidth,
      road.segregated,
    ].join("|");
    const key = road.sourceId ? `${road.sourceId}:${profile}` : `anonymous:${roadIndex}`;
    let group = groups.get(key);
    if (!group) {
      group = { road, pieces: [] };
      groups.set(key, group);
    }
    for (let pointIndex = 0; pointIndex < road.points.length - 1; pointIndex += 1) {
      const start = road.points[pointIndex];
      const end = road.points[pointIndex + 1];
      if (!pointsMatch(start, end)) group.pieces.push([start, end]);
    }
  });

  const chains: RoadChain[] = [];
  for (const group of groups.values()) {
    const adjacency = new Map<string, number[]>();
    group.pieces.forEach(([start, end], pieceIndex) => {
      for (const point of [start, end]) {
        const key = pointKey(point);
        const connected = adjacency.get(key);
        if (connected) connected.push(pieceIndex);
        else adjacency.set(key, [pieceIndex]);
      }
    });
    const unused = new Set(group.pieces.map((_, index) => index));

    while (unused.size > 0) {
      let seed = unused.values().next().value as number;
      for (const candidate of unused) {
        const [start, end] = group.pieces[candidate];
        if ((adjacency.get(pointKey(start))?.length ?? 0) === 1
          || (adjacency.get(pointKey(end))?.length ?? 0) === 1) {
          seed = candidate;
          break;
        }
      }

      const [seedStart, seedEnd] = group.pieces[seed];
      const startAtLooseEnd = (adjacency.get(pointKey(seedStart))?.length ?? 0) === 1;
      const chainPoints: Point2[] = startAtLooseEnd
        ? [seedStart, seedEnd]
        : [seedEnd, seedStart];
      unused.delete(seed);

      while (true) {
        const current = chainPoints[chainPoints.length - 1];
        const connected = (adjacency.get(pointKey(current)) ?? [])
          .filter((pieceIndex) => unused.has(pieceIndex));
        if (connected.length === 0) break;

        // At a repeated OSM node, keep the chain on the straightest unused
        // continuation rather than taking an arbitrary crossing branch.
        const previous = chainPoints[chainPoints.length - 2];
        const incomingLength = Math.hypot(current[0] - previous[0], current[1] - previous[1]);
        const incoming: Point2 = incomingLength > 1e-6
          ? [(current[0] - previous[0]) / incomingLength, (current[1] - previous[1]) / incomingLength]
          : [0, 0];
        let nextPiece = connected[0];
        let nextPoint = pointsMatch(group.pieces[nextPiece][0], current)
          ? group.pieces[nextPiece][1]
          : group.pieces[nextPiece][0];
        let bestAlignment = Number.NEGATIVE_INFINITY;
        for (const candidate of connected) {
          const piece = group.pieces[candidate];
          const other = pointsMatch(piece[0], current) ? piece[1] : piece[0];
          const length = Math.hypot(other[0] - current[0], other[1] - current[1]);
          const alignment = length > 1e-6
            ? incoming[0] * ((other[0] - current[0]) / length)
              + incoming[1] * ((other[1] - current[1]) / length)
            : -1;
          if (alignment > bestAlignment) {
            bestAlignment = alignment;
            nextPiece = candidate;
            nextPoint = other;
          }
        }
        chainPoints.push(nextPoint);
        unused.delete(nextPiece);
      }

      if (chainPoints.length >= 2) chains.push({ road: group.road, points: chainPoints });
    }
  }
  return chains;
}

function cumulativeDistances(points: Point2[]): number[] {
  const distances = [0];
  for (let index = 1; index < points.length; index += 1) {
    distances.push(
      distances[index - 1]
      + Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]),
    );
  }
  return distances;
}

function segmentDirection(start: Point2, end: Point2): Point2 {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const length = Math.hypot(dx, dz);
  return length > 1e-6 ? [dx / length, dz / length] : [1, 0];
}

function offsetPolyline(points: Point2[], offset: number): Point2[] {
  if (Math.abs(offset) < 1e-8) return points.map((point) => [...point] as Point2);
  const directions = points.slice(0, -1).map((point, index) => segmentDirection(point, points[index + 1]));
  const normals = directions.map(([x, z]) => [-z, x] as Point2);

  return points.map((point, index) => {
    if (index === 0) {
      return [point[0] + normals[0][0] * offset, point[1] + normals[0][1] * offset];
    }
    if (index === points.length - 1) {
      const normal = normals[normals.length - 1];
      return [point[0] + normal[0] * offset, point[1] + normal[1] * offset];
    }

    const previous = normals[index - 1];
    const next = normals[index];
    const sumX = previous[0] + next[0];
    const sumZ = previous[1] + next[1];
    const sumLength = Math.hypot(sumX, sumZ);
    if (sumLength < 1e-4) {
      return [point[0] + next[0] * offset, point[1] + next[1] * offset];
    }
    const miter: Point2 = [sumX / sumLength, sumZ / sumLength];
    const denominator = miter[0] * next[0] + miter[1] * next[1];
    let scale = Math.abs(denominator) < 1e-3 ? offset : offset / denominator;
    const limit = Math.abs(offset) * MITER_LIMIT;
    if (Math.abs(scale) > limit) scale = Math.sign(scale) * limit;
    return [point[0] + miter[0] * scale, point[1] + miter[1] * scale];
  });
}

function addRibbonBand(
  target: Buffers,
  road: RoadFeature,
  points: Point2[],
  surfaceKind: RoadSurfaceKind,
  lowOffset: number,
  highOffset: number,
  heights: number[],
  heightOffset = 0,
  exclusionCapture?: ParkingExclusionCapture,
): void {
  const color = surfaceKind === "fallback" ? fallbackRoadColor(road.kind) : roadTint(road);
  const high = offsetPolyline(points, highOffset);
  const low = offsetPolyline(points, lowOffset);
  const distances = cumulativeDistances(points);
  const width = highOffset - lowOffset;

  for (let index = 0; index < points.length - 1; index += 1) {
    const y0 = heights[index] + heightOffset;
    const y1 = heights[index + 1] + heightOffset;
    const aUv = roadSurfaceUv(high[index], surfaceKind, 0, distances[index]);
    const bUv = roadSurfaceUv(low[index], surfaceKind, width, distances[index]);
    const cUv = roadSurfaceUv(low[index + 1], surfaceKind, width, distances[index + 1]);
    const dUv = roadSurfaceUv(high[index + 1], surfaceKind, 0, distances[index + 1]);
    const a = pushVertex(target, high[index], y0, color, aUv);
    const b = pushVertex(target, low[index], y0, color, bUv);
    const c = pushVertex(target, low[index + 1], y1, color, cUv);
    const d = pushVertex(target, high[index + 1], y1, color, dUv);
    target.indices.push(a, d, c, a, c, b);
    if (exclusionCapture) {
      const segmentId = `${exclusionCapture.idPrefix}:${index}`;
      exclusionCapture.target.push(
        {
          id: `${segmentId}:0`,
          outline: [
            [...high[index]] as Point2,
            [...high[index + 1]] as Point2,
            [...low[index + 1]] as Point2,
          ],
          reason: exclusionCapture.reason,
        },
        {
          id: `${segmentId}:1`,
          outline: [
            [...high[index]] as Point2,
            [...low[index + 1]] as Point2,
            [...low[index]] as Point2,
          ],
          reason: exclusionCapture.reason,
        },
      );
    }
  }
}

function splitPolylineAtDistances(points: Point2[], markers: number[]): Point2[] {
  if (markers.length === 0) return points;
  const cumulative = cumulativeDistances(points);
  const total = cumulative[cumulative.length - 1];
  const validMarkers = [...new Set(markers)]
    .filter((marker) => marker > 1e-4 && marker < total - 1e-4)
    .sort((first, second) => first - second);
  if (validMarkers.length === 0) return points;

  const result: Point2[] = [points[0]];
  let markerIndex = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const startDistance = cumulative[index];
    const endDistance = cumulative[index + 1];
    while (markerIndex < validMarkers.length && validMarkers[markerIndex] < endDistance - 1e-5) {
      const marker = validMarkers[markerIndex];
      if (marker > startDistance + 1e-5) {
        const t = (marker - startDistance) / (endDistance - startDistance);
        result.push([
          points[index][0] + (points[index + 1][0] - points[index][0]) * t,
          points[index][1] + (points[index + 1][1] - points[index][1]) * t,
        ]);
      }
      markerIndex += 1;
    }
    result.push(points[index + 1]);
  }
  return result;
}

function sidewalkRampProfile(
  points: Point2[],
  rampAtStart: boolean,
  rampAtEnd: boolean,
): { points: Point2[]; heights: number[] } {
  const originalDistances = cumulativeDistances(points);
  const total = originalDistances[originalDistances.length - 1];
  const sharedLimit = rampAtStart && rampAtEnd ? total / 2 : total;
  const startRampLength = rampAtStart ? Math.min(SIDEWALK_RAMP_LENGTH, sharedLimit) : 0;
  const endRampLength = rampAtEnd ? Math.min(SIDEWALK_RAMP_LENGTH, sharedLimit) : 0;
  const markers: number[] = [];
  if (rampAtStart) markers.push(startRampLength);
  if (rampAtEnd) markers.push(total - endRampLength);
  const splitPoints = splitPolylineAtDistances(points, markers);
  const distances = cumulativeDistances(splitPoints);
  const heights = distances.map((distance) => {
    let height = SIDEWALK_SURFACE_Y;
    if (rampAtStart) {
      const progress = startRampLength > 1e-6 ? Math.min(1, distance / startRampLength) : 1;
      height = Math.min(height, CROSSING_SURFACE_Y + (SIDEWALK_SURFACE_Y - CROSSING_SURFACE_Y) * progress);
    }
    if (rampAtEnd) {
      const progress = endRampLength > 1e-6 ? Math.min(1, (total - distance) / endRampLength) : 1;
      height = Math.min(height, CROSSING_SURFACE_Y + (SIDEWALK_SURFACE_Y - CROSSING_SURFACE_Y) * progress);
    }
    return height;
  });
  return { points: splitPoints, heights };
}

function carriagewaySegments(chains: RoadChain[]): CarriagewaySegment[] {
  const result: CarriagewaySegment[] = [];
  for (const chain of chains) {
    if (!CARRIAGEWAY_ROAD_KINDS.has(chain.road.kind)) continue;
    for (let index = 0; index < chain.points.length - 1; index += 1) {
      result.push({
        start: chain.points[index],
        end: chain.points[index + 1],
        halfWidth: Math.max(chain.road.width, 1.2) / 2,
        surfaceY: roadSurfaceElevation(chain.road),
      });
    }
  }
  return result;
}

function pointAndTangentAtHalfLength(points: Point2[]): { point: Point2; tangent: Point2 } {
  const distances = cumulativeDistances(points);
  const target = distances[distances.length - 1] / 2;
  for (let index = 0; index < points.length - 1; index += 1) {
    if (distances[index + 1] + 1e-6 < target) continue;
    const span = distances[index + 1] - distances[index];
    const t = span > 1e-6 ? (target - distances[index]) / span : 0;
    return {
      point: [
        points[index][0] + (points[index + 1][0] - points[index][0]) * t,
        points[index][1] + (points[index + 1][1] - points[index][1]) * t,
      ],
      tangent: segmentDirection(points[index], points[index + 1]),
    };
  }
  return {
    point: points[0],
    tangent: segmentDirection(points[0], points[1]),
  };
}

function nearestParallelCarriageway(
  points: Point2[],
  segments: CarriagewaySegment[],
): ParallelCarriagewayMatch | null {
  const sample = pointAndTangentAtHalfLength(points);
  const leftNormal: Point2 = [-sample.tangent[1], sample.tangent[0]];
  let best: ParallelCarriagewayMatch | null = null;

  for (const segment of segments) {
    const direction = segmentDirection(segment.start, segment.end);
    const alignment = Math.abs(sample.tangent[0] * direction[0] + sample.tangent[1] * direction[1]);
    if (alignment < PARALLEL_ALIGNMENT_THRESHOLD) continue;
    const dx = segment.end[0] - segment.start[0];
    const dz = segment.end[1] - segment.start[1];
    const lengthSquared = dx * dx + dz * dz;
    const projection = lengthSquared > 1e-8
      ? Math.max(0, Math.min(1,
        ((sample.point[0] - segment.start[0]) * dx + (sample.point[1] - segment.start[1]) * dz)
        / lengthSquared,
      ))
      : 0;
    const closest: Point2 = [
      segment.start[0] + dx * projection,
      segment.start[1] + dz * projection,
    ];
    const towardRoad: Point2 = [closest[0] - sample.point[0], closest[1] - sample.point[1]];
    const distance = Math.hypot(towardRoad[0], towardRoad[1]);
    if (distance > MAX_PARALLEL_ROAD_DISTANCE || (best && distance >= best.distance)) continue;
    const sideDot = towardRoad[0] * leftNormal[0] + towardRoad[1] * leftNormal[1];
    best = {
      curbSide: sideDot >= 0 ? 1 : -1,
      distance,
      halfWidth: segment.halfWidth,
      surfaceY: segment.surfaceY,
    };
  }
  return best;
}

function addCurb(
  topTarget: Buffers,
  faceTarget: Buffers,
  road: RoadFeature,
  points: Point2[],
  heights: number[],
  lowOffset: number,
  highOffset: number,
  match: ParallelCarriagewayMatch,
): void {
  const side = match.curbSide;
  const curbLow = side === 1 ? Math.max(lowOffset, highOffset - CURB_WIDTH) : lowOffset;
  const curbHigh = side === 1 ? highOffset : Math.min(highOffset, lowOffset + CURB_WIDTH);
  const curbRise = heights.map((height) => {
    const rampProgress = Math.max(0, Math.min(1,
      (height - CROSSING_SURFACE_Y) / (SIDEWALK_SURFACE_Y - CROSSING_SURFACE_Y),
    ));
    return CURB_TOP_RISE * rampProgress;
  });

  // A narrow light granite band breaks the broad paver field at the street
  // edge, matching the curb stones used throughout Munich.
  const raisedHeights = heights.map((height, index) => height + curbRise[index]);
  addRibbonBand(
    topTarget,
    road,
    points,
    "sidewalk",
    curbLow,
    curbHigh,
    raisedHeights,
  );

  const streetOffset = side === 1 ? highOffset : lowOffset;
  const boundary = offsetPolyline(points, streetOffset);
  const bottomY = match.surfaceY + 0.002;
  const color = new Color4(1, 1, 1, 1);
  for (let index = 0; index < boundary.length - 1; index += 1) {
    const top0 = Math.max(bottomY, heights[index] + curbRise[index]);
    const top1 = Math.max(bottomY, heights[index + 1] + curbRise[index + 1]);
    if (top0 - bottomY < 1e-4 && top1 - bottomY < 1e-4) continue;
    const a = pushVertex(faceTarget, boundary[index], bottomY, color);
    const b = pushVertex(faceTarget, boundary[index + 1], bottomY, color);
    const c = pushVertex(faceTarget, boundary[index + 1], top1, color);
    const d = pushVertex(faceTarget, boundary[index], top0, color);
    if (side === 1) faceTarget.indices.push(a, b, c, a, c, d);
    else faceTarget.indices.push(a, c, b, a, d, c);
  }
}

function buildRoads(
  tile: MunichTile,
  scene: Scene,
  materials: SharedMaterials,
): BuiltRoads {
  const targets: Record<RoadSurfaceKind, Buffers> = {
    asphalt: buffers(),
    cobblestone: buffers(),
    compacted: buffers(),
    fallback: buffers(),
    grass: buffers(),
    sidewalk: buffers(),
  };
  const curbTop = buffers();
  const curbFace = buffers();
  const parkingExclusions: ParkingSurfaceExclusion[] = [];
  const chains = buildRoadChains(tile.roads);
  const carriageways = carriagewaySegments(chains);
  const crossingEndpoints = new Set<string>();
  for (const chain of chains) {
    if (!isMappedCrossing(chain.road)) continue;
    crossingEndpoints.add(pointKey(chain.points[0]));
    crossingEndpoints.add(pointKey(chain.points[chain.points.length - 1]));
  }

  for (let chainIndex = 0; chainIndex < chains.length; chainIndex += 1) {
    const chain = chains[chainIndex];
    const road = chain.road;
    const surfaceKind = roadSurfaceKind(road);
    if (!isMappedSidewalk(road)) {
      const halfWidth = Math.max(road.width, 1.2) / 2;
      const heights = chain.points.map(() => roadSurfaceElevation(road));
      const exclusionReason = isMappedCrossing(road)
        ? "crossing"
        : SIDEWALK_ROAD_KINDS.has(road.kind) ? "sidewalk" : undefined;
      const exclusionCapture: ParkingExclusionCapture | undefined = exclusionReason
        ? {
            target: parkingExclusions,
            idPrefix: `parking-exclusion:${tile.id}:${chainIndex}:${exclusionReason}`,
            reason: exclusionReason,
          }
        : undefined;
      addRibbonBand(
        targets[surfaceKind],
        road,
        chain.points,
        surfaceKind,
        -halfWidth,
        halfWidth,
        heights,
        0,
        exclusionCapture,
      );
      continue;
    }

    const startRamp = crossingEndpoints.has(pointKey(chain.points[0]));
    const endRamp = crossingEndpoints.has(pointKey(chain.points[chain.points.length - 1]));
    const profile = sidewalkRampProfile(chain.points, startRamp, endRamp);
    const nativeHalfWidth = Math.max(road.width, 1.2) / 2;
    const awayReach = Math.max(nativeHalfWidth, SIDEWALK_OUTER_REACH);
    const match = nearestParallelCarriageway(profile.points, carriageways);
    const streetReach = match
      ? Math.max(
        nativeHalfWidth,
        Math.min(MAX_SIDEWALK_STREET_REACH, match.distance - match.halfWidth - 0.04),
      )
      : awayReach;
    const lowOffset = match?.curbSide === -1 ? -streetReach : -awayReach;
    const highOffset = match?.curbSide === 1 ? streetReach : awayReach;

    addRibbonBand(
      targets[surfaceKind],
      road,
      profile.points,
      surfaceKind,
      lowOffset,
      highOffset,
      profile.heights,
      0,
      {
        target: parkingExclusions,
        idPrefix: `parking-exclusion:${tile.id}:${chainIndex}:sidewalk`,
        reason: "sidewalk",
      },
    );

    // A segregated cycle band remains visually distinct instead of collapsing
    // the OSM footway and cycleway surfaces into one narrow generic path.
    if (road.segregated && road.cyclewayWidth && road.cyclewaySurface) {
      const cycleKind = classifiedSurfaceKind(road.cyclewaySurface, "asphalt");
      if (cycleKind !== surfaceKind) {
        const availableTowardStreet = match?.curbSide === -1
          ? -lowOffset - CURB_WIDTH
          : highOffset - CURB_WIDTH;
        const cycleWidth = Math.min(road.cyclewayWidth, Math.max(0, availableTowardStreet));
        if (cycleWidth >= 0.3) {
          // Munich's segregated cycle strip normally sits beside the kerb,
          // with the walking pavers continuing uninterrupted to the facade.
          // Anchor it to that edge instead of leaving an implausible paved
          // apron between the cycle strip and the street.
          const cycleLow = match?.curbSide === -1
            ? lowOffset + CURB_WIDTH
            : highOffset - CURB_WIDTH - cycleWidth;
          const cycleHigh = match?.curbSide === -1
            ? lowOffset + CURB_WIDTH + cycleWidth
            : highOffset - CURB_WIDTH;
          addRibbonBand(
            targets[cycleKind],
            road,
            profile.points,
            cycleKind,
            cycleLow,
            cycleHigh,
            profile.heights,
            0.003,
          );
        }
      }
    }

    if (match) {
      addCurb(
        curbTop,
        curbFace,
        road,
        profile.points,
        profile.heights,
        lowOffset,
        highOffset,
        match,
      );
    }
  }

  const surfaceMeshes = (Object.keys(targets) as RoadSurfaceKind[])
    .map((surfaceKind) => createVertexMesh(
      `roads-${surfaceKind}-${tile.id}`,
      scene,
      targets[surfaceKind],
      surfaceKind === "fallback" ? materials.roadFallback : materials.surfaces[surfaceKind],
    ))
    .filter((mesh): mesh is Mesh => mesh !== null);
  const meshes = [
    ...surfaceMeshes,
    createVertexMesh(`sidewalk-curb-top-${tile.id}`, scene, curbTop, materials.curbTop),
    createVertexMesh(`sidewalk-curb-face-${tile.id}`, scene, curbFace, materials.curbFace),
  ].filter((mesh): mesh is Mesh => mesh !== null);
  for (const mesh of meshes) mesh.freezeWorldMatrix();
  return { meshes, parkingExclusions };
}

function addGreen(
  target: Buffers,
  green: GreenFeature,
  color: Color4,
  repeatMeters?: number,
): void {
  const ring = cleanRing(green.outline);
  if (ring.length < 3) return;
  const holes = (green.holes ?? []).map(cleanRing).filter((hole) => hole.length >= 3);
  const rings = [ring, ...holes];
  const points = rings.flat();
  const holeIndices: number[] = [];
  let vertexOffset = ring.length;
  for (let index = 1; index < rings.length; index += 1) {
    holeIndices.push(vertexOffset);
    vertexOffset += rings[index].length;
  }
  const start = target.positions.length / 3;
  for (const point of points) {
    const uv: Point2 | undefined = repeatMeters
      ? [point[0] / repeatMeters, point[1] / repeatMeters]
      : undefined;
    pushVertex(target, point, GREEN_SURFACE_Y, color, uv);
  }
  const triangles = earcut(points.flatMap(([x, z]) => [x, z]), holeIndices, 2);
  for (let index = 0; index < triangles.length; index += 3) {
    const first = triangles[index];
    const second = triangles[index + 1];
    const third = triangles[index + 2];
    const [ax, az] = points[first];
    const [bx, bz] = points[second];
    const [cx, cz] = points[third];
    const normalY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    target.indices.push(
      start + first,
      start + (normalY >= 0 ? second : third),
      start + (normalY >= 0 ? third : second),
    );
  }
}

function buildGreens(tile: MunichTile, scene: Scene, materials: SharedMaterials): Mesh[] {
  const grass = buffers();
  const water = buffers();
  for (const green of tile.greens) {
    if (green.kind === "water") {
      addGreen(water, green, new Color4(0.72, 0.82, 0.82, 1), WATER_REPEAT_METERS);
    } else {
      addGreen(grass, green, new Color4(1, 1, 1, 1), SURFACE_REPEAT_METERS.grass);
    }
  }

  const meshes = [
    createVertexMesh(`greens-grass-${tile.id}`, scene, grass, materials.surfaces.grass),
    createVertexMesh(`greens-water-${tile.id}`, scene, water, materials.water),
  ].filter((mesh): mesh is Mesh => mesh !== null);
  for (const mesh of meshes) mesh.freezeWorldMatrix();
  return meshes;
}

function repeatingTexture(scene: Scene, textureUrl: string): Texture {
  const texture = new Texture(
    publicUrl(textureUrl),
    scene,
    false,
    true,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 8;
  return texture;
}

function texturedSurfaceMaterial(scene: Scene, kind: TexturedSurfaceKind): StandardMaterial {
  const profile = SURFACE_MATERIAL_PROFILES[kind];
  const material = new StandardMaterial(`${kind}-surface-material`, scene);
  material.diffuseTexture = repeatingTexture(scene, profile.textureUrl);
  material.diffuseColor = profile.diffuseColor;
  material.specularColor = profile.specularColor;
  material.specularPower = 32;
  material.ambientColor = new Color3(0.62, 0.62, 0.58);
  return material;
}

function sharedMaterials(scene: Scene): SharedMaterials {
  const cached = sharedMaterialsByScene.get(scene);
  if (cached) return cached;

  const ground = new StandardMaterial("ground-material", scene);
  ground.diffuseTexture = repeatingTexture(scene, GROUND_TEXTURE_URL);
  // Unmapped urban infill still shows between surveyed ribbons. A cooler,
  // darker base prevents those residual aprons from reading as bright poured
  // concrete beside the grey Munich paving.
  ground.diffuseColor = new Color3(0.72, 0.73, 0.7);
  ground.specularColor = new Color3(0.035, 0.035, 0.03);
  ground.specularPower = 24;
  ground.ambientColor = new Color3(0.52, 0.53, 0.5);

  const curbTop = new StandardMaterial("sidewalk-curb-top-material", scene);
  curbTop.diffuseColor = new Color3(0.54, 0.61, 0.72);
  curbTop.specularColor = new Color3(0.035, 0.035, 0.032);
  curbTop.specularPower = 24;
  curbTop.ambientColor = new Color3(0.56, 0.56, 0.53);
  curbTop.backFaceCulling = false;
  curbTop.freeze();

  const curbFace = new StandardMaterial("sidewalk-curb-face-material", scene);
  curbFace.diffuseColor = new Color3(0.38, 0.43, 0.5);
  curbFace.specularColor = new Color3(0.025, 0.025, 0.023);
  curbFace.specularPower = 18;
  curbFace.ambientColor = new Color3(0.38, 0.43, 0.5);
  curbFace.backFaceCulling = false;
  curbFace.freeze();

  const roadFallback = new StandardMaterial("road-fallback-material", scene);
  roadFallback.diffuseColor = Color3.White();
  roadFallback.specularColor = new Color3(0.045, 0.045, 0.04);
  roadFallback.ambientColor = new Color3(0.62, 0.62, 0.58);
  roadFallback.backFaceCulling = false;
  roadFallback.freeze();

  const roofs = new StandardMaterial("building-roof-material", scene);
  roofs.diffuseColor = Color3.White();
  roofs.diffuseTexture = repeatingTexture(scene, FLAT_ROOF_TEXTURE_URL);
  roofs.specularColor = new Color3(0.04, 0.04, 0.035);
  roofs.ambientColor = new Color3(0.58, 0.58, 0.55);
  roofs.backFaceCulling = false;
  roofs.freeze();

  const roofTiles = new StandardMaterial("building-red-roof-tile-material", scene);
  roofTiles.diffuseColor = Color3.White();
  roofTiles.diffuseTexture = repeatingTexture(scene, ROOF_TEXTURE_URL);
  roofTiles.specularColor = new Color3(0.04, 0.04, 0.035);
  roofTiles.ambientColor = new Color3(0.58, 0.58, 0.55);
  roofTiles.backFaceCulling = false;

  const surfaces: Record<TexturedSurfaceKind, StandardMaterial> = {
    asphalt: texturedSurfaceMaterial(scene, "asphalt"),
    cobblestone: texturedSurfaceMaterial(scene, "cobblestone"),
    compacted: texturedSurfaceMaterial(scene, "compacted"),
    grass: texturedSurfaceMaterial(scene, "grass"),
    sidewalk: texturedSurfaceMaterial(scene, "sidewalk"),
  };

  const water = new StandardMaterial("water-surface-material", scene);
  water.diffuseColor = Color3.White();
  water.diffuseTexture = repeatingTexture(scene, WATER_TEXTURE_URL);
  water.specularColor = new Color3(0.12, 0.16, 0.16);
  water.specularPower = 48;
  water.ambientColor = new Color3(0.48, 0.55, 0.54);
  water.freeze();

  const materials = { curbFace, curbTop, ground, roadFallback, roofs, roofTiles, surfaces, water };
  sharedMaterialsByScene.set(scene, materials);
  return materials;
}

export function buildTileMeshSet(
  tile: MunichTile,
  tileSize: number,
  scene: Scene,
): TileMeshSet {
  const materials = sharedMaterials(scene);

  const ground = MeshBuilder.CreateGround(
    `ground-${tile.id}`,
    { width: tileSize + 2, height: tileSize + 2, subdivisions: 1 },
    scene,
  );
  ground.position.set(tile.center[0], 0, tile.center[1]);
  applyWorldGroundUvs(ground, tile.center);
  ground.material = materials.ground;
  ground.checkCollisions = true;
  ground.freezeWorldMatrix();

  const greens = buildGreens(tile, scene, materials);
  const roads = buildRoads(tile, scene, materials);
  const parkingLayout = deriveParkingLayout(tile, { exclusions: roads.parkingExclusions });
  const parkingSurfaces = buildParkingSurfaceMeshes(
    tile.id,
    parkingLayout,
    scene,
    materials.surfaces.asphalt,
    materials.curbTop,
    SURFACE_REPEAT_METERS.asphalt,
  );
  const streetSurfaceDetails = buildStreetSurfaceDetails(tile, scene, {
    includeMunicipalParkingBands: false,
    includeParkingBands: false,
    inferStopLines: true,
    includeWornCenterMarkings: true,
    includeAsphaltPatches: false,
  });
  const curbsideDetails = buildCurbsideDetailMeshes(tile, scene);
  const buildings = buildBuildings(tile, scene, materials.roofs, materials.roofTiles);
  const landmarkFilteredBusinesses = tile.businesses?.filter(
    (business) => !isLandmarkReplacementBuilding(business.frontage?.buildingId ?? Number.NaN),
  );
  const storefronts = buildStorefronts(
    landmarkFilteredBusinesses,
    tile.buildings,
    scene,
  );
  const streetFurniture = buildStreetFurniture(
    tile.id,
    tile.streetLamps,
    tile.benches,
    tile.roads,
    scene,
  );
  const meshes: Array<Mesh | null> = [
    ground,
    ...greens,
    ...roads.meshes,
    ...parkingSurfaces,
    ...streetSurfaceDetails.meshes,
    ...curbsideDetails,
    ...buildings,
    ...storefronts,
    ...streetFurniture,
  ];
  return {
    meshes: meshes.filter((mesh): mesh is Mesh => mesh !== null),
    buildingShadowCasters: buildings,
    detailMeshes: storefronts,
    parkingLayout,
    // Water, glass, signs, and small facade fittings remain outside the
    // receiver set. This confines shadow shader work to the large surfaces
    // where it materially improves grounding and depth.
    shadowReceivers: [
      ground,
      ...roads.meshes,
      ...parkingSurfaces,
      ...greens.filter((mesh) => mesh.name.startsWith("greens-grass-")),
      ...buildings,
    ],
  };
}

/** Compatibility helper for tests and callers that only need the flat mesh list. */
export function buildTileMeshes(tile: MunichTile, tileSize: number, scene: Scene): Mesh[] {
  return buildTileMeshSet(tile, tileSize, scene).meshes;
}
