// sprite-editor/snap-points.js - Snap point attachment system
// Single responsibility: Handle snap detection, attachment, and hierarchy transforms

import { state } from './state.js';
import { canAttachTo, SNAP_POINT_TYPES } from './constants.js';
import * as animation from './animation.js';
import { getWorldTransform as getWorldTransformBase } from '../transforms.js';

// Snap detection threshold in canvas pixels
const SNAP_THRESHOLD = 30;

// Current drag snap state (for visual feedback)
let candidateSnapPoint = null;  // { parentIndex, snapPointId, x, y, compatible }

/**
 * Find the nearest compatible snap point while dragging a part
 * @param {number} draggedPartIndex - Index of the part being dragged
 * @param {number} mouseX - Current mouse X in canvas coords
 * @param {number} mouseY - Current mouse Y in canvas coords
 * @returns {object|null} - { parentIndex, snapPointId, x, y, compatible } or null
 */
export function findNearestSnapPoint(draggedPartIndex, mouseX, mouseY) {
  const draggedPart = state.partsInVariant[draggedPartIndex];
  if (!draggedPart) return null;

  const draggedCategory = draggedPart.category;
  let nearest = null;
  let nearestDist = SNAP_THRESHOLD;


  // Check all other parts for snap points
  for (let i = 0; i < state.partsInVariant.length; i++) {
    if (i === draggedPartIndex) continue;  // Skip self

    const part = state.partsInVariant[i];
    if (!part.snapPoints || part.snapPoints.length === 0) continue;

    // Get part's world position (accounts for hierarchy)
    const world = getWorldTransform(i);
    const partX = world.x;
    const partY = world.y;
    const partRotation = world.rotation;
    const partScale = world.scale || 1;

    // Check each snap point on this part
    for (const snapPoint of part.snapPoints) {
      // Calculate snap point world position (rotate AND scale)
      const rad = partRotation * Math.PI / 180;
      const rotatedX = (snapPoint.x * Math.cos(rad) - snapPoint.y * Math.sin(rad)) * partScale;
      const rotatedY = (snapPoint.x * Math.sin(rad) + snapPoint.y * Math.cos(rad)) * partScale;
      const snapX = partX + rotatedX;
      const snapY = partY + rotatedY;

      // Check distance
      const dist = Math.hypot(mouseX - snapX, mouseY - snapY);
      if (dist < nearestDist) {
        // Check if already occupied by another part
        const isOccupied = state.partsInVariant.some((p, idx) =>
          idx !== draggedPartIndex &&
          p.parentIndex === i &&
          p.attachedTo === snapPoint.id
        );

        if (isOccupied) continue;  // Skip occupied snap points

        // Check compatibility
        const compatible = draggedCategory ? canAttachTo(draggedCategory, snapPoint.type) : false;

        nearestDist = dist;
        nearest = {
          parentIndex: i,
          snapPointId: snapPoint.id,
          snapPointType: snapPoint.type,
          x: snapX,
          y: snapY,
          compatible
        };
      }
    }
  }

  return nearest;
}

/**
 * Update the candidate snap point during drag (for visual feedback)
 */
export function updateCandidateSnapPoint(draggedPartIndex, mouseX, mouseY) {
  candidateSnapPoint = findNearestSnapPoint(draggedPartIndex, mouseX, mouseY);
  return candidateSnapPoint;
}

/**
 * Get current candidate snap point (for rendering)
 */
export function getCandidateSnapPoint() {
  return candidateSnapPoint;
}

/**
 * Clear candidate snap point (after drag ends)
 */
export function clearCandidateSnapPoint() {
  candidateSnapPoint = null;
}

/**
 * Attach a part to a snap point on another part
 * @param {number} partIndex - Index of the part to attach
 * @param {number} parentIndex - Index of the parent part
 * @param {string} snapPointId - ID of the snap point to attach to
 * @returns {boolean} - Success
 */
export function attachPartToSnapPoint(partIndex, parentIndex, snapPointId) {
  const part = state.partsInVariant[partIndex];
  const parent = state.partsInVariant[parentIndex];

  if (!part || !parent) return false;

  const snapPoint = parent.snapPoints?.find(sp => sp.id === snapPointId);
  if (!snapPoint) return false;

  // Check compatibility
  if (part.category && !canAttachTo(part.category, snapPoint.type)) {
    return false;
  }

  // Calculate snap point world position (accounts for parent hierarchy)
  const parentWorld = getWorldTransform(parentIndex);
  const rad = parentWorld.rotation * Math.PI / 180;
  const rotatedX = snapPoint.x * Math.cos(rad) - snapPoint.y * Math.sin(rad);
  const rotatedY = snapPoint.x * Math.sin(rad) + snapPoint.y * Math.cos(rad);
  const snapX = parentWorld.x + rotatedX;
  const snapY = parentWorld.y + rotatedY;

  // Find the part's attachment origin - a snap point of matching type
  // This is where the part attaches FROM (e.g., cannon's base connects to cannon_mount)
  const originPoint = part.snapPoints?.find(sp => sp.type === snapPoint.type);
  const originOffsetX = originPoint?.x || 0;
  const originOffsetY = originPoint?.y || 0;

  // Position part so its origin point aligns with parent's snap point
  // (not the part's center, but its attachment point)
  part.x = snapX - originOffsetX;
  part.y = snapY - originOffsetY;

  // Set attachment
  part.parentIndex = parentIndex;
  part.attachedTo = snapPointId;
  part.inheritRotation = true;  // Default: rotate with parent

  return true;
}

/**
 * Detach a part from its parent
 * @param {number} partIndex - Index of the part to detach
 * @returns {boolean} - Success
 */
export function detachPart(partIndex) {
  const part = state.partsInVariant[partIndex];
  if (!part || part.parentIndex === null) return false;

  part.parentIndex = null;
  part.attachedTo = null;

  return true;
}

/**
 * Check if a part is attached to another part
 */
export function isPartAttached(partIndex) {
  const part = state.partsInVariant[partIndex];
  return part && part.parentIndex !== null;
}

/**
 * Get all parts attached to a given parent
 */
export function getAttachedParts(parentIndex) {
  return state.partsInVariant
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part.parentIndex === parentIndex);
}

/**
 * Get the world transform for a part (accounting for hierarchy)
 * This is used for rendering and snap point calculations
 * Wrapper around shared transforms.js for editor state
 */
export function getWorldTransform(partIndex) {
  return getWorldTransformBase(state.partsInVariant, partIndex);
}

/**
 * Get the world transform for a part with animation applied through hierarchy
 * @param {number} partIndex - Index of the part
 * @param {number} animTime - Current animation time
 * @param {string} animState - Current animation state (idle, move, aim, etc.)
 * @param {object} extra - Optional extra params like { aimAngle: 45 } for aim-based animations
 * @returns {object|null} - World transform with animation applied
 */
export function getAnimatedWorldTransform(partIndex, animTime, animState, extra = {}) {
  const part = state.partsInVariant[partIndex];
  if (!part) return null;

  // Helper to get animated values for a part
  const getAnimatedValues = (p) => {
    // Check for both old (animation) and new (animations) formats
    if (!p.animation && !p.animations) {
      return { x: p.x, y: p.y, rotation: p.rotation || 0, scale: p.scale || 1, offsetIsWorld: false };
    }
    // applyAnimation handles both formats, pass extra for aim-based animations
    const animated = animation.applyAnimation(p, animTime, animState, extra);
    return {
      x: animated.animatedX ?? p.x,
      y: animated.animatedY ?? p.y,
      rotation: animated.animatedRotation ?? (p.rotation || 0),
      scale: animated.animatedScale ?? (p.scale || 1),
      offsetIsWorld: animated.offsetIsWorld || false,
      // Raw offsets for hierarchy calculation (before adding to base position)
      rawOffsetX: animated.animOffsetX || 0,
      rawOffsetY: animated.animOffsetY || 0
    };
  };

  // If no parent, return animated direct values
  if (part.parentIndex === null) {
    const anim = getAnimatedValues(part);
    return {
      x: anim.x,
      y: anim.y,
      rotation: anim.rotation,
      scale: anim.scale
    };
  }

  // Get parent's animated world transform (recursive)
  const parentWorld = getAnimatedWorldTransform(part.parentIndex, animTime, animState, extra);
  if (!parentWorld) {
    const anim = getAnimatedValues(part);
    return {
      x: anim.x,
      y: anim.y,
      rotation: anim.rotation,
      scale: anim.scale
    };
  }

  const parent = state.partsInVariant[part.parentIndex];
  const snapPoint = parent?.snapPoints?.find(sp => sp.id === part.attachedTo);

  // Part's local values (with animation applied)
  const partAnim = getAnimatedValues(part);
  const localRotation = partAnim.rotation;
  const rad = parentWorld.rotation * Math.PI / 180;
  const parentScale = parentWorld.scale || 1;

  // Calculate world rotation (common for both attached and unattached)
  const worldRotation = part.inheritRotation !== false ? parentWorld.rotation + localRotation : localRotation;

  // Animation offset (use raw offsets if available, otherwise calculate from position)
  const animOffsetX = partAnim.rawOffsetX || (partAnim.x - part.x);
  const animOffsetY = partAnim.rawOffsetY || (partAnim.y - part.y);
  const offsetIsWorld = partAnim.offsetIsWorld;

  // Children always inherit parent scale
  const childScale = parentScale * partAnim.scale;

  // Helper: apply animation offset to position
  const applyAnimOffset = (baseX, baseY) => {
    if (animOffsetX === 0 && animOffsetY === 0) return { x: baseX, y: baseY };

    if (offsetIsWorld) {
      // Offset is already in world coordinates (e.g., aim-based recoil)
      return {
        x: baseX + animOffsetX * childScale,
        y: baseY + animOffsetY * childScale
      };
    } else {
      // Offset is in local coordinates, rotate by worldRotation
      const worldRad = worldRotation * Math.PI / 180;
      return {
        x: baseX + (animOffsetX * Math.cos(worldRad) - animOffsetY * Math.sin(worldRad)) * childScale,
        y: baseY + (animOffsetX * Math.sin(worldRad) + animOffsetY * Math.cos(worldRad)) * childScale
      };
    }
  };

  // Check if this is an unattached child (has parent but no snap point)
  if (!snapPoint) {
    // Part's base x/y is offset from parent center, rotate and scale by parent's transform
    const offsetX = part.x;
    const offsetY = part.y;
    const rotatedOffsetX = (offsetX * Math.cos(rad) - offsetY * Math.sin(rad)) * parentScale;
    const rotatedOffsetY = (offsetX * Math.sin(rad) + offsetY * Math.cos(rad)) * parentScale;

    const baseX = parentWorld.x + rotatedOffsetX;
    const baseY = parentWorld.y + rotatedOffsetY;
    const { x: worldX, y: worldY } = applyAnimOffset(baseX, baseY);

    return {
      x: worldX,
      y: worldY,
      rotation: worldRotation,
      scale: childScale,
      originOffsetX: 0,
      originOffsetY: 0,
      isAttached: false
    };
  }

  // Snap point attached child

  const snapX = snapPoint.x || 0;
  const snapY = snapPoint.y || 0;

  // Find the child part's attachment origin (snap point of matching type)
  const originPoint = part.snapPoints?.find(sp => sp.type === snapPoint?.type);
  const originX = originPoint?.x || 0;
  const originY = originPoint?.y || 0;

  // Rotate AND scale parent's snap point position by parent's ANIMATED world transform
  const rotatedSnapX = (snapX * Math.cos(rad) - snapY * Math.sin(rad)) * parentScale;
  const rotatedSnapY = (snapX * Math.sin(rad) + snapY * Math.cos(rad)) * parentScale;

  // Anchor point = snap point world position
  const baseX = parentWorld.x + rotatedSnapX;
  const baseY = parentWorld.y + rotatedSnapY;
  const { x: anchorX, y: anchorY } = applyAnimOffset(baseX, baseY);

  return {
    x: anchorX,
    y: anchorY,
    rotation: worldRotation,
    scale: childScale,
    originOffsetX: originX,
    originOffsetY: originY,
    isAttached: true
  };
}

/**
 * Get the world position of a specific snap point on a part
 * @param {number} partIndex - Index of the part
 * @param {string} snapPointId - ID of the snap point
 * @returns {object|null} - { x, y } world position or null
 */
export function getSnapPointWorldPosition(partIndex, snapPointId) {
  const part = state.partsInVariant[partIndex];
  if (!part) return null;

  const snapPoint = part.snapPoints?.find(sp => sp.id === snapPointId);
  if (!snapPoint) return null;

  // Get part's world transform
  const world = getWorldTransform(partIndex);
  const rad = world.rotation * Math.PI / 180;
  const scale = world.scale || 1;

  // Rotate AND scale snap point offset by world transform
  const rotatedX = (snapPoint.x * Math.cos(rad) - snapPoint.y * Math.sin(rad)) * scale;
  const rotatedY = (snapPoint.x * Math.sin(rad) + snapPoint.y * Math.cos(rad)) * scale;

  return {
    x: world.x + rotatedX,
    y: world.y + rotatedY
  };
}

/**
 * Hit test to find a snap point at given position
 * @param {number} x - Canvas X position
 * @param {number} y - Canvas Y position
 * @param {number} threshold - Hit radius in pixels (default 15)
 * @returns {object|null} - { partIndex, snapPoint, worldX, worldY, isOccupied } or null
 */
export function hitTestSnapPoint(x, y, threshold = 15) {
  const allPoints = getAllSnapPointsInVariant();

  for (const sp of allPoints) {
    const dist = Math.hypot(x - sp.worldX, y - sp.worldY);
    if (dist < threshold) {
      return sp;
    }
  }

  return null;
}

/**
 * Get all snap points from all parts in the variant (for rendering)
 * Returns world positions (accounts for part hierarchy)
 */
export function getAllSnapPointsInVariant() {
  const result = [];

  for (let i = 0; i < state.partsInVariant.length; i++) {
    const part = state.partsInVariant[i];
    if (!part.snapPoints || part.snapPoints.length === 0) continue;

    // Get the parent's snap point type if this part is attached
    // We'll skip the "origin" snap point (the one used to attach to parent)
    let attachedToType = null;
    if (part.parentIndex !== null && part.attachedTo) {
      const parent = state.partsInVariant[part.parentIndex];
      const parentSnapPoint = parent?.snapPoints?.find(sp => sp.id === part.attachedTo);
      attachedToType = parentSnapPoint?.type;
    }

    // Use world transform to get the actual rendered position (accounts for hierarchy)
    const world = getWorldTransform(i);
    const partX = world.x;
    const partY = world.y;
    const partRotation = world.rotation;
    const partScale = world.scale || 1;
    const rad = partRotation * Math.PI / 180;

    for (const snapPoint of part.snapPoints) {
      // Skip the "origin" snap point on attached parts (it's being used for attachment)
      // This prevents duplicate snap points at the attachment location
      if (attachedToType && snapPoint.type === attachedToType) {
        continue;
      }

      // Calculate world position (rotate AND scale snap offset by world transform)
      const rotatedX = (snapPoint.x * Math.cos(rad) - snapPoint.y * Math.sin(rad)) * partScale;
      const rotatedY = (snapPoint.x * Math.sin(rad) + snapPoint.y * Math.cos(rad)) * partScale;

      // Check if occupied
      const isOccupied = state.partsInVariant.some(p =>
        p.parentIndex === i && p.attachedTo === snapPoint.id
      );

      result.push({
        partIndex: i,
        snapPoint,
        worldX: partX + rotatedX,
        worldY: partY + rotatedY,
        isOccupied,
        typeInfo: SNAP_POINT_TYPES[snapPoint.type] || { color: '#888' }
      });
    }
  }

  return result;
}
