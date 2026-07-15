#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_BBOX,
  buildAcquisitionManifest,
  downloadTile,
  loadMetalink,
  parseArgs,
  parseBbox,
  parseMetalink,
  selectMetalinkTiles,
  tileIdsForBbox,
  verifyFile,
  verifyOfflineTiles,
  wgs84ToUtm32,
} from "./fetch-bavaria-lod2.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const fetchScript = path.join(scriptDirectory, "fetch-bavaria-lod2.mjs");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function closeTo(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
}

function metalinkXml(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<metalink xmlns="urn:ietf:params:xml:ns:metalink">
  <published>2026-07-14T21:09:38Z</published>
  ${entries.map((entry) => `<file name="${entry.file}">
    <size>${entry.bytes}</size>
    <hash type="sha-256">${entry.sha256}</hash>
    ${entry.urls.map((url) => `<url>${url.replaceAll("&", "&amp;")}</url>`).join("\n    ")}
  </file>`).join("\n  ")}
</metalink>\n`;
}

assert.deepEqual(parseBbox("11.560,48.134,11.590,48.170"), DEFAULT_BBOX);
assert.throws(() => parseBbox("11,48,10,49"), /valid WGS84 rectangle/);
assert.throws(() => parseBbox("11,48,12"), /WEST,SOUTH,EAST,NORTH/);

const southwest = wgs84ToUtm32(11.560, 48.134);
closeTo(southwest.easting, 690_462.5826, 0.02, "corridor southwest easting");
closeTo(southwest.northing, 5_334_363.6573, 0.02, "corridor southwest northing");
assert.deepEqual(tileIdsForBbox(DEFAULT_BBOX), [
  "690_5334",
  "690_5336",
  "690_5338",
  "692_5334",
  "692_5336",
  "692_5338",
]);

const hello = Buffer.from("hello world");
const retry = Buffer.from("retry");
const entryA = {
  tileId: "690_5334",
  file: "690_5334.gml",
  bytes: hello.length,
  sha256: sha256(hello),
  urls: [
    "https://download1.bayernwolke.de/a/lod2/citygml/690_5334.gml?x=1&y=2",
    "https://download2.bayernwolke.de/a/lod2/citygml/690_5334.gml",
  ],
};
const entryB = {
  tileId: "692_5334",
  file: "692_5334.gml",
  bytes: retry.length,
  sha256: sha256(retry),
  urls: [
    "https://download1.bayernwolke.de/a/lod2/citygml/692_5334.gml",
    "https://download2.bayernwolke.de/a/lod2/citygml/692_5334.gml",
  ],
};
const xml = metalinkXml([entryB, entryA]);
const parsedMetalink = parseMetalink(xml);
assert.equal(parsedMetalink.published, "2026-07-14T21:09:38Z");
assert.deepEqual(parsedMetalink.entries.get(entryA.file), entryA);
assert.deepEqual(
  selectMetalinkTiles(parsedMetalink, [entryB.tileId, entryA.tileId]).map((entry) => entry.tileId),
  [entryA.tileId, entryB.tileId],
);
assert.throws(
  () => selectMetalinkTiles(parsedMetalink, ["690_5336"]),
  /does not contain required tile/,
);

const manifestRoot = path.join(os.tmpdir(), "manifest-root");
const manifest = buildAcquisitionManifest({
  bbox: DEFAULT_BBOX,
  entries: [entryB, entryA],
  metalinkPublished: parsedMetalink.published,
  outputDirectory: path.join(manifestRoot, "raw"),
  manifestPath: path.join(manifestRoot, "raw", "acquisition-manifest.json"),
});
assert.equal(manifest.schemaVersion, "munich3d-bavaria-lod2-acquisition-v1");
assert.deepEqual(manifest.request.tileIds, [entryA.tileId, entryB.tileId]);
assert.deepEqual(manifest.tiles[0], {
  tileId: entryA.tileId,
  localPath: entryA.file,
  url: entryA.urls[0],
  mirrors: entryA.urls,
  sha256: entryA.sha256,
  bytes: entryA.bytes,
});
assert.equal(
  JSON.stringify(manifest),
  JSON.stringify(buildAcquisitionManifest({
    bbox: DEFAULT_BBOX,
    entries: [entryA, entryB],
    metalinkPublished: parsedMetalink.published,
    outputDirectory: path.join(manifestRoot, "raw"),
    manifestPath: path.join(manifestRoot, "raw", "acquisition-manifest.json"),
  })),
  "manifest order must not depend on Metalink order",
);

const temporary = await mkdtemp(path.join(os.tmpdir(), "munich3d-lod2-fetch-"));
try {
  const metalinkPath = path.join(temporary, "09.meta4");
  await writeFile(metalinkPath, xml);
  let offlineFetches = 0;
  const loaded = await loadMetalink({
    cachePath: metalinkPath,
    offline: true,
    fetchImpl: async () => {
      offlineFetches += 1;
      throw new Error("offline mode attempted a request");
    },
  });
  assert.equal(loaded.xml, xml);
  assert.equal(offlineFetches, 0);

  const resumeDirectory = path.join(temporary, "resume");
  await mkdir(resumeDirectory, { recursive: true });
  await writeFile(`${path.join(resumeDirectory, entryA.file)}.part`, hello.subarray(0, 6));
  let resumeRequests = 0;
  const resumed = await downloadTile(entryA, {
    outputDirectory: resumeDirectory,
    retries: 0,
    timeoutMs: 2_000,
    retryDelayMs: 0,
    fetchImpl: async (_url, options) => {
      resumeRequests += 1;
      assert.equal(options.headers.Range, "bytes=6-");
      return new Response(hello.subarray(6), {
        status: 206,
        headers: { "Content-Range": "bytes 6-10/11" },
      });
    },
  });
  assert.equal(resumed.status, "resumed");
  assert.equal(resumeRequests, 1);
  assert.deepEqual(await readFile(path.join(resumeDirectory, entryA.file)), hello);
  assert.equal((await verifyFile(path.join(resumeDirectory, entryA.file), entryA)).ok, true);
  await assert.rejects(stat(`${path.join(resumeDirectory, entryA.file)}.part`), { code: "ENOENT" });

  const cached = await downloadTile(entryA, {
    outputDirectory: resumeDirectory,
    fetchImpl: async () => {
      throw new Error("verified cache attempted a request");
    },
  });
  assert.equal(cached.status, "cached");
  assert.equal((await verifyOfflineTiles([entryA], resumeDirectory))[0].status, "cached");
  await assert.rejects(
    verifyOfflineTiles([entryB], resumeDirectory),
    /offline mode requires verified cached LoD2 tiles/,
  );

  const retryDirectory = path.join(temporary, "retry");
  const requestedUrls = [];
  const retried = await downloadTile(entryB, {
    outputDirectory: retryDirectory,
    retries: 1,
    timeoutMs: 2_000,
    retryDelayMs: 0,
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      if (requestedUrls.length === 1) throw new Error("first mirror unavailable");
      return new Response(retry, { status: 200 });
    },
  });
  assert.equal(retried.status, "downloaded");
  assert.deepEqual(requestedUrls, entryB.urls);
  assert.deepEqual(await readFile(path.join(retryDirectory, entryB.file)), retry);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

const listOutput = execFileSync(process.execPath, [fetchScript, "--list"], { encoding: "utf8" });
assert.equal(listOutput, `${tileIdsForBbox(DEFAULT_BBOX).join("\n")}\n`);
const dryRun = JSON.parse(execFileSync(process.execPath, [fetchScript, "--dry-run"], { encoding: "utf8" }));
assert.deepEqual(dryRun.tileIds, tileIdsForBbox(DEFAULT_BBOX));
assert.equal(dryRun.manifest, "data/raw/lod2/acquisition-manifest.json");
assert.equal(parseArgs(["--output-dir", "tmp/lod2"]).manifestPath, path.resolve(scriptDirectory, "..", "tmp/lod2/acquisition-manifest.json"));

process.stdout.write("Bavarian LoD2 fetch tests passed: projection, tile coverage, Metalink, manifest, cache, resume, and mirror retry.\n");
