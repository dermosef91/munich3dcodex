import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const vite = await createServer({
  root,
  appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false },
});

function tile(id, overrides = {}) {
  return {
    id,
    center: [0, 0],
    buildings: [],
    roads: [],
    greens: [],
    parking: [],
    parkingRows: [],
    ...overrides,
  };
}

function row(overrides = {}) {
  return {
    id: "parking-row:test:0",
    sourceId: "parking-row:test",
    tileId: "0_0",
    points: [[0, 0], [20, 0]],
    capacity: 3,
    sourceCapacity: 3,
    sourceStartMeters: 0,
    sourceLengthMeters: 20,
    regulation: {},
    sourceRefs: [],
    ...overrides,
  };
}

function parkingFeature(overrides = {}) {
  return {
    id: "way/parking-test",
    kind: "parking",
    point: [10, 5],
    outline: [[0, 0], [20, 0], [20, 10], [0, 10]],
    sourceRefs: [],
    ...overrides,
  };
}

function roadFeature(overrides = {}) {
  return {
    points: [[0, 20], [20, 20]],
    width: 6,
    kind: "residential",
    sourceId: "osm:way/road-test",
    parking: { left: { position: "lane", orientation: "parallel" } },
    ...overrides,
  };
}

try {
  const {
    deriveParkingLayout,
    distanceToPolyline,
    parkingConflictsWithPedestrian,
    parkingLayoutContainsPoint,
    parkingSlotContainsPoint,
    parkingSurfaceContainsPoint,
    pointInPolygon,
  } = await vite.ssrLoadModule("/src/world/parkingLayout.ts");

  assert.equal(pointInPolygon([1, 1], [[0, 0], [2, 0], [2, 2], [0, 2]]), true);
  assert.equal(pointInPolygon([0, 1], [[0, 0], [2, 0], [2, 2], [0, 2]]), true,
    "polygon boundaries must count as visible parking geometry");
  assert.equal(pointInPolygon([3, 1], [[0, 0], [2, 0], [2, 2], [0, 2]]), false);
  assert.equal(distanceToPolyline([5, 3], [[0, 0], [10, 0]]), 3);

  const seamLeft = deriveParkingLayout(tile("0_0", {
    parkingRows: [row({
      id: "parking-row:seam:0_0:0",
      sourceId: "parking-row:seam",
      points: [[0, 0], [10, 0]],
      capacity: 1,
      sourceCapacity: 3,
      sourceStartMeters: 0,
      sourceLengthMeters: 20,
    })],
  }));
  const seamRight = deriveParkingLayout(tile("1_0", {
    parkingRows: [row({
      id: "parking-row:seam:1_0:1",
      sourceId: "parking-row:seam",
      tileId: "1_0",
      points: [[10, 0], [20, 0]],
      capacity: 2,
      sourceCapacity: 3,
      sourceStartMeters: 10,
      sourceLengthMeters: 20,
    })],
  }));
  assert.deepEqual(
    seamLeft.slots.map((slot) => slot.id),
    ["parking-slot:municipal:parking-row:seam:0"],
  );
  assert.deepEqual(
    seamRight.slots.map((slot) => slot.id),
    [
      "parking-slot:municipal:parking-row:seam:1",
      "parking-slot:municipal:parking-row:seam:2",
    ],
    "the globally phased center on the seam must belong only to the later half-open piece",
  );
  assert.deepEqual(seamRight.slots[0].point, [10, 0]);
  assert.deepEqual(seamRight.slots[0].tangent, [1, 0]);
  assert.equal(
    new Set([...seamLeft.slots, ...seamRight.slots].map((slot) => slot.id)).size,
    3,
    "tile pieces must not duplicate stable source-wide slot IDs",
  );
  for (const layout of [seamLeft, seamRight]) {
    for (const slot of layout.slots) {
      const surface = layout.surfaces.find((candidate) => candidate.id === slot.surfaceId);
      assert.ok(surface);
      assert.equal(parkingSlotContainsPoint(slot, surface), true);
    }
  }

  const preferredMunicipal = row({
    id: "parking-row:preferred:0",
    sourceId: "parking-row:preferred",
    points: [[0, -1.95], [30, -1.95]],
    capacity: 5,
    sourceCapacity: 5,
    sourceLengthMeters: 30,
  });
  const precedence = deriveParkingLayout(tile("precedence", {
    parkingRows: [preferredMunicipal],
    parking: [parkingFeature({
      id: "node/exact-duplicate",
      kind: "parking_space",
      point: [9, -1.95],
      outline: undefined,
    })],
    roads: [roadFeature({
      points: [[0, 0], [30, 0]],
      sourceId: "osm:way/covered-road",
    })],
  }));
  assert.equal(precedence.slots.length, 5);
  assert.ok(precedence.slots.every((slot) => slot.source === "municipal-row"));
  assert.equal(
    precedence.surfaces.some((surface) => surface.source === "osm-road-side"),
    false,
    "OSM curb fallback must disappear when municipal coverage spans the source",
  );
  assert.equal(
    precedence.surfaces.some((surface) => surface.source === "osm-parking-space"),
    true,
    "the exact OSM footprint remains renderable even when its coincident slot is deduplicated",
  );

  const joinedFallback = deriveParkingLayout(tile("joined", {
    roads: [
      roadFeature({ points: [[0, 20], [10, 20]] }),
      roadFeature({ points: [[10, 20], [20, 20]] }),
    ],
  }));
  const fallbackSlots = joinedFallback.slots.filter((slot) => slot.source === "osm-road-side");
  assert.equal(fallbackSlots.length, 3,
    "two source-way edges must be joined before source-level slot sampling");
  assert.equal(
    joinedFallback.surfaces.filter((surface) => surface.source === "osm-road-side").length,
    1,
    "shared road endpoints must not create duplicate fallback ribbons",
  );
  assert.ok(joinedFallback.surfaces
    .filter((surface) => surface.source === "osm-road-side")
    .every((surface) => surface.width >= 2.4));
  assert.deepEqual(
    deriveParkingLayout(tile("joined", {
      roads: [
        roadFeature({ points: [[10, 20], [20, 20]] }),
        roadFeature({ points: [[0, 20], [10, 20]] }),
      ],
    })),
    joinedFallback,
    "road input order must not affect canonical surfaces or slot IDs",
  );

  const restricted = deriveParkingLayout(tile("restricted", {
    roads: [
      roadFeature({ sourceId: "osm:way/no-position", parking: { left: { position: "no" } } }),
      roadFeature({
        sourceId: "osm:way/no-stopping",
        parking: { left: { position: "lane", condition: "no_stopping @ (Mo-Fr 08:00-18:00)" } },
      }),
      roadFeature({ sourceId: "osm:way/private", access: "private" }),
    ],
  }));
  assert.deepEqual(restricted, { slots: [], surfaces: [], exclusions: [] });

  const crossingTile = tile("crossing", {
    roads: [
      roadFeature({ points: [[0, 40], [20, 40]], sourceId: "osm:way/crossing-road" }),
      {
        points: [[10, 30], [10, 50]],
        width: 2,
        kind: "footway",
        footway: "crossing",
      },
      {
        points: [[15, 30], [15, 50]],
        width: 2,
        kind: "footway",
        footway: "sidewalk",
      },
    ],
  });
  assert.equal(parkingConflictsWithPedestrian(crossingTile, [10, 38.05], 2.5), true);
  assert.equal(parkingConflictsWithPedestrian(crossingTile, [15, 38.05], 0), false,
    "an explicit sidewalk centerline must not be treated as a crossing exclusion");
  const crossingLayout = deriveParkingLayout(crossingTile, { pedestrianClearanceMeters: 2.5 });
  assert.equal(crossingLayout.slots.filter((slot) => slot.source === "osm-road-side").length, 2,
    "the center slot whose vehicle length reaches the crossing must be removed");

  const offStreet = deriveParkingLayout(tile("off-street", {
    parking: [
      parkingFeature({ id: "way/area", capacity: 4 }),
      parkingFeature({
        id: "way/exact-space",
        kind: "parking_space",
        point: [32.5, 1.25],
        outline: [[30, 0], [35, 0], [35, 2.5], [30, 2.5]],
      }),
      parkingFeature({
        id: "node/point-space",
        kind: "parking_space",
        point: [40, 5],
        outline: undefined,
      }),
      parkingFeature({ id: "way/private", access: "private" }),
      parkingFeature({ id: "way/underground", parking: "underground" }),
    ],
  }));
  assert.equal(offStreet.slots.filter((slot) => slot.source === "osm-parking-area").length, 4);
  assert.equal(offStreet.slots.filter((slot) => slot.source === "osm-parking-space").length, 2);
  assert.equal(offStreet.surfaces.length, 3);
  for (const slot of offStreet.slots) {
    const surface = offStreet.surfaces.find((candidate) => candidate.id === slot.surfaceId);
    assert.ok(surface, `missing surface ${slot.surfaceId}`);
    assert.equal(parkingSlotContainsPoint(slot, surface), true, `${slot.id} must belong to its visible geometry`);
  }
  assert.equal(parkingLayoutContainsPoint(offStreet, [10, 5]), true);
  assert.equal(parkingLayoutContainsPoint(offStreet, [100, 100]), false);
  const pointSurface = offStreet.surfaces.find((surface) => surface.sourceId === "node/point-space");
  assert.ok(pointSurface && pointSurface.kind === "polygon");
  assert.equal(parkingSurfaceContainsPoint(pointSurface, [40, 5]), true,
    "point-only exact spaces must receive a renderable footprint");

  const exclusion = {
    id: "crossing-triangle",
    reason: "pedestrian-crossing",
    outline: [[13, -2], [17, -2], [15, 2]],
  };
  const excluded = deriveParkingLayout(tile("excluded", {
    parkingRows: [row({
      id: "parking-row:excluded:0",
      sourceId: "parking-row:excluded",
      points: [[0, 0], [30, 0]],
      capacity: 3,
      sourceCapacity: 3,
      sourceLengthMeters: 30,
    })],
  }), { exclusions: [exclusion] });
  assert.equal(excluded.slots.length, 2);
  assert.deepEqual(excluded.exclusions, [exclusion]);
  assert.equal(parkingSurfaceContainsPoint(excluded.surfaces[0], [15, 0]), true,
    "base source ribbons remain available for renderer-side clipping");
  assert.equal(parkingLayoutContainsPoint(excluded, [15, 0]), false,
    "layout membership must honor the same exclusion consumed by rendering");

  assert.deepEqual(
    deriveParkingLayout(tile("off-street-repeat", { parking: [parkingFeature()] })),
    deriveParkingLayout(tile("off-street-repeat", { parking: [parkingFeature()] })),
    "canonical layout generation must be byte-for-byte deterministic",
  );

  process.stdout.write(
    "Parking layout valid: source-wide seams, precedence, restrictions, pedestrian clearance, visible membership, and deterministic OSM fallbacks.\n",
  );
} finally {
  await vite.close();
}
