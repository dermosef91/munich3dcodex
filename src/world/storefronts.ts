import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type {
  BuildingFeature,
  BusinessCategory,
  BusinessFeature,
  BusinessFrontage,
  Point2,
} from "./types";

interface StorefrontStyle {
  sign: string;
  signText: string;
  panel: Color3;
  awning: Color3;
}

interface SharedStorefrontMaterials {
  glass: PBRMaterial;
  frame: PBRMaterial;
  sill: PBRMaterial;
  panels: Map<BusinessCategory, PBRMaterial>;
  awnings: Map<BusinessCategory, PBRMaterial>;
}

const STYLES: Readonly<Record<BusinessCategory, StorefrontStyle>> = {
  restaurant: { sign: "#682d27", signText: "#f5e9d3", panel: new Color3(0.21, 0.10, 0.075), awning: new Color3(0.37, 0.12, 0.09) },
  cafe: { sign: "#315044", signText: "#f5ead4", panel: new Color3(0.12, 0.20, 0.17), awning: new Color3(0.18, 0.31, 0.25) },
  bar: { sign: "#263344", signText: "#ecd9a5", panel: new Color3(0.08, 0.11, 0.16), awning: new Color3(0.12, 0.18, 0.27) },
  bakery: { sign: "#8a5429", signText: "#fff0cf", panel: new Color3(0.27, 0.16, 0.075), awning: new Color3(0.52, 0.29, 0.12) },
  grocery: { sign: "#315934", signText: "#edf1d7", panel: new Color3(0.10, 0.21, 0.11), awning: new Color3(0.17, 0.34, 0.18) },
  pharmacy: { sign: "#26736f", signText: "#f4ffff", panel: new Color3(0.08, 0.26, 0.24), awning: new Color3(0.11, 0.39, 0.36) },
  retail: { sign: "#3a3d42", signText: "#f2eee6", panel: new Color3(0.12, 0.13, 0.15), awning: new Color3(0.20, 0.21, 0.23) },
  service: { sign: "#68443a", signText: "#f5eee8", panel: new Color3(0.22, 0.13, 0.11), awning: new Color3(0.35, 0.21, 0.17) },
};

const sharedByScene = new WeakMap<Scene, SharedStorefrontMaterials>();

// Address-specific storefront artwork is reserved for verified, deliberately
// art-directed businesses. All other map businesses retain the procedural path.
const CUSTOM_STOREFRONT_TEXTURES = new Map<string, string>([
  ["node/401302835", "/assets/textures/dompierre-boulangerie-storefront-v1.png"],
]);
// Shared original-art elevation for every OSM hairdresser/barber. It remains
// intentionally generic so map business names can still be rendered as data.
const BARBER_STOREFRONT_TEXTURE = "/assets/textures/barber-storefront-v1.png";
// The fascia is deliberately blank; the renderer layers each venue's OSM name
// over it so the shared Italian treatment never erases a restaurant identity.
const ITALIAN_RESTAURANT_STOREFRONT_TEXTURE = "/assets/textures/italian-restaurant-storefront-v1.png";
const INDEPENDENT_CLOTHING_STOREFRONT_TEXTURE = "/assets/textures/independent-clothing-storefront-v1.png";
const INDEPENDENT_CAFE_STOREFRONT_TEXTURE = "/assets/textures/independent-cafe-storefront-v1.png";
const INDEPENDENT_BEAUTY_STOREFRONT_TEXTURE = "/assets/textures/independent-beauty-storefront-v1.png";
const INDEPENDENT_BAKERY_STOREFRONT_TEXTURE = "/assets/textures/independent-bakery-storefront-v1.png";
const REWE_STOREFRONT_TEXTURE = "/assets/textures/rewe-long-storefront-v2.png";
const REWE_TARGET_WIDTH = 14;
const REWE_STOREFRONT_HEIGHT = 3.4;

const NAME_SIGN_STOREFRONT_TEXTURES = new Set([
  ITALIAN_RESTAURANT_STOREFRONT_TEXTURE,
  INDEPENDENT_CLOTHING_STOREFRONT_TEXTURE,
  INDEPENDENT_CAFE_STOREFRONT_TEXTURE,
  INDEPENDENT_BEAUTY_STOREFRONT_TEXTURE,
  INDEPENDENT_BAKERY_STOREFRONT_TEXTURE,
]);

// Café Franca is rendered by its landmark component, rather than this generic
// storefront builder. Dompierre stays on its exact custom texture above.
const LANDMARK_OWNED_STOREFRONT_IDS = new Set([
  "node/3324886666", // Café Franca
]);
const RECOGNIZABLE_CHAIN_NAME = /\b(?:starbucks|h\s*&\s*m|hennes\s*(?:&|und)\s*mauritz)\b/i;

interface StorefrontLayout {
  width: number;
  height: number;
  anchor: Point2;
  emissiveStrength: number;
}

function isItalianRestaurant(business: BusinessFeature): boolean {
  return business.category === "restaurant"
    && business.cuisine?.split(";").some((cuisine) => cuisine.trim().toLowerCase() === "italian") === true;
}

function independentStorefrontTexture(business: BusinessFeature): string | undefined {
  // A brand tag identifies a chain/recognizable business. Name matching keeps
  // the requested H&M and Starbucks exclusions intact for incomplete OSM tags.
  if (business.brand || RECOGNIZABLE_CHAIN_NAME.test(business.name)) return undefined;

  switch (business.subtype) {
    case "clothes": return INDEPENDENT_CLOTHING_STOREFRONT_TEXTURE;
    case "cafe": return INDEPENDENT_CAFE_STOREFRONT_TEXTURE;
    case "beauty": return INDEPENDENT_BEAUTY_STOREFRONT_TEXTURE;
    case "bakery": return INDEPENDENT_BAKERY_STOREFRONT_TEXTURE;
    default: return undefined;
  }
}

function customStorefrontTexture(business: BusinessFeature): string | undefined {
  const exactTexture = CUSTOM_STOREFRONT_TEXTURES.get(business.id);
  if (exactTexture) return exactTexture;

  // OSM records local barber shops as hairdressers. The name fallback also
  // covers any barber/friseur whose category data is incomplete.
  if (
    business.subtype === "hairdresser"
    || /(?:^|\W)(?:barber|friseur|friseure)(?:\W|$)/i.test(`${business.name} ${business.brand ?? ""}`)
  ) {
    return BARBER_STOREFRONT_TEXTURE;
  }

  if (isItalianRestaurant(business)) return ITALIAN_RESTAURANT_STOREFRONT_TEXTURE;

  const independentTexture = independentStorefrontTexture(business);
  if (independentTexture) return independentTexture;

  // Map data uses both "Rewe" and "Rewe City" display names. Matching the
  // brand as well retains the treatment if an individual shop name changes.
  return /\brewe\b/i.test(`${business.brand ?? ""} ${business.name}`)
    ? REWE_STOREFRONT_TEXTURE
    : undefined;
}

function pointToSegment(
  point: Point2,
  start: Point2,
  end: Point2,
): { distance: number; t: number; length: number } {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared > 1e-8
    ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared))
    : 0;
  return {
    distance: Math.hypot(point[0] - start[0] - dx * t, point[1] - start[1] - dz * t),
    t,
    length: Math.sqrt(lengthSquared),
  };
}

function reweStorefrontLayout(
  business: BusinessFeature,
  building: BuildingFeature | undefined,
): StorefrontLayout {
  const frontage = business.frontage!;
  const fallback: StorefrontLayout = {
    width: Math.max(frontage.width, 10),
    height: REWE_STOREFRONT_HEIGHT,
    anchor: frontage.anchor,
    emissiveStrength: 0.28,
  };
  if (!building?.outline?.length) return fallback;

  let edge: { start: Point2; end: Point2; distance: number; length: number } | undefined;
  const collinearCoordinates: number[] = [];
  for (let index = 0; index < building.outline.length; index += 1) {
    const start = building.outline[index];
    const end = building.outline[(index + 1) % building.outline.length];
    const dx = end[0] - start[0];
    const dz = end[1] - start[1];
    const length = Math.hypot(dx, dz);
    if (length < 1) continue;
    const alignment = Math.abs((dx / length) * frontage.tangent[0] + (dz / length) * frontage.tangent[1]);
    const startDepth = Math.abs(
      (start[0] - frontage.anchor[0]) * frontage.outward[0]
      + (start[1] - frontage.anchor[1]) * frontage.outward[1],
    );
    const endDepth = Math.abs(
      (end[0] - frontage.anchor[0]) * frontage.outward[0]
      + (end[1] - frontage.anchor[1]) * frontage.outward[1],
    );
    if (alignment < 0.985 || Math.max(startDepth, endDepth) > 0.65) continue;
    collinearCoordinates.push(
      (start[0] - frontage.anchor[0]) * frontage.tangent[0]
        + (start[1] - frontage.anchor[1]) * frontage.tangent[1],
      (end[0] - frontage.anchor[0]) * frontage.tangent[0]
        + (end[1] - frontage.anchor[1]) * frontage.tangent[1],
    );
  }

  if (collinearCoordinates.length >= 2) {
    const minimum = Math.min(...collinearCoordinates);
    const maximum = Math.max(...collinearCoordinates);
    if (maximum - minimum >= 2) {
      edge = {
        start: [
          frontage.anchor[0] + frontage.tangent[0] * minimum,
          frontage.anchor[1] + frontage.tangent[1] * minimum,
        ],
        end: [
          frontage.anchor[0] + frontage.tangent[0] * maximum,
          frontage.anchor[1] + frontage.tangent[1] * maximum,
        ],
        distance: 0,
        length: maximum - minimum,
      };
    }
  }

  if (!edge) {
    let nearestEdge: { start: Point2; end: Point2; distance: number; length: number } | undefined;
    for (let index = 0; index < building.outline.length; index += 1) {
      const start = building.outline[index];
      const end = building.outline[(index + 1) % building.outline.length];
      const projection = pointToSegment(frontage.anchor, start, end);
      if (projection.length < 2 || (nearestEdge && projection.distance >= nearestEdge.distance)) continue;
      nearestEdge = { start, end, distance: projection.distance, length: projection.length };
    }
    edge = nearestEdge;
  }
  if (!edge || edge.distance > 1) return fallback;

  const coordinateOnEdge = (point: Point2): number => (
    (point[0] - edge.start[0]) * frontage.tangent[0]
    + (point[1] - edge.start[1]) * frontage.tangent[1]
  );
  const anchorCoordinate = Math.max(0, Math.min(edge.length, coordinateOnEdge(frontage.anchor)));
  const margin = Math.min(0.35, edge.length * 0.06);
  const leftBoundary = margin;
  const rightBoundary = edge.length - margin;
  const availableWidth = Math.max(frontage.width, rightBoundary - leftBoundary);
  const width = Math.min(REWE_TARGET_WIDTH, availableWidth);
  const halfWidth = width * 0.5;
  const center = Math.max(leftBoundary + halfWidth, Math.min(rightBoundary - halfWidth, anchorCoordinate));

  return {
    width,
    height: REWE_STOREFRONT_HEIGHT,
    anchor: [
      edge.start[0] + frontage.tangent[0] * center,
      edge.start[1] + frontage.tangent[1] * center,
    ],
    emissiveStrength: 0.28,
  };
}

function pbr(scene: Scene, name: string, color: Color3, roughness: number, metallic = 0): PBRMaterial {
  const material = new PBRMaterial(name, scene);
  material.albedoColor = color;
  material.roughness = roughness;
  material.metallic = metallic;
  material.environmentIntensity = 0.65;
  material.directIntensity = 0.95;
  return material;
}

function sharedMaterials(scene: Scene): SharedStorefrontMaterials {
  const cached = sharedByScene.get(scene);
  if (cached) return cached;

  const glass = pbr(scene, "storefront-glass", new Color3(0.025, 0.055, 0.065), 0.16, 0.18);
  glass.specularIntensity = 0.9;
  const frame = pbr(scene, "storefront-metal-frame", new Color3(0.055, 0.06, 0.06), 0.28, 0.72);
  const sill = pbr(scene, "storefront-stone-sill", new Color3(0.27, 0.27, 0.25), 0.78);
  const panels = new Map<BusinessCategory, PBRMaterial>();
  const awnings = new Map<BusinessCategory, PBRMaterial>();
  for (const [category, style] of Object.entries(STYLES) as [BusinessCategory, StorefrontStyle][]) {
    panels.set(category, pbr(scene, `storefront-panel-${category}`, style.panel, 0.66, 0.03));
    awnings.set(category, pbr(scene, `storefront-awning-${category}`, style.awning, 0.82));
  }
  const materials = { glass, frame, sill, panels, awnings };
  sharedByScene.set(scene, materials);
  return materials;
}

function frontagePosition(frontage: BusinessFrontage, y: number, outwardOffset: number): Vector3 {
  return new Vector3(
    frontage.anchor[0] + frontage.outward[0] * outwardOffset,
    y,
    frontage.anchor[1] + frontage.outward[1] * outwardOffset,
  );
}

function frontageYaw(frontage: BusinessFrontage): number {
  // A Babylon FRONT plane starts with its normal along -Z. Derive the yaw
  // from the stored exterior normal so labels face the street regardless of
  // whether the source building ring runs clockwise or counter-clockwise.
  return Math.atan2(-frontage.outward[0], -frontage.outward[1]);
}

function prepare(mesh: Mesh, position: Vector3, yaw: number, material: PBRMaterial | StandardMaterial): Mesh {
  mesh.position.copyFrom(position);
  mesh.rotation.y = yaw;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.freezeWorldMatrix();
  return mesh;
}

function signTexture(scene: Scene, business: BusinessFeature): DynamicTexture {
  const texture = new DynamicTexture(`storefront-sign-texture-${business.id}`, { width: 1024, height: 256 }, scene, false);
  texture.hasAlpha = false;
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  const style = STYLES[business.category];
  context.fillStyle = style.sign;
  context.fillRect(0, 0, 1024, 256);
  context.strokeStyle = "rgba(255,255,255,0.18)";
  context.lineWidth = 8;
  context.strokeRect(10, 10, 1004, 236);

  const displayName = business.name.length > 34 ? `${business.name.slice(0, 32)}…` : business.name;
  const fontSize = Math.max(58, Math.min(116, Math.floor(870 / Math.max(displayName.length * 0.56, 1))));
  context.fillStyle = style.signText;
  context.font = `600 ${fontSize}px Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(displayName, 512, 122, 930);
  if (business.subtype && fontSize < 78) {
    context.globalAlpha = 0.78;
    context.font = "500 30px Arial, sans-serif";
    context.fillText(business.subtype.replaceAll("_", " ").toLocaleUpperCase("de-DE"), 512, 208, 900);
  }
  context.globalAlpha = 1;
  // When viewed from outside, the FRONT plane's local +X axis runs toward
  // screen-left. Reverse U so canvas text reads left-to-right, and invert Y
  // during upload so it remains upright.
  texture.uScale = -1;
  texture.uOffset = 1;
  texture.update(true);
  return texture;
}

function signMaterial(scene: Scene, business: BusinessFeature): StandardMaterial {
  const material = new StandardMaterial(`storefront-sign-material-${business.id}`, scene);
  material.diffuseTexture = signTexture(scene, business);
  material.specularColor = new Color3(0.08, 0.08, 0.07);
  material.emissiveColor = new Color3(0.12, 0.12, 0.11);
  material.backFaceCulling = true;
  return material;
}

function customStorefrontMaterial(
  scene: Scene,
  business: BusinessFeature,
  url: string,
  emissiveStrength = 0.08,
): StandardMaterial {
  const material = new StandardMaterial(`storefront-custom-material-${business.id}`, scene);
  const texture = new Texture(url, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  // The exterior plane runs in the inverse U direction of a canvas texture,
  // matching the orientation correction used by generated storefront signs.
  texture.uScale = -1;
  texture.uOffset = 1;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 8;
  material.diffuseTexture = texture;
  material.specularColor = new Color3(0.07, 0.07, 0.06);
  material.emissiveColor = new Color3(emissiveStrength, emissiveStrength, emissiveStrength * 0.96);
  if (emissiveStrength > 0.1) material.emissiveTexture = texture;
  return material;
}

function buildStorefront(
  scene: Scene,
  business: BusinessFeature,
  buildings: ReadonlyMap<number, BuildingFeature>,
  shared: SharedStorefrontMaterials,
): Mesh[] {
  const frontage = business.frontage;
  if (!frontage) return [];
  if (LANDMARK_OWNED_STOREFRONT_IDS.has(business.id)) return [];
  const width = frontage.width;
  const yaw = frontageYaw(frontage);
  const safeId = business.id.replaceAll("/", "-");
  const meshes: Mesh[] = [];
  const panelMaterial = shared.panels.get(business.category) ?? shared.panels.get("retail")!;
  const customTexture = customStorefrontTexture(business);

  if (customTexture) {
    const isRewe = customTexture === REWE_STOREFRONT_TEXTURE;
    const needsCustomNameSign = NAME_SIGN_STOREFRONT_TEXTURES.has(customTexture);
    const layout = isRewe
      ? reweStorefrontLayout(business, buildings.get(frontage.buildingId))
      : { width, height: 2.82, anchor: frontage.anchor, emissiveStrength: 0.08 };
    const material = customStorefrontMaterial(scene, business, customTexture, layout.emissiveStrength);
    const displayFrontage = { ...frontage, anchor: layout.anchor };
    const storefront = prepare(
      MeshBuilder.CreatePlane(
        `storefront-custom-${safeId}`,
        { width: layout.width, height: layout.height, sideOrientation: Mesh.FRONTSIDE },
        scene,
      ),
      frontagePosition(displayFrontage, layout.height * 0.5, 0.285),
      yaw,
      material,
    );
    storefront.onDisposeObservable.add(() => material.dispose(true, true));
    meshes.push(storefront);

    if (needsCustomNameSign) {
      const boardWidth = layout.width * 0.52;
      meshes.push(prepare(
        MeshBuilder.CreateBox(`storefront-custom-name-board-${safeId}`, { width: boardWidth, height: 0.5, depth: 0.07 }, scene),
        frontagePosition(displayFrontage, 2.5, 0.315),
        yaw,
        panelMaterial,
      ));
      const nameMaterial = signMaterial(scene, business);
      const nameSign = prepare(
        MeshBuilder.CreatePlane(
          `storefront-custom-name-${safeId}`,
          { width: boardWidth * 0.94, height: 0.42, sideOrientation: Mesh.FRONTSIDE },
          scene,
        ),
        frontagePosition(displayFrontage, 2.5, 0.356),
        yaw,
        nameMaterial,
      );
      nameSign.onDisposeObservable.add(() => nameMaterial.dispose(true, true));
      meshes.push(nameSign);
    }

    return meshes;
  }

  meshes.push(prepare(
    MeshBuilder.CreateBox(`storefront-panel-${safeId}`, { width, height: 2.82, depth: 0.12 }, scene),
    frontagePosition(frontage, 1.41, 0.08),
    yaw,
    panelMaterial,
  ));
  meshes.push(prepare(
    MeshBuilder.CreateBox(`storefront-glass-${safeId}`, { width: width - 0.34, height: 2.08, depth: 0.075 }, scene),
    frontagePosition(frontage, 1.18, 0.155),
    yaw,
    shared.glass,
  ));
  meshes.push(prepare(
    MeshBuilder.CreateBox(`storefront-sill-${safeId}`, { width: width - 0.24, height: 0.12, depth: 0.18 }, scene),
    frontagePosition(frontage, 0.12, 0.18),
    yaw,
    shared.sill,
  ));

  const mullions = Math.max(2, Math.min(5, Math.round(width / 1.25)));
  for (let index = 0; index <= mullions; index += 1) {
    const along = -width * 0.44 + (index / mullions) * width * 0.88;
    const position = frontagePosition(frontage, 1.18, 0.205).add(
      new Vector3(frontage.tangent[0] * along, 0, frontage.tangent[1] * along),
    );
    meshes.push(prepare(
      MeshBuilder.CreateBox(`storefront-mullion-${safeId}-${index}`, { width: 0.055, height: 2.16, depth: 0.055 }, scene),
      position,
      yaw,
      shared.frame,
    ));
  }

  const boardWidth = width * 0.92;
  meshes.push(prepare(
    MeshBuilder.CreateBox(`storefront-sign-board-${safeId}`, { width: boardWidth, height: 0.54, depth: 0.13 }, scene),
    frontagePosition(frontage, 2.53, 0.19),
    yaw,
    panelMaterial,
  ));
  const textMaterial = signMaterial(scene, business);
  const textMesh = prepare(
    MeshBuilder.CreatePlane(`storefront-sign-${safeId}`, { width: boardWidth * 0.96, height: 0.48, sideOrientation: Mesh.FRONTSIDE }, scene),
    frontagePosition(frontage, 2.53, 0.265),
    yaw,
    textMaterial,
  );
  textMesh.onDisposeObservable.add(() => textMaterial.dispose(true, true));
  meshes.push(textMesh);

  if (["restaurant", "cafe", "bar", "bakery", "grocery"].includes(business.category)) {
    const awningMaterial = shared.awnings.get(business.category) ?? shared.awnings.get("retail")!;
    meshes.push(prepare(
      MeshBuilder.CreateBox(`storefront-awning-${safeId}`, { width: width * 0.88, height: 0.10, depth: 0.72 }, scene),
      frontagePosition(frontage, 2.19, 0.48),
      yaw,
      awningMaterial,
    ));
  }

  return meshes;
}

export function buildStorefronts(
  businesses: BusinessFeature[] | undefined,
  buildings: BuildingFeature[],
  scene: Scene,
): Mesh[] {
  if (!businesses?.length) return [];
  const shared = sharedMaterials(scene);
  const buildingsById = new Map(buildings.map((building) => [building.id, building]));
  return businesses.flatMap((business) => buildStorefront(scene, business, buildingsById, shared));
}
