import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const vite = await createServer({
  root,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: false, ws: false },
});

class FakeEngine {
  changes = [];

  constructor(level) {
    this.level = level;
  }

  getHardwareScalingLevel() {
    return this.level;
  }

  setHardwareScalingLevel(level) {
    this.level = level;
    this.changes.push(level);
  }
}

function feedWindow(controller, state, fps, duration = 1_100) {
  const delta = 1_000 / fps;
  const end = state.now + duration;
  while (state.now < end) {
    state.now += delta;
    controller.update(delta, state.now);
  }
}

try {
  const mainSource = await readFile(path.join(root, "src/main.ts"), "utf8");
  const frameLoopStart = mainSource.indexOf("scene.onBeforeRenderObservable.add");
  const throttledDiagnosticsStart = mainSource.indexOf(
    "if (now - lastHudUpdate > 200)",
    frameLoopStart,
  );
  assert.ok(frameLoopStart >= 0 && throttledDiagnosticsStart > frameLoopStart);
  assert.equal(
    mainSource.slice(frameLoopStart, throttledDiagnosticsStart).includes("canvas.dataset.playerX"),
    false,
    "player diagnostics must stay outside the per-frame hot path",
  );
  assert.ok(
    mainSource.slice(throttledDiagnosticsStart).includes("canvas.dataset.playerX"),
    "player diagnostics must remain available on the throttled HUD cadence",
  );
  const startFunctionStart = mainSource.indexOf("async function start");
  const startFunctionEnd = mainSource.indexOf("void start().catch", startFunctionStart);
  const startSource = mainSource.slice(startFunctionStart, startFunctionEnd);
  assert.ok(startFunctionStart >= 0 && startFunctionEnd > startFunctionStart);
  assert.ok(
    startSource.indexOf("engine.runRenderLoop") < startSource.indexOf("await streamer.initialize"),
    "rendering must begin before critical world streaming completes",
  );
  assert.equal(
    startSource.includes("await vehicles.initialize"),
    false,
    "vehicle assets must not block the playable world",
  );
  assert.ok(
    startSource.indexOf("revealWorld()") < startSource.indexOf("vehicles.initialize()"),
    "vehicle downloads must not compete with critical world streaming",
  );
  assert.ok(
    startSource.indexOf("revealWorld()") < startSource.indexOf("prepareOptionalWorldDetails()"),
    "optional landmark details must begin only after the world becomes playable",
  );
  for (const optionalModule of [
    "./world/SchwabingDetails",
    "./world/LandmarkDetails",
    "./customAssets",
  ]) {
    assert.equal(
      mainSource.includes(`from \"${optionalModule}\"`),
      false,
      `${optionalModule} must stay out of the critical static import graph`,
    );
    assert.ok(
      mainSource.includes(`import(\"${optionalModule}\")`),
      `${optionalModule} must load dynamically after entry`,
    );
  }
  const paintBarrierSource = mainSource.slice(
    mainSource.indexOf("function nextRenderedFrame"),
    mainSource.indexOf("async function prepareOptionalWorldDetails"),
  );
  assert.equal(
    paintBarrierSource.match(/requestAnimationFrame/g)?.length,
    2,
    "optional detail construction must wait until the playable state has painted",
  );

  const { AdaptivePerformanceController } = await vite.ssrLoadModule(
    "/src/performance/AdaptivePerformanceController.ts",
  );
  const engine = new FakeEngine(0.5);
  const constrainedTransitions = [];
  const controller = new AdaptivePerformanceController(engine, 2, {
    maxDevicePixelRatio: 1.5,
    maximumScalingLevel: 1,
    scalingStep: 0.125,
    sampleWindowMs: 1_000,
    warmupMs: 0,
    lowFps: 50,
    highFps: 58,
    lowSamplesBeforeChange: 1,
    highSamplesBeforeChange: 2,
    onConstrainedModeChange: (constrained) => constrainedTransitions.push(constrained),
  });
  const state = { now: 0 };

  assert.ok(Math.abs(engine.level - 0.667) < 0.001, "Retina rendering must start at the 1.5x cap");
  assert.equal(controller.mode, "quality");
  assert.ok(Math.abs(controller.renderPixelRatio - 1.5) < 0.01);

  feedWindow(controller, state, 40);
  assert.ok(engine.level > 0.667, "sustained low FPS must reduce pixel cost first");
  assert.equal(constrainedTransitions.length, 0, "scene quality must remain intact while resolution can adapt");

  while (engine.level < 1) feedWindow(controller, state, 40);
  feedWindow(controller, state, 40);
  assert.equal(controller.mode, "performance");
  assert.deepEqual(constrainedTransitions, [true], "the secondary fallback starts only at the resolution floor");

  feedWindow(controller, state, 60);
  feedWindow(controller, state, 60);
  feedWindow(controller, state, 60);
  assert.deepEqual(constrainedTransitions, [true, false], "stable headroom must restore scene quality first");
  assert.equal(engine.level, 1, "resolution recovery waits until scene quality is restored");

  feedWindow(controller, state, 60);
  feedWindow(controller, state, 60);
  feedWindow(controller, state, 60);
  assert.ok(engine.level < 1, "continued headroom must restore pixel density gradually");

  const levelBeforeInvalidSample = engine.level;
  controller.update(1_000, state.now + 1_000);
  assert.equal(engine.level, levelBeforeInvalidSample, "background-tab gaps must not trigger degradation");

  const displayEngine = new FakeEngine(0.5);
  const displayController = new AdaptivePerformanceController(displayEngine, 2, {
    maximumScalingLevel: 1.25,
    warmupMs: 0,
  });
  displayController.handleDevicePixelRatio(1);
  assert.equal(displayEngine.level, 1, "moving to a 1x display must recompute the quality ceiling");

  process.stdout.write(
    "Adaptive performance valid: Retina cap, hysteretic resolution scaling, shadow fallback, and recovery.\n",
  );
} finally {
  await vite.close();
}
