import assert from "node:assert/strict";
import {
  MUNICH_ORIGIN,
  MUNICH_PARKING_DATASET,
  MUNICH_PARKING_LICENSE,
  allocateCapacityAcrossPieces,
  buildMunichParkingWfsUrl,
  groupParkingRowsByTile,
  parkingEligibility,
  parseMunichParkingGeoJson,
  projectWgs84ToWorld,
  splitLineStringByTiles,
} from "./lib/munich-parking.mjs";

const METERS_PER_DEGREE = 111_320;
const longitudeScale = Math.cos((MUNICH_ORIGIN.lat * Math.PI) / 180);

function worldToWgs84([x, z]) {
  return [
    MUNICH_ORIGIN.lon + x / (METERS_PER_DEGREE * longitudeScale),
    MUNICH_ORIGIN.lat - z / METERS_PER_DEGREE,
  ];
}

function feature(id, points, angebot, overrides = {}) {
  return {
    type: "Feature",
    id,
    geometry: { type: "LineString", coordinates: points.map(worldToWgs84) },
    properties: {
      angebot: String(angebot),
      parkregel_beschreibung: "Mischparken 9-23 Uhr",
      parkregel_gruppe: "Mischparken",
      parkregel_id: 24,
      parkregel_name: "M 9-23",
      prm_name: "West Schwabing",
      strasse: "Elisabethstr.",
      geoportal_class: "Mischparken",
      ...overrides,
    },
  };
}

const requestUrl = new URL(buildMunichParkingWfsUrl({
  west: 11.56,
  south: 48.134,
  east: 11.59,
  north: 48.17,
}, { count: 250, startIndex: 500 }));
assert.equal(requestUrl.searchParams.get("version"), "2.0.0");
assert.equal(requestUrl.searchParams.get("typeNames"), "mor_wfs:ruhver_parkseiten_line");
assert.equal(requestUrl.searchParams.get("srsName"), "EPSG:4326");
assert.equal(requestUrl.searchParams.get("bbox"), "11.56,48.134,11.59,48.17,EPSG:4326");
assert.equal(requestUrl.searchParams.get("count"), "250");
assert.equal(requestUrl.searchParams.get("startIndex"), "500");

assert.deepEqual(projectWgs84ToWorld([MUNICH_ORIGIN.lon, MUNICH_ORIGIN.lat]), [0, 0]);
const east = projectWgs84ToWorld([MUNICH_ORIGIN.lon + 0.001, MUNICH_ORIGIN.lat]);
const north = projectWgs84ToWorld([MUNICH_ORIGIN.lon, MUNICH_ORIGIN.lat + 0.001]);
assert.ok(east[0] > 74 && east[0] < 75, "longitude must project east onto positive X");
assert.ok(north[1] < -111 && north[1] > -112, "latitude must project north onto negative Z");

assert.deepEqual(parkingEligibility({ angebot: "12", parkregel_gruppe: "Mischparken" }), {
  eligible: true,
  capacity: 12,
});
assert.deepEqual(parkingEligibility({ angebot: "0", parkregel_gruppe: "Mischparken" }), {
  eligible: false,
  reason: "invalid_capacity",
});
assert.equal(parkingEligibility({
  angebot: "3",
  parkregel_gruppe: "Absolutes Halteverbot (0-24 Uhr)",
}).reason, "non_parkable_rule");
assert.equal(parkingEligibility({
  angebot: "3",
  geoportal_class: "Eingeschränktes Halteverbot (0-24 Uhr)",
}).reason, "non_parkable_rule");
assert.equal(parkingEligibility({ angebot: "2", parkregel_gruppe: "Baustelle" }).eligible, false);
assert.deepEqual(parkingEligibility({
  angebot: "7",
  parkregel_gruppe: "Eingeschränktes Halteverbot temporär",
  parkregel_beschreibung: "Eingeschränktes Halteverbot 7-18 Uhr, sonst Mischparken",
}), { eligible: true, capacity: 7 });

const crossing = splitLineStringByTiles([[490, 10], [510, 10]]);
assert.equal(crossing.length, 2);
assert.deepEqual(crossing.map((piece) => piece.tileId), ["0_0", "1_0"]);
assert.deepEqual(crossing[0].points, [[490, 10], [500, 10]]);
assert.deepEqual(crossing[1].points, [[500, 10], [510, 10]]);
assert.equal(crossing[0].sourceStartMeters, 0);
assert.equal(crossing[1].sourceStartMeters, 10);
assert.deepEqual(
  allocateCapacityAcrossPieces(3, crossing),
  [1, 2],
  "the bay centered exactly at x=500 belongs to the later half-open piece",
);

const negativeCrossing = splitLineStringByTiles([[-510, -10], [-490, -10]]);
assert.deepEqual(negativeCrossing.map((piece) => piece.tileId), ["-2_-1", "-1_-1"]);
assert.deepEqual(negativeCrossing[0].points.at(-1), [-500, -10]);
assert.deepEqual(negativeCrossing[1].points[0], [-500, -10]);

const cornerCrossing = splitLineStringByTiles([[490, 490], [510, 510]]);
assert.deepEqual(cornerCrossing.map((piece) => piece.tileId), ["0_0", "1_1"]);
assert.deepEqual(cornerCrossing[0].points.at(-1), [500, 500]);

const fixture = {
  type: "FeatureCollection",
  crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::4326" } },
  timeStamp: "2026-07-14T12:00:00Z",
  features: [
    feature("ruhver_parkseiten_line.1", [[490, 10], [510, 10]], 3),
    feature("ruhver_parkseiten_line.2", [[-40, -10], [-20, -10]], 2, {
      parkregel_gruppe: "Eingeschränktes Halteverbot temporär",
      parkregel_beschreibung: "Eingeschränktes Halteverbot 7-18 Uhr, sonst Mischparken",
      geoportal_class: "Eingeschränktes Halteverbot (auch temporär)",
    }),
    feature("ruhver_parkseiten_line.3", [[20, 20], [40, 20]], 4, {
      parkregel_gruppe: "Absolutes Halteverbot (0-24 Uhr)",
      parkregel_beschreibung: "Absolutes Halteverbot 0-24 Uhr",
      geoportal_class: "Absolutes Halteverbot",
    }),
    feature("ruhver_parkseiten_line.4", [[20, 40], [40, 40]], 0),
    {
      type: "Feature",
      id: "ruhver_parkseiten_line.5",
      geometry: { type: "Polygon", coordinates: [] },
      properties: { angebot: "3", parkregel_gruppe: "Mischparken" },
    },
  ],
};

const parsed = parseMunichParkingGeoJson(fixture);
assert.equal(parsed.rows.length, 3);
assert.equal(parsed.stats.features, 5);
assert.equal(parsed.stats.sourceRows, 2);
assert.equal(parsed.stats.sourceCapacity, 5);
assert.equal(parsed.stats.allocatedCapacity, 5);
assert.equal(parsed.stats.skipped, 3);
assert.deepEqual(parsed.stats.skippedByReason, {
  invalid_capacity: 1,
  invalid_geometry_type: 1,
  non_parkable_rule: 1,
});
assert.deepEqual(parsed.skipped.map((entry) => entry.reason), [
  "non_parkable_rule",
  "invalid_capacity",
  "invalid_geometry_type",
]);

const splitRows = parsed.rows.filter((row) => row.sourceId === "ruhver_parkseiten_line.1");
assert.deepEqual(splitRows.map((row) => row.tileId), ["0_0", "1_0"]);
assert.deepEqual(splitRows.map((row) => row.capacity), [1, 2]);
assert.ok(splitRows.every((row) => row.sourceCapacity === 3));
assert.deepEqual(splitRows.map((row) => row.sourceStartMeters), [0, 10]);
assert.ok(splitRows.every((row) => row.sourceLengthMeters === 20));
assert.deepEqual(splitRows[0].points, [[490, 10], [500, 10]]);
assert.equal(splitRows[0].street, "Elisabethstr.");
assert.deepEqual(splitRows[0].regulation, {
  id: 24,
  name: "M 9-23",
  description: "Mischparken 9-23 Uhr",
  group: "Mischparken",
  classification: "Mischparken",
  area: "West Schwabing",
});
assert.deepEqual(splitRows[0].sourceRefs, [{
  dataset: MUNICH_PARKING_DATASET,
  id: "ruhver_parkseiten_line.1",
  license: MUNICH_PARKING_LICENSE,
}]);

const grouped = groupParkingRowsByTile(parsed.rows);
assert.deepEqual([...grouped.keys()], ["0_0", "1_0", "-1_-1"]);
assert.equal(grouped.get("0_0").length, 1);
assert.equal(grouped.get("-1_-1")[0].capacity, 2);

assert.throws(
  () => parseMunichParkingGeoJson({
    ...fixture,
    crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::25832" } },
  }),
  /Expected WGS84 GeoJSON/,
  "native WFS coordinates must not silently pass through the WGS84 projector",
);

process.stdout.write(
  "Municipal parking ingestion valid: WGS84 projection, eligibility, tile clipping, exact capacity allocation, and provenance.\n",
);
