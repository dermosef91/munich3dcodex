# Landmark overhaul priority

This is the next-landmark implementation queue for the checked-in Munich map
(`48.134–48.170 N`, `11.560–11.590 E`). It excludes the eleven custom sights
that were already in the reviewed manifest before this pass. The ordering first
filters for city recognition, then deliberately moves landmarks whose existing
Bavarian LoD2 shell can carry a facade/material overhaul to the front.

## Fifteen recognizable map anchors

| Priority | Landmark | Runtime building ID | Recommended treatment | State |
| ---: | --- | ---: | --- | --- |
| 1 | Hofbräuhaus am Platzl | `1273939826` | Preserve the LoD2 shell; texture the two Platzl elevations. | First texture pass integrated |
| 2 | Asamkirche / Sankt Johann Nepomuk | `47515468` | Preserve the detailed church shell; treat the narrow Sendlinger Straße facade and add only shallow relief later. | First texture pass integrated |
| 3 | Alte Pinakothek | `4647135` | Preserve the LoD2 roof and walls; overhaul all four public elevations, including the exposed-brick reconstruction. | First texture pass integrated |
| 4 | Haus der Kunst | `150797531` | Preserve; stone facade sheets plus shallow, non-structural colonnade detail. | Next texture wave |
| 5 | Bayerisches Nationaltheater / Staatsoper | `23458583` | Preserve; Max-Joseph-Platz elevation plus a shallow portico/column layer. | Next texture wave |
| 6 | Frauenkirche | `225698612` | Preserve the exceptionally rich twin-tower LoD2 silhouette; replace generic wall/roof appearance with brick, stone, tile, and copper treatments. | Next texture wave |
| 7 | Theatinerkirche St. Kajetan | `25514390` | Preserve the detailed towers and dome; add yellow stucco, white Baroque trim, and copper-roof materials. | Next texture wave |
| 8 | St. Peter / Alter Peter | `228534603` | Preserve; add stucco, red tile, copper, clock, and window treatments. | Next texture wave |
| 9 | Altes Rathaus | `4054817` | Preserve the tower and roof mass; add the Marienplatz facade and roof materials. | Next texture wave |
| 10 | Pinakothek der Moderne | `10053440` | Preserve; white-concrete and glass material pass, then lightweight entrance glazing around the existing mass. | Next texture wave |
| 11 | Justizpalast | `-14897001` | Preserve the highly detailed LoD2 dome/roof; differentiate stone, slate/copper, glazing, and ironwork. | Next texture wave |
| 12 | Glyptothek | `-532621001` | Preserve the museum block; texture the stone elevations and add a lightweight south portico. | Hybrid detail pass |
| 13 | Neues Rathaus | `-147095001` placeholder plus nine LoD2 components | Suppress only the overlapping OSM placeholder, retain the detailed LoD2 components, then add the Marienplatz elevation. | Data fix plus hybrid pass |
| 14 | Feldherrnhalle | `25505402` | Replace the structurally solid LoD2 placeholder so the open south loggia has real openings. | Remodel required |
| 15 | Siegestor | `22727580` | Replace the structurally solid LoD2 placeholder so the three arches and crowning sculpture read correctly. | Remodel required |

The Neues Rathaus LoD2 component IDs that must be retained are
`-789744748`, `-764578320`, `-772967129`, `-882021653`, `-890410462`,
`-2085736492`, `-2094125301`, `-2102514111`, and `-2110902920`.

Feldherrnhalle and Siegestor have no polygon holes in their LoD2 records. A
painted arch on a colliding solid wall would be misleading, so both stay below
the texture-first work until reviewed replacement geometry is ready.

## Texture-first pilot extras

Two highly legible facade-driven buildings were integrated alongside the first
three queue items to exercise the preservation pattern at different scales:

- Museum Brandhorst (`28026817`): all four elevations use original procedural
  art for the documented multi-colour ceramic-rod facade.
- Bayerische Staatsbibliothek (`-52412001`): the approximately 150 m
  Ludwigstraße frontage uses an original procedural blank-brick elevation.

All five pilots retain their streamed LoD2 walls, semantic roofs, and collision
geometry. Their overlay planes are non-pickable, non-colliding, and kept out of
both the generic facade registry and the replacement registry.

## Reference basis for the first pass

- [Hofbräuhaus history](https://www.hofbraeuhaus.de/en/history/)
- [Asamkirche architectural overview](https://www.muenchen.travel/pois/stadt-viertel/asamkirche)
- [Alte Pinakothek architecture](https://www.pinakothek.de/en/alte-pinakothek)
- [Museum Brandhorst architecture](https://www.museum-brandhorst.de/pressematerial/architektur-museum-brandhorst/)
- [Bayerische Staatsbibliothek building](https://www.bsb-muenchen.de/en/about-us/portrait/library-building/)

These pages guided new original art only. No reference pixels are embedded.
