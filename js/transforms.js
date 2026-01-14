// transforms.js - Shared transform calculations for sprite hierarchies
// Single responsibility: Calculate world transforms from part data
// Used by both sprite editor and game runtime

/**
 * Get the world transform for a part (accounting for hierarchy)
 * @param {Array} parts - Array of part objects
 * @param {number} partIndex - Index of the part to calculate transform for
 * @returns {object|null} - World transform { x, y, rotation, scale, originOffsetX, originOffsetY, isAttached }
 */
export function getWorldTransform(parts, partIndex) {
  const part = parts[partIndex];
  if (!part) return null;

  // If no parent, return direct values
  if (part.parentIndex === null || part.parentIndex === undefined) {
    return {
      x: part.x || 0,
      y: part.y || 0,
      rotation: part.rotation || 0,
      scale: part.scale || 1,
      originOffsetX: 0,
      originOffsetY: 0,
      isAttached: false
    };
  }

  // Get parent's world transform (recursive)
  const parentWorld = getWorldTransform(parts, part.parentIndex);
  if (!parentWorld) {
    // Fallback if parent doesn't exist
    return {
      x: part.x || 0,
      y: part.y || 0,
      rotation: part.rotation || 0,
      scale: part.scale || 1,
      originOffsetX: 0,
      originOffsetY: 0,
      isAttached: false
    };
  }

  const parent = parts[part.parentIndex];
  const snapPoint = parent?.snapPoints?.find(sp => sp.id === part.attachedTo);

  // Part's local rotation offset
  const localRotation = part.rotation || 0;
  const rad = parentWorld.rotation * Math.PI / 180;
  const parentScale = parentWorld.scale || 1;

  // Calculate world rotation (common for both attached and unattached)
  const worldRotation = part.inheritRotation !== false ? parentWorld.rotation + localRotation : localRotation;

  // Children always inherit parent scale
  const childScale = parentScale * (part.scale || 1);

  // Check if this is an unattached child (has parent but no snap point)
  if (!snapPoint) {
    // Part's x/y is offset from parent center, rotate and scale by parent's transform
    const offsetX = part.x || 0;
    const offsetY = part.y || 0;
    const rotatedOffsetX = (offsetX * Math.cos(rad) - offsetY * Math.sin(rad)) * parentScale;
    const rotatedOffsetY = (offsetX * Math.sin(rad) + offsetY * Math.cos(rad)) * parentScale;

    return {
      x: parentWorld.x + rotatedOffsetX,
      y: parentWorld.y + rotatedOffsetY,
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

  // Rotate AND scale parent's snap point position by parent's world transform
  const rotatedSnapX = (snapX * Math.cos(rad) - snapY * Math.sin(rad)) * parentScale;
  const rotatedSnapY = (snapX * Math.sin(rad) + snapY * Math.cos(rad)) * parentScale;

  // Anchor point = snap point world position
  const anchorX = parentWorld.x + rotatedSnapX;
  const anchorY = parentWorld.y + rotatedSnapY;

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
 * Calculate all world transforms for a parts array
 * @param {Array} parts - Array of part objects
 * @returns {Array} - Array of world transforms matching parts array indices
 */
export function getAllWorldTransforms(parts) {
  if (!parts || !Array.isArray(parts)) return [];
  return parts.map((_, index) => getWorldTransform(parts, index));
}
