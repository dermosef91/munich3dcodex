#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { readRuntimeTile } from "./lib/runtime-tile.mjs";

const root = path.resolve(import.meta.dirname, "..");
const dataDirectory = path.join(root, "public", "data");
const manifestPath = path.join(root, "src", "world", "landmarks", "manifest.json");
const tileDirectory = path.join(root, "public", "data", "tiles");
const allowedStatuses = new Set(["planned", "integrated"]);
const allowedShellModes = new Set(["replace", "preserve", "none"]);
const allowedMethods = new Set(["original-art", "procedural", "licensed-photo", "mixed"]);
const allowedReviewStatuses = new Set(["prototype", "needs-user-review", "approved"]);

function usage() {
  process.stderr.write(
    "Usage:\n"
      + "  node scripts/landmark-assets.mjs inspect --id <building-id> [--radius <metres>]\n"
      + "  node scripts/landmark-assets.mjs validate\n",
  );
  process.exitCode = 2;
  throw new Error("Invalid landmark-assets command");
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  if (index === args.length - 1 || args[index + 1].startsWith("--")) usage();
  return args[index + 1];
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function loadManifest() {
  return readJson(manifestPath);
}

function cleanOutline(outline) {
  if (!Array.isArray(outline)) return [];
  const points = outline.filter((point) => (
    Array.isArray(point)
      && point.length === 2
      && point.every(Number.isFinite)
  ));
  if (points.length > 1) {
    const first = points[0];
    const last = points.at(-1);
    if (first[0] === last[0] && first[1] === last[1]) points.pop();
  }
  return points;
}

function buildingBounds(building) {
  const points = cleanOutline(building.outline);
  if (points.length === 0) return null;
  const xs = points.map(([x]) => x);
  const zs = points.map(([, z]) => z);
  return {
    west: Math.min(...xs),
    north: Math.min(...zs),
    east: Math.max(...xs),
    south: Math.max(...zs),
  };
}

function buildingCenter(building) {
  const bounds = buildingBounds(building);
  return bounds
    ? [(bounds.west + bounds.east) * 0.5, (bounds.north + bounds.south) * 0.5]
    : null;
}

function round(value) {
  return Number(value.toFixed(3));
}

function buildingSummary(record) {
  const { building, tileId } = record;
  const center = buildingCenter(building);
  const bounds = buildingBounds(building);
  return {
    id: building.id,
    tileId,
    name: building.name ?? null,
    address: building.address ?? null,
    kind: building.kind ?? null,
    source: building.source ?? null,
    sourceId: building.sourceId ?? null,
    height: building.height,
    levels: building.levels ?? null,
    roofShape: building.roofShape ?? null,
    hasLod2Geometry: Boolean(building.geometry),
    center: center?.map(round) ?? null,
    bounds: bounds
      ? Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, round(value)]))
      : null,
    sourceRefs: building.sourceRefs ?? [],
  };
}

async function loadBuildingIndex() {
  const files = (await readdir(tileDirectory)).filter((file) => file.endsWith(".json")).sort();
  const byId = new Map();
  const all = [];
  for (const file of files) {
    const tile = await readRuntimeTile(path.join(tileDirectory, file), dataDirectory);
    for (const building of tile.buildings ?? []) {
      const record = { building, tileId: tile.id ?? file.replace(/\.json$/, ""), file };
      all.push(record);
      const occurrences = byId.get(building.id) ?? [];
      occurrences.push(record);
      byId.set(building.id, occurrences);
    }
  }
  return { all, byId };
}

async function inspect(args) {
  const rawId = option(args, "--id");
  if (rawId === undefined) usage();
  const id = Number(rawId);
  const radius = Number(option(args, "--radius", "75"));
  if (!Number.isSafeInteger(id)) throw new Error(`Invalid building id: ${rawId}`);
  if (!Number.isFinite(radius) || radius <= 0 || radius > 5_000) {
    throw new Error(`Invalid inspection radius: ${radius}`);
  }

  const [manifest, index] = await Promise.all([loadManifest(), loadBuildingIndex()]);
  const matches = index.byId.get(id) ?? [];
  if (matches.length === 0) throw new Error(`Building ${id} is absent from runtime tiles`);
  if (matches.length > 1) throw new Error(`Building ${id} appears in ${matches.length} runtime tiles`);

  const target = matches[0];
  const center = buildingCenter(target.building);
  const nearby = index.all
    .filter((record) => record.building.id !== id)
    .map((record) => {
      const candidateCenter = buildingCenter(record.building);
      const distance = center && candidateCenter
        ? Math.hypot(candidateCenter[0] - center[0], candidateCenter[1] - center[1])
        : Number.POSITIVE_INFINITY;
      return { record, distance };
    })
    .filter(({ distance }) => distance <= radius)
    .sort((first, second) => first.distance - second.distance)
    .map(({ record, distance }) => ({
      distanceMeters: round(distance),
      ...buildingSummary(record),
    }));

  const referencedBy = manifest.landmarks
    .filter((landmark) => landmark.shell.targetBuildingIds.includes(id))
    .map((landmark) => ({ id: landmark.id, status: landmark.status, shellMode: landmark.shell.mode }));

  process.stdout.write(`${JSON.stringify({
    target: buildingSummary(target),
    referencedBy,
    radiusMeters: radius,
    nearby,
  }, null, 2)}\n`);
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  return normalized !== ".." && !normalized.startsWith("../") && !normalized.includes("/../");
}

function finiteVector(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function safeIntegerArray(value) {
  return Array.isArray(value) && value.every(Number.isSafeInteger);
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function replacementIdsFromSource(source) {
  const block = source.match(/LANDMARK_REPLACEMENT_BUILDING_IDS[\s\S]*?new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? "";
  return [...block.matchAll(/^\s*(-?[\d_]+),/gm)].map((match) => (
    Number.parseInt(match[1].replaceAll("_", ""), 10)
  ));
}

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function validate() {
  const errors = [];
  const report = (condition, message) => {
    if (!condition) errors.push(message);
  };

  const manifest = await loadManifest();
  report(manifest.schemaVersion === 1, "schemaVersion must be 1");
  report(isSafeRelativePath(manifest.assetRoot), "assetRoot must be a safe relative path");
  report(Array.isArray(manifest.landmarks) && manifest.landmarks.length > 0, "landmarks must be a non-empty array");
  if (!Array.isArray(manifest.landmarks)) manifest.landmarks = [];

  const [buildingIndex, registrySource, textureSource, previewSource] = await Promise.all([
    loadBuildingIndex(),
    readFile(path.join(root, "src", "world", "landmarkRegistry.ts"), "utf8"),
    readFile(path.join(root, "src", "world", "landmarkFacadeTextures.ts"), "utf8"),
    readFile(path.join(root, "src", "world", "landmarkPreview.ts"), "utf8"),
  ]);

  const landmarkIds = [];
  const rootNodes = [];
  const previewIds = [];
  const textureIds = [];
  const textureFiles = [];
  const targetOwners = new Map();
  const replacementOwners = new Map();
  const expectedReplacementIds = [];
  let integratedTextureCount = 0;

  for (const landmark of manifest.landmarks) {
    const context = `landmark ${landmark.id ?? "<missing>"}`;
    report(isObject(landmark), `${context} must be an object`);
    if (!isObject(landmark)) continue;
    report(typeof landmark.id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(landmark.id), `${context} has invalid id`);
    report(typeof landmark.label === "string" && landmark.label.trim().length > 0, `${context} is missing label`);
    report(allowedStatuses.has(landmark.status), `${context} has invalid status`);
    landmarkIds.push(landmark.id);

    report(isObject(landmark.implementation), `${context} is missing implementation`);
    const sourceFile = landmark.implementation?.sourceFile;
    const rootNode = landmark.implementation?.rootNode;
    report(isSafeRelativePath(sourceFile) && sourceFile.startsWith("src/world/"), `${context} has invalid sourceFile`);
    report(typeof rootNode === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rootNode), `${context} has invalid rootNode`);
    rootNodes.push(rootNode);

    let implementationSource = "";
    if (landmark.status === "integrated" && isSafeRelativePath(sourceFile)) {
      try {
        implementationSource = await readFile(path.join(root, sourceFile), "utf8");
        report(implementationSource.includes(rootNode), `${context} root node ${rootNode} is absent from ${sourceFile}`);
      } catch {
        report(false, `${context} implementation file does not exist: ${sourceFile}`);
      }
    }

    const shell = landmark.shell;
    report(isObject(shell), `${context} is missing shell metadata`);
    if (isObject(shell)) {
      report(allowedShellModes.has(shell.mode), `${context} has invalid shell mode`);
      report(safeIntegerArray(shell.targetBuildingIds), `${context} targetBuildingIds must contain safe integers`);
      report(safeIntegerArray(shell.replacementBuildingIds), `${context} replacementBuildingIds must contain safe integers`);
      const targets = safeIntegerArray(shell.targetBuildingIds) ? shell.targetBuildingIds : [];
      const replacements = safeIntegerArray(shell.replacementBuildingIds) ? shell.replacementBuildingIds : [];
      report(duplicateValues(targets).length === 0, `${context} repeats a target building id`);
      report(duplicateValues(replacements).length === 0, `${context} repeats a replacement building id`);
      report(replacements.every((id) => targets.includes(id)), `${context} replacement IDs must be a subset of target IDs`);
      if (shell.mode === "replace") report(replacements.length > 0, `${context} replace mode requires replacement IDs`);
      if (shell.mode === "preserve" || shell.mode === "none") {
        report(replacements.length === 0, `${context} ${shell.mode} mode cannot have replacement IDs`);
      }
      if (shell.mode === "none") report(targets.length === 0, `${context} none mode cannot have target buildings`);
      report(typeof shell.note === "string" && shell.note.trim().length > 0, `${context} is missing shell note`);

      for (const id of targets) {
        const occurrences = buildingIndex.byId.get(id) ?? [];
        report(occurrences.length === 1, `${context} target building ${id} appears ${occurrences.length} times in runtime tiles`);
        const owner = targetOwners.get(id);
        report(owner === undefined || owner === landmark.id, `${context} target building ${id} is already owned by ${owner}`);
        targetOwners.set(id, landmark.id);
      }
      for (const id of replacements) {
        const owner = replacementOwners.get(id);
        report(owner === undefined || owner === landmark.id, `${context} replacement building ${id} is already owned by ${owner}`);
        replacementOwners.set(id, landmark.id);
        if (landmark.status === "integrated") expectedReplacementIds.push(id);
      }
    }

    report(Array.isArray(landmark.previews) && landmark.previews.length > 0, `${context} must have at least one preview`);
    for (const preview of landmark.previews ?? []) {
      const previewContext = `${context} preview ${preview.id ?? "<missing>"}`;
      report(typeof preview.id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(preview.id), `${previewContext} has invalid id`);
      report(finiteVector(preview.position), `${previewContext} has invalid position`);
      report(finiteVector(preview.target), `${previewContext} has invalid target`);
      if (finiteVector(preview.position) && finiteVector(preview.target)) {
        const distance = Math.hypot(
          preview.position[0] - preview.target[0],
          preview.position[1] - preview.target[1],
          preview.position[2] - preview.target[2],
        );
        report(distance >= 2 && distance <= 500, `${previewContext} camera distance must be between 2 and 500 metres`);
      }
      report(preview.fov === undefined || (Number.isFinite(preview.fov) && preview.fov >= 0.3 && preview.fov <= 2), `${previewContext} has invalid fov`);
      if (landmark.status === "integrated") {
        report(previewSource.includes(preview.id), `${previewContext} is absent from landmark preview specs`);
      }
      previewIds.push(preview.id);
    }

    report(Array.isArray(landmark.textures), `${context} textures must be an array`);
    for (const texture of landmark.textures ?? []) {
      const textureContext = `${context} texture ${texture.id ?? "<missing>"}`;
      report(typeof texture.id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(texture.id), `${textureContext} has invalid id`);
      report(typeof texture.file === "string" && texture.file.endsWith(".png") && isSafeRelativePath(texture.file), `${textureContext} has invalid PNG file`);
      report(allowedStatuses.has(texture.status), `${textureContext} has invalid status`);
      report(Number.isInteger(texture.minimumWidth) && texture.minimumWidth > 0 && texture.minimumWidth <= 4096, `${textureContext} has invalid minimumWidth`);
      report(Number.isInteger(texture.minimumHeight) && texture.minimumHeight > 0 && texture.minimumHeight <= 4096, `${textureContext} has invalid minimumHeight`);
      report(Number.isFinite(texture.roughness) && texture.roughness >= 0 && texture.roughness <= 1, `${textureContext} has invalid roughness`);
      report(Number.isFinite(texture.specularIntensity) && texture.specularIntensity >= 0 && texture.specularIntensity <= 1, `${textureContext} has invalid specularIntensity`);
      report(typeof texture.promptSummary === "string" && texture.promptSummary.trim().length > 0, `${textureContext} is missing promptSummary`);
      textureIds.push(texture.id);
      textureFiles.push(texture.file);

      if (texture.status === "integrated") {
        integratedTextureCount += 1;
        report(landmark.status === "integrated", `${textureContext} cannot be integrated while its landmark is planned`);
        const assetPath = path.join(root, "public", manifest.assetRoot, texture.file);
        try {
          const buffer = await readFile(assetPath);
          const dimensions = pngDimensions(buffer);
          report(dimensions !== null, `${textureContext} is not a PNG`);
          if (dimensions) {
            report(dimensions.width >= texture.minimumWidth, `${textureContext} width ${dimensions.width} is below ${texture.minimumWidth}`);
            report(dimensions.height >= texture.minimumHeight, `${textureContext} height ${dimensions.height} is below ${texture.minimumHeight}`);
            report(dimensions.width <= 4096 && dimensions.height <= 4096, `${textureContext} exceeds the 4096 px dimension limit`);
          }
        } catch {
          report(false, `${textureContext} asset is missing: public/${manifest.assetRoot}/${texture.file}`);
        }
        report(textureSource.includes(texture.id), `${textureContext} id is absent from landmarkFacadeTextures.ts`);
        if (implementationSource) {
          report(
            implementationSource.includes(`getLandmarkFacadeMaterial(scene, "${texture.id}")`),
            `${textureContext} is not attached in ${sourceFile}`,
          );
        }
      }
    }

    report(Array.isArray(landmark.references) && landmark.references.length > 0, `${context} requires at least one reference`);
    for (const reference of landmark.references ?? []) {
      let validUrl = false;
      try {
        const url = new URL(reference.url);
        validUrl = url.protocol === "https:";
      } catch {
        validUrl = false;
      }
      report(validUrl, `${context} has invalid reference URL ${reference.url ?? "<missing>"}`);
      for (const field of ["publisher", "usage", "license"]) {
        report(typeof reference[field] === "string" && reference[field].trim().length > 0, `${context} reference is missing ${field}`);
      }
    }

    const provenance = landmark.provenance;
    report(isObject(provenance), `${context} is missing provenance`);
    if (isObject(provenance)) {
      report(allowedMethods.has(provenance.method), `${context} has invalid provenance method`);
      report(allowedReviewStatuses.has(provenance.reviewStatus), `${context} has invalid review status`);
      report(typeof provenance.pixelsEmbedded === "boolean", `${context} pixelsEmbedded must be boolean`);
      report(typeof provenance.note === "string" && provenance.note.trim().length > 0, `${context} is missing provenance note`);
    }
  }

  for (const duplicate of duplicateValues(landmarkIds)) errors.push(`duplicate landmark id ${duplicate}`);
  for (const duplicate of duplicateValues(rootNodes)) errors.push(`duplicate root node ${duplicate}`);
  for (const duplicate of duplicateValues(previewIds)) errors.push(`duplicate preview id ${duplicate}`);
  for (const duplicate of duplicateValues(textureIds)) errors.push(`duplicate texture id ${duplicate}`);
  for (const duplicate of duplicateValues(textureFiles)) errors.push(`duplicate texture file ${duplicate}`);

  const actualReplacementIds = replacementIdsFromSource(registrySource);
  for (const duplicate of duplicateValues(actualReplacementIds)) errors.push(`runtime registry repeats replacement id ${duplicate}`);
  const expectedSet = new Set(expectedReplacementIds);
  const actualSet = new Set(actualReplacementIds);
  for (const id of expectedSet) report(actualSet.has(id), `runtime registry is missing manifest replacement id ${id}`);
  for (const id of actualSet) report(expectedSet.has(id), `runtime registry has replacement id ${id} absent from integrated manifest entries`);
  report(!actualSet.has(80_516_661), "runtime registry must not replace Nush O Jan building 80516661");

  if (errors.length > 0) {
    process.stderr.write(`Landmark asset validation failed with ${errors.length} error(s):\n`);
    for (const error of errors) process.stderr.write(`- ${error}\n`);
    process.exitCode = 1;
    return;
  }

  const integratedCount = manifest.landmarks.filter((landmark) => landmark.status === "integrated").length;
  process.stdout.write(
    `Landmark assets valid: ${integratedCount}/${manifest.landmarks.length} landmarks integrated, `
      + `${integratedTextureCount} textures, and ${expectedSet.size} streamed shells replaced.\n`,
  );
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "inspect") await inspect(args);
  else if (command === "validate") await validate();
  else usage();
} catch (error) {
  if (process.exitCode === undefined) process.exitCode = 1;
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
}
