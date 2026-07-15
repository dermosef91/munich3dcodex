import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Material } from "@babylonjs/core/Materials/material";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { getLandmarkFacadeMaterial } from "../landmarkFacadeTextures";

type FacadePoint = readonly [x: number, z: number];

interface FacadeFrame {
  readonly center: Vector3;
  readonly length: number;
  readonly outward: Vector3;
  readonly yaw: number;
}

/**
 * These IDs stay out of landmarkRegistry.ts. Their Bavarian LoD2 walls, roofs,
 * and collision volumes remain authoritative; this layer only adds facade art.
 */
export const MUSEUM_BRANDHORST_BUILDING_ID = 28_026_817;
export const ALTE_PINAKOTHEK_BUILDING_ID = 4_647_135;
export const BAYERISCHE_STAATSBIBLIOTHEK_BUILDING_ID = -52_412_001;
export const HOFBRAEUHAUS_BUILDING_ID = 1_273_939_826;
export const ASAMKIRCHE_BUILDING_ID = 47_515_468;

function facadeFrame(
  startPoint: FacadePoint,
  endPoint: FacadePoint,
  interiorPoint: FacadePoint,
): FacadeFrame {
  let start = new Vector3(startPoint[0], 0, startPoint[1]);
  let end = new Vector3(endPoint[0], 0, endPoint[1]);
  const interior = new Vector3(interiorPoint[0], 0, interiorPoint[1]);

  let along = end.subtract(start).normalize();
  let outward = new Vector3(-along.z, 0, along.x);
  const center = start.add(end).scale(0.5);
  if (Vector3.Dot(outward, center.subtract(interior)) < 0) {
    [start, end] = [end, start];
    along = end.subtract(start).normalize();
    outward = new Vector3(-along.z, 0, along.x);
  }

  return {
    center,
    length: Vector3.Distance(start, end),
    outward,
    yaw: -Math.atan2(along.z, along.x),
  };
}

function dynamicMaterial(
  scene: Scene,
  name: string,
  size: { readonly width: number; readonly height: number },
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void,
  specular = new Color3(0.055, 0.055, 0.05),
): StandardMaterial {
  const texture = new DynamicTexture(`${name}-texture`, size, scene, false);
  texture.hasAlpha = false;
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  draw(context, size.width, size.height);
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 8;
  texture.update(true);

  const material = new StandardMaterial(name, scene);
  material.diffuseColor = Color3.White();
  material.ambientColor = new Color3(0.22, 0.21, 0.19);
  material.specularColor = specular;
  material.specularPower = 32;
  material.diffuseTexture = texture;
  material.backFaceCulling = true;
  return material;
}

function addFacadePlane(
  scene: Scene,
  parent: TransformNode,
  name: string,
  start: FacadePoint,
  end: FacadePoint,
  interior: FacadePoint,
  height: number,
  material: Material,
): Mesh {
  const frame = facadeFrame(start, end, interior);
  const mesh = MeshBuilder.CreatePlane(name, {
    width: frame.length,
    height,
    sideOrientation: Mesh.FRONTSIDE,
  }, scene);
  mesh.parent = parent;
  mesh.position.copyFrom(
    frame.center
      .add(frame.outward.scale(0.075))
      .add(new Vector3(0, height * 0.5, 0)),
  );
  // Babylon planes face local -Z; turn the painted side toward the street.
  mesh.rotation.y = frame.yaw + Math.PI;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  return mesh;
}

const BRANDHORST_COLORS = [
  "#f7db95", "#e6a968", "#dd705e", "#c8566c", "#8f506f", "#625778",
  "#425f83", "#3e718c", "#4e8f99", "#6ca29d", "#8ab29c", "#b1bf8e",
  "#d7c67f", "#f0b568", "#ef8f62", "#d8676f", "#a95a80", "#765e8d",
  "#55769d", "#5a91a9", "#76a8ad", "#a0bbb0", "#c8c49b",
] as const;

function brandhorstMaterial(
  scene: Scene,
  name: string,
  options: { readonly phase: number; readonly sign?: boolean },
): StandardMaterial {
  return dynamicMaterial(scene, name, { width: 2048, height: 1024 }, (context, width, height) => {
    const bandHeight = height / 16;
    for (let band = 0; band < 16; band += 1) {
      const hue = BRANDHORST_COLORS[(band * 5 + options.phase) % BRANDHORST_COLORS.length];
      context.fillStyle = hue;
      context.fillRect(0, band * bandHeight, width, bandHeight + 1);
      context.fillStyle = "rgba(20, 27, 31, 0.11)";
      context.fillRect(0, (band + 1) * bandHeight - 3, width, 3);
    }

    const rodStep = 9;
    for (let x = -rodStep; x < width + rodStep; x += rodStep) {
      const index = Math.floor((x + rodStep) / rodStep);
      const color = BRANDHORST_COLORS[(index * 7 + options.phase) % BRANDHORST_COLORS.length];
      context.fillStyle = "rgba(15, 22, 26, 0.26)";
      context.fillRect(x + 5, 0, 3, height);
      context.fillStyle = color;
      context.fillRect(x + 1, 0, 5, height);
      context.fillStyle = "rgba(255, 255, 255, 0.28)";
      context.fillRect(x + 1, 0, 1, height);
    }

    if (options.sign) {
      context.fillStyle = "rgba(245, 242, 232, 0.93)";
      context.fillRect(width * 0.20, height * 0.72, width * 0.60, height * 0.13);
      context.fillStyle = "#25272a";
      context.font = `600 ${Math.round(height * 0.060)}px Arial, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("MUSEUM BRANDHORST", width * 0.5, height * 0.785);
    }
  }, new Color3(0.18, 0.18, 0.17));
}

function createMuseumBrandhorst(scene: Scene, parent: TransformNode): TransformNode {
  const existing = scene.getTransformNodeByName("landmark-museum-brandhorst");
  if (existing) return existing;

  const root = new TransformNode("landmark-museum-brandhorst", scene);
  root.parent = parent;
  const interior: FacadePoint = [141.367, 365.311];
  const longCool = brandhorstMaterial(scene, "brandhorst-long-cool-material", { phase: 3 });
  const longWarm = brandhorstMaterial(scene, "brandhorst-long-warm-material", { phase: 11 });
  const entrance = brandhorstMaterial(scene, "brandhorst-theresien-entrance-material", { phase: 17, sign: true });
  const southEnd = brandhorstMaterial(scene, "brandhorst-south-end-material", { phase: 6 });

  // The long western elevation faces the Marianne-von-Werefkin-Weg walkway.
  addFacadePlane(scene, root, "brandhorst-marianne-facade", [148.491, 324.503], [117.247, 398.928], interior, 19.35, longCool);
  // The opposite long elevation faces Türkenstraße.
  addFacadePlane(scene, root, "brandhorst-tuerken-facade", [134.223, 406.119], [165.486, 331.705], interior, 19.35, longWarm);
  // The short northern address elevation faces Theresienstraße.
  addFacadePlane(scene, root, "brandhorst-theresien-facade", [165.486, 331.705], [148.491, 324.503], interior, 19.35, entrance);
  addFacadePlane(scene, root, "brandhorst-south-facade", [117.247, 398.928], [134.223, 406.119], interior, 19.35, southEnd);
  return root;
}

function createAltePinakothek(scene: Scene, parent: TransformNode): TransformNode {
  const existing = scene.getTransformNodeByName("landmark-alte-pinakothek");
  if (existing) return existing;

  const root = new TransformNode("landmark-alte-pinakothek", scene);
  root.parent = parent;
  const interior: FacadePoint = [-151.1, 302.8];
  const theresien = getLandmarkFacadeMaterial(scene, "alte-pinakothek-theresienstrasse");
  const gabelsberger = getLandmarkFacadeMaterial(scene, "alte-pinakothek-gabelsbergerstrasse");
  const end = getLandmarkFacadeMaterial(scene, "alte-pinakothek-end");

  // Current public entrance: the long north elevation on Theresienstraße.
  addFacadePlane(scene, root, "alte-pinakothek-theresien-facade", [-210.251, 250.052], [-72.126, 307.952], interior, 22.0, theresien);
  addFacadePlane(scene, root, "alte-pinakothek-gabelsberger-facade", [-91.995, 355.475], [-230.150, 297.624], interior, 22.0, gabelsberger);
  addFacadePlane(scene, root, "alte-pinakothek-barer-facade", [-72.126, 307.952], [-91.995, 355.475], interior, 22.0, end);
  addFacadePlane(scene, root, "alte-pinakothek-arcis-facade", [-230.150, 297.624], [-210.251, 250.052], interior, 22.0, end);
  return root;
}

function staatsbibliothekMaterial(scene: Scene): StandardMaterial {
  return dynamicMaterial(scene, "staatsbibliothek-ludwigstrasse-material", { width: 2048, height: 1024 }, (context, width, height) => {
    context.fillStyle = "#a85237";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "rgba(91, 43, 31, 0.36)";
    context.lineWidth = 2;
    for (let y = 8; y < height; y += 18) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    context.fillStyle = "#b99b73";
    context.fillRect(0, height * 0.88, width, height * 0.12);
    for (const y of [height * 0.24, height * 0.48, height * 0.72, height * 0.87]) {
      context.fillStyle = "rgba(212, 184, 137, 0.82)";
      context.fillRect(0, y, width, 8);
    }

    const bays = 31;
    const bayWidth = width / bays;
    for (let bay = 0; bay < bays; bay += 1) {
      const centerX = (bay + 0.5) * bayWidth;
      context.fillStyle = "rgba(205, 176, 132, 0.70)";
      context.fillRect(centerX - 3, 0, 6, height * 0.88);
      for (const floorTop of [0.075, 0.30, 0.54, 0.76]) {
        const windowWidth = bayWidth * 0.46;
        const windowHeight = height * 0.13;
        const left = centerX - windowWidth * 0.5;
        const top = height * floorTop;
        context.fillStyle = "#d2b887";
        context.fillRect(left - 6, top - 6, windowWidth + 12, windowHeight + 12);
        context.fillStyle = "#263136";
        context.fillRect(left, top, windowWidth, windowHeight);
        context.fillStyle = "rgba(183, 211, 215, 0.14)";
        context.fillRect(left + windowWidth * 0.09, top + 4, windowWidth * 0.11, windowHeight - 8);
      }
    }

    // Friedrich von Gärtner's central portal and broad stair are the main
    // cadence break in the otherwise extremely long Ludwigstraße elevation.
    context.fillStyle = "#c9ad80";
    context.fillRect(width * 0.435, height * 0.48, width * 0.13, height * 0.42);
    for (const offset of [-0.035, 0, 0.035]) {
      const centerX = width * (0.5 + offset);
      context.fillStyle = "#202729";
      context.fillRect(centerX - width * 0.013, height * 0.61, width * 0.026, height * 0.29);
      context.fillStyle = "rgba(209, 187, 147, 0.84)";
      context.fillRect(centerX - width * 0.017, height * 0.58, width * 0.034, height * 0.035);
    }
    for (let step = 0; step < 6; step += 1) {
      const inset = step * width * 0.007;
      context.fillStyle = step % 2 === 0 ? "#bba37e" : "#a88f6c";
      context.fillRect(width * 0.40 + inset, height * (0.91 + step * 0.014), width * 0.20 - inset * 2, height * 0.016);
    }
  });
}

function createBayerischeStaatsbibliothek(scene: Scene, parent: TransformNode): TransformNode {
  const existing = scene.getTransformNodeByName("landmark-bayerische-staatsbibliothek");
  if (existing) return existing;

  const root = new TransformNode("landmark-bayerische-staatsbibliothek", scene);
  root.parent = parent;
  const interior: FacadePoint = [639.4, 401.1];
  // The public 150 m frontage is the west-facing elevation on Ludwigstraße.
  addFacadePlane(
    scene,
    root,
    "staatsbibliothek-ludwigstrasse-facade",
    [580.426, 460.558],
    [625.555, 319.632],
    interior,
    24.0,
    staatsbibliothekMaterial(scene),
  );
  return root;
}

function hofbraeuhausSignMaterial(scene: Scene): StandardMaterial {
  return dynamicMaterial(scene, "hofbraeuhaus-sign-material", { width: 1024, height: 192 }, (context, width, height) => {
    context.fillStyle = "#f1ead5";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#2f5f51";
    context.lineWidth = 18;
    context.strokeRect(10, 10, width - 20, height - 20);
    context.fillStyle = "#234e43";
    context.font = `700 ${Math.round(height * 0.48)}px Georgia, serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("HOFBRÄUHAUS", width * 0.5, height * 0.52);
  });
}

function addFacadeSign(
  scene: Scene,
  parent: TransformNode,
  name: string,
  start: FacadePoint,
  end: FacadePoint,
  interior: FacadePoint,
  y: number,
  width: number,
  height: number,
  material: Material,
): Mesh {
  const frame = facadeFrame(start, end, interior);
  const mesh = MeshBuilder.CreatePlane(name, { width, height, sideOrientation: Mesh.FRONTSIDE }, scene);
  mesh.parent = parent;
  mesh.position.copyFrom(frame.center.add(frame.outward.scale(0.095)).add(new Vector3(0, y, 0)));
  mesh.rotation.y = frame.yaw + Math.PI;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  return mesh;
}

function createHofbraeuhaus(scene: Scene, parent: TransformNode): TransformNode {
  const existing = scene.getTransformNodeByName("landmark-hofbraeuhaus");
  if (existing) return existing;

  const root = new TransformNode("landmark-hofbraeuhaus", scene);
  root.parent = parent;
  const interior: FacadePoint = [589.415, 1490.816];
  const facade = getLandmarkFacadeMaterial(scene, "hofbraeuhaus");
  const westStart: FacadePoint = [569.931, 1491.400];
  const westEnd: FacadePoint = [585.148, 1471.694];

  // The two articulated Platzl elevations meet at the famous public corner.
  addFacadePlane(scene, root, "hofbraeuhaus-platzl-west-facade", westStart, westEnd, interior, 18.4, facade);
  addFacadePlane(scene, root, "hofbraeuhaus-platzl-north-facade", [585.148, 1471.694], [608.899, 1489.843], interior, 18.4, facade);
  addFacadeSign(scene, root, "hofbraeuhaus-platzl-name-sign", westStart, westEnd, interior, 10.35, 8.4, 1.45, hofbraeuhausSignMaterial(scene));
  return root;
}

function asamkircheMaterial(scene: Scene): StandardMaterial {
  return dynamicMaterial(scene, "asamkirche-sendlinger-material", { width: 1024, height: 2048 }, (context, width, height) => {
    context.fillStyle = "#c99b52";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#e8dfc7";
    context.fillRect(0, height * 0.92, width, height * 0.08);

    context.strokeStyle = "#f1ead9";
    context.lineWidth = width * 0.035;
    for (const x of [width * 0.12, width * 0.34, width * 0.66, width * 0.88]) {
      context.beginPath();
      context.moveTo(x, height * 0.08);
      context.bezierCurveTo(x - width * 0.025, height * 0.30, x + width * 0.025, height * 0.58, x, height * 0.92);
      context.stroke();
    }
    for (const y of [height * 0.25, height * 0.48, height * 0.70, height * 0.91]) {
      context.fillStyle = "rgba(242, 235, 219, 0.90)";
      context.fillRect(0, y, width, height * 0.018);
    }

    // Four stacked openings, culminating in the large upper facade window.
    const openings = [
      { y: 0.74, w: 0.32, h: 0.18 },
      { y: 0.52, w: 0.27, h: 0.13 },
      { y: 0.30, w: 0.30, h: 0.14 },
      { y: 0.105, w: 0.24, h: 0.12 },
    ] as const;
    for (const opening of openings) {
      const left = width * (0.5 - opening.w * 0.5);
      const top = height * opening.y;
      const openingWidth = width * opening.w;
      const openingHeight = height * opening.h;
      context.fillStyle = "#f3ecdc";
      context.fillRect(left - width * 0.025, top - width * 0.025, openingWidth + width * 0.05, openingHeight + width * 0.05);
      context.fillStyle = opening.y > 0.7 ? "#30231d" : "#28343a";
      context.fillRect(left, top, openingWidth, openingHeight);
      context.strokeStyle = "#806947";
      context.lineWidth = 7;
      context.beginPath();
      context.moveTo(width * 0.5, top + 3);
      context.lineTo(width * 0.5, top + openingHeight - 3);
      context.moveTo(left + 3, top + openingHeight * 0.5);
      context.lineTo(left + openingWidth - 3, top + openingHeight * 0.5);
      context.stroke();
    }

    // Original, non-photographic shorthand for the rolling stucco, rocks,
    // angels, and Nepomuk niche described on the official city page.
    context.strokeStyle = "#f6f0e2";
    context.lineWidth = width * 0.026;
    for (const side of [-1, 1]) {
      context.beginPath();
      context.moveTo(width * 0.5, height * 0.42);
      context.bezierCurveTo(
        width * (0.5 + side * 0.20), height * 0.40,
        width * (0.5 + side * 0.31), height * 0.49,
        width * (0.5 + side * 0.36), height * 0.57,
      );
      context.stroke();
      context.beginPath();
      context.moveTo(width * (0.5 + side * 0.10), height * 0.69);
      context.bezierCurveTo(
        width * (0.5 + side * 0.28), height * 0.66,
        width * (0.5 + side * 0.37), height * 0.77,
        width * (0.5 + side * 0.42), height * 0.84,
      );
      context.stroke();
    }

    context.fillStyle = "#eadfca";
    context.beginPath();
    context.arc(width * 0.5, height * 0.445, width * 0.065, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#a98c5d";
    context.fillRect(width * 0.475, height * 0.445, width * 0.05, height * 0.095);
    context.fillStyle = "#d0b768";
    context.beginPath();
    context.arc(width * 0.5, height * 0.43, width * 0.026, 0, Math.PI * 2);
    context.fill();
  });
}

function createAsamkirche(scene: Scene, parent: TransformNode): TransformNode {
  const existing = scene.getTransformNodeByName("landmark-asamkirche");
  if (existing) return existing;

  const root = new TransformNode("landmark-asamkirche", scene);
  root.parent = parent;
  // Only the narrow public front faces Sendlinger Straße. The rich LoD2 shell
  // retains the rest of the church and its rear-set tower.
  addFacadePlane(
    scene,
    root,
    "asamkirche-sendlinger-facade",
    [-177.638, 1771.512],
    [-169.755, 1766.828],
    [-182.349, 1758.676],
    23.5,
    asamkircheMaterial(scene),
  );
  return root;
}

export function createTextureFirstLandmarks(scene: Scene, parent: TransformNode): TransformNode {
  const existing = scene.getTransformNodeByName("texture-first-landmarks");
  if (existing) return existing;

  const root = new TransformNode("texture-first-landmarks", scene);
  root.parent = parent;
  createMuseumBrandhorst(scene, root);
  createAltePinakothek(scene, root);
  createBayerischeStaatsbibliothek(scene, root);
  createHofbraeuhaus(scene, root);
  createAsamkirche(scene, root);
  return root;
}
