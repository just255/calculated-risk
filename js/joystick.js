// ═══════════════════════════════════════════════════════════════
// JOYSTICK - Virtual joystick system for mobile controls
// ═══════════════════════════════════════════════════════════════

import { Game } from './state.js';

// Default values (used if settings not available)
const DEFAULTS = {
  activationRadius: 80,
  dragThreshold: 8
};

// Get activation radius from settings or default
export function getActivationRadius() {
  return Game.settings?.controls?.joystickActivationRadius ?? DEFAULTS.activationRadius;
}

// Get drag threshold from settings or default
export function getDragThreshold() {
  return Game.settings?.controls?.joystickDragThreshold ?? DEFAULTS.dragThreshold;
}

// Movement joystick state
export const moveJoystick = {
  active: false,
  pending: false,    // Touch started near anchor but not yet dragging
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  touchId: null,
  anchorX: 0,
  anchorY: 0
};

// Shoot joystick state
export const shootJoystick = {
  active: false,
  pending: false,    // Touch started near anchor but not yet dragging
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  touchId: null,
  firing: false,
  anchorX: 0,
  anchorY: 0
};

// Export for backwards compatibility (use getDragThreshold() for dynamic value)
export const JOYSTICK_DRAG_THRESHOLD = DEFAULTS.dragThreshold;

// Initialize anchor positions (call on load and resize)
export function initJoystickAnchors() {
  moveJoystick.anchorX = window.innerWidth * 0.2;
  moveJoystick.anchorY = window.innerHeight * 0.8;
  shootJoystick.anchorX = window.innerWidth * 0.8;
  shootJoystick.anchorY = window.innerHeight * 0.8;
}

// Check if a position is near either joystick anchor
// Returns 'move', 'shoot', or null
export function getNearJoystickAnchor(x, y) {
  const radius = getActivationRadius();
  const moveDist = Math.sqrt(
    Math.pow(x - moveJoystick.anchorX, 2) +
    Math.pow(y - moveJoystick.anchorY, 2)
  );
  const shootDist = Math.sqrt(
    Math.pow(x - shootJoystick.anchorX, 2) +
    Math.pow(y - shootJoystick.anchorY, 2)
  );

  if (moveDist <= radius) return 'move';
  if (shootDist <= radius) return 'shoot';
  return null;
}

// Check if touch coordinates are near a joystick (for gesture filtering)
export function isTouchNearJoystick(touch) {
  return getNearJoystickAnchor(touch.clientX, touch.clientY) !== null;
}

// Check if either joystick is actively being used (not just pending)
export function isJoystickActive() {
  return moveJoystick.active || shootJoystick.active;
}

// Reposition a joystick anchor
export function setJoystickAnchor(which, x, y) {
  if (which === 'move') {
    moveJoystick.anchorX = x;
    moveJoystick.anchorY = y;
  } else if (which === 'shoot') {
    shootJoystick.anchorX = x;
    shootJoystick.anchorY = y;
  }
}

// Get the closest joystick type based on screen side
export function getClosestJoystickSide(x) {
  const screenMid = window.innerWidth / 2;
  return x < screenMid ? 'move' : 'shoot';
}

// Initialize on load
initJoystickAnchors();

// Re-init on resize
window.addEventListener('resize', initJoystickAnchors);
