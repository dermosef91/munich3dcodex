/**
 * Streamed building shells replaced by reviewed, landmark-specific geometry.
 *
 * Keeping the IDs in one small registry lets the tile renderer omit the
 * generic facade/roof buffers before the procedural landmarks are added to
 * the scene. The source footprints remain in the runtime data for provenance
 * and placement tests.
 */
export const LANDMARK_REPLACEMENT_BUILDING_IDS: ReadonlySet<number> = new Set([
  // Elisabethmarkt's ten 2024 timber market pavilions.
  1_193_386_924,
  1_193_386_925,
  1_193_386_926,
  1_193_386_927,
  1_193_386_928,
  1_193_386_929,
  1_193_386_930,
  1_193_386_931,
  1_193_386_932,
  1_288_780_265,

  // Elisabethplatz's OSM-only toilet extrusion is replaced by the low,
  // shaded beer-garden pavilion at the square's west edge.
  50_758_320,

  // St. Joseph, Josephsplatz.
  31_095_497,
  776_733_543,

  // Nordbad LoD2 building sections and small ancillary structures.
  23_873_795,
  -1_539_766_678,
  -1_564_933_106,
  -535_635_977,
  -544_024_786,
  -560_802_405,
  97_847_497,
  109_066_342,

  // Munich MMA's south pavilion at Schleißheimer Straße 140. Building
  // 80_516_661 farther north is Nush O Jan and must remain streamed.
  35_589_513,

  // Hans-Busso von Busse's City Archive extension opposite Nordbad.
  27_276_683,

  // Theo Steinhauser's 1968 Kreuzkirche and its detached concrete campanile.
  86_022_858,
  387_219_512,
]);

export function isLandmarkReplacementBuilding(buildingId: number): boolean {
  return LANDMARK_REPLACEMENT_BUILDING_IDS.has(buildingId);
}
