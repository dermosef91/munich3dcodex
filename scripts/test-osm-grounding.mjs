import assert from "node:assert/strict";
import {
  BUILDING_KIND_HEIGHT_PRIORS_METERS,
  CENTRAL_MUNICH_BUILDING_HEIGHT_PRIOR_METERS,
  convert,
  coreQuery,
  createTiles,
  reconstructMultipolygonRelations,
  relationBuildingPartId,
  resolveBuildingHeight,
} from "./fetch-munich-osm.mjs";

const explicitHeight = resolveBuildingHeight({ id: 1, tags: { building: "yes", height: "18.5" } });
assert.deepEqual(explicitHeight, { height: 18.5, heightSource: "osm:height" });
assert.deepEqual(
  resolveBuildingHeight({ id: 2, tags: { building: "yes", "building:levels": "4", "roof:levels": "1" } }),
  { height: 14.4, heightSource: "osm:building-levels" },
);
assert.equal(BUILDING_KIND_HEIGHT_PRIORS_METERS.garage, 3.2);
assert.equal(resolveBuildingHeight({ id: 3, tags: { building: "garage" } }).height, 3.2);
assert.deepEqual(
  resolveBuildingHeight({ id: 4, tags: { building: "apartments" } }),
  resolveBuildingHeight({ id: 987_654_321, tags: { building: "apartments" } }),
  "untagged height must depend on semantic evidence, never the OSM ID",
);
assert.deepEqual(resolveBuildingHeight({ id: 5, tags: { building: "yes" } }), {
  height: CENTRAL_MUNICH_BUILDING_HEIGHT_PRIOR_METERS,
  heightSource: "inferred:central-munich-study-area-prior",
  heightInference: {
    method: "central-munich-study-area-prior",
    basis: "Maxvorstadt/Schwabing urban block",
  },
});

assert.match(coreQuery, /relation\["type"="multipolygon"\]\["building"\]/);
assert.match(coreQuery, /relation\["type"="multipolygon"\]\["leisure"/);
assert.match(coreQuery, /relation\["type"="multipolygon"\]\["landuse"/);
assert.match(coreQuery, /relation\["type"="multipolygon"\]\["natural"/);
assert.match(coreQuery, /relation\["type"="multipolygon"\]\["waterway"/);
assert.match(coreQuery, /out body center geom;/, "relation member geometry requires Overpass body output");

function point(lon, lat) {
  return { lon, lat };
}

const a = point(11.570, 48.150);
const b = point(11.574, 48.150);
const c = point(11.574, 48.154);
const d = point(11.570, 48.154);
const e = point(11.571, 48.151);
const f = point(11.573, 48.151);
const g = point(11.573, 48.153);
const h = point(11.571, 48.153);
const secondOuter = [
  point(11.580, 48.150),
  point(11.582, 48.150),
  point(11.582, 48.152),
  point(11.580, 48.152),
  point(11.580, 48.150),
];

const fragmentedWays = [
  { type: "way", id: 1, geometry: [a, b] },
  { type: "way", id: 2, geometry: [c, b] },
  { type: "way", id: 3, geometry: [c, d] },
  { type: "way", id: 4, geometry: [a, d] },
  { type: "way", id: 5, geometry: [e, f, g] },
  { type: "way", id: 6, geometry: [e, h, g] },
  { type: "way", id: 7, geometry: secondOuter },
  { type: "way", id: 8, geometry: [point(11.585, 48.150), point(11.586, 48.151)] },
];
const fragmentedRelation = {
  type: "relation",
  id: 900,
  tags: { type: "multipolygon", building: "residential" },
  members: [
    { type: "way", ref: 3, role: "outer", geometry: fragmentedWays[2].geometry },
    { type: "way", ref: 1, role: "outer", geometry: fragmentedWays[0].geometry },
    { type: "way", ref: 4, role: "outer", geometry: fragmentedWays[3].geometry },
    // No nested geometry: the standalone way is a supported offline fallback.
    { type: "way", ref: 2, role: "outer" },
    { type: "way", ref: 5, role: "inner", geometry: fragmentedWays[4].geometry },
    { type: "way", ref: 6, role: "inner", geometry: fragmentedWays[5].geometry },
    { type: "way", ref: 7, role: "outer", geometry: secondOuter },
    { type: "way", ref: 8, role: "outer" },
  ],
};
const incompleteRelation = {
  type: "relation",
  id: 901,
  tags: { type: "multipolygon", building: "shed" },
  members: [{ type: "way", ref: 8, role: "outer" }],
};

const reconstructed = reconstructMultipolygonRelations([
  ...fragmentedWays,
  fragmentedRelation,
  incompleteRelation,
]);
const reconstructedParts = reconstructed.parts.filter((part) => part.element.id === 900);
assert.equal(reconstructedParts.length, 2, "every closed outer ring must become a runtime part");
assert.equal(reconstructedParts[0].holes.length, 1, "the inner ring must attach to its containing outer");
assert.equal(reconstructedParts[1].holes.length, 0);
assert.equal(reconstructedParts[0].outer.length, 5, "four reversed/fragmented members must stitch closed");
assert.ok(reconstructed.consumedWayIds.building.has("1"));
assert.ok(reconstructed.consumedWayIds.building.has("7"));
assert.equal(
  reconstructed.consumedWayIds.building.has("8"),
  false,
  "an incomplete outer must not be suppressed even when sibling outers are valid",
);
assert.equal(reconstructed.diagnostics.openOuterChains, 2);
assert.equal(relationBuildingPartId(900, 0), -900_001);
assert.equal(relationBuildingPartId(900, 1), -900_002);
assert.notEqual(relationBuildingPartId(900, 0), relationBuildingPartId(901, 0));
assert.throws(() => relationBuildingPartId(900, 1_000), /unsupported outer-ring ordinal/);

const ORIGIN = { lat: 48.151, lon: 11.572 };
const METERS_PER_DEGREE = 111_320;
const LONGITUDE_SCALE = Math.cos((ORIGIN.lat * Math.PI) / 180);

function worldPoint(x, z) {
  return {
    lon: ORIGIN.lon + x / (METERS_PER_DEGREE * LONGITUDE_SCALE),
    lat: ORIGIN.lat - z / METERS_PER_DEGREE,
  };
}

function closedSquare(minX, minZ, size) {
  return [
    worldPoint(minX, minZ),
    worldPoint(minX + size, minZ),
    worldPoint(minX + size, minZ + size),
    worldPoint(minX, minZ + size),
    worldPoint(minX, minZ),
  ];
}

const buildingOuter = closedSquare(-40, -40, 30);
const buildingInner = closedSquare(-32, -32, 8);
const parkOuter = closedSquare(20, -40, 15);
const waterOuter = closedSquare(50, -40, 15);
const incompleteWay = [worldPoint(-80, -40), worldPoint(-65, -40), worldPoint(-72, -25)];
const conversionFixture = {
  elements: [
    { type: "way", id: 100, tags: { building: "apartments" }, geometry: buildingOuter },
    { type: "way", id: 101, geometry: buildingInner },
    { type: "way", id: 300, tags: { leisure: "park" }, geometry: parkOuter },
    { type: "way", id: 500, tags: { natural: "water" }, geometry: waterOuter },
    { type: "way", id: 700, tags: { building: "shed" }, geometry: incompleteWay },
    {
      type: "relation",
      id: 200,
      tags: { type: "multipolygon", building: "apartments", name: "Courtyard block" },
      members: [
        { type: "way", ref: 100, role: "outer" },
        { type: "way", ref: 101, role: "inner" },
      ],
    },
    {
      type: "relation",
      id: 400,
      tags: { type: "multipolygon", leisure: "park", name: "Relation park" },
      members: [{ type: "way", ref: 300, role: "outer" }],
    },
    {
      type: "relation",
      id: 600,
      tags: { type: "multipolygon", natural: "water", name: "Relation pond" },
      members: [{ type: "way", ref: 500, role: "outer" }],
    },
    {
      type: "relation",
      id: 800,
      tags: { type: "multipolygon", building: "shed" },
      members: [{ type: "way", ref: 700, role: "outer" }],
    },
  ],
};

const tiles = createTiles();
convert(conversionFixture, tiles);
const buildings = [...tiles.values()].flatMap((tile) => tile.buildings);
const greens = [...tiles.values()].flatMap((tile) => tile.greens);
assert.equal(buildings.length, 2, "valid relation plus incomplete member-way fallback should be emitted once each");
const courtyard = buildings.find((building) => building.sourceId === "osm:relation/200");
assert.ok(courtyard, "the relation, not its duplicate outer member way, must own the building");
assert.equal(buildings.some((building) => building.sourceId === "osm:way/100"), false);
assert.equal(courtyard.id, relationBuildingPartId(200, 0));
assert.equal(courtyard.holes.length, 1);
assert.equal(courtyard.holes[0].length, 4);
assert.equal(courtyard.height, 14);
assert.equal(courtyard.heightSource, "inferred:building-kind-prior");
assert.equal(courtyard.heightInference.basis, "building=apartments");
assert.deepEqual(courtyard.multipolygon, { relationId: 200, outerOrdinal: 0, outerCount: 1 });
assert.deepEqual(courtyard.sourceRefs, [{
  dataset: "OpenStreetMap",
  id: "relation/200",
  license: "ODbL-1.0",
  observedAt: undefined,
}]);
assert.ok(buildings.some((building) => building.sourceId === "osm:way/700"));

assert.equal(greens.length, 2, "green/water member ways must not duplicate their relations");
const relationPark = greens.find((green) => green.sourceId === "osm:relation/400");
const relationWater = greens.find((green) => green.sourceId === "osm:relation/600");
assert.equal(relationPark.kind, "green");
assert.equal(relationPark.subtype, "park");
assert.equal(relationPark.id, "relation/400:outer/0");
assert.equal(relationWater.kind, "water");
assert.equal(relationWater.subtype, "water");
assert.equal(greens.some((green) => green.sourceId === "osm:way/300"), false);
assert.equal(greens.some((green) => green.sourceId === "osm:way/500"), false);

process.stdout.write(
  "OSM grounding valid: semantic height priors, provenance, multipolygon stitching/holes, unique relation IDs, and member-way deduplication.\n",
);
