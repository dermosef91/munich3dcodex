import assert from "node:assert/strict";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Scene } from "@babylonjs/core/scene.js";
import { createServer } from "vite";

const GROUND_REPEAT_METERS = 8;

function close(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < 1e-5,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

function assertWorldGroundUvs(mesh) {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
  const uvs = mesh.getVerticesData(VertexBuffer.UVKind) ?? [];
  assert.equal(uvs.length, (positions.length / 3) * 2, `${mesh.name} must provide one UV pair per vertex`);
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    close(
      uvs[vertex * 2],
      (positions[vertex * 3] + mesh.position.x) / GROUND_REPEAT_METERS,
      `${mesh.name} U must derive from world X`,
    );
    close(
      uvs[vertex * 2 + 1],
      (positions[vertex * 3 + 2] + mesh.position.z) / GROUND_REPEAT_METERS,
      `${mesh.name} V must derive from world Z`,
    );
  }
}

const vite = await createServer({
  root: new URL("..", import.meta.url).pathname,
  appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false },
});

const engine = new NullEngine({ renderWidth: 32, renderHeight: 32 });
const scene = new Scene(engine);
scene.useRightHandedSystem = true;

try {
  const { buildTileMeshes } = await vite.ssrLoadModule("/src/world/meshBuilders.ts");
  const tile = {
    id: "material-contract",
    center: [0, 0],
    buildings: [
      {
        id: 1,
        outline: [[24, 0], [30, 0], [30, 6], [24, 6]],
        height: 9,
        source: "osm",
        sourceId: "osm:way/1",
        roofColor: "red",
      },
      {
        id: 2,
        outline: [[24, 8], [30, 8], [30, 14], [24, 14]],
        height: 9,
        source: "osm",
        sourceId: "osm:way/2",
        roofColor: "grey",
      },
    ],
    parkingRows: [
      {
        id: "parking-row-material-contract",
        sourceId: "parkseite/parking-row-material-contract",
        tileId: "material-contract",
        points: [[0, 22], [10, 22]],
        capacity: 2,
        sourceCapacity: 2,
        sourceStartMeters: 0,
        sourceLengthMeters: 10,
        regulation: {},
        sourceRefs: [],
      },
    ],
    roads: [
      { kind: "footway", surface: "asphalt", width: 2, points: [[0, 0], [10, 0]] },
      { kind: "residential", width: 6, points: [[0, 2], [10, 2]] },
      { kind: "residential", surface: "sett", width: 6, points: [[0, 4], [10, 4]] },
      {
        kind: "residential",
        surface: "paving_stones",
        sourceId: "osm:way/sidewalk",
        width: 6,
        points: [[0, 6], [10, 6]],
      },
      {
        kind: "footway",
        sourceId: "osm:way/sidewalk",
        width: 2,
        points: [[0, 8], [10, 8]],
      },
      { kind: "path", surface: "grass", width: 2, points: [[0, 10], [10, 10]] },
      { kind: "bridleway", surface: "sand", width: 2, points: [[0, 12], [10, 12]] },
      { kind: "service", surface: "paved", width: 4, points: [[0, 14], [10, 14]] },
      { kind: "footway", surface: "paved", width: 2, points: [[0, 16], [10, 16]] },
      { kind: "service", surface: "grass_paver", width: 4, points: [[0, 18], [10, 18]] },
    ],
    greens: [
      { kind: "green", outline: [[12, 0], [20, 0], [20, 8], [12, 8]] },
      { kind: "water", outline: [[12, 10], [20, 10], [20, 18], [12, 18]] },
    ],
  };

  const meshes = buildTileMeshes(tile, 32, scene);
  const byName = new Map(meshes.map((mesh) => [mesh.name, mesh]));
  const textureCases = [
    ["roads-asphalt-material-contract", "munich-asphalt-v1.png", 12],
    ["roads-cobblestone-material-contract", "munich-cobblestone-v1.png", 4],
    ["roads-compacted-material-contract", "munich-compacted-gravel-v1.png", 4],
    ["roads-grass-material-contract", "munich-park-grass-v2.png", 4],
    ["roads-sidewalk-material-contract", "munich-sidewalk-v2.png", 12],
    ["greens-grass-material-contract", "munich-park-grass-v2.png", 4],
    ["greens-water-material-contract", "munich-water-v1.png", 4],
    ["parking-bands-material-contract", "munich-cobblestone-v1.png", 4],
  ];

  for (const [name, textureFile, vertices] of textureCases) {
    const mesh = byName.get(name);
    assert.ok(mesh, `expected ${name}`);
    assert.equal(mesh.getTotalVertices(), vertices, `${name} must retain its classified geometry`);
    assert.ok(
      mesh.material?.diffuseTexture?.url?.endsWith(textureFile),
      `${name} must use ${textureFile}`,
    );
    const uvs = mesh.getVerticesData(VertexBuffer.UVKind) ?? [];
    assert.equal(uvs.length, vertices * 2, `${name} must provide one UV pair per vertex`);
    assert.ok(new Set(uvs).size > 1, `${name} UVs must vary so the texture can tile`);
  }

  const cobblestoneRoad = byName.get("roads-cobblestone-material-contract");
  const parkingBand = byName.get("parking-bands-material-contract");
  assert.ok(cobblestoneRoad && parkingBand, "cobblestone road and parking band must both exist");
  assert.equal(
    parkingBand.material,
    cobblestoneRoad.material,
    "parking must reuse the existing shared cobblestone material and texture instance",
  );
  assert.deepEqual(
    parkingBand.getVerticesData(VertexBuffer.UVKind),
    [0, 5.8, 2.5, 5.8, 2.5, 5.2, 0, 5.2],
    "parking cobblestones must retain the four-metre world-space texture phase",
  );
  const parkingBoundary = byName.get("parking-boundaries-material-contract");
  assert.ok(parkingBoundary, "parking must have a continuous perimeter separator");
  assert.equal(
    parkingBoundary.material?.name,
    "sidewalk-curb-top-material",
    "parking separation must reuse the existing curb-top material",
  );
  assert.equal(parkingBoundary.metadata?.continuous, true);
  assert.equal(parkingBoundary.metadata?.bayDemarcation, false);
  assert.equal(
    meshes.some((mesh) => mesh.name.startsWith("parking-bay-dividers-")),
    false,
    "parking must not restore individual bay demarcation lines",
  );

  const ground = byName.get("ground-material-contract");
  const roof = byName.get("building-red-tile-roofs-material-contract");
  const otherRoof = byName.get("building-roofs-material-contract");
  const fallback = byName.get("roads-fallback-material-contract");
  const water = byName.get("greens-water-material-contract");
  assert.ok(ground && roof && otherRoof && fallback && water, "base ground, roof, fallback roads, and water must remain present");
  const groundTexture = ground.material?.diffuseTexture;
  assert.ok(
    groundTexture?.url?.endsWith("munich-urban-ground-v2.png"),
    "unmapped base ground must use the neutral urban infill texture",
  );
  assert.equal(groundTexture.wrapU, Texture.WRAP_ADDRESSMODE, "ground texture must repeat in world X");
  assert.equal(groundTexture.wrapV, Texture.WRAP_ADDRESSMODE, "ground texture must repeat in world Z");
  assert.equal(ground.checkCollisions, true, "texturing must not change the collision ground");
  assertWorldGroundUvs(ground);
  assert.ok(
    roof.material?.diffuseTexture?.url?.endsWith("roof_tiles.jpg"),
    "building roofs must use the shared roof-tile texture",
  );
  assert.equal(roof.material?.diffuseTexture?.wrapU, Texture.WRAP_ADDRESSMODE, "roof texture must repeat in U");
  assert.equal(roof.material?.diffuseTexture?.wrapV, Texture.WRAP_ADDRESSMODE, "roof texture must repeat in V");
  assert.deepEqual(
    roof.getVerticesData(VertexBuffer.UVKind),
    [8, 0, 10, 0, 10, 2, 8, 2],
    "footprint roofs must use a three-metre world-space tile repeat",
  );
  assert.deepEqual(
    roof.getVerticesData(VertexBuffer.ColorKind),
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    "roof-tile texture must not be tinted by saturated OSM roof colours",
  );
  assert.ok(
    otherRoof.material?.diffuseTexture?.url?.endsWith("munich-flat-roof-v1.png"),
    "non-red OSM roofs must add neutral mineral detail while retaining their vertex colour",
  );
  assert.equal(otherRoof.material?.diffuseTexture?.wrapU, Texture.WRAP_ADDRESSMODE);
  assert.equal(otherRoof.material?.diffuseTexture?.wrapV, Texture.WRAP_ADDRESSMODE);
  assert.equal(otherRoof.getTotalVertices(), 4, "non-red OSM roofs must not be moved into the roof-tile mesh");
  assert.equal(fallback.getTotalVertices(), 4, "unsupported grass-paver roads must stay in the truthful fallback");
  assert.equal(fallback.material?.diffuseTexture, null, "unsupported tagged surfaces must stay untextured");
  assert.ok(
    water.material?.diffuseTexture?.url?.endsWith("munich-water-v1.png"),
    "water must use its dedicated subtle ripple texture rather than the grass material",
  );
  assert.equal(water.material?.diffuseTexture?.wrapU, Texture.WRAP_ADDRESSMODE);
  assert.equal(water.material?.diffuseTexture?.wrapV, Texture.WRAP_ADDRESSMODE);

  const sidewalkUvs = byName.get("roads-sidewalk-material-contract")
    ?.getVerticesData(VertexBuffer.UVKind) ?? [];
  assert.deepEqual(
    sidewalkUvs.slice(0, 8),
    [0, 0, 1.875, 0, 1.875, 3.125, 0, 3.125],
    "sidewalk paving must run across and along each road ribbon at a metre-based scale",
  );
  assert.deepEqual(
    sidewalkUvs.slice(8, 16),
    [0, 0, 0.625, 0, 0.625, 3.125, 0, 3.125],
    "a separately classified path must restart its own path-aligned paving phase",
  );

  const sidewalkProfileTile = {
    id: "sidewalk-profile",
    center: [0, 0],
    buildings: [],
    roads: [
      {
        kind: "residential",
        surface: "asphalt",
        width: 6,
        sourceId: "osm:way/profile-road",
        points: [[0, 5], [5, 5]],
      },
      {
        kind: "residential",
        surface: "asphalt",
        width: 6,
        sourceId: "osm:way/profile-road",
        points: [[5, 5], [10, 5]],
      },
      {
        kind: "footway",
        footway: "sidewalk",
        footwaySurface: "paving_stones",
        cyclewaySurface: "asphalt",
        cyclewayWidth: 1.2,
        segregated: true,
        width: 2,
        sourceId: "osm:way/profile-sidewalk",
        points: [[0, 0], [5, 0]],
      },
      {
        kind: "footway",
        footway: "sidewalk",
        footwaySurface: "paving_stones",
        cyclewaySurface: "asphalt",
        cyclewayWidth: 1.2,
        segregated: true,
        width: 2,
        sourceId: "osm:way/profile-sidewalk",
        points: [[5, 0], [10, 0]],
      },
      {
        kind: "footway",
        footway: "crossing",
        footwaySurface: "paving_stones",
        width: 2,
        sourceId: "osm:way/profile-crossing",
        points: [[10, 0], [10, 5]],
      },
    ],
    greens: [],
  };
  const profileMeshes = buildTileMeshes(sidewalkProfileTile, 32, scene);
  const profileByName = new Map(profileMeshes.map((mesh) => [mesh.name, mesh]));
  const profileSidewalk = profileByName.get("roads-sidewalk-sidewalk-profile");
  const profileAsphalt = profileByName.get("roads-asphalt-sidewalk-profile");
  const curbTop = profileByName.get("sidewalk-curb-top-sidewalk-profile");
  const curbFace = profileByName.get("sidewalk-curb-face-sidewalk-profile");
  assert.ok(profileSidewalk && profileAsphalt && curbTop && curbFace, "raised sidewalk profile meshes must be emitted");

  const sidewalkPositions = profileSidewalk.getVerticesData(VertexBuffer.PositionKind) ?? [];
  const sidewalkHeights = new Set(
    Array.from({ length: sidewalkPositions.length / 3 }, (_, index) => sidewalkPositions[index * 3 + 1].toFixed(3)),
  );
  assert.ok(sidewalkHeights.has("0.160"), "ordinary sidewalk paving must be raised to 16 cm");
  assert.ok(sidewalkHeights.has("0.052"), "the mapped crossing and ramp mouth must stay at road height");
  const joinedLeft = [];
  const joinedRight = [];
  for (let index = 0; index < sidewalkPositions.length; index += 3) {
    if (Math.abs(sidewalkPositions[index] - 5) > 1e-5) continue;
    if (Math.abs(sidewalkPositions[index + 2] - 1.96) < 1e-5) joinedLeft.push(index / 3);
    if (Math.abs(sidewalkPositions[index + 2] + 1.9) < 1e-5) joinedRight.push(index / 3);
  }
  assert.ok(joinedLeft.length >= 2 && joinedRight.length >= 2, "stitched pieces must share one continuous miter section");

  const asphaltPositions = profileAsphalt.getVerticesData(VertexBuffer.PositionKind) ?? [];
  assert.ok(
    asphaltPositions.some((_, index) => index % 3 === 1 && asphaltPositions[index] > 0.16),
    "a tagged segregated asphalt cycle band must remain distinct on top of the pavers",
  );

  const curbFacePositions = curbFace.getVerticesData(VertexBuffer.PositionKind) ?? [];
  assert.ok(
    curbFacePositions.some((_, index) => index % 3 === 1 && Math.abs(curbFacePositions[index] - 0.042) < 1e-5),
    "the curb face must descend to the adjacent local carriageway",
  );
  assert.equal(curbTop.getTotalVertices(), 12, "only the three joined/ramped sidewalk spans receive curb tops");
  assert.equal(curbFace.getTotalVertices(), 12, "crossings must not emit curb-face geometry");

  const eastTile = {
    id: "material-contract-east",
    center: [32, 0],
    buildings: [],
    roads: [],
    greens: [],
  };
  const eastGround = buildTileMeshes(eastTile, 32, scene)
    .find((mesh) => mesh.name === "ground-material-contract-east");
  assert.ok(eastGround, "expected adjacent base ground");
  assertWorldGroundUvs(eastGround);
  const groundUvs = ground.getVerticesData(VertexBuffer.UVKind) ?? [];
  const eastUvs = eastGround.getVerticesData(VertexBuffer.UVKind) ?? [];
  assert.equal(eastUvs.length, groundUvs.length, "adjacent ground meshes must share a UV layout");
  for (let offset = 0; offset < groundUvs.length; offset += 2) {
    close(
      eastUvs[offset] - groundUvs[offset],
      32 / GROUND_REPEAT_METERS,
      "adjacent ground U phase must advance with the tile center",
    );
    close(eastUvs[offset + 1], groundUvs[offset + 1], "adjacent ground V phase must stay aligned");
  }

  process.stdout.write("Surface materials valid: OSM classification, world-aligned urban ground, grass parks, and truthful fallbacks.\n");
} finally {
  scene.dispose();
  engine.dispose();
  await vite.close();
}
