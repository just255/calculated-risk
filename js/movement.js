// ═══════════════════════════════════════════════════════════════
// MOVEMENT - Shared tank/vehicle movement helpers
// Used by game.js (campaign) and test-mode.js (terrain editor)
// ═══════════════════════════════════════════════════════════════

export const VEHICLE_TURN_RATES = {
  tank: {
    hull: Math.PI * 0.8,    // ~144 deg/sec - tanks turn slowly
    turret: Math.PI * 1.5   // ~270 deg/sec - turrets turn faster
  },
  light: {
    hull: Math.PI * 1.2,    // ~216 deg/sec - light vehicles turn faster
    turret: Math.PI * 2.0   // ~360 deg/sec
  }
};

/**
 * Normalize angle to -PI to PI range
 */
export function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

/**
 * Smoothly rotate an angle toward a target angle at a max speed
 * Handles angle wrapping correctly (takes shortest path)
 */
export function smoothRotateToward(current, target, maxDelta) {
  current = normalizeAngle(current);
  target = normalizeAngle(target);

  let diff = target - current;
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;

  if (Math.abs(diff) <= maxDelta) {
    return target;
  }

  return normalizeAngle(current + Math.sign(diff) * maxDelta);
}

/**
 * Parse keyboard input into tank controls
 * W = forward, S = backward, A = turn left, D = turn right
 */
export function parseTankInput(keys) {
  let moveInput = 0;
  let turnInput = 0;

  if (keys.w) moveInput = 1;
  if (keys.s) moveInput = -1;
  if (keys.a) turnInput = -1;
  if (keys.d) turnInput = 1;

  return { moveInput, turnInput };
}

/**
 * Apply tank controls to update hull angle and calculate movement
 * @param {number} hullAngle - Current hull angle in radians
 * @param {number} moveInput - Forward/backward (-1 to 1)
 * @param {number} turnInput - Left/right turn (-1 to 1)
 * @param {number} hullTurnRate - Radians/sec
 * @param {number} dtSec - Delta time in seconds
 * @returns {{ hullAngle, dx, dy, isMoving }}
 */
export function applyTankMovement(hullAngle, moveInput, turnInput, hullTurnRate, dtSec) {
  // Invert turn when reversing so D always steers right from the player's perspective
  const effectiveTurn = moveInput < 0 ? -turnInput : turnInput;

  // Apply hull turning
  if (effectiveTurn !== 0) {
    hullAngle = normalizeAngle(hullAngle + effectiveTurn * hullTurnRate * dtSec);
  }

  const isMoving = moveInput !== 0;
  let dx = 0, dy = 0;
  if (isMoving) {
    dx = Math.cos(hullAngle) * moveInput;
    dy = Math.sin(hullAngle) * moveInput;
  }

  return { hullAngle, dx, dy, isMoving };
}

// ═══════════════════════════════════════════════════════════════
// EXTENDED - Turret aiming + joystick support (shared by game.js and test-mode.js)
// ═══════════════════════════════════════════════════════════════

/**
 * Smoothly rotate turret toward target angle (pure function)
 * @param {number} currentAngle - Current turret angle in radians
 * @param {number} targetAngle - Target angle in radians
 * @param {number} turretTurnRate - Radians/sec
 * @param {number} dtSec - Delta time in seconds
 * @returns {number} New turret angle
 */
export function applyTurretAim(currentAngle, targetAngle, turretTurnRate, dtSec) {
  return smoothRotateToward(currentAngle, targetAngle, turretTurnRate * dtSec);
}

/**
 * Convert screen mouse position to world aim angle
 * Supports both viewport-style camera (editor: { x, y, zoom }) and offset camera (game: { x, y })
 * @param {number} entityX - Entity world X
 * @param {number} entityY - Entity world Y
 * @param {number} mouseScreenX - Mouse screen X
 * @param {number} mouseScreenY - Mouse screen Y
 * @param {object} camera - Camera: { x, y, zoom? }. If zoom present, x/y are viewport offsets.
 *                          If no zoom, x/y are world-space camera offsets (game-style).
 * @returns {number} Aim angle in radians
 */
export function calculateAimAngle(entityX, entityY, mouseScreenX, mouseScreenY, camera) {
  let worldMouseX, worldMouseY;
  if (camera.zoom != null) {
    // Editor-style viewport: screen → world = (screen - offset) / zoom
    worldMouseX = (mouseScreenX - camera.x) / camera.zoom;
    worldMouseY = (mouseScreenY - camera.y) / camera.zoom;
  } else {
    // Game-style camera offset: world = screen + camera
    worldMouseX = mouseScreenX + camera.x;
    worldMouseY = mouseScreenY + camera.y;
  }
  return Math.atan2(worldMouseY - entityY, worldMouseX - entityX);
}

/**
 * Parse input into tank control values with joystick support
 * @param {object} keys - Keyboard state { w, s, a, d }
 * @param {object|null} joystickInput - Joystick { dx, dy } or null
 * @param {number} currentHullAngle - Current hull angle for reverse-zone calc
 * @param {object} [settings] - { deadzone, reverseCone (radians) }
 * @returns {{ moveInput, turnInput, targetHullAngle }}
 */
export function parseTankInputExtended(keys, joystickInput, currentHullAngle = 0, settings = {}) {
  const deadzone = settings.deadzone ?? 0.25;
  const reverseCone = settings.reverseCone ?? (22 * Math.PI / 180);

  let moveInput = 0;
  let turnInput = 0;
  let targetHullAngle = null;

  if (joystickInput && (joystickInput.dx !== 0 || joystickInput.dy !== 0)) {
    const magnitude = Math.sqrt(joystickInput.dx * joystickInput.dx + joystickInput.dy * joystickInput.dy);

    targetHullAngle = Math.atan2(joystickInput.dy, joystickInput.dx);

    let angleDiff = targetHullAngle - currentHullAngle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    const isReverseZone = Math.abs(angleDiff) > Math.PI - reverseCone;

    if (isReverseZone) {
      targetHullAngle = normalizeAngle(targetHullAngle + Math.PI);
      if (magnitude > deadzone) {
        moveInput = -((magnitude - deadzone) / (1 - deadzone));
      }
    } else {
      if (magnitude > deadzone) {
        moveInput = (magnitude - deadzone) / (1 - deadzone);
      }
    }
  } else if (keys) {
    const kb = parseTankInput(keys);
    moveInput = kb.moveInput;
    turnInput = kb.turnInput;
  }

  return { moveInput, turnInput, targetHullAngle };
}

/**
 * Apply tank controls with joystick targetHullAngle support (pure function)
 * When targetHullAngle is set (joystick), smoothly rotates hull toward it.
 * When null (keyboard), uses turnInput for direct rotation.
 * @param {number} hullAngle - Current hull angle in radians
 * @param {number} moveInput - Forward/backward (-1 to 1)
 * @param {number} turnInput - Left/right turn (-1 to 1)
 * @param {number|null} targetHullAngle - Joystick target angle or null
 * @param {number} hullTurnRate - Radians/sec
 * @param {number} dtSec - Delta time in seconds
 * @returns {{ hullAngle, dx, dy, isMoving }}
 */
export function applyTankMovementExtended(hullAngle, moveInput, turnInput, targetHullAngle, hullTurnRate, dtSec) {
  // Invert turn when reversing so D always steers right from the player's perspective
  const effectiveTurn = moveInput < 0 ? -turnInput : turnInput;

  if (targetHullAngle !== null) {
    hullAngle = smoothRotateToward(hullAngle, targetHullAngle, hullTurnRate * dtSec);
  } else if (effectiveTurn !== 0) {
    hullAngle = normalizeAngle(hullAngle + effectiveTurn * hullTurnRate * dtSec);
  }

  const isMoving = moveInput !== 0;
  let dx = 0, dy = 0;
  if (isMoving) {
    dx = Math.cos(hullAngle) * moveInput;
    dy = Math.sin(hullAngle) * moveInput;
  }

  return { hullAngle, dx, dy, isMoving };
}
