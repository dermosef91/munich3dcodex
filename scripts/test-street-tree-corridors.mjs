import assert from "node:assert/strict";
import {
  isNearPolygonObstacle,
  polygonObstacle,
  sampleStreetTreeCorridor,
} from "./lib/street-tree-corridors.mjs";

const straight = sampleStreetTreeCorridor([[0, 0], [100, 0]], {
  spacingMeters: 20,
  offsetMeters: 8,
  endClearanceMeters: 10,
});
assert.equal(straight.length, 10);
assert.deepEqual(straight[0], { point: [10, 8], side: "left", ordinal: 0 });
assert.deepEqual(straight[1], { point: [10, -8], side: "right", ordinal: 0 });
assert.deepEqual(straight.at(-2), { point: [90, 8], side: "left", ordinal: 4 });
assert.deepEqual(straight.at(-1), { point: [90, -8], side: "right", ordinal: 4 });

const tooShort = sampleStreetTreeCorridor([[0, 0], [15, 0]], { endClearanceMeters: 9 });
assert.deepEqual(tooShort, []);

assert.throws(
  () => sampleStreetTreeCorridor([[0, 0], [100, 0]], { spacingMeters: 5, maxTrees: 4 }),
  /safety limit/,
);

const building = polygonObstacle([[0, 0], [10, 0], [10, 10], [0, 10]]);
assert.ok(building);
assert.equal(isNearPolygonObstacle([5, 5], building, 1), true);
assert.equal(isNearPolygonObstacle([11, 5], building, 1), true);
assert.equal(isNearPolygonObstacle([11.01, 5], building, 1), false);
assert.equal(isNearPolygonObstacle([20, 5], building, 1), false);

process.stdout.write("Street-tree corridor sampling valid: paired setbacks, junction clearance, safety cap, and building exclusion.\n");
