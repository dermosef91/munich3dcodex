# Landmark manifest schema

`src/world/landmarks/manifest.json` is the reviewed asset ledger. Runtime TypeScript remains explicit; the validator checks that integrated entries agree with it.

## Top level

- `schemaVersion`: integer schema version, currently `1`.
- `assetRoot`: relative public texture directory, currently `assets/textures/landmarks`.
- `landmarks`: array of landmark records with unique `id`, root node, preview IDs, texture IDs, and replacement IDs.

## Landmark record

- `id`, `label`: stable slug and display name.
- `status`: `planned` or `integrated`. Planned records document queued work without requiring runtime files.
- `implementation.sourceFile`: repository-relative TypeScript file expected to contain the stable `implementation.rootNode` name.
- `shell.mode`:
  - `replace`: omit the listed streamed shells and provide custom structural geometry.
  - `preserve`: retain streamed geometry and add non-colliding overlays/details.
  - `none`: freestanding sight with no target building shell.
- `shell.targetBuildingIds`: all runtime buildings intentionally associated with the treatment.
- `shell.replacementBuildingIds`: exact IDs suppressed by `landmarkRegistry.ts`; allowed only for `replace`.
- `previews`: one or more URL preview records. Each has a unique `id`, three-value world `position` and `target`, and optional `fov` between `0.3` and `2.0`.
- `textures`: zero or more facade sheets. Each record contains:
  - `id`, `file`, and `status` (`planned` or `integrated`);
  - minimum pixel dimensions;
  - PBR `roughness` and `specularIntensity` in `0..1`;
  - `promptSummary`, which records the art direction without claiming it is the verbatim generation request.
- `references`: non-empty source list. Each reference records `url`, `publisher`, `usage`, and `license`. Use `reference-only` when imagery guided original art but contributed no pixels.
- `provenance`:
  - `method`: `original-art`, `procedural`, `licensed-photo`, or `mixed`;
  - `reviewStatus`: `prototype`, `needs-user-review`, or `approved`;
  - `pixelsEmbedded`: whether source-image pixels are in the delivered asset;
  - `note`: concise scope and rights statement.

## Validation rules

- Require every target building ID to exist exactly once in `public/data/tiles`.
- Require integrated `replace` entries to match the complete runtime replacement registry.
- Require `preserve` and `none` entries to have no replacement IDs.
- Require integrated textures to exist as PNG files, satisfy declared minimums, remain at or below 4096 px per dimension, and be referenced by the facade loader and implementation source.
- Require integrated root-node and preview IDs to appear in runtime source.
- Reject absolute paths, `..` traversal, duplicate IDs, missing provenance, invalid URLs, and non-finite coordinates.

## Example

```json
{
  "id": "example-landmark",
  "label": "Example Landmark",
  "status": "planned",
  "implementation": {
    "sourceFile": "src/world/LandmarkDetails.ts",
    "rootNode": "landmark-example-landmark"
  },
  "shell": {
    "mode": "replace",
    "targetBuildingIds": [123456],
    "replacementBuildingIds": [123456],
    "note": "Replace the OSM-only placeholder with reviewed silhouette geometry."
  },
  "previews": [
    {
      "id": "example-landmark",
      "position": [0, 4, 30],
      "target": [0, 8, 0],
      "fov": 1
    }
  ],
  "textures": [
    {
      "id": "example-landmark",
      "file": "example-landmark.png",
      "status": "planned",
      "minimumWidth": 1200,
      "minimumHeight": 800,
      "roughness": 0.85,
      "specularIntensity": 0.3,
      "promptSummary": "Rectified neutral-lit elevation with blank signage areas."
    }
  ],
  "references": [
    {
      "url": "https://example.org/reference",
      "publisher": "Example publisher",
      "usage": "reference-only",
      "license": "Copyrighted reference; no pixels embedded"
    }
  ],
  "provenance": {
    "method": "original-art",
    "reviewStatus": "needs-user-review",
    "pixelsEmbedded": false,
    "note": "Original facade art based on recorded architectural observations."
  }
}
```
