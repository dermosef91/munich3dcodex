import assert from "node:assert/strict";
import path from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { createServer } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const vite = await createServer({
  root,
  appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false },
});

function tile(id = "curbside-contract") {
  const businesses = Array.from({ length: 12 }, (_, index) => ({
    id: `node/business-${index}`,
    point: [-42 + index * 8, 8],
    name: `Business ${index}`,
    category: "retail",
    frontage: {
      buildingId: 1_000 + index,
      anchor: [-42 + index * 8, 8],
      tangent: [1, 0],
      outward: [0, -1],
      width: 4.2,
    },
    sourceRefs: [],
  }));
  return {
    id,
    center: [0, 0],
    buildings: [],
    roads: [
      {
        kind: "secondary",
        sourceId: "osm:way/east-west",
        width: 9,
        lanes: 2,
        points: [[-50, 0], [0, 0], [50, 0]],
        parking: { both: { position: "lane", orientation: "parallel" } },
      },
      {
        kind: "secondary",
        sourceId: "osm:way/north-south",
        width: 8,
        lanes: 2,
        points: [[0, -50], [0, 0], [0, 50]],
      },
      {
        kind: "footway",
        sourceId: "osm:way/signal-crossing",
        width: 3,
        footway: "crossing",
        crossing: "traffic_signals",
        points: [[-7, 2], [7, 2]],
      },
    ],
    greens: [],
    businesses,
    benches: Array.from({ length: 8 }, (_, index) => ({
      id: 200 + index,
      point: [-42 + index * 12, 7],
      seats: 3,
      sourceRefs: [],
    })),
    streetLamps: [],
    parkingRows: [{
      id: "municipal-row:curbside:0",
      sourceId: "municipal-row:curbside",
      tileId: id,
      points: [[-45, 5], [45, 5]],
      capacity: 15,
      sourceCapacity: 15,
      sourceStartMeters: 0,
      sourceLengthMeters: 90,
      regulation: {},
      sourceRefs: [],
    }],
  };
}

const engine = new NullEngine({ renderWidth: 32, renderHeight: 32 });
const scene = new Scene(engine);
scene.useRightHandedSystem = true;

try {
  const {
    buildCurbsideDetailMeshes,
    deriveCurbsidePlacements,
  } = await vite.ssrLoadModule("/src/world/curbsideDetails.ts");

  const first = deriveCurbsidePlacements(tile());
  const second = deriveCurbsidePlacements(tile());
  assert.deepEqual(second, first, "curbside placements must be byte-for-byte deterministic");
  assert.ok(first.racks.length > 0, "business frontages must infer at least one rack");
  assert.ok(first.racks.some((rack) => rack.bikeCount > 0), "each rendered rack needs bicycles");
  assert.ok(first.parkingSigns.length > 0, "municipal parking rows must infer parking signs");
  assert.equal(first.trafficSignals.length, 4, "one four-arm major junction needs four signal heads");
  assert.ok(first.bins.length > 0, "mapped benches must infer nearby public bins");

  const meshes = buildCurbsideDetailMeshes(tile(), scene);
  assert.deepEqual(
    meshes.map((mesh) => mesh.name),
    ["curbside-details-curbside-contract", "curbside-signal-lights-curbside-contract"],
    "a populated tile must collapse every object into one structure and one light batch",
  );
  const expectedCounts = {
    racks: first.racks.length,
    bicycles: first.racks.reduce((sum, rack) => sum + rack.bikeCount, 0),
    parkingSigns: first.parkingSigns.length,
    trafficSignals: first.trafficSignals.length,
    bins: first.bins.length,
  };
  for (const mesh of meshes) {
    assert.equal(mesh.isPickable, false);
    assert.equal(mesh.checkCollisions, false);
    assert.equal(mesh.useVertexColors, true);
    assert.ok(mesh.getTotalVertices() > 0);
    assert.ok(mesh.getTotalIndices() > 0);
    assert.deepEqual(mesh.metadata, {
      curbsideDetails: expectedCounts,
      inferred: true,
    });
  }

  const otherMeshes = buildCurbsideDetailMeshes(tile("curbside-contract-2"), scene);
  assert.equal(otherMeshes[0].material, meshes[0].material, "tile batches must share structure material");
  assert.equal(otherMeshes[1].material, meshes[1].material, "signal batches must share emissive material");
  assert.deepEqual(
    buildCurbsideDetailMeshes({
      id: "curbside-empty",
      center: [0, 0],
      buildings: [],
      roads: [],
      greens: [],
    }, scene),
    [],
    "tiles without usable semantics must not allocate empty meshes",
  );
  const unsignalized = tile("curbside-unsignalized");
  unsignalized.roads = unsignalized.roads.filter((road) => road.crossing !== "traffic_signals");
  assert.equal(
    deriveCurbsidePlacements(unsignalized).trafficSignals.length,
    0,
    "road hierarchy alone must never invent a signalized junction",
  );

  process.stdout.write(
    "Curbside details valid: deterministic placements and two shared-material tile batches for racks, bikes, signs, signals, and bins.\n",
  );
} finally {
  scene.dispose();
  engine.dispose();
  await vite.close();
}
