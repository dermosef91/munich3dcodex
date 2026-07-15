---
name: munich-landmark-assets
description: Build, revise, and validate reviewed custom landmark models, facade textures, overlays, shell replacements, and preview views in the Munich3D repository. Use for adding a Munich landmark or address-specific hero asset, correcting its placement or source building IDs, recording real-life visual references and original-art provenance, or auditing the landmark manifest and runtime integration.
---

# Munich Landmark Assets

Use the reviewed landmark manifest as the source of truth for asset intent and validation. Read [references/manifest-schema.md](references/manifest-schema.md) before changing the manifest or choosing a shell treatment.

## Workflow

1. Inspect each candidate runtime building before modeling:

   ```sh
   node scripts/landmark-assets.mjs inspect --id 86022858 --radius 80
   ```

   Resolve each public elevation to a named street and world-facing/local-facing direction before placing facade art. Prefer names such as `elisabethZ` and `nordbadZ` over an unverified generic `front` or `back`.

2. Preserve authoritative Bavarian LoD2 walls and roofs. Add thin, non-colliding facade planes and projecting details for those shells. Replace a streamed shell only when it is an OSM-only placeholder or custom silhouette/gameplay geometry clearly requires replacement.
3. Research official, architect, municipal, or compatibly licensed references. Record every reference, its usage, and licence in `src/world/landmarks/manifest.json`. Never bake map or street-view pixels into original art without explicit compatible rights.
4. Use the image-generation skill for new bitmap facade art. Generate rectified, neutral-lit elevation sheets without sky, pavement, vegetation, vehicles, people, watermarks, or baked signage. Render exact names and logos procedurally when practical.
5. Put facade sheets in `public/assets/textures/landmarks/`. Put reusable GLBs in `public/assets/custom/`. Keep asset paths relative and Vite-base-safe.
6. Implement the landmark with one stable `landmark-<slug>` root node. Register facade materials, preview views, and only the exact replacement IDs required by the manifest. Mark new work `planned` until its runtime code and assets exist; then change it to `integrated` and leave visual approval as `needs-user-review` until the user reviews it.
7. Validate before handoff:

   ```sh
   node scripts/landmark-assets.mjs validate
   npm run test:landmarks
   npm run build
   ```

Report reference assumptions, shell-preservation decisions, asset paths, generation prompt summaries, and any remaining user visual review.

## Guardrails

- Do not add a LoD2 school or heritage shell to `landmarkRegistry.ts` merely to apply a texture.
- Do not use `facadeRegistry.ts` for a LoD2 landmark until its custom-facade path preserves semantic LoD2 geometry.
- Do not infer that local `-Z` is the public front. Verify the street side against the runtime footprint and provide a preview that faces the elevation being reviewed.
- Verify each procedural extrusion's axis and world bounds, not just its footprint. Babylon polygon extrusions grow along local `-Y`; lift them by their depth when the requested `y` is a base elevation. Decorative facade bands do not count as an enclosure.
- Keep collision on structural geometry, not facade planes, signs, glass, or decorative fittings.
- Derive contract expectations from the manifest; do not introduce fixed landmark, texture, or replacement counts.
