#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_BBOX, tileIdsForBbox } from "./fetch-bavaria-lod2.mjs";
import { buildPlan, parseArgs, rawInputsFromManifest } from "./rebuild-munich-data.mjs";

assert.deepEqual(parseArgs([]), { refreshOsm: false, offline: false, dryRun: false, help: false });
assert.equal(parseArgs(["--refresh"]).refreshOsm, true);
assert.equal(parseArgs(["--offline"]).offline, true);
assert.throws(() => parseArgs(["--offline", "--refresh"]), /cannot be combined/);
assert.throws(() => parseArgs(["--unknown"]), /Unknown option/);

const offlinePlan = buildPlan(parseArgs(["--offline"]));
assert.equal(offlinePlan.schemaVersion, "munich3d-data-rebuild-plan-v1");
assert.deepEqual(offlinePlan.steps.map((step) => step.id), [
  "osm-and-parking",
  "lod2-acquire",
  "lod2-normalize",
  "lod2-merge",
  "validate",
]);
assert.deepEqual(offlinePlan.steps[1].args.slice(-1), ["--offline"]);
assert.equal(offlinePlan.steps[2].args.filter((argument) => argument.endsWith(".gml")).length, 6);
assert.match(offlinePlan.steps[2].args.join(" "), /--vertical-origin 500/);

const temporary = await mkdtemp(path.join(os.tmpdir(), "munich3d-data-rebuild-"));
try {
  const tileIds = tileIdsForBbox(DEFAULT_BBOX);
  const manifestPath = path.join(temporary, "acquisition-manifest.json");
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: "munich3d-bavaria-lod2-acquisition-v1",
    request: { tileIds },
    tiles: tileIds.map((tileId) => ({ tileId, localPath: `${tileId}.gml` })),
  }));
  await assert.rejects(
    rawInputsFromManifest(manifestPath),
    /resolves outside/,
    "an acquisition manifest outside the configured raw directory must be rejected",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}

process.stdout.write("Munich3D rebuild orchestration tests passed.\n");
