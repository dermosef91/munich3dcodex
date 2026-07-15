#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_BBOX,
  DEFAULT_MANIFEST_NAME,
  DEFAULT_OUTPUT_DIRECTORY,
  tileIdsForBbox,
} from "./fetch-bavaria-lod2.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const acquisitionManifestPath = path.join(DEFAULT_OUTPUT_DIRECTORY, DEFAULT_MANIFEST_NAME);
const normalizedPath = path.join(root, "data", "normalized", "lod2-munich-corridor.json");
const bboxText = [DEFAULT_BBOX.west, DEFAULT_BBOX.south, DEFAULT_BBOX.east, DEFAULT_BBOX.north].join(",");
const verticalOrigin = "500";
const ACQUISITION_SCHEMA = "munich3d-bavaria-lod2-acquisition-v1";
const offlineOsmInputs = [
  path.join(root, "data", "cache", "munich-overpass.json"),
  path.join(root, "data", "cache", "munich-parkseiten.geojson"),
];

function usage() {
  return `Usage: node scripts/rebuild-munich-data.mjs [options]

Rebuild every Munich3D reality-grounding layer in the required order.

Options:
  --refresh-osm  Refresh Overpass and Munich Parkseiten instead of using caches
  --refresh      Alias for --refresh-osm (LoD2 metadata is conditionally refreshed by default)
  --offline      Require cached OSM, Parkseiten, Metalink, and LoD2 source files
  --dry-run      Print the deterministic command plan without reading or writing data
  -h, --help     Show this help
`;
}

export function parseArgs(argv) {
  const options = { refreshOsm: false, offline: false, dryRun: false, help: false };
  for (const argument of argv) {
    if (argument === "--refresh" || argument === "--refresh-osm") options.refreshOsm = true;
    else if (argument === "--offline") options.offline = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "-h" || argument === "--help") options.help = true;
    else throw new Error(`Unknown option ${argument}`);
  }
  if (options.offline && options.refreshOsm) {
    throw new Error("--offline cannot be combined with --refresh or --refresh-osm");
  }
  return options;
}

function commandStep(id, command, args) {
  return { id, command, args };
}

function expectedRawInputs() {
  return tileIdsForBbox(DEFAULT_BBOX).map((tileId) => path.join(DEFAULT_OUTPUT_DIRECTORY, `${tileId}.gml`));
}

export function buildPlan(options, rawInputs = expectedRawInputs()) {
  const node = process.execPath;
  const python = process.env.PYTHON || "python3";
  const osmArgs = [path.join(root, "scripts", "fetch-munich-osm.mjs")];
  if (options.refreshOsm) osmArgs.push("--refresh");
  const acquireArgs = [path.join(root, "scripts", "fetch-bavaria-lod2.mjs")];
  if (options.offline) acquireArgs.push("--offline");
  return {
    schemaVersion: "munich3d-data-rebuild-plan-v1",
    bboxWgs84: [DEFAULT_BBOX.west, DEFAULT_BBOX.south, DEFAULT_BBOX.east, DEFAULT_BBOX.north],
    verticalOriginDHHN2016: Number(verticalOrigin),
    normalizedOutput: normalizedPath,
    steps: [
      commandStep("osm-and-parking", node, osmArgs),
      commandStep("lod2-acquire", node, acquireArgs),
      commandStep("lod2-normalize", python, [
        path.join(root, "scripts", "convert_bavaria_lod2.py"),
        ...rawInputs,
        "--output", normalizedPath,
        "--bbox", bboxText,
        "--vertical-origin", verticalOrigin,
      ]),
      commandStep("lod2-merge", node, [
        path.join(root, "scripts", "merge-lod2-runtime.mjs"),
        "--normalized", normalizedPath,
      ]),
      commandStep("validate", node, [path.join(root, "scripts", "validate-data.mjs")]),
    ],
  };
}

function assertInside(directory, candidate, label) {
  const relative = path.relative(directory, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} resolves outside ${directory}`);
  }
}

export async function rawInputsFromManifest(manifestPath = acquisitionManifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== ACQUISITION_SCHEMA) {
    throw new Error(`Unsupported LoD2 acquisition manifest ${manifest.schemaVersion ?? "(missing schema)"}`);
  }
  const expectedIds = tileIdsForBbox(DEFAULT_BBOX);
  if (JSON.stringify(manifest.request?.tileIds) !== JSON.stringify(expectedIds)) {
    throw new Error("LoD2 acquisition manifest does not cover the configured Munich corridor");
  }
  const manifestDirectory = path.dirname(manifestPath);
  const rawDirectory = path.resolve(DEFAULT_OUTPUT_DIRECTORY);
  if (!Array.isArray(manifest.tiles) || manifest.tiles.length !== expectedIds.length) {
    throw new Error("LoD2 acquisition manifest has an invalid tile list");
  }
  return manifest.tiles.map((tile, index) => {
    if (tile.tileId !== expectedIds[index] || typeof tile.localPath !== "string") {
      throw new Error(`LoD2 acquisition manifest tile ${index} is invalid or out of order`);
    }
    const file = path.resolve(manifestDirectory, tile.localPath);
    assertInside(rawDirectory, file, `LoD2 tile ${tile.tileId}`);
    return file;
  });
}

function printableStep(step) {
  const display = [step.command, ...step.args].map((part) => {
    const relative = path.relative(root, part);
    const value = relative && !relative.startsWith("..") ? relative : part;
    return /[\s"'\\]/.test(value) ? JSON.stringify(value) : value;
  });
  return display.join(" ");
}

async function executeStep(step) {
  process.stdout.write(`\n[${step.id}] ${printableStep(step)}\n`);
  await new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, { cwd: root, stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${step.id} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`));
    });
  });
}

async function requireOfflineOsmInputs() {
  const missing = [];
  for (const file of offlineOsmInputs) {
    try {
      await access(file);
    } catch {
      missing.push(path.relative(root, file));
    }
  }
  if (missing.length > 0) {
    throw new Error(`--offline requires cached inputs: ${missing.join(", ")}`);
  }
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return null;
  }
  if (options.dryRun) {
    const plan = buildPlan(options);
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return plan;
  }

  if (options.offline) await requireOfflineOsmInputs();

  const initialPlan = buildPlan(options);
  await executeStep(initialPlan.steps[0]);
  await executeStep(initialPlan.steps[1]);
  const rawInputs = await rawInputsFromManifest();
  const finalPlan = buildPlan(options, rawInputs);
  for (const step of finalPlan.steps.slice(2)) await executeStep(step);
  process.stdout.write("\nMunich3D reality-grounding rebuild completed successfully.\n");
  return finalPlan;
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  run().catch((error) => {
    process.stderr.write(`Data rebuild failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
