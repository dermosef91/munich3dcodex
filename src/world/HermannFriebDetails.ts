import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Material } from "@babylonjs/core/Materials/material";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { getLandmarkFacadeMaterial } from "./landmarkFacadeTextures";

type FacadePoint = readonly [x: number, z: number];
export type TerrainHeightProvider = (x: number, z: number) => number;

const FLAT_TERRAIN_HEIGHT: TerrainHeightProvider = () => 0;
const terrainOffsets = new WeakMap<TransformNode, number>();

interface FacadeFrame {
  readonly start: Vector3;
  readonly along: Vector3;
  readonly outward: Vector3;
  readonly center: Vector3;
  readonly length: number;
  readonly yaw: number;
}

interface SchoolMaterials {
  readonly southFacade: Material;
  readonly eastFacade: StandardMaterial;
  readonly gymFacade: StandardMaterial;
  readonly warmStone: StandardMaterial;
  readonly paleTrim: StandardMaterial;
  readonly darkWood: StandardMaterial;
  readonly louver: StandardMaterial;
  readonly roofTile: StandardMaterial;
  readonly copper: StandardMaterial;
}

/**
 * Runtime LoD2 pieces that together form the Hermann-Frieb-Realschule.
 *
 * They intentionally remain outside LANDMARK_REPLACEMENT_BUILDING_IDS: the
 * Bavarian shells preserve the real gables, roof planes and collision volume.
 * This module only adds shallow, non-colliding architectural detail.
 */
export const HERMANN_FRIEB_BUILDING_IDS = [
  35_768_220,
  35_768_221,
  -663_034_797,
  -1_439_844_777,
  -1_502_387_334,
] as const;

const SOUTH_FACADE_START: FacadePoint = [-457.747, -1122.920];
const SOUTH_FACADE_END: FacadePoint = [-412.049, -1129.270];
const EAST_FACADE_START: FacadePoint = [-406.548, -1141.424];
const EAST_FACADE_END: FacadePoint = [-411.971, -1182.884];
const GYM_COURTYARD_START: FacadePoint = [-458.544, -1176.222];
const GYM_COURTYARD_END: FacadePoint = [-431.513, -1173.531];
const ENTRANCE_START: FacadePoint = [-417.536, -1128.562];
const ENTRANCE_END: FacadePoint = [-412.049, -1129.270];
const TERRAIN_ANCHOR: FacadePoint = [
  (ENTRANCE_START[0] + ENTRANCE_END[0]) * 0.5,
  (ENTRANCE_START[1] + ENTRANCE_END[1]) * 0.5,
];

function sampledTerrainHeight(
  heightAt: TerrainHeightProvider,
  x: number,
  z: number,
): number {
  const height = heightAt(x, z);
  return Number.isFinite(height) ? height : 0;
}

export function groundHermannFriebDetails(
  scene: Scene,
  heightAt: TerrainHeightProvider = FLAT_TERRAIN_HEIGHT,
): void {
  const root = scene.getTransformNodeByName("hermann-frieb-details");
  if (!root) return;
  let offset = terrainOffsets.get(root);
  if (offset === undefined) {
    offset = root.position.y;
    terrainOffsets.set(root, offset);
  }
  root.position.y = offset + sampledTerrainHeight(heightAt, TERRAIN_ANCHOR[0], TERRAIN_ANCHOR[1]);
}

function facadeFrame(startPoint: FacadePoint, endPoint: FacadePoint): FacadeFrame {
  const start = new Vector3(startPoint[0], 0, startPoint[1]);
  const end = new Vector3(endPoint[0], 0, endPoint[1]);
  const along = end.subtract(start).normalize();
  const outward = new Vector3(-along.z, 0, along.x);
  return {
    start,
    along,
    outward,
    center: start.add(end).scale(0.5),
    length: Vector3.Distance(start, end),
    yaw: -Math.atan2(along.z, along.x),
  };
}

function colorMaterial(
  scene: Scene,
  name: string,
  diffuse: Color3,
  specular = Color3.Black(),
): StandardMaterial {
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = diffuse;
  result.ambientColor = diffuse.scale(0.25);
  result.specularColor = specular;
  result.specularPower = 32;
  return result;
}

function dynamicMaterial(
  scene: Scene,
  name: string,
  size: { width: number; height: number },
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void,
): StandardMaterial {
  const texture = new DynamicTexture(`${name}-texture`, size, scene, false);
  texture.hasAlpha = false;
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  draw(context, size.width, size.height);
  texture.anisotropicFilteringLevel = 8;
  texture.update(true);

  const result = new StandardMaterial(name, scene);
  result.diffuseColor = Color3.White();
  result.ambientColor = new Color3(0.25, 0.24, 0.21);
  result.specularColor = new Color3(0.025, 0.022, 0.018);
  result.specularPower = 20;
  result.diffuseTexture = texture;
  result.backFaceCulling = true;
  return result;
}

function drawWindow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  blind: boolean,
): void {
  const trim = Math.max(5, width * 0.13);
  context.fillStyle = "#eee9d9";
  context.fillRect(x - trim, y - trim, width + trim * 2, height + trim * 2);
  context.fillStyle = "#3b2a23";
  context.fillRect(x, y, width, height);
  context.fillStyle = "#263238";
  context.fillRect(x + trim * 0.42, y + trim * 0.42, width - trim * 0.84, height - trim * 0.84);

  context.strokeStyle = "#574037";
  context.lineWidth = Math.max(3, width * 0.045);
  context.beginPath();
  context.moveTo(x + width * 0.5, y + 2);
  context.lineTo(x + width * 0.5, y + height - 2);
  context.moveTo(x + 2, y + height * 0.34);
  context.lineTo(x + width - 2, y + height * 0.34);
  context.moveTo(x + 2, y + height * 0.67);
  context.lineTo(x + width - 2, y + height * 0.67);
  context.stroke();

  context.fillStyle = "rgba(196, 217, 220, 0.16)";
  context.fillRect(x + width * 0.08, y + height * 0.08, width * 0.08, height * 0.79);

  if (blind) {
    context.fillStyle = "rgba(53, 85, 58, 0.93)";
    context.fillRect(x + trim * 0.25, y + trim * 0.25, width - trim * 0.5, height * 0.44);
    context.strokeStyle = "rgba(189, 199, 173, 0.28)";
    context.lineWidth = 1;
    for (let blindY = y + trim; blindY < y + height * 0.43; blindY += 6) {
      context.beginPath();
      context.moveTo(x + trim * 0.4, blindY);
      context.lineTo(x + width - trim * 0.4, blindY);
      context.stroke();
    }
  }
}

function schoolFacadeMaterial(
  scene: Scene,
  name: string,
  bayCount: number,
  variant: "south" | "east",
): StandardMaterial {
  return dynamicMaterial(scene, name, { width: 2048, height: 1024 }, (context, width, height) => {
    context.fillStyle = "#ded9c7";
    context.fillRect(0, 0, width, height);

    const baseTop = height * 0.735;
    context.fillStyle = "#b7b0a0";
    context.fillRect(0, baseTop, width, height - baseTop);
    context.strokeStyle = "rgba(93, 86, 75, 0.30)";
    context.lineWidth = 2;
    for (let y = baseTop + 22; y < height; y += 38) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    context.fillStyle = "rgba(245, 241, 225, 0.82)";
    for (const y of [height * 0.265, height * 0.485, baseTop - 3]) {
      context.fillRect(0, y, width, 5);
    }

    const bayWidth = width / bayCount;
    const floorTops = [0.075, 0.295, 0.515, 0.765];
    const pilasterBays = variant === "south" ? [0, 4, 9, bayCount - 1] : [0, bayCount - 1];
    for (const bay of pilasterBays) {
      context.fillStyle = "rgba(239, 234, 216, 0.86)";
      context.fillRect(Math.max(0, bay * bayWidth - 5), 0, 11, baseTop);
    }

    for (let floor = 0; floor < floorTops.length; floor += 1) {
      const windowHeight = height * (floor === floorTops.length - 1 ? 0.18 : 0.145);
      for (let bay = 0; bay < bayCount; bay += 1) {
        const entranceBay = variant === "south" && floor === floorTops.length - 1 && bay >= bayCount - 2;
        if (entranceBay) continue;
        const windowWidth = bayWidth * (variant === "east" ? 0.54 : 0.50);
        const x = bay * bayWidth + (bayWidth - windowWidth) * 0.5;
        const y = height * floorTops[floor];
        const blind = (bay * 5 + floor * 3 + (variant === "east" ? 2 : 0)) % 13 < 3;
        drawWindow(context, x, y, windowWidth, windowHeight, blind);

        if (floor < 3 && (bay + floor) % 3 === 1) {
          context.strokeStyle = "rgba(151, 141, 121, 0.78)";
          context.lineWidth = 4;
          context.beginPath();
          context.arc(x + windowWidth * 0.5, y - 2, windowWidth * 0.56, Math.PI, 0);
          context.stroke();
        }
      }
    }

    if (variant === "south") {
      for (const bay of [2, 6, 10]) {
        const centerX = (bay + 0.5) * bayWidth;
        const centerY = height * 0.505;
        context.fillStyle = "#c5beac";
        context.beginPath();
        context.arc(centerX, centerY, bayWidth * 0.22, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "rgba(134, 124, 106, 0.72)";
        context.lineWidth = 3;
        context.beginPath();
        context.arc(centerX, centerY, bayWidth * 0.15, 0.25, Math.PI * 1.75);
        context.stroke();
      }
    }

    context.fillStyle = "rgba(78, 68, 55, 0.08)";
    for (let x = 19; x < width; x += 73) {
      context.fillRect(x, 0, 1, height);
    }
  });
}

function gymFacadeMaterial(scene: Scene): StandardMaterial {
  return dynamicMaterial(scene, "hermann-frieb-gym-facade-material", { width: 1536, height: 768 }, (context, width, height) => {
    context.fillStyle = "#d6d2c3";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#b5ad9c";
    context.fillRect(0, height * 0.78, width, height * 0.22);
    context.strokeStyle = "rgba(93, 86, 75, 0.28)";
    context.lineWidth = 2;
    for (let y = height * 0.80; y < height; y += 30) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    const bayWidth = width / 6;
    for (let bay = 0; bay < 6; bay += 1) {
      const centerX = bayWidth * (bay + 0.5);
      const windowWidth = bayWidth * 0.54;
      const left = centerX - windowWidth * 0.5;
      const top = height * 0.20;
      const bottom = height * 0.76;
      const radius = windowWidth * 0.5;
      context.fillStyle = "#ece7d7";
      context.beginPath();
      context.moveTo(left - 10, bottom + 9);
      context.lineTo(left - 10, top + radius);
      context.arc(centerX, top + radius, radius + 10, Math.PI, 0);
      context.lineTo(left + windowWidth + 10, bottom + 9);
      context.closePath();
      context.fill();
      context.fillStyle = "#293436";
      context.beginPath();
      context.moveTo(left, bottom);
      context.lineTo(left, top + radius);
      context.arc(centerX, top + radius, radius, Math.PI, 0);
      context.lineTo(left + windowWidth, bottom);
      context.closePath();
      context.fill();
      context.strokeStyle = "#49372f";
      context.lineWidth = 6;
      context.beginPath();
      context.moveTo(centerX, top + 4);
      context.lineTo(centerX, bottom);
      context.moveTo(left + 4, height * 0.54);
      context.lineTo(left + windowWidth - 4, height * 0.54);
      context.stroke();
    }
  });
}

function createMaterials(scene: Scene): SchoolMaterials {
  return {
    southFacade: getLandmarkFacadeMaterial(scene, "hermann-frieb-realschule"),
    eastFacade: schoolFacadeMaterial(scene, "hermann-frieb-east-facade-material", 12, "east"),
    gymFacade: gymFacadeMaterial(scene),
    warmStone: colorMaterial(scene, "hermann-frieb-warm-stone", new Color3(0.70, 0.67, 0.60)),
    paleTrim: colorMaterial(scene, "hermann-frieb-pale-trim", new Color3(0.90, 0.88, 0.81)),
    darkWood: colorMaterial(scene, "hermann-frieb-dark-wood", new Color3(0.18, 0.11, 0.085), new Color3(0.08, 0.06, 0.04)),
    louver: colorMaterial(scene, "hermann-frieb-louver", new Color3(0.17, 0.16, 0.145)),
    roofTile: colorMaterial(scene, "hermann-frieb-roof-tile", new Color3(0.48, 0.16, 0.085)),
    copper: colorMaterial(scene, "hermann-frieb-copper", new Color3(0.37, 0.53, 0.43), new Color3(0.12, 0.18, 0.14)),
  };
}

function prepareMesh(
  mesh: Mesh,
  parent: TransformNode,
  position: Vector3,
  yaw: number,
  material: Material,
): Mesh {
  mesh.parent = parent;
  mesh.position.copyFrom(position);
  mesh.rotation.y = yaw;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  return mesh;
}

function pointOnFrame(
  frame: FacadeFrame,
  alongOffset: number,
  elevation: number,
  outwardOffset: number,
): Vector3 {
  return frame.start
    .add(frame.along.scale(alongOffset))
    .add(frame.outward.scale(outwardOffset))
    .add(new Vector3(0, elevation, 0));
}

function addFacadePlane(
  scene: Scene,
  parent: TransformNode,
  name: string,
  frame: FacadeFrame,
  height: number,
  outwardOffset: number,
  facadeMaterial: Material,
): Mesh {
  const position = frame.center
    .add(frame.outward.scale(outwardOffset))
    .add(new Vector3(0, height * 0.5, 0));
  return prepareMesh(
    MeshBuilder.CreatePlane(name, { width: frame.length, height, sideOrientation: Mesh.FRONTSIDE }, scene),
    parent,
    position,
    // Babylon planes face local -Z; turn the textured front toward the street.
    frame.yaw + Math.PI,
    facadeMaterial,
  );
}

function doorMaterial(scene: Scene): StandardMaterial {
  return dynamicMaterial(scene, "hermann-frieb-door-material", { width: 512, height: 768 }, (context, width, height) => {
    context.fillStyle = "#36231f";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#1f2a2c";
    context.fillRect(24, 20, width - 48, height * 0.19);
    context.strokeStyle = "#594039";
    context.lineWidth = 12;
    context.strokeRect(24, 20, width - 48, height * 0.19);
    context.beginPath();
    context.moveTo(width * 0.5, 20);
    context.lineTo(width * 0.5, height);
    context.stroke();

    context.lineWidth = 9;
    for (let leaf = 0; leaf < 2; leaf += 1) {
      const leafLeft = leaf * width * 0.5;
      for (let row = 0; row < 4; row += 1) {
        const top = height * 0.25 + row * height * 0.15;
        for (let column = 0; column < 2; column += 1) {
          context.strokeRect(leafLeft + 28 + column * width * 0.105, top, width * 0.085, height * 0.105);
        }
      }
    }
    context.fillStyle = "#b79e5b";
    context.fillRect(width * 0.49, height * 0.58, width * 0.025, height * 0.075);
    context.fillStyle = "#bba45f";
    context.fillRect(0, height * 0.92, width, height * 0.08);
  });
}

function plaqueMaterial(scene: Scene): StandardMaterial {
  return dynamicMaterial(scene, "hermann-frieb-plaque-material", { width: 768, height: 420 }, (context, width, height) => {
    context.fillStyle = "#c9bd83";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#776b3f";
    context.lineWidth = 10;
    context.strokeRect(8, 8, width - 16, height - 16);

    context.fillStyle = "#25231d";
    context.beginPath();
    context.moveTo(72, 72);
    context.lineTo(147, 72);
    context.lineTo(139, 178);
    context.lineTo(109, 205);
    context.lineTo(79, 178);
    context.closePath();
    context.fill();

    context.textAlign = "left";
    context.textBaseline = "middle";
    context.font = "42px Arial, sans-serif";
    context.fillText("Landeshauptstadt München", 182, 96);
    context.font = "38px Arial, sans-serif";
    context.fillText("Städtische", 182, 205);
    context.font = "bold 45px Arial, sans-serif";
    context.fillText("Hermann-Frieb-Realschule", 72, 316);
  });
}

function reliefMaterial(scene: Scene): StandardMaterial {
  return dynamicMaterial(scene, "hermann-frieb-relief-material", { width: 1024, height: 384 }, (context, width, height) => {
    context.fillStyle = "#968a7d";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#776d63";
    context.lineWidth = 12;
    context.strokeRect(8, 8, width - 16, height - 16);

    const drawFigure = (x: number, mirrored: boolean): void => {
      context.save();
      context.translate(x, 0);
      context.scale(mirrored ? -1 : 1, 1);
      context.fillStyle = "#82766b";
      context.beginPath();
      context.arc(92, 93, 34, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.ellipse(105, 192, 44, 77, -0.25, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.arc(182, 175, 27, 0, Math.PI * 2);
      context.fill();
      context.restore();
    };
    drawFigure(0, false);
    drawFigure(width, true);

    context.fillStyle = "#6f665d";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "bold 38px Georgia, serif";
    context.fillText("ERBAUT VON DER", width * 0.5, 82);
    context.fillText("STADTGEMEINDE MÜNCHEN", width * 0.5, 145);
    context.font = "34px Georgia, serif";
    context.fillText("IM JAHRE 1905/06", width * 0.5, 216);
  });
}

function addEntrance(
  scene: Scene,
  parent: TransformNode,
  materials: SchoolMaterials,
): void {
  const frame = facadeFrame(ENTRANCE_START, ENTRANCE_END);
  const doorCenter = frame.length * 0.54;

  prepareMesh(
    MeshBuilder.CreateBox("hermann-frieb-door-surround", { width: 2.95, height: 4.05, depth: 0.14 }, scene),
    parent,
    pointOnFrame(frame, doorCenter, 2.10, 0.105),
    frame.yaw,
    materials.warmStone,
  );
  prepareMesh(
    MeshBuilder.CreatePlane("hermann-frieb-main-door", { width: 2.55, height: 3.62, sideOrientation: Mesh.FRONTSIDE }, scene),
    parent,
    pointOnFrame(frame, doorCenter, 2.12, 0.19),
    frame.yaw + Math.PI,
    doorMaterial(scene),
  );
  prepareMesh(
    MeshBuilder.CreatePlane("hermann-frieb-school-plaque", { width: 1.42, height: 0.78, sideOrientation: Mesh.FRONTSIDE }, scene),
    parent,
    pointOnFrame(frame, 0.84, 2.65, 0.195),
    frame.yaw + Math.PI,
    plaqueMaterial(scene),
  );
  prepareMesh(
    MeshBuilder.CreatePlane("hermann-frieb-entrance-relief", { width: 3.45, height: 1.28, sideOrientation: Mesh.FRONTSIDE }, scene),
    parent,
    pointOnFrame(frame, doorCenter, 4.82, 0.20),
    frame.yaw + Math.PI,
    reliefMaterial(scene),
  );

  for (let index = 0; index < 2; index += 1) {
    prepareMesh(
      MeshBuilder.CreateBox(`hermann-frieb-door-step-${index}`, {
        width: 3.05 + index * 0.28,
        height: 0.14,
        depth: 0.34,
      }, scene),
      parent,
      pointOnFrame(frame, doorCenter, 0.07 + index * 0.11, 0.33 + index * 0.24),
      frame.yaw,
      materials.warmStone,
    );
  }
}

function addVentStack(
  scene: Scene,
  parent: TransformNode,
  name: string,
  position: FacadePoint,
  baseY: number,
  yaw: number,
  materials: SchoolMaterials,
): void {
  const center = new Vector3(position[0], 0, position[1]);
  prepareMesh(
    MeshBuilder.CreateBox(`${name}-shaft`, { width: 1.30, height: 1.42, depth: 1.30 }, scene),
    parent,
    center.add(new Vector3(0, baseY + 0.71, 0)),
    yaw,
    materials.paleTrim,
  );
  prepareMesh(
    MeshBuilder.CreateBox(`${name}-louvers`, { width: 1.52, height: 0.72, depth: 1.52 }, scene),
    parent,
    center.add(new Vector3(0, baseY + 1.66, 0)),
    yaw,
    materials.louver,
  );
  prepareMesh(
    MeshBuilder.CreateCylinder(`${name}-cap`, {
      height: 0.72,
      diameterBottom: 1.88,
      diameterTop: 0.22,
      tessellation: 4,
    }, scene),
    parent,
    center.add(new Vector3(0, baseY + 2.38, 0)),
    yaw + Math.PI * 0.25,
    materials.roofTile,
  );
  prepareMesh(
    MeshBuilder.CreateSphere(`${name}-finial`, { diameter: 0.18, segments: 8 }, scene),
    parent,
    center.add(new Vector3(0, baseY + 2.82, 0)),
    0,
    materials.copper,
  );
}

function addRoofDetails(
  scene: Scene,
  parent: TransformNode,
  materials: SchoolMaterials,
): void {
  const southFrame = facadeFrame(SOUTH_FACADE_START, SOUTH_FACADE_END);
  const gableFinials = [
    { offset: 2.7, elevation: 25.12 },
    { offset: 16.0, elevation: 25.78 },
    { offset: 40.0, elevation: 28.66 },
  ] as const;
  for (let index = 0; index < gableFinials.length; index += 1) {
    const finial = gableFinials[index];
    prepareMesh(
      MeshBuilder.CreateSphere(`hermann-frieb-gable-finial-${index}`, { diameter: 0.48, segments: 12 }, scene),
      parent,
      pointOnFrame(southFrame, finial.offset, finial.elevation, 0.02),
      0,
      materials.paleTrim,
    );
  }

  addVentStack(scene, parent, "hermann-frieb-vent-south-west", [-443.8, -1134.6], 22.45, southFrame.yaw, materials);
  addVentStack(scene, parent, "hermann-frieb-vent-south-east", [-427.8, -1136.7], 22.85, southFrame.yaw, materials);
  addVentStack(scene, parent, "hermann-frieb-vent-east-south", [-418.3, -1151.8], 23.65, southFrame.yaw + Math.PI * 0.5, materials);
  addVentStack(scene, parent, "hermann-frieb-vent-east-north", [-420.8, -1171.6], 23.35, southFrame.yaw + Math.PI * 0.5, materials);
}

function addFacadeDetails(
  scene: Scene,
  parent: TransformNode,
  materials: SchoolMaterials,
): void {
  const southFrame = facadeFrame(SOUTH_FACADE_START, SOUTH_FACADE_END);
  const eastFrame = facadeFrame(EAST_FACADE_START, EAST_FACADE_END);
  const gymFrame = facadeFrame(GYM_COURTYARD_START, GYM_COURTYARD_END);

  addFacadePlane(scene, parent, "hermann-frieb-south-facade", southFrame, 18.35, 0.075, materials.southFacade);
  addFacadePlane(scene, parent, "hermann-frieb-east-facade", eastFrame, 18.45, 0.075, materials.eastFacade);
  addFacadePlane(scene, parent, "hermann-frieb-gym-courtyard-facade", gymFrame, 10.95, 0.07, materials.gymFacade);

  prepareMesh(
    MeshBuilder.CreateBox("hermann-frieb-south-cornice", { width: southFrame.length + 0.18, height: 0.28, depth: 0.26 }, scene),
    parent,
    southFrame.center.add(southFrame.outward.scale(0.12)).add(new Vector3(0, 18.22, 0)),
    southFrame.yaw,
    materials.paleTrim,
  );
  prepareMesh(
    MeshBuilder.CreateBox("hermann-frieb-east-cornice", { width: eastFrame.length + 0.12, height: 0.27, depth: 0.25 }, scene),
    parent,
    eastFrame.center.add(eastFrame.outward.scale(0.12)).add(new Vector3(0, 18.34, 0)),
    eastFrame.yaw,
    materials.paleTrim,
  );
}

export function createHermannFriebDetails(scene: Scene, parent: TransformNode): TransformNode {
  const existing = scene.getTransformNodeByName("hermann-frieb-details");
  if (existing) return existing;

  const root = new TransformNode("hermann-frieb-details", scene);
  root.parent = parent;
  const materials = createMaterials(scene);
  addFacadeDetails(scene, root, materials);
  addEntrance(scene, root, materials);
  addRoofDetails(scene, root, materials);
  return root;
}
