import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  decodeLod2Geometry,
  LOD2_BINARY_FORMAT,
  LOD2_BINARY_VERSION,
} from "../../src/world/lod2Binary.mjs";

function dataPathFromUrl(dataDirectory, url) {
  if (typeof url !== "string" || !url) throw new Error("LoD2 sidecar URL is missing");
  const relative = url.replace(/^\/+/, "").replace(/^data\//, "");
  const resolved = path.resolve(dataDirectory, relative);
  if (!resolved.startsWith(`${path.resolve(dataDirectory)}${path.sep}`)) {
    throw new Error(`LoD2 sidecar escapes the data directory: ${url}`);
  }
  return resolved;
}

/** Load semantic geometry into a parsed runtime tile for Node-side tooling. */
export async function hydrateRuntimeTileGeometry(tile, dataDirectory) {
  const sidecar = tile.lod2Geometry;
  if (!sidecar) return tile;
  if (sidecar.format !== LOD2_BINARY_FORMAT || sidecar.version !== LOD2_BINARY_VERSION) {
    throw new Error(`Tile ${tile.id} uses unsupported LoD2 sidecar ${sidecar.format} v${sidecar.version}`);
  }
  const bytes = await readFile(dataPathFromUrl(dataDirectory, sidecar.file));
  if (bytes.byteLength !== sidecar.byteLength) {
    throw new Error(`Tile ${tile.id} LoD2 sidecar length is ${bytes.byteLength}, expected ${sidecar.byteLength}`);
  }
  const decoded = decodeLod2Geometry(bytes);
  if (decoded.records.length !== sidecar.buildingCount) {
    throw new Error(`Tile ${tile.id} LoD2 sidecar building count is invalid`);
  }
  const buildingsById = new Map(tile.buildings.map((building) => [building.id, building]));
  const assignments = decoded.records.map((record) => {
    const building = buildingsById.get(record.buildingId);
    if (!building) throw new Error(`Tile ${tile.id} LoD2 sidecar references missing building ${record.buildingId}`);
    return { building, geometry: record.geometry };
  });
  for (const { building, geometry } of assignments) building.geometry = geometry;
  return tile;
}

export async function readRuntimeTile(tilePath, dataDirectory = path.dirname(path.dirname(tilePath))) {
  const tile = JSON.parse(await readFile(tilePath, "utf8"));
  return hydrateRuntimeTileGeometry(tile, dataDirectory);
}
