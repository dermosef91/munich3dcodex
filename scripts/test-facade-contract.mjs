import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const materialPath = path.join(root, "src", "world", "photorealFacadeMaterials.ts");
const meshPath = path.join(root, "src", "world", "meshBuilders.ts");
const registryPath = path.join(root, "src", "world", "facadeRegistry.ts");
const [materialSource, meshSource, registrySource] = await Promise.all([
  readFile(materialPath, "utf8"),
  readFile(meshPath, "utf8"),
  readFile(registryPath, "utf8"),
]);

for (const layer of ["upper", "ground-residential", "ground-retail", "neutral"]) {
  assert.ok(materialSource.includes(layer), `missing ${layer} material layer`);
}
assert.match(materialSource, /import\.meta\.env\.BASE_URL/);
assert.doesNotMatch(materialSource, /["'`]\/assets\/textures\//);
assert.match(
  materialSource,
  /if \(layer === "ground-residential" \|\| layer === "ground-retail"\) \{[\s\S]*?material\.zOffset\s*=\s*GROUND_LAYER_Z_OFFSET;[\s\S]*?material\.zOffsetUnits\s*=\s*GROUND_LAYER_Z_OFFSET_UNITS;/,
  "only ground facade layers may receive the skirt depth bias",
);
assert.doesNotMatch(
  materialSource,
  /if \(layer !== "upper"\)/,
  "neutral gable and wall materials must remain coplanar with their source geometry",
);
assert.match(materialSource, /const GROUND_LAYER_Z_OFFSET\s*=\s*-1;/);
assert.match(materialSource, /const GROUND_LAYER_Z_OFFSET_UNITS\s*=\s*-4;/);

const textureFiles = [
  ...new Set([...materialSource.matchAll(/texture\("([^"\n]+\.png)"\)/g)].map((match) => match[1])),
];
assert.ok(textureFiles.length >= 17, "expected legacy and new facade texture assets");

function pngDimensions(buffer) {
  assert.equal(buffer.toString("ascii", 1, 4), "PNG", "facade texture must be PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

let newTextureCount = 0;
for (const file of textureFiles) {
  const assetPath = path.join(root, "public", "assets", "textures", file);
  await access(assetPath);
  const dimensions = pngDimensions(await readFile(assetPath));
  assert.ok(dimensions.width >= 512 && dimensions.height >= 256, `${file} is too small`);
  if (file.startsWith("elisabeth-")) {
    newTextureCount += 1;
    assert.ok(dimensions.width / dimensions.height > 1.5, `${file} must remain a wide facade module`);
  }
}
assert.equal(newTextureCount, 18, "expected the complete Elisabethstrasse facade module set");

const familyLines = [...materialSource.matchAll(/^\s+"([a-z-]+)": \[([^\]]+)\],$/gm)]
  .filter((match) => !match[1].startsWith("legacy-") && !match[1].startsWith("elisabeth-"));
assert.equal(familyLines.length, 7, "all Munich facade families need bundle catalogs");

function mixSeed(seed) {
  let value = (seed ^ 0x9e3779b9) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}

for (const [, family, values] of familyLines) {
  const options = [...values.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(options.length >= 2, `${family} needs at least two facade variants`);
  const firstPass = Array.from({ length: 200 }, (_, seed) => options[mixSeed(seed) % options.length]);
  const secondPass = Array.from({ length: 200 }, (_, seed) => options[mixSeed(seed) % options.length]);
  assert.deepEqual(firstPass, secondPass, `${family} selection must be deterministic`);
  assert.ok(new Set(firstPass).size > 1, `${family} seeds must exercise facade variety`);
}

assert.match(meshSource, /function addGroundFacadeSkirt\(/);
assert.match(meshSource, /tile\.businesses[\s\S]*?frontage\?\.buildingId/);
assert.match(meshSource, /retailBuildingIds\.has\(building\.id\)[\s\S]*?"ground-retail"/);
assert.match(
  meshSource,
  /if \(customFacade\) \{[\s\S]*?addBuilding\(buffers\(\), buffers\(\), roofBuffers, tiledRoofBuffers, building, spec, customFacade\);[\s\S]*?continue;/,
  "custom hero facades must bypass generic upper and ground layers",
);
assert.match(
  meshSource,
  /const neutral = buffersFor\(selection\.id, "neutral"\);[\s\S]*?const whollyNeutral = isWindowlessBuilding\(building, ring, spec\);[\s\S]*?addBuilding\(upper, neutral, roofBuffers, tiledRoofBuffers, building, spec, undefined, whollyNeutral\);/,
  "windowless and narrow walls must use their neutral facade layer",
);
assert.match(meshSource, /WINDOWLESS_LOD2_FUNCTIONS[\s\S]*?"51009_1700"/);
assert.match(meshSource, /building\.height <= 4[\s\S]*?effectiveFootprintThickness\(ring\) < 1\.25/);
assert.match(meshSource, /clipSurfacePolygonAtHeight\(polygon, eave, true\)/);
assert.match(meshSource, /clipSurfacePolygonAtHeight\(polygon, eave, false\)/);
assert.match(
  meshSource,
  /\[116756186,\s*"elisabeth-postwar-yellow"\]/,
  "Elisabethstrasse 39 with Torso and Benyou must keep the yellow postwar facade bundle",
);
assert.match(registrySource, /108881086/);
assert.match(
  meshSource,
  /const uMax = customFacade \? 1 : horizontalRepeat;[\s\S]*?const vMax = customFacade \? 1 : verticalRepeat;/,
  "custom facade UVs must cover every elevation with the facade texture",
);
assert.match(
  meshSource,
  /const sideTexture = new Texture\([\s\S]*?sides\.albedoTexture = sideTexture;/,
  "custom facade side elevations must receive the facade texture",
);
assert.match(
  meshSource,
  /texture\.hasAlpha = true;[\s\S]*?front\.albedoTexture = texture;[\s\S]*?front\.useAlphaFromAlbedoTexture = true;/,
  "custom facade front materials must render the alpha channel in their texture",
);
assert.match(
  meshSource,
  /sideTexture\.hasAlpha = true;[\s\S]*?sides\.albedoTexture = sideTexture;[\s\S]*?sides\.useAlphaFromAlbedoTexture = true;/,
  "custom facade side materials must render the alpha channel in their texture",
);
assert.match(
  meshSource,
  /backing: buffers\(\),[\s\S]*?building-facade-backing-[\s\S]*?materials\.backing/,
  "custom facade transparency must have an inset opaque backing surface",
);
assert.match(
  meshSource,
  /backing\.albedoColor = new Color3\(red, green, blue\);/,
  "custom facade backing must use the registered facade colour",
);

process.stdout.write(
  `Facade contract valid: ${familyLines.length} families, ${textureFiles.length} texture files, ${newTextureCount} new layered modules, deterministic bundles, retail bases, and custom No. 46 bypass.\n`,
);
