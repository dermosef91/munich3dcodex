import assert from "node:assert/strict";
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
      font: "",
      fillRect() {},
      fillText() {},
      measureText: (text) => ({ width: text.length * 24 }),
    };
  }

  getContext() {
    return this.context;
  }
};
const vite = await createServer({
  root,
  appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false },
});

const engine = new NullEngine({ renderWidth: 32, renderHeight: 32 });
const scene = new Scene(engine);

try {
  const { TramSystem } = await vite.ssrLoadModule("/src/world/tram.ts");
  const system = new TramSystem(scene, engine);
  const tile = {
    id: "renderer-test",
    tramTracks: [{
      id: "synthetic-track",
      kind: "tram",
      oneway: 1,
      points: [[0, 0], [0, 150], [0, 300]],
      sourceRefs: [],
    }],
  };

  const baseline = {
    meshes: scene.meshes.length,
    materials: scene.materials.length,
    textures: scene.textures.length,
  };
  system.addTile(tile);
  const railMeshes = scene.meshes.filter((mesh) => mesh.name.startsWith("tram-rails-"));
  assert.equal(railMeshes.length, 1);
  assert.equal(scene.meshes.filter((mesh) => mesh.name.startsWith("tram-catenary-")).length, 1);
  assert.equal(scene.meshes.filter((mesh) => mesh.name.includes("sleeper")).length, 0);
  const rails = railMeshes[0];
  assert.equal(rails.getClassName(), "Mesh", "rails must be shaded triangle geometry, not a screen-space LinesMesh");
  const positions = rails.getVerticesData("position");
  const colors = rails.getVerticesData("color");
  const indices = rails.getIndices();
  assert.ok(positions?.length && colors?.length && indices?.length, "volumetric rails need positions, colors, and triangle indices");
  const bounds = rails.getBoundingInfo().boundingBox;
  const railWidth = bounds.maximum.x - bounds.minimum.x;
  const railHeight = bounds.maximum.y - bounds.minimum.y;
  assert.ok(Math.abs(railWidth - 1.54) < 0.015, `rail pair should span gauge plus both heads, got ${railWidth.toFixed(3)} m`);
  assert.ok(Math.abs(railHeight - 0.041) < 0.003, `rail heads should have physical height, got ${railHeight.toFixed(3)} m`);
  const point = (vertex) => positions.slice(vertex * 3, vertex * 3 + 3);
  const [a, b, c] = indices.slice(0, 3).map(point);
  const ab = b.map((value, index) => value - a[index]);
  const ac = c.map((value, index) => value - a[index]);
  const normalY = ab[2] * ac[0] - ab[0] * ac[2];
  assert.ok(normalY > 0, "rail top triangles must face upward");
  assert.ok(colors.some((value, index) => index % 4 === 0 && value < 0.05), "rail mesh must include the dark inset groove");
  system.update();

  const firstLoad = {
    meshes: scene.meshes.length,
    materials: scene.materials.length,
    textures: scene.textures.length,
  };
  assert.equal(firstLoad.meshes - baseline.meshes, 22, "one tile and tram should add two infrastructure meshes and one 20-mesh model clone");

  system.removeTile(tile.id);
  system.update();
  assert.equal(scene.meshes.length, baseline.meshes, "removing the tile should retain only the disabled tram template");
  assert.equal(scene.materials.length, baseline.materials, "removing a tram tile must not leak materials");
  assert.equal(scene.textures.length, baseline.textures, "removing a tram tile must not leak destination textures");

  system.addTile(tile);
  system.update();
  assert.equal(scene.meshes.length, firstLoad.meshes, "reloading a tile must keep a stable mesh count");
  assert.equal(scene.materials.length, firstLoad.materials, "reloading a tile must keep a stable material count");
  assert.equal(scene.textures.length, firstLoad.textures, "reloading a tile must keep a stable texture count");

  process.stdout.write(
    `Tram renderer valid: volumetric 10.5 cm grooved rails in 2 infrastructure meshes/tile, 20 meshes/tram, ${firstLoad.materials} shared materials, ${firstLoad.textures} shared texture.\n`,
  );
} finally {
  scene.dispose();
  engine.dispose();
  await vite.close();
}
