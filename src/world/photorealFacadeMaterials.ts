import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import type { MunichFacadeFamily } from "./facadeSpecs";

export type FacadeTextureLayer =
  | "upper"
  | "ground-residential"
  | "ground-retail"
  | "neutral";

export type FacadeTextureBundleId =
  | "legacy-heritage"
  | "legacy-jugendstil"
  | "legacy-postwar"
  | "legacy-contemporary"
  | "elisabeth-postwar-yellow"
  | "elisabeth-postwar-oxide"
  | "elisabeth-modernist"
  | "elisabeth-jugendstil-white"
  | "elisabeth-classicist-ochre";

interface FacadeTextureBundle {
  readonly id: FacadeTextureBundleId;
  readonly textures: Readonly<Record<FacadeTextureLayer, string>>;
  readonly roughness: number;
  readonly specularIntensity: number;
  readonly horizontalBaySpan: number;
  readonly upperFloorSpan: number;
}

export interface FacadeTextureSelection {
  readonly id: FacadeTextureBundleId;
  readonly index: number;
  readonly count: number;
}

const texture = (file: string): string => `assets/textures/${file}`;

const BUNDLES: Readonly<Record<FacadeTextureBundleId, FacadeTextureBundle>> = {
  "legacy-heritage": {
    id: "legacy-heritage",
    textures: {
      upper: texture("munich-heritage-facade-v2.png"),
      "ground-residential": texture("munich-heritage-facade-v2.png"),
      "ground-retail": texture("munich-heritage-facade-v2.png"),
      neutral: texture("elisabeth-neutral-ochre-v1.png"),
    },
    roughness: 0.83,
    specularIntensity: 0.43,
    horizontalBaySpan: 1,
    upperFloorSpan: 1,
  },
  "legacy-jugendstil": {
    id: "legacy-jugendstil",
    textures: {
      upper: texture("munich-jugendstil-facade-v2.png"),
      "ground-residential": texture("munich-jugendstil-facade-v2.png"),
      "ground-retail": texture("munich-jugendstil-facade-v2.png"),
      neutral: texture("elisabeth-neutral-jugendstil-v1.png"),
    },
    roughness: 0.86,
    specularIntensity: 0.4,
    horizontalBaySpan: 1,
    upperFloorSpan: 1,
  },
  "legacy-postwar": {
    id: "legacy-postwar",
    textures: {
      upper: texture("munich-postwar-facade-v2.png"),
      "ground-residential": texture("munich-postwar-facade-v2.png"),
      "ground-retail": texture("munich-postwar-facade-v2.png"),
      neutral: texture("elisabeth-neutral-yellow-v1.png"),
    },
    roughness: 0.88,
    specularIntensity: 0.39,
    horizontalBaySpan: 1,
    upperFloorSpan: 1,
  },
  "legacy-contemporary": {
    id: "legacy-contemporary",
    textures: {
      upper: texture("munich-contemporary-facade-v2.png"),
      "ground-residential": texture("munich-contemporary-facade-v2.png"),
      "ground-retail": texture("munich-contemporary-facade-v2.png"),
      neutral: texture("elisabeth-neutral-modernist-v1.png"),
    },
    roughness: 0.68,
    specularIntensity: 0.56,
    horizontalBaySpan: 1,
    upperFloorSpan: 1,
  },
  "elisabeth-postwar-yellow": {
    id: "elisabeth-postwar-yellow",
    textures: {
      upper: texture("elisabeth-postwar-yellow-upper-v1.png"),
      "ground-residential": texture("elisabeth-postwar-yellow-ground-residential-v1.png"),
      "ground-retail": texture("elisabeth-postwar-yellow-ground-retail-v1.png"),
      neutral: texture("elisabeth-neutral-yellow-v1.png"),
    },
    roughness: 0.87,
    specularIntensity: 0.39,
    horizontalBaySpan: 4,
    upperFloorSpan: 2,
  },
  "elisabeth-postwar-oxide": {
    id: "elisabeth-postwar-oxide",
    textures: {
      upper: texture("elisabeth-postwar-oxide-upper-v1.png"),
      "ground-residential": texture("elisabeth-postwar-oxide-ground-residential-v1.png"),
      "ground-retail": texture("elisabeth-postwar-brick-ground-retail-v1.png"),
      neutral: texture("elisabeth-neutral-oxide-v1.png"),
    },
    roughness: 0.88,
    specularIntensity: 0.37,
    horizontalBaySpan: 4,
    upperFloorSpan: 2,
  },
  "elisabeth-modernist": {
    id: "elisabeth-modernist",
    textures: {
      upper: texture("elisabeth-modernist-upper-v1.png"),
      "ground-residential": texture("elisabeth-modernist-ground-mixed-v1.png"),
      "ground-retail": texture("elisabeth-modernist-ground-mixed-v1.png"),
      neutral: texture("elisabeth-neutral-modernist-v1.png"),
    },
    roughness: 0.82,
    specularIntensity: 0.43,
    horizontalBaySpan: 4,
    upperFloorSpan: 2,
  },
  "elisabeth-jugendstil-white": {
    id: "elisabeth-jugendstil-white",
    textures: {
      upper: texture("elisabeth-jugendstil-white-upper-v1.png"),
      "ground-residential": texture("elisabeth-jugendstil-white-ground-residential-v1.png"),
      "ground-retail": texture("elisabeth-historic-ground-retail-v1.png"),
      neutral: texture("elisabeth-neutral-jugendstil-v1.png"),
    },
    roughness: 0.85,
    specularIntensity: 0.4,
    horizontalBaySpan: 4,
    upperFloorSpan: 2,
  },
  "elisabeth-classicist-ochre": {
    id: "elisabeth-classicist-ochre",
    textures: {
      upper: texture("elisabeth-classicist-ochre-upper-v1.png"),
      "ground-residential": texture("elisabeth-classicist-ochre-ground-residential-v1.png"),
      "ground-retail": texture("elisabeth-historic-ground-retail-v1.png"),
      neutral: texture("elisabeth-neutral-ochre-v1.png"),
    },
    roughness: 0.84,
    specularIntensity: 0.41,
    horizontalBaySpan: 4,
    upperFloorSpan: 2,
  },
};

export const FACADE_BUNDLE_IDS = Object.freeze(
  Object.keys(BUNDLES) as FacadeTextureBundleId[],
);

const FAMILY_BUNDLES: Readonly<Record<MunichFacadeFamily, readonly FacadeTextureBundleId[]>> = {
  "altstadt-plaster": ["legacy-heritage", "elisabeth-classicist-ochre", "elisabeth-jugendstil-white"],
  "maxvorstadt-classicist": ["legacy-heritage", "elisabeth-classicist-ochre", "elisabeth-jugendstil-white", "elisabeth-modernist"],
  "schwabing-gruenderzeit": ["legacy-heritage", "elisabeth-classicist-ochre", "elisabeth-jugendstil-white"],
  "schwabing-jugendstil": ["legacy-jugendstil", "elisabeth-jugendstil-white", "elisabeth-classicist-ochre"],
  "interwar-reform": ["legacy-postwar", "elisabeth-modernist", "elisabeth-postwar-yellow"],
  "postwar-functional": ["legacy-postwar", "elisabeth-postwar-yellow", "elisabeth-postwar-oxide", "elisabeth-modernist"],
  "contemporary-infill": ["legacy-contemporary", "elisabeth-modernist"],
};

const materialCache = new WeakMap<Scene, Map<string, PBRMaterial>>();

// The ground facade is a shallow shell over the full-height upper facade.
// Pull its fragments toward the camera in depth-buffer space so the shell
// stays authoritative at distance and at grazing angles, where its physical
// 18 mm separation alone is not enough to prevent z-fighting.
const GROUND_LAYER_Z_OFFSET = -1;
const GROUND_LAYER_Z_OFFSET_UNITS = -4;

function mixSeed(seed: number): number {
  let value = (seed ^ 0x9e3779b9) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}

/** Selects one era-compatible upper/base bundle and keeps the result stable by building ID. */
export function selectPhotorealFacadeBundle(
  family: MunichFacadeFamily,
  seed: number,
): FacadeTextureSelection {
  const options = FAMILY_BUNDLES[family];
  const index = mixSeed(seed) % options.length;
  return { id: options[index], index, count: options.length };
}

/** Exposes relative asset paths for deterministic contract validation. */
export function facadeBundleTexturePath(
  bundleId: FacadeTextureBundleId,
  layer: FacadeTextureLayer,
): string {
  return BUNDLES[bundleId].textures[layer];
}

function facadeTexture(
  scene: Scene,
  url: string,
  bundle: FacadeTextureBundle,
  layer: FacadeTextureLayer,
): Texture {
  const resolvedUrl = `${import.meta.env.BASE_URL}${url}`;
  const result = new Texture(
    resolvedUrl,
    scene,
    false,
    true,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  result.wrapU = Texture.WRAP_ADDRESSMODE;
  result.wrapV = Texture.WRAP_ADDRESSMODE;
  result.anisotropicFilteringLevel = 8;
  result.uScale = 1 / bundle.horizontalBaySpan;
  result.vScale = layer === "upper" ? 1 / bundle.upperFloorSpan : 1;
  return result;
}

/** Returns scene-owned shared PBR materials, bounded by facade bundle and layer. */
export function getPhotorealFacadeMaterial(
  scene: Scene,
  bundleId: FacadeTextureBundleId,
  layer: FacadeTextureLayer,
): PBRMaterial {
  let sceneMaterials = materialCache.get(scene);
  if (!sceneMaterials) {
    sceneMaterials = new Map();
    materialCache.set(scene, sceneMaterials);
  }

  const key = `${bundleId}:${layer}`;
  const cached = sceneMaterials.get(key);
  if (cached) return cached;

  const bundle = BUNDLES[bundleId];
  const material = new PBRMaterial(`photoreal-facade-material-${key}`, scene);
  material.albedoTexture = facadeTexture(scene, bundle.textures[layer], bundle, layer);
  material.albedoColor = Color3.White();
  material.metallic = 0;
  material.roughness = bundle.roughness;
  material.directIntensity = 0.95;
  material.environmentIntensity = 0.7;
  material.specularIntensity = bundle.specularIntensity;
  material.backFaceCulling = true;
  if (layer === "ground-residential" || layer === "ground-retail") {
    material.zOffset = GROUND_LAYER_Z_OFFSET;
    material.zOffsetUnits = GROUND_LAYER_Z_OFFSET_UNITS;
  }
  sceneMaterials.set(key, material);
  return material;
}
