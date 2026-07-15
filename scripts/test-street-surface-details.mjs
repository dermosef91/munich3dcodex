import assert from "node:assert/strict";
import path from "node:path";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Material } from "@babylonjs/core/Materials/material.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Scene } from "@babylonjs/core/scene.js";
import { createServer } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const vite = await createServer({
  root,
  appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false },
});

function upwardNormalY(positions, indices, triangleOffset = 0) {
  const ids = indices.slice(triangleOffset, triangleOffset + 3);
  const points = ids.map((id) => positions.slice(id * 3, id * 3 + 3));
  const ab = points[1].map((value, index) => value - points[0][index]);
  const ac = points[2].map((value, index) => value - points[0][index]);
  return ab[2] * ac[0] - ab[0] * ac[2];
}

function tile(id = "street-detail-contract") {
  return {
    id,
    center: [0, 0],
    buildings: [],
    roads: [
      {
        kind: "secondary",
        sourceId: "osm:way/main",
        name: "Contractstraße",
        surface: "asphalt",
        width: 10,
        lanes: 2,
        points: [[-50, 0], [0, 0]],
        parking: { both: { position: "lane", orientation: "parallel" } },
      },
      {
        kind: "secondary",
        sourceId: "osm:way/main",
        name: "Contractstraße",
        surface: "asphalt",
        width: 10,
        lanes: 2,
        points: [[0, 0], [50, 0]],
        parking: { both: { position: "lane", orientation: "parallel" } },
      },
      {
        kind: "service",
        sourceId: "osm:way/approach",
        surface: "asphalt",
        width: 4.5,
        oneway: 1,
        trafficSign: "DE:206",
        points: [[0, 18], [0, 0]],
      },
      {
        kind: "footway",
        sourceId: "osm:way/crossing",
        surface: "paving_stones",
        footway: "crossing",
        crossing: "traffic_signals",
        crossingMarkings: "zebra",
        width: 3,
        points: [[5, -6], [5, 6]],
      },
    ],
    greens: [],
    trees: [
      { id: 10, point: [-20, 6], height: 12, placement: "mapped-point" },
      { id: 20, point: [20, 6], height: 11, placement: "mapped-point" },
    ],
    streetLamps: [{ id: 30, point: [20, 6], sourceRefs: [] }],
    benches: [{ id: 40, point: [35, 6], seats: 3, sourceRefs: [] }],
    parking: [{
      id: "way/parking-space",
      kind: "parking_space",
      point: [-39, -7],
      outline: [[-45, -8], [-33, -8], [-33, -6], [-45, -6]],
      parking: "street_side",
      sourceRefs: [],
    }],
    parkingRows: [{
      id: "municipal-row:test:0",
      sourceId: "municipal-row:test",
      tileId: id,
      points: [[-45, 4], [45, 4]],
      capacity: 12,
      sourceCapacity: 12,
      sourceStartMeters: 0,
      sourceLengthMeters: 90,
      regulation: {},
      sourceRefs: [],
    }],
  };
}

function crossingTruthTile(overrides = {}, id = "crossing-truth") {
  return {
    id,
    center: [0, 0],
    buildings: [],
    greens: [],
    roads: [
      {
        kind: "secondary",
        sourceId: `osm:way/${id}-main`,
        surface: "asphalt",
        width: 10,
        lanes: 2,
        laneMarkings: "no",
        points: [[-20, 0], [20, 0]],
      },
      {
        kind: "footway",
        sourceId: `osm:way/${id}-crossing`,
        surface: "paving_stones",
        footway: "crossing",
        width: 3,
        points: [[0, -6], [0, 6]],
        ...overrides,
      },
    ],
  };
}

function stopTruthTile(trafficSign, id = "stop-truth") {
  const result = crossingTruthTile({}, id);
  result.roads.pop();
  result.roads.push({
    kind: "service",
    sourceId: `osm:way/${id}-approach`,
    surface: "asphalt",
    width: 4.5,
    oneway: 1,
    trafficSign,
    points: [[0, 16], [0, 0]],
  });
  return result;
}

const engine = new NullEngine({ renderWidth: 32, renderHeight: 32 });
const scene = new Scene(engine);
scene.useRightHandedSystem = true;

try {
  const {
    ASPHALT_REPAIR_ATLAS_URL,
    STREET_SURFACE_DETAIL_HEIGHTS,
    WORN_ROAD_PAINT_URL,
    buildStreetSurfaceDetailGeometry,
    buildStreetSurfaceDetails,
  } = await vite.ssrLoadModule("/src/world/streetSurfaceDetails.ts");

  const enabledOptions = {
    includeParkingBands: true,
    inferStopLines: true,
    includeWornCenterMarkings: true,
  };
  const first = buildStreetSurfaceDetailGeometry(tile(), enabledOptions);
  const second = buildStreetSurfaceDetailGeometry(tile(), enabledOptions);
  assert.deepEqual(second, first, "street-detail generation must be byte-for-byte deterministic");

  for (const [kind, batch] of Object.entries(first.batches)) {
    assert.ok(batch.indices.length > 0, `${kind} must contribute one populated tile batch`);
    assert.equal(batch.positions.length % 3, 0);
    assert.equal(batch.colors.length, (batch.positions.length / 3) * 4, `${kind} needs one RGBA color per vertex`);
    assert.equal(batch.uvs.length, (batch.positions.length / 3) * 2, `${kind} needs texture-hook UVs`);
    assert.ok(upwardNormalY(batch.positions, batch.indices) > 0, `${kind} triangles must face +Y`);
  }

  for (const kind of [
    "gutter",
    "tree-pit",
    "parking-band",
    "crossing",
    "stop-line",
    "drain",
    "manhole",
    "asphalt-patch",
    "worn-marking",
  ]) {
    assert.ok(first.counts[kind] > 0, `fixture must exercise ${kind}`);
  }
  assert.equal(
    first.counts["tree-pit"],
    1,
    "the tree sharing a lamp footprint must not receive overlapping pit geometry",
  );
  assert.ok(
    first.placements.some((placement) => placement.kind === "tree-pit" && placement.point[0] === -20),
    "the unobstructed curb tree must retain its pit",
  );
  assert.equal(
    first.placements.some((placement) => placement.kind === "tree-pit" && placement.point[0] === 20),
    false,
    "street furniture must win a conflicting curb footprint",
  );

  const furniture = [
    { point: [20, 6], radius: 0.72 },
    { point: [35, 6], radius: 1.275 },
  ];
  for (const placement of first.placements.filter(({ kind }) => (
    ["drain", "manhole", "asphalt-patch", "stop-line", "worn-marking"].includes(kind)
  ))) {
    for (const blocker of furniture) {
      assert.ok(
        Math.hypot(placement.point[0] - blocker.point[0], placement.point[1] - blocker.point[1])
          >= Math.min(placement.radius, 1.7) + blocker.radius - 1e-6,
        `${placement.kind} must not overlap mapped street furniture`,
      );
    }
  }

  const withoutMunicipal = buildStreetSurfaceDetailGeometry(tile(), {
    includeParkingBands: true,
    includeMunicipalParkingBands: false,
    inferStopLines: true,
    includeWornCenterMarkings: true,
  });
  assert.equal(
    withoutMunicipal.counts["parking-band"],
    first.counts["parking-band"] - 1,
    "the coexistence option must remove only the municipal band while retaining other parking sources",
  );
  assert.equal(
    buildStreetSurfaceDetailGeometry(tile()).counts["parking-band"],
    0,
    "parking geometry must be opt-in when the canonical parking renderer is mounted",
  );
  const withoutPatches = buildStreetSurfaceDetailGeometry(tile(), {
    ...enabledOptions,
    includeAsphaltPatches: false,
  });
  assert.equal(withoutPatches.counts["asphalt-patch"], 0, "repair decals must be independently removable");
  assert.equal(withoutPatches.batches.patch.indices.length, 0, "disabled repair decals must not allocate a patch batch");
  assert.equal(
    buildStreetSurfaceDetailGeometry(tile()).counts["stop-line"],
    0,
    "stop bars must be off by default even when source evidence exists",
  );

  const crossingCases = [
    ["missing marking metadata", {}, false],
    ["crossing=marked alone", { crossing: "marked" }, false],
    ["signal control alone", { crossing: "traffic_signals" }, false],
    ["unknown marking", { crossingMarkings: "mystery" }, false],
    ["explicit zebra", { crossingMarkings: "zebra" }, true],
    ["explicit lines", { crossingMarkings: "lines" }, true],
    ["explicit dashes", { crossingMarkings: "dashes" }, true],
    ["explicit yes", { crossingMarkings: "yes" }, true],
    ["legacy zebra", { crossingRef: "zebra" }, true],
    ["unmarked overrides zebra", { crossing: "unmarked", crossingMarkings: "zebra" }, false],
    ["markings=no overrides legacy", { crossingMarkings: "no", crossingRef: "zebra" }, false],
  ];
  for (const [label, attributes, painted] of crossingCases) {
    const crossingGeometry = buildStreetSurfaceDetailGeometry(
      crossingTruthTile(attributes, `crossing-${String(label).replaceAll(/[^a-z]+/gi, "-")}`),
    );
    assert.equal(crossingGeometry.counts.crossing, painted ? 1 : 0, `${label}: crossing paint count`);
    assert.equal(crossingGeometry.batches.paint.indices.length > 0, painted, `${label}: paint geometry`);
    assert.equal(crossingGeometry.controlPoints.length, 1, `${label}: mapped crossing control survives`);
    assert.equal(crossingGeometry.controlPoints[0].painted, painted, `${label}: control provenance`);
  }

  const signalOnly = buildStreetSurfaceDetailGeometry(crossingTruthTile({ crossing: "traffic_signals" }));
  assert.equal(signalOnly.counts.crossing, 0, "signal control alone must not invent zebra paint");
  assert.equal(signalOnly.controlPoints[0].signalized, true, "signal control must remain available as an exclusion");
  assert.equal(signalOnly.batches.paint.indices.length, 0, "default-safe signal crossing emits no paint at all");

  const explicitStop = stopTruthTile("DE:206");
  assert.equal(buildStreetSurfaceDetailGeometry(explicitStop).counts["stop-line"], 0);
  assert.ok(
    buildStreetSurfaceDetailGeometry(explicitStop, { inferStopLines: true }).counts["stop-line"] > 0,
    "opt-in stop bars may derive from an explicit German stop sign",
  );
  assert.equal(
    buildStreetSurfaceDetailGeometry(stopTruthTile("DE:274.1[30]"), { inferStopLines: true }).counts["stop-line"],
    0,
    "unrelated signs must never become stop paint",
  );
  assert.equal(
    buildStreetSurfaceDetailGeometry(stopTruthTile(undefined), { inferStopLines: true }).counts["stop-line"],
    0,
    "road hierarchy alone must never produce a stop bar",
  );
  const signalStops = buildStreetSurfaceDetailGeometry(
    crossingTruthTile({ crossing: "traffic_signals" }, "signal-stop-evidence"),
    { inferStopLines: true },
  );
  assert.ok(signalStops.counts["stop-line"] > 0, "signal control is explicit source evidence for stop bars");
  assert.equal(signalStops.counts.crossing, 0, "signal stop bars do not imply crossing stripes");

  const noLanePaint = crossingTruthTile({}, "lane-markings-no");
  noLanePaint.roads.pop();
  assert.equal(
    buildStreetSurfaceDetailGeometry(noLanePaint, { includeWornCenterMarkings: true }).batches.paint.indices.length,
    0,
    "lane_markings=no must suppress center dashes on an otherwise marked major road",
  );
  const yesLanePaint = structuredClone(noLanePaint);
  yesLanePaint.id = "lane-markings-yes";
  yesLanePaint.roads[0].laneMarkings = "yes";
  assert.ok(
    buildStreetSurfaceDetailGeometry(yesLanePaint, { includeWornCenterMarkings: true }).counts["worn-marking"] > 0,
    "lane_markings=yes retains deterministic center dashes",
  );
  const continuousDashes = buildStreetSurfaceDetailGeometry(yesLanePaint, { includeWornCenterMarkings: true });
  assert.equal(
    continuousDashes.batches.paint.positions.length / 3,
    continuousDashes.counts["worn-marking"] * 4,
    "each generated lane marker must be one continuous quad rather than a burst of short chunks",
  );

  const localRoad = {
    id: "local-height-contract",
    center: [0, 0],
    buildings: [],
    greens: [],
    roads: [{
      kind: "residential",
      sourceId: "osm:way/local-height",
      surface: "asphalt",
      width: 6,
      points: [[-30, 0], [30, 0]],
    }],
  };
  const localGeometry = buildStreetSurfaceDetailGeometry(localRoad, { includeWornCenterMarkings: true });
  for (const batch of Object.values(localGeometry.batches)) {
    const heights = batch.positions.filter((_, index) => index % 3 === 1);
    assert.ok(
      heights.every((height) => height < 0.042),
      "residential details must hug the 4 cm local-road surface instead of floating at major-road height",
    );
  }

  const built = buildStreetSurfaceDetails(tile(), scene);
  assert.deepEqual(
    built.meshes.map((mesh) => mesh.name),
    [
      "street-surface-surface-street-detail-contract",
      "street-surface-patch-street-detail-contract",
      "street-surface-utility-street-detail-contract",
      "street-surface-paint-street-detail-contract",
    ],
    "one tile must collapse detail geometry into exactly four stable batches",
  );
  assert.deepEqual(
    built.shadowReceivers,
    [],
    "detail overlays must stay outside the streamed shadow receiver workload",
  );
  for (const mesh of built.meshes) {
    assert.equal(mesh.checkCollisions, false, `${mesh.name} must not affect vehicle movement`);
    assert.equal(mesh.isPickable, false, `${mesh.name} must not steal world picks`);
    assert.equal(mesh.useVertexColors, true);
    assert.equal(mesh.getVerticesData(VertexBuffer.ColorKind)?.length, mesh.getTotalVertices() * 4);
    assert.equal(mesh.getVerticesData(VertexBuffer.UVKind)?.length, mesh.getTotalVertices() * 2);
    assert.equal(mesh.metadata.kind, "street-surface-details");
  }

  const patchMesh = built.meshes.find((mesh) => mesh.metadata.batch === "patch");
  assert.ok(patchMesh, "asphalt repairs need a dedicated transparent-atlas batch");
  assert.ok(
    patchMesh.material.diffuseTexture?.url?.endsWith(ASPHALT_REPAIR_ATLAS_URL),
    "patches must use the Munich repair atlas by default",
  );
  assert.equal(patchMesh.material.diffuseTexture.hasAlpha, true);
  assert.equal(patchMesh.material.useAlphaFromDiffuseTexture, true);
  assert.equal(
    patchMesh.material.transparencyMode,
    Material.MATERIAL_ALPHATESTANDBLEND,
    "soft repair edges need alpha test and blending",
  );
  assert.ok(patchMesh.material.alphaCutOff > 0 && patchMesh.material.alphaCutOff < 0.2);
  assert.equal(patchMesh.material.needDepthPrePass, true, "transparent decals need stable road depth sorting");
  const patchUvs = patchMesh.getVerticesData(VertexBuffer.UVKind) ?? [];
  assert.ok(
    patchUvs.every((value) => value >= 0 && value <= 1),
    "patch UVs must remain inside the 2x2 atlas rather than using world-space repeats",
  );
  assert.ok(
    new Set(patchUvs.map((value) => value.toFixed(3))).size >= 4,
    "patch UVs must address complete atlas quadrants with transparent margins",
  );

  const paintMesh = built.meshes.find((mesh) => mesh.metadata.batch === "paint");
  assert.ok(paintMesh, "crossings and worn lane markings need a dedicated paint batch");
  assert.ok(
    paintMesh.material.diffuseTexture?.url?.endsWith(WORN_ROAD_PAINT_URL),
    "paint must use the Munich worn-road texture by default",
  );
  assert.equal(paintMesh.material.diffuseTexture.hasAlpha, true);
  assert.equal(paintMesh.material.useAlphaFromDiffuseTexture, true);
  assert.equal(paintMesh.material.transparencyMode, Material.MATERIAL_ALPHATESTANDBLEND);
  assert.ok(paintMesh.material.alphaCutOff > 0 && paintMesh.material.alphaCutOff < 0.2);
  assert.equal(paintMesh.material.needDepthPrePass, true);
  assert.equal(
    paintMesh.material.isFrozen,
    false,
    "async paint textures must remain unfrozen until their image upload is available",
  );
  const paintUvs = paintMesh.getVerticesData(VertexBuffer.UVKind) ?? [];
  assert.ok(
    paintUvs.every((value) => value >= 0 && value <= 1),
    "each worn-paint fragment must map the full transparent texture instead of world-space repeats",
  );

  const nextBuilt = buildStreetSurfaceDetails(tile("street-detail-contract-2"), scene);
  for (let index = 0; index < built.meshes.length; index += 1) {
    assert.equal(nextBuilt.meshes[index].material, built.meshes[index].material, "tiles must share detail materials");
  }

  const customSurface = new StandardMaterial("custom-street-surface", scene);
  const customBuilt = buildStreetSurfaceDetails(tile("custom-detail-material"), scene, {
    materials: { surface: customSurface },
  });
  assert.equal(customBuilt.meshes[0].material, customSurface, "callers need a direct custom-material hook");

  assert.ok(STREET_SURFACE_DETAIL_HEIGHTS.parking > 0.052);
  assert.ok(STREET_SURFACE_DETAIL_HEIGHTS.paint > STREET_SURFACE_DETAIL_HEIGHTS.utility);
  assert.ok(STREET_SURFACE_DETAIL_HEIGHTS.treePitSoil < STREET_SURFACE_DETAIL_HEIGHTS.treePitBorder);
  assert.deepEqual(
    buildStreetSurfaceDetails({ ...tile("empty-street-details"), roads: [] }, scene).meshes,
    [],
    "tiles without carriageways must allocate no geometry",
  );

  process.stdout.write(
    "Street surface details valid: source-safe crossing/stop/lane truth table, four deterministic vertex-color batches, road-hugging elevations, transparent repair/paint textures, and furniture exclusions.\n",
  );
} finally {
  scene.dispose();
  engine.dispose();
  await vite.close();
}
