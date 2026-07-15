import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { createServer } from "vite";

const root = path.resolve(import.meta.dirname, "..");
globalThis.OffscreenCanvas ??= class OffscreenCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.context = {
      fillStyle: "",
      strokeStyle: "",
      font: "",
      lineWidth: 1,
      textAlign: "left",
      textBaseline: "alphabetic",
      globalAlpha: 1,
      fillRect() {},
      strokeRect() {},
      fillText() {},
      measureText: (text) => ({ width: text.length * 24 }),
    };
  }

  getContext() {
    return this.context;
  }
};
const manifest = JSON.parse(await readFile(path.join(root, "public", "data", "manifest.json"), "utf8"));
const tiles = await Promise.all(manifest.tiles.map(async (entry) => {
  const file = entry.file.replace(/^\//, "");
  const tile = JSON.parse(await readFile(path.join(root, "public", file), "utf8"));
  const pedestrianRoads = tile.roads.filter(
    (road) => road.footway === "crossing"
      || road.footway === "sidewalk"
      || ["footway", "path", "pedestrian", "steps"].includes(road.kind),
  ).length;
  const parkingRows = tile.parkingRows?.length ?? 0;
  return {
    entry,
    tile,
    pedestrianRoads,
    parkingRows,
    score: tile.buildings.length + parkingRows * 2 + pedestrianRoads,
  };
}));
const candidates = tiles
  .filter((candidate) => candidate.parkingRows > 0 && candidate.pedestrianRoads > 0)
  .sort((left, right) => left.score - right.score || left.tile.id.localeCompare(right.tile.id));
const selected = candidates[0];
assert.ok(selected?.tile.parkingRows?.length > 0, "runtime data must include a parking-rich integration tile");

const vite = await createServer({
  root,
  appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false },
});
const engine = new NullEngine({ renderWidth: 32, renderHeight: 32 });
const scene = new Scene(engine);
scene.useRightHandedSystem = true;

function centroids(mesh) {
  const positions = mesh.getVerticesData("position") ?? [];
  const indices = mesh.getIndices() ?? [];
  const result = [];
  for (let index = 0; index < indices.length; index += 3) {
    const ids = indices.slice(index, index + 3);
    result.push([
      ids.reduce((sum, id) => sum + positions[id * 3], 0) / 3,
      ids.reduce((sum, id) => sum + positions[id * 3 + 2], 0) / 3,
    ]);
  }
  return result;
}

try {
  const { buildTileMeshSet } = await vite.ssrLoadModule("/src/world/meshBuilders.ts");
  const {
    parkingLayoutContainsPoint,
    parkingSlotContainsPoint,
    pointInPolygon,
  } = await vite.ssrLoadModule("/src/world/parkingLayout.ts");
  const built = buildTileMeshSet(selected.tile, manifest.tileSize, scene);
  const layout = built.parkingLayout;
  assert.ok(layout.surfaces.length > 0, "the shared runtime layout must expose parking surfaces");
  assert.ok(layout.slots.length > 0, "the shared runtime layout must expose eligible car slots");
  assert.ok(layout.exclusions.length > 0, "rendered pedestrian geometry must provide exact masks");

  for (const slot of layout.slots) {
    const surface = layout.surfaces.find((candidate) => candidate.id === slot.surfaceId);
    assert.ok(surface, `${slot.id} must link to a rendered surface`);
    assert.equal(parkingSlotContainsPoint(slot, surface), true, `${slot.id} must lie on its linked surface`);
    assert.equal(parkingLayoutContainsPoint(layout, slot.point), true, `${slot.id} must avoid pedestrian masks`);
  }

  const band = built.meshes.find((mesh) => mesh.name === `parking-bands-${selected.tile.id}`);
  const boundary = built.meshes.find((mesh) => mesh.name === `parking-boundaries-${selected.tile.id}`);
  assert.ok(band, "the canonical runtime layout must produce a cobblestone batch");
  assert.ok(boundary, "the canonical runtime layout must produce a continuous separator batch");
  assert.ok(band.material?.diffuseTexture?.url?.endsWith("munich-cobblestone-v1.png"));
  assert.equal(boundary.metadata?.continuous, true);
  assert.equal(boundary.metadata?.bayDemarcation, false);
  assert.equal(
    built.meshes.some((mesh) => mesh.name.startsWith("parking-bay-dividers-")),
    false,
  );

  for (const mesh of [band, boundary]) {
    for (const point of centroids(mesh)) {
      assert.equal(
        layout.exclusions.some((exclusion) => pointInPolygon(point, exclusion.outline)),
        false,
        `${mesh.name} must not cover rendered sidewalk/crossing triangles`,
      );
    }
  }

  for (const mesh of built.meshes) mesh.dispose(false, false);
  process.stdout.write(
    `Runtime parking valid in ${selected.tile.id}: ${layout.slots.length} linked slots, ${layout.surfaces.length} surfaces, ${layout.exclusions.length} pedestrian masks.\n`,
  );
} finally {
  scene.dispose();
  engine.dispose();
  await vite.close();
}
