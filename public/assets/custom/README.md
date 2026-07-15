# Custom Munich assets

Export runtime assets as `.glb` files into this directory. Keep their object
origin at ground level and use metres as the export unit.

Add each placement to `src/customAssets.ts` with its latitude, longitude,
rotation and scale. The loader georeferences and collision-enables the asset.

Before production delivery, optimize files with meshopt (`gltfpack`) and use
KTX2 textures. Keep shared textures and repeated props out of individual city
tile files so the browser can cache them once.
