import assert from "node:assert/strict";
import path from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { createServer } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const tileId = "multipolygon-hole";
const buildingHole = [[-5, -5], [5, -5], [5, 5], [-5, 5]];
const greenHole = [[35, -5], [45, -5], [45, 5], [35, 5]];
const tile = {
  id: tileId,
  center: [20, 0],
  buildings: [{
    id: -1001,
    outline: [[-20, -20], [20, -20], [20, 20], [-20, 20]],
    holes: [buildingHole],
    height: 14,
    source: "osm",
    kind: "apartments",
  }],
  roads: [],
  tramTracks: [],
  greens: [{
    id: "relation/2:outer/0",
    outline: [[25, -20], [55, -20], [55, 20], [25, 20]],
    holes: [greenHole],
    kind: "green",
  }],
  trees: [],
  streetLamps: [],
  benches: [],
  parking: [],
  parkingRows: [],
  businesses: [],
};

function pointInTriangle([px, pz], a, b, c) {
  const sign = (p1, p2, p3) => (
    (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
  );
  const first = sign([px, pz], a, b);
  const second = sign([px, pz], b, c);
  const third = sign([px, pz], c, a);
  return !((first < 0 || second < 0 || third < 0) && (first > 0 || second > 0 || third > 0));
}

function meshCoversPoint(mesh, point) {
  const positions = mesh.getVerticesData("position") ?? [];
  const indices = mesh.getIndices() ?? [];
  for (let index = 0; index < indices.length; index += 3) {
    const triangle = indices.slice(index, index + 3).map((vertex) => [
      positions[vertex * 3],
      positions[vertex * 3 + 2],
    ]);
    if (pointInTriangle(point, triangle[0], triangle[1], triangle[2])) return true;
  }
  return false;
}

const vite = await createServer({
  root,
  appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false },
});
const engine = new NullEngine({ renderWidth: 32, renderHeight: 32 });
const scene = new Scene(engine);
scene.useRightHandedSystem = true;

try {
  const { buildTileMeshSet } = await vite.ssrLoadModule("/src/world/meshBuilders.ts");
  const built = buildTileMeshSet(tile, 100, scene);
  const roof = built.meshes.find((mesh) => mesh.name === `building-roofs-${tileId}`);
  const green = built.meshes.find((mesh) => mesh.name === `greens-grass-${tileId}`);
  assert.ok(roof, "multipolygon fixture must produce a building roof");
  assert.ok(green, "multipolygon fixture must produce a green surface");
  assert.equal(meshCoversPoint(roof, [0, 0]), false, "building courtyard must remain open");
  assert.equal(meshCoversPoint(roof, [-12, 0]), true, "building outer ring must remain filled");
  assert.equal(meshCoversPoint(green, [40, 0]), false, "green inner ring must remain open");
  assert.equal(meshCoversPoint(green, [30, 0]), true, "green outer ring must remain filled");

  const facadePositions = built.meshes
    .filter((mesh) => mesh.name.startsWith("building-walls-"))
    .flatMap((mesh) => [...(mesh.getVerticesData("position") ?? [])]);
  let courtyardWallVertices = 0;
  for (let index = 0; index < facadePositions.length; index += 3) {
    const x = facadePositions[index];
    const y = facadePositions[index + 1];
    const z = facadePositions[index + 2];
    if ((Math.abs(Math.abs(x) - 5) < 1e-6 || Math.abs(Math.abs(z) - 5) < 1e-6)
      && (Math.abs(y) < 1e-6 || Math.abs(y - 14) < 1e-6)) {
      courtyardWallVertices += 1;
    }
  }
  assert.ok(courtyardWallVertices >= 16, "building courtyard must receive inward-facing wall geometry");

  for (const mesh of built.meshes) mesh.dispose(false, false);
  process.stdout.write("OSM multipolygon rendering valid: building/green holes stay open and courtyard walls are emitted.\n");
} finally {
  scene.dispose();
  engine.dispose();
  await vite.close();
}
