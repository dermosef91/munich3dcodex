import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { Engine } from "@babylonjs/core/Engines/engine";
import type { GroundShadowSystem } from "./GroundShadowSystem";
import type { MunichTile, Point2, TramTrackFeature } from "./types";
import { terrainHeightFromGrids } from "./terrain";

interface Route {
  key: string;
  points: Point2[];
  cumulative: number[];
  length: number;
  label: string;
}

interface TrackPiece {
  track: TramTrackFeature;
  points: Point2[];
  startKey: string;
  endKey: string;
}

interface Tram {
  anchor: TransformNode;
  shadowId: string;
  route: Route;
  distance: number;
  dwellUntil: number;
}

const TRACK_GAUGE = 1.435;
const VISIBLE_FLEET_FRACTION = 0.10;
const RAIL_HEAD_WIDTH = 0.105;
const RAIL_TOP_Y = 0.088;
const RAIL_BASE_Y = 0.048;
const RAIL_GROOVE_WIDTH = 0.026;
const RAIL_TOP_COLOR = new Color4(0.48, 0.50, 0.51, 1);
const RAIL_SIDE_COLOR = new Color4(0.19, 0.21, 0.22, 1);
const RAIL_GROOVE_COLOR = new Color4(0.035, 0.045, 0.05, 1);

interface RailBuffers {
  positions: number[];
  indices: number[];
  normals: number[];
  colors: number[];
}

type TerrainHeightResolver = (x: number, z: number) => number;

function material(scene: Scene, name: string, color: Color3, emissive?: Color3): StandardMaterial {
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = color;
  result.specularColor = new Color3(0.34, 0.34, 0.36);
  result.emissiveColor = emissive ?? Color3.Black();
  return result;
}

function heading(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

function pointKey([x, z]: Point2): string {
  // Runtime OSM coordinates are centimetre-rounded. A decimetre bucket joins
  // ways split by an OSM editing boundary without bridging separate rails.
  return `${x.toFixed(1)}:${z.toFixed(1)}`;
}

function routeFrom(points: Point2[], key: string, label: string): Route | null {
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
    ));
  }
  const length = cumulative.at(-1) ?? 0;
  if (length < 45) return null;
  return {
    key,
    points,
    cumulative,
    length,
    label,
  };
}

function continuationScore(points: Point2[], candidate: Point2[]): number {
  if (points.length < 2 || candidate.length < 2) return -1;
  const current = points.at(-1) ?? points[0];
  const previous = points[points.length - 2];
  const next = candidate[1];
  const ax = current[0] - previous[0];
  const az = current[1] - previous[1];
  const bx = next[0] - current[0];
  const bz = next[1] - current[1];
  return (ax * bx + az * bz) / Math.max(Math.hypot(ax, az) * Math.hypot(bx, bz), 1e-6);
}

/** Join directed OSM rail pieces at shared endpoints into through paths. */
export function stitchTramTracks(tracks: TramTrackFeature[]): Route[] {
  const pieces: TrackPiece[] = tracks
    .filter((track) => track.service !== "yard" && track.points.length >= 2)
    .map((track) => ({
      track,
      points: track.oneway === -1 ? [...track.points].reverse() : [...track.points],
      startKey: pointKey(track.oneway === -1 ? track.points.at(-1) ?? track.points[0] : track.points[0]),
      endKey: pointKey(track.oneway === -1 ? track.points[0] : track.points.at(-1) ?? track.points[0]),
    }));
  const outgoing = new Map<string, number[]>();
  const incoming = new Map<string, number>();
  for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex += 1) {
    const piece = pieces[pieceIndex];
    outgoing.set(piece.startKey, [...(outgoing.get(piece.startKey) ?? []), pieceIndex]);
    incoming.set(piece.endKey, (incoming.get(piece.endKey) ?? 0) + 1);
  }

  const routes: Route[] = [];
  const covered = new Set<number>();
  const emitted = new Set<string>();
  const maximumRoutes = 128;

  const explore = (
    pieceIndex: number,
    points: Point2[],
    usedIds: string[],
    visited: Set<number>,
    firstTrack: TramTrackFeature,
  ): void => {
    if (routes.length >= maximumRoutes) return;
    const piece = pieces[pieceIndex];
    covered.add(pieceIndex);
    const nextPoints = points.length === 0 ? [...piece.points] : [...points, ...piece.points.slice(1)];
    const nextIds = [...usedIds, piece.track.id];
    const nextVisited = new Set(visited).add(pieceIndex);
    const options = (outgoing.get(piece.endKey) ?? [])
      .filter((index) => !nextVisited.has(index))
      .map((index) => ({
        index,
        score: continuationScore(nextPoints, pieces[index].points),
        id: pieces[index].track.id,
      }))
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));

    if (options.length > 0) {
      // Explore each legal branch. Shared downstream rails may belong to more
      // than one service; making the pieces globally exclusive would discard
      // valid turning movements at junctions such as Nordbad.
      for (const option of options.slice(0, 4)) {
        explore(option.index, nextPoints, nextIds, nextVisited, firstTrack);
      }
      return;
    }

    const key = nextIds.join("+");
    if (emitted.has(key)) return;
    emitted.add(key);
    const label = firstTrack.ref?.split(";")[0]
      || (firstTrack.kind === "light_rail" ? "U-Bahn" : "20");
    const route = routeFrom(nextPoints, key, label);
    if (route) routes.push(route);
  };

  // OSM railway direction is authoritative for one-way tracks. Start at the
  // loaded graph boundary; each route then only follows outgoing pieces.
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index];
    if ((incoming.get(piece.startKey) ?? 0) === 0) {
      explore(index, [], [], new Set(), piece.track);
    }
  }
  // Closed loops have no graph-boundary start. Seed any still-uncovered piece;
  // the per-route visited set prevents cycling forever.
  for (let index = 0; index < pieces.length && routes.length < maximumRoutes; index += 1) {
    if (!covered.has(index)) explore(index, [], [], new Set(), pieces[index].track);
  }
  return routes;
}

export function activeTramRoutes(tracks: TramTrackFeature[]): Route[] {
  const eligible = stitchTramTracks(tracks)
    // Connector/crossover rails around junctions are real infrastructure but
    // must not receive a tram that shuttles over only a few metres.
    .filter((route) => route.length >= 250)
    .sort((left, right) => right.length - left.length || left.key.localeCompare(right.key));
  const byMovement = new Map<string, Route>();
  for (const route of eligible) {
    const movement = `${pointKey(route.points[0])}>${pointKey(route.points.at(-1) ?? route.points[0])}`;
    if (!byMovement.has(movement)) byMovement.set(movement, route);
  }
  // Preserve different legal movements through a junction instead of filling
  // every slot with small variants of the same longest corridor.
  return [...byMovement.values()]
    .sort((left, right) => right.length - left.length || left.key.localeCompare(right.key))
    .slice(0, 8);
}

/** Keep the route graph rich while showing only a sparse, city-scale service. */
export function visibleTramRoutes(tracks: TramTrackFeature[]): Route[] {
  const routes = activeTramRoutes(tracks);
  if (routes.length === 0) return [];
  const visibleCount = Math.max(1, Math.round(routes.length * VISIBLE_FLEET_FRACTION));
  return routes.slice(0, visibleCount);
}

function sample(route: Route, distance: number): { x: number; z: number; dx: number; dz: number } {
  const d = Math.max(0, Math.min(route.length, distance));
  let low = 0;
  let high = route.cumulative.length - 2;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (route.cumulative[middle + 1] < d) low = middle + 1;
    else high = middle - 1;
  }
  const index = Math.min(low, route.points.length - 2);
  const start = route.points[index];
  const end = route.points[index + 1];
  const segmentLength = Math.max(route.cumulative[index + 1] - route.cumulative[index], 1e-6);
  const amount = Math.max(0, Math.min(1, (d - route.cumulative[index]) / segmentLength));
  return {
    x: start[0] + (end[0] - start[0]) * amount,
    z: start[1] + (end[1] - start[1]) * amount,
    dx: (end[0] - start[0]) / segmentLength,
    dz: (end[1] - start[1]) / segmentLength,
  };
}

function significantNeighbor(points: Point2[], index: number, step: -1 | 1): Point2 {
  const origin = points[index];
  let fallback = origin;
  for (let cursor = index + step; cursor >= 0 && cursor < points.length; cursor += step) {
    fallback = points[cursor];
    if (Math.hypot(fallback[0] - origin[0], fallback[1] - origin[1]) >= 0.5) break;
  }
  return fallback;
}

function renderTangent(points: Point2[], index: number): Point2 {
  const previous = significantNeighbor(points, index, -1);
  const next = significantNeighbor(points, index, 1);
  return [next[0] - previous[0], next[1] - previous[1]];
}

function subdivideTerrainPolyline(points: Point2[], maximumSegmentLength = 5): Point2[] {
  if (points.length < 2) return points;
  const result: Point2[] = [[...points[0]] as Point2];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const segments = Math.max(1, Math.ceil(length / maximumSegmentLength));
    for (let segment = 1; segment <= segments; segment += 1) {
      const amount = segment / segments;
      result.push([
        start[0] + (end[0] - start[0]) * amount,
        start[1] + (end[1] - start[1]) * amount,
      ]);
    }
  }
  return result;
}

function offsetTrack(
  points: Point2[],
  lateralOffset: number,
  y: number,
  terrainHeight: TerrainHeightResolver,
): Vector3[] {
  return points.map(([x, z], index) => {
    const previous = significantNeighbor(points, index, -1);
    const next = significantNeighbor(points, index, 1);
    const previousLength = Math.hypot(x - previous[0], z - previous[1]);
    const nextLength = Math.hypot(next[0] - x, next[1] - z);
    let normalX = 0;
    let normalZ = 0;
    let offset = lateralOffset;

    if (previousLength > 1e-6 && nextLength > 1e-6) {
      const previousNormalX = -(z - previous[1]) / previousLength;
      const previousNormalZ = (x - previous[0]) / previousLength;
      const nextNormalX = -(next[1] - z) / nextLength;
      const nextNormalZ = (next[0] - x) / nextLength;
      const miterLength = Math.hypot(previousNormalX + nextNormalX, previousNormalZ + nextNormalZ);
      if (miterLength > 1e-5) {
        normalX = (previousNormalX + nextNormalX) / miterLength;
        normalZ = (previousNormalZ + nextNormalZ) / miterLength;
        const denominator = normalX * nextNormalX + normalZ * nextNormalZ;
        if (Math.abs(denominator) > 1e-4) {
          offset /= denominator;
          const maximumMiter = Math.abs(lateralOffset) * 2.5;
          offset = Math.max(-maximumMiter, Math.min(maximumMiter, offset));
        }
      } else {
        normalX = nextNormalX;
        normalZ = nextNormalZ;
      }
    } else {
      const [dx, dz] = renderTangent(points, index);
      const length = Math.max(Math.hypot(dx, dz), 1e-6);
      normalX = -dz / length;
      normalZ = dx / length;
    }
    const worldX = x + normalX * offset;
    const worldZ = z + normalZ * offset;
    return new Vector3(worldX, terrainHeight(worldX, worldZ) + y, worldZ);
  });
}

function appendQuad(
  buffers: RailBuffers,
  a: Vector3,
  b: Vector3,
  c: Vector3,
  d: Vector3,
  color: Color4,
): void {
  const normal = Vector3.Cross(b.subtract(a), c.subtract(a));
  if (normal.lengthSquared() < 1e-12) return;
  normal.normalize();
  const base = buffers.positions.length / 3;
  for (const point of [a, b, c, d]) {
    buffers.positions.push(point.x, point.y, point.z);
    buffers.normals.push(normal.x, normal.y, normal.z);
    buffers.colors.push(color.r, color.g, color.b, color.a);
  }
  buffers.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function appendRail(
  buffers: RailBuffers,
  points: Point2[],
  centerOffset: number,
  terrainHeight: TerrainHeightResolver,
): void {
  const halfWidth = RAIL_HEAD_WIDTH * 0.5;
  const positiveTop = offsetTrack(points, centerOffset + halfWidth, RAIL_TOP_Y, terrainHeight);
  const negativeTop = offsetTrack(points, centerOffset - halfWidth, RAIL_TOP_Y, terrainHeight);
  const positiveBase = offsetTrack(points, centerOffset + halfWidth, RAIL_BASE_Y, terrainHeight);
  const negativeBase = offsetTrack(points, centerOffset - halfWidth, RAIL_BASE_Y, terrainHeight);
  const grooveCenter = centerOffset - Math.sign(centerOffset) * RAIL_HEAD_WIDTH * 0.27;
  const groovePositive = offsetTrack(
    points,
    grooveCenter + RAIL_GROOVE_WIDTH * 0.5,
    RAIL_TOP_Y + 0.001,
    terrainHeight,
  );
  const grooveNegative = offsetTrack(
    points,
    grooveCenter - RAIL_GROOVE_WIDTH * 0.5,
    RAIL_TOP_Y + 0.001,
    terrainHeight,
  );

  for (let index = 0; index < points.length - 1; index += 1) {
    if (Math.hypot(
      points[index + 1][0] - points[index][0],
      points[index + 1][1] - points[index][1],
    ) < 0.01) continue;
    appendQuad(buffers, positiveTop[index], positiveTop[index + 1], negativeTop[index + 1], negativeTop[index], RAIL_TOP_COLOR);
    appendQuad(buffers, positiveBase[index], positiveBase[index + 1], positiveTop[index + 1], positiveTop[index], RAIL_SIDE_COLOR);
    appendQuad(buffers, negativeBase[index + 1], negativeBase[index], negativeTop[index], negativeTop[index + 1], RAIL_SIDE_COLOR);
    appendQuad(buffers, groovePositive[index], groovePositive[index + 1], grooveNegative[index + 1], grooveNegative[index], RAIL_GROOVE_COLOR);
  }
}

/** Renders the OSM tram alignment and moves a procedural MVG-style articulated tram over it. */
export class TramSystem {
  private readonly tileRoots = new Map<string, TransformNode>();
  private readonly tiles = new Map<string, MunichTile>();
  private readonly trams = new Map<string, Tram>();
  private readonly railMaterial: StandardMaterial;
  private readonly blueMaterial: StandardMaterial;
  private readonly darkMaterial: StandardMaterial;
  private readonly windowMaterial: StandardMaterial;
  private readonly destinationMaterial: StandardMaterial;
  private readonly tramTemplate: TransformNode;
  private routesDirty = false;

  constructor(
    private readonly scene: Scene,
    private readonly engine: Engine,
    private readonly groundShadows?: GroundShadowSystem,
  ) {
    this.railMaterial = material(scene, "tram-rail", Color3.White());
    this.railMaterial.specularColor = new Color3(0.78, 0.80, 0.82);
    this.railMaterial.specularPower = 96;
    this.blueMaterial = material(scene, "mvg-blue", new Color3(0.015, 0.19, 0.68));
    this.darkMaterial = material(scene, "tram-dark", new Color3(0.025, 0.04, 0.065));
    this.windowMaterial = material(scene, "tram-glass", new Color3(0.055, 0.12, 0.17));
    this.windowMaterial.alpha = 0.84;
    this.destinationMaterial = material(scene, "tram-destination", new Color3(1, 0.61, 0.14), new Color3(0.85, 0.35, 0.025));
    const destinationTexture = new DynamicTexture("tram-destination-text", { width: 256, height: 48 }, this.scene, true);
    destinationTexture.drawText("20  MOOSACH", 10, 34, "bold 24px sans-serif", "#ffad34", "#07101a", true);
    this.destinationMaterial.diffuseTexture = destinationTexture;
    this.destinationMaterial.emissiveTexture = destinationTexture;
    for (const staticMaterial of [this.railMaterial, this.blueMaterial, this.darkMaterial, this.windowMaterial, this.destinationMaterial]) {
      staticMaterial.freeze();
    }
    this.tramTemplate = this.buildTramTemplate();
  }

  addTile(tile: MunichTile): void {
    this.removeTile(tile.id);
    this.tiles.set(tile.id, tile);
    const tracks = tile.tramTracks ?? [];
    if (tracks.length) {
      this.tileRoots.set(tile.id, this.buildInfrastructure(tile.id, tracks));
      this.routesDirty = true;
    }
  }

  private terrainHeightAt = (x: number, z: number): number => terrainHeightFromGrids(
    [...this.tiles.values()].map((tile) => tile.terrainData),
    x,
    z,
  );

  removeTile(tileId: string): void {
    const hadTracks = (this.tiles.get(tileId)?.tramTracks?.length ?? 0) > 0;
    this.tiles.delete(tileId);
    this.tileRoots.get(tileId)?.dispose(false, false);
    this.tileRoots.delete(tileId);
    if (hadTracks) this.routesDirty = true;
  }

  private rebuildVehicles(): void {
    const tracks = [...this.tiles.values()].flatMap((tile) => tile.tramTracks ?? []);
    const routes = new Map(visibleTramRoutes(tracks).map((route) => [route.key, route]));
    for (const [key, tram] of this.trams) {
      const route = routes.get(key);
      if (!route) {
        this.groundShadows?.unregister(tram.shadowId);
        tram.anchor.dispose(false, false);
        this.trams.delete(key);
        continue;
      }
      tram.route = route;
      tram.distance = Math.min(tram.distance, route.length);
      routes.delete(key);
    }
    for (const [key, route] of routes) this.trams.set(key, this.createTram(route, key));
  }

  update(): void {
    if (this.routesDirty) {
      this.routesDirty = false;
      this.rebuildVehicles();
    }
    const delta = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
    const now = performance.now();
    for (const tram of this.trams.values()) {
      if (now < tram.dwellUntil) continue;
      if (!tram.anchor.isEnabled()) tram.anchor.setEnabled(true);
      tram.distance += 8.4 * delta; // 30 km/h street running
      if (tram.distance >= tram.route.length) {
        tram.distance = 0;
        tram.dwellUntil = now + 1_800;
        tram.anchor.setEnabled(false);
        continue;
      }
      const point = sample(tram.route, tram.distance);
      tram.anchor.position.set(
        point.x,
        this.terrainHeightAt(point.x, point.z) + 0.16,
        point.z,
      );
      tram.anchor.rotation.y = heading(point.dx, point.dz);
    }
  }

  private buildInfrastructure(tileId: string, tracks: TramTrackFeature[]): TransformNode {
    const root = new TransformNode(`tram-infrastructure-${tileId}`, this.scene);
    const railBuffers: RailBuffers = { positions: [], indices: [], normals: [], colors: [] };
    const catenaryLines: Vector3[][] = [];
    const poleLocations = new Map<string, { points: Point2[]; index: number }>();

    for (const track of tracks) {
      if (track.points.length < 2) continue;
      const renderPoints = subdivideTerrainPolyline(track.points);
      appendRail(railBuffers, renderPoints, -TRACK_GAUGE * 0.5, this.terrainHeightAt);
      appendRail(railBuffers, renderPoints, TRACK_GAUGE * 0.5, this.terrainHeightAt);
      catenaryLines.push(renderPoints.map(([x, z]) => (
        new Vector3(x, this.terrainHeightAt(x, z) + 5.45, z)
      )));
      const last = track.points.length - 1;
      const endpoints: Array<{ points: Point2[]; index: number }> = [
        { points: track.points, index: 0 },
        { points: track.points, index: last },
      ];
      for (const endpoint of endpoints) {
        const key = pointKey(endpoint.points[endpoint.index]);
        if (!poleLocations.has(key)) poleLocations.set(key, endpoint);
      }
    }

    for (const { points, index } of poleLocations.values()) {
      const [x, z] = points[index];
      const [dx, dz] = renderTangent(points, index);
      const length = Math.max(Math.hypot(dx, dz), 1e-6);
      const poleX = x - dz / length * 2.2;
      const poleZ = z + dx / length * 2.2;
      const poleGround = this.terrainHeightAt(poleX, poleZ);
      const trackGround = this.terrainHeightAt(x, z);
      catenaryLines.push([
        new Vector3(poleX, poleGround + 0.1, poleZ),
        new Vector3(poleX, poleGround + 5.52, poleZ),
        new Vector3(x, trackGround + 5.52, z),
        new Vector3(x, trackGround + 5.45, z),
      ]);
    }

    if (railBuffers.indices.length > 0) {
      const rails = new Mesh(`tram-rails-${tileId}`, this.scene);
      const vertexData = new VertexData();
      vertexData.positions = railBuffers.positions;
      vertexData.indices = railBuffers.indices;
      vertexData.normals = railBuffers.normals;
      vertexData.colors = railBuffers.colors;
      vertexData.applyToMesh(rails);
      rails.material = this.railMaterial;
      rails.sideOrientation = Material.CounterClockWiseSideOrientation;
      rails.useVertexColors = true;
      rails.hasVertexAlpha = false;
      rails.isPickable = false;
      rails.parent = root;
      rails.freezeWorldMatrix();
    }
    if (catenaryLines.length > 0) {
      const catenary = MeshBuilder.CreateLineSystem(`tram-catenary-${tileId}`, { lines: catenaryLines, updatable: false }, this.scene);
      catenary.color = new Color3(0.10, 0.12, 0.13);
      catenary.isPickable = false;
      catenary.parent = root;
      catenary.freezeWorldMatrix();
    }
    return root;
  }

  private createTram(route: Route, tileId: string): Tram {
    const anchor = this.tramTemplate.clone(`mvg-tram-${tileId}`, null, false);
    if (!anchor) throw new Error("Unable to clone the tram model");
    anchor.setEnabled(true);
    anchor.metadata = { transit: "tram", route: route.label };
    const initial = sample(route, route.length * 0.27);
    anchor.position.set(
      initial.x,
      this.terrainHeightAt(initial.x, initial.z) + 0.16,
      initial.z,
    );
    anchor.rotation.y = heading(initial.dx, initial.dz);
    const shadowId = `tram:${tileId}`;
    this.groundShadows?.register(shadowId, anchor, {
      width: 2.58,
      length: 32.2,
      groundOffsetY: -0.095,
    });
    return { anchor, shadowId, route, distance: route.length * 0.27, dwellUntil: 0 };
  }

  private buildTramTemplate(): TransformNode {
    const anchor = new TransformNode("mvg-tram-template", this.scene);
    for (const z of [-10.7, 0, 10.7]) this.addCarBody(anchor, z);
    // Articulation bellows and a pantograph make the train read as a single
    // low-floor vehicle rather than three unrelated blue boxes.
    for (const z of [-5.35, 5.35]) {
      const bellows = MeshBuilder.CreateBox(`tram-bellows-${z}`, { width: 2.28, height: 2.4, depth: 0.52 }, this.scene);
      bellows.position.set(0, 1.42, z);
      bellows.material = this.darkMaterial;
      bellows.parent = anchor;
    }
    const mast = MeshBuilder.CreateCylinder("tram-pantograph-mast", { height: 1.55, diameter: 0.06, tessellation: 6 }, this.scene);
    mast.position.set(0, 3.42, 0);
    mast.material = this.darkMaterial;
    mast.parent = anchor;
    const shoe = MeshBuilder.CreateBox("tram-pantograph-shoe", { width: 0.34, height: 0.05, depth: 1.2 }, this.scene);
    shoe.position.set(0, 4.18, 0);
    shoe.material = this.darkMaterial;
    shoe.parent = anchor;
    for (const mesh of anchor.getChildMeshes()) mesh.isPickable = false;
    anchor.setEnabled(false);
    return anchor;
  }

  private addCarBody(anchor: TransformNode, z: number): void {
    const body = MeshBuilder.CreateBox(`tram-body-${z}`, { width: 2.42, height: 2.65, depth: 10.1 }, this.scene);
    body.position.set(0, 1.52, z);
    body.material = this.blueMaterial;
    body.parent = anchor;
    const roof = MeshBuilder.CreateBox(`tram-roof-${z}`, { width: 2.28, height: 0.12, depth: 9.8 }, this.scene);
    roof.position.set(0, 2.88, z);
    roof.material = this.darkMaterial;
    roof.parent = anchor;
    for (const side of [-1, 1]) {
      const glass = MeshBuilder.CreateBox(`tram-window-band-${z}-${side}`, { width: 0.035, height: 1.25, depth: 8.25 }, this.scene);
      glass.position.set(side * 1.225, 1.94, z);
      glass.material = this.windowMaterial;
      glass.parent = anchor;
    }
    if (Math.abs(z) > 10) {
      const direction = Math.sign(z);
      const windscreen = MeshBuilder.CreateBox(`tram-windscreen-${z}`, { width: 1.92, height: 1.55, depth: 0.04 }, this.scene);
      windscreen.position.set(0, 1.95, z + direction * 5.07);
      windscreen.material = this.windowMaterial;
      windscreen.parent = anchor;
      const display = MeshBuilder.CreatePlane(`tram-display-${z}`, { width: 1.42, height: 0.28 }, this.scene);
      display.position.set(0, 2.63, z + direction * 5.1);
      display.rotation.y = direction > 0 ? Math.PI : 0;
      display.material = this.destinationMaterial;
      display.parent = anchor;
    }
  }
}
