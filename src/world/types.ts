export type Point2 = [number, number];

export interface SurfaceMeshData {
  positions: number[];
  indices: number[];
  uvs?: number[];
}

export interface BuildingSurfaceGeometry {
  walls: SurfaceMeshData;
  roofs: SurfaceMeshData;
}

/** Tile-level reference to compact semantic LoD2 geometry keyed by building id. */
export interface Lod2GeometrySidecar {
  format: "munich3d-lod2-geometry";
  version: 1;
  file: string;
  byteLength: number;
  buildingCount: number;
}

export interface SourceReference {
  dataset: string;
  id: string;
  license: string;
  observedAt?: string;
}

export interface OsmMultipolygonPart {
  relationId: number;
  outerOrdinal: number;
  outerCount: number;
}

export interface BuildingHeightInference {
  method: "building-kind-prior" | "central-munich-study-area-prior";
  basis: string;
}

export interface BuildingFeature {
  id: number;
  outline: Point2[];
  /** Courtyard/open-space rings belonging to an OSM multipolygon outline. */
  holes?: Point2[][];
  height: number;
  heightSource?: "osm:height" | "osm:building-levels"
    | "inferred:building-kind-prior" | "inferred:central-munich-study-area-prior";
  heightInference?: BuildingHeightInference;
  groundElevation?: number;
  roofElevation?: number;
  source?: "osm" | "bavaria-lod2";
  sourceId?: string;
  sourceRefs?: SourceReference[];
  kind?: string;
  levels?: number;
  roofLevels?: number;
  roofShape?: string;
  lod2RoofType?: string;
  /** Official AdV LoD2 function code, retained for semantic rendering rules. */
  lod2Function?: string;
  wallMaterial?: string;
  wallColor?: string;
  roofMaterial?: string;
  roofColor?: string;
  startDate?: string;
  heritage?: boolean;
  address?: string;
  name?: string;
  multipolygon?: OsmMultipolygonPart;
  geometry?: BuildingSurfaceGeometry;
}

export interface RoadFeature {
  points: Point2[];
  width: number;
  kind: string;
  sourceId?: string;
  sourceRefs?: SourceReference[];
  name?: string;
  ref?: string;
  surface?: string;
  sidewalk?: string;
  footway?: string;
  /** OSM crossing control, for example traffic_signals or unmarked. */
  crossing?: string;
  /** OSM crossing:markings treatment; "no" must suppress generated paint. */
  crossingMarkings?: string;
  /** Legacy crossing_ref value retained for older mapped zebra crossings. */
  crossingRef?: string;
  footwaySurface?: string;
  cyclewaySurface?: string;
  cyclewayWidth?: number;
  segregated?: boolean;
  kerb?: string;
  kerbLeft?: string;
  kerbRight?: string;
  lanes?: number;
  lanesForward?: number;
  lanesBackward?: number;
  /** OSM lane_markings value; "no" must suppress generated centre lines. */
  laneMarkings?: string;
  oneway?: -1 | 0 | 1;
  maxSpeedKph?: number;
  maxSpeedForwardKph?: number;
  maxSpeedBackwardKph?: number;
  maxSpeedRaw?: string;
  access?: string;
  vehicle?: string;
  motorVehicle?: string;
  motorcar?: string;
  service?: string;
  trafficSign?: string;
  parking?: RoadParking;
  lit?: boolean;
}

export interface RoadParkingSide {
  position?: string;
  orientation?: string;
  restriction?: string;
  condition?: string;
}

export interface RoadParking {
  left?: RoadParkingSide;
  right?: RoadParkingSide;
  both?: RoadParkingSide;
}

/** A mapped, electrified street-running rail alignment from OpenStreetMap. */
export interface TramTrackFeature {
  id: string;
  points: Point2[];
  kind: "tram" | "light_rail";
  name?: string;
  ref?: string;
  service?: string;
  oneway?: -1 | 0 | 1;
  sourceRefs: SourceReference[];
}

export interface GreenFeature {
  id?: string;
  sourceId?: string;
  sourceRefs?: SourceReference[];
  outline: Point2[];
  /** Interior rings that must remain open when triangulating the surface. */
  holes?: Point2[][];
  kind: string;
  subtype?: string;
  multipolygon?: OsmMultipolygonPart;
}

export interface TreeFeature {
  id: number;
  point: Point2;
  height: number;
  crownDiameter?: number;
  species?: string;
  genus?: string;
  leafType?: string;
  leafCycle?: string;
  denotation?: string;
  source?: "osm" | "bavaria-single-tree";
  placement?: "mapped-point" | "inferred-tree-row" | "inferred-street-corridor";
  sourceRefs?: SourceReference[];
}

export interface StreetLampFeature {
  id: number;
  point: Point2;
  height?: number;
  lampType?: string;
  mount?: string;
  lightColor?: string;
  sourceRefs: SourceReference[];
}

export interface BenchFeature {
  id: number;
  point: Point2;
  direction?: number;
  seats?: number;
  backrest?: boolean;
  material?: string;
  color?: string;
  sourceRefs: SourceReference[];
}

export interface ParkingFeature {
  id: string;
  kind: "parking" | "parking_space";
  point: Point2;
  outline?: Point2[];
  parking?: string;
  access?: string;
  capacity?: number;
  fee?: boolean;
  surface?: string;
  sourceRefs: SourceReference[];
}

/**
 * A curb-side parking run from Munich's municipal Parkseiten layer.
 *
 * The source records a line and an aggregate capacity, not surveyed bay
 * polygons, paving material or width. Runtime cobblestone bands are therefore
 * an unmarked visualization aid and must remain distinguishable from source
 * geometry.
 */
export interface ParkingRowFeature {
  id: string;
  sourceId: string;
  tileId: string;
  points: Point2[];
  /** Capacity allocated to this tile-clipped piece. */
  capacity: number;
  /** Aggregate `angebot` value on the original municipal feature. */
  sourceCapacity: number;
  /** Distance from the original line start to this clipped piece. */
  sourceStartMeters: number;
  /** Total length of the original municipal line. */
  sourceLengthMeters: number;
  street?: string;
  regulation: {
    id?: number;
    name?: string;
    description?: string;
    group?: string;
    classification?: string;
    area?: string;
  };
  sourceRefs: SourceReference[];
}

export type BusinessCategory =
  | "restaurant"
  | "cafe"
  | "bar"
  | "bakery"
  | "grocery"
  | "pharmacy"
  | "retail"
  | "service";

export interface BusinessFrontage {
  buildingId: number;
  anchor: Point2;
  tangent: Point2;
  outward: Point2;
  width: number;
}

export interface BusinessFeature {
  id: string;
  point: Point2;
  name: string;
  category: BusinessCategory;
  subtype?: string;
  brand?: string;
  address?: string;
  cuisine?: string;
  openingHours?: string;
  checkDate?: string;
  frontage?: BusinessFrontage;
  sourceRefs: SourceReference[];
}

export interface MunichTile {
  id: string;
  center: Point2;
  buildings: BuildingFeature[];
  lod2Geometry?: Lod2GeometrySidecar;
  roads: RoadFeature[];
  tramTracks?: TramTrackFeature[];
  greens: GreenFeature[];
  trees?: TreeFeature[];
  streetLamps?: StreetLampFeature[];
  benches?: BenchFeature[];
  parking?: ParkingFeature[];
  parkingRows?: ParkingRowFeature[];
  businesses?: BusinessFeature[];
}

export interface TileManifestEntry {
  id: string;
  center: Point2;
  file: string;
  buildings: number;
  businesses?: number;
  trees?: number;
  streetLamps?: number;
  benches?: number;
  parking?: number;
  parkingRows?: number;
}

export interface MunichManifest {
  generatedAt: string;
  source: string;
  attribution: string;
  sources?: SourceReference[];
  authoritativeCoverage?: { west: number; south: number; east: number; north: number } | null;
  origin: { lat: number; lon: number };
  tileSize: number;
  bounds: { south: number; west: number; north: number; east: number };
  treePlacements?: {
    mappedPoints: number;
    sourceRows: number;
    inferredFromRows: number;
    skippedNearMappedPoint: number;
    skippedDuplicateRow: number;
    skippedOutsideBounds: number;
    defaultSpacingMeters: number;
  };
  parkingRowStats?: {
    features: number;
    sourceRows: number;
    tileRows: number;
    sourceCapacity: number;
    allocatedCapacity: number;
    skipped: number;
    skippedByReason: Record<string, number>;
    outsideTileRows: number;
    runtimeTileRows: number;
    runtimeAllocatedCapacity: number;
    responseTimestamp?: string;
  };
  tiles: TileManifestEntry[];
}
