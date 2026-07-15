import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Ray } from "@babylonjs/core/Culling/ray";
import type { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import type { Engine } from "@babylonjs/core/Engines/engine";

const movementCodes = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowLeft",
  "ArrowDown",
  "ArrowRight",
]);

export class KeyboardMovement {
  private readonly pressed = new Set<string>();
  private enabled = true;
  private sprinting = false;
  private flying = false;
  private grounded = false;
  private verticalVelocity = 0;
  private jumpRequestedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly camera: UniversalCamera,
    private readonly engine: Engine,
    private readonly walkingSpeed = 4.6,
    private readonly sprintSpeed = 8.2,
    private readonly jumpSpeed = 5.7,
    private readonly gravity = 16,
  ) {
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp, { passive: false });
    window.addEventListener("blur", this.clear);
  }

  update(): void {
    if (!this.enabled) return;
    const deltaSeconds = Math.min(this.engine.getDeltaTime() / 1_000, 0.05);
    this.applyVerticalMovement(deltaSeconds);
    this.applyMovement(deltaSeconds);
  }

  get isGrounded(): boolean {
    return this.grounded;
  }

  get isFlying(): boolean {
    return this.flying;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.flying = false;
    this.clear();
    this.verticalVelocity = 0;
    this.camera.cameraDirection.setAll(0);
  }

  private applyVerticalMovement(deltaSeconds: number): void {
    if (this.flying) {
      const vertical = this.axis("Space", "Space")
        - this.axis("ControlLeft", "ControlRight");
      const speed = this.sprinting ? this.sprintSpeed : this.walkingSpeed;
      this.grounded = false;
      this.verticalVelocity = 0;
      this.camera.cameraDirection.y = vertical * speed * deltaSeconds;
      return;
    }

    // FreeCamera collision coordinates place the ellipsoid center one radius
    // below the camera before applying the configured offset.
    const standingHeight = this.camera.ellipsoid.y * 2 - this.camera.ellipsoidOffset.y;
    const ray = new Ray(this.camera.position, Vector3.Down(), standingHeight + 0.08);
    const hit = this.camera.getScene().pickWithRay(
      ray,
      (mesh) => mesh.isPickable && mesh.checkCollisions,
      false,
    );
    const hasGroundContact = Boolean(hit?.hit && hit.distance <= standingHeight + 0.055);

    if (hasGroundContact && this.verticalVelocity <= 0) {
      this.grounded = true;
      this.verticalVelocity = 0;
    } else {
      this.grounded = false;
    }

    const hasBufferedJump = performance.now() - this.jumpRequestedAt < 160;
    if (this.grounded && hasBufferedJump) {
      this.verticalVelocity = this.jumpSpeed;
      this.grounded = false;
      this.jumpRequestedAt = Number.NEGATIVE_INFINITY;
    }

    if (!this.grounded) this.verticalVelocity -= this.gravity * deltaSeconds;
    this.camera.cameraDirection.y = this.grounded ? 0 : this.verticalVelocity * deltaSeconds;
  }

  private applyMovement(deltaSeconds: number): void {
    const sideways = this.axis("KeyD", "ArrowRight") - this.axis("KeyA", "ArrowLeft");
    const forward = this.axis("KeyW", "ArrowUp") - this.axis("KeyS", "ArrowDown");
    if (sideways === 0 && forward === 0) return;

    const scene = this.camera.getScene();
    const forwardBasis = this.camera.getDirection(Vector3.Forward(scene.useRightHandedSystem));
    const rightBasis = this.camera.getDirection(Vector3.Right());
    forwardBasis.y = 0;
    rightBasis.y = 0;
    forwardBasis.normalize();
    rightBasis.normalize();
    const direction = forwardBasis.scale(forward).addInPlace(rightBasis.scale(sideways)).normalize();
    const speed = this.sprinting ? this.sprintSpeed : this.walkingSpeed;
    this.camera.cameraDirection.addInPlace(direction.scale(speed * deltaSeconds));
  }

  private axis(primary: string, alternate: string): number {
    return this.pressed.has(primary) || this.pressed.has(alternate) ? 1 : 0;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) return;
    if (event.code === "KeyG" && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
      this.flying = !this.flying;
      this.grounded = false;
      this.verticalVelocity = 0;
      this.jumpRequestedAt = Number.NEGATIVE_INFINITY;
      this.pressed.delete("Space");
      this.pressed.delete("ControlLeft");
      this.pressed.delete("ControlRight");
      this.camera.cameraDirection.y = 0;
      event.preventDefault();
      return;
    }
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
      this.sprinting = true;
      return;
    }
    if (this.flying && (event.code === "Space" || event.code === "ControlLeft" || event.code === "ControlRight")) {
      this.pressed.add(event.code);
      event.preventDefault();
      return;
    }
    if (event.code === "Space" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (!event.repeat) this.jumpRequestedAt = performance.now();
      event.preventDefault();
      return;
    }
    if (!movementCodes.has(event.code) || (event.ctrlKey && !this.flying) || event.metaKey || event.altKey) return;
    const isNewPress = !this.pressed.has(event.code);
    this.pressed.add(event.code);
    if (isNewPress) this.applyMovement(1 / 60);
    event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
      this.sprinting = false;
      return;
    }
    if (event.code === "Space") {
      this.pressed.delete(event.code);
      event.preventDefault();
      return;
    }
    if (event.code === "ControlLeft" || event.code === "ControlRight") {
      this.pressed.delete(event.code);
      if (this.flying) event.preventDefault();
      return;
    }
    if (!movementCodes.has(event.code)) return;
    this.pressed.delete(event.code);
    event.preventDefault();
  };

  private readonly clear = (): void => {
    this.pressed.clear();
    this.sprinting = false;
  };
}
