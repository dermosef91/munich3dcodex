import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { lonLatToWorld } from "./geo";
import { getLandmarkFacadeMaterial } from "./landmarkFacadeTextures";
import { createKreuzkirche } from "./landmarks/Kreuzkirche";
import { createTextureFirstLandmarks } from "./landmarks/TextureFirstLandmarks";

interface LandmarkMaterials {
  limestone: StandardMaterial;
  warmStone: StandardMaterial;
  ochreStucco: StandardMaterial;
  paleStucco: StandardMaterial;
  copper: StandardMaterial;
  redRoof: StandardMaterial;
  mauveRoof: StandardMaterial;
  darkRoof: StandardMaterial;
  timber: StandardMaterial;
  timberDark: StandardMaterial;
  charcoal: StandardMaterial;
  bronze: StandardMaterial;
  gold: StandardMaterial;
  archiveBlue: StandardMaterial;
  archiveGlass: StandardMaterial;
  marketGlass: StandardMaterial;
  mmaGlass: StandardMaterial;
  water: StandardMaterial;
  poolDeck: StandardMaterial;
  granite: StandardMaterial;
  foliage: StandardMaterial;
  foliageLight: StandardMaterial;
  blossom: StandardMaterial;
  cafeUmbrella: StandardMaterial;
  door: StandardMaterial;
  white: StandardMaterial;
  red: StandardMaterial;
}

interface PavilionSpec {
  id: number;
  center: readonly [x: number, z: number];
  width: number;
  depth: number;
  yaw: number;
  label: string;
}

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

const MARKET_PAVILIONS: readonly PavilionSpec[] = [
  { id: 1_193_386_924, center: [137.876, -640.568], width: 11.9, depth: 14.9, yaw: 0.084, label: "OCHSENBRATEREI" },
  { id: 1_193_386_925, center: [156.847, -640.357], width: 14.3, depth: 17.2, yaw: 0.084, label: "BROT  ·  KÄSE" },
  { id: 1_193_386_926, center: [164.740, -656.274], width: 16.6, depth: 8.8, yaw: 0.084, label: "OBST  ·  GEMÜSE" },
  { id: 1_193_386_927, center: [173.030, -638.144], width: 14.2, depth: 10.9, yaw: 0.084, label: "STANDL 20" },
  { id: 1_193_386_928, center: [180.480, -654.632], width: 13.0, depth: 16.7, yaw: 0.084, label: "FEINKOST" },
  { id: 1_193_386_929, center: [201.758, -643.807], width: 13.0, depth: 17.8, yaw: 0.084, label: "ELISABETH MARKT" },
  { id: 1_193_386_930, center: [195.368, -659.668], width: 15.0, depth: 9.5, yaw: 0.084, label: "FISCH  ·  WEIN" },
  { id: 1_193_386_931, center: [216.368, -644.082], width: 9.9, depth: 16.6, yaw: 0.084, label: "BLUMEN" },
  { id: 1_193_386_932, center: [212.622, -659.714], width: 15.8, depth: 9.1, yaw: 0.084, label: "BÄCKEREI" },
  { id: 1_288_780_265, center: [187.512, -639.706], width: 10.8, depth: 12.9, yaw: 0.084, label: "ELISABETH MARKT" },
];

function colorMaterial(
  scene: Scene,
  name: string,
  diffuse: Color3,
  specular = new Color3(0.035, 0.035, 0.03),
): StandardMaterial {
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = diffuse;
  result.specularColor = specular;
  result.specularPower = 32;
  result.ambientColor = diffuse.scale(0.28);
  return result;
}

function translucentMaterial(
  scene: Scene,
  name: string,
  diffuse: Color3,
  alpha: number,
): StandardMaterial {
  const result = colorMaterial(scene, name, diffuse, new Color3(0.45, 0.52, 0.54));
  result.alpha = alpha;
  result.backFaceCulling = false;
  result.needDepthPrePass = true;
  return result;
}

function repeatingLandmarkTexture(
  scene: Scene,
  file: string,
  scale: number,
): Texture {
  const texture = new Texture(
    `${import.meta.env.BASE_URL}assets/textures/materials/${file}`,
    scene,
    false,
    true,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.uScale = scale;
  texture.vScale = scale;
  texture.anisotropicFilteringLevel = 8;
  return texture;
}

function timberPanelMaterial(scene: Scene): StandardMaterial {
  const texture = new DynamicTexture("landmark-market-timber-texture", { width: 512, height: 512 }, scene, false);
  texture.hasAlpha = false;
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  // The rebuilt 2024 market is a pale batten screen over vivid green backing,
  // not the dark rustic timber of the temporary market it replaced.
  context.fillStyle = "#8faf28";
  context.fillRect(0, 0, 512, 512);
  for (let x = 0; x < 512; x += 14) {
    context.fillStyle = (x / 14) % 3 === 0 ? "#b2b3a7" : "#bcbcaf";
    context.fillRect(x + 2, 0, 10, 512);
    context.fillStyle = "rgba(255,255,242,0.22)";
    context.fillRect(x + 3, 0, 1, 512);
    context.fillStyle = "rgba(44,54,37,0.38)";
    context.fillRect(x + 12, 0, 2, 512);
  }
  for (let y = 24; y < 512; y += 91) {
    context.strokeStyle = "rgba(88,86,72,0.08)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(2, y);
    context.bezierCurveTo(138, y + 2, 350, y - 2, 510, y + 1);
    context.stroke();
  }
  texture.anisotropicFilteringLevel = 8;
  texture.update(true);

  const material = colorMaterial(scene, "landmark-market-timber", new Color3(0.72, 0.72, 0.66));
  material.diffuseColor = new Color3(0.98, 0.98, 0.95);
  material.ambientColor = new Color3(0.26, 0.29, 0.20);
  material.diffuseTexture = texture;
  return material;
}

function createMaterials(scene: Scene): LandmarkMaterials {
  const redRoof = colorMaterial(scene, "landmark-red-roof", new Color3(0.82, 0.76, 0.70));
  redRoof.diffuseTexture = repeatingLandmarkTexture(scene, "roof_tiles.jpg", 4);
  const mauveRoof = colorMaterial(scene, "landmark-mauve-roof", new Color3(0.54, 0.43, 0.45));
  mauveRoof.diffuseTexture = repeatingLandmarkTexture(scene, "munich-flat-roof-v1.png", 5);
  const darkRoof = colorMaterial(scene, "landmark-dark-roof", new Color3(0.30, 0.32, 0.31));
  darkRoof.diffuseTexture = repeatingLandmarkTexture(scene, "munich-flat-roof-v1.png", 5);
  const water = translucentMaterial(scene, "landmark-water", new Color3(0.86, 0.94, 0.96), 0.72);
  water.diffuseTexture = repeatingLandmarkTexture(scene, "munich-water-v1.png", 5);

  return {
    limestone: colorMaterial(scene, "landmark-limestone", new Color3(0.64, 0.60, 0.49)),
    warmStone: colorMaterial(scene, "landmark-warm-stone", new Color3(0.76, 0.70, 0.58)),
    ochreStucco: colorMaterial(scene, "landmark-ochre-stucco", new Color3(0.76, 0.66, 0.34)),
    paleStucco: colorMaterial(scene, "landmark-pale-stucco", new Color3(0.87, 0.83, 0.66)),
    copper: colorMaterial(scene, "landmark-aged-copper", new Color3(0.34, 0.50, 0.45), new Color3(0.16, 0.22, 0.19)),
    redRoof,
    mauveRoof,
    darkRoof,
    timber: timberPanelMaterial(scene),
    timberDark: colorMaterial(scene, "landmark-market-dark-timber", new Color3(0.18, 0.21, 0.20)),
    charcoal: colorMaterial(scene, "landmark-charcoal", new Color3(0.055, 0.06, 0.06), new Color3(0.12, 0.12, 0.11)),
    bronze: colorMaterial(scene, "landmark-bronze", new Color3(0.19, 0.135, 0.07), new Color3(0.22, 0.18, 0.10)),
    gold: colorMaterial(scene, "landmark-gold", new Color3(0.78, 0.52, 0.08), new Color3(0.72, 0.58, 0.22)),
    archiveBlue: colorMaterial(scene, "landmark-archive-blue", new Color3(0.31, 0.36, 0.37)),
    archiveGlass: colorMaterial(scene, "landmark-archive-window", new Color3(0.12, 0.16, 0.17), new Color3(0.25, 0.30, 0.31)),
    marketGlass: translucentMaterial(scene, "landmark-market-glass", new Color3(0.09, 0.16, 0.16), 0.78),
    mmaGlass: translucentMaterial(scene, "landmark-mma-glass", new Color3(0.07, 0.16, 0.19), 0.48),
    water,
    poolDeck: colorMaterial(scene, "landmark-pool-deck", new Color3(0.75, 0.69, 0.59)),
    granite: colorMaterial(scene, "landmark-granite", new Color3(0.29, 0.285, 0.27)),
    foliage: colorMaterial(scene, "landmark-planter-foliage", new Color3(0.12, 0.27, 0.10), Color3.Black()),
    foliageLight: colorMaterial(scene, "landmark-planter-foliage-light", new Color3(0.25, 0.41, 0.13), Color3.Black()),
    blossom: colorMaterial(scene, "landmark-garden-blossom", new Color3(0.95, 0.43, 0.47), Color3.Black()),
    cafeUmbrella: colorMaterial(scene, "landmark-cafe-umbrella", new Color3(0.73, 0.51, 0.47)),
    door: colorMaterial(scene, "landmark-door", new Color3(0.055, 0.075, 0.07), new Color3(0.19, 0.22, 0.20)),
    white: colorMaterial(scene, "landmark-white", new Color3(0.90, 0.89, 0.84)),
    red: colorMaterial(scene, "landmark-red", new Color3(0.59, 0.035, 0.045)),
  };
}

function landmarkNode(
  name: string,
  parent: TransformNode,
  position: Vector3,
  yaw = 0,
): TransformNode {
  const node = new TransformNode(name, parent.getScene());
  node.parent = parent;
  node.position.copyFrom(position);
  node.rotation.y = yaw;
  return node;
}

function prepare(
  mesh: Mesh,
  parent: TransformNode,
  position: readonly [x: number, y: number, z: number],
  material: Material,
  rotation: readonly [pitch: number, yaw: number, roll: number] = [0, 0, 0],
  collides = false,
): Mesh {
  mesh.parent = parent;
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.checkCollisions = collides;
  return mesh;
}

function addBox(
  scene: Scene,
  parent: TransformNode,
  name: string,
  dimensions: readonly [width: number, height: number, depth: number],
  position: readonly [x: number, y: number, z: number],
  material: StandardMaterial,
  rotation: readonly [pitch: number, yaw: number, roll: number] = [0, 0, 0],
  collides = false,
): Mesh {
  return prepare(
    MeshBuilder.CreateBox(name, { width: dimensions[0], height: dimensions[1], depth: dimensions[2] }, scene),
    parent,
    position,
    material,
    rotation,
    collides,
  );
}

function addCylinder(
  scene: Scene,
  parent: TransformNode,
  name: string,
  height: number,
  diameter: number,
  position: readonly [x: number, y: number, z: number],
  material: StandardMaterial,
  options: { diameterTop?: number; tessellation?: number; rotation?: readonly [number, number, number]; collides?: boolean } = {},
): Mesh {
  return prepare(
    MeshBuilder.CreateCylinder(name, {
      height,
      diameter,
      diameterTop: options.diameterTop,
      tessellation: options.tessellation ?? 24,
    }, scene),
    parent,
    position,
    material,
    options.rotation ?? [0, 0, 0],
    options.collides ?? false,
  );
}

function addSphere(
  scene: Scene,
  parent: TransformNode,
  name: string,
  diameter: number,
  position: readonly [x: number, y: number, z: number],
  scaling: readonly [x: number, y: number, z: number],
  material: StandardMaterial,
): Mesh {
  const mesh = prepare(
    MeshBuilder.CreateSphere(name, { diameter, segments: 18 }, scene),
    parent,
    position,
    material,
  );
  mesh.scaling.set(scaling[0], scaling[1], scaling[2]);
  return mesh;
}

function signMaterial(
  scene: Scene,
  name: string,
  text: string,
  foreground: string,
  background: string,
): StandardMaterial {
  const texture = new DynamicTexture(`${name}-texture`, { width: 1024, height: 256 }, scene, false);
  texture.hasAlpha = false;
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  context.fillStyle = background;
  context.fillRect(0, 0, 1024, 256);
  context.strokeStyle = "rgba(255,255,255,0.18)";
  context.lineWidth = 8;
  context.strokeRect(10, 10, 1004, 236);
  const fontSize = Math.max(52, Math.min(112, Math.floor(920 / Math.max(text.length * 0.58, 1))));
  context.fillStyle = foreground;
  context.font = `700 ${fontSize}px Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 512, 128, 940);
  texture.uScale = -1;
  texture.uOffset = 1;
  texture.update(true);

  const material = new StandardMaterial(`${name}-material`, scene);
  material.diffuseTexture = texture;
  material.specularColor = new Color3(0.05, 0.05, 0.045);
  material.emissiveColor = new Color3(0.09, 0.09, 0.08);
  material.backFaceCulling = true;
  return material;
}

function addSign(
  scene: Scene,
  parent: TransformNode,
  name: string,
  text: string,
  dimensions: readonly [width: number, height: number],
  position: readonly [x: number, y: number, z: number],
  yaw: number,
  foreground = "#f4ebd6",
  background = "#2d2924",
): Mesh {
  const material = signMaterial(scene, name, text, foreground, background);
  const plane = prepare(
    MeshBuilder.CreatePlane(name, { width: dimensions[0], height: dimensions[1], sideOrientation: Mesh.FRONTSIDE }, scene),
    parent,
    position,
    material,
    [0, yaw, 0],
  );
  plane.onDisposeObservable.add(() => material.dispose(true, true));
  return plane;
}

function addFacadePlane(
  scene: Scene,
  parent: TransformNode,
  name: string,
  dimensions: readonly [width: number, height: number],
  position: readonly [x: number, y: number, z: number],
  material: Material,
  yaw: number,
): Mesh {
  return prepare(
    MeshBuilder.CreatePlane(
      name,
      { width: dimensions[0], height: dimensions[1], sideOrientation: Mesh.FRONTSIDE },
      scene,
    ),
    parent,
    position,
    material,
    [0, yaw, 0],
  );
}

function mmaSealMaterial(scene: Scene): StandardMaterial {
  const texture = new DynamicTexture("munich-mma-seal-texture", { width: 512, height: 512 }, scene, false);
  texture.hasAlpha = true;
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  context.clearRect(0, 0, 512, 512);
  context.fillStyle = "#f6f6f3";
  context.strokeStyle = "#171918";
  context.lineWidth = 22;
  context.beginPath();
  context.arc(256, 256, 220, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = "#171918";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "700 54px Arial, sans-serif";
  context.fillText("MUNICH MMA", 256, 100, 370);
  context.font = "700 30px Arial, sans-serif";
  context.fillText("FIGHTING BAYRISCH", 256, 399, 370);
  context.fillText("SINCE 2007", 256, 440, 310);
  // A compact geometric fist mark keeps the official monochrome silhouette
  // legible without embedding a third-party logo bitmap in the texture sheet.
  context.fillRect(171, 180, 46, 90);
  context.fillRect(222, 164, 46, 106);
  context.fillRect(273, 170, 46, 100);
  context.fillRect(324, 188, 42, 82);
  context.beginPath();
  context.roundRect(166, 250, 205, 96, 24);
  context.fill();
  texture.uScale = -1;
  texture.uOffset = 1;
  texture.update(true);

  const material = new StandardMaterial("munich-mma-seal-material", scene);
  material.diffuseTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  material.specularColor = new Color3(0.03, 0.03, 0.03);
  material.backFaceCulling = true;
  return material;
}

function mmaPanelMaterial(scene: Scene): StandardMaterial {
  const texture = new DynamicTexture("munich-mma-panel-texture", { width: 1024, height: 512 }, scene, false);
  texture.hasAlpha = false;
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  context.fillStyle = "#f6f6f3";
  context.fillRect(0, 0, 1024, 512);
  context.strokeStyle = "#171918";
  context.lineWidth = 18;
  context.strokeRect(18, 18, 988, 476);
  context.fillStyle = "#171918";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "700 116px Arial, sans-serif";
  context.fillText("MUNICH MMA", 512, 205, 880);
  context.font = "700 43px Arial, sans-serif";
  context.fillText("JIU JITSU   ·   MMA   ·   MUAY THAI", 512, 348, 900);
  texture.uScale = -1;
  texture.uOffset = 1;
  texture.update(true);

  const material = new StandardMaterial("munich-mma-panel-material", scene);
  material.diffuseTexture = texture;
  material.specularColor = new Color3(0.03, 0.03, 0.03);
  material.backFaceCulling = true;
  return material;
}

function addGabledRoof(
  scene: Scene,
  parent: TransformNode,
  name: string,
  length: number,
  span: number,
  eaveY: number,
  rise: number,
  centerZ: number,
  material: StandardMaterial,
): void {
  const halfSpan = span * 0.5;
  const slopeLength = Math.hypot(halfSpan, rise);
  const angle = Math.atan2(rise, halfSpan);
  addBox(scene, parent, `${name}-north`, [length + 0.7, 0.24, slopeLength + 0.45], [0, eaveY + rise * 0.5, centerZ - span * 0.25], material, [-angle, 0, 0]);
  addBox(scene, parent, `${name}-south`, [length + 0.7, 0.24, slopeLength + 0.45], [0, eaveY + rise * 0.5, centerZ + span * 0.25], material, [angle, 0, 0]);
}

function createElisabethmarkt(scene: Scene, root: TransformNode, materials: LandmarkMaterials): void {
  const market = landmarkNode("landmark-elisabethmarkt", root, Vector3.Zero());
  const facadeMaterial = getLandmarkFacadeMaterial(scene, "elisabethmarkt");

  for (const pavilion of MARKET_PAVILIONS) {
    const node = landmarkNode(
      `elisabethmarkt-pavilion-${pavilion.id}`,
      market,
      new Vector3(pavilion.center[0], 0, pavilion.center[1]),
      pavilion.yaw,
    );
    const frontFacesSouth = pavilion.center[1] < -648;
    const frontDirection = frontFacesSouth ? 1 : -1;
    const frontZ = frontDirection * (pavilion.depth * 0.5 - 0.12);
    const signYaw = frontFacesSouth ? Math.PI : 0;

    addBox(scene, node, `market-plinth-${pavilion.id}`, [pavilion.width, 0.22, pavilion.depth], [0, 0.11, 0], materials.granite, undefined, true);
    addBox(scene, node, `market-shell-${pavilion.id}`, [pavilion.width - 0.28, 3.15, pavilion.depth - 0.30], [0, 1.78, 0], materials.timber, undefined, true);
    // Cover all four sides so the fine battens remain vertical on every box
    // face; applying the bitmap directly to a box rotates and stretches it.
    addFacadePlane(scene, node, `market-custom-north-${pavilion.id}`, [pavilion.width - 0.40, 3.08], [0, 1.76, pavilion.depth * 0.5 - 0.11], facadeMaterial, Math.PI);
    addFacadePlane(scene, node, `market-custom-south-${pavilion.id}`, [pavilion.width - 0.40, 3.08], [0, 1.76, -pavilion.depth * 0.5 + 0.11], facadeMaterial, 0);
    addFacadePlane(scene, node, `market-custom-west-${pavilion.id}`, [pavilion.depth - 0.40, 3.08], [-pavilion.width * 0.5 + 0.11, 1.76, 0], facadeMaterial, Math.PI / 2);
    addFacadePlane(scene, node, `market-custom-east-${pavilion.id}`, [pavilion.depth - 0.40, 3.08], [pavilion.width * 0.5 - 0.11, 1.76, 0], facadeMaterial, -Math.PI / 2);
    addBox(scene, node, `market-glazing-${pavilion.id}`, [pavilion.width * 0.72, 2.30, 0.12], [0, 1.45, frontZ], materials.marketGlass);
    addBox(scene, node, `market-sign-band-${pavilion.id}`, [pavilion.width * 0.64, 0.58, 0.18], [0, 2.84, frontZ + frontDirection * 0.03], materials.charcoal);
    addSign(
      scene,
      node,
      `market-sign-${pavilion.id}`,
      pavilion.label,
      [pavilion.width * 0.58, 0.44],
      [0, 2.84, frontZ + frontDirection * 0.13],
      signYaw,
      "#f4f3e9",
      "#303536",
    );

    const mullions = Math.max(4, Math.round(pavilion.width / 1.7));
    for (let index = 0; index <= mullions; index += 1) {
      const x = -pavilion.width * 0.35 + (index / mullions) * pavilion.width * 0.70;
      addBox(scene, node, `market-mullion-${pavilion.id}-${index}`, [0.075, 2.34, 0.16], [x, 1.44, frontZ + frontDirection * 0.06], materials.charcoal);
    }

    addBox(scene, node, `market-roof-${pavilion.id}`, [pavilion.width + 0.34, 0.25, pavilion.depth + 0.34], [0, 3.49, 0], materials.charcoal);
    const planterZ = pavilion.depth * 0.28;
    for (const side of [-1, 1]) {
      addBox(scene, node, `market-roof-planter-${pavilion.id}-${side}`, [pavilion.width * 0.70, 0.48, 0.65], [0, 3.76, side * planterZ], materials.timberDark);
      const plantCount = Math.max(3, Math.round(pavilion.width / 3));
      for (let index = 0; index < plantCount; index += 1) {
        const x = -pavilion.width * 0.28 + (index / Math.max(plantCount - 1, 1)) * pavilion.width * 0.56;
        addSphere(scene, node, `market-roof-plant-${pavilion.id}-${side}-${index}`, 0.72, [x, 4.20, side * planterZ], [1.2, 0.75, 0.85], index % 2 === 0 ? materials.foliage : materials.foliageLight);
      }
    }
  }

  // Two deliberately distinct destinations make the market legible at walking
  // height: a planted winter garden for lingering and a compact kiosk for a
  // quick stop. Both are freestanding detail layers around the existing
  // pavilion shells, so the reviewed market footprint stays intact.
  const wintergarten = landmarkNode(
    "elisabethmarkt-wintergarten",
    market,
    new Vector3(156.847, 0, -640.357),
    0.084,
  );
  const gardenDepth = 5.2;
  const gardenCenterZ = -17.2 * 0.5 - gardenDepth * 0.5 - 0.22;
  addBox(scene, wintergarten, "elisabethmarkt-wintergarten-deck", [11.8, 0.18, gardenDepth], [0, 0.09, gardenCenterZ], materials.granite);
  addBox(scene, wintergarten, "elisabethmarkt-wintergarten-planter", [11.9, 0.56, 0.58], [0, 0.28, gardenCenterZ - gardenDepth * 0.5 + 0.28], materials.timberDark);
  addBox(scene, wintergarten, "elisabethmarkt-wintergarten-side-planter-west", [0.52, 0.48, 4.35], [-5.63, 0.24, gardenCenterZ + 0.12], materials.timberDark);
  addBox(scene, wintergarten, "elisabethmarkt-wintergarten-side-planter-east", [0.52, 0.48, 4.35], [5.63, 0.24, gardenCenterZ + 0.12], materials.timberDark);

  for (const x of [-4.8, -3.2, -1.6, 0, 1.6, 3.2, 4.8]) {
    addBox(scene, wintergarten, `elisabethmarkt-wintergarten-front-post-${x}`, [0.10, 3.05, 0.10], [x, 1.62, gardenCenterZ - gardenDepth * 0.5 + 0.10], materials.charcoal);
    addSphere(scene, wintergarten, `elisabethmarkt-wintergarten-plant-${x}`, 0.80, [x, 0.84, gardenCenterZ - gardenDepth * 0.5 + 0.30], [1.0, 1.25, 0.82], x % 3 === 0 ? materials.foliageLight : materials.foliage);
  }
  for (const x of [-5.35, 5.35]) {
    addBox(scene, wintergarten, `elisabethmarkt-wintergarten-side-post-${x}`, [0.10, 3.05, 0.10], [x, 1.62, gardenCenterZ], materials.charcoal);
  }
  addBox(scene, wintergarten, "elisabethmarkt-wintergarten-top-rail", [11.0, 0.10, 0.10], [0, 3.10, gardenCenterZ - gardenDepth * 0.5 + 0.10], materials.charcoal);
  addBox(scene, wintergarten, "elisabethmarkt-wintergarten-roof", [11.15, 0.10, 5.0], [0, 3.13, gardenCenterZ], materials.marketGlass);
  addFacadePlane(scene, wintergarten, "elisabethmarkt-wintergarten-glass-front", [10.8, 2.45], [0, 1.72, gardenCenterZ - gardenDepth * 0.5 + 0.14], materials.marketGlass, 0);
  addSign(scene, wintergarten, "elisabethmarkt-wintergarten-sign", "WINTERGARTEN", [4.6, 0.48], [0, 2.86, gardenCenterZ - gardenDepth * 0.5 + 0.20], 0, "#eef1de", "#31422c");

  for (const [index, x] of [-2.7, 0, 2.7].entries()) {
    const tableZ = gardenCenterZ + 0.35;
    addCylinder(scene, wintergarten, `elisabethmarkt-wintergarten-table-${index}`, 0.68, 0.72, [x, 0.76, tableZ], materials.timberDark, { diameterTop: 0.72 });
    for (const side of [-1, 1]) {
      addBox(scene, wintergarten, `elisabethmarkt-wintergarten-seat-${index}-${side}`, [0.82, 0.42, 0.46], [x + side * 0.78, 0.43, tableZ], materials.timber);
    }
  }

  const kiosk = landmarkNode(
    "elisabethmarkt-kiosk",
    market,
    new Vector3(187.512, 0, -639.706),
    0.084,
  );
  const kioskZ = -12.9 * 0.5 - 1.85;
  addBox(scene, kiosk, "elisabethmarkt-kiosk-plinth", [6.2, 0.16, 3.5], [0, 0.08, kioskZ], materials.granite);
  addBox(scene, kiosk, "elisabethmarkt-kiosk-body", [5.8, 2.35, 2.95], [0, 1.32, kioskZ + 0.18], materials.timber);
  addBox(scene, kiosk, "elisabethmarkt-kiosk-serving-hatch", [4.65, 1.12, 0.14], [0, 1.68, kioskZ - 1.34], materials.marketGlass);
  addBox(scene, kiosk, "elisabethmarkt-kiosk-counter", [5.12, 0.18, 0.70], [0, 1.04, kioskZ - 1.65], materials.timberDark);
  addBox(scene, kiosk, "elisabethmarkt-kiosk-canopy", [6.35, 0.18, 4.15], [0, 2.62, kioskZ], materials.red);
  addBox(scene, kiosk, "elisabethmarkt-kiosk-canopy-trim", [6.48, 0.32, 0.18], [0, 2.45, kioskZ - 2.0], materials.charcoal);
  addSign(scene, kiosk, "elisabethmarkt-kiosk-sign", "MARKT KIOSK", [4.95, 0.58], [0, 2.45, kioskZ - 2.11], 0, "#fbf4e5", "#6d1518");
  for (const x of [-2.35, -1.15, 0, 1.15, 2.35]) {
    addBox(scene, kiosk, `elisabethmarkt-kiosk-awning-rib-${x}`, [0.08, 0.34, 0.22], [x, 2.31, kioskZ - 2.0], materials.charcoal);
  }
  addBox(scene, kiosk, "elisabethmarkt-kiosk-menu-left", [0.75, 0.96, 0.08], [-2.15, 1.55, kioskZ - 1.45], materials.charcoal);
  addBox(scene, kiosk, "elisabethmarkt-kiosk-menu-right", [0.75, 0.96, 0.08], [2.15, 1.55, kioskZ - 1.45], materials.charcoal);
  addBox(scene, kiosk, "elisabethmarkt-kiosk-planter", [6.0, 0.48, 0.54], [0, 0.27, kioskZ - 2.18], materials.timberDark);
  for (const x of [-2.25, -1.1, 0, 1.1, 2.25]) {
    addSphere(scene, kiosk, `elisabethmarkt-kiosk-plant-${x}`, 0.70, [x, 0.72, kioskZ - 2.18], [0.92, 1.12, 0.78], x === 0 ? materials.blossom : materials.foliageLight);
  }

  const totem = landmarkNode("elisabethmarkt-totem", market, new Vector3(226.2, 0, -652.5), 0.084);
  addBox(scene, totem, "elisabethmarkt-totem-post", [0.34, 4.7, 0.34], [0, 2.35, 0], materials.charcoal, undefined, true);
  addBox(scene, totem, "elisabethmarkt-totem-board", [5.8, 1.25, 0.22], [0, 3.55, 0], materials.charcoal);
  addSign(scene, totem, "elisabethmarkt-main-sign", "ELISABETH MARKT", [5.45, 0.91], [0, 3.55, -0.13], 0, "#f4f3e9", "#303536");
}

function createBaerenbrunnen(scene: Scene, root: TransformNode, materials: LandmarkMaterials): void {
  const position = lonLatToWorld(11.574_029_9, 48.157_201_2);
  const fountain = landmarkNode("landmark-baerenbrunnen", root, position, -0.10);

  addBox(scene, fountain, "baerenbrunnen-foot", [1.32, 0.20, 1.08], [0, 0.10, 0], materials.granite, undefined, true);
  addBox(scene, fountain, "baerenbrunnen-pedestal", [0.82, 1.34, 0.72], [0, 0.86, 0], materials.limestone, undefined, true);
  addBox(scene, fountain, "baerenbrunnen-cap", [1.02, 0.18, 0.86], [0, 1.60, 0], materials.limestone);
  addSphere(scene, fountain, "baerenbrunnen-ball", 0.62, [0, 1.95, 0], [1, 1, 1], materials.limestone);

  addSphere(scene, fountain, "baerenbrunnen-bear-body", 0.72, [0, 2.43, 0], [0.72, 1.05, 0.62], materials.limestone);
  addSphere(scene, fountain, "baerenbrunnen-bear-head", 0.50, [0, 2.93, -0.02], [0.92, 0.90, 0.82], materials.limestone);
  addSphere(scene, fountain, "baerenbrunnen-bear-snout", 0.26, [0, 2.87, -0.23], [1.0, 0.72, 0.70], materials.limestone);
  for (const side of [-1, 1]) {
    addSphere(scene, fountain, `baerenbrunnen-ear-${side}`, 0.15, [side * 0.17, 3.10, -0.01], [1, 1, 0.72], materials.limestone);
    addCylinder(scene, fountain, `baerenbrunnen-arm-${side}`, 0.60, 0.13, [side * 0.31, 2.50, -0.02], materials.limestone, { rotation: [0, 0, side * 0.58] });
    addCylinder(scene, fountain, `baerenbrunnen-leg-${side}`, 0.52, 0.15, [side * 0.17, 2.08, 0], materials.limestone, { rotation: [0, 0, side * 0.20] });
  }
  for (const side of [-1, 1]) {
    addSphere(scene, fountain, `baerenbrunnen-eye-${side}`, 0.055, [side * 0.10, 2.99, -0.225], [1, 1, 0.55], materials.bronze);
  }
  addSphere(scene, fountain, "baerenbrunnen-nose", 0.075, [0, 2.88, -0.35], [1, 0.82, 0.62], materials.bronze);
  addCylinder(scene, fountain, "baerenbrunnen-dog-bowl", 0.10, 0.72, [0, 0.18, -0.82], materials.bronze, { tessellation: 32 });
  addCylinder(scene, fountain, "baerenbrunnen-spout", 0.34, 0.09, [0, 0.72, -0.44], materials.bronze, { rotation: [Math.PI / 2, 0, 0] });
}

function addElisabethplatzTree(
  scene: Scene,
  parent: TransformNode,
  name: string,
  position: readonly [x: number, z: number],
  height: number,
  crown: number,
  materials: LandmarkMaterials,
): void {
  addCylinder(scene, parent, `${name}-trunk`, height * 0.60, Math.max(0.42, crown * 0.16), [position[0], height * 0.30, position[1]], materials.timberDark, { diameterTop: Math.max(0.20, crown * 0.075), tessellation: 8 });
  addCylinder(scene, parent, `${name}-branch-west`, height * 0.28, Math.max(0.17, crown * 0.065), [position[0] - crown * 0.14, height * 0.62, position[1] + crown * 0.03], materials.timberDark, { diameterTop: 0.08, tessellation: 6, rotation: [0.18, 0, 0.48] });
  addCylinder(scene, parent, `${name}-branch-east`, height * 0.25, Math.max(0.17, crown * 0.060), [position[0] + crown * 0.15, height * 0.64, position[1] - crown * 0.07], materials.timberDark, { diameterTop: 0.08, tessellation: 6, rotation: [-0.14, 0, -0.52] });
  for (const [index, [x, y, z, scale]] of [
    [-0.28, 0.68, 0.06, 0.78],
    [0.30, 0.70, -0.09, 0.76],
    [0.00, 0.84, 0.22, 0.72],
    [-0.04, 0.98, -0.04, 0.66],
  ].entries()) {
    addSphere(
      scene,
      parent,
      `${name}-crown-${index}`,
      crown,
      [position[0] + x * crown, y * height, position[1] + z * crown],
      [scale, scale * 0.78, scale],
      index % 2 === 0 ? materials.foliage : materials.foliageLight,
    );
  }
}

function createElisabethplatzBeerGarden(scene: Scene, root: TransformNode, materials: LandmarkMaterials): void {
  // The mapped 10 m toilet block read as a tower. It is an OSM-only shell, so
  // replace it with the low, shaded pavilion character visible at the square.
  const garden = landmarkNode("landmark-elisabethplatz-biergarten", root, new Vector3(98.185, 0, -680.98), -0.08);
  addBox(scene, garden, "elisabethplatz-biergarten-plinth", [9.2, 0.20, 6.5], [0, 0.10, 0], materials.granite, undefined, true);
  addBox(scene, garden, "elisabethplatz-biergarten-service-core", [4.6, 2.45, 2.45], [0, 1.33, 0.92], materials.timberDark, undefined, true);
  addBox(scene, garden, "elisabethplatz-biergarten-serving-counter", [5.2, 0.20, 0.70], [0, 1.06, -1.52], materials.timber);
  addBox(scene, garden, "elisabethplatz-biergarten-side-screen-west", [0.22, 1.75, 2.5], [-3.98, 1.20, 0.55], materials.timberDark);
  addBox(scene, garden, "elisabethplatz-biergarten-side-screen-east", [0.22, 1.75, 2.5], [3.98, 1.20, 0.55], materials.timberDark);

  for (const x of [-3.7, -1.25, 1.25, 3.7]) {
    addCylinder(scene, garden, `elisabethplatz-biergarten-column-${x}`, 2.78, 0.36, [x, 1.49, -1.85], materials.white, { tessellation: 20 });
  }
  addBox(scene, garden, "elisabethplatz-biergarten-eave", [9.55, 0.22, 6.85], [0, 2.86, 0], materials.timberDark);
  addCylinder(scene, garden, "elisabethplatz-biergarten-hip-roof", 1.72, 10.0, [0, 3.82, 0], materials.darkRoof, { diameterTop: 0.38, tessellation: 4, rotation: [0, Math.PI / 4, 0], collides: true });
  addSign(scene, garden, "elisabethplatz-biergarten-sign", "BIERGARTEN", [3.75, 0.46], [0, 2.42, -2.06], 0, "#f1eedc", "#294334");

  for (const [index, x] of [-2.35, 0, 2.35].entries()) {
    const z = -0.55;
    addBox(scene, garden, `elisabethplatz-biergarten-table-${index}`, [1.48, 0.12, 0.66], [x, 0.76, z], materials.timber);
    addBox(scene, garden, `elisabethplatz-biergarten-table-leg-${index}`, [0.16, 0.74, 0.16], [x, 0.37, z], materials.timberDark);
    for (const side of [-1, 1]) {
      addBox(scene, garden, `elisabethplatz-biergarten-bench-${index}-${side}`, [1.48, 0.12, 0.42], [x, 0.47, z + side * 0.72], materials.timber);
      addBox(scene, garden, `elisabethplatz-biergarten-bench-leg-${index}-${side}`, [0.14, 0.46, 0.14], [x, 0.23, z + side * 0.72], materials.timberDark);
    }
  }
  addBox(scene, garden, "elisabethplatz-biergarten-planter", [8.6, 0.46, 0.50], [0, 0.25, -3.0], materials.timberDark);
  for (const x of [-3.35, -1.7, 0, 1.7, 3.35]) {
    addSphere(scene, garden, `elisabethplatz-biergarten-planter-${x}`, 0.72, [x, 0.70, -3.0], [0.95, 1.10, 0.82], materials.foliageLight);
  }

  // The satellite reference shows a dense, mature outer canopy. Keep the
  // central Bear Fountain clearing open while filling the north and east rim.
  const trees: readonly [number, number, number, number][] = [
    [127, -687, 13.5, 7.3],
    [132, -704, 14.5, 7.9],
    [143, -716, 15.5, 8.5],
    [161, -720, 14.0, 7.8],
    [181, -717, 15.2, 8.4],
    [199, -710, 14.5, 8.0],
    [209, -698, 13.8, 7.6],
    [205, -684, 13.2, 7.2],
    [191, -676, 14.0, 7.7],
    [173, -673, 13.0, 7.1],
  ];
  trees.forEach(([x, z, height, crown], index) => {
    addElisabethplatzTree(scene, garden, `elisabethplatz-north-tree-${index}`, [x, z], height, crown, materials);
  });
}

function addCross(
  scene: Scene,
  parent: TransformNode,
  name: string,
  position: readonly [x: number, y: number, z: number],
  scale: number,
  material: StandardMaterial,
): void {
  addBox(scene, parent, `${name}-vertical`, [0.14 * scale, 1.15 * scale, 0.14 * scale], position, material);
  addBox(scene, parent, `${name}-horizontal`, [0.64 * scale, 0.14 * scale, 0.14 * scale], [position[0], position[1] + 0.18 * scale, position[2]], material);
}

function createStJoseph(scene: Scene, root: TransformNode, materials: LandmarkMaterials): void {
  // The surveyed outline is 79 m long. Its west-east axis is only a few
  // degrees off world east, so the procedural parts stay aligned with the OSM
  // footprint while restoring the landmark's real 63 m single tower.
  const church = landmarkNode("landmark-st-joseph", root, new Vector3(-321.7, 0, -494.4), -0.052);

  addBox(scene, church, "st-joseph-nave", [59, 22, 24.4], [-4.5, 11, 0], materials.paleStucco, undefined, true);
  addBox(scene, church, "st-joseph-transept", [15, 23, 30.2], [15.5, 11.5, 0], materials.paleStucco, undefined, true);
  addCylinder(scene, church, "st-joseph-apse", 19.5, 22.0, [31.0, 9.75, 0], materials.paleStucco, { tessellation: 10, collides: true });
  addGabledRoof(scene, church, "st-joseph-nave-roof", 60.2, 25.0, 22, 7.2, 0, materials.redRoof);
  addGabledRoof(scene, church, "st-joseph-transept-roof", 15.6, 31.0, 23, 6.6, 0, materials.redRoof);

  // Simplified west facade and its three-arched portico.
  addBox(scene, church, "st-joseph-west-facade", [1.7, 25.4, 26.0], [-34.2, 12.7, 0], materials.paleStucco, undefined, true);
  addFacadePlane(
    scene,
    church,
    "st-joseph-custom-west-facade",
    [25.3, 24.9],
    [-35.08, 12.48, 0],
    getLandmarkFacadeMaterial(scene, "st-joseph"),
    Math.PI / 2,
  );
  const westGable = prepare(
    MeshBuilder.CreateCylinder("st-joseph-west-gable", { height: 1.8, diameter: 30, tessellation: 3 }, scene),
    church,
    [-35.0, 25.15, 0],
    materials.paleStucco,
    [0, 0, Math.PI / 2],
  );
  westGable.scaling.x = 0.42;
  addBox(scene, church, "st-joseph-west-cornice", [2.05, 0.62, 27.3], [-35.0, 21.7, 0], materials.warmStone);
  for (const z of [-10.8, -7.8, 7.8, 10.8]) {
    addBox(scene, church, `st-joseph-west-pilaster-${z}`, [0.42, 12.8, 0.78], [-35.16, 15.0, z], materials.warmStone);
  }
  addBox(scene, church, "st-joseph-portico-roof", [4.5, 1.0, 22.2], [-36.2, 7.85, 0], materials.warmStone);
  addBox(scene, church, "st-joseph-portico-step", [4.6, 0.28, 22.8], [-36.6, 0.14, 0], materials.granite, undefined, true);
  for (const z of [-8.5, -2.85, 2.85, 8.5]) {
    addCylinder(scene, church, `st-joseph-portico-column-${z}`, 7.0, 0.72, [-36.4, 3.62, z], materials.warmStone, { tessellation: 18, collides: true });
  }
  for (const z of [-5.65, 0, 5.65]) {
    addBox(scene, church, `st-joseph-west-door-${z}`, [0.24, 5.6, 3.9], [-35.22, 3.0, z], materials.door);
    addSphere(scene, church, `st-joseph-west-arch-${z}`, 3.9, [-35.25, 5.65, z], [0.08, 0.5, 0.5], materials.door);
  }
  // The west front has a central saint niche rather than the black oculus used
  // by the earlier placeholder. The niche surround is in the reference-based
  // elevation sheet; this small projecting figure gives it readable depth.
  addCylinder(scene, church, "st-joseph-west-niche-statue-body", 1.55, 0.48, [-35.28, 15.35, 0], materials.warmStone, {
    diameterTop: 0.26,
    tessellation: 12,
  });
  addSphere(scene, church, "st-joseph-west-niche-statue-head", 0.46, [-35.28, 16.35, 0], [0.88, 1.0, 0.88], materials.warmStone);
  addBox(scene, church, "st-joseph-facade-cross-vertical", [0.16, 1.65, 0.16], [-35.95, 27.2, 0], materials.bronze);
  addBox(scene, church, "st-joseph-facade-cross-horizontal", [0.16, 0.18, 0.92], [-35.95, 27.45, 0], materials.bronze);

  // Tall round-headed side windows are enough to make the nave read as a
  // basilica at walking and driving distances.
  for (const x of [-25, -15, -5, 5, 18, 27]) {
    for (const side of [-1, 1]) {
      const sideZ = side * 12.27;
      addBox(scene, church, `st-joseph-window-${x}-${side}`, [2.15, 5.2, 0.10], [x, 11.0, sideZ], materials.archiveGlass);
      addSphere(scene, church, `st-joseph-window-arch-${x}-${side}`, 2.15, [x, 13.56, sideZ], [1, 0.52, 0.06], materials.archiveGlass);
    }
  }

  // St. Joseph has one north-offset tower (not a matching twin): square lower
  // stages, an octagonal belfry, onion hood and a needle finial.
  addBox(scene, church, "st-joseph-tower-base", [11.0, 35.0, 10.7], [-24.3, 17.5, -17.1], materials.paleStucco, undefined, true);
  addBox(scene, church, "st-joseph-tower-cornice", [12.1, 0.75, 11.8], [-24.3, 35.0, -17.1], materials.warmStone);
  addCylinder(scene, church, "st-joseph-tower-clock", 0.14, 3.45, [-29.84, 30.4, -17.1], materials.white, { tessellation: 32, rotation: [0, 0, Math.PI / 2] });
  prepare(
    MeshBuilder.CreateTorus("st-joseph-tower-clock-ring", { diameter: 3.70, thickness: 0.24, tessellation: 32 }, scene),
    church,
    [-29.92, 30.4, -17.1],
    materials.bronze,
    [0, 0, Math.PI / 2],
  );
  addCylinder(scene, church, "st-joseph-tower-octagon", 10.2, 9.7, [-24.3, 40.45, -17.1], materials.paleStucco, { tessellation: 8, collides: true });
  addBox(scene, church, "st-joseph-belfry-west-opening", [0.12, 4.9, 2.35], [-29.20, 40.8, -17.1], materials.door);
  for (const side of [-1, 1]) {
    addBox(scene, church, `st-joseph-belfry-opening-${side}`, [2.0, 4.8, 0.12], [-24.3 + side * 2.45, 40.8, -21.35], materials.door);
  }
  addSphere(scene, church, "st-joseph-onion-dome", 2, [-24.3, 49.1, -17.1], [4.75, 5.7, 4.75], materials.copper);
  addCylinder(scene, church, "st-joseph-dome-neck", 2.2, 2.4, [-24.3, 55.0, -17.1], materials.copper, { diameterTop: 0.7, tessellation: 16 });
  addCylinder(scene, church, "st-joseph-spire", 6.0, 0.32, [-24.3, 59.0, -17.1], materials.bronze, { diameterTop: 0.04, tessellation: 12 });
  addCross(scene, church, "st-joseph-tower-cross", [-24.3, 63.0, -17.1], 1.0, materials.bronze);
}

function createNordbadOutdoorPools(
  scene: Scene,
  nordbad: TransformNode,
  materials: LandmarkMaterials,
): void {
  // OSM water outlines 97847500 and 97847499, transformed into the Nordbad
  // building's local frame. The larger 34 C pool includes its west current
  // channel; the pale 25 m deck diameter is measured from the supplied aerial.
  const largeCenter: readonly [number, number, number] = [-26.188, 0, -66.047];
  addCylinder(
    scene,
    nordbad,
    "nordbad-outdoor-warm-pool-deck",
    0.24,
    25.0,
    [largeCenter[0], 0.12, largeCenter[2]],
    materials.poolDeck,
    { tessellation: 64, collides: true },
  );
  const largeWater = addCylinder(
    scene,
    nordbad,
    "nordbad-outdoor-warm-pool-water",
    0.09,
    15.0,
    [largeCenter[0], 0.285, largeCenter[2]],
    materials.water,
    { tessellation: 64 },
  );
  largeWater.scaling.set(13.198 / 15.0, 1, 15.017 / 15.0);

  for (const [diameter, thickness] of [[9.8, 0.34], [5.8, 0.28]] as const) {
    const bench = prepare(
      MeshBuilder.CreateTorus(
        `nordbad-warm-pool-bench-${diameter}`,
        { diameter, thickness, tessellation: 64 },
        scene,
      ),
      nordbad,
      [largeCenter[0], 0.37, largeCenter[2]],
      materials.poolDeck,
    );
    bench.scaling.x = 13.198 / 15.017;
  }
  addCylinder(
    scene,
    nordbad,
    "nordbad-warm-pool-bubble-island",
    0.12,
    2.6,
    [largeCenter[0], 0.39, largeCenter[2]],
    materials.poolDeck,
    { tessellation: 48 },
  );
  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2;
    const radius = index % 2 === 0 ? 2.2 : 4.2;
    addCylinder(
      scene,
      nordbad,
      `nordbad-warm-pool-bubbler-${index}`,
      index % 2 === 0 ? 0.34 : 0.20,
      0.09,
      [
        largeCenter[0] + Math.cos(angle) * radius * 0.88,
        0.48,
        largeCenter[2] + Math.sin(angle) * radius,
      ],
      materials.water,
      { tessellation: 10 },
    );
  }

  const channelYaw = 1.47;
  addBox(
    scene,
    nordbad,
    "nordbad-outdoor-current-channel-deck",
    [11.4, 0.20, 5.20],
    [-26.828, 0.10, -54.583],
    materials.poolDeck,
    [0, channelYaw, 0],
    true,
  );
  addBox(
    scene,
    nordbad,
    "nordbad-outdoor-current-channel-water",
    [10.2, 0.08, 4.05],
    [-26.828, 0.24, -54.583],
    materials.water,
    [0, channelYaw, 0],
  );

  const smallYaw = 1.474;
  addBox(
    scene,
    nordbad,
    "nordbad-outdoor-small-pool-deck",
    [7.0, 0.20, 5.8],
    [2.791, 0.10, -55.824],
    materials.poolDeck,
    [0, smallYaw, 0],
    true,
  );
  addBox(
    scene,
    nordbad,
    "nordbad-outdoor-small-pool-water",
    [5.786, 0.08, 4.545],
    [2.791, 0.24, -55.824],
    materials.water,
    [0, smallYaw, 0],
  );
}

function createNordbad(scene: Scene, root: TransformNode, materials: LandmarkMaterials): void {
  // Anchor the front portico on the west facade; local -Z runs into the
  // building while local X follows Schleißheimer Straße.
  const nordbad = landmarkNode("landmark-nordbad", root, new Vector3(-611.0, 0, -1035.0), -1.65);

  addBox(scene, nordbad, "nordbad-front-wing", [73.0, 12.0, 20.0], [0, 6.0, -10.0], materials.ochreStucco, undefined, true);
  addBox(scene, nordbad, "nordbad-north-wing", [15.0, 11.0, 47.0], [-34.0, 5.5, -23.5], materials.ochreStucco, undefined, true);
  addBox(scene, nordbad, "nordbad-south-wing", [15.0, 11.0, 47.0], [34.0, 5.5, -23.5], materials.ochreStucco, undefined, true);
  addBox(scene, nordbad, "nordbad-swimming-hall", [47.0, 16.5, 40.0], [0, 8.25, -31.0], materials.paleStucco, undefined, true);
  addGabledRoof(scene, nordbad, "nordbad-front-roof", 74.0, 20.8, 12.0, 5.1, -10.0, materials.redRoof);
  addGabledRoof(scene, nordbad, "nordbad-hall-roof", 48.0, 40.8, 16.5, 7.2, -31.0, materials.redRoof);
  addFacadePlane(
    scene,
    nordbad,
    "nordbad-custom-street-facade",
    [72.65, 11.65],
    [0, 5.98, 0.04],
    getLandmarkFacadeMaterial(scene, "nordbad"),
    Math.PI,
  );

  addBox(scene, nordbad, "nordbad-portico-platform", [21.5, 0.55, 7.2], [0, 0.28, 3.1], materials.granite, undefined, true);
  for (let step = 0; step < 4; step += 1) {
    addBox(
      scene,
      nordbad,
      `nordbad-step-${step}`,
      [21.5 + step * 1.1, 0.18, 1.25],
      [0, 0.09 + step * 0.16, 6.15 - step * 1.12],
      materials.warmStone,
      undefined,
      true,
    );
  }
  for (const x of [-7.5, -2.5, 2.5, 7.5]) {
    addCylinder(scene, nordbad, `nordbad-portico-column-${x}`, 8.4, 0.90, [x, 4.65, 1.0], materials.warmStone, { tessellation: 20, collides: true });
  }
  addBox(scene, nordbad, "nordbad-portico-entablature", [20.5, 1.25, 2.1], [0, 9.05, 0.9], materials.warmStone);
  addBox(scene, nordbad, "nordbad-portico-pediment", [20.0, 2.4, 1.55], [0, 10.85, 0.7], materials.ochreStucco);
  addBox(scene, nordbad, "nordbad-entry", [8.4, 5.6, 0.20], [0, 3.2, 0.15], materials.door);
  addSign(scene, nordbad, "nordbad-sign", "NORDBAD", [11.8, 1.50], [0, 10.9, 1.50], Math.PI, "#3c2c20", "#d0b26f");

  // One of the Oculus memorial pieces in the forecourt gives the entrance its
  // characteristic sculptural focal point.
  const eye = landmarkNode("nordbad-oculus-memoriae", nordbad, new Vector3(-17.0, 0, 10.0));
  addBox(scene, eye, "nordbad-eye-plinth", [4.2, 0.42, 2.2], [0, 0.21, 0], materials.granite, undefined, true);
  const eyeRing = prepare(
    MeshBuilder.CreateTorus("nordbad-eye-ring", { diameter: 3.4, thickness: 0.44, tessellation: 36 }, scene),
    eye,
    [0, 2.25, 0],
    materials.warmStone,
    [Math.PI / 2, 0, 0],
  );
  eyeRing.scaling.x = 1.55;
  addSphere(scene, eye, "nordbad-eye-pupil", 0.84, [0, 2.25, -0.14], [1.0, 1.0, 0.34], materials.bronze);

  createNordbadOutdoorPools(scene, nordbad, materials);
}

function createMunichMma(scene: Scene, root: TransformNode, materials: LandmarkMaterials): void {
  // Runtime footprint 35589513 / Schleißheimer Straße 140. The earlier north
  // position was the separate 80516661 pavilion occupied by Nush O Jan.
  const mma = landmarkNode(
    "landmark-munich-mma-nordbad",
    root,
    new Vector3(-618.626, 0, -992.432),
    -0.18073,
  );
  const width = 19.691;
  const depth = 11.246;
  const height = 6.6;
  // With this footprint yaw, local -Z faces the Nordbad grounds while local
  // +Z faces Elisabethstrasse. Keep both names explicit: treating -Z as a
  // generic "front" previously left the public street elevation opaque.
  const nordbadZ = -depth * 0.5;
  // The small western footprint projection reaches the overall +Z bound; the
  // main street edge itself is 1 m farther inward and slightly east of center.
  const elisabethFacadeCenterX = 0.315;
  const elisabethZ = 4.625;
  const elisabethFacadeWidth = 19.06;
  const elisabethGlassWidth = 18.70;
  const elisabethGlassHeight = 5.55;

  addBox(scene, mma, "munich-mma-floor", [width, 0.32, depth], [0, 0.16, 0], materials.charcoal, undefined, true);
  addBox(scene, mma, "munich-mma-west-wall", [0.18, height, depth - 0.35], [-width * 0.5, height * 0.5, 0], materials.white, undefined, true);
  addBox(scene, mma, "munich-mma-east-wall", [0.18, height, depth - 0.35], [width * 0.5, height * 0.5, 0], materials.white, undefined, true);
  addBox(scene, mma, "munich-mma-side-glass-west", [0.12, height - 1.0, depth * 0.45], [-width * 0.5 - 0.02, height * 0.5, 0.5], materials.mmaGlass);
  addBox(scene, mma, "munich-mma-side-glass-east", [0.12, height - 1.0, depth * 0.45], [width * 0.5 + 0.02, height * 0.5, 0.5], materials.mmaGlass);

  // Elisabethstrasse elevation: the real pavilion is a nearly full-height
  // glazed curtain wall between pale end piers. The transparent volume keeps
  // the training mat and cage visible through the dark aluminium grid.
  addBox(
    scene,
    mma,
    "munich-mma-elisabeth-glass-wall",
    [elisabethGlassWidth, elisabethGlassHeight, 0.10],
    [elisabethFacadeCenterX, 2.98, elisabethZ - 0.02],
    materials.mmaGlass,
  );
  for (const side of [-1, 1]) {
    addBox(
      scene,
      mma,
      `munich-mma-elisabeth-end-pier-${side}`,
      [0.18, 5.85, 0.24],
      [elisabethFacadeCenterX + side * (elisabethFacadeWidth * 0.5 - 0.09), 2.925, elisabethZ],
      materials.white,
      undefined,
      true,
    );
  }
  for (let index = 0; index <= 7; index += 1) {
    const x = elisabethFacadeCenterX - elisabethGlassWidth * 0.5 + (index / 7) * elisabethGlassWidth;
    addBox(
      scene,
      mma,
      `munich-mma-elisabeth-mullion-${index}`,
      [0.12, elisabethGlassHeight, 0.16],
      [x, 2.98, elisabethZ + 0.06],
      materials.charcoal,
    );
  }
  for (const [name, y] of [["lower", 0.42], ["middle", 2.38], ["upper", 4.62], ["head", height - 0.22]] as const) {
    addBox(
      scene,
      mma,
      `munich-mma-elisabeth-transom-${name}`,
      [elisabethGlassWidth, 0.13, 0.16],
      [elisabethFacadeCenterX, y, elisabethZ + 0.06],
      materials.charcoal,
    );
  }
  addBox(scene, mma, "munich-mma-roof", [width + 0.45, 0.34, depth + 0.45], [0, height + 0.17, 0], materials.charcoal);
  addFacadePlane(
    scene,
    mma,
    "munich-mma-custom-front-facade",
    [width - 0.18, height - 0.18],
    [0, height * 0.5, nordbadZ + 0.02],
    getLandmarkFacadeMaterial(scene, "munich-mma"),
    0,
  );

  const sealMaterial = mmaSealMaterial(scene);
  const seal = addFacadePlane(
    scene,
    mma,
    "munich-mma-round-seal",
    [3.35, 3.35],
    [-6.35, 3.05, nordbadZ - 0.04],
    sealMaterial,
    0,
  );
  seal.onDisposeObservable.add(() => sealMaterial.dispose(true, true));
  const panelMaterial = mmaPanelMaterial(scene);
  const panel = addFacadePlane(
    scene,
    mma,
    "munich-mma-discipline-panel",
    [6.35, 3.0],
    [6.10, 3.05, nordbadZ - 0.04],
    panelMaterial,
    0,
  );
  panel.onDisposeObservable.add(() => panelMaterial.dispose(true, true));

  // A visible training mat and an octagonal cage make the transparent pavilion
  // identifiable even before the sign becomes readable.
  addCylinder(scene, mma, "munich-mma-red-mat", 0.10, 8.6, [0, 0.38, -0.2], materials.red, { tessellation: 8 });
  for (const y of [1.1, 3.3]) {
    prepare(
      MeshBuilder.CreateTorus(`munich-mma-cage-ring-${y}`, { diameter: 8.3, thickness: 0.10, tessellation: 8 }, scene),
      mma,
      [0, y, -0.2],
      materials.charcoal,
    );
  }
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2 + Math.PI / 8;
    addCylinder(scene, mma, `munich-mma-cage-post-${index}`, 2.3, 0.13, [Math.cos(angle) * 3.8, 2.2, -0.2 + Math.sin(angle) * 3.8], materials.charcoal, { tessellation: 10 });
  }
}

function addArchivePorthole(
  scene: Scene,
  parent: TransformNode,
  name: string,
  x: number,
  materials: LandmarkMaterials,
): void {
  addCylinder(scene, parent, `${name}-glass`, 0.10, 1.52, [x, 13.9, -0.06], materials.archiveGlass, {
    tessellation: 28,
    rotation: [Math.PI / 2, 0, 0],
  });
  prepare(
    MeshBuilder.CreateTorus(`${name}-ring`, { diameter: 1.72, thickness: 0.18, tessellation: 28 }, scene),
    parent,
    [x, 13.9, -0.13],
    materials.archiveBlue,
    [Math.PI / 2, 0, 0],
  );
}

function createCityArchiveExtension(scene: Scene, root: TransformNode, materials: LandmarkMaterials): void {
  // The modern extension is the attached "funky building". The adjacent 1906
  // archive building remains streamed; only OSM way 27276683 is replaced.
  const archive = landmarkNode("landmark-stadtarchiv-extension", root, new Vector3(-676.6, 0, -1053.6), -1.65);
  const width = 68.0;
  const depth = 20.0;

  addBox(scene, archive, "stadtarchiv-lower-shell", [width, 9.7, depth], [0, 4.85, depth * 0.5], materials.archiveBlue, undefined, true);
  addBox(scene, archive, "stadtarchiv-mansard-band", [width + 0.2, 5.8, depth - 1.2], [0, 12.6, depth * 0.5], materials.mauveRoof, undefined, true);
  addGabledRoof(scene, archive, "stadtarchiv-roof", width + 0.5, depth - 0.8, 15.5, 2.8, depth * 0.5, materials.mauveRoof);
  addFacadePlane(
    scene,
    archive,
    "stadtarchiv-custom-front-facade",
    [width - 0.35, 15.2],
    [0, 7.65, -0.03],
    getLandmarkFacadeMaterial(scene, "stadtarchiv"),
    0,
  );

  // Deep lower bays and vertical concrete fins reproduce the rhythm visible
  // from Schleißheimer Straße.
  for (let index = -6; index <= 6; index += 1) {
    const x = index * 4.7;
    addBox(scene, archive, `stadtarchiv-fin-${index}`, [0.55, 8.7, 1.05], [x, 4.55, -0.20], materials.archiveBlue);
    if (Math.abs(index) > 1) {
      addBox(scene, archive, `stadtarchiv-window-${index}`, [3.35, 4.05, 0.16], [x + 2.30, 3.55, -0.12], materials.archiveGlass);
      addBox(scene, archive, `stadtarchiv-upper-window-${index}`, [0.74, 2.35, 0.16], [x + 1.15, 8.0, -0.12], materials.archiveGlass);
    }
  }

  addBox(scene, archive, "stadtarchiv-portal-left", [5.2, 7.2, 0.24], [-3.1, 3.7, -0.18], materials.door);
  addBox(scene, archive, "stadtarchiv-portal-right", [5.2, 7.2, 0.24], [3.1, 3.7, -0.18], materials.door);
  addBox(scene, archive, "stadtarchiv-portal-pier", [0.80, 8.7, 1.10], [0, 4.45, -0.25], materials.archiveBlue);

  for (const x of [-27, -18, -9, 9, 18, 27]) addArchivePorthole(scene, archive, `stadtarchiv-porthole-${x}`, x, materials);
  addBox(scene, archive, "stadtarchiv-orb-backing", [2.75, 2.75, 0.18], [0, 13.8, -0.22], materials.white);
  addSphere(scene, archive, "stadtarchiv-golden-orb", 1.60, [0, 13.8, -0.52], [1, 1, 0.42], materials.gold);

  // Oculus historiae / memoriae / oblivionis: the segmented column seen in
  // the supplied reference, placed between the archive and the roadway.
  const column = landmarkNode("stadtarchiv-oculus-column", archive, new Vector3(-8.0, 0, -8.3));
  addCylinder(scene, column, "stadtarchiv-column-plinth", 0.42, 3.2, [0, 0.21, 0], materials.granite, { tessellation: 32, collides: true });
  addCylinder(scene, column, "stadtarchiv-column-lower", 3.2, 1.45, [0, 1.95, 0], materials.bronze, { diameterTop: 1.10, tessellation: 8, collides: true });
  addCylinder(scene, column, "stadtarchiv-column-middle", 3.0, 1.16, [0, 5.05, 0], materials.warmStone, { diameterTop: 0.88, tessellation: 8, collides: true });
  addCylinder(scene, column, "stadtarchiv-column-upper", 2.5, 0.92, [0, 7.78, 0], materials.limestone, { diameterTop: 1.18, tessellation: 8, collides: true });
  addBox(scene, column, "stadtarchiv-column-cap", [1.75, 0.42, 1.75], [0, 9.22, 0], materials.warmStone);
}

function createCafeFranca(scene: Scene, root: TransformNode, materials: LandmarkMaterials): void {
  // Café Franca occupies the ground floor of the real LoD2 shell at
  // Hiltenspergerstraße 24. The mapped frontage tangent fixes the small cafe
  // facade; local -Z follows OSM's outward vector into the garden court.
  const cafe = landmarkNode("landmark-cafe-franca", root, new Vector3(-401.486, 0, -845.934), 2.932);
  const facade = getLandmarkFacadeMaterial(scene, "cafe-franca");

  addFacadePlane(scene, cafe, "cafe-franca-custom-facade", [5.6, 3.74], [0, 1.87, -0.035], facade, 0);
  addSign(scene, cafe, "cafe-franca-sign", "CAFÉ FRANCA", [4.15, 0.48], [0.24, 3.43, -0.075], 0, "#5f342d", "#f3e4c7");
  addBox(scene, cafe, "cafe-franca-street-step", [5.72, 0.14, 0.62], [0, 0.07, -0.28], materials.granite);

  // The narrow garden gets its character from its close spacing rather than
  // big park furniture: small tables, floral pots and shaded places to linger.
  addBox(scene, cafe, "cafe-franca-garden-paving", [5.45, 0.12, 10.2], [0, 0.06, -5.36], materials.poolDeck);
  for (let row = 0; row < 9; row += 1) {
    addBox(scene, cafe, `cafe-franca-paver-joint-${row}`, [5.24, 0.016, 0.035], [0, 0.13, -0.92 - row * 1.04], materials.granite);
  }

  const plantAt = (name: string, x: number, z: number, scale = 1): void => {
    addBox(scene, cafe, `${name}-pot`, [0.78 * scale, 0.44 * scale, 0.78 * scale], [x, 0.29 * scale, z], materials.timberDark);
    addSphere(scene, cafe, `${name}-foliage`, 0.95 * scale, [x, 0.94 * scale, z], [0.78, 1.15, 0.78], materials.foliage);
    addSphere(scene, cafe, `${name}-light`, 0.60 * scale, [x + 0.18 * scale, 1.25 * scale, z - 0.12 * scale], [1, 0.82, 1], materials.foliageLight);
    addSphere(scene, cafe, `${name}-blossom`, 0.28 * scale, [x - 0.21 * scale, 1.46 * scale, z - 0.08 * scale], [1, 0.82, 1], materials.blossom);
  };

  for (const [index, z] of [-1.45, -3.15, -4.95, -6.75, -8.55].entries()) {
    plantAt(`cafe-franca-border-west-${index}`, -2.42, z, index % 2 === 0 ? 0.92 : 0.76);
    plantAt(`cafe-franca-border-east-${index}`, 2.42, z - 0.35, index % 2 === 0 ? 0.76 : 0.92);
  }

  const addTable = (index: number, x: number, z: number): void => {
    addCylinder(scene, cafe, `cafe-franca-table-pedestal-${index}`, 0.72, 0.12, [x, 0.48, z], materials.charcoal, { tessellation: 16 });
    addCylinder(scene, cafe, `cafe-franca-table-top-${index}`, 0.10, 1.02, [x, 0.89, z], materials.white, { tessellation: 28 });
    for (const [chair, angle] of [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5].entries()) {
      const chairX = x + Math.cos(angle) * 0.85;
      const chairZ = z + Math.sin(angle) * 0.85;
      addBox(scene, cafe, `cafe-franca-chair-seat-${index}-${chair}`, [0.45, 0.10, 0.45], [chairX, 0.45, chairZ], materials.white, [0, -angle, 0]);
      addBox(scene, cafe, `cafe-franca-chair-back-${index}-${chair}`, [0.44, 0.44, 0.07], [chairX - Math.cos(angle) * 0.16, 0.68, chairZ - Math.sin(angle) * 0.16], materials.white, [0, -angle, 0]);
    }
  };

  addTable(0, -1.15, -2.75);
  addTable(1, 1.18, -4.95);
  addTable(2, -1.05, -7.20);
  for (const [index, [x, z]] of [[-1.15, -2.75], [1.18, -4.95]].entries()) {
    addCylinder(scene, cafe, `cafe-franca-parasol-pole-${index}`, 3.55, 0.07, [x, 2.62, z], materials.charcoal, { tessellation: 12 });
    addCylinder(scene, cafe, `cafe-franca-parasol-canopy-${index}`, 0.14, 2.35, [x, 4.36, z], materials.cafeUmbrella, { diameterTop: 0.13, tessellation: 32 });
  }

  // A light, rose-covered arch gives the far end the intimate garden-room
  // silhouette seen in the supplied garden reference without blocking access.
  for (const x of [-2.15, 2.15]) {
    addBox(scene, cafe, `cafe-franca-arbor-post-${x}`, [0.10, 2.65, 0.10], [x, 1.325, -9.35], materials.charcoal);
    for (let level = 0; level < 4; level += 1) {
      addSphere(scene, cafe, `cafe-franca-climber-${x}-${level}`, 0.55, [x - Math.sign(x) * 0.16, 1.10 + level * 0.47, -9.32], [0.72, 1.05, 0.72], level % 2 === 0 ? materials.foliage : materials.foliageLight);
    }
  }
  addBox(scene, cafe, "cafe-franca-arbor-top", [4.42, 0.10, 0.10], [0, 2.65, -9.35], materials.charcoal);
  for (const x of [-1.5, -0.45, 0.55, 1.5]) {
    addSphere(scene, cafe, `cafe-franca-arbor-rose-${x}`, 0.30, [x, 2.63, -9.35], [1, 0.75, 1], materials.blossom);
  }
}

function createHohenzollernplatz(scene: Scene, root: TransformNode, materials: LandmarkMaterials): void {
  const center = lonLatToWorld(11.568_20, 48.161_60);
  const square = landmarkNode("landmark-hohenzollernplatz", root, center);

  // Alfred Aschauer's 1980 spring fountain is a low, broad centerpiece rather
  // than a tall statue. The surrounding circular planters define the square.
  addCylinder(scene, square, "hohenzollernplatz-fountain-bed", 0.34, 15.8, [0, 0.17, 0], materials.granite, { tessellation: 48, collides: true });
  addCylinder(scene, square, "hohenzollernplatz-fountain-water", 0.10, 14.7, [0, 0.38, 0], materials.water, { tessellation: 48 });
  prepare(
    MeshBuilder.CreateTorus("hohenzollernplatz-fountain-rim", { diameter: 15.9, thickness: 0.46, tessellation: 48 }, scene),
    square,
    [0, 0.44, 0],
    materials.granite,
  );
  addCylinder(scene, square, "hohenzollernplatz-fountain-core", 0.55, 3.8, [0, 0.66, 0], materials.granite, { tessellation: 32 });
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    const radius = index % 2 === 0 ? 2.3 : 5.2;
    const jetHeight = index % 2 === 0 ? 1.65 : 0.95;
    addCylinder(
      scene,
      square,
      `hohenzollernplatz-water-jet-${index}`,
      jetHeight,
      0.095,
      [Math.cos(angle) * radius, 0.44 + jetHeight * 0.5, Math.sin(angle) * radius],
      materials.water,
      { tessellation: 10 },
    );
  }

  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2 + Math.PI / 8;
    const radius = 13.2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    addCylinder(scene, square, `hohenzollernplatz-planter-${index}`, 0.62, 3.3, [x, 0.31, z], materials.granite, { tessellation: 32, collides: true });
    for (let plant = 0; plant < 5; plant += 1) {
      const plantAngle = (plant / 5) * Math.PI * 2;
      addSphere(
        scene,
        square,
        `hohenzollernplatz-planter-plant-${index}-${plant}`,
        1.20,
        [x + Math.cos(plantAngle) * 0.75, 0.95, z + Math.sin(plantAngle) * 0.75],
        [1.0, 0.82, 1.0],
        plant % 2 === 0 ? materials.foliage : materials.foliageLight,
      );
    }
  }

  const entrance = landmarkNode("hohenzollernplatz-ubahn-entrance", square, new Vector3(-13.5, 0, 9.0), -0.10);
  addBox(scene, entrance, "hohenzollernplatz-stair-opening", [8.5, 0.22, 4.4], [0, 0.12, 0], materials.door, undefined, true);
  for (const side of [-1, 1]) {
    addBox(scene, entrance, `hohenzollernplatz-stair-rail-${side}`, [0.12, 1.0, 4.7], [side * 4.30, 0.65, 0], materials.charcoal);
  }
  addBox(scene, entrance, "hohenzollernplatz-u-pole", [0.22, 3.35, 0.22], [-4.8, 1.68, -1.6], materials.charcoal, undefined, true);
  addBox(scene, entrance, "hohenzollernplatz-u-cube", [1.42, 1.42, 0.42], [-4.8, 3.45, -1.6], materials.charcoal);
  addSign(scene, entrance, "hohenzollernplatz-u-sign", "U", [1.15, 1.15], [-4.8, 3.45, -1.83], 0, "#ffffff", "#195995");
  addSign(scene, entrance, "hohenzollernplatz-name-sign", "HOHENZOLLERNPLATZ", [5.8, 0.66], [0, 1.25, -2.33], 0, "#ffffff", "#2c69a1");
}

export function createLandmarkDetails(scene: Scene): TransformNode {
  const existing = scene.getTransformNodeByName("landmark-details");
  if (existing) return existing;

  const root = new TransformNode("landmark-details", scene);
  const materials = createMaterials(scene);
  createElisabethmarkt(scene, root, materials);
  createBaerenbrunnen(scene, root, materials);
  createElisabethplatzBeerGarden(scene, root, materials);
  createStJoseph(scene, root, materials);
  createNordbad(scene, root, materials);
  createMunichMma(scene, root, materials);
  createCityArchiveExtension(scene, root, materials);
  createKreuzkirche(scene, root);
  createCafeFranca(scene, root, materials);
  createHohenzollernplatz(scene, root, materials);
  createTextureFirstLandmarks(scene, root);
  return root;
}
