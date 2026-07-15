import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const [vehicles, meshBuilders, streamer, main] = await Promise.all([
  readFile(path.join(root, "src", "world", "vehicles.ts"), "utf8"),
  readFile(path.join(root, "src", "world", "meshBuilders.ts"), "utf8"),
  readFile(path.join(root, "src", "world", "WorldStreamer.ts"), "utf8"),
  readFile(path.join(root, "src", "main.ts"), "utf8"),
]);

function sourceSection(contents, startMarker, endMarker) {
  const start = contents.indexOf(startMarker);
  const end = contents.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `expected source marker: ${startMarker}`);
  assert.ok(end > start, `expected source marker after ${startMarker}: ${endMarker}`);
  return contents.slice(start, end);
}

const parkedSpawner = sourceSection(vehicles, "private spawnParkedCars", "private spawnTraffic");
const release = sourceSection(vehicles, "private releaseControlledVehicle", "private adoptVehicleIntoLoadedTile");

assert.match(vehicles, /type VehicleKind = "parked" \| "stopped" \| "traffic" \| "player"/);
assert.match(vehicles, /private readonly parkingLayoutsByTile = new Map<string, ParkingLayout>\(\)/);
assert.match(
  vehicles,
  /addTile\(tile: MunichTile, layout: ParkingLayout = deriveParkingLayout\(tile\)\)/,
  "vehicle loading must accept the exact renderer-derived parking layout",
);
assert.match(vehicles, /this\.parkingLayoutsByTile\.set\(tile\.id, layout\)/);
assert.match(vehicles, /this\.parkingLayoutsByTile\.delete\(tileId\)/);

assert.match(parkedSpawner, /this\.parkingLayoutsByTile\.get\(tile\.id\)\?\.slots/);
for (const source of ["osm-parking-space", "osm-parking-area", "municipal-row", "osm-road-side"]) {
  assert.match(parkedSpawner, new RegExp(`slot\\.source === "${source}"`));
}
assert.match(vehicles, /const MAPPED_PARKED_CAR_BUDGET = 8/);
assert.match(vehicles, /const CURBSIDE_PARKED_CAR_BUDGET = 5/);
assert.match(vehicles, /const PARKED_CAR_CLEARANCE_METERS = 4\.8/);
assert.match(parkedSpawner, /leftDistance - rightDistance \|\| left\.id\.localeCompare\(right\.id\)/);
assert.match(parkedSpawner, /this\.isPositionOccupied\(slot\.point\[0\], slot\.point\[1\], PARKED_CAR_CLEARANCE_METERS\)/);
assert.match(parkedSpawner, /headingFromDirection\(slot\.tangent\[0\], slot\.tangent\[1\]\)/);
assert.match(parkedSpawner, /this\.modelFor\(`parking-slot:\$\{slot\.id\}`\)/);
assert.match(parkedSpawner, /slot\.point\[0\][\s\S]*slot\.point\[1\][\s\S]*slot\.id/);

assert.doesNotMatch(vehicles, /spawnMappedParking|parkingPolygonCandidates|parkingChoices|parkingLateralOffset/);
assert.doesNotMatch(vehicles, /ParkingFeature|RoadParkingSide/);
assert.doesNotMatch(
  parkedSpawner,
  /tile\.parking(?:Rows)?|road\.parking/,
  "vehicle placement must not reinterpret raw parking data independently",
);
assert.equal(
  [...vehicles.matchAll(/this\.createVehicle\([\s\S]{0,100}?"parked"/g)].length,
  1,
  "ambient parked vehicles must have exactly one canonical creation path",
);

assert.match(vehicles, /parkingSlotId\?: string/);
assert.match(vehicles, /anchor\.metadata = \{ vehicle: true, vehicleId: id, parkingSlotId \}/);
assert.match(vehicles, /kind === "parked" \|\| kind === "stopped"/);
assert.match(vehicles, /vehicle\.kind !== "parked" && vehicle\.kind !== "stopped"/);
assert.match(
  release,
  /parkingLayoutContainsPoint\(layout, point\)[\s\S]*\? "parked" : "stopped"/,
  "exiting outside visible parking must never label a car parked",
);

assert.match(meshBuilders, /const parkingLayout = deriveParkingLayout\(tile, \{ exclusions: roads\.parkingExclusions \}\)/);
assert.match(meshBuilders, /buildParkingSurfaceMeshes\([\s\S]*parkingLayout/);
assert.match(meshBuilders, /parkingLayout,\s*\/\/ Water/);
assert.match(streamer, /this\.onTileLoaded\?\.\(tile, shadows, built\.parkingLayout\)/);
assert.match(main, /vehicles\.addTile\(tile, parkingLayout\)/);

process.stdout.write(
  "Vehicle parking valid: canonical slots only, stable slot identity, shared renderer layout, and stopped off-layout exits.\n",
);
