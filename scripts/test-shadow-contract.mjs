import assert from "node:assert/strict";
import path from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Scene } from "@babylonjs/core/scene.js";
import { createServer } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const vite = await createServer({
  root,
  appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false },
});

const engine = new NullEngine({ renderWidth: 64, renderHeight: 64 });
const scene = new Scene(engine);
scene.useRightHandedSystem = true;
const camera = new UniversalCamera("shadow-test-camera", new Vector3(0, 1.75, 0), scene);

try {
  const [shadowModule, groundModule, treeModule, meshModule, fallbackModule] = await Promise.all([
    vite.ssrLoadModule("/src/world/SunShadowController.ts"),
    vite.ssrLoadModule("/src/world/GroundShadowSystem.ts"),
    vite.ssrLoadModule("/src/world/treeAssets.ts"),
    vite.ssrLoadModule("/src/world/meshBuilders.ts"),
    vite.ssrLoadModule("/src/world/fallback.ts"),
  ]);
  const {
    parseShadowQuality,
    resolveShadowQuality,
    SHADOW_PROFILES,
  } = shadowModule;

  assert.equal(parseShadowQuality("HIGH"), "high");
  assert.equal(parseShadowQuality("ultra"), null);
  assert.equal(resolveShadowQuality(new URLSearchParams("shadows=off")), "off");
  assert.equal(resolveShadowQuality(new URLSearchParams()), "medium");
  assert.equal(SHADOW_PROFILES.medium.mapSize, 1_024);
  assert.equal(SHADOW_PROFILES.medium.cascades, 2);
  assert.ok(SHADOW_PROFILES.medium.maxDistance < 200, "default shadows must stay near the player");
  assert.equal(SHADOW_PROFILES.medium.filteringQuality, 2, "default PCF must use Babylon's low-cost quality");
  assert.equal(SHADOW_PROFILES.low.includeTrees, true, "trees must cast at every enabled quality tier");

  const fallbackTile = fallbackModule.createFallbackTile("shadow-contract", [0, 0], 100);
  const frontageBuilding = fallbackTile.buildings[0];
  const frontageStart = frontageBuilding.outline[0];
  const frontageEnd = frontageBuilding.outline[1];
  const frontageLength = Math.hypot(
    frontageEnd[0] - frontageStart[0],
    frontageEnd[1] - frontageStart[1],
  );
  const frontageTangent = [
    (frontageEnd[0] - frontageStart[0]) / frontageLength,
    (frontageEnd[1] - frontageStart[1]) / frontageLength,
  ];
  const frontageAnchor = [
    (frontageStart[0] + frontageEnd[0]) / 2,
    (frontageStart[1] + frontageEnd[1]) / 2,
  ];
  fallbackTile.greens.push(
    { kind: "green", outline: [[-42, -42], [-34, -42], [-34, -34], [-42, -34]] },
    { kind: "water", outline: [[34, 34], [42, 34], [42, 42], [34, 42]] },
  );
  fallbackTile.businesses = [{
    id: "node/401302835",
    point: frontageAnchor,
    name: "Shadow Contract Bakery",
    category: "bakery",
    frontage: {
      buildingId: frontageBuilding.id,
      anchor: frontageAnchor,
      tangent: frontageTangent,
      outward: [-frontageTangent[1], frontageTangent[0]],
      width: Math.min(5, frontageLength - 0.5),
    },
    sourceRefs: [],
  }];
  fallbackTile.streetLamps = [{ id: 1, point: [20, 20], height: 6, sourceRefs: [] }];
  fallbackTile.benches = [{ id: 2, point: [22, 20], direction: 90, sourceRefs: [] }];
  const tileMeshes = meshModule.buildTileMeshSet(fallbackTile, 100, scene);
  const tileMeshNames = new Set(tileMeshes.meshes.map((mesh) => mesh.name));
  const receiverNames = new Set(tileMeshes.shadowReceivers.map((mesh) => mesh.name));
  assert.ok(tileMeshes.buildingShadowCasters.length > 0, "fallback buildings must cast sun shadows");
  assert.ok(
    tileMeshes.buildingShadowCasters.every((mesh) => mesh.name.startsWith("building-")),
    "only merged building batches belong in the static caster list",
  );
  assert.ok(
    receiverNames.has("ground-shadow-contract"),
    "tile ground must receive shadows",
  );
  assert.ok(
    [...receiverNames].some((name) => name.startsWith("roads-")),
    "road surfaces must receive shadows",
  );
  assert.ok(receiverNames.has("greens-grass-shadow-contract"), "grass must receive shadows");
  assert.ok(
    tileMeshNames.has("greens-water-shadow-contract"),
    "the fixture must include water so its exclusion is meaningful",
  );
  assert.ok(
    [...tileMeshNames].some((name) => name.startsWith("storefront-")),
    "the fixture must include storefront detail so its exclusion is meaningful",
  );
  assert.ok(
    tileMeshNames.has("street-furniture-shadow-contract")
      && tileMeshNames.has("street-lights-shadow-contract"),
    "the fixture must include both furniture batches",
  );
  assert.ok(
    [...receiverNames].every((name) => (
      name === "ground-shadow-contract"
      || name.startsWith("roads-")
      || name === "greens-grass-shadow-contract"
      || name.startsWith("building-")
    )),
    "only ground, roads, grass, and buildings may use receiver shaders",
  );
  for (const excludedName of [
    "greens-water-shadow-contract",
    "street-furniture-shadow-contract",
    "street-lights-shadow-contract",
  ]) {
    assert.equal(receiverNames.has(excludedName), false, `${excludedName} must not receive sun shadows`);
  }
  assert.ok(
    [...receiverNames].every((name) => !name.startsWith("storefront-")),
    "storefront detail must stay outside the receiver shader workload",
  );

  const treeRenderer = await treeModule.TreeAssetRenderer.Load(scene);
  const treeMeshes = treeRenderer.createTileMeshes("shadow-contract", [
    { id: 1, point: [4, 5], height: 10 },
    { id: 2, point: [12, 15], height: 13 },
    { id: 3, point: [-8, 18], height: 8 },
  ]);
  assert.equal(treeMeshes.meshes.length, 2, "one tile must use only one stem and one canopy mesh");
  assert.deepEqual(treeMeshes.shadowCasters, treeMeshes.meshes, "both instanced tree batches cast");
  for (const mesh of treeMeshes.meshes) {
    assert.equal(mesh.instances.length, 2, `${mesh.name} must instance every tree after its source tree`);
  }

  const sun = new DirectionalLight("shadow-contract-sun", new Vector3(-0.4, -1, 0.25), scene);
  const controller = new shadowModule.SunShadowController(scene, camera, sun, "medium");
  const fakeShadowMap = {
    renderList: [],
    refreshRate: 0,
    resetCount: 0,
    resetRefreshCounter() { this.resetCount += 1; },
  };
  const freezeTransitions = [];
  const fakeGenerator = {
    compileOptions: [],
    disposed: false,
    addShadowCaster(mesh) {
      if (!fakeShadowMap.renderList.includes(mesh)) fakeShadowMap.renderList.push(mesh);
    },
    removeShadowCaster(mesh) {
      const index = fakeShadowMap.renderList.indexOf(mesh);
      if (index >= 0) fakeShadowMap.renderList.splice(index, 1);
    },
    getShadowMap() { return fakeShadowMap; },
    async forceCompilationAsync(options) { this.compileOptions.push(options); },
    dispose() { this.disposed = true; },
  };
  Object.defineProperty(fakeGenerator, "freezeShadowCastersBoundingInfo", {
    get: () => freezeTransitions.at(-1) ?? false,
    set: (value) => freezeTransitions.push(value),
  });
  Object.defineProperty(controller, "generator", { value: fakeGenerator, writable: true });
  const controllerMeshes = {
    buildingCasters: [tileMeshes.buildingShadowCasters[0]],
    treeCasters: treeMeshes.shadowCasters,
    receivers: [tileMeshes.shadowReceivers[0]],
  };
  controller.registerTile("shadow-controller", controllerMeshes);
  assert.equal(fakeShadowMap.renderList.length, 3, "medium must register one building and two tree batches");
  assert.equal(controllerMeshes.receivers[0].receiveShadows, true);
  controller.setTreeCastersEnabled(false);
  assert.equal(fakeShadowMap.renderList.length, 1, "adaptive fallback must retain buildings while removing trees");
  assert.equal(controller.treeShadowsEnabled, false);
  controller.setTreeCastersEnabled(true);
  assert.equal(fakeShadowMap.renderList.length, 3, "tree shadows must recover without rebuilding the tile");
  assert.equal(controller.treeShadowsEnabled, true);
  controller.registerTile("shadow-controller", controllerMeshes);
  assert.equal(fakeShadowMap.renderList.length, 3, "re-registering a streamed tile must not duplicate casters");
  assert.deepEqual(freezeTransitions.slice(-2), [false, true], "streaming must refreeze caster bounds");
  assert.ok(fakeShadowMap.resetCount >= 2, "streaming changes must reset the shadow refresh counter");
  controller.registerDynamicCasters("vehicle", [tileMeshes.shadowReceivers[0]]);
  assert.equal(fakeShadowMap.renderList.length, 4, "vehicle geometry must join the sun shadow pass");
  assert.equal(freezeTransitions.at(-1), false, "moving casters must retain live shadow bounds");
  controller.registerDynamicCasters("vehicle", [tileMeshes.shadowReceivers[0]]);
  assert.equal(fakeShadowMap.renderList.length, 4, "re-registering a vehicle must not duplicate casters");
  controller.unregisterDynamicCasters("vehicle");
  assert.equal(fakeShadowMap.renderList.length, 3, "disposing a vehicle must remove its sun casters");
  assert.equal(freezeTransitions.at(-1), true, "static-only caster bounds may be frozen again");
  await controller.compile();
  assert.deepEqual(fakeGenerator.compileOptions, [
    { useInstances: false },
    { useInstances: true },
  ]);
  controller.unregisterTile("shadow-controller");
  assert.equal(fakeShadowMap.renderList.length, 0, "unloading a tile must remove all of its casters");
  assert.equal(controllerMeshes.receivers[0].receiveShadows, false);
  controller.dispose();
  assert.equal(fakeGenerator.disposed, true);

  const groundShadows = new groundModule.GroundShadowSystem(scene, camera, 120);
  const vehicle = new TransformNode("shadow-contract-vehicle", scene);
  vehicle.position.set(8, 0.05, 12);
  groundShadows.register("vehicle", vehicle, { width: 2, length: 4.6 });
  groundShadows.update();
  const contactBatch = scene.getMeshByName("ground-contact-shadow-batch");
  assert.ok(contactBatch, "contact-shadow batch must exist");
  assert.equal(contactBatch.renderingGroupId, 0, "contact shadows must retain opaque-scene depth occlusion");
  assert.equal(contactBatch.thinInstanceCount, 1, "one nearby vehicle needs one contact-shadow instance");

  vehicle.position.x = 250;
  groundShadows.update();
  assert.equal(contactBatch.thinInstanceCount, 0, "far contact shadows must be distance culled");
  vehicle.position.x = 8;
  vehicle.setEnabled(false);
  groundShadows.update();
  assert.equal(contactBatch.thinInstanceCount, 0, "disabled vehicles must not leave contact shadows");
  vehicle.setEnabled(true);
  groundShadows.update();
  assert.equal(contactBatch.thinInstanceCount, 1);
  groundShadows.unregister("vehicle");
  groundShadows.update();
  assert.equal(contactBatch.thinInstanceCount, 0, "unregistering must remove the contact shadow");

  groundShadows.dispose();
  treeRenderer.dispose();
  process.stdout.write(
    "Shadow contract valid: bounded quality tiers, tree and vehicle sun casters, explicit tile roles, and one-draw contact shadows.\n",
  );
} finally {
  scene.dispose();
  engine.dispose();
  await vite.close();
}
