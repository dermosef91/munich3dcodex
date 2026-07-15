import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(
  path.join(root, "src", "world", "landmarks", "manifest.json"),
  "utf8",
));
const integratedTextures = manifest.landmarks.flatMap((landmark) => (
  landmark.textures
    .filter((texture) => texture.status === "integrated")
    .map((texture) => ({ landmark, texture }))
));
const textureRoot = path.join(root, "public", manifest.assetRoot);

function pngDimensions(buffer) {
  assert.equal(buffer.toString("ascii", 1, 4), "PNG", "asset must be a PNG");
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

for (const { landmark, texture } of integratedTextures) {
  const buffer = await readFile(path.join(textureRoot, texture.file));
  const [width, height] = pngDimensions(buffer);
  assert.ok(width >= texture.minimumWidth, `${texture.file} width ${width} is below ${texture.minimumWidth}`);
  assert.ok(height >= texture.minimumHeight, `${texture.file} height ${height} is below ${texture.minimumHeight}`);
  assert.ok(width <= 4096 && height <= 4096, `${texture.file} exceeds the texture dimension limit`);
  assert.equal(landmark.status, "integrated", `${texture.id} belongs to a planned landmark`);
}

const textureSource = await readFile(
  path.join(root, "src", "world", "landmarkFacadeTextures.ts"),
  "utf8",
);
assert.match(textureSource, /import\.meta\.env\.BASE_URL/, "landmark textures must work under a non-root Vite base URL");
assert.match(textureSource, /Texture\.TRILINEAR_SAMPLINGMODE/, "landmark textures must use trilinear sampling");
assert.match(textureSource, /anisotropicFilteringLevel = 8/, "landmark textures must use anisotropic filtering");
assert.match(textureSource, /Texture\.CLAMP_ADDRESSMODE/g, "rectified facade sheets must be clamped");

const implementationSources = new Map();
for (const { landmark, texture } of integratedTextures) {
  assert.ok(textureSource.includes(texture.id), `${texture.id} is absent from the landmark texture loader`);
  let source = implementationSources.get(landmark.implementation.sourceFile);
  if (!source) {
    source = await readFile(path.join(root, landmark.implementation.sourceFile), "utf8");
    implementationSources.set(landmark.implementation.sourceFile, source);
  }
  assert.ok(
    source.includes(`getLandmarkFacadeMaterial(scene, "${texture.id}")`),
    `${texture.id} custom facade texture is not attached in ${landmark.implementation.sourceFile}`,
  );
}

process.stdout.write(
  `Landmark textures valid: ${integratedTextures.length} manifest-declared real-reference facade sheets integrated.\n`,
);
