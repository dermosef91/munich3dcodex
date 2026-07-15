# Munich 3D data sources

Munich3D combines authoritative geometry, open map semantics, deterministic art
direction, and individually reviewed hero assets. The browser receives only
processed 500 m runtime tiles under `public/data/tiles`.

## OpenStreetMap semantics

- Source: OpenStreetMap nodes, ways and relations through the Overpass API
- Corridor bounds: `11.560,48.134,11.590,48.170` (WGS84)
- Content: building tags; streets and paths; selected land cover and water;
  individual trees and tree-row ways; street lamps; benches; parking areas and
  curb-parking tags; and supported named shops, hospitality venues and services
- Raw cache: `data/cache/munich-overpass.json`
- Licence: ODbL 1.0
- Attribution: © OpenStreetMap contributors

OSM remains the source for street/path semantics, useful building attributes and
the mapped object and business locations listed above. Overpass is queried
offline, never by the browser. The checked-in runtime manifest currently contains
6,272 trees (5,159 mapped points, 1,086 tree-row inferences and 27 reviewed
street-corridor inferences), 619 street lamps, 1,387 benches, 525 parking
features and 3,740 business POIs across 45 tiles; those counts change when the
extract is refreshed.

## OSM-derived environment and storefronts

- Tree nodes retain their OSM position and, when available, height, crown
  diameter, species, genus and leaf type. The renderer chooses scale and visual
  variation deterministically from those attributes and the stable OSM ID.
- `natural=tree_row` ways are expanded deterministically along their mapped
  centreline. Every mapped way vertex is retained and intermediate placements
  use 10 m spacing unless a recognized non-standard spacing hint is available.
  Individual tree nodes take precedence within 2.5 m. These added positions are
  inferred for visualization and are not surveyed individual-tree locations.
- The reviewed Elisabethstraße showcase corridor receives an additional
  deterministic two-sided street-tree pass where neither mapped tree nodes nor
  mapped tree rows provide coverage. Candidates use 14 m spacing, sit 2.5 m
  beyond the rendered road edge, stay clear of way endpoints and building
  footprints, and yield to known trees within 6 m. These placements are clearly
  marked `inferred-street-corridor`; they are a visual coverage hypothesis, not
  municipal tree-cadastre or surveyed trunk data.
- Street-lamp and bench nodes retain source references and relevant mapped
  attributes such as height, direction, seats, backrest, material and colour.
  Their rendered mesh detail is generated locally rather than supplied by OSM.
- Parking features retain mapped geometry or point, parking type, access,
  capacity, fee and surface where available. Road records also retain OSM
  parking-side, orientation and restriction tags. Exact `amenity=parking_space`
  nodes and ways are fetched separately when available and merged by OSM ID.
- Supported named ground-floor businesses retain their OSM name, category,
  subtype, brand, address, cuisine, opening hours and survey/check date when
  mapped. A deterministic offline pass associates each POI with a plausible
  building frontage; the browser generates the glass, frame, awning and sign.
- Building, park and water multipolygon members are stitched even when their
  ways are fragmented or reversed. Multiple outer rings remain separate and
  courtyard/inner rings remain open in roof and surface triangulation. The
  current snapshot contributes 106 relation-derived building parts with 131
  courtyard rings and 26 relation-derived green/water parts with 31 holes.
- Building heights prefer explicit `height`, then `building:levels` and
  `roof:levels`. Missing values use named building-kind priors or a documented
  14 m central-Munich block prior; each inferred value carries its method and
  basis instead of deriving variation from an arbitrary OSM ID.

Business names and categories are OSM data, but the assigned frontage width,
shopfront construction, typography and colours are inferred presentation. They
must not be treated as a surveyed or photographically exact record of a real
facade. OSM coverage and freshness also vary by feature and location.

## Munich municipal curb-parking rows

- Source: Landeshauptstadt München, Mobilitätsreferat –
  [Parkseiten](https://opendata.muenchen.de/dataset/opendata_ruhver_parkseiten_line)
- Access: official WFS, requested offline as GeoJSON in EPSG:4326 and clipped to
  the same corridor as the OSM extract
- Cached source: `data/cache/munich-parkseiten.geojson`
- Content: curb-side line geometry, reported parking-space count (`angebot`),
  street, parking-management area, regulation and classification
- Update cycle: monthly
- Licence: [Datenlizenz Deutschland – Namensnennung – Version 2.0](https://www.govdata.de/dl-de/by-2-0)
- Attribution: `Landeshauptstadt München – opendata.muenchen.de · dl-de/by-2-0`

The municipal layer is the primary curb source in a canonical runtime layout;
OSM parking spaces and lots supplement it, and OSM road-side tags are used only
where municipal coverage is absent. The layout links every eligible parked-car
slot to the exact surface rendered beneath it. Permanent 0–24 stopping bans, construction
records and records without a positive reported capacity are excluded. The
remaining lines are projected into the local X-east/Z-south frame, clipped at
500 m tile boundaries and stored separately as `parkingRows`; their regulation
and source reference survive processing.

Parkseiten does **not** provide surveyed bay polygons, widths or orientations.
Munich3D buffers each source line into an unmarked 2.4 m visual band and reuses
the project's asphalt texture. A narrow continuous curb-coloured perimeter
separates parking from adjacent surfaces; rendered sidewalk and crossing
triangles mask the band so it cannot paint across those pedestrian areas. The
band width, surface and boundary treatment are explicit visualization
inferences; no individual bay-boundary marks are derived or rendered. The non-colliding bands
must not be presented as cadastral stall boundaries or current occupancy. OSM
parking polygons and exact
`amenity=parking_space` objects remain complementary where mapped.

## Environment and vehicle assets

- Trees are self-made, texture-free low-poly trunk and canopy geometry. The
  shared two-part template is hardware-instanced at OSM tree positions; it does
  not claim a particular species or surveyed appearance.
- `public/assets/sky/munich-clear-day-skybox.png` is a checked-in prototype
  panorama used as a non-georeferenced daylight backdrop. It does not represent
  the weather, clouds, or time of day at a mapped location.
- `public/assets/vehicles/` contains 11 supplied GLB car models used for parked,
  player-controlled and ambient vehicles. Model choice is deterministic and does
  not claim that a particular real vehicle was present at a mapped location.

The vehicle models and sky panorama are prototype art separate from the ODbL
and CC BY datasets. The repository does not currently record an external source
URL or redistribution licence for them; definitive rights metadata should be
added before redistributing those asset files outside the project.

## Synthetic surface materials

`public/assets/textures/materials/` contains synthetic colour maps for asphalt,
cobblestone, compacted fine gravel, grass, flat mineral roofs, water, sidewalk
paving and neutral urban infill. The renderer
selects mapped surfaces from OSM road kind and `surface` tags, while non-water
land-cover polygons use the grass map. Municipal parking bands also reuse the
asphalt map as an inferred visual treatment. Where OSM explicitly marks a
`footway=sidewalk`, the renderer preserves its footway/cycleway surface tags,
joins the source segments, and expands the mapped centre line toward the nearest
parallel carriageway to form a raised paved apron and curb. That width, curb
profile and crossing ramp are visualization inferences, not surveyed sidewalk
polygons or elevations. The world-aligned urban-infill map covers only the
tile-wide safety ground where no more specific surface polygon exists.
It improves the visual fallback without claiming that the real courtyard,
parcel or mapping gap has that exact material. Texture choice is an inferred
visual treatment and does not claim photographically exact paving, wear, colour
or maintenance condition at a location. Water polygons share a restrained
blue-green ripple map and do not reproduce surveyed depth, flow, reflections or
water quality. Explicit compacted, dirt, earth, fine-gravel, gravel, ground and
sand tags share the compacted-fine-gravel map; unsupported materials such as
wood or metal retain a neutral untextured fallback instead of being relabelled.

The `munich-park-grass-v2`, `munich-compacted-gravel-v1`,
`munich-flat-roof-v1` and `munich-water-v1` maps are original synthetic project
art created with OpenAI image generation. Their prompts requested seamless,
top-down Munich-temperate lawn, compacted beige-grey limestone fines, weathered
neutral mineral/bitumen roofing, and subtle blue-green urban-water ripples,
respectively, with no objects, text, perspective or directional lighting. They
do not contain copied map-service or supplied reference-image pixels.

## Vehicle simulation caveat

OSM supplies parking geometry, parking rules, road geometry, access, direction,
lane and speed metadata where mapped. It does not supply live parked-car
occupancy or current vehicle observations. Munich3D therefore derives stable
parking slots from the municipal/OSM source union and uses seeded rules to
choose which slots appear occupied and which provided car model is shown. Cars
classified as ambient parked cars are created only from those canonical slots;
player vehicles left outside the rendered layout are classified as stopped.

Moving traffic is likewise a deterministic visual simulation. Cars are sampled
onto eligible OSM road routes and follow mapped one-way, access and speed
semantics where available, but their count, timing, route choice and exact
position do not come from traffic sensors, GPS traces or a live traffic API.
The simulation must not be used to infer current parking availability or traffic
conditions.

## Implemented Bavarian LoD2 corridor

- Source: Bavarian Surveying Administration LoD2 CityGML
- Product page: [Bavarian open-data LoD2](https://geodaten.bayern.de/opengeodata/OpenDataDetail.html?pn=lod2)
- Official acquisition index: `data/raw/lod2/acquisition-manifest.json`
- Source tiles: `690_5334`, `690_5336`, `690_5338`, `692_5334`,
  `692_5336`, `692_5338` (652,711,622 bytes total)
- Source CRS: EPSG:25832; vertical datum: DHHN2016
- Selection bounds: `11.560,48.134,11.590,48.170` (WGS84)
- Normalized output: `data/normalized/lod2-munich-corridor.json`
- Normalized content: 12,940 buildings and 239,758 semantic surfaces/polygons;
  zero invalid geometry records
- Runtime merge: 8,388 OSM matches, 2,524 additions, 2,028 conservative
  skips, and 10,911 buildings with semantic wall/roof meshes
- Browser representation: 45 versioned `.lod2.bin` sidecars totalling
  24,956,576 bytes, referenced by the corresponding 500 m tile JSON
- Licence: CC BY 4.0

Required attribution for processed Bavarian data:

> Bayerische Vermessungsverwaltung – www.geodaten.bayern.de. Licensed under
> CC BY 4.0; modified for Munich3D.

Matched runtime records retain both OSM and LoD2 identifiers. Elisabethstraße
46 is OSM way `108881086` and LoD2 building `DEBY_LOD2_4909212`; it uses the
official 21.11 m height, seven storeys and source provenance. Its reviewed
custom facade and detail geometry remain an explicit hero-building override.

## Deterministic facade layer

LoD2 does not describe windows, doors, balconies or facade appearance. The
renderer fills that gap with seven deterministic Munich facade families derived
from stable building IDs and available district, age, level, use, material,
roof and colour attributes. Nine shared facade bundles currently draw from four
legacy sheets, 13 new Elisabethstraße-inspired facade modules and five matching
windowless materials. New bundles separate upper floors, residential ground
floors, retail ground floors and neutral wall/cap surfaces while keeping the
period, palette and structural rhythm compatible. Official LoD2 function codes
identify walls and other non-occupied structures; gable geometry above the eave
and faces too narrow for a complete bay also use the neutral layer. Buildings linked to a
named OSM business frontage receive the retail base; the existing generated
storefront geometry and OSM-derived sign then sits in front of that neutral
architectural layer. Generated specs retain their inputs, inference basis and
confidence; they are art-direction priors, not claims of photographic identity.

The Elisabethstraße 46 texture and the reusable modules are original synthetic
art based on supplied architectural observations; no Google Maps or Street View
pixels are embedded. Google imagery is not used as a bulk texture source.

## Regenerate the runtime data

The orchestrator enforces the destructive stage order, downloads/resumes any
missing official source tiles, verifies their Metalink hashes, normalizes the
complete corridor, packs semantic geometry and validates every runtime tile:

```sh
pnpm data:all -- --refresh
pnpm build
```

For a network-free reproducibility check after the caches exist:

```sh
pnpm data:all -- --offline
pnpm test:data-pipeline
```

To inspect the individual acquisition, normalization and merge contracts, follow
[docs/reality-grounding.md](docs/reality-grounding.md). It records the exact
download, hash, normalization command, merge rules, provenance contract and
known limitations.

## Next authoritative layer

Bavarian DGM1 terrain is not integrated yet. It will provide 1 m ground
elevation in EPSG:25832/DHHN2016 and must use the same project vertical origin
as LoD2. See the [Bavarian open-data DGM1 product page](https://geodaten.bayern.de/opengeodata/OpenDataDetail.html?pn=dgm1).
