import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const [source, mainSource, htmlSource] = await Promise.all([
  readFile(path.join(root, "src", "world", "vehicles.ts"), "utf8"),
  readFile(path.join(root, "src", "main.ts"), "utf8"),
  readFile(path.join(root, "index.html"), "utf8"),
]);

function sourceSection(contents, startMarker, endMarker) {
  const start = contents.indexOf(startMarker);
  const end = contents.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `expected source marker: ${startMarker}`);
  assert.ok(end > start, `expected source marker after ${startMarker}: ${endMarker}`);
  return contents.slice(start, end);
}

function numericConstant(name) {
  const match = source.match(new RegExp(`const ${name}\\s*=\\s*([\\d.]+)`));
  assert.ok(match, `expected numeric vehicle constant: ${name}`);
  return Number(match[1]);
}

const playerUpdate = sourceSection(
  source,
  "private updatePlayerVehicle",
  "private staticPathCollisionNormal",
);
const impactResponse = sourceSection(
  source,
  "private applyPlayerImpact",
  "private nearestProjectionInSegments",
);
const chaseCamera = sourceSection(
  source,
  "private updateChaseCamera",
  "private nearestParkedVehicle",
);
const hintUpdate = sourceSection(source, "private updateHint", "private axis");
const vehicleConstruction = sourceSection(mainSource, "new VehicleSystem", "const trams");
const modelScaling = sourceSection(
  source,
  "const MODEL_VISUAL_SCALE",
  "const MODEL_GROUND_LIFT",
);

const expectedVehicleModels = [
  "armor",
  "coupe",
  "fenyr",
  "ghini",
  "italia",
  "jeep",
  "kamaro",
  "lamb",
  "mobil",
  "rally",
  "van",
];
for (const model of expectedVehicleModels) {
  const scaleMatch = modelScaling.match(new RegExp(`${model}:\\s*([\\d.]+)`));
  assert.ok(scaleMatch, `vehicle scale calibration must cover ${model}`);
  const scale = Number(scaleMatch[1]);
  assert.ok(
    scale >= 0.78 && scale < 1,
    `${model} must be reduced to a plausible real-world scale`,
  );
}
assert.match(
  source,
  /visual\.scaling\.setAll\(MODEL_VISUAL_SCALE\[model\]\)/,
  "every instantiated vehicle must use its real-world scale calibration",
);
assert.match(
  source,
  /width:\s*MODEL_SHADOW_SIZE\[model\]\.width\s*\*\s*visualScale[\s\S]*?length:\s*MODEL_SHADOW_SIZE\[model\]\.length\s*\*\s*visualScale/,
  "vehicle contact shadows must shrink with their calibrated model",
);

assert.match(
  source,
  /const PLAYER_MAX_FORWARD_SPEED_MPS\s*=\s*120\s*\/\s*3\.6/,
  "player forward speed must be capped at 120 km/h",
);
assert.match(
  playerUpdate,
  /Math\.min\(\s*PLAYER_MAX_FORWARD_SPEED_MPS,\s*forwardSpeed/,
  "player acceleration must target the 120 km/h cap",
);
assert.doesNotMatch(
  source,
  /nearestRoadProjection|const corridor\s*=|offsetLength\s*>\s*corridor/,
  "player movement must not be clamped to the mapped road corridor",
);
assert.match(
  playerUpdate,
  /staticPathCollisionNormal\([\s\S]*?else if \(this\.wouldOverlapVehicle\(/,
  "building and vehicle collision checks must remain in the player movement path",
);
assert.match(
  source,
  /\(mesh\) => mesh\.checkCollisions && mesh\.metadata\?\.vehicle !== true/,
  "static collision rays must continue to use collision-enabled world meshes",
);

assert.match(
  source,
  /steeringInput:\s*number/,
  "player vehicles must retain steering state between frames",
);
assert.match(
  playerUpdate,
  /vehicle\.steeringInput\s*=\s*moveToward\(\s*vehicle\.steeringInput,\s*steeringTarget,\s*steeringResponse\s*\*\s*deltaSeconds\s*,?\s*\)/,
  "steering input must ease toward the requested direction over time",
);
const lowSpeedYawRate = numericConstant("PLAYER_LOW_SPEED_YAW_RATE");
const highSpeedYawRate = numericConstant("PLAYER_HIGH_SPEED_YAW_RATE");
assert.ok(
  highSpeedYawRate > 0 && highSpeedYawRate < lowSpeedYawRate,
  "high-speed steering must remain responsive but use a lower yaw-rate ceiling",
);
assert.match(
  playerUpdate,
  /const speedRatio\s*=\s*clamp\(Math\.abs\(forwardSpeed\)\s*\/\s*PLAYER_MAX_FORWARD_SPEED_MPS,\s*0,\s*1\)/,
  "steering authority must derive from normalized player speed",
);
assert.match(
  playerUpdate,
  /PLAYER_LOW_SPEED_YAW_RATE[\s\S]*?PLAYER_HIGH_SPEED_YAW_RATE[\s\S]*?Math\.sqrt\(speedRatio\)/,
  "the yaw-rate envelope must narrow as speed rises",
);

assert.doesNotMatch(
  playerUpdate,
  /vehicle\.speed\s*=\s*0(?:\.0+)?\s*;/,
  "player collision handling must not zero speed outright",
);
assert.match(
  playerUpdate,
  /if \(staticCollisionNormal\)[\s\S]*?applyPlayerImpact\([\s\S]*?else if \(this\.wouldOverlapVehicle\([\s\S]*?applyPlayerImpact\(/,
  "static and traffic collisions must share the recoverable impact response",
);
const retainedVelocityMatch = impactResponse.match(
  /tangent\.scale\(([\d.]+)\)\.add\(normal\.scale\(closingSpeed\s*\*\s*([\d.]+)\)\)/,
);
assert.ok(retainedVelocityMatch, "impact response must preserve tangent and rebound velocity");
assert.ok(
  retainedVelocityMatch.slice(1).every((value) => Number(value) > 0),
  "impact response velocity-retention factors must stay nonzero",
);
assert.match(
  impactResponse,
  /vehicle\.speed\s*=\s*Vector3\.Dot\(retainedVelocity,\s*forward\)/,
  "reported player speed must be recomputed from retained impact velocity",
);

assert.match(
  chaseCamera,
  /const speedRatio\s*=\s*clamp\(Math\.abs\(vehicle\.speed\)\s*\/\s*PLAYER_MAX_FORWARD_SPEED_MPS,\s*0,\s*1\)/,
  "chase-camera response must derive from normalized vehicle speed",
);
assert.match(
  chaseCamera,
  /const lookAhead\s*=\s*[^;]*Math\.abs\(vehicle\.speed\)[^;]*;/,
  "camera look-ahead must grow with speed",
);
assert.match(
  chaseCamera,
  /setTarget\([\s\S]*?forward\.scale\(lookAhead\)/,
  "the dynamic look-ahead must drive the camera target",
);
assert.match(
  chaseCamera,
  /const targetFov\s*=\s*[^;]*speedRatio[^;]*;[\s\S]*?this\.camera\.fov\s*[+]?=/,
  "camera FOV must widen smoothly with speed",
);
assert.ok(
  numericConstant("PLAYER_CAMERA_BASE_CORNER_LOOK")
    + numericConstant("PLAYER_CAMERA_SPEED_CORNER_LOOK") <= 1.5,
  "full-speed steering look must remain restrained",
);
assert.ok(
  numericConstant("PLAYER_CAMERA_BASE_DISTANCE")
    + numericConstant("PLAYER_CAMERA_SPEED_DISTANCE") <= 8,
  "the full-speed chase boom must stay close to the car",
);
assert.ok(
  numericConstant("PLAYER_CAMERA_MAX_FOV_INCREASE") <= 0.06,
  "speed-based FOV widening must stay subtle",
);

for (const id of ["driving-hud", "driving-speed", "driving-feedback"]) {
  assert.match(htmlSource, new RegExp(`id=["']${id}["']`), `driving HUD must provide #${id}`);
  assert.match(mainSource, new RegExp(`element<HTMLElement>\\(["']#${id}["']\\)`), `main must bind #${id}`);
}
for (const option of ["drivingHudElement", "speedElement", "feedbackElement"]) {
  assert.match(vehicleConstruction, new RegExp(`${option}\\s*:`), `VehicleSystem must receive ${option}`);
}
assert.match(
  hintUpdate,
  /this\.options\.speedElement\.textContent\s*=/,
  "the driving HUD must receive live speed telemetry",
);
assert.match(
  source,
  /this\.options\.drivingHudElement\.classList\.(?:add|toggle)\(/,
  "driving state must control HUD visibility",
);
assert.match(
  hintUpdate,
  /this\.options\.feedbackElement\.textContent\s*=/,
  "impact feedback must be exposed through the driving HUD",
);

process.stdout.write(
  "Vehicle contract valid: speed cap, free travel, progressive steering, recoverable impacts, dynamic camera, and driving HUD.\n",
);
