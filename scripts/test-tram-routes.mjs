import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const vite = await createServer({
  root,
  appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false },
});

try {
  const { activeTramRoutes, stitchTramTracks, visibleTramRoutes } = await vite.ssrLoadModule("/src/world/tram.ts");
  const nordbadTileIds = ["-1_-3", "-2_-3", "-2_-4"];
  const tiles = await Promise.all(nordbadTileIds.map(async (id) => JSON.parse(
    await readFile(path.join(root, "public", "data", "tiles", `${id}.json`), "utf8"),
  )));
  const tracks = tiles.flatMap((tile) => tile.tramTracks ?? []);
  const stitched = stitchTramTracks(tracks);
  const active = activeTramRoutes(tracks);
  const visible = visibleTramRoutes(tracks);

  const sourceWayIds = new Set(tracks.flatMap((track) => track.sourceRefs?.map((reference) => reference.id) ?? []));
  assert.ok(sourceWayIds.has("way/308784465"), "in-bounds westbound rail must survive tiling");
  assert.ok(sourceWayIds.has("way/1020561101"), "in-bounds eastbound rail must survive tiling");

  const containsWaysInOrder = (route, wayIds) => {
    const routeWayIds = route.key.split("+").map((id) => id.replace(/:\d+$/, ""));
    let cursor = -1;
    return wayIds.every((wayId) => {
      cursor = routeWayIds.indexOf(wayId, cursor + 1);
      return cursor >= 0;
    });
  };
  const westToNorth = stitched.find((route) => containsWaysInOrder(
    route,
    ["way/308784465", "way/142771975", "way/143413187"],
  ));
  const northToWest = stitched.find((route) => containsWaysInOrder(
    route,
    ["way/142771976", "way/143413185", "way/1020561101"],
  ));
  assert.ok(westToNorth, "west-to-north Nordbad curve must join both parent tracks");
  assert.ok(northToWest, "north-to-west Nordbad curve must join both parent tracks");
  assert.ok(
    active.some((route) => containsWaysInOrder(
      route,
      ["way/308784465", "way/142771975", "way/143413187"],
    )),
    "an active tram must take the real west-to-north Nordbad curve",
  );
  assert.ok(
    active.every((route) => route.length >= 250),
    "short junction connectors must not receive a shuttle tram",
  );
  assert.equal(
    visible.length,
    Math.max(1, Math.round(active.length * 0.10)),
    "the visible fleet must stay near ten percent of eligible route movements",
  );
  const activeKeys = new Set(active.map((route) => route.key));
  assert.ok(visible.every((route) => activeKeys.has(route.key)), "visible trams must use an active directed route");

  const tracksById = new Map(tracks.map((track) => [track.id, track]));
  const key = (point) => `${point[0].toFixed(1)}:${point[1].toFixed(1)}`;
  for (const route of active) {
    const pieces = route.key.split("+").map((id) => tracksById.get(id));
    assert.ok(pieces.every(Boolean), `route ${route.key} references an unknown track piece`);
    for (let index = 1; index < pieces.length; index += 1) {
      const previous = pieces[index - 1];
      const next = pieces[index];
      const previousEnd = previous.oneway === -1 ? previous.points[0] : previous.points.at(-1);
      const nextStart = next.oneway === -1 ? next.points.at(-1) : next.points[0];
      assert.equal(key(previousEnd), key(nextStart), `route ${route.key} reverses or jumps between directed rails`);
    }
  }

  process.stdout.write(
    `Tram routes valid: ${westToNorth.length.toFixed(1)} m west-to-north and ${northToWest.length.toFixed(1)} m north-to-west through Nordbad; ${visible.length}/${active.length} route movements visible.\n`,
  );
} finally {
  await vite.close();
}
