/** A display-ready sRGB color with components in the inclusive 0..1 range. */
export type FacadeColor = readonly [red: number, green: number, blue: number];

export type MunichFacadeFamily =
  | "altstadt-plaster"
  | "maxvorstadt-classicist"
  | "schwabing-gruenderzeit"
  | "schwabing-jugendstil"
  | "interwar-reform"
  | "postwar-functional"
  | "contemporary-infill";

export type MunichDistrict = "altstadt" | "maxvorstadt" | "schwabing" | "other";

export type FacadeRoofShape =
  | "flat"
  | "gabled"
  | "half-hipped"
  | "hipped"
  | "mansard"
  | "pyramidal"
  | "skillion";

export type WindowLintel = "flat" | "segmental-arch" | "round-arch";

export type FacadeTagValue = string | number | boolean | null | undefined;

export interface FacadeInputSource {
  readonly dataset: string;
  readonly featureId?: string;
  readonly observedAt?: string;
  readonly license?: string;
}

/**
 * Normalized values may be supplied directly. `tags` also accepts the common
 * OSM keys, so callers do not need to mutate the existing BuildingFeature type.
 */
export interface FacadeAttributes {
  readonly district?: MunichDistrict | string;
  readonly constructionYear?: number;
  readonly levels?: number;
  readonly roofLevels?: number;
  readonly frontageWidthM?: number;
  readonly buildingUse?: string;
  readonly buildingMaterial?: string;
  readonly roofShape?: FacadeRoofShape | string;
  readonly wallColor?: FacadeColor | string;
  readonly roofColor?: FacadeColor | string;
  readonly tags?: Readonly<Record<string, FacadeTagValue>>;
  readonly source?: FacadeInputSource;
}

export interface FacadeConfidence {
  readonly overall: number;
  readonly family: number;
  readonly palette: number;
  readonly geometry: number;
  readonly label: "low" | "medium" | "high";
}

export type FacadeBasis =
  | "building-id-seed"
  | "explicit-attributes"
  | "construction-year-prior"
  | "district-prior"
  | "material-prior"
  | "family-palette"
  | "family-geometry";

export interface FacadeSourceMetadata {
  readonly method: "procedural-inference";
  readonly generator: "munich-facade-spec-v1";
  readonly input: FacadeInputSource | null;
  readonly basis: readonly FacadeBasis[];
  readonly explicitAttributes: readonly string[];
}

export interface FacadeSpec {
  readonly buildingId: string;
  readonly seed: number;
  readonly family: MunichFacadeFamily;
  readonly surfaceMaterial: string;
  readonly colors: {
    readonly wall: FacadeColor;
    readonly roof: FacadeColor;
    readonly trim: FacadeColor;
    readonly windowFrame: FacadeColor;
    readonly glazing: FacadeColor;
  };
  readonly floors: {
    readonly count: number;
    readonly roofCount: number;
    readonly floorHeightM: number;
    readonly groundFloorHeightM: number;
    readonly estimatedWallHeightM: number;
  };
  readonly facade: {
    readonly preferredBayWidthM: number;
    readonly nominalBayCount: number;
    readonly baseHeightM: number;
    readonly corniceDepthM: number;
    readonly symmetry: number;
    readonly ornament: number;
    readonly balconyProbability: number;
    readonly shopfrontProbability: number;
  };
  readonly windows: {
    readonly widthM: number;
    readonly heightM: number;
    readonly sillHeightM: number;
    readonly recessDepthM: number;
    readonly frameWidthM: number;
    readonly lintel: WindowLintel;
  };
  readonly roof: {
    readonly shape: FacadeRoofShape;
    readonly pitchDegrees: number;
  };
  readonly confidence: FacadeConfidence;
  readonly source: FacadeSourceMetadata;
}

type Range = readonly [minimum: number, maximum: number];
type Weighted<T> = readonly [value: T, weight: number];

interface FamilyProfile {
  readonly floors: readonly [minimum: number, maximum: number];
  readonly floorHeightM: Range;
  readonly groundFloorHeightM: Range;
  readonly bayWidthM: Range;
  readonly windowWidthRatio: Range;
  readonly windowHeightM: Range;
  readonly sillHeightM: Range;
  readonly recessDepthM: Range;
  readonly frameWidthM: Range;
  readonly baseHeightM: Range;
  readonly corniceDepthM: Range;
  readonly symmetry: Range;
  readonly ornament: Range;
  readonly balconyProbability: Range;
  readonly shopfrontProbability: Range;
  readonly wallPalette: readonly FacadeColor[];
  readonly roofPalette: readonly FacadeColor[];
  readonly trimPalette: readonly FacadeColor[];
  readonly framePalette: readonly FacadeColor[];
  readonly roofShapes: readonly Weighted<FacadeRoofShape>[];
  readonly lintels: readonly Weighted<WindowLintel>[];
  readonly material: string;
}

// These profiles are art-direction priors, not claims about an individual building.
const PROFILES: Readonly<Record<MunichFacadeFamily, FamilyProfile>> = {
  "altstadt-plaster": {
    floors: [3, 5], floorHeightM: [3.05, 3.4], groundFloorHeightM: [3.5, 4.1], bayWidthM: [2.7, 3.35],
    windowWidthRatio: [0.42, 0.55], windowHeightM: [1.55, 1.9], sillHeightM: [0.78, 0.98],
    recessDepthM: [0.08, 0.16], frameWidthM: [0.07, 0.11], baseHeightM: [0.35, 0.7],
    corniceDepthM: [0.12, 0.28], symmetry: [0.68, 0.9], ornament: [0.25, 0.58],
    balconyProbability: [0.02, 0.16], shopfrontProbability: [0.28, 0.58],
    wallPalette: [[0.84, 0.78, 0.65], [0.87, 0.72, 0.58], [0.78, 0.69, 0.57], [0.89, 0.84, 0.73]],
    roofPalette: [[0.34, 0.16, 0.11], [0.27, 0.25, 0.23], [0.42, 0.22, 0.14]],
    trimPalette: [[0.91, 0.88, 0.79], [0.75, 0.68, 0.57]], framePalette: [[0.85, 0.84, 0.79], [0.25, 0.18, 0.13]],
    roofShapes: [["gabled", 4], ["hipped", 3], ["mansard", 1]], lintels: [["flat", 4], ["segmental-arch", 2]],
    material: "mineral-plaster",
  },
  "maxvorstadt-classicist": {
    floors: [4, 6], floorHeightM: [3.25, 3.65], groundFloorHeightM: [3.8, 4.5], bayWidthM: [2.65, 3.2],
    windowWidthRatio: [0.38, 0.5], windowHeightM: [1.75, 2.1], sillHeightM: [0.76, 0.96],
    recessDepthM: [0.12, 0.22], frameWidthM: [0.08, 0.13], baseHeightM: [0.55, 1],
    corniceDepthM: [0.22, 0.48], symmetry: [0.84, 0.98], ornament: [0.5, 0.82],
    balconyProbability: [0.08, 0.3], shopfrontProbability: [0.12, 0.4],
    wallPalette: [[0.82, 0.77, 0.67], [0.78, 0.72, 0.6], [0.88, 0.84, 0.74], [0.76, 0.67, 0.54]],
    roofPalette: [[0.25, 0.24, 0.23], [0.36, 0.18, 0.12]],
    trimPalette: [[0.9, 0.87, 0.79], [0.69, 0.63, 0.53]], framePalette: [[0.84, 0.84, 0.8], [0.22, 0.18, 0.14]],
    roofShapes: [["hipped", 4], ["mansard", 2], ["gabled", 1]],
    lintels: [["flat", 3], ["segmental-arch", 3], ["round-arch", 1]], material: "stucco",
  },
  "schwabing-gruenderzeit": {
    floors: [4, 6], floorHeightM: [3.1, 3.5], groundFloorHeightM: [3.65, 4.35], bayWidthM: [2.55, 3.05],
    windowWidthRatio: [0.4, 0.54], windowHeightM: [1.7, 2.05], sillHeightM: [0.74, 0.94],
    recessDepthM: [0.12, 0.24], frameWidthM: [0.08, 0.13], baseHeightM: [0.45, 0.9],
    corniceDepthM: [0.2, 0.44], symmetry: [0.75, 0.94], ornament: [0.55, 0.86],
    balconyProbability: [0.24, 0.55], shopfrontProbability: [0.12, 0.38],
    wallPalette: [[0.77, 0.68, 0.53], [0.84, 0.75, 0.61], [0.72, 0.66, 0.59], [0.85, 0.81, 0.7]],
    roofPalette: [[0.27, 0.25, 0.23], [0.37, 0.19, 0.13]],
    trimPalette: [[0.88, 0.84, 0.76], [0.64, 0.57, 0.48]], framePalette: [[0.83, 0.82, 0.77], [0.24, 0.17, 0.12]],
    roofShapes: [["hipped", 3], ["mansard", 3], ["gabled", 2]],
    lintels: [["segmental-arch", 3], ["flat", 2], ["round-arch", 1]], material: "stucco",
  },
  "schwabing-jugendstil": {
    floors: [4, 6], floorHeightM: [3.15, 3.55], groundFloorHeightM: [3.7, 4.35], bayWidthM: [2.5, 3.15],
    windowWidthRatio: [0.4, 0.58], windowHeightM: [1.75, 2.15], sillHeightM: [0.7, 0.92],
    recessDepthM: [0.13, 0.25], frameWidthM: [0.08, 0.14], baseHeightM: [0.45, 0.9],
    corniceDepthM: [0.18, 0.42], symmetry: [0.58, 0.84], ornament: [0.76, 0.98],
    balconyProbability: [0.32, 0.65], shopfrontProbability: [0.1, 0.32],
    wallPalette: [[0.74, 0.69, 0.57], [0.77, 0.58, 0.43], [0.66, 0.71, 0.62], [0.8, 0.76, 0.66]],
    roofPalette: [[0.25, 0.24, 0.23], [0.34, 0.17, 0.12]],
    trimPalette: [[0.86, 0.83, 0.74], [0.58, 0.61, 0.54]], framePalette: [[0.79, 0.8, 0.75], [0.19, 0.16, 0.13]],
    roofShapes: [["mansard", 4], ["hipped", 3], ["gabled", 1]],
    lintels: [["segmental-arch", 4], ["round-arch", 2], ["flat", 1]], material: "decorative-stucco",
  },
  "interwar-reform": {
    floors: [3, 5], floorHeightM: [2.9, 3.2], groundFloorHeightM: [3.15, 3.75], bayWidthM: [2.55, 3.05],
    windowWidthRatio: [0.46, 0.6], windowHeightM: [1.45, 1.75], sillHeightM: [0.82, 1.02],
    recessDepthM: [0.06, 0.14], frameWidthM: [0.06, 0.1], baseHeightM: [0.3, 0.65],
    corniceDepthM: [0.08, 0.22], symmetry: [0.74, 0.94], ornament: [0.08, 0.3],
    balconyProbability: [0.12, 0.35], shopfrontProbability: [0.04, 0.2],
    wallPalette: [[0.79, 0.72, 0.56], [0.83, 0.78, 0.68], [0.7, 0.68, 0.61], [0.78, 0.63, 0.43]],
    roofPalette: [[0.35, 0.18, 0.12], [0.28, 0.27, 0.25]],
    trimPalette: [[0.84, 0.81, 0.73], [0.58, 0.56, 0.5]], framePalette: [[0.78, 0.79, 0.75], [0.25, 0.22, 0.18]],
    roofShapes: [["hipped", 5], ["gabled", 3], ["flat", 1]], lintels: [["flat", 6], ["segmental-arch", 1]],
    material: "smooth-render",
  },
  "postwar-functional": {
    floors: [4, 8], floorHeightM: [2.72, 3], groundFloorHeightM: [3.05, 3.75], bayWidthM: [2.35, 2.85],
    windowWidthRatio: [0.52, 0.72], windowHeightM: [1.3, 1.62], sillHeightM: [0.86, 1.05],
    recessDepthM: [0.02, 0.1], frameWidthM: [0.045, 0.08], baseHeightM: [0.2, 0.5],
    corniceDepthM: [0.02, 0.14], symmetry: [0.7, 0.94], ornament: [0, 0.12],
    balconyProbability: [0.45, 0.82], shopfrontProbability: [0.08, 0.32],
    wallPalette: [[0.74, 0.55, 0.2], [0.77, 0.69, 0.5], [0.68, 0.67, 0.61], [0.78, 0.76, 0.67]],
    roofPalette: [[0.29, 0.29, 0.27], [0.38, 0.2, 0.14]],
    trimPalette: [[0.83, 0.82, 0.76], [0.48, 0.46, 0.42]], framePalette: [[0.78, 0.79, 0.77], [0.22, 0.23, 0.22]],
    roofShapes: [["flat", 4], ["gabled", 3], ["hipped", 1]], lintels: [["flat", 1]], material: "painted-render",
  },
  "contemporary-infill": {
    floors: [4, 7], floorHeightM: [2.85, 3.2], groundFloorHeightM: [3.3, 4.2], bayWidthM: [2.7, 3.6],
    windowWidthRatio: [0.62, 0.86], windowHeightM: [1.55, 2.15], sillHeightM: [0.45, 0.86],
    recessDepthM: [0.03, 0.16], frameWidthM: [0.035, 0.075], baseHeightM: [0.1, 0.4],
    corniceDepthM: [0.02, 0.18], symmetry: [0.45, 0.82], ornament: [0, 0.1],
    balconyProbability: [0.32, 0.7], shopfrontProbability: [0.12, 0.42],
    wallPalette: [[0.73, 0.73, 0.69], [0.84, 0.83, 0.78], [0.55, 0.57, 0.56], [0.64, 0.58, 0.49]],
    roofPalette: [[0.22, 0.23, 0.23], [0.35, 0.36, 0.35]],
    trimPalette: [[0.88, 0.87, 0.83], [0.38, 0.4, 0.39]], framePalette: [[0.16, 0.17, 0.17], [0.75, 0.76, 0.75]],
    roofShapes: [["flat", 7], ["skillion", 2], ["gabled", 1]], lintels: [["flat", 1]], material: "render-and-metal",
  },
};

const NAMED_COLORS: Readonly<Record<string, FacadeColor>> = {
  white: [0.92, 0.92, 0.89], cream: [0.88, 0.83, 0.7], beige: [0.76, 0.69, 0.57],
  yellow: [0.78, 0.62, 0.24], grey: [0.55, 0.55, 0.53], gray: [0.55, 0.55, 0.53],
  brown: [0.38, 0.24, 0.16], red: [0.58, 0.22, 0.16], green: [0.35, 0.48, 0.35],
  blue: [0.32, 0.43, 0.56], black: [0.12, 0.12, 0.11],
};

interface NormalizedAttributes {
  readonly district: MunichDistrict;
  readonly constructionYear?: number;
  readonly levels?: number;
  readonly roofLevels?: number;
  readonly frontageWidthM?: number;
  readonly buildingUse?: string;
  readonly buildingMaterial?: string;
  readonly roofShape?: FacadeRoofShape;
  readonly wallColor?: FacadeColor;
  readonly roofColor?: FacadeColor;
  readonly explicit: readonly string[];
}

/** Stable across platforms and independent of JavaScript's randomized hashes. */
export function stableFacadeSeed(buildingId: number | string): number {
  const value = String(buildingId);
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Parses common OSM color values. Invalid inputs deliberately return undefined. */
export function parseFacadeColor(value: FacadeColor | string | undefined): FacadeColor | undefined {
  if (Array.isArray(value)) {
    if (value.length !== 3 || value.some((component) => !Number.isFinite(component))) return undefined;
    return [clamp(value[0], 0, 1), clamp(value[1], 0, 1), clamp(value[2], 0, 1)];
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  const named = NAMED_COLORS[normalized];
  if (named) return named;
  const hex = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return undefined;
  const expanded = hex.length === 3 ? [...hex].map((character) => character + character).join("") : hex;
  return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255) as unknown as FacadeColor;
}

/** Selects a family from explicit evidence first, then Munich district priors. */
export function inferMunichFacadeFamily(
  buildingId: number | string,
  attributes: FacadeAttributes = {},
): MunichFacadeFamily {
  const seed = stableFacadeSeed(buildingId);
  const normalized = normalizeAttributes(attributes);
  const material = normalized.buildingMaterial ?? "";
  const year = normalized.constructionYear;

  if (/glass|steel|metal/.test(material)) return "contemporary-infill";
  if (/concrete|beton/.test(material) && (year === undefined || year >= 1945)) return "postwar-functional";
  if (year !== undefined) {
    if (year < 1850) return normalized.district === "altstadt" ? "altstadt-plaster" : "maxvorstadt-classicist";
    if (year <= 1895) return normalized.district === "schwabing" ? "schwabing-gruenderzeit" : "maxvorstadt-classicist";
    if (year <= 1918) {
      return normalized.district === "schwabing" && randomUnit(seed, "year-family") > 0.42
        ? "schwabing-jugendstil"
        : "schwabing-gruenderzeit";
    }
    if (year <= 1945) return "interwar-reform";
    if (year <= 1989) return "postwar-functional";
    return "contemporary-infill";
  }

  const districtWeights: Readonly<Record<MunichDistrict, readonly Weighted<MunichFacadeFamily>[]>> = {
    altstadt: [["altstadt-plaster", 6], ["maxvorstadt-classicist", 2], ["postwar-functional", 1], ["contemporary-infill", 1]],
    maxvorstadt: [["maxvorstadt-classicist", 4], ["schwabing-gruenderzeit", 3], ["interwar-reform", 1.5], ["postwar-functional", 1], ["contemporary-infill", 0.5]],
    schwabing: [["schwabing-gruenderzeit", 3.5], ["schwabing-jugendstil", 2.5], ["interwar-reform", 1], ["postwar-functional", 2], ["contemporary-infill", 1]],
    other: [["altstadt-plaster", 0.5], ["maxvorstadt-classicist", 1.5], ["schwabing-gruenderzeit", 2], ["schwabing-jugendstil", 1], ["interwar-reform", 1.5], ["postwar-functional", 2.5], ["contemporary-infill", 1]],
  };
  return weightedPick(districtWeights[normalized.district], randomUnit(seed, "district-family"));
}

/** Produces a complete, renderer-independent facade specification. */
export function deriveFacadeSpec(buildingId: number | string, attributes: FacadeAttributes = {}): FacadeSpec {
  const id = String(buildingId);
  const seed = stableFacadeSeed(id);
  const normalized = normalizeAttributes(attributes);
  const family = inferMunichFacadeFamily(id, attributes);
  const profile = PROFILES[family];
  const floorCount = normalized.levels ?? integerRange(profile.floors, randomUnit(seed, "floors"));
  const roofCount = normalized.roofLevels ?? (randomUnit(seed, "roof-levels") > 0.68 ? 1 : 0);
  const floorHeightM = sampleRange(profile.floorHeightM, randomUnit(seed, "floor-height"));
  const groundFloorHeightM = sampleRange(profile.groundFloorHeightM, randomUnit(seed, "ground-height"));
  const preferredBayWidthM = sampleRange(profile.bayWidthM, randomUnit(seed, "bay-width"));
  const nominalBayCount = normalized.frontageWidthM
    ? clamp(Math.round(normalized.frontageWidthM / preferredBayWidthM), 1, 24)
    : integerRange([3, 8], randomUnit(seed, "nominal-bays"));
  const roofShape = normalized.roofShape
    ?? weightedPick(profile.roofShapes, randomUnit(seed, "roof-shape"));
  const use = normalized.buildingUse ?? "";
  const shopUseMultiplier = /retail|commercial|office/.test(use) ? 1.45 : /residential|apartments|house/.test(use) ? 0.72 : 1;
  const wallColor = normalized.wallColor ?? paletteColor(profile.wallPalette, seed, "wall-color", 0.035);
  const roofColor = normalized.roofColor ?? paletteColor(profile.roofPalette, seed, "roof-color", 0.02);
  const confidence = confidenceFor(normalized);

  return {
    buildingId: id,
    seed,
    family,
    surfaceMaterial: normalized.buildingMaterial ?? profile.material,
    colors: {
      wall: wallColor,
      roof: roofColor,
      trim: paletteColor(profile.trimPalette, seed, "trim-color", 0.018),
      windowFrame: paletteColor(profile.framePalette, seed, "frame-color", 0.012),
      glazing: paletteColor([[0.31, 0.38, 0.39], [0.4, 0.46, 0.46], [0.27, 0.33, 0.34]], seed, "glass-color", 0.01),
    },
    floors: {
      count: floorCount,
      roofCount,
      floorHeightM: round(floorHeightM),
      groundFloorHeightM: round(groundFloorHeightM),
      estimatedWallHeightM: round(groundFloorHeightM + Math.max(0, floorCount - 1) * floorHeightM),
    },
    facade: {
      preferredBayWidthM: round(preferredBayWidthM),
      nominalBayCount,
      baseHeightM: round(sampleRange(profile.baseHeightM, randomUnit(seed, "base-height"))),
      corniceDepthM: round(sampleRange(profile.corniceDepthM, randomUnit(seed, "cornice"))),
      symmetry: round(sampleRange(profile.symmetry, randomUnit(seed, "symmetry")), 3),
      ornament: round(sampleRange(profile.ornament, randomUnit(seed, "ornament")), 3),
      balconyProbability: round(sampleRange(profile.balconyProbability, randomUnit(seed, "balcony")), 3),
      shopfrontProbability: round(clamp(
        sampleRange(profile.shopfrontProbability, randomUnit(seed, "shopfront")) * shopUseMultiplier,
        0,
        1,
      ), 3),
    },
    windows: {
      widthM: round(preferredBayWidthM * sampleRange(profile.windowWidthRatio, randomUnit(seed, "window-width"))),
      heightM: round(sampleRange(profile.windowHeightM, randomUnit(seed, "window-height"))),
      sillHeightM: round(sampleRange(profile.sillHeightM, randomUnit(seed, "sill-height"))),
      recessDepthM: round(sampleRange(profile.recessDepthM, randomUnit(seed, "window-recess"))),
      frameWidthM: round(sampleRange(profile.frameWidthM, randomUnit(seed, "frame-width"))),
      lintel: weightedPick(profile.lintels, randomUnit(seed, "lintel")),
    },
    roof: { shape: roofShape, pitchDegrees: roofPitch(roofShape) },
    confidence,
    source: {
      method: "procedural-inference",
      generator: "munich-facade-spec-v1",
      input: attributes.source ?? null,
      basis: sourceBasis(normalized),
      explicitAttributes: normalized.explicit,
    },
  };
}

function normalizeAttributes(attributes: FacadeAttributes): NormalizedAttributes {
  const tags = attributes.tags ?? {};
  const explicit: string[] = [];
  const select = <T>(name: string, direct: T | undefined, tagKey?: string): T | FacadeTagValue | undefined => {
    const value = direct ?? (tagKey ? tags[tagKey] : undefined);
    if (value !== undefined && value !== null && value !== "") explicit.push(name);
    return value;
  };

  const districtValue = select("district", attributes.district, "addr:suburb");
  const yearValue = select("constructionYear", attributes.constructionYear, "start_date");
  const levelsValue = select("levels", attributes.levels, "building:levels");
  const roofLevelsValue = select("roofLevels", attributes.roofLevels, "roof:levels");
  const materialValue = select("buildingMaterial", attributes.buildingMaterial, "building:material");
  const useValue = select("buildingUse", attributes.buildingUse ?? asString(tags["building:use"]), "building");
  const roofShapeValue = select("roofShape", attributes.roofShape, "roof:shape");
  const wallColorValue = select("wallColor", attributes.wallColor, "building:colour");
  const roofColorValue = select("roofColor", attributes.roofColor, "roof:colour");
  if (attributes.frontageWidthM !== undefined) explicit.push("frontageWidthM");

  return {
    district: normalizeDistrict(asString(districtValue)),
    constructionYear: normalizeYear(yearValue),
    levels: normalizeCount(levelsValue, 1, 20),
    roofLevels: normalizeCount(roofLevelsValue, 0, 5),
    frontageWidthM: finiteInRange(attributes.frontageWidthM, 1, 500),
    buildingUse: asString(useValue)?.toLowerCase(),
    buildingMaterial: asString(materialValue)?.toLowerCase(),
    roofShape: normalizeRoofShape(asString(roofShapeValue)),
    wallColor: parseFacadeColor(colorValue(wallColorValue)),
    roofColor: parseFacadeColor(colorValue(roofColorValue)),
    explicit,
  };
}

function colorValue(value: FacadeTagValue | FacadeColor): FacadeColor | string | undefined {
  return Array.isArray(value) ? value as unknown as FacadeColor : asString(value);
}

function normalizeDistrict(value: string | undefined): MunichDistrict {
  const normalized = value?.toLowerCase() ?? "";
  if (/altstadt|zentrum|centre|center/.test(normalized)) return "altstadt";
  if (normalized.includes("maxvorstadt")) return "maxvorstadt";
  if (normalized.includes("schwabing")) return "schwabing";
  return "other";
}

function normalizeRoofShape(value: string | undefined): FacadeRoofShape | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase().replaceAll("_", "-");
  const aliases: Readonly<Record<string, FacadeRoofShape>> = {
    flat: "flat", gable: "gabled", gabled: "gabled", hipped: "hipped", hip: "hipped",
    "half-hipped": "half-hipped", mansard: "mansard", pyramidal: "pyramidal", pyramid: "pyramidal",
    skillion: "skillion", shed: "skillion",
  };
  return aliases[normalized];
}

function normalizeYear(value: FacadeTagValue): number | undefined {
  const match = String(value ?? "").match(/(?:1[5-9]|20)\d{2}/)?.[0];
  const year = match ? Number.parseInt(match, 10) : typeof value === "number" ? value : Number.NaN;
  return finiteInRange(year, 1500, 2100);
}

function normalizeCount(value: FacadeTagValue, minimum: number, maximum: number): number | undefined {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(numeric) ? Math.round(clamp(numeric, minimum, maximum)) : undefined;
}

function sourceBasis(attributes: NormalizedAttributes): readonly FacadeBasis[] {
  const basis: FacadeBasis[] = ["building-id-seed"];
  if (attributes.explicit.length > 0) basis.push("explicit-attributes");
  if (attributes.constructionYear !== undefined) basis.push("construction-year-prior");
  if (attributes.district !== "other") basis.push("district-prior");
  if (attributes.buildingMaterial) basis.push("material-prior");
  basis.push("family-palette", "family-geometry");
  return basis;
}

function confidenceFor(attributes: NormalizedAttributes): FacadeConfidence {
  const family = attributes.constructionYear !== undefined ? 0.88
    : attributes.district !== "other" ? 0.67
      : attributes.buildingMaterial ? 0.56 : 0.34;
  const paletteEvidence = Number(attributes.wallColor !== undefined) + Number(attributes.roofColor !== undefined);
  const palette = paletteEvidence === 2 ? 0.96 : paletteEvidence === 1 ? 0.72 : 0.42;
  const geometryEvidence = Number(attributes.levels !== undefined) + Number(attributes.frontageWidthM !== undefined);
  const geometry = geometryEvidence === 2 ? 0.9 : geometryEvidence === 1 ? 0.68 : 0.38;
  const overall = round(family * 0.4 + palette * 0.25 + geometry * 0.35, 3);
  return {
    overall,
    family: round(family, 3),
    palette: round(palette, 3),
    geometry: round(geometry, 3),
    label: overall >= 0.75 ? "high" : overall >= 0.5 ? "medium" : "low",
  };
}

function paletteColor(
  palette: readonly FacadeColor[],
  seed: number,
  salt: string,
  variation: number,
): FacadeColor {
  const base = palette[Math.floor(randomUnit(seed, `${salt}-choice`) * palette.length)] ?? palette[0];
  const offset = (randomUnit(seed, `${salt}-variation`) * 2 - 1) * variation;
  return base.map((component) => round(clamp(component + offset, 0, 1), 3)) as unknown as FacadeColor;
}

function roofPitch(shape: FacadeRoofShape): number {
  const pitches: Readonly<Record<FacadeRoofShape, number>> = {
    flat: 2, gabled: 36, "half-hipped": 38, hipped: 32, mansard: 55, pyramidal: 30, skillion: 12,
  };
  return pitches[shape];
}

function weightedPick<T>(values: readonly Weighted<T>[], unit: number): T {
  const total = values.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = unit * total;
  for (const [value, weight] of values) {
    cursor -= weight;
    if (cursor <= 0) return value;
  }
  return values[values.length - 1][0];
}

function randomUnit(seed: number, salt: string): number {
  let value = seed ^ stableFacadeSeed(salt);
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  value ^= value >>> 15;
  return (value >>> 0) / 0x1_0000_0000;
}

function integerRange(range: readonly [number, number], unit: number): number {
  return range[0] + Math.floor(unit * (range[1] - range[0] + 1));
}

function sampleRange(range: Range, unit: number): number {
  return range[0] + (range[1] - range[0]) * unit;
}

function finiteInRange(value: number | undefined, minimum: number, maximum: number): number | undefined {
  return value !== undefined && Number.isFinite(value) ? clamp(value, minimum, maximum) : undefined;
}

function asString(value: FacadeTagValue | FacadeColor): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() || undefined : undefined;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
