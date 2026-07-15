import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import earcut from "earcut";
import { assignBusinessFrontages } from "./lib/assign-business-frontages.mjs";
import {
  decodeLod2Geometry,
  encodeLod2Geometry,
  LOD2_BINARY_FORMAT,
  LOD2_BINARY_VERSION,
} from "../src/world/lod2Binary.mjs";

const root = path.resolve(import.meta.dirname, "..");
const normalizedPath = option("--normalized", path.join(root, "data", "normalized", "lod2-munich-corridor.json"));
const dataDirectory = option("--data-dir", path.join(root, "public", "data"));
const tileDirectory = path.join(dataDirectory, "tiles");
const dryRun = process.argv.includes("--dry-run");

const EXACT_MATCHES = new Map([
  ["DEBY_LOD2_4909212", 108881086],
]);

const ROOF_SHAPES = new Map([
  ["1000", "flat"],
  ["2100", "skillion"],
  ["2200", "gabled"],
  ["3100", "hipped"],
  ["3200", "half-hipped"],
  ["3300", "pyramidal"],
  ["3500", "mansard"],
]);

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? path.resolve(process.argv[index + 1]) : fallback;
}

function sidecarFileName(tileFileName) {
  if (!tileFileName.endsWith(".json")) throw new Error(`Tile file is not JSON: ${tileFileName}`);
  return `${tileFileName.slice(0, -5)}.lod2.bin`;
}

function sidecarUrl(tileUrl) {
  if (!tileUrl.endsWith(".json")) throw new Error(`Tile URL is not JSON: ${tileUrl}`);
  return `${tileUrl.slice(0, -5)}.lod2.bin`;
}

function dataPathFromUrl(url) {
  if (typeof url !== "string" || !url) throw new Error("LoD2 sidecar URL is missing");
  const relative = url.replace(/^\/+/, "").replace(/^data\//, "");
  const resolved = path.resolve(dataDirectory, relative);
  const prefix = `${path.resolve(dataDirectory)}${path.sep}`;
  if (!resolved.startsWith(prefix)) throw new Error(`LoD2 sidecar escapes the data directory: ${url}`);
  return resolved;
}

async function hydrateSidecarGeometry(tile) {
  const sidecar = tile.lod2Geometry;
  if (!sidecar) return 0;
  if (sidecar.format !== LOD2_BINARY_FORMAT || sidecar.version !== LOD2_BINARY_VERSION) {
    throw new Error(`Tile ${tile.id} uses unsupported LoD2 sidecar ${sidecar.format} v${sidecar.version}`);
  }
  const bytes = await readFile(dataPathFromUrl(sidecar.file));
  if (bytes.byteLength !== sidecar.byteLength) {
    throw new Error(`Tile ${tile.id} LoD2 sidecar length is ${bytes.byteLength}, expected ${sidecar.byteLength}`);
  }
  const decoded = decodeLod2Geometry(bytes);
  if (decoded.records.length !== sidecar.buildingCount) {
    throw new Error(
      `Tile ${tile.id} LoD2 sidecar has ${decoded.records.length} buildings, expected ${sidecar.buildingCount}`,
    );
  }
  const buildingsById = new Map(tile.buildings.map((building) => [building.id, building]));
  const assignments = decoded.records.map((record) => {
    const building = buildingsById.get(record.buildingId);
    if (!building) throw new Error(`Tile ${tile.id} LoD2 sidecar references missing building ${record.buildingId}`);
    return { building, geometry: record.geometry };
  });
  for (const { building, geometry } of assignments) {
    // Inline arrays may be a deliberate newer input while migrating a mixed
    // dataset; retain them in preference to the older sidecar until repacking.
    building.geometry ??= geometry;
  }
  return decoded.records.length;
}

function prepareTileArtifacts(tiles, manifest) {
  const artifacts = [];
  const wantedSidecars = new Set();
  let binaryBuildings = 0;
  let binaryBytes = 0;
  for (const entry of manifest.tiles) {
    const record = tiles.get(entry.id);
    if (!record) continue;
    const encoded = encodeLod2Geometry(record.tile.buildings);
    const fileName = sidecarFileName(record.file);
    if (encoded.buildingCount > 0) {
      record.tile.lod2Geometry = {
        format: LOD2_BINARY_FORMAT,
        version: LOD2_BINARY_VERSION,
        file: sidecarUrl(entry.file),
        byteLength: encoded.bytes.byteLength,
        buildingCount: encoded.buildingCount,
      };
      wantedSidecars.add(fileName);
      binaryBuildings += encoded.buildingCount;
      binaryBytes += encoded.bytes.byteLength;
    } else {
      delete record.tile.lod2Geometry;
    }
    for (const building of record.tile.buildings) delete building.geometry;
    artifacts.push({ record, fileName, bytes: encoded.buildingCount > 0 ? encoded.bytes : null });
  }
  return { artifacts, wantedSidecars, binaryBuildings, binaryBytes };
}

async function persistTileArtifacts(prepared, existingSidecars) {
  if (dryRun) return;
  // Publish each sidecar before the JSON that references it. A failed run can
  // leave an unreferenced file, but never a freshly written dangling reference.
  for (const artifact of prepared.artifacts) {
    if (artifact.bytes) await writeFile(path.join(tileDirectory, artifact.fileName), artifact.bytes);
  }
  for (const { record } of prepared.artifacts) {
    await writeFile(path.join(tileDirectory, record.file), JSON.stringify(record.tile));
  }
  for (const fileName of existingSidecars) {
    if (!prepared.wantedSidecars.has(fileName)) await unlink(path.join(tileDirectory, fileName));
  }
}

function cleanRing(points) {
  const result = [];
  for (const point of points ?? []) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const next = [round(point[0]), round(point[1])];
    const previous = result[result.length - 1];
    if (!previous || previous[0] !== next[0] || previous[1] !== next[1]) result.push(next);
  }
  if (result.length > 1) {
    const first = result[0];
    const last = result[result.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) result.pop();
  }
  return result;
}

function signedArea(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current[0] * next[1] - next[0] * current[1];
  }
  return sum / 2;
}

function polygonStats(points) {
  let crossSum = 0;
  let centerX = 0;
  let centerZ = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = current[0] * next[1] - next[0] * current[1];
    crossSum += cross;
    centerX += (current[0] + next[0]) * cross;
    centerZ += (current[1] + next[1]) * cross;
    minX = Math.min(minX, current[0]);
    minZ = Math.min(minZ, current[1]);
    maxX = Math.max(maxX, current[0]);
    maxZ = Math.max(maxZ, current[1]);
  }

  const area = Math.abs(crossSum / 2);
  const divisor = crossSum * 3;
  const centroid = Math.abs(divisor) > 1e-6
    ? [centerX / divisor, centerZ / divisor]
    : [points.reduce((sum, point) => sum + point[0], 0) / points.length,
      points.reduce((sum, point) => sum + point[1], 0) / points.length];
  return { area, centroid, bbox: { minX, minZ, maxX, maxZ } };
}

function largestGroundFootprint(building) {
  let best = null;
  let bestArea = 0;
  for (const surface of building.surfaces ?? []) {
    if (surface.type !== "ground") continue;
    for (const polygon of surface.polygons ?? []) {
      const exterior = cleanRing((polygon.exterior ?? []).map(([x, _y, z]) => [x, z]));
      const area = Math.abs(signedArea(exterior));
      if (exterior.length >= 3 && area > bestArea) {
        best = {
          exterior,
          holes: (polygon.holes ?? [])
            .map((ring) => cleanRing(ring.map(([x, _y, z]) => [x, z])))
            .filter((ring) => ring.length >= 3),
        };
        bestArea = area;
      }
    }
  }
  return best;
}

function alignOutline(outline, reference) {
  let aligned = outline.slice();
  if (Math.sign(signedArea(aligned)) !== Math.sign(signedArea(reference))) aligned.reverse();
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < aligned.length; index += 1) {
    const distance = squaredDistance(aligned[index], reference[0]);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  }
  return [...aligned.slice(closestIndex), ...aligned.slice(0, closestIndex)];
}

function boxesOverlap(a, b, padding = 0) {
  return a.minX <= b.maxX + padding && a.maxX >= b.minX - padding
    && a.minZ <= b.maxZ + padding && a.maxZ >= b.minZ - padding;
}

function squaredDistance(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

function bestOsmMatch(lod2, candidates, matchedIds) {
  const exactId = EXACT_MATCHES.get(lod2.building.id);
  if (exactId !== undefined) return candidates.find((candidate) => candidate.building.id === exactId) ?? null;

  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (matchedIds.has(candidate.building.id)) continue;
    const distance = Math.sqrt(squaredDistance(lod2.stats.centroid, candidate.stats.centroid));
    if (distance > 24 || !boxesOverlap(lod2.stats.bbox, candidate.stats.bbox, 4)) continue;
    const areaRatio = Math.max(lod2.stats.area, candidate.stats.area) / Math.max(1, Math.min(lod2.stats.area, candidate.stats.area));
    if (areaRatio > 4.5) continue;
    const score = distance + Math.log(areaRatio) * 8;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function hasNearbyOsm(lod2, candidates) {
  return candidates.some((candidate) => Math.sqrt(squaredDistance(lod2.stats.centroid, candidate.stats.centroid)) < 10);
}

function stableNegativeId(value, usedIds) {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  let candidate = -Math.max(1, hash >>> 1);
  while (usedIds.has(candidate)) candidate -= 1;
  return candidate;
}

function sourceReference(building) {
  const attributes = building.metadata?.genericAttributes ?? {};
  return {
    dataset: "Bavarian Surveying Administration LoD2",
    id: building.id,
    license: "CC-BY-4.0",
    observedAt: attributes.Grundrissaktualitaet,
  };
}

function mergeReferences(existing = [], next) {
  const result = [...existing, next];
  return result.filter((reference, index) => result.findIndex(
    (candidate) => candidate.dataset === reference.dataset && candidate.id === reference.id,
  ) === index);
}

function createRuntimeBuilding(lod2, existing, id, outline, footprint) {
  const metadata = lod2.metadata ?? {};
  const attributes = metadata.genericAttributes ?? {};
  const height = finite(metadata.measuredHeight) ?? finite(lod2.height) ?? finite(existing?.height) ?? 10;
  const groundElevation = finite(lod2.groundElevationDHHN2016) ?? finite(attributes.HoeheGrund);
  const roofElevation = finite(lod2.roofElevationDHHN2016) ?? finite(attributes.HoeheDach);
  const officialLevels = finite(metadata.storeysAboveGround);
  const lod2RoofType = metadata.roofType ? String(metadata.roofType) : undefined;
  const lod2Function = metadata.function ? String(metadata.function) : undefined;
  const geometry = EXACT_MATCHES.has(lod2.id) ? undefined : buildSurfaceGeometry(
    lod2,
    footprint ?? { exterior: outline, holes: [] },
  );

  return {
    ...(existing ?? {}),
    id,
    outline: outline.map(([x, z]) => [round(x), round(z)]),
    height: round(height),
    groundElevation: groundElevation !== undefined ? round(groundElevation) : undefined,
    roofElevation: roofElevation !== undefined ? round(roofElevation) : undefined,
    source: "bavaria-lod2",
    sourceId: lod2.id,
    sourceRefs: mergeReferences(existing?.sourceRefs, sourceReference(lod2)),
    levels: officialLevels !== undefined ? Math.round(officialLevels) : existing?.levels,
    roofShape: ROOF_SHAPES.get(lod2RoofType) ?? existing?.roofShape,
    lod2RoofType,
    lod2Function,
    geometry: geometry && geometry.walls.positions.length > 0 && geometry.roofs.positions.length > 0
      ? geometry
      : undefined,
  };
}

function buildSurfaceGeometry(building, footprint) {
  // Normalized geometry is already relative to the converter's vertical datum.
  // Shift it once more to the building's local ground so Babylon can place the
  // mesh at y=0 without mixing local coordinates with absolute DHHN heights.
  const verticalOrigin = minimumBuildingY(building);
  const center = [building.centroid?.[0] ?? 0, building.centroid?.[2] ?? 0];
  const walls = meshData();
  const roofs = meshData();

  for (const surface of building.surfaces ?? []) {
    const target = surface.type === "roof"
      ? roofs
      : ["wall", "closure", "outerFloor", "outerCeiling"].includes(surface.type) ? walls : null;
    if (!target) continue;
    for (const polygon of surface.polygons ?? []) {
      appendPolygon(
        target,
        polygon,
        surface.type === "roof" ? "roof" : "wall",
        footprint,
        center,
        verticalOrigin,
      );
    }
  }
  return { walls, roofs };
}

function meshData() {
  return { positions: [], indices: [], uvs: [] };
}

function minimumBuildingY(building) {
  let minimum = Number.POSITIVE_INFINITY;
  for (const surface of building.surfaces ?? []) {
    for (const polygon of surface.polygons ?? []) {
      for (const point of polygon.exterior ?? []) minimum = Math.min(minimum, point[1]);
    }
  }
  return Number.isFinite(minimum) ? minimum : 0;
}

function appendPolygon(target, polygon, kind, footprint, buildingCenter, baseElevation) {
  const exterior = normalizeWorldRing(polygon.exterior, baseElevation);
  const holes = (polygon.holes ?? []).map((ring) => normalizeWorldRing(ring, baseElevation)).filter((ring) => ring.length >= 3);
  if (exterior.length < 3) return;

  const rings = [exterior, ...holes];
  const allPoints = rings.flat();
  const projection = dominantProjection(exterior);
  const coordinates = [];
  const holeIndices = [];
  let vertexOffset = exterior.length;
  for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
    if (ringIndex > 0) {
      holeIndices.push(vertexOffset);
      vertexOffset += rings[ringIndex].length;
    }
    for (const point of rings[ringIndex]) coordinates.push(...projection(point));
  }

  const triangles = earcut(coordinates, holeIndices, 2);
  if (triangles.length === 0) return;
  const start = target.positions.length / 3;
  const uvFrame = kind === "wall" ? wallUvFrame(exterior, footprint, buildingCenter) : null;
  for (const point of allPoints) {
    target.positions.push(round(point[0]), round(point[1]), round(point[2]));
    if (kind === "roof") {
      target.uvs.push(round(point[0] / 8), round(point[2] / 8));
    } else {
      target.uvs.push(
        round((point[0] * uvFrame.tangent[0] + point[2] * uvFrame.tangent[1] - uvFrame.minimum) / 3),
        round(point[1] / 3),
      );
    }
  }

  for (let index = 0; index < triangles.length; index += 3) {
    let triangle = [triangles[index], triangles[index + 1], triangles[index + 2]];
    if (shouldReverse(triangle.map((vertex) => allPoints[vertex]), kind, uvFrame?.outward)) {
      triangle = [triangle[0], triangle[2], triangle[1]];
    }
    target.indices.push(start + triangle[0], start + triangle[1], start + triangle[2]);
  }
}

function normalizeWorldRing(ring, baseElevation) {
  const result = [];
  for (const raw of ring ?? []) {
    if (!Array.isArray(raw) || raw.length < 3) continue;
    const point = [raw[0], raw[1] - baseElevation, raw[2]];
    const previous = result[result.length - 1];
    if (!previous || previous.some((value, index) => Math.abs(value - point[index]) > 1e-6)) result.push(point);
  }
  if (result.length > 1 && result[0].every((value, index) => Math.abs(value - result.at(-1)[index]) < 1e-6)) result.pop();
  return result;
}

function dominantProjection(points) {
  let normalX = 0;
  let normalY = 0;
  let normalZ = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    normalX += (current[1] - next[1]) * (current[2] + next[2]);
    normalY += (current[2] - next[2]) * (current[0] + next[0]);
    normalZ += (current[0] - next[0]) * (current[1] + next[1]);
  }
  const axis = [Math.abs(normalX), Math.abs(normalY), Math.abs(normalZ)].indexOf(
    Math.max(Math.abs(normalX), Math.abs(normalY), Math.abs(normalZ)),
  );
  if (axis === 0) return ([, y, z]) => [y, z];
  if (axis === 1) return ([x, , z]) => [x, z];
  return ([x, y]) => [x, y];
}

function pointInRing(point, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    const crosses = (currentPoint[1] > point[1]) !== (previousPoint[1] > point[1]);
    if (!crosses) continue;
    const crossingX = ((previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1]))
      / (previousPoint[1] - currentPoint[1]) + currentPoint[0];
    if (point[0] < crossingX) inside = !inside;
  }
  return inside;
}

function pointInFootprint(point, footprint) {
  return pointInRing(point, footprint.exterior)
    && !footprint.holes.some((hole) => pointInRing(point, hole));
}

function horizontalPolygonNormal(points) {
  let normalX = 0;
  let normalZ = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    normalX += (current[1] - next[1]) * (current[2] + next[2]);
    normalZ += (current[0] - next[0]) * (current[1] + next[1]);
  }
  const length = Math.hypot(normalX, normalZ);
  return length > 1e-6 ? [normalX / length, normalZ / length] : [0, 1];
}

function wallUvFrame(points, footprint, buildingCenter) {
  const wallCenter = points.reduce(
    (sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[2] / points.length],
    [0, 0],
  );
  let [outwardX, outwardZ] = horizontalPolygonNormal(points);
  // Stay close to the boundary so narrow notches and short connector walls do
  // not jump across a neighbouring edge while deciding which side is outside.
  const sampleDistance = 0.01;
  const positiveInside = pointInFootprint(
    [wallCenter[0] + outwardX * sampleDistance, wallCenter[1] + outwardZ * sampleDistance],
    footprint,
  );
  const negativeInside = pointInFootprint(
    [wallCenter[0] - outwardX * sampleDistance, wallCenter[1] - outwardZ * sampleDistance],
    footprint,
  );
  if (positiveInside !== negativeInside) {
    if (positiveInside) {
      outwardX *= -1;
      outwardZ *= -1;
    }
  } else if (outwardX * (wallCenter[0] - buildingCenter[0]) + outwardZ * (wallCenter[1] - buildingCenter[1]) < 0) {
    // Building-part surfaces can sit on neither footprint boundary. Keep a
    // deterministic radial fallback for those ambiguous interior surfaces.
    outwardX *= -1;
    outwardZ *= -1;
  }

  // X=east, Y=up, Z=south is right-handed. up × outward is the
  // viewer's screen-right direction when facing the wall, so asymmetric
  // photographic textures remain readable instead of randomly mirroring.
  const tangent = [outwardZ, -outwardX];
  const minimum = Math.min(...points.map((point) => point[0] * tangent[0] + point[2] * tangent[1]));
  return { outward: [outwardX, outwardZ], tangent, minimum };
}

function shouldReverse(points, kind, wallOutward) {
  if (points.length < 3) return false;
  const [a, b, c] = points;
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  if (kind === "roof") return normal[1] < 0;
  return normal[0] * wallOutward[0] + normal[2] * wallOutward[1] < 0;
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function round(value) {
  return Math.round(Number(value) * 1_000) / 1_000;
}

function tileIdFor(point, tileSize) {
  return `${Math.floor(point[0] / tileSize)}_${Math.floor(point[1] / tileSize)}`;
}

const normalized = JSON.parse(await readFile(normalizedPath, "utf8"));
const manifestPath = path.join(dataDirectory, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const normalizedSourceId = path.basename(normalizedPath);
const previousMerge = manifest.sources?.find(
  (source) => source.dataset === "Bavarian Surveying Administration LoD2"
    && source.id === normalizedSourceId,
);
const directoryFiles = await readdir(tileDirectory);
// Filesystem enumeration order is not stable after a tile rewrite. Matching
// candidates must therefore be loaded in canonical tile order or ambiguous
// courtyard/building-part joins can change between identical rebuilds.
const files = directoryFiles.filter((file) => file.endsWith(".json")).sort();
const existingSidecars = directoryFiles.filter((file) => file.endsWith(".lod2.bin")).sort();
const tiles = new Map();
const referencedSidecars = new Set();
let inlineGeometryBuildings = 0;
let hydratedGeometryBuildings = 0;
for (const file of files) {
  const tile = JSON.parse(await readFile(path.join(tileDirectory, file), "utf8"));
  inlineGeometryBuildings += tile.buildings.filter((building) => building.geometry).length;
  if (tile.lod2Geometry) {
    referencedSidecars.add(path.basename(dataPathFromUrl(tile.lod2Geometry.file)));
    hydratedGeometryBuildings += await hydrateSidecarGeometry(tile);
  }
  tiles.set(tile.id, { tile, file });
}
const staleSidecars = existingSidecars.filter((file) => !referencedSidecars.has(file));
if (previousMerge?.observedAt === normalized.generatedAt) {
  if (inlineGeometryBuildings === 0 && staleSidecars.length === 0) {
    process.stdout.write(`LoD2 merge already applied: ${normalizedSourceId} (${normalized.generatedAt}).\n`);
    process.exit(0);
  }
  const prepared = prepareTileArtifacts(tiles, manifest);
  await persistTileArtifacts(prepared, existingSidecars);
  process.stdout.write(
    `LoD2 binary migration ${dryRun ? "preview" : "complete"}: ${prepared.binaryBuildings} buildings in `
      + `${prepared.wantedSidecars.size} tile sidecars (${prepared.binaryBytes} bytes), `
      + `${inlineGeometryBuildings} inline and ${hydratedGeometryBuildings} previously packed geometries read, `
      + `${staleSidecars.length} stale sidecars ${dryRun ? "would be removed" : "removed"}.\n`,
  );
  process.exit(0);
}

const candidates = [];
const usedIds = new Set();
for (const { tile } of tiles.values()) {
  for (let index = 0; index < tile.buildings.length; index += 1) {
    const building = tile.buildings[index];
    const outline = cleanRing(building.outline);
    if (outline.length < 3) continue;
    candidates.push({ building, tile, index, stats: polygonStats(outline) });
    usedIds.add(building.id);
  }
}

const lod2Buildings = normalized.buildings.map((building) => {
  const footprint = largestGroundFootprint(building);
  const outline = footprint?.exterior;
  return outline?.length >= 3 ? { building, footprint, outline, stats: polygonStats(outline) } : null;
}).filter(Boolean).sort((a, b) => b.stats.area - a.stats.area);

const matchedIds = new Set();
let matched = 0;
let added = 0;
let skipped = 0;
let surfaceBuildings = 0;

for (const lod2 of lod2Buildings) {
  const match = bestOsmMatch(lod2, candidates, matchedIds);
  if (match) {
    const aligned = alignOutline(lod2.outline, match.building.outline);
    const runtime = createRuntimeBuilding(
      lod2.building,
      match.building,
      match.building.id,
      aligned,
      lod2.footprint,
    );
    match.tile.buildings[match.index] = runtime;
    matchedIds.add(match.building.id);
    matched += 1;
    if (runtime.geometry) surfaceBuildings += 1;
    continue;
  }

  if (hasNearbyOsm(lod2, candidates) || lod2.stats.area < 12) {
    skipped += 1;
    continue;
  }

  const id = stableNegativeId(lod2.building.id, usedIds);
  usedIds.add(id);
  const runtime = createRuntimeBuilding(lod2.building, null, id, lod2.outline, lod2.footprint);
  const idForTile = tileIdFor(lod2.stats.centroid, manifest.tileSize);
  const target = tiles.get(idForTile);
  if (!target) {
    skipped += 1;
    continue;
  }
  target.tile.buildings.push(runtime);
  added += 1;
  if (runtime.geometry) surfaceBuildings += 1;
}

manifest.source = [...new Set([
  ...String(manifest.source ?? "").split(";").map((source) => source.trim()).filter(Boolean),
  "Bavarian Surveying Administration LoD2",
])].join("; ");
manifest.attribution = [...new Set([
  ...String(manifest.attribution ?? "").split(" · ").map((credit) => credit.trim()).filter(Boolean),
  "Bayerische Vermessungsverwaltung – www.geodaten.bayern.de",
  "CC BY 4.0",
  "modified for Munich3D",
])].join(" · ");
const bavariaSource = {
  dataset: "Bavarian Surveying Administration LoD2",
  id: normalizedSourceId,
  license: "CC-BY-4.0",
  observedAt: normalized.generatedAt,
};
const existingManifestSources = manifest.sources?.length
  ? manifest.sources
  : [{ dataset: "OpenStreetMap", id: "Munich corridor extract", license: "ODbL-1.0" }];
manifest.sources = mergeReferences(
  existingManifestSources.filter((source) => !(
    source.dataset === bavariaSource.dataset && source.id === bavariaSource.id
  )),
  bavariaSource,
);
manifest.authoritativeCoverage = normalized.clip?.bounds ?? normalized.clip?.bboxWgs84 ?? null;

const businessStats = assignBusinessFrontages(
  new Map([...tiles].map(([id, record]) => [id, record.tile])),
  manifest.tileSize,
);

for (const entry of manifest.tiles) {
  const record = tiles.get(entry.id);
  if (!record) continue;
  entry.buildings = record.tile.buildings.length;
  entry.businesses = record.tile.businesses?.length ?? 0;
  entry.trees = record.tile.trees?.length ?? 0;
  entry.streetLamps = record.tile.streetLamps?.length ?? 0;
  entry.benches = record.tile.benches?.length ?? 0;
  entry.parking = record.tile.parking?.length ?? 0;
  entry.parkingRows = record.tile.parkingRows?.length ?? 0;
}
const prepared = prepareTileArtifacts(tiles, manifest);
await persistTileArtifacts(prepared, existingSidecars);
if (!dryRun) await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

process.stdout.write(
  `LoD2 merge ${dryRun ? "preview" : "complete"}: ${matched} matched, ${added} added, ${skipped} skipped, ${surfaceBuildings} with semantic surface meshes, ${businessStats.assigned}/${businessStats.businesses} business frontages assigned.\n`
  + `Packed ${prepared.binaryBuildings} semantic buildings into ${prepared.wantedSidecars.size} tile sidecars (${prepared.binaryBytes} bytes); `
  + `${existingSidecars.filter((file) => !prepared.wantedSidecars.has(file)).length} stale sidecars ${dryRun ? "would be removed" : "removed"}.\n`,
);
