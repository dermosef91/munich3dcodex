import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readRuntimeTile } from "./lib/runtime-tile.mjs";

const root = path.resolve(import.meta.dirname, "..");
const dataDirectory = path.join(root, "public", "data");
const meshPath = path.join(root, "src", "world", "meshBuilders.ts");
const materialPath = path.join(root, "src", "world", "photorealFacadeMaterials.ts");
const nordbadTilePath = path.join(root, "public", "data", "tiles", "-2_-3.json");
const gableTilePath = path.join(root, "public", "data", "tiles", "-1_-2.json");

const [meshSource, materialSource, nordbadTile, gableTile] = await Promise.all([
  readFile(meshPath, "utf8"),
  readFile(materialPath, "utf8"),
  readRuntimeTile(nordbadTilePath, dataDirectory),
  readRuntimeTile(gableTilePath, dataDirectory),
]);

function signedRingArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area * 0.5;
}

function ringPerimeter(points) {
  let perimeter = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    perimeter += Math.hypot(next[0] - current[0], next[1] - current[1]);
  }
  return perimeter;
}

function effectiveFootprintThickness(points) {
  const perimeter = ringPerimeter(points);
  return perimeter > 1e-6 ? (2 * Math.abs(signedRingArea(points))) / perimeter : 0;
}

function triangleComponents(surface) {
  const triangleCount = Math.floor(surface.indices.length / 3);
  const trianglesByVertex = new Map();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = surface.indices[triangle * 3 + corner];
      const uses = trianglesByVertex.get(vertex);
      if (uses) uses.push(triangle);
      else trianglesByVertex.set(vertex, [triangle]);
    }
  }

  const visited = new Set();
  const components = [];
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    if (visited.has(triangle)) continue;
    const queue = [triangle];
    const component = [];
    visited.add(triangle);
    while (queue.length > 0) {
      const current = queue.pop();
      component.push(current);
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = surface.indices[current * 3 + corner];
        for (const neighbor of trianglesByVertex.get(vertex) ?? []) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    components.push(component);
  }
  return components;
}

function componentVertexIds(surface, triangles) {
  const vertices = new Set();
  for (const triangle of triangles) {
    vertices.add(surface.indices[triangle * 3]);
    vertices.add(surface.indices[triangle * 3 + 1]);
    vertices.add(surface.indices[triangle * 3 + 2]);
  }
  return [...vertices];
}

function componentEave(surface, vertexIds, floorHeightM = 3) {
  const heights = vertexIds.map((vertex) => surface.positions[vertex * 3 + 1]);
  const minimum = Math.min(...heights);
  const maximum = Math.max(...heights);
  const span = maximum - minimum;
  if (span < 1) return undefined;

  const upperHeights = heights.filter((height) => height >= minimum + span * 0.55);
  if (upperHeights.length < 2) return undefined;
  const eave = Math.min(...upperHeights);
  const minimumCapHeight = Math.max(0.75, floorHeightM * 0.24);
  return maximum - eave >= minimumCapHeight ? { eave, maximum } : undefined;
}

// This is the long, low freestanding Nordbad wall from Bavarian LoD2, not an
// occupied building. Its half-metre footprint must take a neutral facade.
const nordbadWall = nordbadTile.buildings.find((building) => building.id === -735856278);
assert.ok(nordbadWall, "Nordbad boundary wall is missing from runtime tile -2_-3");
assert.equal(nordbadWall.sourceId, "DEBY_LOD2_108538566");
const nordbadThickness = effectiveFootprintThickness(nordbadWall.outline);
assert.ok(
  nordbadThickness > 0.45 && nordbadThickness < 0.55,
  `Nordbad wall thickness drifted unexpectedly: ${nordbadThickness.toFixed(3)} m`,
);
assert.match(
  meshSource,
  /effectiveFootprintThickness\(ring\) < 1\.25/,
  "the windowless classifier must catch thin wall footprints such as Nordbad",
);
assert.ok(nordbadThickness < 1.25, "Nordbad wall must classify as wholly neutral");

// Building 80953927 has a half-hipped LoD2 end wall with eaves around 16.85 m
// and a ridge at 23.14 m. Geometry above the eave is a neutral cap.
const gabledBuilding = gableTile.buildings.find((building) => building.id === 80953927);
assert.ok(gabledBuilding?.geometry?.walls, "gabled LoD2 regression fixture is missing");
const wallSurface = gabledBuilding.geometry.walls;
const caps = triangleComponents(wallSurface)
  .map((component) => componentEave(wallSurface, componentVertexIds(wallSurface, component)))
  .filter(Boolean);
assert.ok(caps.length >= 1, "real half-hipped facade must expose at least one gable cap");
const expectedCap = caps.find(({ eave, maximum }) =>
  eave > 16.7 && eave < 17.0 && maximum > 23.0 && maximum < 23.3);
assert.ok(expectedCap, `expected 16.85 m eave / 23.14 m ridge, got ${JSON.stringify(caps)}`);
assert.ok(expectedCap.maximum - expectedCap.eave > 6, "gable cap must have meaningful height");
assert.match(meshSource, /function componentEaveHeight\(/);
assert.match(
  meshSource,
  /appendSurfacePolygon\(\s*neutralTarget,\s*clipSurfacePolygonAtHeight\(polygon, eave, false\)/,
  "geometry above a detected eave must be emitted into neutral buffers",
);

// Neutral is a primary wall/cap layer. Only shallow ground overlay shells may
// be biased toward the camera in depth-buffer space.
assert.match(
  materialSource,
  /if \(layer === "ground-residential" \|\| layer === "ground-retail"\) \{[\s\S]*?material\.zOffset\s*=/,
  "ground shell depth bias must be restricted to the two ground layers",
);
assert.doesNotMatch(
  materialSource,
  /if \(layer !== "upper"\) \{[\s\S]*?material\.zOffset/,
  "neutral walls and caps must not inherit the ground shell zOffset",
);

process.stdout.write(
  `Neutral facade regressions valid: Nordbad wall ${nordbadThickness.toFixed(3)} m thick; `
    + `${caps.length} real gable cap(s) detected; neutral material has no ground-shell depth bias.\n`,
);
