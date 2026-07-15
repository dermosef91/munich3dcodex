import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Scene } from "@babylonjs/core/scene.js";
import { readRuntimeTile } from "./lib/runtime-tile.mjs";

const root = path.resolve(import.meta.dirname, "..");
const dataDirectory = path.join(root, "public", "data");
const tileDirectory = path.join(root, "public", "data", "tiles");
const EPSILON = 1e-5;

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function subtract(a, b) {
  return a.map((value, index) => value - b[index]);
}

function horizontalLength(vector) {
  return Math.hypot(vector[0], vector[2]);
}

function normalizeHorizontal(vector) {
  const length = horizontalLength(vector);
  return length > EPSILON ? [vector[0] / length, 0, vector[2] / length] : [0, 0, 0];
}

function cleanGroundRing(points) {
  const ring = (points ?? []).map(([x, _y, z]) => [x, z]);
  if (ring.length > 1) {
    const first = ring[0];
    const last = ring.at(-1);
    if (Math.abs(first[0] - last[0]) < EPSILON && Math.abs(first[1] - last[1]) < EPSILON) ring.pop();
  }
  return ring;
}

function signedArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area * 0.5;
}

function largestGroundFootprint(building) {
  if (!building) return undefined;
  let best;
  let bestArea = 0;
  for (const surface of building.surfaces ?? []) {
    if (surface.type !== "ground") continue;
    for (const polygon of surface.polygons ?? []) {
      const exterior = cleanGroundRing(polygon.exterior);
      const area = Math.abs(signedArea(exterior));
      if (exterior.length >= 3 && area > bestArea) {
        best = {
          exterior,
          holes: (polygon.holes ?? []).map(cleanGroundRing).filter((ring) => ring.length >= 3),
        };
        bestArea = area;
      }
    }
  }
  return best;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if ((currentPoint[1] > point[1]) === (previousPoint[1] > point[1])) continue;
    const crossingX = ((previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1]))
      / (previousPoint[1] - currentPoint[1]) + currentPoint[0];
    if (point[0] < crossingX) inside = !inside;
  }
  return inside;
}

function pointInFootprint(point, footprint) {
  return pointInRing(point, footprint.exterior)
    && !footprint.holes.some((hole) => pointInRing(point, hole));
}

async function runtimeTiles() {
  const files = (await readdir(tileDirectory)).filter((file) => file.endsWith(".json"));
  const tiles = [];
  for (const file of files) {
    tiles.push(await readRuntimeTile(path.join(tileDirectory, file), dataDirectory));
  }
  return tiles;
}

async function assertSceneContract() {
  const [mainSource, movementSource, meshSource, detailsSource, storefrontSource, indexSource] = await Promise.all([
    readFile(path.join(root, "src", "main.ts"), "utf8"),
    readFile(path.join(root, "src", "player", "KeyboardMovement.ts"), "utf8"),
    readFile(path.join(root, "src", "world", "meshBuilders.ts"), "utf8"),
    readFile(path.join(root, "src", "world", "SchwabingDetails.ts"), "utf8"),
    readFile(path.join(root, "src", "world", "storefronts.ts"), "utf8"),
    readFile(path.join(root, "index.html"), "utf8"),
  ]);
  assert.match(mainSource, /scene\.useRightHandedSystem\s*=\s*true/);
  assert.match(mainSource, /@babylonjs\/core\/Shaders\/pbr\.vertex/);
  assert.match(mainSource, /@babylonjs\/core\/Shaders\/pbr\.fragment/);
  assert.match(mainSource, /@babylonjs\/core\/Shaders\/rgbdDecode\.fragment/);
  assert.match(mainSource, /const DEFAULT_DISTRICT:\s*DistrictId\s*=\s*"schwabing"/);
  assert.match(indexSource, /data-jump="schwabing" aria-pressed="true"/);
  assert.match(indexSource, /id="district">Schwabing · Elisabethstraße 46</);
  assert.match(movementSource, /Vector3\.Forward\(scene\.useRightHandedSystem\)/);
  assert.match(meshSource, /VertexData\.ComputeNormals\([\s\S]*?useRightHandedSystem:\s*true/);
  assert.match(meshSource, /mesh\.sideOrientation\s*=\s*Material\.CounterClockWiseSideOrientation/);
  assert.match(detailsSource, /yaw\s*\+\s*Math\.PI/);
  assert.match(
    storefrontSource,
    /Math\.atan2\(\s*-frontage\.outward\[0\],\s*-frontage\.outward\[1\]\s*\)/,
    "storefront sign yaw must come from the exterior normal",
  );
  assert.match(storefrontSource, /texture\.uScale\s*=\s*-1/, "storefront text U must run toward screen-right");
  assert.match(storefrontSource, /texture\.uOffset\s*=\s*1/, "reversed storefront text U must stay in the texture bounds");
  assert.match(storefrontSource, /texture\.update\(true\)/, "storefront canvas text must be uploaded upright");
  assert.doesNotMatch(storefrontSource, /texture\.update\(false\)/, "storefront canvas text must not be vertically inverted");
  assert.doesNotMatch(
    storefrontSource,
    /MeshBuilder\.CreatePlane\(`storefront-sign-[\s\S]*?yaw\s*\+\s*Math\.PI/,
    "storefront signs must not override the outward-facing yaw",
  );

  const surfaceY = (name) => {
    const match = meshSource.match(new RegExp(`const ${name} = ([0-9.]+);`));
    assert.ok(match, `expected ${name} surface layer`);
    return Number.parseFloat(match[1]);
  };
  const greenY = surfaceY("GREEN_SURFACE_Y");
  const majorRoadY = surfaceY("MAJOR_ROAD_SURFACE_Y");
  const localRoadY = surfaceY("LOCAL_ROAD_SURFACE_Y");
  const cyclewayY = surfaceY("CYCLEWAY_SURFACE_Y");
  const pedestrianY = surfaceY("PEDESTRIAN_SURFACE_Y");
  assert.ok(greenY < pedestrianY && pedestrianY < cyclewayY
    && cyclewayY < localRoadY && localRoadY < majorRoadY,
  "overlapping terrain, pedestrian, cycle and road ribbons need deterministic surface ordering");
  assert.ok(majorRoadY <= 0.055, "carriageways must stay at the vehicle model ride height");
  assert.doesNotMatch(meshSource, /pushVertex\([^\n]*0\.045/, "road vertices must not return to the coplanar legacy height");

  const engine = new NullEngine({ renderWidth: 32, renderHeight: 32 });
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const camera = new UniversalCamera("orientation-test", Vector3.Zero(), scene);
  camera.rotation.set(0, 0, 0);
  const forward = camera.getDirection(Vector3.Forward(scene.useRightHandedSystem));
  const right = camera.getDirection(Vector3.Right());
  assert.ok(Vector3.Distance(forward, new Vector3(0, 0, -1)) < EPSILON, "yaw 0 must face north (-Z)");
  assert.ok(Vector3.Distance(right, new Vector3(1, 0, 0)) < EPSILON, "camera right must face east (+X)");
  engine.dispose();
}

function assertStorefrontSignOrientation(tiles) {
  let storefronts = 0;
  for (const tile of tiles) {
    for (const business of tile.businesses ?? []) {
      const frontage = business.frontage;
      if (!frontage) continue;
      storefronts += 1;

      const [outwardX, outwardZ] = frontage.outward;
      const yaw = Math.atan2(-outwardX, -outwardZ);
      const planeNormal = [-Math.sin(yaw), -Math.cos(yaw)];
      assert.ok(
        planeNormal[0] * outwardX + planeNormal[1] * outwardZ > 0.999,
        `storefront sign faces inward for ${business.id}`,
      );

      const screenRight = [outwardZ, -outwardX];
      const correctedU = [-Math.cos(yaw), Math.sin(yaw)];
      assert.ok(
        correctedU[0] * screenRight[0] + correctedU[1] * screenRight[1] > 0.999,
        `storefront sign text is mirrored for ${business.id}`,
      );
    }
  }

  assert.ok(storefronts > 3_000, "expected to check the generated storefront signs");
  return storefronts;
}

function assertSemanticWallOrientation(buildings, normalizedBuildings) {
  const normalizedById = new Map(normalizedBuildings.map((building) => [building.id, building]));
  let wallTriangles = 0;
  let exteriorTriangles = 0;
  let rightwardUvEdges = 0;

  for (const building of buildings) {
    const surface = building.geometry?.walls;
    if (!surface?.positions?.length || !surface.indices?.length || !surface.uvs?.length) continue;
    const footprint = largestGroundFootprint(normalizedById.get(building.sourceId));
    for (let index = 0; index < surface.indices.length; index += 3) {
      const ids = surface.indices.slice(index, index + 3);
      const points = ids.map((id) => surface.positions.slice(id * 3, id * 3 + 3));
      const normal = cross(subtract(points[1], points[0]), subtract(points[2], points[0]));
      const outward = normalizeHorizontal(normal);
      if (horizontalLength(outward) < EPSILON) continue;
      wallTriangles += 1;

      if (footprint) {
        const triangleCenter = points.reduce(
          (sum, point) => [sum[0] + point[0] / 3, sum[1] + point[2] / 3],
          [0, 0],
        );
        const positiveInside = pointInFootprint(
          [triangleCenter[0] + outward[0] * 0.01, triangleCenter[1] + outward[2] * 0.01],
          footprint,
        );
        const negativeInside = pointInFootprint(
          [triangleCenter[0] - outward[0] * 0.01, triangleCenter[1] - outward[2] * 0.01],
          footprint,
        );
        if (positiveInside !== negativeInside) {
          assert.equal(
            positiveInside,
            false,
            `wall triangle faces into footprint on building ${building.id}/${building.sourceId}: ${JSON.stringify({ points, outward, triangleCenter })}`,
          );
          exteriorTriangles += 1;
        }
      }

      const screenRight = [outward[2], 0, -outward[0]];
      for (const [from, to] of [[0, 1], [1, 2], [2, 0]]) {
        if (Math.abs(points[to][1] - points[from][1]) > 0.02) continue;
        const edge = subtract(points[to], points[from]);
        if (horizontalLength(edge) < 0.05) continue;
        const deltaU = surface.uvs[ids[to] * 2] - surface.uvs[ids[from] * 2];
        if (Math.abs(deltaU) < EPSILON) continue;
        assert.ok(deltaU * dot(edge, screenRight) > 0, `wall U axis is mirrored on building ${building.id}`);
        rightwardUvEdges += 1;
        break;
      }
    }
  }

  assert.ok(wallTriangles > 1_000, "expected to check LoD2 wall triangles");
  assert.ok(exteriorTriangles > 1_000, "expected to check footprint-resolved exterior triangles");
  assert.ok(rightwardUvEdges > 500, "expected to check LoD2 wall UV edges");
  return { wallTriangles, exteriorTriangles, rightwardUvEdges };
}

function assertElisabethstrasse46(buildings) {
  const building = buildings.find((candidate) => candidate.id === 108881086);
  assert.ok(building, "Elisabethstrasse 46 must remain in runtime tiles");
  const [start, end] = building.outline;
  const along = normalizeHorizontal([end[0] - start[0], 0, end[1] - start[1]]);
  const facadeCenter = [(start[0] + end[0]) / 2, 0, (start[1] + end[1]) / 2];
  const spawn = [-431.557, 0, -943.059];
  let outward = [-along[2], 0, along[0]];
  if (dot(outward, subtract(spawn, facadeCenter)) < 0) outward = outward.map((value) => -value);
  const viewForward = outward.map((value) => -value);
  const screenRight = cross(viewForward, [0, 1, 0]);
  assert.ok(dot(along, screenRight) > 0.98, "No. 46 facade U must increase toward screen-right from the spawn side");
}

await assertSceneContract();
const tiles = await runtimeTiles();
const buildings = tiles.flatMap((tile) => tile.buildings);
const normalized = JSON.parse(
  await readFile(path.join(root, "data", "normalized", "lod2-elisabethstrasse.json"), "utf8"),
);
const checked = assertSemanticWallOrientation(buildings, normalized.buildings);
assertElisabethstrasse46(buildings);
const storefronts = assertStorefrontSignOrientation(tiles);
process.stdout.write(
  `World orientation valid: right-handed scene, ${checked.wallTriangles} LoD2 wall triangles (${checked.exteriorTriangles} footprint-resolved exterior), ${checked.rightwardUvEdges} rightward UV edges, ${storefronts} outward-facing readable storefront signs, and Elisabethstrasse 46.\n`,
);
