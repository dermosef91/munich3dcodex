import "./style.css";
import "@babylonjs/core/Collisions/collisionCoordinator";
import "@babylonjs/core/Shaders/default.vertex";
import "@babylonjs/core/Shaders/default.fragment";
import "@babylonjs/core/Shaders/pbr.vertex";
import "@babylonjs/core/Shaders/pbr.fragment";
import "@babylonjs/core/Shaders/rgbdDecode.fragment";
import "@babylonjs/core/Shaders/color.vertex";
import "@babylonjs/core/Shaders/color.fragment";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { PhotoDome } from "@babylonjs/core/Helpers/photoDome";
import { WorldStreamer } from "./world/WorldStreamer";
import { closestDistrict, DISTRICTS, type DistrictId, worldToLonLat } from "./world/geo";
import { loadCustomAssets } from "./customAssets";
import { KeyboardMovement } from "./player/KeyboardMovement";
import { createSchwabingDetails } from "./world/SchwabingDetails";
import { createLandmarkDetails, landmarkPreview } from "./world/LandmarkDetails";
import { VehicleSystem } from "./world/vehicles";
import { TramSystem } from "./world/tram";
import { GroundShadowSystem } from "./world/GroundShadowSystem";
import {
  resolveShadowQuality,
  SunShadowController,
} from "./world/SunShadowController";
import { AdaptivePerformanceController } from "./performance/AdaptivePerformanceController";

function element<T extends HTMLElement>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing required element: ${selector}`);
  return value;
}

const canvas = element<HTMLCanvasElement>("#scene");
const loading = element<HTMLElement>("#loading");
const loadingProgress = element<HTMLElement>("#loading-progress");
const status = element<HTMLElement>("#status");
const districtLabel = element<HTMLElement>("#district");
const coordinates = element<HTMLElement>("#coordinates");
const attribution = element<HTMLElement>("#attribution");
const enterButton = element<HTMLButtonElement>("#enter");
const intro = element<HTMLElement>("#intro");
const vehicleHint = element<HTMLElement>("#vehicle-hint");
const flightHud = element<HTMLElement>("#flight-hud");
const drivingHud = element<HTMLElement>("#driving-hud");
const drivingSpeed = element<HTMLElement>("#driving-speed");
const drivingFeedback = element<HTMLElement>("#driving-feedback");

if (!Engine.isSupported()) {
  loading.innerHTML = "<strong>This browser cannot create a WebGL 2 scene.</strong><span>Please try a current version of Chrome, Safari, Firefox, or Edge.</span>";
  throw new Error("WebGL is unavailable");
}

const engine = new Engine(canvas, true, {
  antialias: true,
  adaptToDeviceRatio: true,
  powerPreference: "high-performance",
  stencil: false,
});
engine.renderEvenInBackground = false;
engine.disablePerformanceMonitorInBackground = true;

const scene = new Scene(engine);
// Source coordinates are X=east, Y=up, Z=south: a right-handed frame.
// Matching the renderer to that frame prevents the real-world layout and
// asymmetric facades from being reflected horizontally.
scene.useRightHandedSystem = true;
// Use a clear, slightly warm blue daylight rather than the earlier overcast
// blue-grey. Keeping the clear and fog colours close prevents a hard horizon
// while making the open sky feel more welcoming.
scene.clearColor = new Color4(0.57, 0.72, 0.88, 1);
scene.ambientColor = new Color3(0.22, 0.25, 0.25);
scene.collisionsEnabled = true;
scene.fogMode = Scene.FOGMODE_LINEAR;
scene.fogStart = 760;
scene.fogEnd = 1_650;
scene.fogColor = new Color3(0.57, 0.72, 0.88);
scene.imageProcessingConfiguration.toneMappingEnabled = true;
scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
scene.imageProcessingConfiguration.exposure = 1.08;
scene.imageProcessingConfiguration.contrast = 1.0;

const skyDome = new PhotoDome(
  "munich-clear-day-sky",
  `${import.meta.env.BASE_URL}assets/sky/munich-clear-day-skybox.png`,
  {
    resolution: 48,
    size: 1_400,
    faceForward: false,
    generateMipMaps: true,
  },
  scene,
);
// PhotoDome's sphere is parented to its own transform, so Babylon's
// infiniteDistance flag alone does not recenter it for kilometre-scale world
// coordinates. Keep only its position on the walker; retaining an independent
// rotation makes the panorama feel fixed to Munich rather than to the camera.
skyDome.mesh.infiniteDistance = false;
skyDome.mesh.applyFog = false;
skyDome.mesh.isPickable = false;
skyDome.photoTexture.anisotropicFilteringLevel = 4;

const DEFAULT_DISTRICT: DistrictId = "schwabing";
const searchParams = new URLSearchParams(window.location.search);

function districtYaw(id: DistrictId): number {
  if (id === "center") return -0.2 - Math.PI;
  if (id === "schwabing") return -Math.PI / 2;
  return 0.72 - Math.PI;
}

const camera = new UniversalCamera("walker", DISTRICTS[DEFAULT_DISTRICT].position.clone(), scene);
camera.minZ = 0.08;
camera.maxZ = 2_000;
camera.inertia = 0.32;
camera.angularSensibility = 1_800;
camera.applyGravity = false;
camera.checkCollisions = true;
camera.ellipsoid = new Vector3(0.38, 0.92, 0.38);
// Keep the 1.84 m collision body grounded while placing the viewpoint at
// a 1.75 m standing eye level.
camera.ellipsoidOffset = new Vector3(0, 0.09, 0);
camera.keysUp = [];
camera.keysDown = [];
camera.keysLeft = [];
camera.keysRight = [];
camera.rotation.y = districtYaw(DEFAULT_DISTRICT);
skyDome.position.copyFrom(camera.position);
scene.onBeforeRenderObservable.add(() => skyDome.position.copyFrom(camera.position));
const preview = landmarkPreview(searchParams.get("landmark"));
if (preview) {
  camera.position.copyFrom(preview.position);
  camera.setTarget(preview.target);
  if (preview.fov) camera.fov = preview.fov;
  intro.classList.add("is-hidden");
}
camera.attachControl(canvas, true);
const keyboardMovement = new KeyboardMovement(camera, engine);

const skyLight = new HemisphericLight("sky-light", new Vector3(0.15, 1, 0.1), scene);
// A broad, blue-tinted skylight retains detail in shaded facades and gives the
// street the soft outdoor fill of a clear day. The directional sun still owns
// the crisp highlights and shadow direction.
skyLight.intensity = 0.78;
skyLight.diffuse = new Color3(0.78, 0.88, 1.0);
skyLight.groundColor = new Color3(0.24, 0.27, 0.24);

// A lower, side-on sun sends readable shadow edges across streets and plazas
// at all three starting viewpoints.
const sun = new DirectionalLight(
  "sun",
  new Vector3(-0.38, -0.70, -0.60).normalize(),
  scene,
);
sun.position = new Vector3(320, 620, -180);
sun.intensity = 1.52;
sun.diffuse = new Color3(1.0, 0.92, 0.80);

// URL overrides are intentionally session-local. Persisting an invisible
// `?shadows=off` test made later visits to the plain game URL stay disabled
// with no control explaining why.
const requestedShadowQuality = resolveShadowQuality(searchParams);
const sunShadows = new SunShadowController(scene, camera, sun, requestedShadowQuality);
const adaptivePerformance = new AdaptivePerformanceController(engine, window.devicePixelRatio, {
  onConstrainedModeChange: (constrained) => {
    // An explicit shadow query is a visual-quality contract for screenshots
    // and comparisons; automatic fallback only applies to ordinary play.
    if (!searchParams.has("shadows")) sunShadows.setTreeCastersEnabled(!constrained);
  },
});
const groundShadows = new GroundShadowSystem(scene, camera, sunShadows.maxDistance);
const vehicles = new VehicleSystem(scene, camera, engine, {
  hintElement: vehicleHint,
  drivingHudElement: drivingHud,
  speedElement: drivingSpeed,
  feedbackElement: drivingFeedback,
  setWalkingEnabled: (enabled) => keyboardMovement.setEnabled(enabled),
  setDrivingEnabled: (enabled) => document.body.classList.toggle("is-driving", enabled),
  sunShadows,
  groundShadows,
});
const trams = new TramSystem(scene, engine, groundShadows);
canvas.dataset.shadowQuality = sunShadows.enabled ? requestedShadowQuality : "off";
canvas.dataset.performanceMode = adaptivePerformance.mode;
canvas.dataset.renderPixelRatio = adaptivePerformance.renderPixelRatio.toFixed(2);

let firstLoad = true;
const streamer = new WorldStreamer(scene, (message, loadedCount, totalCount) => {
  status.textContent = message;
  const progress = firstLoad ? Math.min(100, 18 + loadedCount * 14) : Math.min(100, (loadedCount / Math.max(totalCount, 1)) * 100);
  loadingProgress.style.width = `${progress}%`;
  if (firstLoad && message === "Munich is ready") {
    firstLoad = false;
    loadingProgress.style.width = "100%";
    window.setTimeout(() => loading.classList.add("is-hidden"), 350);
  }
});
streamer.setTileLifecycleHandlers(
  (tile, shadowMeshes, parkingLayout) => {
    sunShadows.registerTile(tile.id, shadowMeshes);
    vehicles.addTile(tile, parkingLayout);
    trams.addTile(tile);
  },
  (tileId) => {
    sunShadows.unregisterTile(tileId);
    vehicles.removeTile(tileId);
    trams.removeTile(tileId);
  },
);

function requestPointerLock(): void {
  void canvas.requestPointerLock();
}

enterButton.addEventListener("click", () => {
  vehicles.unlockAudio();
  requestPointerLock();
});
canvas.addEventListener("click", () => {
  vehicles.unlockAudio();
  if (!firstLoad && document.pointerLockElement !== canvas) requestPointerLock();
});

document.addEventListener("pointerlockchange", () => {
  const active = document.pointerLockElement === canvas;
  document.body.classList.toggle("is-playing", active);
  enterButton.textContent = active ? "Exploring" : "Enter world";
  intro.classList.toggle("is-hidden", active);
});

const districtButtons = document.querySelectorAll<HTMLButtonElement>("[data-jump]");
for (const button of districtButtons) {
  button.addEventListener("click", () => {
    const id = button.dataset.jump as DistrictId;
    const target = DISTRICTS[id];
    if (!target) return;
    vehicles.prepareForTeleport();
    camera.position.copyFrom(target.position);
    camera.cameraDirection.set(0, 0, 0);
    camera.rotation.x = 0;
    camera.rotation.y = districtYaw(id);
    void streamer.loadAround(camera.position, true);
  });
}

let lastHudUpdate = 0;
let flightModeVisible = false;
scene.onBeforeRenderObservable.add(() => {
  vehicles.update();
  trams.update();
  groundShadows.update();
  keyboardMovement.update();
  if (!document.hidden) adaptivePerformance.update(engine.getDeltaTime(), performance.now());
  canvas.dataset.playerX = camera.position.x.toFixed(3);
  canvas.dataset.playerY = camera.position.y.toFixed(3);
  canvas.dataset.playerZ = camera.position.z.toFixed(3);
  canvas.dataset.grounded = String(keyboardMovement.isGrounded);
  canvas.dataset.flying = String(keyboardMovement.isFlying);
  if (keyboardMovement.isFlying !== flightModeVisible) {
    flightModeVisible = keyboardMovement.isFlying;
    document.body.classList.toggle("is-flying", flightModeVisible);
    flightHud.setAttribute("aria-hidden", String(!flightModeVisible));
  }
  void streamer.loadAround(camera.position);

  const now = performance.now();
  if (now - lastHudUpdate > 200) {
    lastHudUpdate = now;
    canvas.dataset.fps = engine.getFps().toFixed(1);
    canvas.dataset.shadowCasters = String(sunShadows.casterCount);
    canvas.dataset.treeShadows = String(sunShadows.treeShadowsEnabled);
    canvas.dataset.groundShadows = String(groundShadows.visibleCount);
    canvas.dataset.performanceMode = adaptivePerformance.mode;
    canvas.dataset.renderPixelRatio = adaptivePerformance.renderPixelRatio.toFixed(2);
    const district = closestDistrict(camera.position);
    const location = worldToLonLat(camera.position);
    districtLabel.textContent = `${DISTRICTS[district].label} · ${DISTRICTS[district].subtitle}`;
    coordinates.textContent = `${location.lat.toFixed(5)}° N · ${location.lon.toFixed(5)}° E`;
    for (const button of districtButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.jump === district));
    }
  }
});

window.addEventListener("resize", () => {
  adaptivePerformance.handleDevicePixelRatio(window.devicePixelRatio);
  engine.resize();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) adaptivePerformance.resetSampling(performance.now());
});

async function start(): Promise<void> {
  await Promise.all([
    streamer.initialize(camera.position),
    vehicles.initialize(),
  ]);
  await sunShadows.compile();
  attribution.textContent = streamer.getAttribution();
  createSchwabingDetails(scene);
  createLandmarkDetails(scene);
  await loadCustomAssets(scene);
  engine.runRenderLoop(() => scene.render());
}

void start().catch((error: unknown) => {
  console.error(error);
  loading.classList.remove("is-hidden");
  loading.innerHTML = "<strong>Munich could not be prepared.</strong><span>Check the browser console for details.</span>";
});
