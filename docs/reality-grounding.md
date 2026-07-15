# Reality grounding at city scale

Munich3D uses a layered pipeline instead of trying to obtain a complete,
photorealistic city from one provider. Each layer has a different authority,
licence, update cycle, and runtime representation.

| Layer | Source of record | What it contributes | Browser representation |
| --- | --- | --- | --- |
| Building shells | Bavarian Surveying Administration LoD2 | Ground outlines, wall and roof surfaces, heights, roof form | Versioned binary geometry sidecars beside the existing 500 m runtime tiles |
| Streets and semantics | OpenStreetMap | Roads, paths, building use, levels, materials, colours, parks, water and source IDs | Compact JSON features in 500 m tiles |
| Parking | Munich Parkseiten plus OpenStreetMap | Curb-side lines/capacities, mapped spaces/lots and road-side tags | One linked slot/surface layout with non-colliding asphalt, continuous perimeter separation and pedestrian masks |
| Terrain | Bavarian Surveying Administration DGM1 (planned) | A shared 1 m ground-height reference | Clipped and simplified terrain tiles |
| Ordinary facades | Deterministic Munich facade system plus OSM business frontages | Plausible architectural-family priors, restrained colour variation and ground-floor use | Shared original upper/residential/retail/windowless PBR bundles plus per-building parameters |
| Hero buildings | Reviewed original art and custom meshes | Address-specific facade composition and distinctive details | Explicit registry override and reusable GLB/custom geometry |

The result is intentionally **reality-grounded**, not a claim of photographic
identity. Government LoD2 controls massing. OSM supplies open street and object
semantics. Procedural art fills information that neither dataset contains. A
small number of important buildings can then receive individually reviewed
overrides.

## Why this scales

The expensive operations happen offline:

1. Download only the government source tiles intersecting the project area.
2. Normalize CityGML into one stable, provenance-bearing coordinate contract.
3. Regenerate the OSM corridor and Munich Parkseiten extracts.
4. Match LoD2 buildings to OSM features and triangulate semantic surfaces.
5. Pack float32 positions/UVs and 16- or 32-bit indices into one validated
   sidecar per 500 m tile while keeping identities and provenance in JSON.
6. Derive facade families and material parameters from stable building IDs and
   available evidence.
7. Apply explicit hero-building overrides last.

The browser never downloads the 653 MB CityGML source set and never calls
Overpass. It streams the same 500 m tile grid already used by the prototype.
This also keeps geometry updates independent from facade art: a new source
extract can be processed without repainting every building by hand.

## Source provenance and licensing

### OpenStreetMap

- Source: OpenStreetMap nodes, ways and relations, queried offline through
  Overpass.
- Licence: ODbL 1.0.
- Required attribution: `© OpenStreetMap contributors`.
- Cached source: `data/cache/munich-overpass.json`.
- Processed output: `public/data/manifest.json` and
  `public/data/tiles/*.json`.

OSM remains authoritative for street/path semantics and useful building tags.
It is not treated as the preferred source for roof geometry where LoD2 is
available.

### Landeshauptstadt München Parkseiten

- Dataset: [Parkseiten](https://opendata.muenchen.de/dataset/opendata_ruhver_parkseiten_line),
  published by the Mobilitätsreferat.
- Licence: `dl-de/by-2-0` ([Datenlizenz Deutschland – Namensnennung – Version 2.0](https://www.govdata.de/dl-de/by-2-0)).
- Required attribution: `Landeshauptstadt München – opendata.muenchen.de`.
- Cached source: `data/cache/munich-parkseiten.geojson`.
- Processed output: optional `parkingRows` arrays in the existing 500 m tiles.

The WFS is requested offline in WGS84, then projected, clipped and modified for
Munich3D. Its lines, aggregate counts and regulations are source data. They are
the primary curb source in a canonical layout, supplemented by exact OSM
parking objects and road-side tags only outside municipal coverage. The same
linked layout supplies visible surfaces and ambient parked-car slots. The 2.4 m
parking-band width, asphalt treatment and narrow continuous perimeter are
inferred visualization, not surveyed stall polygons or paving observations.
Rendered sidewalk/crossing triangles mask parking overlap. Individual
bay-boundary marks are not rendered. Permanent 0–24 stopping bans, construction
records and records without positive capacity are not rendered as parking.

### Bavarian Surveying Administration LoD2

- Product page:
  <https://geodaten.bayern.de/opengeodata/OpenDataDetail.html?pn=lod2>
- Licence: CC BY 4.0.
- Required attribution:
  `Bayerische Vermessungsverwaltung – www.geodaten.bayern.de. Licensed under CC BY 4.0; modified for Munich3D.`
- Horizontal CRS: ETRS89 / UTM zone 32N (`EPSG:25832`).
- Vertical datum: DHHN2016.

Every normalized building retains the dataset name, source document, source
SHA-256, GML ID, CRS, licence, and attribution. Matched runtime buildings retain
both OSM and LoD2 source references; one identifier never silently replaces the
other.

Raw government files and normalized working files stay outside `public/`.
Only processed runtime output is served to players.

### Map and street-level imagery

Google Maps or Street View is not used as a bulk texture source. Do not scrape,
download, or bake map-imagery pixels into game assets. If a hosted imagery API
is used later, it should remain a separately licensed reference or QA view under
that provider's current terms, with export and caching reviewed independently.
The current Elisabethstraße 46 texture, four legacy ordinary-building sheets
and 13 layered Elisabethstraße-inspired modules are original synthetic art
derived from architectural observations and Munich style priors; no
map-imagery pixels are embedded.

## Reproducible corridor source set

`scripts/fetch-bavaria-lod2.mjs` projects the WGS84 corridor bounds into
EPSG:25832, derives the intersecting 2 km grid cells, and resolves them through
the official weekly Metalink. Downloads resume through `.part` files and are
accepted only after their published size and SHA-256 match.

| Field | Value |
| --- | --- |
| Source tiles | `690_5334`, `690_5336`, `690_5338`, `692_5334`, `692_5336`, `692_5338` |
| Official bytes | `652711622` |
| Acquisition record | `data/raw/lod2/acquisition-manifest.json` |
| WGS84 selection | west `11.560`, south `48.134`, east `11.590`, north `48.170` |
| Selection rule | Complete buildings intersecting the rectangle |
| Output | `data/normalized/lod2-munich-corridor.json` |
| Buildings | `12940` of `27043` source building objects |
| Semantic surfaces / polygons | `239758` / `239758` |
| Invalid geometry | `0` |
| Runtime | `10911` semantic buildings in 45 sidecars (`24956576` bytes) |

The source set is normalized with project origin longitude `11.572`,
latitude `48.151`, and a fixed DHHN2016 vertical origin of `500 m`. Output axes
match `src/world/geo.ts`: X east, Y up, Z south, in metres.

### Elisabethstraße 46 reviewed reference

The earlier `lod2-elisabethstrasse.json` subset remains a compact review and
regression artifact. Its hero-building identity is preserved inside the full
corridor merge:

| Field | Value |
| --- | --- |
| Address | Elisabethstraße 46, Munich |
| LoD2 GML ID | `DEBY_LOD2_4909212` |
| LoD2 external object ID | `DEBYvAAAAABSmoNk` |
| Matched OSM way ID | `108881086` |
| Measured height | `21.11 m` |
| Storeys above ground | `7` |
| Ground elevation | `512.700 m` DHHN2016 |
| Roof elevation | `533.810 m` DHHN2016 |
| Ground-surface area | `354.722 m²` |
| LoD2 roof type | code `1000` (mapped to `flat` by the runtime merge) |
| Semantic surfaces | `13` |
| Source creation date | `2018-11-16` |
| Footprint currency attribute | `2026-02-06` |

The runtime merge contains an explicit mapping from this LoD2 ID to the known
OSM way. It preserves the OSM numeric ID so the existing custom facade registry
and Schwabing detail assets remain attached to the correct building.

## Run the pipeline

The top-level command is deliberately order-aware because OSM regeneration
replaces the runtime tile JSON before LoD2 is merged back in:

```sh
pnpm data:all -- --refresh
```

It refreshes OSM/Parkseiten, conditionally refreshes the official Metalink,
downloads or verifies all six source tiles, normalizes the corridor, merges in
canonical tile order, writes binary sidecars and runs full data validation.
After one online run, the complete workflow can be reproduced without network:

```sh
pnpm data:all -- --offline
pnpm test:data-pipeline
pnpm build
```

`scripts/convert_bavaria_lod2.py` requires Python 3.9 or newer and only the
standard library. It accepts `.gml`, `.xml`, `.gz`, and `.zip` input and writes
the versioned `munich3d-lod2-normalized-v1` schema. See
`docs/lod2-ingestion.md` for its full coordinate and clipping contract.

## Merge rules

`scripts/merge-lod2-runtime.mjs` performs the second offline stage:

- Extract the largest LoD2 ground surface as the building outline.
- Use explicit reviewed ID mappings first.
- Otherwise compare centroid distance, bounding-box overlap, and footprint area
  to find a likely OSM match.
- Retain the OSM numeric ID for matched records and attach the LoD2 GML ID as a
  second source reference.
- Give unmatched accepted LoD2 buildings deterministic negative runtime IDs.
- Preserve complete semantic wall and roof surfaces, including polygon holes.
- Project arbitrary 3D rings onto a dominant plane and triangulate with Earcut.
- Express mesh Y relative to the building ground while retaining absolute
  DHHN2016 ground and roof elevations as metadata.
- Load candidate tiles in canonical order so identical inputs produce
  byte-identical joins and sidecars.
- Pack semantic geometry by building ID into a versioned `M3L2` sidecar for
  each 500 m tile. JSON keeps footprints, tags and provenance.
- Update tile building counts and the combined OSM/CC BY attribution manifest.

Very small unmatched objects and LoD2 objects close to an existing OSM object
are skipped to reduce duplicates. This is a pragmatic spatial join, not a
cadastral identity proof. Review match statistics and spot-check newly covered
areas before publishing.

## Deterministic facade system

`src/world/facadeSpecs.ts` turns a building ID and optional evidence into a
renderer-independent `FacadeSpec`. The same input always yields the same output,
so streamed tiles do not change style between loads and a rebuild does not
randomly repaint the city.

Evidence can include district, construction year, levels, roof levels, frontage
width, building use, wall material, roof shape, wall/roof colours, OSM tags, and
source metadata. Explicit attributes take priority. Missing values fall back to
one of seven Munich art-direction priors:

- `altstadt-plaster`
- `maxvorstadt-classicist`
- `schwabing-gruenderzeit`
- `schwabing-jugendstil`
- `interwar-reform`
- `postwar-functional`
- `contemporary-infill`

Each spec contains wall, roof, trim, frame and glazing colours; floors and floor
heights; bay and shopfront probabilities; window dimensions and lintel type;
roof shape and pitch; and a low/medium/high confidence record. It also records
the generator version (`munich-facade-spec-v1`), input source, and whether each
choice came from explicit attributes or a prior.

`src/world/photorealFacadeMaterials.ts` maps those seven families to nine
bounded, era-compatible material bundles. A stable building seed chooses one
bundle, and all four layers come from that same bundle:

- repeatable upper floors;
- a matching residential base; and
- a matching retail base; and
- a matching windowless material for walls, narrow faces and gable caps.

The runtime retains official AdV LoD2 function codes. Known wall, canopy and
garage codes bypass residential windows, with a conservative low-and-thin
geometry fallback for incomplete metadata. LoD2 wall triangles that cross a
detected eave are clipped so only the rectangular facade below receives the
windowed material; the sloped cap above uses the matching neutral material.

`BusinessFeature.frontage.buildingId` is the OSM-derived join used to choose the
retail base. The named storefront, sign, category colour and optional awning are
still generated separately, so business data can change without repainting an
entire facade sheet. Ordinary buildings receive a shallow ground-floor shell
over their footprint or LoD2 wall mesh; an 18 mm geometric offset plus a
ground-layer-only depth bias keeps that shell in front of the full-height facade
without changing collision geometry. Materials remain shared and tile geometry
is batched by bundle and layer.

These profiles are art direction, not observations about a specific address.
Confidence metadata should be exposed to future editing tools so low-confidence
buildings can be queued for review instead of silently presented as exact.

### Hero-building precedence

`src/world/facadeRegistry.ts` is the explicit final override layer. For OSM way
`108881086`, it applies the original Elisabethstraße 46 facade texture to the
reviewed front edge and records its provenance and review status. Custom
balconies, eave and plaque geometry are added separately in
`src/world/SchwabingDetails.ts`. Registered hero facades bypass both the generic
upper material and the generic ground-floor shell.

This precedence is deliberate:

```text
authoritative LoD2 shell
  + OSM semantics
  + deterministic facade prior
  + optional reviewed hero override
```

## Current limitations

- DGM1 terrain is not integrated yet. LoD2 absolute elevations are retained,
  but runtime placement still uses ground-relative building meshes.
- LoD2 contains massing and roof surfaces, not window, door, balcony, signage,
  shopfront, vegetation, or street-furniture detail.
- CityGML appearance textures are deliberately not copied. Ordinary buildings
  use shared original photographic-style sheets; address-specific identity
  still requires a separately licensed or original reviewed asset.
- The corridor source reports `464420` XLink references that the converter does
  not resolve into the solid graph. The corresponding direct semantic polygons
  are present and are what the current runtime merge consumes. A future GLB
  exporter should still validate shell closure independently.
- Spatial matching outside reviewed ID pairs can be ambiguous for courtyards,
  building parts, party walls, and closely packed footprints.
- Runtime semantic meshes use compact float32 binary arrays but are not yet
  meshopt-compressed. A future GLB/meshopt stage could reduce transfer size
  further while retaining the small JSON provenance contract.
- Procedural confidence measures evidence completeness; it does not measure
  visual similarity to the real facade.

## Expanding beyond the corridor

Extend the configured WGS84 bounds and let the acquisition script derive the
additional 2 km source cells. Keep the shared origin and `500 m` vertical
origin, add DGM1 in that same frame, and inspect the match report before
promoting new runtime tiles. The converter deduplicates repeated GML IDs when
adjacent inputs overlap.

For art production, spend manual effort according to visibility:

1. Procedural-only for background buildings.
2. Reviewed parameter overrides for common street-front buildings.
3. Original facade sheets and reusable balcony/shop assets for landmarks and
   spawn areas.
4. Fully custom GLB only where silhouette or gameplay requires it.

That keeps source truth, licensing, runtime performance, and artistic effort
separable as Munich coverage grows.
