import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  decodeLod2Geometry,
  encodeLod2Geometry,
  LOD2_BINARY_FORMAT,
  LOD2_BINARY_VERSION,
} from "../src/world/lod2Binary.mjs";

const root = path.resolve(import.meta.dirname, "..");
const dataDirectory = path.join(root, "public", "data");
const tileDirectory = path.join(dataDirectory, "tiles");

function triangleGeometry(positions, uvs) {
  return {
    walls: { positions, indices: [0, 1, 2], ...(uvs ? { uvs } : {}) },
    roofs: { positions: [], indices: [] },
  };
}

const largeVertexCount = 0x1_0000;
const largePositions = new Array(largeVertexCount * 3).fill(0);
largePositions[(largeVertexCount - 1) * 3] = 12.5;
const fixture = [
  {
    id: 42,
    geometry: triangleGeometry(
      [0.123456, 2, -4, 1, 2, -4, 0, 3, -4],
      [0, 0, 1, 0, 0, 1],
    ),
  },
  {
    id: -7,
    geometry: {
      walls: { positions: largePositions, indices: [0, largeVertexCount - 1, 1] },
      roofs: { positions: [], indices: [] },
    },
  },
  { id: 99 },
];

const first = encodeLod2Geometry(fixture);
const second = encodeLod2Geometry(fixture);
assert.equal(first.buildingCount, 2, "buildings without semantic geometry must be omitted");
assert.deepEqual(first.bytes, second.bytes, "binary output must be byte-for-byte deterministic");
assert.equal(String.fromCharCode(...first.bytes.subarray(0, 4)), "M3L2");
assert.equal(new DataView(first.bytes.buffer).getUint16(4, true), LOD2_BINARY_VERSION);

const decoded = decodeLod2Geometry(first.bytes);
assert.deepEqual(decoded.records.map((record) => record.buildingId), [-7, 42], "records must be numerically sorted");
assert.deepEqual(decoded.records[0].geometry.walls.indices, [0, largeVertexCount - 1, 1], "uint32 indices must round-trip");
assert.equal(
  decoded.records[1].geometry.walls.positions[0],
  Math.fround(fixture[0].geometry.walls.positions[0]),
  "positions must be stored as float32",
);
assert.deepEqual(decoded.records[1].geometry.walls.uvs, fixture[0].geometry.walls.uvs);

const badMagic = first.bytes.slice();
badMagic[0] ^= 0xff;
assert.throws(() => decodeLod2Geometry(badMagic), /magic/);
const badVersion = first.bytes.slice();
new DataView(badVersion.buffer).setUint16(4, 99, true);
assert.throws(() => decodeLod2Geometry(badVersion), /version 99/);
const badIndex = first.bytes.slice();
const badIndexView = new DataView(badIndex.buffer);
const firstWallIndexOffset = badIndexView.getUint32(32, true);
const firstWallVertexCount = badIndexView.getUint32(36, true);
badIndexView.setUint32(firstWallIndexOffset, firstWallVertexCount, true);
assert.throws(() => decodeLod2Geometry(badIndex), /out-of-range vertex index/);
assert.throws(() => decodeLod2Geometry(first.bytes.subarray(0, first.bytes.length - 1)), /byte length/);
assert.throws(
  () => encodeLod2Geometry([fixture[0], fixture[0]]),
  /Duplicate LoD2 building id/,
);
assert.throws(
  () => encodeLod2Geometry([{ id: 1, geometry: triangleGeometry([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 0]) }]),
  /UVs/,
);

let sidecarCount = 0;
let packedBuildingCount = 0;
for (const file of (await readdir(tileDirectory)).filter((candidate) => candidate.endsWith(".json"))) {
  const tile = JSON.parse(await readFile(path.join(tileDirectory, file), "utf8"));
  const sidecar = tile.lod2Geometry;
  if (!sidecar) continue;
  assert.equal(sidecar.format, LOD2_BINARY_FORMAT);
  assert.equal(sidecar.version, LOD2_BINARY_VERSION);
  assert.ok(tile.buildings.every((building) => !building.geometry), `${tile.id} retains inline geometry`);
  const relative = sidecar.file.replace(/^\/+/, "").replace(/^data\//, "");
  const bytes = await readFile(path.join(dataDirectory, relative));
  assert.equal(bytes.byteLength, sidecar.byteLength);
  const actual = decodeLod2Geometry(bytes);
  assert.equal(actual.records.length, sidecar.buildingCount);
  const buildingIds = new Set(tile.buildings.map((building) => building.id));
  assert.ok(actual.records.every((record) => buildingIds.has(record.buildingId)));
  sidecarCount += 1;
  packedBuildingCount += actual.records.length;
}
assert.ok(sidecarCount > 0, "checked-in runtime data must exercise binary LoD2 sidecars");

process.stdout.write(
  `LoD2 binary codec valid: deterministic v${LOD2_BINARY_VERSION} float32 geometry, uint16/uint32 indices, corruption checks, and ${packedBuildingCount} buildings across ${sidecarCount} runtime sidecars.\n`,
);
