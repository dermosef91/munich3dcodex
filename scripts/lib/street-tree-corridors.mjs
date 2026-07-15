export const DEFAULT_STREET_TREE_SPACING_METERS = 14;
export const DEFAULT_STREET_TREE_END_CLEARANCE_METERS = 9;
export const MAX_TREES_PER_STREET_CORRIDOR = 20_000;

function finitePoint(point) {
  return Array.isArray(point)
    && point.length === 2
    && Number.isFinite(point[0])
    && Number.isFinite(point[1]);
}

function cleanPolyline(points) {
  const cleaned = [];
  for (const point of points ?? []) {
    if (!finitePoint(point)) continue;
    const previous = cleaned.at(-1);
    if (previous && previous[0] === point[0] && previous[1] === point[1]) continue;
    cleaned.push(point);
  }
  return cleaned;
}

/**
 * Samples two setback rows beside a mapped street centreline.
 *
 * This is deliberately a presentation inference rather than a claim about
 * surveyed trunk positions. Samples are centred within the usable part of the
 * way and stay clear of way endpoints, which are commonly street junctions.
 */
export function sampleStreetTreeCorridor(points, options = {}) {
  const line = cleanPolyline(points);
  if (line.length < 2) return [];
  const spacing = Number.isFinite(options.spacingMeters) && options.spacingMeters > 0
    ? options.spacingMeters
    : DEFAULT_STREET_TREE_SPACING_METERS;
  const offset = Number.isFinite(options.offsetMeters) && options.offsetMeters > 0
    ? options.offsetMeters
    : 8;
  const endClearance = Number.isFinite(options.endClearanceMeters) && options.endClearanceMeters >= 0
    ? options.endClearanceMeters
    : DEFAULT_STREET_TREE_END_CLEARANCE_METERS;
  const limit = Number.isInteger(options.maxTrees) && options.maxTrees >= 2
    ? options.maxTrees
    : MAX_TREES_PER_STREET_CORRIDOR;

  const segments = [];
  let totalLength = 0;
  for (let index = 1; index < line.length; index += 1) {
    const start = line[index - 1];
    const end = line[index];
    const dx = end[0] - start[0];
    const dz = end[1] - start[1];
    const length = Math.hypot(dx, dz);
    if (length === 0) continue;
    segments.push({ start, dx, dz, length, startsAt: totalLength });
    totalLength += length;
  }
  if (segments.length === 0 || totalLength < endClearance * 2) return [];

  const usableLength = totalLength - endClearance * 2;
  const sampleCount = Math.floor(usableLength / spacing) + 1;
  if (sampleCount * 2 > limit) {
    throw new Error(`Street tree corridor exceeds the ${limit}-tree safety limit`);
  }
  const firstDistance = (totalLength - (sampleCount - 1) * spacing) * 0.5;
  const samples = [];
  let segmentIndex = 0;
  for (let ordinal = 0; ordinal < sampleCount; ordinal += 1) {
    const distance = firstDistance + ordinal * spacing;
    while (
      segmentIndex < segments.length - 1
      && distance > segments[segmentIndex].startsAt + segments[segmentIndex].length
    ) segmentIndex += 1;
    const segment = segments[segmentIndex];
    const progress = Math.max(0, Math.min(1, (distance - segment.startsAt) / segment.length));
    const center = [
      segment.start[0] + segment.dx * progress,
      segment.start[1] + segment.dz * progress,
    ];
    const normal = [-segment.dz / segment.length, segment.dx / segment.length];
    samples.push({
      point: [center[0] + normal[0] * offset, center[1] + normal[1] * offset],
      side: "left",
      ordinal,
    });
    samples.push({
      point: [center[0] - normal[0] * offset, center[1] - normal[1] * offset],
      side: "right",
      ordinal,
    });
  }
  return samples;
}

export function polygonObstacle(points) {
  const outline = cleanPolyline(points);
  if (outline.length < 3) return null;
  const xs = outline.map((point) => point[0]);
  const zs = outline.map((point) => point[1]);
  return {
    outline,
    minimum: [Math.min(...xs), Math.min(...zs)],
    maximum: [Math.max(...xs), Math.max(...zs)],
  };
}

function pointInPolygon(point, outline) {
  let inside = false;
  for (let index = 0, previous = outline.length - 1; index < outline.length; previous = index, index += 1) {
    const [xi, zi] = outline[index];
    const [xj, zj] = outline[previous];
    const crosses = (zi > point[1]) !== (zj > point[1])
      && point[0] < ((xj - xi) * (point[1] - zi)) / (zj - zi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  const progress = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared,
  ));
  return Math.hypot(
    point[0] - (start[0] + dx * progress),
    point[1] - (start[1] + dz * progress),
  );
}

/** Returns true for points inside or too close to a polygon obstacle. */
export function isNearPolygonObstacle(point, obstacle, clearanceMeters = 0) {
  if (!finitePoint(point) || !obstacle) return false;
  const clearance = Number.isFinite(clearanceMeters) && clearanceMeters > 0 ? clearanceMeters : 0;
  if (
    point[0] < obstacle.minimum[0] - clearance
    || point[0] > obstacle.maximum[0] + clearance
    || point[1] < obstacle.minimum[1] - clearance
    || point[1] > obstacle.maximum[1] + clearance
  ) return false;
  if (pointInPolygon(point, obstacle.outline)) return true;
  for (let index = 0; index < obstacle.outline.length; index += 1) {
    const start = obstacle.outline[index];
    const end = obstacle.outline[(index + 1) % obstacle.outline.length];
    if (distanceToSegment(point, start, end) <= clearance) return true;
  }
  return false;
}
