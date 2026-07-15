# Bavarian LoD2 ingestion

`scripts/convert_bavaria_lod2.py` is the first offline stage of the
reality-grounded building pipeline. It turns Bavarian Surveying Administration
CityGML into a stable, provenance-bearing intermediate representation. The
runtime merge then joins OSM identities, triangulates semantic surfaces, splits
them into streaming tiles and emits compact binary geometry sidecars.

The converter does not fetch source data. `scripts/fetch-bavaria-lod2.mjs`
derives the required 2 km cells, uses the official weekly Metalink, resumes
downloads and verifies size/SHA-256. Raw source archives remain outside
`public/`.

## Quick start

For the configured corridor, run the complete order-aware workflow:

```sh
pnpm data:all
```

To use the converter directly, Python 3.9 or newer and no third-party packages
are required:

```sh
python3 scripts/convert_bavaria_lod2.py /path/to/lod2-source.zip \
  --output data/normalized/lod2-schwabing.json \
  --bbox 11.560,48.150,11.580,48.166 \
  --vertical-origin 500 \
  --pretty
```

Multiple `.gml`, `.xml`, `.gz`, and `.zip` inputs can be passed in one run:

```sh
python3 scripts/convert_bavaria_lod2.py source-a.zip source-b.zip \
  --output data/normalized/lod2-corridor.json \
  --bbox 11.560,48.134,11.590,48.170 \
  --vertical-origin 500
```

Run `python3 scripts/convert_bavaria_lod2.py --help` for every option.

## Coordinate contract

Input geometry must use ETRS89 / UTM zone 32N (`EPSG:25832`) and DHHN2016
elevations, as supplied by the Bavarian LoD2 product.

Output coordinates match the browser prototype's `src/world/geo.ts` frame:

- X increases east.
- Y increases up.
- Z increases south.
- The default horizontal origin is longitude `11.572`, latitude `48.151`.
- Units are metres.

Horizontal coordinates are converted from UTM32 to geographic ETRS89 and then
passed through the same local projection used by `lonLatToWorld`. The converter
contains a standard-library GRS80 inverse Transverse Mercator implementation,
so `pyproj` is not required.

`--vertical-origin` is subtracted from every DHHN2016 elevation. Use one fixed
value for every building and terrain import in the project area. A value around
500 m keeps browser coordinates numerically compact in Munich, but the exact
project value should be chosen once when DGM terrain ingestion is added. The
original absolute ground and roof elevations remain in each building record.

## Spatial clipping

`--bbox` is always expressed as WGS84 `WEST,SOUTH,EAST,NORTH`. Clipping is
performed at building level: selected buildings retain their complete shells so
roof and wall topology is not cut at an arbitrary rectangle.

The available modes are:

- `intersects` (default): retain a building whose geographic bounds intersect
  the requested bbox.
- `centroid`: retain a building whose bounding-box centre lies inside it.
- `contained`: retain only buildings fully contained by it.

The output's `clip.semantics` field records this behaviour so a downstream tile
builder cannot mistake the selection for polygon clipping.

## Normalized JSON contract

The intermediate schema is versioned as
`munich3d-lod2-normalized-v1`. Its main structure is:

```json
{
  "schemaVersion": "munich3d-lod2-normalized-v1",
  "source": {
    "dataset": "Bavarian Surveying Administration LoD2",
    "license": "CC-BY-4.0",
    "files": [{ "file": "source.zip", "sha256": "...", "bytes": 123 }]
  },
  "coordinateSystem": {
    "sourceHorizontalCrs": "EPSG:25832",
    "sourceVerticalDatum": "DHHN2016",
    "outputAxes": { "x": "east", "y": "up", "z": "south" },
    "originWgs84": { "lon": 11.572, "lat": 48.151 },
    "verticalOriginDHHN2016": 500,
    "units": "meters"
  },
  "buildings": [
    {
      "id": "DEBY_LOD2_...",
      "provenance": {
        "sourceDocument": "source.zip!tile.gml",
        "sourceSha256": "...",
        "gmlId": "DEBY_LOD2_..."
      },
      "bbox": { "min": [0, 18, -20], "max": [20, 39, 0] },
      "height": 21,
      "groundElevationDHHN2016": 518,
      "roofElevationDHHN2016": 539,
      "surfaces": [
        {
          "id": "surface-id",
          "type": "roof",
          "polygons": [
            {
              "id": "polygon-id",
              "exterior": [[0, 39, 0], [20, 39, 0], [20, 39, -20]],
              "holes": []
            }
          ]
        }
      ]
    }
  ]
}
```

The converter preserves:

- Building, building-part, semantic-surface, and polygon GML identifiers.
- Wall, roof, ground, closure, outer-floor, and outer-ceiling semantics.
- Interior polygon rings.
- Common CityGML building metadata and generic attributes.
- Source archive hashes, document/member names, CRS, licence, and required
  attribution on every building.

Closing ring vertices are removed to make later triangulation deterministic.
Ring winding is otherwise preserved. Building records are sorted by source ID,
and duplicate building IDs across adjacent source archives are emitted once.

## Validation

A small CityGML fixture contains one in-bounds building and one out-of-bounds
building. The self-test verifies clipping, coordinate axes, vertical offset,
surface semantics, normalized rings, source IDs, and SHA-256 provenance:

```sh
python3 scripts/test_convert_bavaria_lod2.py
node scripts/test-fetch-bavaria-lod2.mjs
node scripts/test-lod2-binary.mjs
```

For a real source batch, also inspect the summary counters. In particular,
`invalidGeometry` should be zero. `unresolvedXlinks` means a document references
geometry externally; those references must be resolved before using the output.

## Deliberate boundaries

This stage does not triangulate, repair invalid topology, simplify meshes,
generate façade materials, or write runtime tiles. It also does not copy
CityGML appearance textures. Those are separate stages so provenance, geometry
repair, artistic façade rules, and browser compression remain independently
testable.

The downstream runtime stage currently:

1. Join LoD2 records to OSM or address data while retaining both identifiers.
2. Validate rings and triangulate semantic surfaces.
3. Apply deterministic procedural façade profiles plus explicit hero-building
   overrides.
4. Split by the existing 500 m runtime grid, keeping source IDs in JSON.
5. Pack geometry into versioned float32/uint16-or-uint32 sidecars and validate
   them before serving.

Sampling shared DGM terrain with the same vertical origin remains the next
authoritative geometry stage. Meshopt-compressed GLB remains a possible later
transport optimization.

Processed data must retain this attribution:

> Bayerische Vermessungsverwaltung - www.geodaten.bayern.de. Licensed under
> CC BY 4.0; modified for Munich3D.
