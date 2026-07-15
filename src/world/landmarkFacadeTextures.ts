import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";

export type LandmarkFacadeTextureId =
  | "elisabethmarkt"
  | "st-joseph"
  | "nordbad"
  | "munich-mma"
  | "stadtarchiv"
  | "kreuzkirche"
  | "hermann-frieb-realschule"
  | "cafe-franca";

interface LandmarkFacadeTextureSpec {
  readonly file: string;
  readonly roughness: number;
  readonly specularIntensity: number;
}

const LANDMARK_FACADE_TEXTURES: Readonly<Record<LandmarkFacadeTextureId, LandmarkFacadeTextureSpec>> = {
  elisabethmarkt: {
    file: "elisabethmarkt-bay.png",
    roughness: 0.82,
    specularIntensity: 0.38,
  },
  "st-joseph": {
    file: "st-joseph-west.png",
    roughness: 0.91,
    specularIntensity: 0.24,
  },
  nordbad: {
    file: "nordbad-facade.png",
    roughness: 0.89,
    specularIntensity: 0.27,
  },
  "munich-mma": {
    file: "munich-mma-nordbad.png",
    roughness: 0.48,
    specularIntensity: 0.62,
  },
  stadtarchiv: {
    file: "stadtarchiv-extension.png",
    roughness: 0.86,
    specularIntensity: 0.31,
  },
  kreuzkirche: {
    file: "kreuzkirche-facade.png",
    roughness: 0.93,
    specularIntensity: 0.20,
  },
  "hermann-frieb-realschule": {
    file: "hermann-frieb-realschule.png",
    roughness: 0.91,
    specularIntensity: 0.22,
  },
  "cafe-franca": {
    file: "cafe-franca-facade.png",
    roughness: 0.84,
    specularIntensity: 0.24,
  },
};

const materialCache = new WeakMap<Scene, Map<LandmarkFacadeTextureId, PBRMaterial>>();

/** Public asset path used by runtime loading and texture contract tests. */
export function landmarkFacadeTexturePath(id: LandmarkFacadeTextureId): string {
  return `assets/textures/landmarks/${LANDMARK_FACADE_TEXTURES[id].file}`;
}

/**
 * Scene-owned façade material for the reviewed landmark elevations.
 * These are deliberately clamped, rectified elevation sheets rather than
 * generic box materials: thin planes keep the art on the intended street face.
 */
export function getLandmarkFacadeMaterial(
  scene: Scene,
  id: LandmarkFacadeTextureId,
): PBRMaterial {
  let sceneMaterials = materialCache.get(scene);
  if (!sceneMaterials) {
    sceneMaterials = new Map();
    materialCache.set(scene, sceneMaterials);
  }

  const cached = sceneMaterials.get(id);
  if (cached) return cached;

  const spec = LANDMARK_FACADE_TEXTURES[id];
  const material = new PBRMaterial(`landmark-facade-material-${id}`, scene);
  material.albedoColor = Color3.White();
  material.metallic = 0;
  material.roughness = spec.roughness;
  material.directIntensity = 0.96;
  material.environmentIntensity = 0.66;
  material.specularIntensity = spec.specularIntensity;
  material.backFaceCulling = true;

  const texture = new Texture(
    `${import.meta.env.BASE_URL}${landmarkFacadeTexturePath(id)}`,
    scene,
    false,
    true,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 8;
  material.albedoTexture = texture;

  sceneMaterials.set(id, material);
  return material;
}
