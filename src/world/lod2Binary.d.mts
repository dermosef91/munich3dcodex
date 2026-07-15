import type { BuildingSurfaceGeometry } from "./types";

export const LOD2_BINARY_FORMAT: "munich3d-lod2-geometry";
export const LOD2_BINARY_VERSION: 1;

export interface Lod2GeometryInput {
  id: number;
  geometry?: BuildingSurfaceGeometry;
}

export interface DecodedLod2Geometry {
  buildingId: number;
  geometry: BuildingSurfaceGeometry;
}

export function encodeLod2Geometry(buildings: readonly Lod2GeometryInput[]): {
  bytes: Uint8Array;
  buildingCount: number;
};

export function decodeLod2Geometry(source: ArrayBuffer | ArrayBufferView): {
  version: number;
  records: DecodedLod2Geometry[];
};
