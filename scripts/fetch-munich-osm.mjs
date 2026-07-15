import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assignBusinessFrontages } from "./lib/assign-business-frontages.mjs";
import {
  MUNICH_PARKING_DATASET,
  MUNICH_PARKING_LICENSE,
  buildMunichParkingWfsUrl,
  groupParkingRowsByTile,
  parseMunichParkingGeoJson,
} from "./lib/munich-parking.mjs";
import {
  DEFAULT_TREE_ROW_SPACING_METERS,
  PointProximityIndex,
  sampleTreeRow,
} from "./lib/tree-rows.mjs";
import {
  DEFAULT_STREET_TREE_END_CLEARANCE_METERS,
  DEFAULT_STREET_TREE_SPACING_METERS,
  isNearPolygonObstacle,
  polygonObstacle,
  sampleStreetTreeCorridor,
} from "./lib/street-tree-corridors.mjs";

const root = path.resolve(import.meta.dirname, "..");
const cacheFile = path.join(root, "data", "cache", "munich-overpass.json");
const parkingCacheFile = path.join(root, "data", "cache", "munich-parkseiten.geojson");
const outputDirectory = path.join(root, "public", "data");
const tileDirectory = path.join(outputDirectory, "tiles");

const origin = { lat: 48.151, lon: 11.572 };
const bounds = { south: 48.134, west: 11.560, north: 48.170, east: 11.590 };
const tileSize = 500;
const metersPerDegree = 111_320;
const longitudeScale = Math.cos((origin.lat * Math.PI) / 180);
const treeRowMappedPointDeduplicationRadius = 2.5;
const treeRowOverlapDeduplicationRadius = 0.5;
const treeRowIdStride = 10_000;
const streetTreeCorridorNames = new Set(["Elisabethstraße"]);
const streetTreeSetbackBeyondRoadMeters = 2.5;
const streetTreeKnownTreeDeduplicationRadius = 6;
const streetTreeOverlapDeduplicationRadius = 6;
const streetTreeBuildingClearanceMeters = 1.25;
const streetTreeIdBase = 2_000_000_000_000_000;
const streetTreeIdStride = 100_000;
const osmRelationPartIdStride = 1_000;

// Overpass body output is required because tags-only relation output omits the
// member list needed to reconstruct multipolygon geometry.
export const coreQuery = `[out:json][timeout:300][maxsize:536870912];
(
  way["building"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  relation["type"="multipolygon"]["building"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  way["highway"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  way["railway"~"^(tram|light_rail)$"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  way["leisure"~"^(park|garden|playground)$"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  relation["type"="multipolygon"]["leisure"~"^(park|garden|playground)$"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  way["landuse"~"^(grass|forest|meadow|recreation_ground)$"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  relation["type"="multipolygon"]["landuse"~"^(grass|forest|meadow|recreation_ground)$"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  way["natural"~"^(wood|water)$"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  relation["type"="multipolygon"]["natural"~"^(wood|water)$"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  way["natural"="tree_row"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  way["waterway"~"^(riverbank|canal)$"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  relation["type"="multipolygon"]["waterway"~"^(riverbank|canal)$"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  node["natural"="tree"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  node["highway"="street_lamp"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  node["amenity"="bench"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  nwr["amenity"="parking"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  nwr["shop"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  nwr["amenity"~"^(restaurant|cafe|bar|pub|fast_food|ice_cream|pharmacy|bank)$"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  nwr["craft"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  nwr["tourism"~"^(hotel|hostel)$"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  nwr["leisure"="fitness_centre"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
);
out body center geom;`;

// Exact parking bays are numerous and make the already large city query prone
// to gateway timeouts. Fetch them separately, then merge by stable OSM ID.
const parkingSpaceQuery = `[out:json][timeout:300][maxsize:536870912];
(
  node["amenity"="parking_space"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
  way["amenity"="parking_space"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
);
out tags center geom;`;

function project(point) {
  return [
    (point.lon - origin.lon) * metersPerDegree * longitudeScale,
    -(point.lat - origin.lat) * metersPerDegree,
  ];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function pointWithinBounds([x, z]) {
  const lon = origin.lon + x / (metersPerDegree * longitudeScale);
  const lat = origin.lat - z / metersPerDegree;
  return lon >= bounds.west && lon <= bounds.east && lat >= bounds.south && lat <= bounds.north;
}

function cleanPoints(geometry = []) {
  const points = geometry
    .filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat))
    .map(project)
    .map(([x, z]) => [round(x), round(z)]);
  if (points.length > 1) {
    const last = points[points.length - 1];
    const previous = points[points.length - 2];
    if (last[0] === previous[0] && last[1] === previous[1]) points.pop();
  }
  return points;
}

function parseMeters(value) {
  if (!value) return null;
  const parsed = Number.parseFloat(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveMeters(value) {
  const parsed = parseMeters(value);
  return parsed !== null && parsed > 0 ? parsed : undefined;
}

function parseCount(value) {
  const parsed = parseMeters(value);
  return parsed !== null && parsed >= 0 ? Math.round(parsed) : undefined;
}

function parsePositiveCount(value) {
  const parsed = parseCount(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function parseBoolean(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["yes", "true", "1"].includes(normalized)) return true;
  if (["no", "false", "0"].includes(normalized)) return false;
  return undefined;
}

function parseDirection(value) {
  const parsed = parseMeters(value);
  if (parsed === null) return undefined;
  return round(((parsed % 360) + 360) % 360);
}

function parseOneway(tags = {}) {
  const normalized = String(tags.oneway ?? "").trim().toLowerCase();
  if (["yes", "true", "1"].includes(normalized)) return 1;
  if (normalized === "-1" || normalized === "reverse") return -1;
  if (["no", "false", "0"].includes(normalized)) return 0;
  if (!normalized && (tags.junction === "roundabout" || tags.highway === "motorway")) return 1;
  return undefined;
}

function parseMaxSpeedKph(value) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim().toLowerCase().split(";")[0].trim();
  const aliases = {
    walk: 7,
    "de:urban": 50,
    "de:rural": 100,
  };
  if (aliases[normalized]) return aliases[normalized];
  const parsed = Number.parseFloat(normalized.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return round(/mph\b/.test(normalized) ? parsed * 1.609_344 : parsed);
}

function osmSourceReference(element) {
  const tags = element.tags ?? {};
  return {
    dataset: "OpenStreetMap",
    id: `${element.type}/${element.id}`,
    license: "ODbL-1.0",
    observedAt: tags.check_date ?? tags["survey:date"],
  };
}

function deterministicTreeHeight(id) {
  return 7 + ((Math.abs(id) * 13) % 8);
}

function deterministicTreeRowHeight(id) {
  let value = Math.trunc(Math.abs(id)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return 7 + ((value ^ (value >>> 16)) >>> 0) % 8;
}

function treeRowSpacing(tags = {}) {
  const tagged = parseMeters(
    tags.spacing
      ?? tags.tree_spacing
      ?? tags["tree_row:spacing"]
      ?? tags.average_distance,
  );
  return tagged && tagged >= 2 ? tagged : DEFAULT_TREE_ROW_SPACING_METERS;
}

function inferredTreeRowId(wayId, ordinal) {
  const id = -(Number(wayId) * treeRowIdStride + ordinal + 1);
  if (!Number.isSafeInteger(id)) throw new Error(`Tree-row way ${wayId} cannot produce a safe numeric id`);
  return id;
}

function inferredStreetTreeId(wayId, side, ordinal) {
  const sideOffset = side === "left" ? 0 : 10_000;
  const id = -(streetTreeIdBase + Number(wayId) * streetTreeIdStride + sideOffset + ordinal + 1);
  if (!Number.isSafeInteger(id)) throw new Error(`Street corridor way ${wayId} cannot produce a safe numeric id`);
  return id;
}

// These priors are intentionally coarse and semantic rather than keyed to an
// OSM ID. They distinguish low accessory/single-storey structures from the
// multi-storey urban fabric without pretending to be surveyed measurements.
export const BUILDING_KIND_HEIGHT_PRIORS_METERS = Object.freeze({
  apartments: 14,
  bungalow: 4,
  cabin: 4,
  carport: 3,
  cathedral: 28,
  chapel: 10,
  church: 20,
  civic: 14,
  commercial: 14,
  detached: 10,
  dormitory: 14,
  garage: 3.2,
  garages: 3.2,
  greenhouse: 4,
  hospital: 16,
  hotel: 16,
  house: 10,
  hut: 3.2,
  industrial: 9,
  kindergarten: 8,
  kiosk: 4,
  office: 16,
  public: 14,
  residential: 14,
  retail: 8,
  roof: 3,
  school: 14,
  semidetached_house: 10,
  shed: 3.2,
  terrace: 11,
  train_station: 14,
  university: 16,
  warehouse: 9,
});

// Untyped buildings in this compact Maxvorstadt/Schwabing study area default
// to a representative four-storey, circa-14 m urban block. This single named
// district prior replaces the former arbitrary 10-21 m OSM-ID variation.
export const CENTRAL_MUNICH_BUILDING_HEIGHT_PRIOR_METERS = 14;

export function resolveBuildingHeight(element) {
  const explicit = parsePositiveMeters(element.tags?.height);
  if (explicit !== undefined) {
    return {
      height: Math.min(100, Math.max(2.5, explicit)),
      heightSource: "osm:height",
    };
  }
  const levels = parsePositiveMeters(element.tags?.["building:levels"]);
  const roofLevels = parseMeters(element.tags?.["roof:levels"]) ?? 0;
  if (levels !== undefined) {
    return {
      height: Math.min(80, Math.max(3, levels * 3.15 + Math.max(0, roofLevels) * 1.8)),
      heightSource: "osm:building-levels",
    };
  }

  const kind = String(element.tags?.building ?? "").trim().toLowerCase().split(";")[0];
  const kindPrior = BUILDING_KIND_HEIGHT_PRIORS_METERS[kind];
  if (kindPrior !== undefined) {
    return {
      height: kindPrior,
      heightSource: "inferred:building-kind-prior",
      heightInference: {
        method: "building-kind-prior",
        basis: `building=${kind}`,
      },
    };
  }
  return {
    height: CENTRAL_MUNICH_BUILDING_HEIGHT_PRIOR_METERS,
    heightSource: "inferred:central-munich-study-area-prior",
    heightInference: {
      method: "central-munich-study-area-prior",
      basis: "Maxvorstadt/Schwabing urban block",
    },
  };
}

function buildingMetadata(element) {
  const tags = element.tags ?? {};
  const street = tags["addr:street"];
  const houseNumber = tags["addr:housenumber"];
  const address = [street, houseNumber].filter(Boolean).join(" ") || undefined;
  const levels = parseMeters(tags["building:levels"]);
  const roofLevels = parseMeters(tags["roof:levels"]);
  return {
    source: "osm",
    sourceId: `osm:${element.type}/${element.id}`,
    sourceRefs: [osmSourceReference(element)],
    kind: tags.building === "yes" ? undefined : tags.building,
    levels: levels ? Math.max(1, Math.round(levels)) : undefined,
    roofLevels: roofLevels ? Math.max(0, Math.round(roofLevels)) : undefined,
    roofShape: tags["roof:shape"],
    wallMaterial: tags["building:material"] ?? tags["facade:material"],
    wallColor: tags["building:colour"] ?? tags["facade:colour"],
    roofMaterial: tags["roof:material"],
    roofColor: tags["roof:colour"],
    startDate: tags.start_date,
    heritage: Boolean(tags.heritage || tags.historic || tags["heritage:operator"]),
    address,
    name: tags.name,
  };
}

function formattedAddress(tags = {}) {
  const street = tags["addr:street"];
  const houseNumber = tags["addr:housenumber"];
  return [street, houseNumber].filter(Boolean).join(" ") || undefined;
}

function businessCategory(tags = {}) {
  const amenity = tags.amenity;
  const shop = tags.shop;
  if (amenity === "restaurant" || amenity === "fast_food") return "restaurant";
  if (amenity === "cafe" || amenity === "ice_cream") return "cafe";
  if (amenity === "bar" || amenity === "pub") return "bar";
  if (amenity === "pharmacy" || shop === "chemist") return "pharmacy";
  if (["bakery", "confectionery", "pastry"].includes(shop)) return "bakery";
  if (["supermarket", "convenience", "greengrocer", "butcher", "deli", "beverages", "organic"].includes(shop)) return "grocery";
  if (shop) {
    if (["hairdresser", "beauty", "laundry", "dry_cleaning", "optician", "hearing_aids", "travel_agency", "repair"].includes(shop)) return "service";
    return "retail";
  }
  return "service";
}

function isBusiness(tags = {}) {
  return Boolean(
    tags.shop
      || tags.craft
      || ["restaurant", "cafe", "bar", "pub", "fast_food", "ice_cream", "pharmacy", "bank"].includes(tags.amenity)
      || ["hotel", "hostel"].includes(tags.tourism)
      || tags.leisure === "fitness_centre",
  );
}

function elementPoint(element) {
  if (Number.isFinite(element.lon) && Number.isFinite(element.lat)) return project(element);
  if (Number.isFinite(element.center?.lon) && Number.isFinite(element.center?.lat)) return project(element.center);
  const geometry = element.geometry?.filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat)) ?? [];
  if (geometry.length === 0) return null;
  const center = geometry.reduce(
    (sum, point) => ({ lon: sum.lon + point.lon / geometry.length, lat: sum.lat + point.lat / geometry.length }),
    { lon: 0, lat: 0 },
  );
  return project(center);
}

function businessFeature(element) {
  const tags = element.tags ?? {};
  if (["vacant", "empty", "closed"].includes(tags.shop)) return null;
  const level = String(tags.level ?? "").trim();
  if (level && !["0", "0.0", "ground", "street"].includes(level)) return null;
  const name = tags.name ?? tags.brand ?? tags.operator;
  const point = elementPoint(element);
  if (!isBusiness(tags) || !name || !point) return null;
  const subtype = tags.shop ?? tags.amenity ?? tags.craft ?? tags.tourism ?? tags.leisure;
  return {
    id: `${element.type}/${element.id}`,
    point: point.map(round),
    name,
    category: businessCategory(tags),
    subtype,
    brand: tags.brand,
    address: formattedAddress(tags),
    cuisine: tags.cuisine,
    openingHours: tags.opening_hours,
    checkDate: tags.check_date ?? tags["survey:date"],
    sourceRefs: [osmSourceReference(element)],
  };
}

const PARKING_ORIENTATIONS = new Set(["parallel", "diagonal", "perpendicular"]);

function roadParkingSide(tags, side) {
  const legacy = tags[`parking:lane:${side}`];
  const position = tags[`parking:${side}`]
    ?? (legacy && !PARKING_ORIENTATIONS.has(legacy) ? legacy : legacy ? "lane" : undefined);
  const orientation = tags[`parking:${side}:orientation`]
    ?? (legacy && PARKING_ORIENTATIONS.has(legacy) ? legacy : undefined);
  const restriction = tags[`parking:${side}:restriction`];
  const condition = tags[`parking:condition:${side}`];
  if (!position && !orientation && !restriction && !condition) return undefined;
  return { position, orientation, restriction, condition };
}

function roadParking(tags = {}) {
  const result = {
    left: roadParkingSide(tags, "left"),
    right: roadParkingSide(tags, "right"),
    both: roadParkingSide(tags, "both"),
  };
  return result.left || result.right || result.both ? result : undefined;
}

function roadMetadata(element) {
  const tags = element.tags ?? {};
  return {
    sourceId: `osm:${element.type}/${element.id}`,
    sourceRefs: [osmSourceReference(element)],
    name: tags.name,
    ref: tags.ref,
    surface: tags.surface,
    sidewalk: tags.sidewalk,
    footway: tags.footway,
    crossing: tags.crossing,
    crossingMarkings: tags["crossing:markings"],
    crossingRef: tags.crossing_ref,
    footwaySurface: tags["footway:surface"],
    cyclewaySurface: tags["cycleway:surface"],
    cyclewayWidth: parsePositiveMeters(tags["cycleway:width"]),
    segregated: parseBoolean(tags.segregated),
    kerb: tags.kerb,
    kerbLeft: tags["kerb:left"],
    kerbRight: tags["kerb:right"],
    lanes: parsePositiveCount(tags.lanes),
    lanesForward: parsePositiveCount(tags["lanes:forward"]),
    lanesBackward: parsePositiveCount(tags["lanes:backward"]),
    laneMarkings: tags.lane_markings,
    oneway: parseOneway(tags),
    maxSpeedKph: parseMaxSpeedKph(tags.maxspeed),
    maxSpeedForwardKph: parseMaxSpeedKph(tags["maxspeed:forward"]),
    maxSpeedBackwardKph: parseMaxSpeedKph(tags["maxspeed:backward"]),
    maxSpeedRaw: tags.maxspeed,
    access: tags.access,
    vehicle: tags.vehicle,
    motorVehicle: tags.motor_vehicle,
    motorcar: tags.motorcar,
    service: tags.service,
    trafficSign: tags.traffic_sign,
    parking: roadParking(tags),
    lit: tags.lit ? tags.lit === "yes" : undefined,
  };
}

function cleanOutline(element) {
  const points = cleanPoints(element.geometry);
  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) points.pop();
  }
  return points;
}

function mappedBuilding(tags = {}) {
  const value = String(tags.building ?? "").trim().toLowerCase();
  return Boolean(value && value !== "no");
}

function multipolygonCategory(tags = {}) {
  if (mappedBuilding(tags)) return "building";
  if (tags.natural === "water" || tags.waterway) return "water";
  if (tags.leisure || tags.landuse || tags.natural === "wood") return "green";
  return null;
}

function geographicPointKey(point) {
  return `${Number(point.lon).toFixed(9)}:${Number(point.lat).toFixed(9)}`;
}

function sameGeographicPoint(left, right) {
  return geographicPointKey(left) === geographicPointKey(right);
}

function cleanGeographicGeometry(geometry = []) {
  const points = [];
  for (const point of geometry) {
    if (!Number.isFinite(point?.lon) || !Number.isFinite(point?.lat)) continue;
    const previous = points[points.length - 1];
    if (!previous || !sameGeographicPoint(previous, point)) {
      points.push({ lon: Number(point.lon), lat: Number(point.lat) });
    }
  }
  return points;
}

function stitchMemberRings(segments) {
  const remaining = segments
    .map((segment) => ({
      points: cleanGeographicGeometry(segment.geometry),
      memberWayIds: [segment.memberWayId],
    }))
    .filter((segment) => segment.points.length >= 2);
  const rings = [];
  let openChains = 0;

  while (remaining.length > 0) {
    const chain = remaining.shift();
    while (!sameGeographicPoint(chain.points[0], chain.points[chain.points.length - 1])) {
      const tail = chain.points[chain.points.length - 1];
      const nextIndex = remaining.findIndex((segment) => (
        sameGeographicPoint(segment.points[0], tail)
        || sameGeographicPoint(segment.points[segment.points.length - 1], tail)
      ));
      if (nextIndex < 0) break;
      const [next] = remaining.splice(nextIndex, 1);
      if (!sameGeographicPoint(next.points[0], tail)) next.points.reverse();
      chain.points.push(...next.points.slice(1));
      chain.memberWayIds.push(...next.memberWayIds);
    }

    const uniquePointKeys = new Set(chain.points.map(geographicPointKey));
    if (
      sameGeographicPoint(chain.points[0], chain.points[chain.points.length - 1])
      && uniquePointKeys.size >= 3
    ) {
      rings.push(chain);
    } else {
      openChains += 1;
    }
  }
  return { rings, openChains };
}

function geographicRingArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    area += current.lon * next.lat - next.lon * current.lat;
  }
  return area * 0.5;
}

function pointInGeographicRing(point, ring) {
  let inside = false;
  for (let currentIndex = 0, previousIndex = ring.length - 1;
    currentIndex < ring.length;
    previousIndex = currentIndex, currentIndex += 1) {
    const current = ring[currentIndex];
    const previous = ring[previousIndex];
    const crossesLatitude = (current.lat > point.lat) !== (previous.lat > point.lat);
    if (!crossesLatitude) continue;
    const crossingLongitude = (
      (previous.lon - current.lon) * (point.lat - current.lat)
      / (previous.lat - current.lat)
      + current.lon
    );
    if (point.lon < crossingLongitude) inside = !inside;
  }
  return inside;
}

function ringSortKey(ring) {
  return ring.map(geographicPointKey).sort()[0] ?? "";
}

function sortedRings(rings) {
  return rings.slice().sort((left, right) => (
    Math.abs(geographicRingArea(right)) - Math.abs(geographicRingArea(left))
    || ringSortKey(left).localeCompare(ringSortKey(right))
  ));
}

function sortedRingRecords(records) {
  return records.slice().sort((left, right) => (
    Math.abs(geographicRingArea(right.points)) - Math.abs(geographicRingArea(left.points))
    || ringSortKey(left.points).localeCompare(ringSortKey(right.points))
  ));
}

/**
 * Reconstruct OSM multipolygons from relation member geometry. Fragmented and
 * reversed way members are stitched into closed rings. Each inner ring is
 * assigned to the smallest containing outer; unclosed/orphan rings are counted
 * and omitted rather than emitted as misleading standalone polygons.
 */
export function reconstructMultipolygonRelations(elements = []) {
  const ways = new Map(
    elements
      .filter((element) => element.type === "way")
      .map((element) => [String(element.id), element]),
  );
  const consumedWayIds = {
    building: new Set(),
    green: new Set(),
    water: new Set(),
  };
  const diagnostics = {
    relations: 0,
    parts: 0,
    missingMemberGeometries: 0,
    openOuterChains: 0,
    openInnerChains: 0,
    orphanInnerRings: 0,
  };
  const parts = [];
  const relations = elements
    .filter((element) => element.type === "relation" && element.tags?.type === "multipolygon")
    .sort((left, right) => Number(left.id) - Number(right.id));

  for (const relation of relations) {
    const category = multipolygonCategory(relation.tags);
    if (!category) continue;
    diagnostics.relations += 1;
    const outerSegments = [];
    const innerSegments = [];
    for (const member of relation.members ?? []) {
      if (member.type !== "way") continue;
      const role = String(member.role ?? "").trim().toLowerCase();
      if (role && role !== "outer" && role !== "inner") continue;
      const memberWayId = String(member.ref);
      const nestedGeometry = member.geometry;
      const fallbackGeometry = ways.get(memberWayId)?.geometry;
      const geometry = Array.isArray(nestedGeometry) && nestedGeometry.length >= 2
        ? nestedGeometry
        : fallbackGeometry;
      if (!Array.isArray(geometry) || geometry.length < 2) {
        diagnostics.missingMemberGeometries += 1;
        continue;
      }
      (role === "inner" ? innerSegments : outerSegments).push({ geometry, memberWayId });
    }

    const outerResult = stitchMemberRings(outerSegments);
    const innerResult = stitchMemberRings(innerSegments);
    diagnostics.openOuterChains += outerResult.openChains;
    diagnostics.openInnerChains += innerResult.openChains;
    if (outerResult.rings.length === 0) continue;

    const outerParts = sortedRingRecords(outerResult.rings).map((outer) => ({
      outer: outer.points,
      holes: [],
      memberWayIds: new Set(outer.memberWayIds),
      area: Math.abs(geographicRingArea(outer.points)),
    }));
    for (const inner of sortedRingRecords(innerResult.rings)) {
      const containingOuter = outerParts
        .filter((part) => pointInGeographicRing(inner.points[0], part.outer))
        .sort((left, right) => left.area - right.area)[0];
      if (containingOuter) {
        containingOuter.holes.push(inner.points);
        for (const memberWayId of inner.memberWayIds) containingOuter.memberWayIds.add(memberWayId);
      } else {
        diagnostics.orphanInnerRings += 1;
      }
    }

    for (let ordinal = 0; ordinal < outerParts.length; ordinal += 1) {
      const part = outerParts[ordinal];
      for (const memberWayId of part.memberWayIds) consumedWayIds[category].add(memberWayId);
      parts.push({
        category,
        element: relation,
        outer: part.outer,
        holes: sortedRings(part.holes),
        ordinal,
        partCount: outerParts.length,
      });
      diagnostics.parts += 1;
    }
  }

  return { parts, consumedWayIds, diagnostics };
}

export function relationBuildingPartId(relationId, ordinal) {
  const numericRelationId = Number(relationId);
  if (!Number.isSafeInteger(numericRelationId) || numericRelationId <= 0) {
    throw new Error(`Invalid OSM relation id ${relationId}`);
  }
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= osmRelationPartIdStride) {
    throw new Error(`OSM relation ${relationId} has an unsupported outer-ring ordinal ${ordinal}`);
  }
  // OSM ways stay positive. Relation parts occupy a reversible negative
  // namespace; the LoD2 merge also probes its generated negative IDs against
  // all existing IDs, so it cannot overwrite one of these relation parts.
  const id = -(numericRelationId * osmRelationPartIdStride + ordinal + 1);
  if (!Number.isSafeInteger(id)) throw new Error(`OSM relation ${relationId} cannot produce a safe runtime id`);
  return id;
}

function parkingFeature(element) {
  const tags = element.tags ?? {};
  if (!["parking", "parking_space"].includes(tags.amenity)) return null;
  const point = elementPoint(element);
  if (!point) return null;
  const outline = cleanOutline(element);
  return {
    id: `${element.type}/${element.id}`,
    kind: tags.amenity,
    point: point.map(round),
    outline: outline.length >= 3 ? outline : undefined,
    parking: tags.parking,
    access: tags.access,
    capacity: parseCount(tags.capacity),
    fee: parseBoolean(tags.fee),
    surface: tags.surface,
    sourceRefs: [osmSourceReference(element)],
  };
}

function streetLampFeature(element) {
  const tags = element.tags ?? {};
  if (element.type !== "node" || tags.highway !== "street_lamp") return null;
  const point = elementPoint(element);
  if (!point) return null;
  return {
    id: Number(element.id),
    point: point.map(round),
    height: parseMeters(tags.height) ?? undefined,
    lampType: tags["lamp:type"] ?? tags.lamp_type,
    mount: tags["lamp:mount"] ?? tags.lamp_mount,
    lightColor: tags["light:colour"] ?? tags["light:color"],
    sourceRefs: [osmSourceReference(element)],
  };
}

function benchFeature(element) {
  const tags = element.tags ?? {};
  if (element.type !== "node" || tags.amenity !== "bench") return null;
  const point = elementPoint(element);
  if (!point) return null;
  return {
    id: Number(element.id),
    point: point.map(round),
    direction: parseDirection(tags.direction),
    seats: parsePositiveCount(tags.seats),
    backrest: parseBoolean(tags.backrest),
    material: tags.material,
    color: tags.colour ?? tags.color,
    sourceRefs: [osmSourceReference(element)],
  };
}

const roadWidths = {
  motorway: 18,
  trunk: 15,
  primary: 13,
  secondary: 11,
  tertiary: 9,
  residential: 7,
  living_street: 6,
  service: 4.5,
  pedestrian: 7,
  footway: 2.2,
  path: 1.8,
  cycleway: 2.2,
  steps: 2.2,
};

function roadWidth(element) {
  return parseMeters(element.tags?.width) ?? roadWidths[element.tags?.highway] ?? 5;
}

function centroid(points) {
  const sum = points.reduce((result, point) => [result[0] + point[0], result[1] + point[1]], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}

function tileCoordinates(point) {
  return [Math.floor(point[0] / tileSize), Math.floor(point[1] / tileSize)];
}

function tileId(point) {
  const [x, z] = tileCoordinates(point);
  return `${x}_${z}`;
}

async function fetchOverpassQuery(queryText, label) {
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];
  let lastError;

  for (const endpoint of endpoints) {
    try {
      process.stdout.write(`Requesting ${label} from ${endpoint}\n`);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": "Munich3D browser prototype (local development)",
        },
        body: new URLSearchParams({ data: queryText }),
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      process.stderr.write(`Overpass endpoint failed: ${String(error)}\n`);
    }
  }

  throw lastError ?? new Error("No Overpass endpoint was available");
}

async function fetchOverpass() {
  const core = await fetchOverpassQuery(coreQuery, "Munich map data");
  const parkingSpaces = await fetchOverpassQuery(parkingSpaceQuery, "Munich parking spaces");
  const elements = new Map();
  for (const element of [...(core.elements ?? []), ...(parkingSpaces.elements ?? [])]) {
    elements.set(`${element.type}/${element.id}`, element);
  }
  return { ...core, elements: [...elements.values()] };
}

async function loadSource() {
  const shouldRefresh = process.argv.includes("--refresh");
  if (!shouldRefresh && existsSync(cacheFile)) {
    process.stdout.write(`Using cached source data at ${cacheFile}\n`);
    return JSON.parse(await readFile(cacheFile, "utf8"));
  }

  const data = await fetchOverpass();
  await mkdir(path.dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, JSON.stringify(data));
  return data;
}

async function fetchParkingSource() {
  const url = buildMunichParkingWfsUrl(bounds, { count: 100_000 });
  process.stdout.write("Requesting municipal Parkseiten from Munich Open Data\n");
  const response = await fetch(url, {
    headers: { "User-Agent": "Munich3D browser prototype (local development)" },
  });
  if (!response.ok) throw new Error(`Munich Parkseiten WFS returned ${response.status} ${response.statusText}`);
  const data = await response.json();
  if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    throw new Error("Munich Parkseiten WFS did not return a GeoJSON FeatureCollection");
  }
  for (const [field, value] of [
    ["numberMatched", data.numberMatched],
    ["numberReturned", data.numberReturned],
  ]) {
    const reported = Number(value);
    if (Number.isFinite(reported) && reported !== data.features.length) {
      throw new Error(
        `Munich Parkseiten WFS ${field}=${reported}, but returned ${data.features.length} features`,
      );
    }
  }
  return data;
}

async function loadParkingSource() {
  const shouldRefresh = process.argv.includes("--refresh");
  if (!shouldRefresh && existsSync(parkingCacheFile)) {
    process.stdout.write(`Using cached municipal parking data at ${parkingCacheFile}\n`);
    return JSON.parse(await readFile(parkingCacheFile, "utf8"));
  }

  const data = await fetchParkingSource();
  await mkdir(path.dirname(parkingCacheFile), { recursive: true });
  await writeFile(parkingCacheFile, JSON.stringify(data));
  return data;
}

export function createTiles() {
  const southwest = project({ lon: bounds.west, lat: bounds.south });
  const northeast = project({ lon: bounds.east, lat: bounds.north });
  const minX = Math.min(southwest[0], northeast[0]);
  const maxX = Math.max(southwest[0], northeast[0]);
  const minZ = Math.min(southwest[1], northeast[1]);
  const maxZ = Math.max(southwest[1], northeast[1]);
  const tiles = new Map();

  for (let x = Math.floor(minX / tileSize); x <= Math.floor(maxX / tileSize); x += 1) {
    for (let z = Math.floor(minZ / tileSize); z <= Math.floor(maxZ / tileSize); z += 1) {
      const id = `${x}_${z}`;
      tiles.set(id, {
        id,
        center: [x * tileSize + tileSize / 2, z * tileSize + tileSize / 2],
        buildings: [],
        roads: [],
        tramTracks: [],
        greens: [],
        trees: [],
        streetLamps: [],
        benches: [],
        parking: [],
        parkingRows: [],
        businesses: [],
      });
    }
  }
  return tiles;
}

function projectedPointKey(point) {
  return `${point[0].toFixed(1)}:${point[1].toFixed(1)}`;
}

function tramJunctionKeys(source) {
  const owners = new Map();
  for (const element of source.elements ?? []) {
    const railway = element.tags?.railway;
    if (railway !== "tram" && railway !== "light_rail") continue;
    const owner = `${element.type}/${element.id}`;
    for (const point of cleanPoints(element.geometry)) {
      const key = projectedPointKey(point);
      const pointOwners = owners.get(key) ?? new Set();
      pointOwners.add(owner);
      owners.set(key, pointOwners);
    }
  }
  return new Set([...owners].filter(([, pointOwners]) => pointOwners.size > 1).map(([key]) => key));
}

function addTramTrack(element, points, junctionKeys, tiles) {
  const tags = element.tags ?? {};
  let part = 0;
  let currentTileId;
  let currentPoints = [];
  const flush = () => {
    if (currentPoints.length < 2 || !currentTileId) {
      currentPoints = [];
      currentTileId = undefined;
      return;
    }
    tiles.get(currentTileId)?.tramTracks.push({
      id: `${element.type}/${element.id}:${part++}`,
      points: currentPoints,
      kind: tags.railway,
      name: tags.name,
      ref: tags.ref,
      service: tags.service,
      oneway: parseOneway(tags),
      sourceRefs: [osmSourceReference(element)],
    });
    currentPoints = [];
    currentTileId = undefined;
  };

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const segmentTileId = tileId(centroid([start, end]));
    if (!tiles.has(segmentTileId)) {
      flush();
      continue;
    }
    const startsAtJunction = junctionKeys.has(projectedPointKey(start));
    if (currentPoints.length > 0 && (currentTileId !== segmentTileId || startsAtJunction)) flush();
    if (currentPoints.length === 0) {
      currentTileId = segmentTileId;
      currentPoints.push(start);
    }
    currentPoints.push(end);
    if (junctionKeys.has(projectedPointKey(end))) flush();
  }
  flush();
}

function addBuildingPolygon(element, outline, holes, tiles, relationPart) {
  if (outline.length < 3) return;
  const tile = tiles.get(tileId(centroid(outline)));
  if (!tile) return;
  const height = resolveBuildingHeight(element);
  tile.buildings.push({
    id: relationPart
      ? relationBuildingPartId(element.id, relationPart.ordinal)
      : Number(element.id),
    outline,
    holes: holes.length > 0 ? holes : undefined,
    height: round(height.height),
    heightSource: height.heightSource,
    heightInference: height.heightInference,
    ...buildingMetadata(element),
    multipolygon: relationPart ? {
      relationId: Number(element.id),
      outerOrdinal: relationPart.ordinal,
      outerCount: relationPart.partCount,
    } : undefined,
  });
}

function addGreenPolygon(element, outline, holes, tiles, relationPart) {
  if (outline.length < 3) return;
  const tags = element.tags ?? {};
  const isWater = tags.natural === "water" || Boolean(tags.waterway);
  const tile = tiles.get(tileId(centroid(outline)));
  if (!tile) return;
  const baseId = `${element.type}/${element.id}`;
  tile.greens.push({
    id: relationPart ? `${baseId}:outer/${relationPart.ordinal}` : baseId,
    sourceId: `osm:${baseId}`,
    sourceRefs: [osmSourceReference(element)],
    outline,
    holes: holes.length > 0 ? holes : undefined,
    kind: isWater ? "water" : "green",
    subtype: tags.leisure ?? tags.landuse ?? tags.natural ?? tags.waterway,
    multipolygon: relationPart ? {
      relationId: Number(element.id),
      outerOrdinal: relationPart.ordinal,
      outerCount: relationPart.partCount,
    } : undefined,
  });
}

export function convert(source, tiles) {
  const elements = source.elements ?? [];
  const multipolygons = reconstructMultipolygonRelations(elements);
  const junctionKeys = tramJunctionKeys(source);
  const mappedTreeIndex = new PointProximityIndex(4);
  const inferredTreeIndex = new PointProximityIndex(4);
  const inferredStreetTreeIndex = new PointProximityIndex(6);
  const treePlacements = {
    mappedPoints: 0,
    sourceRows: 0,
    inferredFromRows: 0,
    skippedNearMappedPoint: 0,
    skippedDuplicateRow: 0,
    skippedOutsideBounds: 0,
    defaultSpacingMeters: DEFAULT_TREE_ROW_SPACING_METERS,
    streetCorridorNames: [...streetTreeCorridorNames],
    sourceStreetWays: 0,
    inferredFromStreetCorridors: 0,
    skippedStreetNearKnownTree: 0,
    skippedStreetBuildingConflict: 0,
    skippedStreetDuplicate: 0,
    skippedStreetOutsideBounds: 0,
    streetCorridorSpacingMeters: DEFAULT_STREET_TREE_SPACING_METERS,
    streetCorridorSetbackBeyondRoadMeters: streetTreeSetbackBeyondRoadMeters,
    streetCorridorEndClearanceMeters: DEFAULT_STREET_TREE_END_CLEARANCE_METERS,
  };

  // Explicit OSM tree nodes are authoritative and always win deduplication.
  for (const element of elements) {
    const tags = element.tags ?? {};
    if (element.type !== "node" || tags.natural !== "tree") continue;
    if (!Number.isFinite(element.lon) || !Number.isFinite(element.lat)) continue;
    const point = project(element).map(round);
    const tile = tiles.get(tileId(point));
    if (!tile) continue;
    const taggedHeight = parseMeters(tags.height ?? tags.est_height);
    const crownDiameter = parseMeters(tags["diameter_crown"]);
    tile.trees.push({
      id: Number(element.id),
      point,
      height: round(taggedHeight ?? deterministicTreeHeight(Number(element.id))),
      crownDiameter: crownDiameter ? round(crownDiameter) : undefined,
      species: tags.species,
      genus: tags.genus,
      leafType: tags.leaf_type,
      leafCycle: tags.leaf_cycle,
      denotation: tags.denotation,
      source: "osm",
      placement: "mapped-point",
      sourceRefs: [osmSourceReference(element)],
    });
    mappedTreeIndex.add(point);
    treePlacements.mappedPoints += 1;
  }

  const treeRows = elements
    .filter((element) => element.type === "way" && element.tags?.natural === "tree_row")
    .sort((left, right) => Number(left.id) - Number(right.id));
  for (const element of treeRows) {
    const tags = element.tags ?? {};
    const points = cleanPoints(element.geometry);
    if (points.length < 2) continue;
    treePlacements.sourceRows += 1;
    const samples = sampleTreeRow(points, treeRowSpacing(tags));
    const rowPointKeys = new Set();
    const acceptedPoints = [];
    for (let ordinal = 0; ordinal < samples.length; ordinal += 1) {
      const point = samples[ordinal].map(round);
      const target = tiles.get(tileId(point));
      if (!pointWithinBounds(point) || !target) {
        treePlacements.skippedOutsideBounds += 1;
        continue;
      }
      const pointKey = `${point[0].toFixed(2)}:${point[1].toFixed(2)}`;
      if (rowPointKeys.has(pointKey)) {
        treePlacements.skippedDuplicateRow += 1;
        continue;
      }
      rowPointKeys.add(pointKey);
      if (mappedTreeIndex.hasNearby(point, treeRowMappedPointDeduplicationRadius)) {
        treePlacements.skippedNearMappedPoint += 1;
        continue;
      }
      if (inferredTreeIndex.hasNearby(point, treeRowOverlapDeduplicationRadius)) {
        treePlacements.skippedDuplicateRow += 1;
        continue;
      }
      const id = inferredTreeRowId(element.id, ordinal);
      const taggedHeight = parseMeters(tags.height ?? tags.est_height);
      const crownDiameter = parseMeters(tags["diameter_crown"]);
      target.trees.push({
        id,
        point,
        height: round(taggedHeight ?? deterministicTreeRowHeight(id)),
        crownDiameter: crownDiameter ? round(crownDiameter) : undefined,
        species: tags.species,
        genus: tags.genus,
        leafType: tags.leaf_type,
        leafCycle: tags.leaf_cycle,
        denotation: tags.denotation,
        source: "osm",
        placement: "inferred-tree-row",
        sourceRefs: [osmSourceReference(element)],
      });
      acceptedPoints.push(point);
      treePlacements.inferredFromRows += 1;
    }
    for (const point of acceptedPoints) inferredTreeIndex.add(point);
  }

  // Elisabethstraße is a reviewed showcase corridor with known gaps in OSM's
  // individual-tree coverage. Add transparent, deterministic visualization
  // inferences beside its road centreline, while mapped trees and tree-row
  // inferences remain authoritative and building conflicts are rejected.
  const buildingObstacles = [
    ...elements
      .filter((element) => (
        element.type === "way"
        && mappedBuilding(element.tags)
        && !multipolygons.consumedWayIds.building.has(String(element.id))
      ))
      .map((element) => cleanOutline(element)),
    ...multipolygons.parts
      .filter((part) => part.category === "building")
      .map((part) => cleanOutline({ geometry: part.outer })),
  ]
    .map((outline) => polygonObstacle(outline))
    .filter(Boolean);
  const streetCorridors = elements
    .filter((element) => (
      element.type === "way"
      && element.tags?.highway === "secondary"
      && streetTreeCorridorNames.has(element.tags?.name)
    ))
    .sort((left, right) => Number(left.id) - Number(right.id));
  for (const element of streetCorridors) {
    const points = cleanPoints(element.geometry);
    if (points.length < 2) continue;
    treePlacements.sourceStreetWays += 1;
    const samples = sampleStreetTreeCorridor(points, {
      spacingMeters: DEFAULT_STREET_TREE_SPACING_METERS,
      offsetMeters: roadWidth(element) * 0.5 + streetTreeSetbackBeyondRoadMeters,
      endClearanceMeters: DEFAULT_STREET_TREE_END_CLEARANCE_METERS,
    });
    for (const sample of samples) {
      const point = sample.point.map(round);
      const target = tiles.get(tileId(point));
      if (!pointWithinBounds(point) || !target) {
        treePlacements.skippedStreetOutsideBounds += 1;
        continue;
      }
      if (
        mappedTreeIndex.hasNearby(point, streetTreeKnownTreeDeduplicationRadius)
        || inferredTreeIndex.hasNearby(point, streetTreeKnownTreeDeduplicationRadius)
      ) {
        treePlacements.skippedStreetNearKnownTree += 1;
        continue;
      }
      if (inferredStreetTreeIndex.hasNearby(point, streetTreeOverlapDeduplicationRadius)) {
        treePlacements.skippedStreetDuplicate += 1;
        continue;
      }
      if (buildingObstacles.some((obstacle) => (
        isNearPolygonObstacle(point, obstacle, streetTreeBuildingClearanceMeters)
      ))) {
        treePlacements.skippedStreetBuildingConflict += 1;
        continue;
      }
      const id = inferredStreetTreeId(element.id, sample.side, sample.ordinal);
      target.trees.push({
        id,
        point,
        height: round(deterministicTreeRowHeight(id)),
        source: "osm",
        placement: "inferred-street-corridor",
        sourceRefs: [osmSourceReference(element)],
      });
      inferredStreetTreeIndex.add(point);
      treePlacements.inferredFromStreetCorridors += 1;
    }
  }

  for (const element of elements) {
    const tags = element.tags ?? {};
    if (element.type === "node" && tags.natural === "tree") continue;
    if (element.type === "way" && tags.natural === "tree_row") continue;
    const business = businessFeature(element);
    if (business) tiles.get(tileId(business.point))?.businesses.push(business);
    const parking = parkingFeature(element);
    if (parking) tiles.get(tileId(parking.point))?.parking.push(parking);
    const streetLamp = streetLampFeature(element);
    if (streetLamp) tiles.get(tileId(streetLamp.point))?.streetLamps.push(streetLamp);
    const bench = benchFeature(element);
    if (bench) tiles.get(tileId(bench.point))?.benches.push(bench);

    const points = cleanPoints(element.geometry);
    if (points.length < 2) continue;

    if (mappedBuilding(tags) && points.length >= 3) {
      const consumedByRelation = element.type === "way"
        && multipolygons.consumedWayIds.building.has(String(element.id));
      if (!consumedByRelation) {
        addBuildingPolygon(element, points, [], tiles);
        continue;
      }
    }

    if (tags.highway) {
      for (let index = 0; index < points.length - 1; index += 1) {
        const segment = [points[index], points[index + 1]];
        const tile = tiles.get(tileId(centroid(segment)));
        tile?.roads.push({
          points: segment,
          width: roadWidth(element),
          kind: tags.highway,
          ...roadMetadata(element),
        });
      }
      continue;
    }

    if (tags.railway === "tram" || tags.railway === "light_rail") {
      // Rail ways can extend outside the requested bounds and can meet other
      // ways at an interior vertex. Split at tile and junction boundaries so
      // no in-bounds track is lost to a whole-way centroid outside the grid,
      // and so the runtime graph can follow real junction connections.
      addTramTrack(element, points, junctionKeys, tiles);
      continue;
    }

    const isWater = tags.natural === "water" || Boolean(tags.waterway);
    const isGreen = tags.leisure || tags.landuse || tags.natural === "wood";
    if ((isWater || isGreen) && points.length >= 3) {
      const category = isWater ? "water" : "green";
      const consumedByRelation = element.type === "way"
        && multipolygons.consumedWayIds[category].has(String(element.id));
      if (!consumedByRelation) addGreenPolygon(element, points, [], tiles);
    }
  }

  for (const part of multipolygons.parts) {
    const outline = cleanOutline({ geometry: part.outer });
    const holes = part.holes
      .map((hole) => cleanOutline({ geometry: hole }))
      .filter((hole) => hole.length >= 3);
    if (part.category === "building") {
      addBuildingPolygon(part.element, outline, holes, tiles, part);
    } else {
      addGreenPolygon(part.element, outline, holes, tiles, part);
    }
  }
  return treePlacements;
}

function addMunicipalParkingRows(source, tiles) {
  const parsed = parseMunichParkingGeoJson(source, {
    origin,
    tileSize,
  });
  const grouped = groupParkingRowsByTile(parsed.rows);
  let outsideTileRows = 0;
  let runtimeTileRows = 0;
  let runtimeAllocatedCapacity = 0;
  for (const [id, rows] of grouped) {
    const tile = tiles.get(id);
    if (!tile) {
      outsideTileRows += rows.length;
      continue;
    }
    tile.parkingRows.push(...rows.sort((left, right) => left.id.localeCompare(right.id)));
    runtimeTileRows += rows.length;
    runtimeAllocatedCapacity += rows.reduce((sum, row) => sum + row.capacity, 0);
  }
  return {
    ...parsed,
    stats: {
      ...parsed.stats,
      outsideTileRows,
      runtimeTileRows,
      runtimeAllocatedCapacity,
    },
  };
}

async function writeTiles(tiles, source, treePlacements, municipalParking) {
  await mkdir(tileDirectory, { recursive: true });
  const entries = [];
  let buildings = 0;
  let roads = 0;
  let tramTracks = 0;
  let trees = 0;
  let streetLamps = 0;
  let benches = 0;
  let parking = 0;
  let parkingRows = 0;
  let businesses = 0;
  let storefronts = 0;

  for (const tile of tiles.values()) {
    const fileName = `${tile.id}.json`;
    await writeFile(path.join(tileDirectory, fileName), JSON.stringify(tile));
    buildings += tile.buildings.length;
    roads += tile.roads.length;
    tramTracks += tile.tramTracks.length;
    trees += tile.trees.length;
    streetLamps += tile.streetLamps.length;
    benches += tile.benches.length;
    parking += tile.parking.length;
    parkingRows += tile.parkingRows.length;
    businesses += tile.businesses.length;
    storefronts += tile.businesses.filter((business) => business.frontage).length;
    entries.push({
      id: tile.id,
      center: tile.center,
      file: `/data/tiles/${fileName}`,
      buildings: tile.buildings.length,
      businesses: tile.businesses.length,
      trees: tile.trees.length,
      streetLamps: tile.streetLamps.length,
      benches: tile.benches.length,
      parking: tile.parking.length,
      parkingRows: tile.parkingRows.length,
    });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: [
      `OpenStreetMap Overpass API (${source.osm3s?.timestamp_osm_base ?? "unknown snapshot"})`,
      MUNICH_PARKING_DATASET,
    ].join("; "),
    attribution: [
      "© OpenStreetMap contributors",
      "ODbL",
      "Landeshauptstadt München – opendata.muenchen.de",
      MUNICH_PARKING_LICENSE,
      "municipal data projected, clipped, and visually inferred for Munich3D",
    ].join(" · "),
    sources: [
      {
        dataset: "OpenStreetMap",
        id: "Munich corridor extract",
        license: "ODbL-1.0",
        observedAt: source.osm3s?.timestamp_osm_base,
      },
      {
        dataset: MUNICH_PARKING_DATASET,
        id: municipalParking.source.featureType,
        license: MUNICH_PARKING_LICENSE,
      },
    ],
    origin,
    tileSize,
    bounds,
    treePlacements,
    parkingRowStats: {
      ...municipalParking.stats,
      responseTimestamp: municipalParking.source.responseTimestamp,
    },
    tiles: entries,
  };
  await writeFile(path.join(outputDirectory, "manifest.json"), JSON.stringify(manifest, null, 2));
  process.stdout.write(
    `Wrote ${entries.length} tiles with ${buildings} buildings, ${roads} road segments, ${tramTracks} tram alignments, ${trees} trees, ${streetLamps} street lamps, ${benches} benches, ${parking} OSM parking features, ${parkingRows} municipal parking-row pieces, and ${storefronts}/${businesses} assigned business frontages.\n`,
  );
}

async function main() {
  const [source, parkingSource] = await Promise.all([loadSource(), loadParkingSource()]);
  const tiles = createTiles();
  const treePlacements = convert(source, tiles);
  const municipalParking = addMunicipalParkingRows(parkingSource, tiles);
  assignBusinessFrontages(tiles, tileSize);
  await writeTiles(tiles, source, treePlacements, municipalParking);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
