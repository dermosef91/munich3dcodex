export const MUNICH_PARKING_WFS_ENDPOINT = "https://geoportal.muenchen.de/geoserver/mor_wfs/ows";
export const MUNICH_PARKING_FEATURE_TYPE = "mor_wfs:ruhver_parkseiten_line";
export const MUNICH_PARKING_DATASET = "Landeshauptstadt München, Mobilitätsreferat – Parkseiten";
export const MUNICH_PARKING_DATASET_URL = "https://opendata.muenchen.de/dataset/opendata_ruhver_parkseiten_line";
export const MUNICH_PARKING_LICENSE = "dl-de/by-2-0";
export const MUNICH_PARKING_LICENSE_URL = "https://www.govdata.de/dl-de/by-2-0";

export const MUNICH_ORIGIN = Object.freeze({ lat: 48.151, lon: 11.572 });
export const DEFAULT_TILE_SIZE_METERS = 500;

const METERS_PER_DEGREE = 111_320;
const EPSILON = 1e-10;
const MAX_GRID_CROSSINGS_PER_SEGMENT = 100_000;
const NON_PARKABLE_GROUPS = new Set([
  "absolutes halteverbot (0-24 uhr)",
  "eingeschranktes halteverbot (0-24 uhr)",
  "baustelle",
]);

function normalizedText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function optionalInteger(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function parkingCapacity(value) {
  if (value === null || value === undefined || String(value).trim() === "") return undefined;
  const parsed = Number.parseFloat(String(value).trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function finitePoint(point) {
  return Array.isArray(point)
    && point.length >= 2
    && Number.isFinite(point[0])
    && Number.isFinite(point[1]);
}

function samePoint(left, right, epsilon = EPSILON) {
  return Math.abs(left[0] - right[0]) <= epsilon
    && Math.abs(left[1] - right[1]) <= epsilon;
}

function round(value, digits) {
  const scale = 10 ** digits;
  const rounded = Math.round(value * scale) / scale;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function roundPoint(point, digits) {
  return [round(point[0], digits), round(point[1], digits)];
}

function lineLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
    );
  }
  return length;
}

function tileCoordinates(point, tileSize) {
  return [Math.floor(point[0] / tileSize), Math.floor(point[1] / tileSize)];
}

function tileId(point, tileSize) {
  const [x, z] = tileCoordinates(point, tileSize);
  return `${x}_${z}`;
}

function interpolation(start, end, progress) {
  return [
    start[0] + (end[0] - start[0]) * progress,
    start[1] + (end[1] - start[1]) * progress,
  ];
}

function gridCrossings(start, end, axis, tileSize) {
  const from = start[axis];
  const to = end[axis];
  const delta = to - from;
  if (Math.abs(delta) <= EPSILON) return [];

  const minimum = Math.min(from, to);
  const maximum = Math.max(from, to);
  const firstGridIndex = Math.floor(minimum / tileSize) + 1;
  const lastGridIndex = Math.ceil(maximum / tileSize) - 1;
  const crossingCount = Math.max(0, lastGridIndex - firstGridIndex + 1);
  if (crossingCount > MAX_GRID_CROSSINGS_PER_SEGMENT) {
    throw new Error(`Parking row segment exceeds the ${MAX_GRID_CROSSINGS_PER_SEGMENT}-tile safety limit`);
  }

  const crossings = [];
  for (let gridIndex = firstGridIndex; gridIndex <= lastGridIndex; gridIndex += 1) {
    const progress = (gridIndex * tileSize - from) / delta;
    if (progress > EPSILON && progress < 1 - EPSILON) crossings.push(progress);
  }
  return crossings;
}

function uniqueProgressValues(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const unique = [];
  for (const value of sorted) {
    if (unique.length === 0 || Math.abs(value - unique.at(-1)) > EPSILON) unique.push(value);
  }
  return unique;
}

function wgs84CrsName(featureCollection) {
  return optionalText(featureCollection?.crs?.properties?.name);
}

function isWgs84Crs(crsName) {
  if (!crsName) return true;
  const normalized = normalizedText(crsName).replaceAll(" ", "");
  return (normalized.includes("epsg") && normalized.endsWith("4326"))
    || normalized.includes("crs84");
}

function validWgs84Coordinate(coordinate) {
  return finitePoint(coordinate)
    && coordinate[0] >= -180
    && coordinate[0] <= 180
    && coordinate[1] >= -90
    && coordinate[1] <= 90;
}

function nonParkableRule(properties) {
  const group = normalizedText(properties?.parkregel_gruppe);
  if (NON_PARKABLE_GROUPS.has(group)) return true;
  if (group) return false;

  const fallbackValues = [
    properties?.geoportal_class,
    properties?.parkregel_name,
    properties?.parkregel_beschreibung,
  ].map(normalizedText);

  if (fallbackValues.some((value) => value.includes("baustelle"))) return true;
  return fallbackValues.some((value) => (
    value.includes("absolutes halteverbot")
      || value.includes("eingeschranktes halteverbot")
  ) && /(?:^|\D)0\s*[-–]\s*24(?:\D|$)/.test(value));
}

/**
 * Construct the official WFS request without performing any network I/O.
 * Explicit EPSG:4326 output is important: the service otherwise returns its
 * native EPSG:25832 coordinates even when GeoJSON is requested.
 */
export function buildMunichParkingWfsUrl(bounds, options = {}) {
  if (!bounds || ![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite)) {
    throw new Error("WFS bounds must contain finite west, south, east, and north values");
  }
  if (bounds.west >= bounds.east || bounds.south >= bounds.north) {
    throw new Error("WFS bounds must have positive width and height");
  }

  const url = new URL(MUNICH_PARKING_WFS_ENDPOINT);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("version", "2.0.0");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("typeNames", MUNICH_PARKING_FEATURE_TYPE);
  url.searchParams.set("outputFormat", "application/json");
  url.searchParams.set("srsName", "EPSG:4326");
  url.searchParams.set(
    "bbox",
    `${bounds.west},${bounds.south},${bounds.east},${bounds.north},EPSG:4326`,
  );
  if (Number.isInteger(options.count) && options.count > 0) {
    url.searchParams.set("count", String(options.count));
  }
  if (Number.isInteger(options.startIndex) && options.startIndex >= 0) {
    url.searchParams.set("startIndex", String(options.startIndex));
  }
  return url.toString();
}

/** Convert GeoJSON [longitude, latitude] to Munich3D [east, south]. */
export function projectWgs84ToWorld(coordinate, origin = MUNICH_ORIGIN) {
  if (!validWgs84Coordinate(coordinate)) throw new Error("Invalid WGS84 coordinate");
  if (!origin || !Number.isFinite(origin.lon) || !Number.isFinite(origin.lat)) {
    throw new Error("Projection origin must contain finite lon and lat values");
  }
  const longitudeScale = Math.cos((origin.lat * Math.PI) / 180);
  const projected = [
    (coordinate[0] - origin.lon) * METERS_PER_DEGREE * longitudeScale,
    -(coordinate[1] - origin.lat) * METERS_PER_DEGREE,
  ];
  return projected.map((value) => Object.is(value, -0) ? 0 : value);
}

/**
 * Decide whether a municipal feature describes visual parking supply.
 * Permanent stopping bans and construction are excluded even if their source
 * record contains a non-zero offer count. Time-limited bans remain eligible;
 * their full rule is retained so callers can render them as conditional.
 */
export function parkingEligibility(properties = {}) {
  const capacity = parkingCapacity(properties.angebot);
  if (!capacity) return { eligible: false, reason: "invalid_capacity" };
  if (nonParkableRule(properties)) {
    return { eligible: false, reason: "non_parkable_rule", capacity };
  }
  return { eligible: true, capacity };
}

/**
 * Split a world-space polyline at every 500 m tile boundary. Boundary points
 * are present in both neighboring pieces, while each non-zero interval belongs
 * to exactly one tile (chosen from its midpoint).
 */
export function splitLineStringByTiles(points, tileSize = DEFAULT_TILE_SIZE_METERS) {
  if (!Number.isFinite(tileSize) || tileSize <= 0) throw new Error("Tile size must be positive");
  const line = [];
  for (const point of points ?? []) {
    if (!finitePoint(point)) throw new Error("Parking row contains an invalid world point");
    const candidate = [point[0], point[1]];
    if (line.length === 0 || !samePoint(candidate, line.at(-1))) line.push(candidate);
  }
  if (line.length < 2) return [];

  const pieces = [];
  let sourceOffsetMeters = 0;
  for (let index = 1; index < line.length; index += 1) {
    const start = line[index - 1];
    const end = line[index];
    if (samePoint(start, end)) continue;
    const sourceSegmentLength = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const progressValues = uniqueProgressValues([
      0,
      ...gridCrossings(start, end, 0, tileSize),
      ...gridCrossings(start, end, 1, tileSize),
      1,
    ]);

    for (let partIndex = 1; partIndex < progressValues.length; partIndex += 1) {
      const partStart = interpolation(start, end, progressValues[partIndex - 1]);
      const partEnd = interpolation(start, end, progressValues[partIndex]);
      const length = Math.hypot(partEnd[0] - partStart[0], partEnd[1] - partStart[1]);
      if (length <= EPSILON) continue;
      const midpoint = interpolation(partStart, partEnd, 0.5);
      const nextTileId = tileId(midpoint, tileSize);
      const sourceStartMeters = sourceOffsetMeters
        + sourceSegmentLength * progressValues[partIndex - 1];
      const previous = pieces.at(-1);
      if (previous && previous.tileId === nextTileId && samePoint(previous.points.at(-1), partStart)) {
        if (!samePoint(previous.points.at(-1), partEnd)) previous.points.push(partEnd);
        previous.length += length;
      } else {
        pieces.push({
          tileId: nextTileId,
          points: [partStart, partEnd],
          length,
          sourceStartMeters,
        });
      }
    }
    sourceOffsetMeters += sourceSegmentLength;
  }
  return pieces;
}

/**
 * Count global bay centers in each half-open tile piece. This keeps the integer
 * capacity aligned with the renderer's source-wide bay phase; a center exactly
 * on a tile boundary belongs to the later piece.
 */
export function allocateCapacityAcrossPieces(capacity, pieces) {
  if (!Number.isInteger(capacity) || capacity < 0) throw new Error("Capacity must be a non-negative integer");
  if (!Array.isArray(pieces) || pieces.length === 0) return [];
  let nextFallbackStart = 0;
  const intervals = pieces.map((piece) => {
    const length = Number.isFinite(piece?.length) && piece.length > 0
      ? piece.length
      : lineLength(piece?.points ?? []);
    const start = Number.isFinite(piece?.sourceStartMeters) && piece.sourceStartMeters >= 0
      ? piece.sourceStartMeters
      : nextFallbackStart;
    const interval = { start, end: start + Math.max(0, length) };
    nextFallbackStart = interval.end;
    return interval;
  });
  for (let index = 1; index < intervals.length; index += 1) {
    if (intervals[index].start < intervals[index - 1].end - EPSILON) {
      throw new Error("Parking row pieces must be ordered and non-overlapping");
    }
  }
  const totalLength = intervals.at(-1).end;
  if (totalLength <= EPSILON || capacity === 0) return pieces.map(() => 0);

  const allocated = pieces.map(() => 0);
  let pieceIndex = 0;
  for (let ordinal = 0; ordinal < capacity; ordinal += 1) {
    const center = (ordinal + 0.5) * totalLength / capacity;
    while (
      pieceIndex < intervals.length - 1
      && center >= intervals[pieceIndex].end - EPSILON
    ) pieceIndex += 1;
    allocated[pieceIndex] += 1;
  }
  return allocated;
}

/**
 * Parse an already-downloaded WFS GeoJSON response into deterministic runtime
 * parking-row records. This function is deliberately pure and performs no
 * fetching or file writes.
 */
export function parseMunichParkingGeoJson(featureCollection, options = {}) {
  if (featureCollection?.type !== "FeatureCollection" || !Array.isArray(featureCollection.features)) {
    throw new Error("Expected a GeoJSON FeatureCollection");
  }
  const crs = wgs84CrsName(featureCollection);
  if (!isWgs84Crs(crs)) {
    throw new Error(`Expected WGS84 GeoJSON, received ${crs ?? "an unknown CRS"}`);
  }
  const tileSize = Number.isFinite(options.tileSize) && options.tileSize > 0
    ? options.tileSize
    : DEFAULT_TILE_SIZE_METERS;
  const digits = Number.isInteger(options.roundDigits) && options.roundDigits >= 0
    ? options.roundDigits
    : 2;
  const dataset = optionalText(options.dataset) ?? MUNICH_PARKING_DATASET;
  const license = optionalText(options.license) ?? MUNICH_PARKING_LICENSE;
  const observedAt = optionalText(options.observedAt);
  const rows = [];
  const skipped = [];
  let sourceRows = 0;
  let sourceCapacity = 0;

  for (let featureIndex = 0; featureIndex < featureCollection.features.length; featureIndex += 1) {
    const feature = featureCollection.features[featureIndex];
    const sourceId = optionalText(feature?.id ?? feature?.properties?.gml_id);
    const reportSkip = (reason) => skipped.push({ sourceId, featureIndex, reason });
    if (!sourceId) {
      reportSkip("missing_source_id");
      continue;
    }
    const eligibility = parkingEligibility(feature?.properties);
    if (!eligibility.eligible) {
      reportSkip(eligibility.reason);
      continue;
    }
    if (feature?.geometry?.type !== "LineString" || !Array.isArray(feature.geometry.coordinates)) {
      reportSkip("invalid_geometry_type");
      continue;
    }
    if (!feature.geometry.coordinates.every(validWgs84Coordinate)) {
      reportSkip("invalid_coordinate");
      continue;
    }

    const worldLine = [];
    for (const coordinate of feature.geometry.coordinates) {
      const point = projectWgs84ToWorld(coordinate, options.origin ?? MUNICH_ORIGIN);
      if (worldLine.length === 0 || !samePoint(point, worldLine.at(-1))) worldLine.push(point);
    }
    if (worldLine.length < 2 || lineLength(worldLine) <= EPSILON) {
      reportSkip("degenerate_geometry");
      continue;
    }
    const pieces = splitLineStringByTiles(worldLine, tileSize);
    if (pieces.length === 0) {
      reportSkip("degenerate_geometry");
      continue;
    }

    const properties = feature.properties ?? {};
    const totalSourceLength = lineLength(worldLine);
    const capacities = allocateCapacityAcrossPieces(eligibility.capacity, pieces);
    const sourceRef = { dataset, id: sourceId, license };
    if (observedAt) sourceRef.observedAt = observedAt;
    const regulation = {
      id: optionalInteger(properties.parkregel_id),
      name: optionalText(properties.parkregel_name),
      description: optionalText(properties.parkregel_beschreibung),
      group: optionalText(properties.parkregel_gruppe),
      classification: optionalText(properties.geoportal_class),
      area: optionalText(properties.prm_name),
    };

    pieces.forEach((piece, pieceIndex) => {
      rows.push({
        id: `${sourceId}:${piece.tileId}:${pieceIndex}`,
        sourceId,
        tileId: piece.tileId,
        points: piece.points.map((point) => roundPoint(point, digits)),
        capacity: capacities[pieceIndex],
        sourceCapacity: eligibility.capacity,
        sourceStartMeters: round(piece.sourceStartMeters, digits),
        sourceLengthMeters: round(totalSourceLength, digits),
        street: optionalText(properties.strasse),
        regulation,
        sourceRefs: [{ ...sourceRef }],
      });
    });
    sourceRows += 1;
    sourceCapacity += eligibility.capacity;
  }

  return {
    rows,
    skipped,
    source: {
      dataset,
      license,
      datasetUrl: MUNICH_PARKING_DATASET_URL,
      licenseUrl: MUNICH_PARKING_LICENSE_URL,
      featureType: MUNICH_PARKING_FEATURE_TYPE,
      crs: crs ?? "implicit WGS84",
      responseTimestamp: optionalText(featureCollection.timeStamp),
    },
    stats: {
      features: featureCollection.features.length,
      sourceRows,
      tileRows: rows.length,
      sourceCapacity,
      allocatedCapacity: rows.reduce((sum, row) => sum + row.capacity, 0),
      skipped: skipped.length,
      skippedByReason: Object.fromEntries(
        [...new Set(skipped.map((entry) => entry.reason))]
          .sort()
          .map((reason) => [reason, skipped.filter((entry) => entry.reason === reason).length]),
      ),
    },
  };
}

/** Group parsed rows for direct merging into each runtime tile's parkingRows array. */
export function groupParkingRowsByTile(rows) {
  const grouped = new Map();
  for (const row of rows ?? []) {
    if (!row || typeof row.tileId !== "string") continue;
    const tileRows = grouped.get(row.tileId) ?? [];
    tileRows.push(row);
    grouped.set(row.tileId, tileRows);
  }
  return grouped;
}
