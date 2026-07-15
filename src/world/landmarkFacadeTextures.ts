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
  | "cafe-franca"
  | "hofbraeuhaus"
  | "alte-pinakothek-theresienstrasse"
  | "alte-pinakothek-gabelsbergerstrasse"
  | "alte-pinakothek-end"
  | "museum-brandhorst-marianne"
  | "museum-brandhorst-tuerken"
  | "museum-brandhorst-theresien"
  | "museum-brandhorst-south"
  | "bayerische-staatsbibliothek-ludwigstrasse"
  | "haus-der-kunst-prinzregentenstrasse-main"
  | "haus-der-kunst-prinzregentenstrasse-inner-wing"
  | "haus-der-kunst-prinzregentenstrasse-outer-wing"
  | "pinakothek-der-moderne-marianne"
  | "pinakothek-der-moderne-tuerkenstrasse"
  | "pinakothek-der-moderne-gabelsbergerstrasse"
  | "pinakothek-der-moderne-barerstrasse"
  | "nsdoku-briennerstrasse"
  | "nsdoku-west"
  | "nsdoku-north"
  | "nsdoku-east"
  | "museum-fuenf-kontinente-maximilianstrasse"
  | "hotel-vier-jahreszeiten-maximilianstrasse";

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
  hofbraeuhaus: {
    file: "hofbraeuhaus-facade.png",
    roughness: 0.88,
    specularIntensity: 0.22,
  },
  "alte-pinakothek-theresienstrasse": {
    file: "alte-pinakothek-theresienstrasse.png",
    roughness: 0.91,
    specularIntensity: 0.18,
  },
  "alte-pinakothek-gabelsbergerstrasse": {
    file: "alte-pinakothek-gabelsbergerstrasse.png",
    roughness: 0.93,
    specularIntensity: 0.16,
  },
  "alte-pinakothek-end": {
    file: "alte-pinakothek-end.png",
    roughness: 0.91,
    specularIntensity: 0.18,
  },
  "museum-brandhorst-marianne": {
    file: "museum-brandhorst-marianne.png",
    roughness: 0.58,
    specularIntensity: 0.44,
  },
  "museum-brandhorst-tuerken": {
    file: "museum-brandhorst-tuerken.png",
    roughness: 0.58,
    specularIntensity: 0.44,
  },
  "museum-brandhorst-theresien": {
    file: "museum-brandhorst-theresien.png",
    roughness: 0.56,
    specularIntensity: 0.46,
  },
  "museum-brandhorst-south": {
    file: "museum-brandhorst-south.png",
    roughness: 0.58,
    specularIntensity: 0.44,
  },
  "bayerische-staatsbibliothek-ludwigstrasse": {
    file: "bayerische-staatsbibliothek-ludwigstrasse.png",
    roughness: 0.91,
    specularIntensity: 0.18,
  },
  "haus-der-kunst-prinzregentenstrasse-main": {
    file: "haus-der-kunst-prinzregentenstrasse-main.png",
    roughness: 0.90,
    specularIntensity: 0.18,
  },
  "haus-der-kunst-prinzregentenstrasse-inner-wing": {
    file: "haus-der-kunst-prinzregentenstrasse-inner-wing.png",
    roughness: 0.90,
    specularIntensity: 0.18,
  },
  "haus-der-kunst-prinzregentenstrasse-outer-wing": {
    file: "haus-der-kunst-prinzregentenstrasse-outer-wing.png",
    roughness: 0.90,
    specularIntensity: 0.18,
  },
  "pinakothek-der-moderne-marianne": {
    file: "pinakothek-der-moderne-marianne.png",
    roughness: 0.87,
    specularIntensity: 0.20,
  },
  "pinakothek-der-moderne-tuerkenstrasse": {
    file: "pinakothek-der-moderne-tuerkenstrasse.png",
    roughness: 0.83,
    specularIntensity: 0.26,
  },
  "pinakothek-der-moderne-gabelsbergerstrasse": {
    file: "pinakothek-der-moderne-gabelsbergerstrasse.png",
    roughness: 0.86,
    specularIntensity: 0.22,
  },
  "pinakothek-der-moderne-barerstrasse": {
    file: "pinakothek-der-moderne-barerstrasse.png",
    roughness: 0.80,
    specularIntensity: 0.30,
  },
  "nsdoku-briennerstrasse": {
    file: "nsdoku-briennerstrasse.png",
    roughness: 0.88,
    specularIntensity: 0.20,
  },
  "nsdoku-west": {
    file: "nsdoku-west.png",
    roughness: 0.88,
    specularIntensity: 0.20,
  },
  "nsdoku-north": {
    file: "nsdoku-north.png",
    roughness: 0.88,
    specularIntensity: 0.20,
  },
  "nsdoku-east": {
    file: "nsdoku-east.png",
    roughness: 0.88,
    specularIntensity: 0.20,
  },
  "museum-fuenf-kontinente-maximilianstrasse": {
    file: "museum-fuenf-kontinente-maximilianstrasse.png",
    roughness: 0.91,
    specularIntensity: 0.18,
  },
  "hotel-vier-jahreszeiten-maximilianstrasse": {
    file: "hotel-vier-jahreszeiten-maximilianstrasse.png",
    roughness: 0.88,
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
