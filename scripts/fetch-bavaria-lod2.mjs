#!/usr/bin/env node

/**
 * Acquire the official Bavarian LoD2 CityGML tiles needed by Munich3D.
 *
 * The Bavarian Surveying Administration publishes a weekly Metalink whose
 * entries carry the authoritative byte size, SHA-256 digest, and two download
 * mirrors for every 2 km EPSG:25832 tile. This script deliberately derives the
 * tile names locally, then resolves them through that Metalink before fetching
 * any large files.
 *
 * Product: https://geodaten.bayern.de/opengeodata/OpenDataDetail.html?pn=lod2
 * Metalink: https://geodaten.bayern.de/odd/a/lod2/citygml/meta/metalink/09.meta4
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  truncate,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");

export const DEFAULT_BBOX = Object.freeze({
  west: 11.560,
  south: 48.134,
  east: 11.590,
  north: 48.170,
});
export const TILE_SIZE_METERS = 2_000;
export const DEFAULT_OUTPUT_DIRECTORY = path.join(root, "data", "raw", "lod2");
export const DEFAULT_MANIFEST_NAME = "acquisition-manifest.json";
export const DEFAULT_METALINK_CACHE_NAME = "09.meta4";
export const DEFAULT_METALINK_URL =
  "https://geodaten.bayern.de/odd/a/lod2/citygml/meta/metalink/09.meta4";
export const PRODUCT_PAGE =
  "https://geodaten.bayern.de/opengeodata/OpenDataDetail.html?pn=lod2";

const MANIFEST_SCHEMA = "munich3d-bavaria-lod2-acquisition-v1";
const PLAN_SCHEMA = "munich3d-bavaria-lod2-plan-v1";
const HTTP_METADATA_SUFFIX = ".http.json";
const DEFAULT_RETRIES = 4;
const DEFAULT_CONCURRENCY = 2;
// Dense Munich tiles currently reach roughly 160 MB, so this is a whole-body
// timeout rather than a short connection timeout. Interrupted bodies retain
// their .part file and the next attempt resumes with an HTTP Range request.
const DEFAULT_TIMEOUT_MS = 900_000;
const PROJECTION_EDGE_SAMPLES = 32;
const PROJECTION_SAFETY_METERS = 0.5;

function finiteNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a finite number`);
  return parsed;
}

export function parseBbox(value) {
  const parts = Array.isArray(value) ? value : String(value).split(",");
  if (parts.length !== 4) throw new Error("bbox must be WEST,SOUTH,EAST,NORTH");
  const [west, south, east, north] = parts.map((part, index) =>
    finiteNumber(String(part).trim(), `bbox component ${index + 1}`));
  if (!(-180 <= west && west < east && east <= 180 && -90 <= south && south < north && north <= 90)) {
    throw new Error("bbox is not a valid WGS84 rectangle");
  }
  return { west, south, east, north };
}

/** Forward Transverse Mercator for ETRS89 / UTM zone 32N (EPSG:25832). */
export function wgs84ToUtm32(lonDegrees, latDegrees) {
  const lon = finiteNumber(lonDegrees, "longitude");
  const lat = finiteNumber(latDegrees, "latitude");
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    throw new Error("coordinate is outside WGS84 bounds");
  }

  // ETRS89 uses GRS80. At Munich scale it is effectively aligned with WGS84.
  const semiMajor = 6_378_137.0;
  const eccentricitySquared = 0.006_694_380_022_90;
  const eccentricityPrimeSquared = eccentricitySquared / (1 - eccentricitySquared);
  const scale = 0.9996;
  const centralMeridian = 9 * Math.PI / 180;
  const latitude = lat * Math.PI / 180;
  const longitude = lon * Math.PI / 180;
  const sinLatitude = Math.sin(latitude);
  const cosLatitude = Math.cos(latitude);
  const tanLatitude = Math.tan(latitude);
  const radius = semiMajor / Math.sqrt(1 - eccentricitySquared * sinLatitude ** 2);
  const tangentSquared = tanLatitude ** 2;
  const c = eccentricityPrimeSquared * cosLatitude ** 2;
  const a = cosLatitude * (longitude - centralMeridian);
  const e4 = eccentricitySquared ** 2;
  const e6 = eccentricitySquared ** 3;
  const meridionalArc = semiMajor * (
    (1 - eccentricitySquared / 4 - 3 * e4 / 64 - 5 * e6 / 256) * latitude
    - (3 * eccentricitySquared / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * latitude)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * latitude)
    - (35 * e6 / 3072) * Math.sin(6 * latitude)
  );

  const easting = 500_000 + scale * radius * (
    a
    + (1 - tangentSquared + c) * a ** 3 / 6
    + (5 - 18 * tangentSquared + tangentSquared ** 2 + 72 * c - 58 * eccentricityPrimeSquared)
      * a ** 5 / 120
  );
  const northing = scale * (
    meridionalArc
    + radius * tanLatitude * (
      a ** 2 / 2
      + (5 - tangentSquared + 9 * c + 4 * c ** 2) * a ** 4 / 24
      + (61 - 58 * tangentSquared + tangentSquared ** 2 + 600 * c - 330 * eccentricityPrimeSquared)
        * a ** 6 / 720
    )
  );
  return { easting, northing };
}

function projectedBbox(bbox) {
  const points = [];
  for (let index = 0; index <= PROJECTION_EDGE_SAMPLES; index += 1) {
    const ratio = index / PROJECTION_EDGE_SAMPLES;
    const lon = bbox.west + (bbox.east - bbox.west) * ratio;
    const lat = bbox.south + (bbox.north - bbox.south) * ratio;
    points.push(wgs84ToUtm32(lon, bbox.south));
    points.push(wgs84ToUtm32(lon, bbox.north));
    points.push(wgs84ToUtm32(bbox.west, lat));
    points.push(wgs84ToUtm32(bbox.east, lat));
  }
  return {
    minEasting: Math.min(...points.map((point) => point.easting)) - PROJECTION_SAFETY_METERS,
    maxEasting: Math.max(...points.map((point) => point.easting)) + PROJECTION_SAFETY_METERS,
    minNorthing: Math.min(...points.map((point) => point.northing)) - PROJECTION_SAFETY_METERS,
    maxNorthing: Math.max(...points.map((point) => point.northing)) + PROJECTION_SAFETY_METERS,
  };
}

function firstTileOrigin(coordinate) {
  return Math.floor(coordinate / TILE_SIZE_METERS) * TILE_SIZE_METERS;
}

function lastTileOrigin(coordinate) {
  return (Math.ceil(coordinate / TILE_SIZE_METERS) - 1) * TILE_SIZE_METERS;
}

export function tileIdsForBbox(value) {
  const bbox = parseBbox([
    value.west,
    value.south,
    value.east,
    value.north,
  ]);
  const projected = projectedBbox(bbox);
  const firstEasting = firstTileOrigin(projected.minEasting);
  const lastEasting = lastTileOrigin(projected.maxEasting);
  const firstNorthing = firstTileOrigin(projected.minNorthing);
  const lastNorthing = lastTileOrigin(projected.maxNorthing);
  const ids = [];
  for (let easting = firstEasting; easting <= lastEasting; easting += TILE_SIZE_METERS) {
    for (let northing = firstNorthing; northing <= lastNorthing; northing += TILE_SIZE_METERS) {
      ids.push(`${Math.round(easting / 1_000)}_${Math.round(northing / 1_000)}`);
    }
  }
  return ids.sort();
}

function decodeXml(value) {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|amp|lt|gt|quot|apos);/gi,
    (entity, decimal, hexadecimal) => {
      if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
      if (hexadecimal) return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
      return {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": "\"",
        "&apos;": "'",
      }[entity.toLowerCase()];
    },
  );
}

export function parseMetalink(xml) {
  const source = String(xml);
  const publishedMatch = source.match(/<published>\s*([^<]+?)\s*<\/published>/i);
  const entries = new Map();
  const filePattern = /<file\b[^>]*\bname=(['"])(.*?)\1[^>]*>([\s\S]*?)<\/file>/gi;
  for (const match of source.matchAll(filePattern)) {
    const file = decodeXml(match[2]);
    if (!/^\d{3}_\d{4}\.gml$/.test(file)) continue;
    const body = match[3];
    const sizeMatch = body.match(/<size>\s*(\d+)\s*<\/size>/i);
    const hashMatch = body.match(
      /<hash\b[^>]*\btype=(['"])(?:sha-?256)\1[^>]*>\s*([\da-f]{64})\s*<\/hash>/i,
    );
    const urls = [...body.matchAll(/<url\b[^>]*>\s*([^<]+?)\s*<\/url>/gi)]
      .map((urlMatch) => decodeXml(urlMatch[1]));
    if (!sizeMatch || !hashMatch || urls.length === 0) {
      throw new Error(`Metalink entry ${file} lacks size, SHA-256, or URL metadata`);
    }
    const bytes = Number.parseInt(sizeMatch[1], 10);
    if (!Number.isSafeInteger(bytes) || bytes <= 0) {
      throw new Error(`Metalink entry ${file} has an invalid size`);
    }
    for (const url of urls) {
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error(`Metalink entry ${file} has an unsafe URL`);
    }
    const entry = {
      tileId: file.slice(0, -4),
      file,
      bytes,
      sha256: hashMatch[2].toLowerCase(),
      urls: [...new Set(urls)],
    };
    if (entries.has(file)) throw new Error(`Metalink contains duplicate entry ${file}`);
    entries.set(file, entry);
  }
  if (entries.size === 0) throw new Error("Metalink contains no LoD2 CityGML tile entries");
  return {
    published: publishedMatch ? decodeXml(publishedMatch[1]) : null,
    entries,
  };
}

export function selectMetalinkTiles(metalink, tileIds) {
  return [...tileIds].sort().map((tileId) => {
    const file = `${tileId}.gml`;
    const entry = metalink.entries.get(file);
    if (!entry) throw new Error(`Official Metalink does not contain required tile ${file}`);
    return entry;
  });
}

function posixRelative(from, to) {
  const relative = path.relative(from, to) || path.basename(to);
  return relative.split(path.sep).join("/");
}

export function buildAcquisitionManifest({
  bbox,
  entries,
  metalinkPublished,
  metalinkUrl = DEFAULT_METALINK_URL,
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
  manifestPath = path.join(outputDirectory, DEFAULT_MANIFEST_NAME),
}) {
  const manifestDirectory = path.dirname(manifestPath);
  const tiles = [...entries]
    .sort((left, right) => left.tileId.localeCompare(right.tileId))
    .map((entry) => ({
      tileId: entry.tileId,
      localPath: posixRelative(manifestDirectory, path.join(outputDirectory, entry.file)),
      url: entry.urls[0],
      mirrors: [...entry.urls],
      sha256: entry.sha256,
      bytes: entry.bytes,
    }));
  return {
    schemaVersion: MANIFEST_SCHEMA,
    dataset: {
      name: "Bavarian Surveying Administration LoD2",
      productPage: PRODUCT_PAGE,
      license: "CC-BY-4.0",
      horizontalCrs: "EPSG:25832",
      format: "CityGML",
      tileSizeMeters: TILE_SIZE_METERS,
    },
    request: {
      bboxWgs84: [bbox.west, bbox.south, bbox.east, bbox.north],
      tileIds: tiles.map((tile) => tile.tileId),
    },
    metalink: {
      url: metalinkUrl,
      published: metalinkPublished,
    },
    tiles,
  };
}

async function pathStat(file) {
  try {
    return await stat(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifyFile(file, entry) {
  const details = await pathStat(file);
  if (!details?.isFile()) return { ok: false, reason: "missing", bytes: 0 };
  if (details.size !== entry.bytes) {
    return { ok: false, reason: "size", bytes: details.size };
  }
  const sha256 = await sha256File(file);
  return {
    ok: sha256 === entry.sha256,
    reason: sha256 === entry.sha256 ? null : "sha256",
    bytes: details.size,
    sha256,
  };
}

async function writeAtomic(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(temporary, data);
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

function delay(milliseconds) {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`request timed out after ${timeoutMs} ms`)), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    return { response, cancelTimeout: () => clearTimeout(timer) };
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

async function readJsonIfPresent(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function loadMetalink({
  metalinkFile,
  metalinkUrl = DEFAULT_METALINK_URL,
  cachePath = path.join(DEFAULT_OUTPUT_DIRECTORY, DEFAULT_METALINK_CACHE_NAME),
  offline = false,
  retries = DEFAULT_RETRIES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDelayMs = 500,
  fetchImpl = globalThis.fetch,
  onLog = () => {},
} = {}) {
  if (metalinkFile) {
    const xml = await readFile(metalinkFile, "utf8");
    parseMetalink(xml);
    return { xml, source: path.resolve(metalinkFile), fromCache: true };
  }
  if (offline) {
    const xml = await readFile(cachePath, "utf8").catch((error) => {
      if (error?.code === "ENOENT") {
        throw new Error(`offline mode requires cached Metalink ${cachePath}`);
      }
      throw error;
    });
    parseMetalink(xml);
    return { xml, source: metalinkUrl, fromCache: true };
  }
  if (typeof fetchImpl !== "function") throw new Error("this Node.js runtime does not provide fetch()");

  const cached = await pathStat(cachePath);
  const metadataPath = `${cachePath}${HTTP_METADATA_SUFFIX}`;
  const cachedMetadata = await readJsonIfPresent(metadataPath);
  const headers = { Accept: "application/metalink4+xml, application/xml;q=0.9, text/xml;q=0.8" };
  if (cached) {
    if (cachedMetadata?.etag) headers["If-None-Match"] = cachedMetadata.etag;
    if (cachedMetadata?.lastModified) headers["If-Modified-Since"] = cachedMetadata.lastModified;
    else headers["If-Modified-Since"] = cached.mtime.toUTCString();
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let cancelTimeout = () => {};
    try {
      const request = await fetchWithTimeout(fetchImpl, metalinkUrl, { headers }, timeoutMs);
      const { response } = request;
      cancelTimeout = request.cancelTimeout;
      if (response.status === 304 && cached) {
        const xml = await readFile(cachePath, "utf8");
        parseMetalink(xml);
        onLog(`Metalink unchanged; using ${cachePath}`);
        return { xml, source: metalinkUrl, fromCache: true };
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const xml = await response.text();
      parseMetalink(xml);
      const httpMetadata = {
        url: metalinkUrl,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
      };
      await writeAtomic(cachePath, xml);
      await writeAtomic(metadataPath, `${JSON.stringify(httpMetadata, null, 2)}\n`);
      onLog(`Updated Metalink cache ${cachePath}`);
      return { xml, source: metalinkUrl, fromCache: false };
    } catch (error) {
      lastError = error;
      if (attempt < retries) await delay(retryDelayMs * 2 ** Math.min(attempt, 4));
    } finally {
      cancelTimeout();
    }
  }

  if (cached) {
    const xml = await readFile(cachePath, "utf8");
    parseMetalink(xml);
    onLog(`Warning: Metalink refresh failed (${lastError.message}); using cached ${cachePath}`);
    return { xml, source: metalinkUrl, fromCache: true };
  }
  throw new Error(`could not fetch official Metalink: ${lastError?.message ?? "unknown error"}`);
}

async function partOffset(partPath, entry) {
  const details = await pathStat(partPath);
  if (!details) return 0;
  if (!details.isFile() || details.size > entry.bytes) {
    await truncate(partPath, 0);
    return 0;
  }
  if (details.size === entry.bytes) {
    const verification = await verifyFile(partPath, entry);
    if (verification.ok) return details.size;
    await truncate(partPath, 0);
    return 0;
  }
  return details.size;
}

async function writeResponseBody(response, partPath, append) {
  if (!response.body) throw new Error("download response has no body");
  const handle = await open(partPath, append ? "a" : "w");
  try {
    for await (const chunk of response.body) await handle.write(chunk);
  } finally {
    await handle.close();
  }
}

export async function downloadTile(entry, {
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
  retries = DEFAULT_RETRIES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDelayMs = 500,
  fetchImpl = globalThis.fetch,
  onLog = () => {},
} = {}) {
  if (!/^\d{3}_\d{4}\.gml$/.test(entry.file)) throw new Error(`unsafe tile filename ${entry.file}`);
  if (typeof fetchImpl !== "function") throw new Error("this Node.js runtime does not provide fetch()");
  await mkdir(outputDirectory, { recursive: true });
  const destination = path.join(outputDirectory, entry.file);
  const partPath = `${destination}.part`;
  const existing = await verifyFile(destination, entry);
  if (existing.ok) {
    onLog(`Cached ${entry.file} (${entry.bytes} bytes)`);
    return { tileId: entry.tileId, status: "cached", destination };
  }

  let offset = await partOffset(partPath, entry);
  if (offset === entry.bytes) {
    await rename(partPath, destination);
    onLog(`Recovered complete ${entry.file} from partial download`);
    return { tileId: entry.tileId, status: "resumed", destination };
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const url = entry.urls[attempt % entry.urls.length];
    let cancelTimeout = () => {};
    try {
      offset = await partOffset(partPath, entry);
      const headers = {
        Accept: "application/octet-stream, application/xml;q=0.9, */*;q=0.1",
        "Accept-Encoding": "identity",
      };
      if (offset > 0) headers.Range = `bytes=${offset}-`;
      onLog(`${offset > 0 ? `Resuming ${entry.file} at byte ${offset}` : `Downloading ${entry.file}`} from ${url}`);
      const request = await fetchWithTimeout(fetchImpl, url, { headers }, timeoutMs);
      const { response } = request;
      cancelTimeout = request.cancelTimeout;
      if (response.status === 416 && offset > 0) {
        await truncate(partPath, 0);
        throw new Error("server rejected the saved byte range; partial file reset");
      }
      if (response.status !== 200 && response.status !== 206) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      let append = false;
      if (response.status === 206) {
        const contentRange = response.headers.get("content-range");
        const rangeMatch = contentRange?.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
        if (!rangeMatch || Number.parseInt(rangeMatch[1], 10) !== offset) {
          await truncate(partPath, 0).catch(() => {});
          throw new Error(`invalid Content-Range ${contentRange ?? "(missing)"}`);
        }
        append = offset > 0;
      } else if (offset > 0) {
        onLog(`${entry.file}: mirror ignored Range; restarting from byte 0`);
      }
      await writeResponseBody(response, partPath, append);

      const verification = await verifyFile(partPath, entry);
      if (!verification.ok) {
        if (verification.bytes >= entry.bytes || verification.reason === "sha256") {
          await truncate(partPath, 0);
        }
        throw new Error(
          verification.reason === "size"
            ? `incomplete download (${verification.bytes}/${entry.bytes} bytes)`
            : `SHA-256 mismatch for ${entry.file}`,
        );
      }
      await rename(partPath, destination);
      onLog(`Verified ${entry.file} (${entry.sha256})`);
      return {
        tileId: entry.tileId,
        status: offset > 0 ? "resumed" : "downloaded",
        destination,
      };
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        onLog(`${entry.file}: attempt ${attempt + 1} failed (${error.message}); retrying`);
        await delay(retryDelayMs * 2 ** Math.min(attempt, 4));
      }
    } finally {
      cancelTimeout();
    }
  }
  throw new Error(`${entry.file} failed after ${retries + 1} attempts: ${lastError?.message ?? "unknown error"}`);
}

export async function verifyOfflineTiles(entries, outputDirectory = DEFAULT_OUTPUT_DIRECTORY) {
  const failures = [];
  for (const entry of entries) {
    const file = path.join(outputDirectory, entry.file);
    const verification = await verifyFile(file, entry);
    if (!verification.ok) failures.push(`${entry.file} (${verification.reason})`);
  }
  if (failures.length > 0) {
    throw new Error(`offline mode requires verified cached LoD2 tiles: ${failures.join(", ")}`);
  }
  return entries.map((entry) => ({
    tileId: entry.tileId,
    status: "cached",
    destination: path.join(outputDirectory, entry.file),
  }));
}

async function mapConcurrent(items, concurrency, operation) {
  const results = new Array(items.length);
  const failures = [];
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await operation(items[index], index);
      } catch (error) {
        failures.push({ index, error });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  if (failures.length > 0) {
    failures.sort((left, right) => left.index - right.index);
    throw new Error(failures.map(({ error }) => error.message).join("\n"));
  }
  return results;
}

function parseIntegerOption(value, flag, { minimum, maximum }) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${flag} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function resolveOptionPath(value) {
  return path.resolve(root, value);
}

export function parseArgs(argv) {
  const options = {
    bbox: { ...DEFAULT_BBOX },
    outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
    manifestPath: null,
    metalinkCachePath: null,
    metalinkFile: null,
    metalinkUrl: DEFAULT_METALINK_URL,
    offline: false,
    list: false,
    dryRun: false,
    retries: DEFAULT_RETRIES,
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${argument} requires a value`);
      return argv[index];
    };
    switch (argument) {
      case "--bbox": options.bbox = parseBbox(next()); break;
      case "--output-dir": options.outputDirectory = resolveOptionPath(next()); break;
      case "--manifest": options.manifestPath = resolveOptionPath(next()); break;
      case "--metalink-cache": options.metalinkCachePath = resolveOptionPath(next()); break;
      case "--metalink-file": options.metalinkFile = resolveOptionPath(next()); break;
      case "--metalink-url": options.metalinkUrl = next(); break;
      case "--offline": options.offline = true; break;
      case "--list": options.list = true; break;
      case "--dry-run": options.dryRun = true; break;
      case "--retries":
        options.retries = parseIntegerOption(next(), argument, { minimum: 0, maximum: 20 });
        break;
      case "--concurrency":
        options.concurrency = parseIntegerOption(next(), argument, { minimum: 1, maximum: 8 });
        break;
      case "--timeout-ms":
        options.timeoutMs = parseIntegerOption(next(), argument, { minimum: 1_000, maximum: 3_600_000 });
        break;
      case "--help":
      case "-h": options.help = true; break;
      default: throw new Error(`unknown option ${argument}`);
    }
  }
  if (options.list && options.dryRun) throw new Error("--list and --dry-run are mutually exclusive");
  options.manifestPath ??= path.join(options.outputDirectory, DEFAULT_MANIFEST_NAME);
  options.metalinkCachePath ??= path.join(options.outputDirectory, DEFAULT_METALINK_CACHE_NAME);
  return options;
}

function printablePath(file) {
  const relative = path.relative(root, file);
  return relative && !relative.startsWith("..") ? relative : file;
}

function planFor(options, tileIds) {
  return {
    schemaVersion: PLAN_SCHEMA,
    bboxWgs84: [options.bbox.west, options.bbox.south, options.bbox.east, options.bbox.north],
    horizontalCrs: "EPSG:25832",
    tileSizeMeters: TILE_SIZE_METERS,
    tileIds,
    outputDirectory: printablePath(options.outputDirectory),
    manifest: printablePath(options.manifestPath),
    metalinkCache: printablePath(options.metalinkCachePath),
  };
}

function usage() {
  return `Usage: node scripts/fetch-bavaria-lod2.mjs [options]

Acquire the official 2 km Bavarian LoD2 CityGML tiles intersecting Munich3D.

Options:
  --bbox WEST,SOUTH,EAST,NORTH  WGS84 bounds (default: 11.560,48.134,11.590,48.170)
  --list                       Print required tile IDs; no network or writes
  --dry-run                    Print a JSON acquisition plan; no network or writes
  --output-dir PATH            Raw tile directory (default: data/raw/lod2)
  --manifest PATH              Deterministic output manifest path
  --metalink-cache PATH        Cached official Metalink (default: <output-dir>/09.meta4)
  --metalink-file PATH         Read a local Metalink instead of requesting one
  --metalink-url URL           Override the official Metalink endpoint
  --offline                    Require and use the cached Metalink; no network
  --retries N                  Retries after the first request (default: ${DEFAULT_RETRIES})
  --concurrency N              Concurrent tile downloads, 1-8 (default: ${DEFAULT_CONCURRENCY})
  --timeout-ms N               Per-request timeout (default: ${DEFAULT_TIMEOUT_MS})
  -h, --help                   Show this help
`;
}

export async function run(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return null;
  }
  const tileIds = tileIdsForBbox(options.bbox);
  if (options.list) {
    process.stdout.write(`${tileIds.join("\n")}\n`);
    return tileIds;
  }
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(planFor(options, tileIds), null, 2)}\n`);
    return tileIds;
  }

  const onLog = dependencies.onLog ?? ((message) => process.stderr.write(`${message}\n`));
  const loaded = await loadMetalink({
    metalinkFile: options.metalinkFile,
    metalinkUrl: options.metalinkUrl,
    cachePath: options.metalinkCachePath,
    offline: options.offline,
    retries: options.retries,
    timeoutMs: options.timeoutMs,
    fetchImpl: dependencies.fetchImpl ?? globalThis.fetch,
    onLog,
  });
  const metalink = parseMetalink(loaded.xml);
  const entries = selectMetalinkTiles(metalink, tileIds);
  onLog(`Required LoD2 tiles: ${tileIds.join(", ")}`);
  if (options.offline) {
    await verifyOfflineTiles(entries, options.outputDirectory);
    onLog(`Verified ${entries.length} cached LoD2 tiles without network access`);
  } else {
    await mapConcurrent(entries, options.concurrency, (entry) => downloadTile(entry, {
      outputDirectory: options.outputDirectory,
      retries: options.retries,
      timeoutMs: options.timeoutMs,
      fetchImpl: dependencies.fetchImpl ?? globalThis.fetch,
      onLog,
    }));
  }

  const manifest = buildAcquisitionManifest({
    bbox: options.bbox,
    entries,
    metalinkPublished: metalink.published,
    metalinkUrl: options.metalinkUrl,
    outputDirectory: options.outputDirectory,
    manifestPath: options.manifestPath,
  });
  await writeAtomic(options.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  onLog(`Wrote deterministic acquisition manifest ${options.manifestPath}`);
  return manifest;
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  run().catch((error) => {
    process.stderr.write(`LoD2 acquisition failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
