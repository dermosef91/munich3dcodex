import assert from "node:assert/strict";
import {
  DEFAULT_TREE_ROW_SPACING_METERS,
  PointProximityIndex,
  sampleTreeRow,
} from "./lib/tree-rows.mjs";

assert.equal(DEFAULT_TREE_ROW_SPACING_METERS, 10);
const twentyFiveMetreRow = sampleTreeRow([[0, 0], [25, 0]]);
assert.equal(twentyFiveMetreRow.length, 4);
assert.ok(Math.abs(twentyFiveMetreRow[1][0] - 25 / 3) < 1e-12);
assert.ok(Math.abs(twentyFiveMetreRow[2][0] - 50 / 3) < 1e-12);
assert.deepEqual([twentyFiveMetreRow[0], twentyFiveMetreRow.at(-1)], [[0, 0], [25, 0]]);
assert.deepEqual(
  sampleTreeRow([[0, 0], [10, 0], [10, 10]]),
  [[0, 0], [10, 0], [10, 10]],
  "each mapped bend must remain an inferred tree anchor",
);
assert.deepEqual(
  sampleTreeRow([[0, 0], [0, 0], [20, 0]], 10),
  [[0, 0], [10, 0], [20, 0]],
  "duplicate geometry vertices must not duplicate trees",
);
assert.deepEqual(sampleTreeRow([[0, 0]]), [], "a tree row needs at least two distinct points");
assert.throws(
  () => sampleTreeRow([[0, 0], [100, 0]], 1, 10),
  /safety limit/,
  "pathological rows must be bounded",
);

const index = new PointProximityIndex(4);
index.add([3.9, 3.9]);
assert.equal(index.hasNearby([4.1, 4.1], 0.3), true, "nearby checks must cross cell boundaries");
assert.equal(index.hasNearby([7, 7], 2), false, "distant points must remain distinct");

process.stdout.write("Tree-row sampling valid: anchors, spacing, safety cap, and proximity deduplication.\n");
