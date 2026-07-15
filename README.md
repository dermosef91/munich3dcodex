# Munich 3D browser prototype

A browser-first, walkable and driveable 3D map covering a corridor from Munich
Center through Maxvorstadt to Schwabing. OpenStreetMap supplies streets, mapped
trees, street furniture, parking-area and business semantics; Munich's official
Parkseiten layer supplies curb-parking runs and reported capacities; official
Bavarian LoD2 data supplies authoritative building massing across the complete
Center–Maxvorstadt–Schwabing corridor.

## Run locally

```bash
pnpm install
pnpm data:all
pnpm dev
```

The first `data:all` run acquires six hash-verified official LoD2 source tiles
(about 653 MB). Later runs reuse them. Use `pnpm data:all -- --refresh` to
refresh OSM and Parkseiten as well, or `pnpm data:all -- --offline` to require
only verified local caches.

Open the local URL and choose **Enter world**.

- On foot: use WASD and the mouse, hold Shift to sprint, press Space to jump,
  and press Escape to release the pointer. Press G to toggle helicopter-style
  flight; while flying, hold Space to climb and Ctrl to descend.
- To drive: walk beside a parked car and press E. Use W/S for throttle, braking
  and reverse, A/D to steer, Space for the handbrake, and E to exit after
  slowing below 5 km/h. Steering and grip respond progressively to speed, the
  forward cap is 120 km/h, the arrow keys also work, and sidewalks do not
  impose an invisible vehicle barrier.

`data:all` enforces the required OSM → LoD2 normalization → merge → binary
packing → validation order. Prefer it over invoking the individual stages.

## Production build

```bash
pnpm build
pnpm preview
```

## Reality pipeline

- OSM streets, mapped tram/light-rail alignments, paths, land cover, buildings
  (including reconstructed multipolygon courtyards),
  individual trees, inferred placements along mapped tree rows and reviewed
  street corridors, street lamps, benches, parking and named businesses are
  processed offline into 500 m streaming tiles.
- OSM sidewalk and crossing semantics drive joined, raised paving with visible
  curbs and lowered crossing mouths; the apron width and height profile are
  inferred visual geometry rather than surveyed curb measurements.
- Munich's municipal Parkseiten lines, mapped OSM parking spaces/lots and OSM
  curb-side tags feed one canonical parking layout. The same linked surfaces
  and slots drive both rendering and parked-car placement.
- Named OSM shops, restaurants and other supported ground-floor businesses are
  matched to building edges and rendered as generated storefronts and signs.
  Their names and categories come from OSM; the shopfront geometry is an
  inferred visual treatment, not surveyed facade geometry.
- Mapped, tree-row-inferred, and reviewed street-corridor trees use self-made,
  texture-free low-poly geometry with hardware instancing. Parked and moving
  vehicles use the supplied GLB car collection.
- Six official Bavarian LoD2 tiles contribute 12,940 selected buildings and
  239,758 semantic surfaces. The deterministic runtime merge matches 8,388 to
  OSM, adds 2,524 missing objects, and emits wall/roof geometry for 10,911
  buildings across all 45 runtime tiles.
- Seven deterministic Munich facade families select nine era-compatible
  photographic PBR bundles from stable building IDs. Each bundle keeps its
  upper floors, residential base, retail base and windowless neutral material
  visually matched; OSM business frontages switch only the affected building
  to the retail base. LoD2 wall semantics and gable geometry keep windows off
  boundary walls, narrow remnants and roof caps.
- Elisabethstraße 46 keeps its OSM identity while using the official LoD2
  footprint, height and provenance plus a reviewed custom facade and details.
- Hofbräuhaus, Asamkirche, Alte Pinakothek, Museum Brandhorst and the
  Bayerische Staatsbibliothek retain their official LoD2 walls, roofs and
  collision geometry while thin, non-colliding procedural elevation sheets
  restore their landmark-specific facade rhythm and materials.
- Parked-car occupancy and moving traffic are deterministic simulations grounded
  in open parking and road data. Ambient parked cars can spawn only on slots in
  the same canonical layout rendered beneath them; a player car left elsewhere
  is treated as stopped, not parked. Parking surfaces reuse the existing
  cobblestone material and a narrow continuous curb-coloured edge distinguishes
  them from streets and sidewalks. Sidewalk and crossing geometry masks the
  parking surface, and no individual bay demarcations are rendered. Municipal
  2.4 m bands remain inferred geometry, not surveyed bay polygons, live
  occupancy, observed traffic or exact real-world vehicle positions.
- Tram vehicles use OSM `railway=tram` and `railway=light_rail` geometry from
  the processed map extract, render rails and overhead line, and travel along
  those mapped alignments. The blue articulated vehicle is an MVG-style
  procedural representation, not a surveyed scheduled departure.
- Raw CityGML stays outside the browser. Semantic meshes are packed into
  versioned per-tile binary sidecars; JSON retains features, identities and
  provenance.

## Browser architecture

- TypeScript, Vite and Babylon.js, with WebGL 2 as the compatibility baseline
- Fixed Munich origin and a right-handed local metre frame (X east, Z south)
- 500 m tiles loaded around the player with unload hysteresis
- Validated float32 LoD2 sidecars with footprint-only degradation if an
  optional binary is unavailable
- Merged tile meshes, collisions, gravity, keyboard movement and jumping
- Batched OSM street furniture, hardware-instanced trees and generated storefronts
- Adaptive render resolution with a tree-shadow fallback when frame time remains constrained
- Progressive startup that makes the nearest streamed world playable before dynamically imported vehicles and detail assets finish
- Distance-aware ambient traffic that preserves nearby behaviour without scanning far-away cars for collisions every frame
- Hysteretic storefront detail LOD that keeps nearby streets rich while far blocks stay cheap to render
- Enterable parked cars, chase-camera driving and deterministic ambient traffic
- Georeferenced GLB custom assets placed by longitude and latitude
- Procedural fallback when generated map files are unavailable

See [DATA_SOURCES.md](DATA_SOURCES.md) for source attribution and regeneration
notes, [docs/reality-grounding.md](docs/reality-grounding.md) for the complete
pipeline, and [public/assets/custom/README.md](public/assets/custom/README.md)
for custom-asset instructions.
