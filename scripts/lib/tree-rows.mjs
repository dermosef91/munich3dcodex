export const DEFAULT_TREE_ROW_SPACING_METERS = 10;
export const MAX_TREES_PER_ROW = 10_000;

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
 * Expand an OSM tree-row centreline into deterministic inferred tree positions.
 * Every source vertex is retained because tree-row ways are drawn through trunk
 * bases; longer segments receive evenly spaced intermediate positions.
 */
export function sampleTreeRow(
  points,
  spacingMeters = DEFAULT_TREE_ROW_SPACING_METERS,
  maxTrees = MAX_TREES_PER_ROW,
) {
  const line = cleanPolyline(points);
  if (line.length < 2) return [];
  const spacing = Number.isFinite(spacingMeters) && spacingMeters > 0
    ? spacingMeters
    : DEFAULT_TREE_ROW_SPACING_METERS;
  const limit = Number.isInteger(maxTrees) && maxTrees >= 2 ? maxTrees : MAX_TREES_PER_ROW;
  const samples = [line[0]];

  for (let index = 1; index < line.length; index += 1) {
    const start = line[index - 1];
    const end = line[index];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (length === 0) continue;
    const intervals = Math.max(1, Math.round(length / spacing));
    if (samples.length + intervals > limit) {
      throw new Error(`Tree row exceeds the ${limit}-tree safety limit`);
    }
    for (let step = 1; step <= intervals; step += 1) {
      const progress = step / intervals;
      samples.push([
        start[0] + (end[0] - start[0]) * progress,
        start[1] + (end[1] - start[1]) * progress,
      ]);
    }
  }

  return samples.length >= 2 ? samples : [];
}

export class PointProximityIndex {
  constructor(cellSize = 4) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error("Cell size must be positive");
    this.cellSize = cellSize;
    this.buckets = new Map();
  }

  coordinates(point) {
    return [Math.floor(point[0] / this.cellSize), Math.floor(point[1] / this.cellSize)];
  }

  key(x, z) {
    return `${x}:${z}`;
  }

  add(point) {
    if (!finitePoint(point)) return;
    const [x, z] = this.coordinates(point);
    const key = this.key(x, z);
    const bucket = this.buckets.get(key) ?? [];
    bucket.push(point);
    this.buckets.set(key, bucket);
  }

  hasNearby(point, radius) {
    if (!finitePoint(point) || !Number.isFinite(radius) || radius < 0) return false;
    const [centerX, centerZ] = this.coordinates(point);
    const cells = Math.ceil(radius / this.cellSize);
    const radiusSquared = radius * radius;
    for (let x = centerX - cells; x <= centerX + cells; x += 1) {
      for (let z = centerZ - cells; z <= centerZ + cells; z += 1) {
        const bucket = this.buckets.get(this.key(x, z)) ?? [];
        if (bucket.some((candidate) => (
          (candidate[0] - point[0]) ** 2 + (candidate[1] - point[1]) ** 2
        ) <= radiusSquared)) return true;
      }
    }
    return false;
  }
}
