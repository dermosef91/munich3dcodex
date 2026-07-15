import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { ExtrudePolygon } from "@babylonjs/core/Meshes/Builders/polygonBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import earcut from "earcut";
import { getLandmarkFacadeMaterial } from "../landmarkFacadeTextures";

type Point2 = readonly [x: number, z: number];

const CHURCH_CENTER = new Vector3(-445.766, 0, -1279.584);
const TOWER_CENTER = new Vector3(-418.727, 0, -1264.534);

// OSM way 86022858, expressed around its area centroid. Keeping the shallow
// north and south points is important: the sanctuary is a six-sided central
// plan, not the rectangular hall suggested by its quiet street elevation.
const CHURCH_FOOTPRINT: readonly Point2[] = [
  [-12.004, 10.514],
  [-13.304, -8.716],
  [-1.354, -13.066],
  [12.196, -10.506],
  [13.336, 8.154],
  [1.066, 13.364],
];

interface KreuzkircheMaterials {
  readonly plaster: StandardMaterial;
  readonly concrete: StandardMaterial;
  readonly clerestory: StandardMaterial;
  readonly roof: StandardMaterial;
  readonly shadow: StandardMaterial;
  readonly bronze: StandardMaterial;
  readonly copper: StandardMaterial;
  readonly clock: StandardMaterial;
  readonly noticeGlass: StandardMaterial;
}

function colorMaterial(
  scene: Scene,
  name: string,
  diffuse: Color3,
  specular = new Color3(0.035, 0.035, 0.03),
): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = diffuse;
  material.ambientColor = diffuse.scale(0.25);
  material.specularColor = specular;
  material.specularPower = 32;
  return material;
}

function concreteMaterial(scene: Scene): StandardMaterial {
  const texture = new DynamicTexture(
    "kreuzkirche-board-formed-concrete-texture",
    { width: 512, height: 512 },
    scene,
    false,
  );
  texture.hasAlpha = false;
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  context.fillStyle = "#999891";
  context.fillRect(0, 0, 512, 512);
  for (let x = 4; x < 512; x += 13) {
    const alpha = 0.025 + ((x / 13) % 4) * 0.012;
    context.fillStyle = `rgba(45,43,39,${alpha.toFixed(3)})`;
    context.fillRect(x, 0, 2, 512);
  }
  for (let y = 0; y < 512; y += 128) {
    context.fillStyle = "rgba(48,47,43,0.18)";
    context.fillRect(0, y, 512, 2);
    context.fillStyle = "rgba(236,234,222,0.12)";
    context.fillRect(0, y + 2, 512, 1);
  }
  texture.anisotropicFilteringLevel = 8;
  texture.update(true);

  const material = colorMaterial(
    scene,
    "kreuzkirche-board-formed-concrete",
    new Color3(0.63, 0.625, 0.59),
  );
  material.diffuseColor = Color3.White();
  material.diffuseTexture = texture;
  return material;
}

function clockMaterial(scene: Scene): StandardMaterial {
  const texture = new DynamicTexture(
    "kreuzkirche-clock-texture",
    { width: 512, height: 512 },
    scene,
    false,
  );
  texture.hasAlpha = false;
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  context.fillStyle = "#b56e64";
  context.fillRect(0, 0, 512, 512);
  context.beginPath();
  context.arc(256, 256, 194, 0, Math.PI * 2);
  context.fillStyle = "#26252a";
  context.fill();
  context.beginPath();
  context.arc(256, 256, 139, 0, Math.PI * 2);
  context.fillStyle = "#9c544e";
  context.fill();

  const numerals = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];
  context.fillStyle = "#e8dfc9";
  context.font = "700 36px Georgia, serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (let index = 0; index < numerals.length; index += 1) {
    const angle = (index / 12) * Math.PI * 2 - Math.PI / 2;
    context.save();
    context.translate(256 + Math.cos(angle) * 164, 256 + Math.sin(angle) * 164);
    context.rotate(angle + Math.PI / 2);
    context.fillText(numerals[index], 0, 0);
    context.restore();
  }

  context.strokeStyle = "#cda84f";
  context.fillStyle = "#cda84f";
  context.lineCap = "round";
  context.lineWidth = 18;
  context.beginPath();
  context.moveTo(256, 256);
  context.lineTo(171, 226);
  context.moveTo(256, 256);
  context.lineTo(309, 176);
  context.stroke();
  context.beginPath();
  context.arc(256, 256, 22, 0, Math.PI * 2);
  context.fill();
  texture.uScale = -1;
  texture.uOffset = 1;
  texture.anisotropicFilteringLevel = 8;
  texture.update(true);

  const material = new StandardMaterial("kreuzkirche-clock-material", scene);
  material.diffuseTexture = texture;
  material.specularColor = new Color3(0.08, 0.07, 0.05);
  material.emissiveColor = new Color3(0.045, 0.035, 0.025);
  material.backFaceCulling = true;
  return material;
}

function createMaterials(scene: Scene): KreuzkircheMaterials {
  const noticeGlass = colorMaterial(
    scene,
    "kreuzkirche-notice-glass",
    new Color3(0.11, 0.15, 0.16),
    new Color3(0.28, 0.30, 0.28),
  );
  noticeGlass.alpha = 0.86;
  noticeGlass.needDepthPrePass = true;

  return {
    plaster: colorMaterial(scene, "kreuzkirche-warm-plaster", new Color3(0.86, 0.855, 0.82)),
    concrete: concreteMaterial(scene),
    clerestory: colorMaterial(
      scene,
      "kreuzkirche-smoked-clerestory",
      new Color3(0.10, 0.095, 0.085),
      new Color3(0.22, 0.24, 0.23),
    ),
    roof: colorMaterial(scene, "kreuzkirche-flat-roof", new Color3(0.105, 0.11, 0.105)),
    shadow: colorMaterial(scene, "kreuzkirche-open-bay-shadow", new Color3(0.025, 0.025, 0.023), Color3.Black()),
    bronze: colorMaterial(
      scene,
      "kreuzkirche-bronze",
      new Color3(0.21, 0.16, 0.105),
      new Color3(0.24, 0.20, 0.13),
    ),
    copper: colorMaterial(
      scene,
      "kreuzkirche-oxidized-copper",
      new Color3(0.29, 0.44, 0.40),
      new Color3(0.12, 0.18, 0.16),
    ),
    clock: clockMaterial(scene),
    noticeGlass,
  };
}

function node(
  scene: Scene,
  parent: TransformNode,
  name: string,
  position: Vector3,
  yaw = 0,
): TransformNode {
  const result = new TransformNode(name, scene);
  result.parent = parent;
  result.position.copyFrom(position);
  result.rotation.y = yaw;
  return result;
}

function finish(
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

function box(
  scene: Scene,
  parent: TransformNode,
  name: string,
  dimensions: readonly [width: number, height: number, depth: number],
  position: readonly [x: number, y: number, z: number],
  material: Material,
  rotation: readonly [pitch: number, yaw: number, roll: number] = [0, 0, 0],
  collides = false,
): Mesh {
  return finish(
    MeshBuilder.CreateBox(name, { width: dimensions[0], height: dimensions[1], depth: dimensions[2] }, scene),
    parent,
    position,
    material,
    rotation,
    collides,
  );
}

function cylinder(
  scene: Scene,
  parent: TransformNode,
  name: string,
  height: number,
  diameter: number,
  diameterTop: number,
  position: readonly [x: number, y: number, z: number],
  material: Material,
): Mesh {
  return finish(
    MeshBuilder.CreateCylinder(name, { height, diameter, diameterTop, tessellation: 18 }, scene),
    parent,
    position,
    material,
  );
}

function plane(
  scene: Scene,
  parent: TransformNode,
  name: string,
  dimensions: readonly [width: number, height: number],
  position: readonly [x: number, y: number, z: number],
  material: Material,
  yaw: number,
): Mesh {
  return finish(
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

function prism(
  scene: Scene,
  parent: TransformNode,
  name: string,
  footprint: readonly Point2[],
  height: number,
  y: number,
  material: Material,
  collides = false,
): Mesh {
  const mesh = ExtrudePolygon(
    name,
    {
      shape: footprint.map(([x, z]) => new Vector3(x, 0, z)),
      depth: height,
      sideOrientation: Mesh.FRONTSIDE,
      wrap: true,
    },
    scene,
    earcut,
  );
  // ExtrudePolygon grows along local -Y. Lift the result by its depth so `y`
  // remains the requested base elevation instead of burying the prism.
  return finish(mesh, parent, [0, y + height, 0], material, undefined, collides);
}

function edgePlacement(
  start: Point2,
  end: Point2,
  outwardOffset: number,
): { readonly width: number; readonly x: number; readonly z: number; readonly yaw: number } {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const width = Math.hypot(dx, dz);
  const outwardX = dz / width;
  const outwardZ = -dx / width;
  return {
    width,
    x: (start[0] + end[0]) * 0.5 + outwardX * outwardOffset,
    z: (start[1] + end[1]) * 0.5 + outwardZ * outwardOffset,
    yaw: -Math.atan2(dz, dx),
  };
}

function createSanctuary(
  scene: Scene,
  landmark: TransformNode,
  materials: KreuzkircheMaterials,
): void {
  const sanctuary = node(scene, landmark, "kreuzkirche-sanctuary", CHURCH_CENTER);
  prism(
    scene,
    sanctuary,
    "kreuzkirche-six-sided-shell",
    CHURCH_FOOTPRINT,
    15.82,
    0,
    materials.plaster,
    true,
  );
  prism(
    scene,
    sanctuary,
    "kreuzkirche-flat-roof-slab",
    CHURCH_FOOTPRINT,
    0.18,
    15.82,
    materials.roof,
  );

  for (let index = 0; index < CHURCH_FOOTPRINT.length; index += 1) {
    const start = CHURCH_FOOTPRINT[index];
    const end = CHURCH_FOOTPRINT[(index + 1) % CHURCH_FOOTPRINT.length];
    const edge = edgePlacement(start, end, 0.07);

    // OSM's east edge is the public Hiltenspergerstrasse elevation. The
    // reviewed reference sheet carries the real full-height material bands;
    // the other five elevations use the same rhythm procedurally.
    if (index === 3) {
      plane(
        scene,
        sanctuary,
        "kreuzkirche-custom-east-facade",
        [edge.width - 0.14, 15.62],
        [edge.x, 7.82, edge.z],
        getLandmarkFacadeMaterial(scene, "kreuzkirche"),
        edge.yaw,
      );
      continue;
    }

    plane(
      scene,
      sanctuary,
      `kreuzkirche-concrete-belt-${index}`,
      [edge.width - 0.08, 0.82],
      [edge.x, 3.66, edge.z],
      materials.concrete,
      edge.yaw,
    );
    plane(
      scene,
      sanctuary,
      `kreuzkirche-clerestory-${index}`,
      [edge.width - 0.08, 2.34],
      [edge.x, 12.05, edge.z],
      materials.clerestory,
      edge.yaw,
    );
    plane(
      scene,
      sanctuary,
      `kreuzkirche-upper-concrete-${index}`,
      [edge.width - 0.08, 2.14],
      [edge.x, 14.77, edge.z],
      materials.concrete,
      edge.yaw,
    );

    const bayCount = Math.max(4, Math.round(edge.width / 3.2));
    for (let bay = 1; bay < bayCount; bay += 1) {
      const amount = bay / bayCount;
      const x = start[0] + (end[0] - start[0]) * amount;
      const z = start[1] + (end[1] - start[1]) * amount;
      box(
        scene,
        sanctuary,
        `kreuzkirche-clerestory-mullion-${index}-${bay}`,
        [0.18, 2.42, 0.18],
        [x, 12.05, z],
        materials.concrete,
      );
    }
  }
}

function createCampanile(
  scene: Scene,
  landmark: TransformNode,
  materials: KreuzkircheMaterials,
): void {
  // The tower footprint's east-west edge is 3.59 degrees north of world east.
  // Babylon's yaw convention is the inverse of the x/z atan2 angle.
  const tower = node(scene, landmark, "landmark-kreuzkirche-campanile", TOWER_CENTER, 0.0626);
  const width = 3.52;
  const depth = 3.98;

  box(scene, tower, "kreuzkirche-tower-base", [width, 3.10, depth], [0, 1.55, 0], materials.concrete, undefined, true);

  // The tower is a gateway at pedestrian level, not a 25 m solid prism.
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      box(
        scene,
        tower,
        `kreuzkirche-lower-gateway-pier-${x}-${z}`,
        [0.46, 3.45, 0.46],
        [x * (width * 0.5 - 0.23), 4.825, z * (depth * 0.5 - 0.23)],
        materials.concrete,
        undefined,
        true,
      );
    }
  }
  box(scene, tower, "kreuzkirche-lower-gateway-shadow", [width - 0.58, 3.04, 0.08], [0, 4.77, 0], materials.shadow);
  box(scene, tower, "kreuzkirche-tower-shaft", [width, 10.65, depth], [0, 11.975, 0], materials.concrete, undefined, true);

  // Two small street notice cases sit on the otherwise closed base.
  for (const x of [-0.72, 0.72]) {
    box(
      scene,
      tower,
      `kreuzkirche-notice-frame-${x}`,
      [1.22, 0.92, 0.12],
      [x, 1.55, depth * 0.5 + 0.07],
      materials.bronze,
    );
    box(
      scene,
      tower,
      `kreuzkirche-notice-glass-${x}`,
      [1.04, 0.73, 0.13],
      [x, 1.55, depth * 0.5 + 0.14],
      materials.noticeGlass,
    );
  }

  // Photographs verify matching clock panels on the south and east faces.
  plane(
    scene,
    tower,
    "kreuzkirche-clock-south",
    [1.68, 1.68],
    [0, 15.65, depth * 0.5 + 0.055],
    materials.clock,
    Math.PI,
  );
  plane(
    scene,
    tower,
    "kreuzkirche-clock-east",
    [1.68, 1.68],
    [width * 0.5 + 0.055, 15.65, 0],
    materials.clock,
    -Math.PI / 2,
  );

  // Open belfry with a dark soffit and a compact bronze bell.
  box(scene, tower, "kreuzkirche-belfry-floor", [width, 0.24, depth], [0, 17.42, 0], materials.concrete);
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      box(
        scene,
        tower,
        `kreuzkirche-belfry-post-${x}-${z}`,
        [0.42, 3.10, 0.42],
        [x * (width * 0.5 - 0.21), 18.97, z * (depth * 0.5 - 0.21)],
        materials.concrete,
      );
    }
  }
  box(scene, tower, "kreuzkirche-belfry-dark-soffit", [width - 0.48, 0.18, depth - 0.48], [0, 20.43, 0], materials.shadow);
  cylinder(scene, tower, "kreuzkirche-belfry-bell", 1.42, 1.14, 0.58, [0, 19.15, 0], materials.bronze);
  box(scene, tower, "kreuzkirche-tower-cap", [width, 4.46, depth], [0, 22.77, 0], materials.concrete, undefined, true);

  // Steinhauser's folded copper-green cross reads as a small three-dimensional
  // Greek cross from both street directions.
  box(scene, tower, "kreuzkirche-cross-mast", [0.16, 2.0, 0.16], [0, 25.78, 0], materials.copper);
  box(scene, tower, "kreuzkirche-cross-vertical", [0.34, 1.38, 0.34], [0, 26.55, 0], materials.copper);
  box(scene, tower, "kreuzkirche-cross-east-west", [1.30, 0.34, 0.34], [0, 26.55, 0], materials.copper);
  box(scene, tower, "kreuzkirche-cross-north-south", [0.34, 0.34, 1.30], [0, 26.55, 0], materials.copper);
}

export function createKreuzkirche(scene: Scene, parent: TransformNode): TransformNode {
  const landmark = node(scene, parent, "landmark-kreuzkirche", Vector3.Zero());
  const materials = createMaterials(scene);
  createSanctuary(scene, landmark, materials);
  createCampanile(scene, landmark, materials);
  return landmark;
}
