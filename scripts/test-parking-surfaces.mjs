import assert from "node:assert/strict";
import path from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Scene } from "@babylonjs/core/scene.js";
import { createServer } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const vite = await createServer({
  root,
  appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false },
});

function ribbonLayout(overrides = {}) {
  return {
    slots: [],
    surfaces: [{
      kind: "ribbon",
      id: "parking-surface:test-row",
      source: "municipal-row",
      sourceId: "parkseite/test-row",
      points: [[0, 0], [20, 0]],
      width: 2.4,
    }],
    exclusions: [],
    ...overrides,
  };
}

function upwardNormalY(positions, indices, triangleOffset = 0) {
  const ids = indices.slice(triangleOffset, triangleOffset + 3);
  const points = ids.map((id) => positions.slice(id * 3, id * 3 + 3));
  const ab = points[1].map((value, index) => value - points[0][index]);
  const ac = points[2].map((value, index) => value - points[0][index]);
  return ab[2] * ac[0] - ab[0] * ac[2];
}

function triangleCentroids(geometry) {
  const centroids = [];
  for (let index = 0; index < geometry.indices.length; index += 3) {
    const ids = geometry.indices.slice(index, index + 3);
    const points = ids.map((id) => [geometry.positions[id * 3], geometry.positions[id * 3 + 2]]);
    centroids.push([
      points.reduce((sum, point) => sum + point[0], 0) / 3,
      points.reduce((sum, point) => sum + point[1], 0) / 3,
    ]);
  }
  return centroids;
}

const engine = new NullEngine({ renderWidth: 32, renderHeight: 32 });
const scene = new Scene(engine);
scene.useRightHandedSystem = true;

try {
  const {
    PARKING_BAND_SURFACE_Y,
    PARKING_BOUNDARY_SURFACE_Y,
    PARKING_BOUNDARY_WIDTH,
    buildParkingSurfaceGeometry,
    buildParkingSurfaceMeshes,
  } = await vite.ssrLoadModule("/src/world/parkingSurfaces.ts");
  const cobblestoneMaterial = new StandardMaterial("existing-cobblestone-material", scene);
  const boundaryMaterial = new StandardMaterial("existing-curb-top-material", scene);

  const full = buildParkingSurfaceGeometry(ribbonLayout(), 4);
  assert.equal(full.renderedSurfaces, 1);
  assert.equal(full.bands.positions.length, 12, "one straight ribbon must use four vertices");
  assert.equal(full.bands.indices.length, 6, "one straight ribbon must use two triangles");
  assert.equal(full.boundaries.positions.length, 24, "the two continuous edges must use eight vertices");
  assert.equal(full.boundaries.indices.length, 12, "the two continuous edges must use four triangles");
  assert.deepEqual(
    full.bands.uvs,
    [0, 0.3, 5, 0.3, 5, -0.3, 0, -0.3],
    "parking UVs must retain the four-metre world-space cobblestone phase",
  );
  assert.ok(upwardNormalY(full.bands.positions, full.bands.indices) > 0, "parking triangles must face +Y");
  assert.equal("dividers" in full, false, "parking geometry must not expose bay-line buffers");
  assert.equal(PARKING_BOUNDARY_WIDTH, 0.1, "separation must be a narrow curb strip, not a bay marking");

  const clipped = buildParkingSurfaceGeometry(ribbonLayout({
    exclusions: [{
      id: "crossing-mask",
      reason: "crossing",
      outline: [[8, -2], [12, -2], [12, 2], [8, 2]],
    }],
  }), 4);
  assert.ok(clipped.bands.indices.length > 0, "parking must remain visible on both sides of a crossing");
  for (const [x, z] of triangleCentroids(clipped.bands)) {
    assert.equal(
      x > 8 + 1e-5 && x < 12 - 1e-5 && z > -2 + 1e-5 && z < 2 - 1e-5,
      false,
      "clipped parking triangles must not cover a crossing mask",
    );
  }
  for (const [x, z] of triangleCentroids(clipped.boundaries)) {
    assert.equal(
      x > 8 + 1e-5 && x < 12 - 1e-5 && z > -2 + 1e-5 && z < 2 - 1e-5,
      false,
      "continuous boundaries must be clipped by the same crossing mask",
    );
  }

  const polygon = buildParkingSurfaceGeometry({
    slots: [],
    surfaces: [{
      kind: "polygon",
      id: "parking-surface:osm:lot",
      source: "osm-parking-area",
      sourceId: "osm:way/lot",
      outline: [[30, 0], [40, 0], [40, 8], [30, 8]],
    }],
    exclusions: [],
  }, 4);
  assert.equal(polygon.bands.indices.length, 6, "mapped parking lots must render as cobblestone polygons");
  assert.equal(polygon.boundaries.indices.length, 24, "mapped lot perimeter must get one continuous separator");

  assert.throws(
    () => buildParkingSurfaceGeometry(ribbonLayout(), 0),
    /positive distance/,
    "invalid texture repeats must fail before producing broken UVs",
  );
  assert.deepEqual(
    buildParkingSurfaceGeometry(ribbonLayout(), 4),
    full,
    "parking geometry must be deterministic",
  );

  const meshes = buildParkingSurfaceMeshes(
    "parking-surface-test",
    ribbonLayout(),
    scene,
    cobblestoneMaterial,
    boundaryMaterial,
    4,
  );
  assert.deepEqual(
    meshes.map((mesh) => mesh.name),
    ["parking-bands-parking-surface-test", "parking-boundaries-parking-surface-test"],
    "one tile must use one surface batch and one continuous-boundary batch",
  );
  const [bandMesh, boundaryMesh] = meshes;
  assert.equal(bandMesh.material, cobblestoneMaterial, "the existing cobblestone material must be reused");
  assert.equal(boundaryMesh.material, boundaryMaterial, "the existing curb material must be reused");
  assert.equal(bandMesh.checkCollisions, false);
  assert.equal(boundaryMesh.checkCollisions, false);
  assert.equal(bandMesh.isPickable, false);
  assert.equal(boundaryMesh.isPickable, false);
  assert.deepEqual(bandMesh.metadata, {
    kind: "parking-surface",
    canonicalLayout: true,
    surface: "cobblestone",
    bayDemarcation: false,
  });
  assert.deepEqual(boundaryMesh.metadata, {
    kind: "parking-boundary",
    canonicalLayout: true,
    continuous: true,
    bayDemarcation: false,
  });
  assert.ok(
    (bandMesh.getVerticesData("position") ?? []).every(
      (value, index) => index % 3 !== 1 || value === PARKING_BAND_SURFACE_Y,
    ),
  );
  assert.ok(
    (boundaryMesh.getVerticesData("position") ?? []).every(
      (value, index) => index % 3 !== 1 || value === PARKING_BOUNDARY_SURFACE_Y,
    ),
  );
  assert.equal(
    meshes.some((mesh) => mesh.name.startsWith("parking-bay-dividers-")),
    false,
    "individual bay demarcation meshes must stay disabled",
  );

  assert.deepEqual(
    buildParkingSurfaceMeshes("empty", undefined, scene, cobblestoneMaterial, boundaryMaterial, 4),
    [],
  );

  process.stdout.write(
    "Parking surfaces valid: canonical cobblestone, continuous edge separation, exact exclusion masks, and no bay lines.\n",
  );
} finally {
  scene.dispose();
  engine.dispose();
  await vite.close();
}
