# Top 50 visual anchors in the playable Munich area

This is the art backlog for the checked-in map extent (`48.134–48.170 N`,
`11.560–11.590 E`). It prioritizes a combination of recognisability, skyline
or streetscape value, and the chance that the existing Bavarian LoD2 shell can
be made convincing with a material/facade pass alone.

`Texture-only` is deliberately conservative:

- **5/5 — texture-first:** facade art, roof/wall materials, glazing, and
  procedural lettering can carry the result while keeping the streamed shell.
- **4/5 — texture-led:** the shell should stay, but a future shallow detail
  layer (cornices, portal, tracery) will improve close views.
- **3/5 — hybrid:** materials help, but porticos, arcades, or a multi-shell
  cleanup are important to the identity.
- **2/5 — geometry-led:** texture is supporting work; open structure or
  silhouette is the memorable feature.
- **1/5 — replacement-led:** use new geometry before spending on facade art.

The runtime IDs below are a map-audit starting point, not an integration
instruction. Before implementation, inspect the target shell and public street
elevation, retain LoD2 geometry by default, and only add thin non-colliding
overlays. `Multi-shell` calls out complexes that should be reviewed as a group.

`World size` is the target LoD2 shell's axis-aligned world footprint span
(west/east × north/south) and recorded height, rounded to whole metres. It is a
planning scale rather than a measured architectural dimension, so it can
overstate rotated, irregular, or multi-shell complexes.

| Priority | Visual anchor | Runtime building ID / scope | World size (W × D × H) | Texture-only | Recommended first pass |
| ---: | --- | --- | :---: | :---: | --- |
| 1 | Hofbräuhaus am Platzl | `1273939826` | 39 × 38 × 25 m | 5/5 | Preserve shell; cream/green Platzl elevations, windows, and procedural name sign. **Integrated pilot.** |
| 2 | Alte Pinakothek | `4647135` | 158 × 105 × 28 m | 5/5 | Preserve; rendered Klenze bays, exposed-brick reconstruction, and roof materials. **Integrated pilot.** |
| 3 | Museum Brandhorst | `28026817` | 48 × 82 × 20 m | 5/5 | Preserve; multicolour ceramic-rod rhythm across all elevations. **Integrated pilot.** |
| 4 | Bayerische Staatsbibliothek | `-52412001` | 120 × 168 × 32 m | 5/5 | Preserve; long Ludwigstraße blank-brick frontage, arched openings, and portal. **Integrated pilot.** |
| 5 | Haus der Kunst | `150797531` | 161 × 96 × 16 m | 5/5 | Preserve; pale stone, dark openings, and a shallow colonnade shadow layer. |
| 6 | Pinakothek der Moderne | `10053440` | 158 × 119 × 25 m | 5/5 | Preserve; white concrete, glass, entrance glazing, and restrained signage. |
| 7 | NS-Dokumentationszentrum | `280336045` | 29 × 29 × 27 m | 5/5 | Preserve; crisp white stone/concrete panels and dark window reveals. |
| 8 | Museum Fünf Kontinente | `25695553` | 52 × 37 × 29 m | 5/5 | Preserve; long historic facade, ochre stone, rhythmic windows, and entry treatment. |
| 9 | Hotel Vier Jahreszeiten Kempinski | `25505398` | 41 × 57 × 28 m | 5/5 | Preserve; refined Maximilianstraße stone facade, awnings, and warm lobby glazing. |
| 10 | Ruffinihaus | `233918201` | 32 × 27 × 25 m | 5/5 | Preserve; painted historic facade palette and roof/window rhythm. |
| 11 | Münchner Kammerspiele Schauspielhaus | `328018432` | 37 × 30 × 15 m | 5/5 | Preserve; distinct theatre facade, glazing, and night-time entrance glow. |
| 12 | Deutsches Theater | `116642230` | 74 × 48 × 29 m | 5/5 | Preserve; broad theater frontage, marquee treatment, and window bands. |
| 13 | Frauenkirche | `225698612` | 110 × 49 × 99 m | 4/5 | Preserve detailed towers; brick, stone trim, red tile, and green copper material pass. |
| 14 | Theatinerkirche St. Kajetan | `25514390` | 77 × 50 × 71 m | 4/5 | Preserve dome and towers; yellow stucco, white trim, and copper treatment. |
| 15 | St. Peter (Alter Peter) | `228534603` | 83 × 44 × 80 m | 4/5 | Preserve tower and roof; stucco, tiled roof, clock, and window treatment. |
| 16 | Asamkirche (St. Johann Nepomuk) | `47515468` | 25 × 26 × 33 m | 4/5 | Preserve; narrow Sendlinger Straße elevation with a rectified Baroque facade sheet. **Integrated pilot.** |
| 17 | Altes Rathaus | `4054817` | 37 × 36 × 55 m | 4/5 | Preserve tower mass; Marienplatz facade, roof, windows, and clock treatment. |
| 18 | Justizpalast | `-14897001` | 160 × 131 × 64 m | 4/5 | Preserve rich roof/dome shell; stone, slate/copper, glass, and ironwork materials. |
| 19 | St. Ludwig | `25440202` | 78 × 54 × 32 m | 4/5 | Preserve; twin-tower stone, painted interior-facing facade, and copper accents. |
| 20 | St. Michael | `36943165` | 57 × 92 × 50 m | 4/5 | Preserve; dark pale-stone facade, sculptural bays via shading, and tower materials. |
| 21 | Ohel Jakob Hauptsynagoge | `24164375` | 33 × 22 × 20 m | 4/5 | Preserve; warm stone, patterned upper volume, entry glazing, and evening lighting. |
| 22 | Jüdisches Museum München | `24164434` | 32 × 24 × 15 m | 4/5 | Preserve; glass/metal material pass and legible plaza-facing entrance. |
| 23 | Bayerische Staatskanzlei | `124911353` | 87 × 190 × 14 m | 4/5 | Preserve; sandstone wings, glass dome treatment, and park-facing reflections. |
| 24 | Lenbachhaus | `237426208` | 75 × 82 × 17 m | 4/5 | Preserve; yellow historic facade, contemporary wing contrast, and garden frontage. |
| 25 | St. Lukas | `19330628` | 61 × 58 × 63 m | 4/5 | Preserve; red brick, stone tracery shorthand, and copper dome/roof materials. |
| 26 | Basilika St. Bonifaz | `106463846` | 52 × 51 × 26 m | 4/5 | Preserve; brick Romanesque facade, roof, and twin-tower material separation. |
| 27 | Heilig Geist | `3810527` | 58 × 52 × 33 m | 4/5 | Preserve; pale church facade, roof materials, and Viktualienmarkt-facing frontage. |
| 28 | Bürgersaalkirche | `125213617` | 33 × 51 × 23 m | 4/5 | Preserve; restrained cream facade, tall windows, and portal treatment. |
| 29 | Dreifaltigkeitskirche | `91268639` | 22 × 27 × 27 m | 4/5 | Preserve; pale Baroque facade and dome/roof material contrast. |
| 30 | St.-Anna-Klosterkirche | `27910913` | 56 × 76 × 26 m | 4/5 | Preserve; warm stucco, roof, and Lehel-facing facade details. |
| 31 | St.-Anna-Pfarrkirche | `77649044` | 60 × 36 × 37 m | 4/5 | Preserve; red brick, pale stone trim, and tower/roof materials. |
| 32 | Allerheiligenkirche am Kreuz | `48605346` | 21 × 28 × 66 m | 4/5 | Preserve; church facade palette and window/roof contrast. |
| 33 | Hotel Bayerischer Hof | `34102840` | 83 × 59 × 31 m | 4/5 | Preserve; Promenadeplatz facade, awnings, windows, and warm ground-floor glow. |
| 34 | Polizeipräsidium München | `-301240001` | 139 × 120 × 21 m | 4/5 | Preserve; strong stone-and-brick civic facade, repeated windows, and portal material treatment. |
| 35 | Bayerisches Nationaltheater / Staatsoper | `23458583` | 123 × 82 × 41 m | 3/5 | Preserve main mass; stone facade is useful, but the portico needs a shallow column layer. |
| 36 | Glyptothek | `-532621001` | 81 × 73 × 13 m | 3/5 | Preserve roof/block; add facade material plus lightweight south portico and columns. |
| 37 | Staatliche Antikensammlung | `-2405755001` | 69 × 47 × 21 m | 3/5 | Preserve; texture stonework, then add a shallow classical entry layer. |
| 38 | Münchner Stadtmuseum | `-2360164001` | 129 × 108 × 18 m | 3/5 | Preserve; differentiate historic wings, entry portals, and roof materials. |
| 39 | Alte Münze | `-1192791001` | 85 × 63 × 24 m | 3/5 | Preserve; courtyard/arcade-facing stone, brick, and roof treatment. |
| 40 | Schrannenhalle | `17952124` | 87 × 84 × 12 m | 3/5 | Preserve; glass-and-iron hall texture, roof transparency, and market-facing entrances. |
| 41 | Münchner Residenz / Alter Hof edge | Multi-shell; audited Alter Hof shell `79401251` | Audit shell: 28 × 50 × 26 m | 3/5 | Treat as a coordinated multi-shell street wall; do not assign one arbitrary building ID to the complex. |
| 42 | Karlstor | `52103816` | 23 × 19 × 26 m | 3/5 | Preserve if openings are real; stone/roof materials help, but arch depth needs inspection. |
| 43 | Sendlinger Tor | `337782843` | 20 × 17 × 11 m | 3/5 | Preserve if openings are real; add sandstone/brick material and restrained portal relief. |
| 44 | Isartor | `-6035286001` | 44 × 45 × 14 m | 3/5 | Preserve tower mass; brick, roof, and clock/window treatment, with opening-depth review. |
| 45 | Propyläen | `244969498` | 35 × 56 × 27 m | 2/5 | Texture stonework is secondary; the colonnade needs geometry to read at street level. |
| 46 | Dianatempel | `150797475` | 15 × 15 × 16 m | 2/5 | Texture only supports the result; open columns and roof silhouette are the identity. |
| 47 | Hofgartenarkaden | `286825221` | 213 × 77 × 11 m | 2/5 | Coordinate a material pass with repeated arches; real depth is still the crucial feature. |
| 48 | Feldherrnhalle | `25505402` | 37 × 23 × 26 m | 1/5 | Replace the structurally solid placeholder; the open loggia cannot be faked with a facade texture. |
| 49 | Siegestor | `22727580` | 25 × 18 × 23 m | 1/5 | Replace before texturing; three through-arches and crowning sculpture are structural. |
| 50 | Neue Pinakothek site/building | `-1644123001` | 111 × 89 × 26 m | 1/5 | Defer until its current map shell and intended era are reviewed; texture cannot settle an uncertain silhouette. |

## Recommended production slices

1. **Continue texture-first:** entries 5–12 are the lowest-risk second wave;
   each is facade-driven and can retain its LoD2 shell.
2. **Texture-led historic skyline:** entries 13–34 are high-value city anchors;
   add facade art first, then only thin, non-colliding detail where close views
   need it.
3. **Hybrid monuments and gateways:** entries 35–47 need a shell inspection
   before art production because columns, arcades, or multi-shell coordination
   can dominate the visual result.
4. **Replacement queue:** entries 48–50 should not consume texture budget
   until their geometry/era decisions are made.

The first five pilots retain the streamed Bavarian LoD2 shell and collision
geometry. Their materials are procedural facade sheets or overlays rather than
replacement models; this is the preferred implementation path for every
5/5 and most 4/5 entries.
