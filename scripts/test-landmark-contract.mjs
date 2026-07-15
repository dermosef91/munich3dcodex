import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(
  path.join(root, "src", "world", "landmarks", "manifest.json"),
  "utf8",
));
const integratedLandmarks = manifest.landmarks.filter((landmark) => landmark.status === "integrated");

const [registrySource, landmarkSource, previewSource, meshSource, mainSource] = await Promise.all([
  readFile(path.join(root, "src", "world", "landmarkRegistry.ts"), "utf8"),
  readFile(path.join(root, "src", "world", "LandmarkDetails.ts"), "utf8"),
  readFile(path.join(root, "src", "world", "landmarkPreview.ts"), "utf8"),
  readFile(path.join(root, "src", "world", "meshBuilders.ts"), "utf8"),
  readFile(path.join(root, "src", "main.ts"), "utf8"),
]);

const implementationSources = new Map();
for (const landmark of integratedLandmarks) {
  let source = implementationSources.get(landmark.implementation.sourceFile);
  if (!source) {
    source = await readFile(path.join(root, landmark.implementation.sourceFile), "utf8");
    implementationSources.set(landmark.implementation.sourceFile, source);
  }
  assert.ok(
    source.includes(landmark.implementation.rootNode),
    `missing integrated landmark root ${landmark.implementation.rootNode}`,
  );
  for (const preview of landmark.previews) {
    assert.ok(previewSource.includes(preview.id), `missing preview ${preview.id}`);
  }
}

const kreuzkircheSource = implementationSources.get("src/world/landmarks/Kreuzkirche.ts");
assert.equal(typeof kreuzkircheSource, "string", "Kreuzkirche implementation must be loaded from the manifest");
assert.match(
  kreuzkircheSource,
  /finish\(mesh, parent, \[0, y \+ height, 0\]/,
  "Kreuzkirche's downward polygon extrusion must be lifted to its requested base elevation",
);

const textureFirstSource = implementationSources.get("src/world/landmarks/TextureFirstLandmarks.ts");
assert.equal(typeof textureFirstSource, "string", "texture-first landmark implementation must be loaded from the manifest");
assert.match(
  landmarkSource,
  /createTextureFirstLandmarks\(scene, root\)/,
  "texture-first overlays must be attached to the runtime landmark layer",
);
assert.match(
  textureFirstSource,
  /mesh\.checkCollisions = false/,
  "texture-first facade planes must not change the streamed LoD2 collision shell",
);

assert.match(mainSource, /createLandmarkDetails\(scene\)/, "landmark layer must be added during startup");
assert.match(mainSource, /createSchwabingDetails\(scene\)/, "preserved-shell facade details must be added during startup");
assert.match(mainSource, /loadMickyStatue\(scene, landmarkRoot\)/, "Micky statue must be loaded into the landmark layer");
const mickyStatueSource = implementationSources.get("src/world/landmarks/MickyStatue.ts");
assert.equal(typeof mickyStatueSource, "string", "Micky statue implementation must be loaded from the manifest");
assert.match(mickyStatueSource, /assets\/environment\/MickyStatue\/MickyStatueTextured\.glb/, "Micky statue must use the supplied textured GLB");
assert.match(mickyStatueSource, /11\.566_427_0, 48\.159_681_3/, "Micky statue must stay in the reviewed No. 46 courtyard position");
assert.match(mickyStatueSource, /mesh\.checkCollisions = mesh\.getTotalVertices\(\) > 0/, "Micky statue geometry must be collision-enabled");
assert.match(meshSource, /if \(isLandmarkReplacementBuilding\(building\.id\)\) continue;/, "generic building shells must be skipped");
assert.match(meshSource, /business\.frontage\?\.buildingId/, "storefronts on replacement shells must be filtered");
assert.match(landmarkSource, /11\.574_029_9, 48\.157_201_2/, "Baerenbrunnen must use its reviewed coordinates");
assert.match(landmarkSource, /timberPanelMaterial/, "Elisabethmarkt must retain its procedural timber texture");
assert.match(landmarkSource, /addSphere\(scene, fountain, "baerenbrunnen-ball"/, "the bear must balance on a spherical ball");
assert.doesNotMatch(landmarkSource, /STADTARCHIV MÜNCHEN/, "the archive reference has no oversized word sign");
assert.match(landmarkSource, /MUNICH MMA/, "the Nordbad pavilion must have its custom sign texture");
assert.match(landmarkSource, /new Vector3\(-618\.626, 0, -992\.432\)/, "Munich MMA must use the south pavilion footprint");
assert.match(landmarkSource, /const elisabethFacadeCenterX = 0\.315;/, "Munich MMA must follow the mapped Elisabethstrasse facade center");
assert.match(landmarkSource, /const elisabethZ = 4\.625;/, "Munich MMA must follow the mapped Elisabethstrasse facade edge rather than the footprint projection");
assert.match(landmarkSource, /munich-mma-elisabeth-glass-wall/, "Munich MMA must have a glass curtain wall toward Elisabethstrasse");
assert.match(landmarkSource, /munich-mma-elisabeth-mullion-/, "Munich MMA's Elisabethstrasse glass must retain its mullion grid");
assert.match(landmarkSource, /mmaGlass: translucentMaterial\([\s\S]*?0\.48\)/, "Munich MMA's street glazing must remain transparent");
assert.doesNotMatch(landmarkSource, /munich-mma-back-wall/, "Munich MMA must not regress to an opaque Elisabethstrasse back wall");
assert.match(landmarkSource, /nordbad-outdoor-warm-pool-water/, "Nordbad's circular outdoor pool must be modeled");
assert.match(landmarkSource, /nordbad-outdoor-small-pool-water/, "Nordbad's small outdoor pool must be modeled");
assert.match(landmarkSource, /one north-offset tower/, "St. Joseph's real single-tower silhouette must be documented");
assert.match(landmarkSource, /st-joseph-west-gable/, "St. Joseph must retain its west gable silhouette");

const registryBlock = registrySource.match(
  /LANDMARK_REPLACEMENT_BUILDING_IDS[\s\S]*?new Set\(\[([\s\S]*?)\]\)/,
)?.[1] ?? "";
const actualReplacementIds = [...registryBlock.matchAll(/^\s*(-?[\d_]+),/gm)].map((match) => (
  Number.parseInt(match[1].replaceAll("_", ""), 10)
));
const expectedReplacementIds = integratedLandmarks.flatMap((landmark) => (
  landmark.shell.replacementBuildingIds
));
assert.equal(new Set(actualReplacementIds).size, actualReplacementIds.length, "replacement registry contains duplicate IDs");
assert.deepEqual(
  [...new Set(actualReplacementIds)].sort((a, b) => a - b),
  [...new Set(expectedReplacementIds)].sort((a, b) => a - b),
  "replacement registry must exactly match integrated manifest entries",
);
assert.ok(!actualReplacementIds.includes(80_516_661), "Nush O Jan must keep its streamed shell");
assert.ok(actualReplacementIds.includes(776_733_543), "St. Joseph's separately mapped tower must be replaced");

for (const landmark of integratedLandmarks.filter((entry) => entry.shell.mode !== "replace")) {
  for (const buildingId of landmark.shell.targetBuildingIds) {
    assert.ok(
      !actualReplacementIds.includes(buildingId),
      `${landmark.id} preserves shell ${buildingId}, which must not be in the replacement registry`,
    );
  }
}

const tileDirectory = path.join(root, "public", "data", "tiles");
const files = (await readdir(tileDirectory)).filter((file) => file.endsWith(".json"));
const buildingOccurrences = new Map();
for (const file of files) {
  const tile = JSON.parse(await readFile(path.join(tileDirectory, file), "utf8"));
  for (const building of tile.buildings ?? []) {
    buildingOccurrences.set(building.id, (buildingOccurrences.get(building.id) ?? 0) + 1);
  }
}
for (const landmark of integratedLandmarks) {
  for (const buildingId of landmark.shell.targetBuildingIds) {
    assert.equal(
      buildingOccurrences.get(buildingId),
      1,
      `${landmark.id} target building ${buildingId} must occur once in runtime tiles`,
    );
  }
}

process.stdout.write(
  `Landmark contract valid: ${integratedLandmarks.length} integrated sights and `
    + `${expectedReplacementIds.length} streamed shells replaced.\n`,
);
