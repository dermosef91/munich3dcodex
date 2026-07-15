import { Vector3 } from "@babylonjs/core/Maths/math.vector";

export type LandmarkPreviewId =
  | "elisabethmarkt"
  | "elisabethmarkt-wintergarten"
  | "elisabethplatz-biergarten"
  | "baerenbrunnen"
  | "st-joseph"
  | "nordbad"
  | "nordbad-pools"
  | "munich-mma"
  | "stadtarchiv"
  | "kreuzkirche"
  | "hermann-frieb-realschule"
  | "hohenzollernplatz"
  | "cafe-franca"
  | "museum-brandhorst"
  | "alte-pinakothek"
  | "bayerische-staatsbibliothek"
  | "haus-der-kunst"
  | "pinakothek-der-moderne"
  | "ns-dokumentationszentrum"
  | "museum-fuenf-kontinente"
  | "hotel-vier-jahreszeiten"
  | "ruffinihaus"
  | "muenchner-kammerspiele"
  | "deutsches-theater"
  | "frauenkirche"
  | "justizpalast"
  | "micky-statue"
  | "hofbraeuhaus"
  | "asamkirche";

interface LandmarkPreview {
  position: Vector3;
  target: Vector3;
  fov?: number;
}

const LANDMARK_PREVIEW_SPECS: Readonly<Record<LandmarkPreviewId, {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  fov?: number;
}>> = {
  elisabethmarkt: { position: [121, 2.4, -649], target: [185, 2.6, -649] },
  "elisabethmarkt-wintergarten": { position: [142, 2.7, -655], target: [160, 2.15, -646.5], fov: 0.94 },
  "elisabethplatz-biergarten": { position: [118, 2.55, -678], target: [101, 2.1, -681], fov: 0.92 },
  baerenbrunnen: { position: [151, 2.1, -699], target: [151, 1.9, -690] },
  "st-joseph": { position: [-391, 5.0, -490], target: [-322, 25, -500], fov: 1.40 },
  nordbad: { position: [-655, 4.2, -1039], target: [-611, 7.2, -1035] },
  "nordbad-pools": { position: [-505, 18, -1055], target: [-544, 0.35, -1056], fov: 0.96 },
  "munich-mma": { position: [-623.12, 4.2, -967.84], target: [-619.147, 3.0, -987.826], fov: 0.88 },
  stadtarchiv: { position: [-635, 4.0, -1050], target: [-677, 8.0, -1054] },
  kreuzkirche: { position: [-390, 5.2, -1318], target: [-435, 10.5, -1273], fov: 0.96 },
  "hermann-frieb-realschule": { position: [-369.6, 4.2, -1122.9], target: [-430, 12, -1154], fov: 0.95 },
  hohenzollernplatz: { position: [-282, 4.0, -1215], target: [-282, 1.0, -1180] },
  "cafe-franca": { position: [-410, 3.4, -837], target: [-397, 2.2, -852], fov: 0.92 },
  "museum-brandhorst": { position: [143.31, 4.2, 289.02], target: [158, 11.5, 311], fov: 0.94 },
  "alte-pinakothek": { position: [-113, 5.2, 214], target: [-141, 11.5, 279], fov: 0.96 },
  "bayerische-staatsbibliothek": { position: [531, 5.4, 368], target: [606, 12.2, 391], fov: 0.92 },
  "haus-der-kunst": { position: [1017.466, 4.6, 826.098], target: [1025.852, 8.4, 797.892], fov: 1.10 },
  "pinakothek-der-moderne": { position: [-74.791, 4.6, 388.312], target: [-48.033, 12.2, 399.946], fov: 1.05 },
  "ns-dokumentationszentrum": { position: [-329.060, 4.6, 652.549], target: [-323.602, 13.6, 639.396], fov: 1.20 },
  "museum-fuenf-kontinente": { position: [1034.460, 4.6, 1454.007], target: [1024.701, 14.0, 1488.273], fov: 0.95 },
  "hotel-vier-jahreszeiten": { position: [744.54, 4.7, 1366.30], target: [718.426, 12.0, 1345.762], fov: 0.90 },
  ruffinihaus: { position: [144.42, 4.6, 1632.37], target: [111.501, 10.5, 1644.767], fov: 0.90 },
  "muenchner-kammerspiele": { position: [722.54, 4.6, 1360.01], target: [779.03, 11.5, 1388.01], fov: 0.86 },
  "deutsches-theater": { position: [-740, 4.7, 1513.13], target: [-737.584, 12.0, 1548.927], fov: 0.90 },
  frauenkirche: { position: [120.0, 4.8, 1435.0], target: [120.0, 30.0, 1403.0], fov: 1.0 },
  justizpalast: { position: [-650, 5.0, 1135], target: [-599, 25, 1145], fov: 0.95 },
  "micky-statue": { position: [-418.2, 2.35, -969.5], target: [-413.9, 1.0, -966.4], fov: 0.82 },
  hofbraeuhaus: { position: [563.98, 4.2, 1491.94], target: [577.54, 10.2, 1481.55], fov: 0.96 },
  asamkirche: { position: [-161.6, 4.1, 1762.21], target: [-173.7, 11.4, 1769.17], fov: 0.90 },
};

export function landmarkPreview(id: string | null): LandmarkPreview | null {
  if (!id || !(id in LANDMARK_PREVIEW_SPECS)) return null;
  const spec = LANDMARK_PREVIEW_SPECS[id as LandmarkPreviewId];
  return {
    position: Vector3.FromArray(spec.position),
    target: Vector3.FromArray(spec.target),
    fov: spec.fov,
  };
}
