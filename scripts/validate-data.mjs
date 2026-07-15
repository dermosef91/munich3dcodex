import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  decodeLod2Geometry,
  LOD2_BINARY_FORMAT,
  LOD2_BINARY_VERSION,
} from "../src/world/lod2Binary.mjs";
import {
  decodeTerrainHeightGrid,
  TERRAIN_BINARY_FORMAT,
  TERRAIN_BINARY_VERSION,
  TERRAIN_QUANTIZATION_METERS,
} from "../src/world/terrainBinary.mjs";

const root = path.resolve(import.meta.dirname, "..");
const dataDirectory = path.join(root, "public", "data");
const manifest = JSON.parse(await readFile(path.join(dataDirectory, "manifest.json"), "utf8"));

const ids = new Set();
const buildingIds = new Set();
let buildingCount = 0;
let roadCount = 0;
let tramTrackCount = 0;
let greenCount = 0;
let treeCount = 0;
let mappedTreeCount = 0;
let inferredTreeRowCount = 0;
let inferredStreetTreeCount = 0;
let streetLampCount = 0;
let benchCount = 0;
let parkingCount = 0;
let parkingRowCount = 0;
let parkingRowCapacity = 0;
let businessCount = 0;
let storefrontCount = 0;
let lod2SidecarCount = 0;
let packedLod2BuildingCount = 0;
let terrainSidecarCount = 0;
let terrainBytes = 0;
let terrainMinimum = Number.POSITIVE_INFINITY;
let terrainMaximum = Number.NEGATIVE_INFINITY;
let terrainSeamCount = 0;
let terrainSeamSampleCount = 0;
const terrainByTile = new Map();
const businessIds = new Set();
const treeIds = new Set();
const streetLampIds = new Set();
const benchIds = new Set();
const parkingIds = new Set();
const parkingRowIds = new Set();
const parkingRowsBySource = new Map();
const frontageBuildingRefs = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertPoint(point, context) {
  assert(Array.isArray(point) && point.length === 2, `${context}: expected a two-value point`);
  assert(point.every(Number.isFinite), `${context}: coordinate is not finite`);
}

function polylineLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
    );
  }
  return length;
}

function assertSourceRefs(sourceRefs, context) {
  assert(Array.isArray(sourceRefs) && sourceRefs.length > 0, `${context}: expected at least one source reference`);
  for (const reference of sourceRefs) {
    assert(typeof reference.dataset === "string" && reference.dataset, `${context}: missing source dataset`);
    assert(typeof reference.id === "string" && reference.id, `${context}: missing source id`);
    assert(typeof reference.license === "string" && reference.license, `${context}: missing source license`);
  }
}

function assertOptionalPositiveInteger(value, context) {
  if (value === undefined) return;
  assert(Number.isInteger(value) && value > 0, `${context}: expected a positive integer`);
}

function assertOptionalNonEmptyString(value, context) {
  if (value === undefined) return;
  assert(typeof value === "string" && value.trim(), `${context}: expected a non-empty string`);
}

function assertParkingSide(side, context) {
  if (!side) return;
  assert(
    [side.position, side.orientation, side.restriction, side.condition].some((value) => typeof value === "string" && value),
    `${context}: empty parking metadata`,
  );
}

function dataPathFromUrl(url) {
  assert(typeof url === "string" && url, "Runtime sidecar URL is missing");
  const relative = url.replace(/^\/+/, "").replace(/^data\//, "");
  const resolved = path.resolve(dataDirectory, relative);
  assert(resolved.startsWith(`${path.resolve(dataDirectory)}${path.sep}`), `Sidecar escapes data directory: ${url}`);
  return resolved;
}

function assertSurfaceGeometry(geometry, buildingId) {
  for (const [kind, mesh] of Object.entries(geometry)) {
    const vertexCount = mesh.positions.length / 3;
    assert(mesh.positions.length % 3 === 0, `Invalid ${kind} positions for building ${buildingId}`);
    assert(mesh.indices.length % 3 === 0, `Invalid ${kind} triangles for building ${buildingId}`);
    assert(mesh.positions.every(Number.isFinite), `Non-finite ${kind} positions for building ${buildingId}`);
    assert(mesh.indices.every(Number.isInteger), `Invalid ${kind} indices for building ${buildingId}`);
    assert(
      mesh.indices.every((index) => index >= 0 && index < vertexCount),
      `Out-of-range ${kind} index for building ${buildingId}`,
    );
    if (mesh.uvs) {
      assert(mesh.uvs.length === vertexCount * 2, `Invalid ${kind} UVs for building ${buildingId}`);
      assert(mesh.uvs.every(Number.isFinite), `Non-finite ${kind} UVs for building ${buildingId}`);
    }
  }
}

assert(manifest.tiles.length > 0, "Manifest has no tiles");
assert(Number.isFinite(manifest.tileSize) && manifest.tileSize > 0, "Manifest tileSize is invalid");

for (const entry of manifest.tiles) {
  assert(!ids.has(entry.id), `Duplicate tile id ${entry.id}`);
  ids.add(entry.id);
  assertPoint(entry.center, `Manifest tile ${entry.id}`);

  const relativeFile = entry.file.replace(/^\//, "").replace(/^data\//, "");
  const tile = JSON.parse(await readFile(path.join(dataDirectory, relativeFile), "utf8"));
  assert(tile.id === entry.id, `Tile id mismatch for ${entry.id}`);
  assertPoint(tile.center, `Tile ${entry.id} center`);

  const packedGeometry = new Map();
  if (tile.lod2Geometry) {
    const sidecar = tile.lod2Geometry;
    assert(sidecar.format === LOD2_BINARY_FORMAT, `Unsupported LoD2 sidecar format in ${entry.id}`);
    assert(sidecar.version === LOD2_BINARY_VERSION, `Unsupported LoD2 sidecar version in ${entry.id}`);
    assert(Number.isSafeInteger(sidecar.byteLength) && sidecar.byteLength > 0, `Invalid sidecar length in ${entry.id}`);
    assert(
      Number.isSafeInteger(sidecar.buildingCount) && sidecar.buildingCount > 0,
      `Invalid sidecar building count in ${entry.id}`,
    );
    const bytes = await readFile(dataPathFromUrl(sidecar.file));
    assert(bytes.byteLength === sidecar.byteLength, `Sidecar byte length mismatch in ${entry.id}`);
    const decoded = decodeLod2Geometry(bytes);
    assert(decoded.records.length === sidecar.buildingCount, `Sidecar building count mismatch in ${entry.id}`);
    const tileBuildingIds = new Set(tile.buildings.map((building) => building.id));
    for (const record of decoded.records) {
      assert(tileBuildingIds.has(record.buildingId), `Sidecar in ${entry.id} references missing building ${record.buildingId}`);
      packedGeometry.set(record.buildingId, record.geometry);
    }
    assert(
      tile.buildings.every((building) => !building.geometry),
      `Tile ${entry.id} mixes packed and inline LoD2 geometry`,
    );
    lod2SidecarCount += 1;
    packedLod2BuildingCount += decoded.records.length;
  }

  const terrain = tile.terrain;
  assert(terrain && typeof terrain === "object", `Tile ${entry.id} is missing its DGM1 terrain sidecar`);
  assert(terrain.format === TERRAIN_BINARY_FORMAT, `Unsupported terrain sidecar format in ${entry.id}`);
  assert(terrain.version === TERRAIN_BINARY_VERSION, `Unsupported terrain sidecar version in ${entry.id}`);
  assert(Number.isSafeInteger(terrain.byteLength) && terrain.byteLength > 0, `Invalid terrain length in ${entry.id}`);
  assert(terrain.columns === 501 && terrain.rows === 501, `Terrain ${entry.id} is not a 501x501 one-metre grid`);
  assertPoint(terrain.origin, `Terrain ${entry.id} origin`);
  assert(Math.abs(terrain.origin[0] - (entry.center[0] - manifest.tileSize / 2)) < 1e-9, `Terrain X origin mismatch in ${entry.id}`);
  assert(Math.abs(terrain.origin[1] - (entry.center[1] - manifest.tileSize / 2)) < 1e-9, `Terrain Z origin mismatch in ${entry.id}`);
  assert(terrain.spacing === 1, `Terrain spacing mismatch in ${entry.id}`);
  assert(terrain.verticalDatum === "DHHN2016", `Terrain datum mismatch in ${entry.id}`);
  assert(terrain.elevationOrigin === 500, `Terrain elevation origin mismatch in ${entry.id}`);
  assert(terrain.quantization === TERRAIN_QUANTIZATION_METERS, `Terrain quantization mismatch in ${entry.id}`);
  assert(terrain.noDataCount === 0, `Terrain ${entry.id} contains unresolved samples`);
  assert(Number.isFinite(terrain.minHeight) && Number.isFinite(terrain.maxHeight), `Terrain range is invalid in ${entry.id}`);
  assert(terrain.minHeight <= terrain.maxHeight, `Terrain range is inverted in ${entry.id}`);
  const terrainPayload = await readFile(dataPathFromUrl(terrain.file));
  assert(terrainPayload.byteLength === terrain.byteLength, `Terrain sidecar byte length mismatch in ${entry.id}`);
  const terrainGrid = decodeTerrainHeightGrid(terrainPayload);
  assert(terrainGrid.columns === terrain.columns && terrainGrid.rows === terrain.rows, `Terrain dimensions disagree in ${entry.id}`);
  assert(terrainGrid.originX === terrain.origin[0] && terrainGrid.originZ === terrain.origin[1], `Terrain origin disagrees in ${entry.id}`);
  assert(terrainGrid.spacing === terrain.spacing, `Terrain spacing disagrees in ${entry.id}`);
  assert(terrainGrid.elevationOrigin === terrain.elevationOrigin, `Terrain elevation origin disagrees in ${entry.id}`);
  assert(Math.abs(terrainGrid.minHeight - terrain.minHeight) <= terrain.quantization, `Terrain minimum disagrees in ${entry.id}`);
  assert(Math.abs(terrainGrid.maxHeight - terrain.maxHeight) <= terrain.quantization, `Terrain maximum disagrees in ${entry.id}`);
  terrainByTile.set(entry.id, terrainGrid);
  terrainSidecarCount += 1;
  terrainBytes += terrainPayload.byteLength;
  terrainMinimum = Math.min(terrainMinimum, terrainGrid.minHeight);
  terrainMaximum = Math.max(terrainMaximum, terrainGrid.maxHeight);

  for (const building of tile.buildings) {
    assert(Number.isSafeInteger(building.id), `Invalid building id ${building.id} in ${entry.id}`);
    assert(!buildingIds.has(building.id), `Duplicate building id ${building.id}`);
    buildingIds.add(building.id);
    assert(Number.isFinite(building.height) && building.height > 0, `Invalid building height in ${entry.id}`);
    assert(building.outline.length >= 3, `Invalid building outline in ${entry.id}`);
    building.outline.forEach((point, index) => assertPoint(point, `Building ${building.id} point ${index}`));
    for (const [holeIndex, hole] of (building.holes ?? []).entries()) {
      assert(Array.isArray(hole) && hole.length >= 3, `Invalid building ${building.id} hole ${holeIndex}`);
      hole.forEach((point, pointIndex) => assertPoint(
        point,
        `Building ${building.id} hole ${holeIndex} point ${pointIndex}`,
      ));
    }
    if (building.heightSource?.startsWith("inferred:")) {
      assert(
        typeof building.heightInference?.method === "string" && building.heightInference.method,
        `Missing height inference method for building ${building.id}`,
      );
      assert(
        typeof building.heightInference?.basis === "string" && building.heightInference.basis,
        `Missing height inference basis for building ${building.id}`,
      );
    }
    const geometry = building.geometry ?? packedGeometry.get(building.id);
    if (geometry) assertSurfaceGeometry(geometry, building.id);
  }
  for (const road of tile.roads) {
    assert(Number.isFinite(road.width) && road.width > 0, `Invalid road width in ${entry.id}`);
    assert(road.points.length >= 2, `Invalid road in ${entry.id}`);
    road.points.forEach((point, index) => assertPoint(point, `Road point ${index} in ${entry.id}`));
    assertOptionalPositiveInteger(road.lanes, `Road lanes in ${entry.id}`);
    assertOptionalPositiveInteger(road.lanesForward, `Road forward lanes in ${entry.id}`);
    assertOptionalPositiveInteger(road.lanesBackward, `Road backward lanes in ${entry.id}`);
    for (const [field, value] of [
      ["sidewalk", road.sidewalk],
      ["footway", road.footway],
      ["footway surface", road.footwaySurface],
      ["cycleway surface", road.cyclewaySurface],
      ["kerb", road.kerb],
      ["left kerb", road.kerbLeft],
      ["right kerb", road.kerbRight],
    ]) {
      assertOptionalNonEmptyString(value, `Road ${field} in ${entry.id}`);
    }
    if (road.cyclewayWidth !== undefined) {
      assert(
        Number.isFinite(road.cyclewayWidth) && road.cyclewayWidth > 0,
        `Invalid cycleway width in ${entry.id}`,
      );
    }
    if (road.segregated !== undefined) {
      assert(typeof road.segregated === "boolean", `Invalid segregated flag in ${entry.id}`);
    }
    if (road.oneway !== undefined) {
      assert([-1, 0, 1].includes(road.oneway), `Invalid oneway direction in ${entry.id}`);
    }
    for (const [field, value] of [
      ["max speed", road.maxSpeedKph],
      ["forward max speed", road.maxSpeedForwardKph],
      ["backward max speed", road.maxSpeedBackwardKph],
    ]) {
      if (value !== undefined) assert(Number.isFinite(value) && value > 0 && value <= 300, `Invalid ${field} in ${entry.id}`);
    }
    if (road.sourceRefs) assertSourceRefs(road.sourceRefs, `Road in ${entry.id}`);
    assertParkingSide(road.parking?.left, `Road left parking in ${entry.id}`);
    assertParkingSide(road.parking?.right, `Road right parking in ${entry.id}`);
    assertParkingSide(road.parking?.both, `Road both-side parking in ${entry.id}`);
  }
  for (const track of tile.tramTracks ?? []) {
    assert(typeof track.id === "string" && track.id, `Invalid tram track id in ${entry.id}`);
    assert(["tram", "light_rail"].includes(track.kind), `Invalid tram kind in ${entry.id}`);
    assert(track.points.length >= 2, `Invalid tram track in ${entry.id}`);
    track.points.forEach((point, index) => assertPoint(point, `Tram track point ${index} in ${entry.id}`));
    assertSourceRefs(track.sourceRefs, `Tram track ${track.id} in ${entry.id}`);
    tramTrackCount += 1;
  }
  for (const green of tile.greens) {
    assert(green.outline.length >= 3, `Invalid green area in ${entry.id}`);
    green.outline.forEach((point, index) => assertPoint(point, `Green point ${index} in ${entry.id}`));
    for (const [holeIndex, hole] of (green.holes ?? []).entries()) {
      assert(Array.isArray(hole) && hole.length >= 3, `Invalid green hole ${holeIndex} in ${entry.id}`);
      hole.forEach((point, pointIndex) => assertPoint(point, `Green hole ${holeIndex} point ${pointIndex} in ${entry.id}`));
    }
  }
  for (const tree of tile.trees ?? []) {
    assert(Number.isSafeInteger(tree.id), `Invalid tree id ${tree.id} in ${entry.id}`);
    assert(!treeIds.has(tree.id), `Duplicate tree id ${tree.id}`);
    treeIds.add(tree.id);
    assertPoint(tree.point, `Tree ${tree.id} in ${entry.id}`);
    assert(Number.isFinite(tree.height) && tree.height > 0, `Invalid tree height for ${tree.id} in ${entry.id}`);
    if (tree.crownDiameter !== undefined) {
      assert(
        Number.isFinite(tree.crownDiameter) && tree.crownDiameter > 0,
        `Invalid tree crown diameter for ${tree.id} in ${entry.id}`,
      );
    }
    assert(
      tree.placement === undefined || [
        "mapped-point",
        "inferred-tree-row",
        "inferred-street-corridor",
      ].includes(tree.placement),
      `Invalid tree placement for ${tree.id} in ${entry.id}`,
    );
    if (tree.placement === "mapped-point") mappedTreeCount += 1;
    if (tree.placement === "inferred-tree-row") {
      inferredTreeRowCount += 1;
      assert(tree.id < 0, `Inferred tree-row tree ${tree.id} must use a synthetic negative id`);
      assert(
        tree.sourceRefs?.some((reference) => /^way\/\d+$/.test(reference.id)),
        `Inferred tree-row tree ${tree.id} must reference its OSM way`,
      );
    }
    if (tree.placement === "inferred-street-corridor") {
      inferredStreetTreeCount += 1;
      assert(tree.id < 0, `Inferred street tree ${tree.id} must use a synthetic negative id`);
      assert(
        tree.sourceRefs?.some((reference) => /^way\/\d+$/.test(reference.id)),
        `Inferred street tree ${tree.id} must reference its OSM road way`,
      );
    }
    if (tree.sourceRefs) assertSourceRefs(tree.sourceRefs, `Tree ${tree.id} in ${entry.id}`);
  }
  for (const lamp of tile.streetLamps ?? []) {
    assert(!streetLampIds.has(lamp.id), `Duplicate street lamp id ${lamp.id}`);
    streetLampIds.add(lamp.id);
    assertPoint(lamp.point, `Street lamp ${lamp.id} in ${entry.id}`);
    if (lamp.height !== undefined) assert(Number.isFinite(lamp.height) && lamp.height > 0, `Invalid street lamp height for ${lamp.id}`);
    assertSourceRefs(lamp.sourceRefs, `Street lamp ${lamp.id} in ${entry.id}`);
  }
  for (const bench of tile.benches ?? []) {
    assert(!benchIds.has(bench.id), `Duplicate bench id ${bench.id}`);
    benchIds.add(bench.id);
    assertPoint(bench.point, `Bench ${bench.id} in ${entry.id}`);
    if (bench.direction !== undefined) assert(bench.direction >= 0 && bench.direction < 360, `Invalid bench direction for ${bench.id}`);
    assertOptionalPositiveInteger(bench.seats, `Bench seats for ${bench.id}`);
    assertSourceRefs(bench.sourceRefs, `Bench ${bench.id} in ${entry.id}`);
  }
  for (const parking of tile.parking ?? []) {
    assert(!parkingIds.has(parking.id), `Duplicate parking id ${parking.id}`);
    parkingIds.add(parking.id);
    assert(["parking", "parking_space"].includes(parking.kind), `Invalid parking kind for ${parking.id}`);
    assertPoint(parking.point, `Parking ${parking.id} in ${entry.id}`);
    if (parking.outline) {
      assert(parking.outline.length >= 3, `Invalid parking outline for ${parking.id}`);
      parking.outline.forEach((point, index) => assertPoint(point, `Parking ${parking.id} point ${index}`));
    }
    if (parking.capacity !== undefined) assert(Number.isInteger(parking.capacity) && parking.capacity >= 0, `Invalid parking capacity for ${parking.id}`);
    if (parking.fee !== undefined) assert(typeof parking.fee === "boolean", `Invalid parking fee flag for ${parking.id}`);
    assertSourceRefs(parking.sourceRefs, `Parking ${parking.id} in ${entry.id}`);
  }
  for (const row of tile.parkingRows ?? []) {
    const context = `Municipal parking row ${row.id} in ${entry.id}`;
    assert(typeof row.id === "string" && row.id, `${context}: missing id`);
    assert(!parkingRowIds.has(row.id), `Duplicate municipal parking row id ${row.id}`);
    parkingRowIds.add(row.id);
    assert(typeof row.sourceId === "string" && row.sourceId, `${context}: missing source id`);
    assert(row.tileId === entry.id, `${context}: tile ownership mismatch (${row.tileId})`);
    assert(Array.isArray(row.points) && row.points.length >= 2, `${context}: expected a polyline`);
    row.points.forEach((point, index) => assertPoint(point, `${context} point ${index}`));
    const pieceLength = polylineLength(row.points);
    assert(pieceLength > 0, `${context}: degenerate polyline`);
    assert(Number.isInteger(row.capacity) && row.capacity >= 0, `${context}: invalid allocated capacity`);
    assert(Number.isInteger(row.sourceCapacity) && row.sourceCapacity > 0, `${context}: invalid source capacity`);
    assert(Number.isFinite(row.sourceStartMeters) && row.sourceStartMeters >= 0, `${context}: invalid source start`);
    assert(Number.isFinite(row.sourceLengthMeters) && row.sourceLengthMeters > 0, `${context}: invalid source length`);
    assert(
      row.sourceStartMeters + pieceLength <= row.sourceLengthMeters + 0.05,
      `${context}: piece exceeds its source length`,
    );
    assert(row.regulation && typeof row.regulation === "object", `${context}: missing regulation metadata`);
    assertSourceRefs(row.sourceRefs, context);
    assert(
      row.sourceRefs.some((reference) => reference.id === row.sourceId && reference.license === "dl-de/by-2-0"),
      `${context}: missing canonical Parkseiten source reference`,
    );

    const source = parkingRowsBySource.get(row.sourceId) ?? {
      capacity: row.sourceCapacity,
      length: row.sourceLengthMeters,
      allocated: 0,
      pieces: [],
    };
    assert(source.capacity === row.sourceCapacity, `${context}: inconsistent source capacity`);
    assert(Math.abs(source.length - row.sourceLengthMeters) <= 0.01, `${context}: inconsistent source length`);
    source.allocated += row.capacity;
    source.pieces.push({
      start: row.sourceStartMeters,
      end: row.sourceStartMeters + pieceLength,
      id: row.id,
    });
    parkingRowsBySource.set(row.sourceId, source);
    parkingRowCount += 1;
    parkingRowCapacity += row.capacity;
  }
  for (const business of tile.businesses ?? []) {
    assert(!businessIds.has(business.id), `Duplicate business id ${business.id}`);
    businessIds.add(business.id);
    assertPoint(business.point, `Business ${business.id} in ${entry.id}`);
    assert(typeof business.name === "string" && business.name.trim(), `Missing business name for ${business.id}`);
    assert(Array.isArray(business.sourceRefs) && business.sourceRefs.length > 0, `Missing source for business ${business.id}`);
    if (business.frontage) {
      assert(Number.isFinite(business.frontage.buildingId), `Invalid frontage building for ${business.id}`);
      frontageBuildingRefs.push([business.id, business.frontage.buildingId]);
      assertPoint(business.frontage.anchor, `Business ${business.id} frontage anchor`);
      assertPoint(business.frontage.tangent, `Business ${business.id} frontage tangent`);
      assertPoint(business.frontage.outward, `Business ${business.id} frontage outward`);
      assert(Number.isFinite(business.frontage.width) && business.frontage.width >= 1.5, `Invalid frontage width for ${business.id}`);
      storefrontCount += 1;
    }
  }

  buildingCount += tile.buildings.length;
  roadCount += tile.roads.length;
  greenCount += tile.greens.length;
  treeCount += tile.trees?.length ?? 0;
  streetLampCount += tile.streetLamps?.length ?? 0;
  benchCount += tile.benches?.length ?? 0;
  parkingCount += tile.parking?.length ?? 0;
  businessCount += tile.businesses?.length ?? 0;

  if (entry.businesses !== undefined) assert(entry.businesses === (tile.businesses?.length ?? 0), `Business count mismatch for ${entry.id}`);
  if (entry.trees !== undefined) assert(entry.trees === (tile.trees?.length ?? 0), `Tree count mismatch for ${entry.id}`);
  if (entry.streetLamps !== undefined) assert(entry.streetLamps === (tile.streetLamps?.length ?? 0), `Street lamp count mismatch for ${entry.id}`);
  if (entry.benches !== undefined) assert(entry.benches === (tile.benches?.length ?? 0), `Bench count mismatch for ${entry.id}`);
  if (entry.parking !== undefined) assert(entry.parking === (tile.parking?.length ?? 0), `Parking count mismatch for ${entry.id}`);
  if (entry.parkingRows !== undefined) {
    assert(entry.parkingRows === (tile.parkingRows?.length ?? 0), `Municipal parking-row count mismatch for ${entry.id}`);
  }
}

for (const [tileId, grid] of terrainByTile) {
  const [tileX, tileZ] = tileId.split("_").map(Number);
  assert(Number.isInteger(tileX) && Number.isInteger(tileZ), `Terrain tile id ${tileId} is invalid`);
  const east = terrainByTile.get(`${tileX + 1}_${tileZ}`);
  if (east) {
    assert(grid.rows === east.rows, `East terrain seam dimensions disagree at ${tileId}`);
    for (let row = 0; row < grid.rows; row += 1) {
      const leftHeight = grid.heights[row * grid.columns + grid.columns - 1];
      const rightHeight = east.heights[row * east.columns];
      assert(
        Math.abs(leftHeight - rightHeight) <= TERRAIN_QUANTIZATION_METERS * 1.01,
        `East terrain seam height mismatch at ${tileId}, row ${row}`,
      );
      terrainSeamSampleCount += 1;
    }
    terrainSeamCount += 1;
  }
  const south = terrainByTile.get(`${tileX}_${tileZ + 1}`);
  if (south) {
    assert(grid.columns === south.columns, `South terrain seam dimensions disagree at ${tileId}`);
    for (let column = 0; column < grid.columns; column += 1) {
      const northHeight = grid.heights[(grid.rows - 1) * grid.columns + column];
      const southHeight = south.heights[column];
      assert(
        Math.abs(northHeight - southHeight) <= TERRAIN_QUANTIZATION_METERS * 1.01,
        `South terrain seam height mismatch at ${tileId}, column ${column}`,
      );
      terrainSeamSampleCount += 1;
    }
    terrainSeamCount += 1;
  }
}

assert(terrainSidecarCount === manifest.tiles.length, "Not every runtime tile has DGM1 terrain");
assert(
  manifest.sources?.some((source) => (
    source.dataset === "Bavarian Surveying Administration DGM1" && source.license === "CC-BY-4.0"
  )),
  "Manifest is missing DGM1 provenance",
);
assert(String(manifest.attribution).includes("DGM1"), "Manifest is missing DGM1 attribution");

for (const [sourceId, source] of parkingRowsBySource) {
  source.pieces.sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < source.pieces.length; index += 1) {
    assert(
      source.pieces[index].start >= source.pieces[index - 1].end - 0.05,
      `Overlapping municipal parking-row pieces for ${sourceId}`,
    );
  }
  const complete = source.pieces[0]?.start <= 0.05
    && source.pieces.at(-1)?.end >= source.length - 0.05;
  if (complete) {
    assert(
      source.allocated === source.capacity,
      `Municipal parking-row capacity mismatch for ${sourceId}: ${source.allocated}/${source.capacity}`,
    );
  }
}

for (const [businessId, buildingId] of frontageBuildingRefs) {
  assert(buildingIds.has(buildingId), `Unknown frontage building ${buildingId} for ${businessId}`);
}

if (manifest.treePlacements) {
  assert(manifest.treePlacements.mappedPoints === mappedTreeCount, "Mapped tree placement count mismatch");
  assert(
    manifest.treePlacements.inferredFromRows === inferredTreeRowCount,
    "Inferred tree-row placement count mismatch",
  );
  assert(manifest.treePlacements.sourceRows > 0, "Manifest reports no source tree rows");
  assert(manifest.treePlacements.defaultSpacingMeters > 0, "Invalid default tree-row spacing");
  assert(
    manifest.treePlacements.inferredFromStreetCorridors === inferredStreetTreeCount,
    "Inferred street-corridor placement count mismatch",
  );
  assert(manifest.treePlacements.sourceStreetWays > 0, "Manifest reports no source street corridors");
  assert(
    Array.isArray(manifest.treePlacements.streetCorridorNames)
      && manifest.treePlacements.streetCorridorNames.length > 0,
    "Manifest reports no reviewed street-corridor names",
  );
  assert(
    manifest.treePlacements.streetCorridorSpacingMeters > 0,
    "Invalid street-corridor tree spacing",
  );
}

if (manifest.parkingRowStats) {
  assert(
    manifest.parkingRowStats.runtimeTileRows === parkingRowCount,
    "Manifest municipal parking-row count mismatch",
  );
  assert(
    manifest.parkingRowStats.runtimeAllocatedCapacity === parkingRowCapacity,
    "Manifest municipal parking-row capacity mismatch",
  );
  assert(
    manifest.parkingRowStats.allocatedCapacity === manifest.parkingRowStats.sourceCapacity,
    "Municipal parking parser did not conserve source capacity",
  );
  assert(
    manifest.sources?.some((source) => (
      source.dataset.includes("Parkseiten") && source.license === "dl-de/by-2-0"
    )),
    "Manifest is missing Parkseiten provenance",
  );
  assert(
    String(manifest.attribution).includes("Landeshauptstadt München"),
    "Manifest is missing municipal parking attribution",
  );
}

process.stdout.write(
  `Validated ${manifest.tiles.length} tiles, ${terrainSidecarCount} DGM1 terrain sidecars (${terrainBytes} bytes, Y ${terrainMinimum.toFixed(3)}..${terrainMaximum.toFixed(3)} m, ${terrainSeamCount} seams/${terrainSeamSampleCount} shared samples), ${buildingCount} buildings, ${packedLod2BuildingCount} semantic LoD2 buildings in ${lod2SidecarCount} binary sidecars, ${roadCount} road segments, ${greenCount} green/water areas, ${treeCount} trees, ${streetLampCount} street lamps, ${benchCount} benches, ${parkingCount} OSM parking features, ${parkingRowCount} municipal parking-row pieces (${parkingRowCapacity} allocated spaces), and ${storefrontCount}/${businessCount} assigned business frontages.\n`,
);
