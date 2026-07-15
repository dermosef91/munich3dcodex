/**
 * Compact, deterministic semantic LoD2 geometry sidecars.
 *
 * Layout (all numbers little-endian, all offsets absolute):
 *   16-byte header: "M3L2", uint16 version, uint16 header bytes,
 *                   uint32 building count, uint32 total bytes
 *   N x 48-byte records, sorted by numeric building id:
 *                   float64 id, then two 20-byte surface descriptors
 *                   (walls followed by roofs)
 *   packed surface data: float32 XYZ, optional float32 UV, then uint16 or
 *                   uint32 triangle indices (uint16 when vertexCount <= 65535)
 *
 * Each surface descriptor stores positionsOffset, uvsOffset, indicesOffset,
 * vertexCount, and indexCount as uint32 values. Data blocks are 4-byte
 * aligned. Empty surfaces use an all-zero descriptor.
 */

export const LOD2_BINARY_FORMAT = "munich3d-lod2-geometry";
export const LOD2_BINARY_VERSION = 1;

const MAGIC = [0x4d, 0x33, 0x4c, 0x32]; // M3L2
const HEADER_BYTES = 16;
const RECORD_BYTES = 48;
const UINT32_MAX = 0xffff_ffff;

function align4(value) {
  return Math.ceil(value / 4) * 4;
}

function assertUint32(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new Error(`${label} does not fit in uint32`);
  }
}

function normalizeSurface(surface, label) {
  if (!surface || !Array.isArray(surface.positions) || !Array.isArray(surface.indices)) {
    throw new Error(`${label} must provide position and index arrays`);
  }
  if (surface.positions.length % 3 !== 0) throw new Error(`${label} positions are not XYZ triples`);
  if (surface.indices.length % 3 !== 0) throw new Error(`${label} indices are not triangles`);
  if (!surface.positions.every((value) => Number.isFinite(value) && Number.isFinite(Math.fround(value)))) {
    throw new Error(`${label} positions contain a value that is not representable as float32`);
  }

  const vertexCount = surface.positions.length / 3;
  const uvs = surface.uvs;
  if (uvs !== undefined) {
    if (!Array.isArray(uvs) || uvs.length !== vertexCount * 2
      || !uvs.every((value) => Number.isFinite(value) && Number.isFinite(Math.fround(value)))) {
      throw new Error(`${label} UVs must contain one finite pair per vertex`);
    }
  }
  if (!surface.indices.every((index) => Number.isSafeInteger(index) && index >= 0 && index < vertexCount)) {
    throw new Error(`${label} contains an invalid vertex index`);
  }
  assertUint32(vertexCount, `${label} vertex count`);
  assertUint32(surface.indices.length, `${label} index count`);
  return { positions: surface.positions, indices: surface.indices, uvs, vertexCount };
}

function surfaceByteLength(surface) {
  if (surface.vertexCount === 0) return 0;
  let length = surface.positions.length * 4;
  if (surface.uvs !== undefined) length += surface.uvs.length * 4;
  length += surface.indices.length * (surface.vertexCount <= 0xffff ? 2 : 4);
  return align4(length);
}

function writeSurfaceDescriptor(view, descriptorOffset, surface, cursor) {
  if (surface.vertexCount === 0) {
    for (let offset = 0; offset < 20; offset += 4) view.setUint32(descriptorOffset + offset, 0, true);
    return cursor;
  }

  const positionsOffset = cursor;
  cursor += surface.positions.length * 4;
  const uvsOffset = surface.uvs === undefined ? 0 : cursor;
  if (surface.uvs !== undefined) cursor += surface.uvs.length * 4;
  const indicesOffset = surface.indices.length === 0 ? 0 : cursor;
  cursor += surface.indices.length * (surface.vertexCount <= 0xffff ? 2 : 4);

  view.setUint32(descriptorOffset, positionsOffset, true);
  view.setUint32(descriptorOffset + 4, uvsOffset, true);
  view.setUint32(descriptorOffset + 8, indicesOffset, true);
  view.setUint32(descriptorOffset + 12, surface.vertexCount, true);
  view.setUint32(descriptorOffset + 16, surface.indices.length, true);
  return align4(cursor);
}

function writeSurfaceData(view, surface, offsets) {
  for (let index = 0; index < surface.positions.length; index += 1) {
    view.setFloat32(offsets.positions + index * 4, surface.positions[index], true);
  }
  if (surface.uvs !== undefined) {
    for (let index = 0; index < surface.uvs.length; index += 1) {
      view.setFloat32(offsets.uvs + index * 4, surface.uvs[index], true);
    }
  }
  const indexWidth = surface.vertexCount <= 0xffff ? 2 : 4;
  for (let index = 0; index < surface.indices.length; index += 1) {
    if (indexWidth === 2) view.setUint16(offsets.indices + index * 2, surface.indices[index], true);
    else view.setUint32(offsets.indices + index * 4, surface.indices[index], true);
  }
}

function readDescriptor(view, offset) {
  return {
    positionsOffset: view.getUint32(offset, true),
    uvsOffset: view.getUint32(offset + 4, true),
    indicesOffset: view.getUint32(offset + 8, true),
    vertexCount: view.getUint32(offset + 12, true),
    indexCount: view.getUint32(offset + 16, true),
  };
}

function offsetsFromDescriptor(view, descriptorOffset) {
  return {
    positions: view.getUint32(descriptorOffset, true),
    uvs: view.getUint32(descriptorOffset + 4, true),
    indices: view.getUint32(descriptorOffset + 8, true),
  };
}

/**
 * Encode the `geometry` fields of building-like objects into one sidecar.
 * Buildings without semantic geometry are omitted.
 */
export function encodeLod2Geometry(buildings) {
  const records = [];
  const ids = new Set();
  for (const building of buildings) {
    if (!building?.geometry) continue;
    if (!Number.isSafeInteger(building.id)) throw new Error(`Invalid LoD2 building id ${building.id}`);
    if (ids.has(building.id)) throw new Error(`Duplicate LoD2 building id ${building.id}`);
    ids.add(building.id);
    const walls = normalizeSurface(building.geometry.walls, `Building ${building.id} walls`);
    const roofs = normalizeSurface(building.geometry.roofs, `Building ${building.id} roofs`);
    if (walls.vertexCount === 0 && roofs.vertexCount === 0) continue;
    records.push({ buildingId: building.id, walls, roofs });
  }
  records.sort((left, right) => left.buildingId - right.buildingId);
  assertUint32(records.length, "LoD2 building count");

  let byteLength = HEADER_BYTES + records.length * RECORD_BYTES;
  for (const record of records) {
    byteLength += surfaceByteLength(record.walls) + surfaceByteLength(record.roofs);
  }
  assertUint32(byteLength, "LoD2 sidecar byte length");

  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < MAGIC.length; index += 1) view.setUint8(index, MAGIC[index]);
  view.setUint16(4, LOD2_BINARY_VERSION, true);
  view.setUint16(6, HEADER_BYTES, true);
  view.setUint32(8, records.length, true);
  view.setUint32(12, byteLength, true);

  let cursor = HEADER_BYTES + records.length * RECORD_BYTES;
  for (let index = 0; index < records.length; index += 1) {
    const recordOffset = HEADER_BYTES + index * RECORD_BYTES;
    view.setFloat64(recordOffset, records[index].buildingId, true);
    cursor = writeSurfaceDescriptor(view, recordOffset + 8, records[index].walls, cursor);
    cursor = writeSurfaceDescriptor(view, recordOffset + 28, records[index].roofs, cursor);
  }

  for (let index = 0; index < records.length; index += 1) {
    const recordOffset = HEADER_BYTES + index * RECORD_BYTES;
    writeSurfaceData(view, records[index].walls, offsetsFromDescriptor(view, recordOffset + 8));
    writeSurfaceData(view, records[index].roofs, offsetsFromDescriptor(view, recordOffset + 28));
  }
  return { bytes, buildingCount: records.length };
}

function asDataView(source) {
  if (source instanceof ArrayBuffer) return new DataView(source);
  if (ArrayBuffer.isView(source)) return new DataView(source.buffer, source.byteOffset, source.byteLength);
  throw new Error("LoD2 sidecar must be an ArrayBuffer or typed-array view");
}

function assertRange(offset, bytes, totalBytes, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(bytes)
    || offset < 0 || bytes < 0 || offset + bytes > totalBytes) {
    throw new Error(`${label} exceeds the LoD2 sidecar`);
  }
}

function decodeSurface(view, descriptor, expectedOffset, label) {
  const { positionsOffset, uvsOffset, indicesOffset, vertexCount, indexCount } = descriptor;
  if (vertexCount === 0) {
    if (positionsOffset !== 0 || uvsOffset !== 0 || indicesOffset !== 0 || indexCount !== 0) {
      throw new Error(`${label} has a non-empty descriptor for zero vertices`);
    }
    return { surface: { positions: [], indices: [] }, nextOffset: expectedOffset };
  }
  if (positionsOffset !== expectedOffset) throw new Error(`${label} positions are not canonically packed`);
  if (indexCount % 3 !== 0) throw new Error(`${label} indices are not triangles`);

  const positionBytes = vertexCount * 3 * 4;
  assertRange(positionsOffset, positionBytes, view.byteLength, `${label} positions`);
  let cursor = positionsOffset + positionBytes;
  const hasUvs = uvsOffset !== 0;
  if (hasUvs) {
    if (uvsOffset !== cursor) throw new Error(`${label} UVs are not canonically packed`);
    assertRange(uvsOffset, vertexCount * 2 * 4, view.byteLength, `${label} UVs`);
    cursor += vertexCount * 2 * 4;
  }

  const indexWidth = vertexCount <= 0xffff ? 2 : 4;
  if (indexCount > 0) {
    if (indicesOffset !== cursor) throw new Error(`${label} indices are not canonically packed`);
    assertRange(indicesOffset, indexCount * indexWidth, view.byteLength, `${label} indices`);
    cursor += indexCount * indexWidth;
  } else if (indicesOffset !== 0) {
    throw new Error(`${label} has an index offset for zero indices`);
  }

  const positions = new Array(vertexCount * 3);
  for (let index = 0; index < positions.length; index += 1) {
    positions[index] = view.getFloat32(positionsOffset + index * 4, true);
  }
  const indices = new Array(indexCount);
  for (let index = 0; index < indexCount; index += 1) {
    const value = indexWidth === 2
      ? view.getUint16(indicesOffset + index * 2, true)
      : view.getUint32(indicesOffset + index * 4, true);
    if (value >= vertexCount) throw new Error(`${label} contains an out-of-range vertex index`);
    indices[index] = value;
  }

  const surface = { positions, indices };
  if (hasUvs) {
    const uvs = new Array(vertexCount * 2);
    for (let index = 0; index < uvs.length; index += 1) {
      uvs[index] = view.getFloat32(uvsOffset + index * 4, true);
    }
    surface.uvs = uvs;
  }
  return { surface, nextOffset: align4(cursor) };
}

/** Decode and fully validate a v1 sidecar before returning any geometry. */
export function decodeLod2Geometry(source) {
  const view = asDataView(source);
  if (view.byteLength < HEADER_BYTES) throw new Error("LoD2 sidecar is shorter than its header");
  for (let index = 0; index < MAGIC.length; index += 1) {
    if (view.getUint8(index) !== MAGIC[index]) throw new Error("LoD2 sidecar magic is invalid");
  }
  const version = view.getUint16(4, true);
  if (version !== LOD2_BINARY_VERSION) throw new Error(`Unsupported LoD2 sidecar version ${version}`);
  if (view.getUint16(6, true) !== HEADER_BYTES) throw new Error("LoD2 sidecar header size is invalid");
  const buildingCount = view.getUint32(8, true);
  if (view.getUint32(12, true) !== view.byteLength) throw new Error("LoD2 sidecar byte length does not match its header");
  const dataOffset = HEADER_BYTES + buildingCount * RECORD_BYTES;
  assertRange(0, dataOffset, view.byteLength, "LoD2 record table");

  const records = [];
  let cursor = dataOffset;
  let previousId = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < buildingCount; index += 1) {
    const recordOffset = HEADER_BYTES + index * RECORD_BYTES;
    const buildingId = view.getFloat64(recordOffset, true);
    if (!Number.isSafeInteger(buildingId)) throw new Error(`LoD2 record ${index} has an invalid building id`);
    if (buildingId <= previousId) throw new Error("LoD2 building records are not uniquely sorted");
    previousId = buildingId;
    const walls = decodeSurface(view, readDescriptor(view, recordOffset + 8), cursor, `Building ${buildingId} walls`);
    cursor = walls.nextOffset;
    const roofs = decodeSurface(view, readDescriptor(view, recordOffset + 28), cursor, `Building ${buildingId} roofs`);
    cursor = roofs.nextOffset;
    records.push({ buildingId, geometry: { walls: walls.surface, roofs: roofs.surface } });
  }
  if (cursor !== view.byteLength) throw new Error("LoD2 sidecar contains trailing or misaligned data");
  return { version, records };
}
