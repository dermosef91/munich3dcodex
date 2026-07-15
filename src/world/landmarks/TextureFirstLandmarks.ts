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
export const HAUS_DER_KUNST_BUILDING_ID = 150_797_531;
export const PINAKOTHEK_DER_MODERNE_BUILDING_ID = 10_053_440;
export const NSDOKU_BUILDING_ID = 280_336_045;
export const MUSEUM_FUENF_KONTINENTE_BUILDING_ID = 25_695_553;
export const HOTEL_VIER_JAHRESZEITEN_BUILDING_ID = 25_505_398;
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
  outwardOffset = 0.075,
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
      .add(frame.outward.scale(outwardOffset))
      .add(new Vector3(0, height * 0.5, 0)),
  );
  // Babylon planes face local -Z; turn the painted side toward the street.
  mesh.rotation.y = frame.yaw + Math.PI;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  return mesh;
}

function brandhorstSignMaterial(scene: Scene): StandardMaterial {
  const material = dynamicMaterial(scene, "brandhorst-name-sign-material", { width: 1024, height: 160 }, (context, width, height) => {
    context.fillStyle = "#eeebe1";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#25272a";
    context.font = `600 ${Math.round(height * 0.40)}px Arial, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("MUSEUM BRANDHORST", width * 0.5, height * 0.52);
  }, new Color3(0.18, 0.18, 0.17));
  const texture = material.diffuseTexture as Texture;
  texture.uScale = -1;
  texture.uOffset = 1;
  return material;
}

function createMuseumBrandhorst(scene: Scene, parent: TransformNode): TransformNode {
  const existing = scene.getTransformNodeByName("landmark-museum-brandhorst");
  if (existing) return existing;

  const root = new TransformNode("landmark-museum-brandhorst", scene);
  root.parent = parent;
  const interior: FacadePoint = [141.367, 365.311];
  const headInterior: FacadePoint = [158.769, 321.336];
  const marianne = getLandmarkFacadeMaterial(scene, "museum-brandhorst-marianne");
  const tuerken = getLandmarkFacadeMaterial(scene, "museum-brandhorst-tuerken");
  const theresien = getLandmarkFacadeMaterial(scene, "museum-brandhorst-theresien");
  const south = getLandmarkFacadeMaterial(scene, "museum-brandhorst-south");
  const theresienStart: FacadePoint = [143.761, 304.361];
  const theresienEnd: FacadePoint = [174.759, 317.492];

  // The long western elevation faces the Marianne-von-Werefkin-Weg walkway.
  addFacadePlane(scene, root, "brandhorst-marianne-facade", [148.491, 324.503], [117.247, 398.928], interior, 19.35, marianne);
  // The opposite long elevation faces Türkenstraße.
  addFacadePlane(scene, root, "brandhorst-tuerken-facade", [134.223, 406.119], [165.486, 331.705], interior, 19.35, tuerken);
  // The short northern address elevation faces Theresienstraße.
  addFacadePlane(scene, root, "brandhorst-theresien-facade", theresienStart, theresienEnd, headInterior, 23.3, theresien);
  addFacadePlane(scene, root, "brandhorst-south-facade", [117.247, 398.928], [134.223, 406.119], interior, 19.35, south);
  addFacadeSign(scene, root, "brandhorst-theresien-name-sign", theresienStart, theresienEnd, headInterior, 15.8, 14.0, 1.45, brandhorstSignMaterial(scene));
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
    getLandmarkFacadeMaterial(scene, "bayerische-staatsbibliothek-ludwigstrasse"),
    0.45,
  );
  return root;
}

function createHausDerKunst(scene: Scene, parent: TransformNode): TransformNode {
  const existing = scene.getTransformNodeByName("landmark-haus-der-kunst");
  if (existing) return existing;

  const root = new TransformNode("landmark-haus-der-kunst", scene);
  root.parent = parent;
  const interior: FacadePoint = [1035.546, 765.853];
  const main = getLandmarkFacadeMaterial(scene, "haus-der-kunst-prinzregentenstrasse-main");
  const innerWing = getLandmarkFacadeMaterial(scene, "haus-der-kunst-prinzregentenstrasse-inner-wing");
  const outerWing = getLandmarkFacadeMaterial(scene, "haus-der-kunst-prinzregentenstrasse-outer-wing");

  // Five coplanar steps reproduce the long portico and its two set-back wings.
  addFacadePlane(scene, root, "haus-der-kunst-main-facade", [1078.920, 814.056], [972.784, 781.728], interior, 16.15, main, 0.18);
  addFacadePlane(scene, root, "haus-der-kunst-west-inner-wing", [974.275, 776.850], [966.852, 774.586], interior, 16.15, innerWing, 0.14);
  addFacadePlane(scene, root, "haus-der-kunst-east-inner-wing", [1087.957, 811.677], [1080.258, 809.638], interior, 16.15, innerWing, 0.14);
  addFacadePlane(scene, root, "haus-der-kunst-west-outer-wing", [969.758, 765.038], [954.963, 760.502], interior, 16.15, outerWing, 0.14);
  addFacadePlane(scene, root, "haus-der-kunst-east-outer-wing", [1105.727, 806.117], [1091.376, 801.726], interior, 16.15, outerWing, 0.14);
  return root;
}

function pinakothekDerModerneSignMaterial(scene: Scene): StandardMaterial {
  const material = dynamicMaterial(scene, "pinakothek-der-moderne-sign-material", { width: 1536, height: 192 }, (context, width, height) => {
    context.fillStyle = "#e1e0da";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#303436";
    context.font = `600 ${Math.round(height * 0.40)}px Arial, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("PINAKOTHEK DER MODERNE", width * 0.5, height * 0.52);
  }, new Color3(0.12, 0.12, 0.12));
  const texture = material.diffuseTexture as Texture;
  texture.uScale = -1;
  texture.uOffset = 1;
  return material;
}

function createPinakothekDerModerne(scene: Scene, parent: TransformNode): TransformNode {
  const existing = scene.getTransformNodeByName("landmark-pinakothek-der-moderne");
  if (existing) return existing;

  const root = new TransformNode("landmark-pinakothek-der-moderne", scene);
  root.parent = parent;
  const interior: FacadePoint = [17.945, 427.781];
  const marianne = getLandmarkFacadeMaterial(scene, "pinakothek-der-moderne-marianne");
  const tuerken = getLandmarkFacadeMaterial(scene, "pinakothek-der-moderne-tuerkenstrasse");
  const gabelsberger = getLandmarkFacadeMaterial(scene, "pinakothek-der-moderne-gabelsbergerstrasse");
  const barer = getLandmarkFacadeMaterial(scene, "pinakothek-der-moderne-barerstrasse");
  const barerStart: FacadePoint = [-61.213, 431.371];
  const barerEnd: FacadePoint = [-34.852, 368.520];

  addFacadePlane(scene, root, "pinakothek-der-moderne-marianne-facade", [-34.852, 368.520], [97.102, 424.164], interior, 25.15, marianne, 0.14);
  addFacadePlane(scene, root, "pinakothek-der-moderne-tuerken-facade", [97.102, 424.164], [70.719, 487.043], interior, 25.15, tuerken, 0.14);
  addFacadePlane(scene, root, "pinakothek-der-moderne-gabelsberger-facade", [70.719, 487.043], [-61.213, 431.371], interior, 25.15, gabelsberger, 0.14);
  addFacadePlane(scene, root, "pinakothek-der-moderne-barer-facade", barerStart, barerEnd, interior, 25.15, barer, 0.14);
  addFacadeSign(scene, root, "pinakothek-der-moderne-wordmark", barerStart, barerEnd, interior, 5.4, 17.0, 1.2, pinakothekDerModerneSignMaterial(scene));
  return root;
}

function nsdokuSignMaterial(scene: Scene): StandardMaterial {
  const material = dynamicMaterial(scene, "nsdoku-sign-material", { width: 1536, height: 160 }, (context, width, height) => {
    context.fillStyle = "#e9e8e3";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#303436";
    context.font = `600 ${Math.round(height * 0.34)}px Arial, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("NS-DOKUMENTATIONSZENTRUM MÜNCHEN", width * 0.5, height * 0.52);
  }, new Color3(0.10, 0.10, 0.10));
  const texture = material.diffuseTexture as Texture;
  texture.uScale = -1;
  texture.uOffset = 1;
  return material;
}

function createNsdoku(scene: Scene, parent: TransformNode): TransformNode {
  const existing = scene.getTransformNodeByName("landmark-nsdoku");
  if (existing) return existing;

  const root = new TransformNode("landmark-nsdoku", scene);
  root.parent = parent;
  const interior: FacadePoint = [-319.194, 629.071];
  const briennerStart: FacadePoint = [-313.309, 643.802];
  const briennerEnd: FacadePoint = [-333.895, 634.989];
  addFacadePlane(scene, root, "nsdoku-brienner-facade", briennerStart, briennerEnd, interior, 27.1, getLandmarkFacadeMaterial(scene, "nsdoku-briennerstrasse"), 0.14);
  addFacadePlane(scene, root, "nsdoku-west-facade", [-333.895, 634.989], [-325.109, 614.339], interior, 27.1, getLandmarkFacadeMaterial(scene, "nsdoku-west"), 0.14);
  addFacadePlane(scene, root, "nsdoku-north-facade", [-325.109, 614.339], [-304.493, 623.163], interior, 27.1, getLandmarkFacadeMaterial(scene, "nsdoku-north"), 0.14);
  addFacadePlane(scene, root, "nsdoku-east-facade", [-304.493, 623.163], [-313.309, 643.802], interior, 27.1, getLandmarkFacadeMaterial(scene, "nsdoku-east"), 0.14);
  addFacadeSign(scene, root, "nsdoku-brienner-wordmark", briennerStart, briennerEnd, interior, 2.5, 11.5, 0.72, nsdokuSignMaterial(scene));
  return root;
}

function museumFuenfKontinenteSignMaterial(scene: Scene): StandardMaterial {
  const material = dynamicMaterial(scene, "museum-fuenf-kontinente-sign-material", { width: 1536, height: 180 }, (context, width, height) => {
    context.fillStyle = "#d6bf98";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#3e3329";
    context.font = `600 ${Math.round(height * 0.36)}px Georgia, serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("MUSEUM FÜNF KONTINENTE", width * 0.5, height * 0.52);
  }, new Color3(0.08, 0.07, 0.06));
  const texture = material.diffuseTexture as Texture;
  texture.uScale = -1;
  texture.uOffset = 1;
  return material;
}

function createMuseumFuenfKontinente(scene: Scene, parent: TransformNode): TransformNode {
  const existing = scene.getTransformNodeByName("landmark-museum-fuenf-kontinente");
  if (existing) return existing;

  const root = new TransformNode("landmark-museum-fuenf-kontinente", scene);
  root.parent = parent;
  const interior: FacadePoint = [1021.322, 1500.188];
  const start: FacadePoint = [1003.803, 1481.467];
  const end: FacadePoint = [1045.599, 1495.078];
  addFacadePlane(scene, root, "museum-fuenf-kontinente-maximilianstrasse-facade", start, end, interior, 29.0, getLandmarkFacadeMaterial(scene, "museum-fuenf-kontinente-maximilianstrasse"), 0.45);
  addFacadeSign(scene, root, "museum-fuenf-kontinente-wordmark", start, end, interior, 4.0, 17.5, 0.85, museumFuenfKontinenteSignMaterial(scene));
  return root;
}

function hotelVierJahreszeitenSignMaterial(scene: Scene): StandardMaterial {
  const material = dynamicMaterial(scene, "hotel-vier-jahreszeiten-sign-material", { width: 1536, height: 190 }, (context, width, height) => {
    context.fillStyle = "#d7c39c";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#4b3b28";
    context.font = `600 ${Math.round(height * 0.30)}px Georgia, serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("HOTEL VIER JAHRESZEITEN KEMPINSKI", width * 0.5, height * 0.52);
  }, new Color3(0.10, 0.08, 0.05));
  const texture = material.diffuseTexture as Texture;
  texture.uScale = -1;
  texture.uOffset = 1;
  return material;
}

function createHotelVierJahreszeiten(scene: Scene, parent: TransformNode): TransformNode {
  const existing = scene.getTransformNodeByName("landmark-hotel-vier-jahreszeiten");
  if (existing) return existing;

  const root = new TransformNode("landmark-hotel-vier-jahreszeiten", scene);
  root.parent = parent;
  const interior: FacadePoint = [722.121, 1326.637];
  const start: FacadePoint = [700.377, 1339.550];
  const end: FacadePoint = [736.474, 1351.975];
  addFacadePlane(scene, root, "hotel-vier-jahreszeiten-maximilianstrasse-facade", start, end, interior, 27.85, getLandmarkFacadeMaterial(scene, "hotel-vier-jahreszeiten-maximilianstrasse"), 0.25);
  addFacadeSign(scene, root, "hotel-vier-jahreszeiten-wordmark", start, end, interior, 4.3, 18.5, 0.82, hotelVierJahreszeitenSignMaterial(scene));
  return root;
}

function hofbraeuhausSignMaterial(scene: Scene): StandardMaterial {
  const material = dynamicMaterial(scene, "hofbraeuhaus-sign-material", { width: 1024, height: 192 }, (context, width, height) => {
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
  const texture = material.diffuseTexture as Texture;
  texture.uScale = -1;
  texture.uOffset = 1;
  return material;
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
  createHausDerKunst(scene, root);
  createPinakothekDerModerne(scene, root);
  createNsdoku(scene, root);
  createMuseumFuenfKontinente(scene, root);
  createHotelVierJahreszeiten(scene, root);
  createHofbraeuhaus(scene, root);
  createAsamkirche(scene, root);
  return root;
}
