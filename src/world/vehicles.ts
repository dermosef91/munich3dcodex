import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import type { Engine } from "@babylonjs/core/Engines/engine";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Ray } from "@babylonjs/core/Culling/ray";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type {
  MunichTile,
  Point2,
  RoadFeature,
} from "./types";
import type { GroundShadowSystem } from "./GroundShadowSystem";
import type { SunShadowController } from "./SunShadowController";
import {
  deriveParkingLayout,
  parkingLayoutContainsPoint,
  type ParkingLayout,
  type ParkingLayoutSlot,
} from "./parkingLayout";
import { VehicleAudio } from "./VehicleAudio";

const MODEL_NAMES = [
  "armor",
  "coupe",
  "fenyr",
  "ghini",
  "italia",
  "jeep",
  "kamaro",
  "lamb",
  "mobil",
  "rally",
  "van",
] as const;
// The supplied collection also contains several overt supercars. Keep those
// available in the asset library, but favour everyday vehicle silhouettes for
// normal Munich parking and traffic.
const STREET_MODEL_NAMES = ["armor", "coupe", "jeep", "mobil", "rally", "van"] as const;
// Jeeps previously made up one of six equally likely street models (about
// 16.7%). Keep them visible, but cap their share at 5%: a 70% reduction,
// with the remaining selections distributed across the other street cars.
const JEEP_STREET_SHARE = 0.05;
const MUTED_PAINT_OVERRIDES: Partial<Record<ModelName, Color3>> = {
  // The supplied coupe and rally atlases carry the most attention-grabbing
  // blue and red body colours. Keep their silhouettes but give them the
  // subdued, slightly dusty paint that is more typical of parked street cars.
  coupe: new Color3(0.17, 0.25, 0.31),
  rally: new Color3(0.35, 0.16, 0.1),
};
const VEHICLE_ASSET_ROOT = `${import.meta.env.BASE_URL}assets/vehicles/`;
const PLAYER_MAX_FORWARD_SPEED_MPS = 120 / 3.6;
const PLAYER_MAX_REVERSE_SPEED_MPS = 5;
const PLAYER_VEHICLE_CLEARANCE_METERS = 2.35;
const PLAYER_STEERING_RESPONSE = 4.6;
const PLAYER_STEERING_RETURN = 6.8;
const PLAYER_LOW_SPEED_YAW_RATE = 1.35;
const PLAYER_HIGH_SPEED_YAW_RATE = 0.34;
const PLAYER_BASE_GRIP = 8.5;
const PLAYER_HIGH_SPEED_GRIP = 5.4;
const PLAYER_HANDBRAKE_GRIP = 1.25;
const PLAYER_CAMERA_BASE_LOOK_AHEAD = 5.8;
const PLAYER_CAMERA_SPEED_LOOK_AHEAD = 0.07;
const PLAYER_CAMERA_BASE_CORNER_LOOK = 0.45;
const PLAYER_CAMERA_SPEED_CORNER_LOOK = 0.9;
const PLAYER_CAMERA_BASE_DISTANCE = 7.4;
const PLAYER_CAMERA_SPEED_DISTANCE = 0.55;
const PLAYER_CAMERA_BASE_HEIGHT = 3.2;
const PLAYER_CAMERA_SPEED_HEIGHT = 0.22;
const PLAYER_CAMERA_LATERAL_SHIFT = 0.12;
const PLAYER_CAMERA_MAX_FOV_INCREASE = 0.055;
const MAPPED_PARKED_CAR_BUDGET = 8;
const CURBSIDE_PARKED_CAR_BUDGET = 5;
// Keep a modest visible buffer between neighbouring parking slots without
// making normal curbside parking appear unusually sparse.
const PARKED_CAR_CLEARANCE_METERS = 4.8;

type ModelName = (typeof MODEL_NAMES)[number];
type VehicleKind = "parked" | "stopped" | "traffic" | "player";

// The source GLBs use inconsistent dimensions: at their authored scale the
// collection spans roughly 2.0-2.5 m wide and 4.0-5.3 m long. Calibrate each
// silhouette into the range of real European street cars while preserving the
// model proportions and the world's one-unit-per-metre scale.
const MODEL_VISUAL_SCALE: Record<ModelName, number> = {
  armor: 0.88,
  coupe: 0.84,
  fenyr: 0.88,
  ghini: 0.92,
  italia: 0.8,
  jeep: 0.92,
  kamaro: 0.92,
  lamb: 0.92,
  mobil: 0.87,
  rally: 0.95,
  van: 0.94,
};

const MODEL_GROUND_LIFT: Record<ModelName, number> = {
  armor: 0.01,
  coupe: 0.01,
  fenyr: 0.01,
  ghini: 0.01,
  italia: 0.01,
  jeep: 0.01,
  kamaro: 0.01,
  lamb: 0.01,
  mobil: 0.01,
  rally: 0.01,
  van: 0.01,
};

const MODEL_SHADOW_SIZE: Record<ModelName, { width: number; length: number }> = {
  armor: { width: 2.2, length: 4.9 },
  coupe: { width: 1.95, length: 4.45 },
  fenyr: { width: 2.0, length: 4.65 },
  ghini: { width: 2.0, length: 4.55 },
  italia: { width: 1.98, length: 4.55 },
  jeep: { width: 2.18, length: 4.85 },
  kamaro: { width: 2.02, length: 4.75 },
  lamb: { width: 2.0, length: 4.6 },
  mobil: { width: 2.05, length: 4.7 },
  rally: { width: 2.0, length: 4.55 },
  van: { width: 2.22, length: 5.15 },
};

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

const DRIVE_CODES = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowLeft",
  "ArrowDown",
  "ArrowRight",
  "Space",
]);

interface VehicleSystemOptions {
  hintElement: HTMLElement;
  drivingHudElement: HTMLElement;
  speedElement: HTMLElement;
  feedbackElement: HTMLElement;
  setWalkingEnabled: (enabled: boolean) => void;
  setDrivingEnabled: (enabled: boolean) => void;
  groundShadows?: GroundShadowSystem;
  sunShadows?: Pick<SunShadowController, "registerDynamicCasters" | "unregisterDynamicCasters">;
}

interface RoadSegment {
  tileId: string;
  key: string;
  road: RoadFeature;
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  directionX: number;
  directionZ: number;
  length: number;
  width: number;
}

interface TrafficRoute {
  tileId: string;
  key: string;
  points: Array<[number, number]>;
  cumulative: number[];
  totalLength: number;
  width: number;
  oneWay: boolean;
  targetSpeed: number;
}

interface VehicleInstance {
  id: string;
  tileId: string | null;
  kind: VehicleKind;
  model: ModelName;
  anchor: TransformNode;
  visual: TransformNode;
  meshes: AbstractMesh[];
  heading: number;
  speed: number;
  velocityX: number;
  velocityZ: number;
  steeringInput: number;
  yawVelocity: number;
  lateralSpeed: number;
  previousForwardSpeed: number;
  impactStrength: number;
  parkingSlotId?: string;
  route?: TrafficRoute;
  routeDistance?: number;
  travelDirection?: 1 | -1;
  cruiseSpeed?: number;
  respawnAt?: number;
}

interface RouteSample {
  x: number;
  z: number;
  tangentX: number;
  tangentZ: number;
}

function hashString(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function unitRandom(seed: string): number {
  return hashString(seed) / 0xffff_ffff;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function moveToward(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

function normalizeAngle(value: number): number {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function lerpAngle(current: number, target: number, amount: number): number {
  return current + normalizeAngle(target - current) * clamp(amount, 0, 1);
}

function normalizeVehicleMaterials(container: AssetContainer, model: ModelName): void {
  const paintOverride = MUTED_PAINT_OVERRIDES[model];
  for (const material of container.materials) {
    if (!(material instanceof PBRMaterial)) continue;

    // These GLBs were authored as glossy showroom assets. A slightly rougher,
    // lower-energy surface makes their supplied palette sit with the muted
    // asphalt and facade materials without altering the model textures.
    material.directIntensity = 0.88;
    material.environmentIntensity = 0.5;

    switch (material.name.toLowerCase()) {
      case "metallic":
        material.metallic = 0.2;
        material.roughness = 0.34;
        material.albedoColor = paintOverride?.clone() ?? new Color3(0.78, 0.76, 0.7);
        if (paintOverride) {
          material.albedoTexture = null;
          material.metallic = 0.08;
          material.roughness = 0.42;
        }
        break;
      case "texture":
        material.metallic = 0;
        material.roughness = 0.72;
        break;
      case "glass":
        // Preserve the original tinted-glass treatment, but make it darker.
        material.albedoTexture = null;
        material.albedoColor = new Color3(0.075, 0.105, 0.115);
        material.metallic = 0;
        material.roughness = 0.18;
        material.environmentIntensity = 0.62;
        break;
      case "light":
        // Daytime headlamps should remain legible without becoming white UI
        // shapes or bleaching out under ACES tone mapping.
        material.emissiveColor = new Color3(0.22, 0.18, 0.12);
        material.emissiveIntensity = 0.35;
        material.roughness = 0.32;
        break;
    }
  }
}

function roadAllowsMotorVehicles(road: RoadFeature): boolean {
  if (!DRIVABLE_KINDS.has(road.kind)) return false;
  const access = road.motorcar ?? road.motorVehicle ?? road.vehicle ?? road.access;
  return access !== "no" && access !== "private";
}

function headingFromDirection(x: number, z: number): number {
  return Math.atan2(x, z);
}

function routeSpeed(road: RoadFeature): number {
  const taggedKph = road.oneway === -1
    ? road.maxSpeedBackwardKph ?? road.maxSpeedKph
    : road.maxSpeedForwardKph ?? road.maxSpeedKph;
  if (taggedKph && taggedKph > 0) {
    const legalLimit = taggedKph / 3.6;
    return Math.min(legalLimit, Math.max(0.55, legalLimit * 0.72));
  }
  if (["motorway", "trunk", "primary"].includes(road.kind)) return 12;
  if (["secondary", "tertiary"].includes(road.kind)) return 9.5;
  if (road.kind === "living_street") return 3.5;
  if (road.kind === "service") return 4.5;
  return 7;
}

function makeRoute(
  tileId: string,
  key: string,
  road: RoadFeature,
  points: Array<[number, number]>,
): TrafficRoute | null {
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
    ));
  }
  const totalLength = cumulative.at(-1) ?? 0;
  if (totalLength < 30) return null;
  return {
    tileId,
    key,
    points,
    cumulative,
    totalLength,
    width: Math.max(road.width, 3.5),
    oneWay: road.oneway === 1 || road.oneway === -1,
    targetSpeed: routeSpeed(road),
  };
}

interface RoadPiece {
  road: RoadFeature;
  points: Array<[number, number]>;
  index: number;
}

function pointKey(point: Point2): string {
  return `${point[0].toFixed(2)}:${point[1].toFixed(2)}`;
}

function routePieces(tile: MunichTile): TrafficRoute[] {
  const groups = new Map<string, RoadPiece[]>();
  for (let index = 0; index < tile.roads.length; index += 1) {
    const road = tile.roads[index];
    if (!roadAllowsMotorVehicles(road) || road.points.length < 2) continue;
    const points = (road.oneway === -1 ? [...road.points].reverse() : [...road.points]) as Array<[number, number]>;
    const key = `${road.sourceId ?? `segment-${index}`}:${road.kind}:${road.oneway ?? 0}`;
    const group = groups.get(key) ?? [];
    group.push({ road, points, index });
    groups.set(key, group);
  }

  const routes: TrafficRoute[] = [];
  for (const [groupKey, pieces] of groups) {
    const unused = [...pieces];
    let component = 0;
    while (unused.length > 0) {
      const directed = unused[0].road.oneway === 1 || unused[0].road.oneway === -1;
      const endpointCounts = new Map<string, number>();
      const endKeys = new Set<string>();
      for (const piece of unused) {
        const startKey = pointKey(piece.points[0]);
        const endKey = pointKey(piece.points.at(-1) ?? piece.points[0]);
        endpointCounts.set(startKey, (endpointCounts.get(startKey) ?? 0) + 1);
        endpointCounts.set(endKey, (endpointCounts.get(endKey) ?? 0) + 1);
        endKeys.add(endKey);
      }
      let firstIndex = directed
        ? unused.findIndex((piece) => !endKeys.has(pointKey(piece.points[0])))
        : unused.findIndex((piece) => endpointCounts.get(pointKey(piece.points[0])) === 1
          || endpointCounts.get(pointKey(piece.points.at(-1) ?? piece.points[0])) === 1);
      if (firstIndex < 0) firstIndex = 0;
      const first = unused.splice(firstIndex, 1)[0];
      if (!directed) {
        const firstStartDegree = endpointCounts.get(pointKey(first.points[0])) ?? 0;
        const firstEndDegree = endpointCounts.get(pointKey(first.points.at(-1) ?? first.points[0])) ?? 0;
        if (firstEndDegree === 1 && firstStartDegree !== 1) first.points.reverse();
      }
      const chain = [...first.points];
      let extended = true;
      while (extended) {
        extended = false;
        const chainEnd = pointKey(chain.at(-1) ?? chain[0]);
        const nextIndex = unused.findIndex((piece) => {
          if (pointKey(piece.points[0]) === chainEnd) return true;
          return !directed && pointKey(piece.points.at(-1) ?? piece.points[0]) === chainEnd;
        });
        if (nextIndex < 0) continue;
        const next = unused.splice(nextIndex, 1)[0];
        if (pointKey(next.points.at(-1) ?? next.points[0]) === chainEnd) next.points.reverse();
        chain.push(...next.points.slice(1));
        extended = true;
      }
      const route = makeRoute(
        tile.id,
        `${tile.id}:${groupKey}:${component++}`,
        first.road,
        chain,
      );
      if (route) routes.push(route);
    }
  }
  return routes;
}

function sampleRoute(route: TrafficRoute, distance: number): RouteSample {
  const clampedDistance = clamp(distance, 0, route.totalLength);
  let segmentIndex = 0;
  while (
    segmentIndex < route.cumulative.length - 2
    && route.cumulative[segmentIndex + 1] < clampedDistance
  ) {
    segmentIndex += 1;
  }
  const start = route.points[segmentIndex];
  const end = route.points[segmentIndex + 1];
  const segmentLength = Math.max(route.cumulative[segmentIndex + 1] - route.cumulative[segmentIndex], 1e-6);
  const amount = clamp((clampedDistance - route.cumulative[segmentIndex]) / segmentLength, 0, 1);
  return {
    x: start[0] + (end[0] - start[0]) * amount,
    z: start[1] + (end[1] - start[1]) * amount,
    tangentX: (end[0] - start[0]) / segmentLength,
    tangentZ: (end[1] - start[1]) / segmentLength,
  };
}

export class VehicleSystem {
  private readonly containers = new Map<ModelName, AssetContainer>();
  private readonly tiles = new Map<string, MunichTile>();
  private readonly parkingLayoutsByTile = new Map<string, ParkingLayout>();
  private readonly tileVehicles = new Map<string, Set<VehicleInstance>>();
  private readonly roadSegmentsByTile = new Map<string, RoadSegment[]>();
  private readonly vehicles = new Set<VehicleInstance>();
  private readonly pressed = new Set<string>();
  private readonly audio = new VehicleAudio();
  private assetsReady = false;
  private interactionRequested = false;
  private controlled: VehicleInstance | null = null;
  private sequence = 0;
  private previousCameraCollision = true;
  private previousCameraFov = 0.8;
  private exitWarningUntil = 0;
  private exitWarningMessage = "";
  private impactFeedbackUntil = 0;
  private impactFeedbackMessage = "";
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(
    private readonly scene: Scene,
    private readonly camera: UniversalCamera,
    private readonly engine: Engine,
    private readonly options: VehicleSystemOptions,
  ) {
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp, { passive: false });
    window.addEventListener("blur", this.clearKeys);
    this.options.hintElement.textContent = "";
    void this.audio.initialize();
  }

  get isDriving(): boolean {
    return this.controlled !== null;
  }

  unlockAudio(): void {
    void this.audio.unlock();
  }

  async initialize(): Promise<void> {
    await import("@babylonjs/loaders/glTF");
    const results = await Promise.allSettled(MODEL_NAMES.map(async (model) => {
      const container = await LoadAssetContainerAsync(`${VEHICLE_ASSET_ROOT}${model}.glb`, this.scene);
      normalizeVehicleMaterials(container, model);
      this.containers.set(model, container);
    }));
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (result.status === "rejected") {
        console.warn(`Vehicle model ${MODEL_NAMES[index]} could not be loaded.`, result.reason);
      }
    }
    this.assetsReady = this.containers.size > 0;
    if (!this.assetsReady) {
      this.options.hintElement.textContent = "Vehicle models unavailable";
      return;
    }
    for (const tile of this.tiles.values()) this.spawnTileVehicles(tile);
  }

  addTile(tile: MunichTile, layout: ParkingLayout = deriveParkingLayout(tile)): void {
    if (this.tiles.has(tile.id)) this.removeTile(tile.id);
    this.tiles.set(tile.id, tile);
    this.parkingLayoutsByTile.set(tile.id, layout);
    this.roadSegmentsByTile.set(tile.id, this.createRoadSegments(tile));
    if (this.assetsReady) this.spawnTileVehicles(tile);
  }

  removeTile(tileId: string): void {
    this.tiles.delete(tileId);
    this.parkingLayoutsByTile.delete(tileId);
    this.roadSegmentsByTile.delete(tileId);
    const tileVehicles = this.tileVehicles.get(tileId);
    if (tileVehicles) {
      for (const vehicle of tileVehicles) {
        if (vehicle === this.controlled) {
          vehicle.tileId = null;
          continue;
        }
        this.disposeVehicle(vehicle);
      }
    }
    this.tileVehicles.delete(tileId);
  }

  update(): void {
    if (!this.assetsReady) return;
    const deltaSeconds = Math.min(this.engine.getDeltaTime() / 1_000, 0.05);
    if (this.interactionRequested) {
      this.interactionRequested = false;
      if (this.controlled) this.tryExitVehicle();
      else this.tryEnterVehicle();
    }

    for (const vehicle of this.vehicles) {
      if (vehicle.kind === "traffic") this.updateTrafficVehicle(vehicle, deltaSeconds);
    }
    if (this.controlled) this.updatePlayerVehicle(this.controlled, deltaSeconds);
    this.updateHint();
  }

  prepareForTeleport(): void {
    if (!this.controlled) return;
    this.releaseControlledVehicle(false);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.clearKeys);
    for (const vehicle of [...this.vehicles]) this.disposeVehicle(vehicle);
    for (const container of this.containers.values()) container.dispose();
    this.containers.clear();
    this.parkingLayoutsByTile.clear();
    this.audio.dispose();
    this.options.drivingHudElement.classList.remove("is-visible");
    this.options.setDrivingEnabled(false);
  }

  private createRoadSegments(tile: MunichTile): RoadSegment[] {
    const result: RoadSegment[] = [];
    for (let roadIndex = 0; roadIndex < tile.roads.length; roadIndex += 1) {
      const road = tile.roads[roadIndex];
      if (!roadAllowsMotorVehicles(road)) continue;
      for (let pointIndex = 0; pointIndex < road.points.length - 1; pointIndex += 1) {
        const start = road.points[pointIndex];
        const end = road.points[pointIndex + 1];
        const dx = end[0] - start[0];
        const dz = end[1] - start[1];
        const length = Math.hypot(dx, dz);
        if (length < 2) continue;
        result.push({
          tileId: tile.id,
          key: `${tile.id}:${road.sourceId ?? roadIndex}:${pointIndex}`,
          road,
          startX: start[0],
          startZ: start[1],
          endX: end[0],
          endZ: end[1],
          directionX: dx / length,
          directionZ: dz / length,
          length,
          width: Math.max(road.width, 3.5),
        });
      }
    }
    return result;
  }

  private spawnTileVehicles(tile: MunichTile): void {
    if (this.tileVehicles.has(tile.id)) return;
    const tileSet = new Set<VehicleInstance>();
    this.tileVehicles.set(tile.id, tileSet);
    this.spawnParkedCars(tile, tileSet);
    this.spawnTraffic(tile, tileSet);
  }

  private spawnParkedCars(tile: MunichTile, tileSet: Set<VehicleInstance>): void {
    const slots = this.parkingLayoutsByTile.get(tile.id)?.slots ?? [];
    const mappedSlots = slots.filter(
      (slot) => slot.source === "osm-parking-space" || slot.source === "osm-parking-area",
    );
    const curbsideSlots = slots.filter(
      (slot) => slot.source === "municipal-row" || slot.source === "osm-road-side",
    );
    this.spawnParkingSlots(tile.id, tileSet, mappedSlots, MAPPED_PARKED_CAR_BUDGET);
    this.spawnParkingSlots(tile.id, tileSet, curbsideSlots, CURBSIDE_PARKED_CAR_BUDGET);
  }

  private spawnParkingSlots(
    tileId: string,
    tileSet: Set<VehicleInstance>,
    slots: readonly ParkingLayoutSlot[],
    budget: number,
  ): void {
    const candidates = [...slots].sort((left, right) => {
      const leftDistance = Math.hypot(
        left.point[0] - this.camera.position.x,
        left.point[1] - this.camera.position.z,
      );
      const rightDistance = Math.hypot(
        right.point[0] - this.camera.position.x,
        right.point[1] - this.camera.position.z,
      );
      return leftDistance - rightDistance || left.id.localeCompare(right.id);
    });
    let created = 0;
    for (const slot of candidates) {
      if (created >= budget) break;
      if (this.isPositionOccupied(slot.point[0], slot.point[1], PARKED_CAR_CLEARANCE_METERS)) continue;
      let heading = headingFromDirection(slot.tangent[0], slot.tangent[1]);
      if (hashString(`parking-direction:${slot.id}`) % 2 === 1) heading += Math.PI;
      const vehicle = this.createVehicle(
        tileId,
        "parked",
        this.modelFor(`parking-slot:${slot.id}`),
        slot.point[0],
        slot.point[1],
        heading,
        slot.id,
      );
      if (!vehicle) continue;
      tileSet.add(vehicle);
      created += 1;
    }
  }

  private spawnTraffic(tile: MunichTile, tileSet: Set<VehicleInstance>): void {
    // OSM conversion emits short edge features. Reconnect edges sharing the
    // same source way into a continuous, direction-aware route before spawning.
    const routes = routePieces(tile)
      .filter((route) => hashString(`traffic:${route.key}`) % 9 === 0)
      .sort((left, right) => hashString(left.key) - hashString(right.key))
      .slice(0, 4);

    for (const route of routes) {
      const travelDirection: 1 | -1 = route.oneWay || hashString(`travel:${route.key}`) % 2 === 0 ? 1 : -1;
      const routeDistance = route.totalLength * (0.15 + unitRandom(`phase:${route.key}`) * 0.7);
      const sample = sampleRoute(route, routeDistance);
      const directionX = sample.tangentX * travelDirection;
      const directionZ = sample.tangentZ * travelDirection;
      const laneOffset = Math.min(1.75, Math.max(0.7, route.width * 0.22));
      const model = this.modelFor(`traffic:${route.key}`);
      const vehicle = this.createVehicle(
        tile.id,
        "traffic",
        model,
        sample.x - directionZ * laneOffset,
        sample.z + directionX * laneOffset,
        headingFromDirection(directionX, directionZ),
      );
      if (!vehicle) continue;
      vehicle.route = route;
      vehicle.routeDistance = routeDistance;
      vehicle.travelDirection = travelDirection;
      vehicle.speed = route.targetSpeed * (0.82 + unitRandom(`speed:${route.key}`) * 0.18);
      vehicle.cruiseSpeed = vehicle.speed;
      tileSet.add(vehicle);
    }
  }

  private modelFor(seed: string): ModelName {
    const available = STREET_MODEL_NAMES.filter((model) => this.containers.has(model));
    if (available.length === 0) {
      const fallback = MODEL_NAMES.filter((model) => this.containers.has(model));
      return fallback[hashString(seed) % fallback.length];
    }
    const nonJeepModels = available.filter((model) => model !== "jeep");
    if (available.includes("jeep") && nonJeepModels.length > 0 && unitRandom(`model:${seed}`) < JEEP_STREET_SHARE) {
      return "jeep";
    }
    return nonJeepModels[hashString(seed) % nonJeepModels.length] ?? "jeep";
  }

  private createVehicle(
    tileId: string,
    kind: VehicleKind,
    model: ModelName,
    x: number,
    z: number,
    heading: number,
    parkingSlotId?: string,
  ): VehicleInstance | null {
    const container = this.containers.get(model);
    if (!container) return null;
    const id = `vehicle-${this.sequence++}-${model}`;
    const anchor = new TransformNode(id, this.scene);
    anchor.position.set(x, 0.055, z);
    anchor.rotation.y = normalizeAngle(heading);
    anchor.metadata = { vehicle: true, vehicleId: id, parkingSlotId };

    const visual = new TransformNode(`${id}-visual`, this.scene);
    visual.parent = anchor;
    visual.position.y = MODEL_GROUND_LIFT[model];
    visual.scaling.setAll(MODEL_VISUAL_SCALE[model]);
    const entries = container.instantiateModelsToScene(
      (sourceName) => `${id}-${sourceName}`,
      false,
    );
    for (const root of entries.rootNodes) root.parent = visual;
    const meshes = visual.getChildMeshes(false);
    const vehicle: VehicleInstance = {
      id,
      tileId,
      kind,
      model,
      anchor,
      visual,
      meshes,
      heading: normalizeAngle(heading),
      speed: 0,
      velocityX: 0,
      velocityZ: 0,
      steeringInput: 0,
      yawVelocity: 0,
      lateralSpeed: 0,
      previousForwardSpeed: 0,
      impactStrength: 0,
      parkingSlotId,
    };
    const visualScale = MODEL_VISUAL_SCALE[model];
    this.options.groundShadows?.register(id, anchor, {
      width: MODEL_SHADOW_SIZE[model].width * visualScale,
      length: MODEL_SHADOW_SIZE[model].length * visualScale,
      groundY: 0.068,
    });
    this.setVehicleCollision(vehicle, kind === "parked" || kind === "stopped");
    this.options.sunShadows?.registerDynamicCasters(id, meshes);
    this.vehicles.add(vehicle);
    return vehicle;
  }

  private setVehicleCollision(vehicle: VehicleInstance, enabled: boolean): void {
    for (const mesh of vehicle.meshes) {
      mesh.isPickable = false;
      mesh.checkCollisions = enabled;
      mesh.metadata = {
        ...(mesh.metadata ?? {}),
        vehicle: true,
        vehicleId: vehicle.id,
        parkingSlotId: vehicle.parkingSlotId,
      };
    }
  }

  private setVehicleParkingSlot(vehicle: VehicleInstance, parkingSlotId: string | undefined): void {
    vehicle.parkingSlotId = parkingSlotId;
    vehicle.anchor.metadata = {
      ...(vehicle.anchor.metadata ?? {}),
      parkingSlotId,
    };
    for (const mesh of vehicle.meshes) {
      mesh.metadata = {
        ...(mesh.metadata ?? {}),
        parkingSlotId,
      };
    }
  }

  private disposeVehicle(vehicle: VehicleInstance): void {
    this.vehicles.delete(vehicle);
    if (vehicle.tileId) this.tileVehicles.get(vehicle.tileId)?.delete(vehicle);
    this.options.sunShadows?.unregisterDynamicCasters(vehicle.id);
    this.options.groundShadows?.unregister(vehicle.id);
    vehicle.anchor.dispose(false, false);
  }

  private updateTrafficVehicle(vehicle: VehicleInstance, deltaSeconds: number): void {
    const route = vehicle.route;
    if (!route || vehicle.routeDistance === undefined || !vehicle.travelDirection) return;
    const now = performance.now();
    if (vehicle.respawnAt !== undefined) {
      if (now < vehicle.respawnAt) return;
      vehicle.respawnAt = undefined;
      vehicle.anchor.setEnabled(true);
      vehicle.speed = vehicle.cruiseSpeed ?? route.targetSpeed;
    }

    const lookDistance = clamp(
      vehicle.routeDistance + vehicle.travelDirection * Math.max(4.5, Math.abs(vehicle.speed) * 0.9),
      0,
      route.totalLength,
    );
    const lookSample = sampleRoute(route, lookDistance);
    const lookDirectionX = lookSample.tangentX * vehicle.travelDirection;
    const lookDirectionZ = lookSample.tangentZ * vehicle.travelDirection;
    const laneOffset = Math.min(1.75, Math.max(0.7, route.width * 0.22));
    const lookX = lookSample.x - lookDirectionZ * laneOffset;
    const lookZ = lookSample.z + lookDirectionX * laneOffset;
    const blocked = this.wouldOverlapVehicle(vehicle, lookX, lookZ, 4.4);
    vehicle.speed = moveToward(
      vehicle.speed,
      blocked ? 0 : vehicle.cruiseSpeed ?? route.targetSpeed,
      (blocked ? 10 : 1.8) * deltaSeconds,
    );
    if (blocked && vehicle.speed < 0.05) return;

    let distance = vehicle.routeDistance + vehicle.speed * vehicle.travelDirection * deltaSeconds;
    const first = route.points[0];
    const last = route.points.at(-1) ?? first;
    const closed = Math.hypot(first[0] - last[0], first[1] - last[1]) < 1.5;
    if (closed) {
      distance %= route.totalLength;
      if (distance < 0) distance += route.totalLength;
    } else if (distance > route.totalLength) {
      if (route.oneWay) {
        vehicle.routeDistance = 0;
      } else {
        vehicle.routeDistance = route.totalLength;
        vehicle.travelDirection = -1;
      }
      vehicle.speed = 0;
      vehicle.respawnAt = now + 1_100 + unitRandom(`respawn:${vehicle.id}`) * 900;
      vehicle.anchor.setEnabled(false);
      return;
    } else if (distance < 0) {
      vehicle.routeDistance = 0;
      vehicle.travelDirection = 1;
      vehicle.speed = 0;
      vehicle.respawnAt = now + 1_100 + unitRandom(`respawn:${vehicle.id}`) * 900;
      vehicle.anchor.setEnabled(false);
      return;
    }
    distance = clamp(distance, 0, route.totalLength);
    vehicle.routeDistance = distance;
    const sample = sampleRoute(route, distance);
    const directionX = sample.tangentX * vehicle.travelDirection;
    const directionZ = sample.tangentZ * vehicle.travelDirection;
    vehicle.anchor.position.x = sample.x - directionZ * laneOffset;
    vehicle.anchor.position.z = sample.z + directionX * laneOffset;
    vehicle.anchor.position.y = 0.055;
    vehicle.heading = lerpAngle(
      vehicle.heading,
      headingFromDirection(directionX, directionZ),
      deltaSeconds * 7,
    );
    vehicle.anchor.rotation.y = vehicle.heading;
  }

  private updatePlayerVehicle(vehicle: VehicleInstance, deltaSeconds: number): void {
    const throttle = this.axis("KeyW", "ArrowUp");
    const brake = this.axis("KeyS", "ArrowDown");
    const steeringTarget = this.axis("KeyA", "ArrowLeft") - this.axis("KeyD", "ArrowRight");
    const handbrake = this.pressed.has("Space");

    const oldForwardX = Math.sin(vehicle.heading);
    const oldForwardZ = Math.cos(vehicle.heading);
    const oldRightX = Math.cos(vehicle.heading);
    const oldRightZ = -Math.sin(vehicle.heading);
    let forwardSpeed = vehicle.velocityX * oldForwardX + vehicle.velocityZ * oldForwardZ;
    const previousLateralSpeed = vehicle.velocityX * oldRightX + vehicle.velocityZ * oldRightZ;
    const forwardRatio = clamp(Math.max(0, forwardSpeed) / PLAYER_MAX_FORWARD_SPEED_MPS, 0, 1);

    if (throttle > 0) {
      if (forwardSpeed < -0.2) {
        forwardSpeed = moveToward(forwardSpeed, 0, 14 * deltaSeconds);
      } else {
        const engineAcceleration = 10.4 * (1 - 0.58 * Math.pow(forwardRatio, 0.72));
        forwardSpeed = Math.min(
          PLAYER_MAX_FORWARD_SPEED_MPS,
          forwardSpeed + engineAcceleration * deltaSeconds,
        );
      }
    } else if (brake > 0) {
      forwardSpeed = forwardSpeed > 0.2
        ? moveToward(forwardSpeed, 0, 15.5 * deltaSeconds)
        : Math.max(
            -PLAYER_MAX_REVERSE_SPEED_MPS,
            forwardSpeed - 5.2 * (1 - Math.abs(forwardSpeed) / PLAYER_MAX_REVERSE_SPEED_MPS) * deltaSeconds,
          );
    } else {
      forwardSpeed = moveToward(
        forwardSpeed,
        0,
        (0.72 + Math.abs(forwardSpeed) * 0.035) * deltaSeconds,
      );
    }
    if (handbrake) {
      forwardSpeed = moveToward(
        forwardSpeed,
        0,
        (2.4 + Math.abs(forwardSpeed) * 0.04) * deltaSeconds,
      );
    }

    // Preserve a world-space velocity vector. Rotating the car beneath that
    // vector creates readable slip; grip then pulls the velocity back toward
    // the direction the car is pointing instead of snapping it instantly.
    vehicle.velocityX = oldForwardX * forwardSpeed + oldRightX * previousLateralSpeed;
    vehicle.velocityZ = oldForwardZ * forwardSpeed + oldRightZ * previousLateralSpeed;

    const steeringResponse = steeringTarget === 0 ? PLAYER_STEERING_RETURN : PLAYER_STEERING_RESPONSE;
    vehicle.steeringInput = moveToward(
      vehicle.steeringInput,
      steeringTarget,
      steeringResponse * deltaSeconds,
    );
    const speedRatio = clamp(Math.abs(forwardSpeed) / PLAYER_MAX_FORWARD_SPEED_MPS, 0, 1);
    const maximumYawRate = PLAYER_LOW_SPEED_YAW_RATE
      + (PLAYER_HIGH_SPEED_YAW_RATE - PLAYER_LOW_SPEED_YAW_RATE) * Math.sqrt(speedRatio);
    const lowSpeedAuthority = clamp(Math.abs(forwardSpeed) / 2.4, 0, 1);
    const reverseSign = forwardSpeed >= 0 ? 1 : -1;
    const targetYawVelocity = vehicle.steeringInput
      * maximumYawRate
      * lowSpeedAuthority
      * reverseSign
      * (handbrake ? 1.16 : 1);
    vehicle.yawVelocity = moveToward(vehicle.yawVelocity, targetYawVelocity, 5.2 * deltaSeconds);
    vehicle.heading = normalizeAngle(vehicle.heading + vehicle.yawVelocity * deltaSeconds);

    const forwardX = Math.sin(vehicle.heading);
    const forwardZ = Math.cos(vehicle.heading);
    const rightX = Math.cos(vehicle.heading);
    const rightZ = -Math.sin(vehicle.heading);
    forwardSpeed = vehicle.velocityX * forwardX + vehicle.velocityZ * forwardZ;
    let lateralSpeed = vehicle.velocityX * rightX + vehicle.velocityZ * rightZ;
    const grip = handbrake
      ? PLAYER_HANDBRAKE_GRIP
      : PLAYER_BASE_GRIP + (PLAYER_HIGH_SPEED_GRIP - PLAYER_BASE_GRIP) * speedRatio;
    lateralSpeed *= Math.exp(-grip * deltaSeconds);
    vehicle.velocityX = forwardX * forwardSpeed + rightX * lateralSpeed;
    vehicle.velocityZ = forwardZ * forwardSpeed + rightZ * lateralSpeed;
    vehicle.speed = forwardSpeed;
    vehicle.lateralSpeed = lateralSpeed;

    const longitudinalAcceleration = (forwardSpeed - vehicle.previousForwardSpeed)
      / Math.max(deltaSeconds, 1 / 120);
    vehicle.previousForwardSpeed = forwardSpeed;
    const targetPitch = clamp(-longitudinalAcceleration * 0.006, -0.055, 0.055);
    const targetRoll = clamp(
      -vehicle.steeringInput * speedRatio * 0.075 - lateralSpeed * 0.01,
      -0.09,
      0.09,
    );
    const bodyBlend = 1 - Math.exp(-deltaSeconds * 6);
    vehicle.visual.rotation.x += (targetPitch - vehicle.visual.rotation.x) * bodyBlend;
    vehicle.visual.rotation.z += (targetRoll - vehicle.visual.rotation.z) * bodyBlend;

    const nextX = vehicle.anchor.position.x + vehicle.velocityX * deltaSeconds;
    const nextZ = vehicle.anchor.position.z + vehicle.velocityZ * deltaSeconds;
    const staticCollisionNormal = this.staticPathCollisionNormal(
      vehicle.anchor.position.x,
      vehicle.anchor.position.z,
      nextX,
      nextZ,
    );
    if (staticCollisionNormal) {
      this.applyPlayerImpact(vehicle, staticCollisionNormal, "Impact");
    } else if (this.wouldOverlapVehicle(
      vehicle,
      nextX,
      nextZ,
      PLAYER_VEHICLE_CLEARANCE_METERS,
      true,
    )) {
      this.applyPlayerImpact(
        vehicle,
        this.vehicleCollisionNormal(vehicle, nextX, nextZ),
        "Traffic impact",
      );
    } else {
      vehicle.anchor.position.x = nextX;
      vehicle.anchor.position.z = nextZ;
      vehicle.anchor.position.y = 0.055;
    }
    vehicle.anchor.rotation.y = vehicle.heading;
    vehicle.impactStrength = moveToward(vehicle.impactStrength, 0, 2.4 * deltaSeconds);
    this.audio.update(
      clamp(Math.abs(vehicle.speed) / PLAYER_MAX_FORWARD_SPEED_MPS, 0, 1),
      Math.max(throttle, brake * 0.35),
      clamp(Math.abs(vehicle.lateralSpeed) / 4.5, 0, 1),
    );
    this.updateChaseCamera(vehicle, deltaSeconds);
  }

  private staticPathCollisionNormal(fromX: number, fromZ: number, toX: number, toZ: number): Vector3 | null {
    const delta = new Vector3(toX - fromX, 0, toZ - fromZ);
    const distance = delta.length();
    if (distance < 0.01) return null;
    delta.scaleInPlace(1 / distance);
    const ray = new Ray(
      new Vector3(fromX, 0.72, fromZ),
      delta,
      distance + 0.9,
    );
    const hit = this.scene.pickWithRay(
      ray,
      (mesh) => mesh.checkCollisions && mesh.metadata?.vehicle !== true,
      true,
    );
    if (!hit?.hit || hit.distance > distance + 0.55) return null;
    const pickedNormal = hit.getNormal(true);
    const normal = pickedNormal
      ? new Vector3(pickedNormal.x, 0, pickedNormal.z)
      : delta.scale(-1);
    if (normal.lengthSquared() < 1e-5) normal.copyFrom(delta).scaleInPlace(-1);
    normal.normalize();
    if (Vector3.Dot(normal, delta) > 0) normal.scaleInPlace(-1);
    return normal;
  }

  private vehicleCollisionNormal(subject: VehicleInstance, x: number, z: number): Vector3 {
    let nearest: VehicleInstance | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const other of this.vehicles) {
      if (other === subject || !other.anchor.isEnabled()) continue;
      const distance = Math.hypot(x - other.anchor.position.x, z - other.anchor.position.z);
      if (distance >= PLAYER_VEHICLE_CLEARANCE_METERS || distance >= nearestDistance) continue;
      nearest = other;
      nearestDistance = distance;
    }
    const normal = nearest
      ? new Vector3(x - nearest.anchor.position.x, 0, z - nearest.anchor.position.z)
      : new Vector3(-subject.velocityX, 0, -subject.velocityZ);
    if (normal.lengthSquared() < 1e-5) normal.set(-Math.sin(subject.heading), 0, -Math.cos(subject.heading));
    return normal.normalize();
  }

  private applyPlayerImpact(vehicle: VehicleInstance, collisionNormal: Vector3, message: string): void {
    const normal = collisionNormal.clone();
    const velocity = new Vector3(vehicle.velocityX, 0, vehicle.velocityZ);
    if (Vector3.Dot(velocity, normal) > 0) normal.scaleInPlace(-1);
    const normalSpeed = Vector3.Dot(velocity, normal);
    const closingSpeed = Math.max(0, -normalSpeed);
    const tangent = velocity.subtract(normal.scale(normalSpeed));
    const retainedVelocity = tangent.scale(0.56).add(normal.scale(closingSpeed * 0.14));
    vehicle.velocityX = retainedVelocity.x;
    vehicle.velocityZ = retainedVelocity.z;
    const forward = new Vector3(Math.sin(vehicle.heading), 0, Math.cos(vehicle.heading));
    vehicle.speed = Vector3.Dot(retainedVelocity, forward);
    vehicle.lateralSpeed = Vector3.Dot(
      retainedVelocity,
      new Vector3(Math.cos(vehicle.heading), 0, -Math.sin(vehicle.heading)),
    );
    vehicle.yawVelocity *= -0.22;
    vehicle.impactStrength = Math.max(
      vehicle.impactStrength,
      clamp(closingSpeed / 16, 0.16, 1),
    );
    this.audio.impact(vehicle.impactStrength);
    if (closingSpeed > 0.8) {
      this.impactFeedbackMessage = message;
      this.impactFeedbackUntil = performance.now() + 720;
    }
  }

  // Canonical parking slots replace the former `private nearestProjectionInSegments`
  // parking fallback. Player motion below remains deliberately road-agnostic.

  private wouldOverlapVehicle(
    subject: VehicleInstance,
    x: number,
    z: number,
    minimumDistance = PLAYER_VEHICLE_CLEARANCE_METERS,
    onlyWhenClosing = false,
  ): boolean {
    for (const other of this.vehicles) {
      if (other === subject) continue;
      if (!other.anchor.isEnabled()) continue;
      const candidateDistance = Math.hypot(
        x - other.anchor.position.x,
        z - other.anchor.position.z,
      );
      if (candidateDistance >= minimumDistance) continue;
      if (!onlyWhenClosing) return true;

      const currentDistance = Math.hypot(
        subject.anchor.position.x - other.anchor.position.x,
        subject.anchor.position.z - other.anchor.position.z,
      );
      // A nearby vehicle should block an approach, but not trap the player
      // when steering alongside it or moving back into clear space.
      if (currentDistance >= minimumDistance || candidateDistance < currentDistance - 0.01) return true;
    }
    return false;
  }

  private isPositionOccupied(x: number, z: number, minimumDistance: number): boolean {
    for (const vehicle of this.vehicles) {
      if (Math.hypot(x - vehicle.anchor.position.x, z - vehicle.anchor.position.z) < minimumDistance) return true;
    }
    return false;
  }

  private updateChaseCamera(vehicle: VehicleInstance, deltaSeconds: number): void {
    const forward = new Vector3(Math.sin(vehicle.heading), 0, Math.cos(vehicle.heading));
    const right = new Vector3(Math.cos(vehicle.heading), 0, -Math.sin(vehicle.heading));
    const speedRatio = clamp(Math.abs(vehicle.speed) / PLAYER_MAX_FORWARD_SPEED_MPS, 0, 1);
    const lookAhead = PLAYER_CAMERA_BASE_LOOK_AHEAD
      + Math.abs(vehicle.speed) * PLAYER_CAMERA_SPEED_LOOK_AHEAD;
    const cornerLook = vehicle.steeringInput
      * (PLAYER_CAMERA_BASE_CORNER_LOOK + speedRatio * PLAYER_CAMERA_SPEED_CORNER_LOOK);
    const focus = vehicle.anchor.position.add(new Vector3(0, 1.25, 0));
    const cameraDistance = PLAYER_CAMERA_BASE_DISTANCE + speedRatio * PLAYER_CAMERA_SPEED_DISTANCE;
    const cameraHeight = PLAYER_CAMERA_BASE_HEIGHT + speedRatio * PLAYER_CAMERA_SPEED_HEIGHT;
    const desired = vehicle.anchor.position
      .subtract(forward.scale(cameraDistance))
      .add(right.scale(-vehicle.steeringInput * speedRatio * PLAYER_CAMERA_LATERAL_SHIFT))
      .add(new Vector3(0, cameraHeight, 0));
    const boom = desired.subtract(focus);
    const boomLength = boom.length();
    const boomDirection = boomLength > 1e-5 ? boom.scale(1 / boomLength) : Vector3.Up();
    const obstruction = this.scene.pickWithRay(
      new Ray(focus, boomDirection, boomLength),
      (mesh) => mesh.checkCollisions && mesh.metadata?.vehicle !== true,
      true,
    );
    const safeDistance = obstruction?.hit
      ? Math.max(0.8, Math.min(boomLength, obstruction.distance - 0.35))
      : boomLength;
    const safePosition = focus.add(boomDirection.scale(safeDistance));
    if (!this.reducedMotion && vehicle.impactStrength > 0.01) {
      const phase = performance.now() * 0.045;
      safePosition.x += Math.sin(phase) * vehicle.impactStrength * 0.09;
      safePosition.y += Math.sin(phase * 1.37) * vehicle.impactStrength * 0.06;
    }
    this.camera.position.copyFrom(Vector3.Lerp(
      this.camera.position,
      safePosition,
      1 - Math.exp(-deltaSeconds * (6.2 - speedRatio * 1.4)),
    ));
    this.camera.setTarget(
      vehicle.anchor.position
        .add(forward.scale(lookAhead))
        .add(right.scale(cornerLook))
        .add(new Vector3(0, 1.05, 0)),
    );
    const targetFov = this.previousCameraFov + speedRatio * PLAYER_CAMERA_MAX_FOV_INCREASE;
    this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-deltaSeconds * 3.6));
    this.camera.cameraDirection.setAll(0);
    this.camera.cameraRotation.setAll(0);
  }

  private nearestParkedVehicle(): VehicleInstance | null {
    let nearest: VehicleInstance | null = null;
    let nearestDistance = 4.6;
    for (const vehicle of this.vehicles) {
      if (vehicle.kind !== "parked" && vehicle.kind !== "stopped") continue;
      const distance = Math.hypot(
        this.camera.position.x - vehicle.anchor.position.x,
        this.camera.position.z - vehicle.anchor.position.z,
      );
      if (distance >= nearestDistance) continue;
      if (!this.hasLineOfSightToVehicle(vehicle)) continue;
      nearest = vehicle;
      nearestDistance = distance;
    }
    return nearest;
  }

  private hasLineOfSightToVehicle(vehicle: VehicleInstance): boolean {
    const target = vehicle.anchor.position.add(new Vector3(0, 0.9, 0));
    const delta = target.subtract(this.camera.position);
    const distance = delta.length();
    if (distance < 0.01) return true;
    const hit = this.scene.pickWithRay(
      new Ray(this.camera.position, delta.scale(1 / distance), distance),
      (mesh) => mesh.checkCollisions && mesh.metadata?.vehicle !== true,
      true,
    );
    return !hit?.hit || hit.distance >= distance - 0.25;
  }

  private tryEnterVehicle(): void {
    const vehicle = this.nearestParkedVehicle();
    if (!vehicle) return;
    this.controlled = vehicle;
    vehicle.kind = "player";
    this.setVehicleParkingSlot(vehicle, undefined);
    vehicle.speed = 0;
    vehicle.velocityX = 0;
    vehicle.velocityZ = 0;
    vehicle.steeringInput = 0;
    vehicle.yawVelocity = 0;
    vehicle.lateralSpeed = 0;
    vehicle.previousForwardSpeed = 0;
    vehicle.impactStrength = 0;
    this.previousCameraCollision = this.camera.checkCollisions;
    this.previousCameraFov = this.camera.fov;
    this.camera.checkCollisions = false;
    this.camera.cameraDirection.setAll(0);
    this.camera.cameraRotation.setAll(0);
    this.options.setWalkingEnabled(false);
    this.options.setDrivingEnabled(true);
    this.audio.startDriving();
    this.setVehicleCollision(vehicle, false);
    this.options.drivingHudElement.classList.add("is-visible");
    this.options.drivingHudElement.setAttribute("aria-hidden", "false");
    this.clearKeys();
  }

  private tryExitVehicle(): void {
    if (!this.controlled) return;
    if (Math.abs(this.controlled.speed) > 1.4) {
      this.exitWarningMessage = "Slow below 5 km/h before exiting";
      this.exitWarningUntil = performance.now() + 1_500;
      return;
    }
    const exitPosition = this.findSafeExit(this.controlled);
    if (!exitPosition) {
      this.exitWarningMessage = "No clear space to exit here";
      this.exitWarningUntil = performance.now() + 1_500;
      return;
    }
    this.releaseControlledVehicle(true, exitPosition);
  }

  private findSafeExit(vehicle: VehicleInstance): Vector3 | null {
    const forward = new Vector3(Math.sin(vehicle.heading), 0, Math.cos(vehicle.heading));
    const physicalRight = new Vector3(-forward.z, 0, forward.x);
    const offsets = [
      physicalRight.scale(2.8),
      physicalRight.scale(-2.8),
      forward.scale(-3.2),
    ];
    const standingHeight = this.camera.ellipsoid.y * 2 - this.camera.ellipsoidOffset.y;

    for (const offset of offsets) {
      const candidate = vehicle.anchor.position.add(offset);
      if (this.wouldOverlapVehicle(vehicle, candidate.x, candidate.z, 2.35)) continue;

      const start = vehicle.anchor.position.add(new Vector3(0, 1.05, 0));
      const target = candidate.add(new Vector3(0, 1.05, 0));
      const delta = target.subtract(start);
      const distance = delta.length();
      const obstruction = this.scene.pickWithRay(
        new Ray(start, delta.scale(1 / Math.max(distance, 1e-6)), distance),
        (mesh) => mesh.checkCollisions && mesh.metadata?.vehicle !== true,
        true,
      );
      if (obstruction?.hit && obstruction.distance < distance - 0.2) continue;

      const ground = this.scene.pickWithRay(
        new Ray(
          new Vector3(candidate.x, 4.5, candidate.z),
          Vector3.Down(),
          9,
        ),
        (mesh) => mesh.checkCollisions && mesh.metadata?.vehicle !== true,
        false,
      );
      if (!ground?.hit || !ground.pickedPoint) continue;

      const bodyOrigin = ground.pickedPoint.add(new Vector3(0, 1.05, 0));
      const clearanceDirections = [Vector3.Right(), Vector3.Left(), Vector3.Forward(), Vector3.Backward()];
      const blocked = clearanceDirections.some((direction) => {
        const hit = this.scene.pickWithRay(
          new Ray(bodyOrigin, direction, 0.55),
          (mesh) => mesh.checkCollisions && mesh.metadata?.vehicle !== true,
          true,
        );
        return Boolean(hit?.hit);
      });
      if (blocked) continue;
      return ground.pickedPoint.add(new Vector3(0, standingHeight, 0));
    }
    return null;
  }

  private releaseControlledVehicle(placeCamera: boolean, exitPosition?: Vector3): void {
    const vehicle = this.controlled;
    if (!vehicle) return;
    vehicle.speed = 0;
    vehicle.velocityX = 0;
    vehicle.velocityZ = 0;
    vehicle.steeringInput = 0;
    vehicle.yawVelocity = 0;
    vehicle.lateralSpeed = 0;
    vehicle.previousForwardSpeed = 0;
    vehicle.impactStrength = 0;
    vehicle.visual.rotation.x = 0;
    vehicle.visual.rotation.z = 0;
    const point: Point2 = [vehicle.anchor.position.x, vehicle.anchor.position.z];
    vehicle.kind = [...this.parkingLayoutsByTile.values()].some(
      (layout) => parkingLayoutContainsPoint(layout, point),
    ) ? "parked" : "stopped";
    this.setVehicleParkingSlot(vehicle, undefined);
    this.controlled = null;
    this.camera.checkCollisions = this.previousCameraCollision;
    this.camera.fov = this.previousCameraFov;
    this.options.setWalkingEnabled(true);
    this.options.setDrivingEnabled(false);
    this.audio.stopDriving();
    this.setVehicleCollision(vehicle, true);
    this.options.drivingHudElement.classList.remove("is-visible");
    this.options.drivingHudElement.setAttribute("aria-hidden", "true");
    this.options.feedbackElement.textContent = "";
    this.options.feedbackElement.classList.remove("is-visible");
    this.clearKeys();
    if (placeCamera && exitPosition) {
      this.camera.position.copyFrom(exitPosition);
      this.camera.setTarget(vehicle.anchor.position.add(new Vector3(0, 0.9, 0)));
      this.camera.cameraDirection.setAll(0);
      this.camera.cameraRotation.setAll(0);
    }
    this.adoptVehicleIntoLoadedTile(vehicle);
  }

  private adoptVehicleIntoLoadedTile(vehicle: VehicleInstance): void {
    if (vehicle.tileId && this.tiles.has(vehicle.tileId)) return;
    let nearestTile: MunichTile | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const tile of this.tiles.values()) {
      const distance = Math.hypot(
        vehicle.anchor.position.x - tile.center[0],
        vehicle.anchor.position.z - tile.center[1],
      );
      if (distance >= nearestDistance) continue;
      nearestDistance = distance;
      nearestTile = tile;
    }
    if (!nearestTile) {
      this.disposeVehicle(vehicle);
      return;
    }
    vehicle.tileId = nearestTile.id;
    let tileSet = this.tileVehicles.get(nearestTile.id);
    if (!tileSet) {
      tileSet = new Set();
      this.tileVehicles.set(nearestTile.id, tileSet);
    }
    tileSet.add(vehicle);
  }

  private updateHint(): void {
    const hint = this.options.hintElement;
    if (this.controlled) {
      const speedKph = Math.round(Math.abs(this.controlled.speed) * 3.6);
      this.options.speedElement.textContent = String(speedKph).padStart(2, "0");
      this.options.drivingHudElement.style.setProperty(
        "--driving-speed-progress",
        `${clamp(speedKph / 120, 0, 1) * 100}%`,
      );
      this.options.drivingHudElement.dataset.speedKph = String(speedKph);
      this.options.drivingHudElement.dataset.steering = this.controlled.steeringInput.toFixed(3);
      this.options.drivingHudElement.dataset.slip = this.controlled.lateralSpeed.toFixed(3);

      const now = performance.now();
      let feedback = "";
      if (now < this.impactFeedbackUntil) feedback = this.impactFeedbackMessage;
      else if (this.pressed.has("Space") && Math.abs(this.controlled.speed) > 3) feedback = "Handbrake";
      else if (Math.abs(this.controlled.lateralSpeed) > 1.35 && speedKph > 25) feedback = "Controlled slide";
      else if (this.controlled.speed < -0.3) feedback = "Reverse";
      this.options.feedbackElement.textContent = feedback;
      this.options.feedbackElement.classList.toggle("is-visible", feedback !== "");

      hint.textContent = now < this.exitWarningUntil
        ? this.exitWarningMessage
        : "W/S throttle & brake · A/D steer · Space handbrake · E exit";
      hint.classList.add("is-visible");
      return;
    }
    const parked = this.nearestParkedVehicle();
    hint.textContent = parked ? `E · Enter ${parked.model}` : "";
    hint.classList.toggle("is-visible", parked !== null);
  }

  private axis(primary: string, alternate: string): number {
    return this.pressed.has(primary) || this.pressed.has(alternate) ? 1 : 0;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "KeyE" && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
      this.unlockAudio();
      this.interactionRequested = true;
      event.preventDefault();
      return;
    }
    if (!this.controlled || !DRIVE_CODES.has(event.code) || event.ctrlKey || event.metaKey || event.altKey) return;
    this.pressed.add(event.code);
    event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (!DRIVE_CODES.has(event.code)) return;
    this.pressed.delete(event.code);
    if (this.controlled) event.preventDefault();
  };

  private readonly clearKeys = (): void => {
    this.pressed.clear();
  };
}
