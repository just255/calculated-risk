// sprite-editor/variants.js - Variant Builder management
// Single responsibility: Manage part composition for variants

import { state } from './state.js';

// Multi-selection state
let selectedPartIndices = new Set();

// Initialize variant builder
export function initVariantBuilder() {
  state.partsInVariant = [];
  state.selectedPartInVariant = null;
  selectedPartIndices.clear();
}

// Add a part to the variant
export function addPartToVariant(partData) {
  const partInVariant = {
    partId: partData.id,
    name: partData.name,
    image: partData.thumbnail || null,  // URL to the part image
    x: state.canvasWidth / 2,
    y: state.canvasHeight / 2,
    rotation: 0,
    scale: 1,
    opacity: 100,
    visible: true,
    zIndex: state.partsInVariant.length,
    // Multi-trigger animation system
    // Each trigger can have its own animation config or null
    animations: {
      idle: null,
      move: null,
      aim: null,
      fire: null,
      hit: null
    },
    // Pivot point for rotation (absolute canvas coordinates)
    // null = use part's position (default behavior)
    // Set to specific x,y to share pivot between parts
    pivotX: null,
    pivotY: null,
    // Part category and snap points (copied from part definition)
    category: partData.category || null,
    snapPoints: partData.snapPoints ? [...partData.snapPoints] : [],
    // Hierarchy: parent attachment
    parentIndex: null,         // Index of parent part (null = root)
    attachedTo: null,          // ID of snap point on parent
    inheritRotation: true,     // Rotate with parent
    inheritScale: false        // Keep own scale
  };

  state.partsInVariant.push(partInVariant);
  state.selectedPartInVariant = state.partsInVariant.length - 1;

  return partInVariant;
}

// Toggle part visibility
export function togglePartVisibility(index) {
  if (index >= 0 && index < state.partsInVariant.length) {
    state.partsInVariant[index].visible = !state.partsInVariant[index].visible;
    return true;
  }
  return false;
}

// Select a part in the variant (clears multi-selection by default)
export function selectPartInVariant(index, additive = false) {
  if (index >= 0 && index < state.partsInVariant.length) {
    if (additive) {
      // Shift+click: toggle in multi-selection
      if (selectedPartIndices.has(index)) {
        selectedPartIndices.delete(index);
        // If removed and was primary, pick another or clear
        if (state.selectedPartInVariant === index) {
          state.selectedPartInVariant = selectedPartIndices.size > 0
            ? [...selectedPartIndices][0]
            : null;
        }
      } else {
        selectedPartIndices.add(index);
        state.selectedPartInVariant = index;
      }
    } else {
      // Normal click: single selection
      selectedPartIndices.clear();
      selectedPartIndices.add(index);
      state.selectedPartInVariant = index;
    }
    return state.partsInVariant[index];
  }
  state.selectedPartInVariant = null;
  selectedPartIndices.clear();
  return null;
}

// Select all parts
export function selectAllParts() {
  selectedPartIndices.clear();
  state.partsInVariant.forEach((_, i) => selectedPartIndices.add(i));
  if (state.partsInVariant.length > 0) {
    state.selectedPartInVariant = 0;
  }
  return selectedPartIndices.size;
}

// Clear multi-selection
export function clearMultiSelection() {
  selectedPartIndices.clear();
  state.selectedPartInVariant = null;
}

// Get selected part indices
export function getSelectedPartIndices() {
  return selectedPartIndices;
}

// Check if part is in multi-selection
export function isPartSelected(index) {
  return selectedPartIndices.has(index);
}

// Restore part selection from saved state (for undo/redo)
export function restorePartSelection(indices, primaryIndex) {
  selectedPartIndices.clear();
  if (indices && indices.length > 0) {
    for (const idx of indices) {
      selectedPartIndices.add(idx);
    }
  }
  state.selectedPartInVariant = primaryIndex !== undefined ? primaryIndex : null;
}

// Get selected part
export function getSelectedPart() {
  if (state.selectedPartInVariant !== null && state.partsInVariant[state.selectedPartInVariant]) {
    return state.partsInVariant[state.selectedPartInVariant];
  }
  return null;
}

// Update part transform
export function updatePartTransform(property, value) {
  const part = getSelectedPart();
  if (part && property in part) {
    part[property] = value;
    return true;
  }
  return false;
}

// Update transform for all selected parts
export function updateAllSelectedTransform(property, value) {
  if (selectedPartIndices.size === 0) return false;

  for (const idx of selectedPartIndices) {
    const part = state.partsInVariant[idx];
    if (part && property in part) {
      part[property] = value;
    }
  }
  return true;
}

// Scale all selected parts by a delta (relative scaling)
export function scaleAllSelectedBy(scaleDelta) {
  if (selectedPartIndices.size === 0) return false;

  for (const idx of selectedPartIndices) {
    const part = state.partsInVariant[idx];
    if (part) {
      part.scale = Math.max(0.01, Math.min(10, part.scale + scaleDelta));
    }
  }
  return true;
}

// Set scale for all selected parts (absolute)
// Only applies to root parts - attached parts inherit scale from parents
export function setAllSelectedScale(scaleValue) {
  if (selectedPartIndices.size === 0) return false;

  const clampedScale = Math.max(0.01, Math.min(10, scaleValue));
  for (const idx of selectedPartIndices) {
    const part = state.partsInVariant[idx];
    if (part) {
      // Skip attached parts - they inherit scale from their parent
      // Setting scale on both parent and child causes double-scaling
      if (part.parentIndex !== null) continue;

      part.scale = clampedScale;
    }
  }
  return true;
}

// Move all selected parts by delta
export function moveAllSelectedBy(dx, dy) {
  if (selectedPartIndices.size === 0) return false;

  for (const idx of selectedPartIndices) {
    const part = state.partsInVariant[idx];
    if (part) {
      part.x += dx;
      part.y += dy;
    }
  }
  return true;
}

// Move part forward (higher z-index)
export function movePartForward() {
  const part = getSelectedPart();
  if (!part) return false;

  const maxZ = Math.max(...state.partsInVariant.map(p => p.zIndex));
  if (part.zIndex < maxZ) {
    const other = state.partsInVariant.find(p => p.zIndex === part.zIndex + 1);
    if (other) {
      other.zIndex--;
      part.zIndex++;
    }
    return true;
  }
  return false;
}

// Move part backward (lower z-index)
export function movePartBackward() {
  const part = getSelectedPart();
  if (!part) return false;

  if (part.zIndex > 0) {
    const other = state.partsInVariant.find(p => p.zIndex === part.zIndex - 1);
    if (other) {
      other.zIndex++;
      part.zIndex--;
    }
    return true;
  }
  return false;
}

// Remove selected part from variant
export function removeSelectedPart() {
  if (state.selectedPartInVariant === null) return false;

  state.partsInVariant.splice(state.selectedPartInVariant, 1);

  // Renumber z-indices
  state.partsInVariant.forEach((p, i) => p.zIndex = i);

  // Update selection
  state.selectedPartInVariant = state.partsInVariant.length > 0 ? 0 : null;

  return true;
}

// Set animation for selected part on a specific trigger
export function setPartAnimation(animationType, params, trigger = 'idle') {
  const part = getSelectedPart();
  if (!part) return false;

  // Ensure animations object exists (backwards compatibility)
  if (!part.animations) {
    part.animations = { idle: null, move: null, aim: null, fire: null, hit: null };
  }

  if (animationType === 'none' || !animationType) {
    part.animations[trigger] = null;
  } else {
    part.animations[trigger] = {
      type: animationType,
      params: params || {}
    };
  }
  return true;
}

// Get animation config for a specific trigger on selected part
export function getPartAnimation(trigger = 'idle') {
  const part = getSelectedPart();
  if (!part) return null;

  // Handle legacy single animation format
  if (part.animation && !part.animations) {
    if (part.animation.trigger === trigger) {
      return part.animation;
    }
    return null;
  }

  return part.animations?.[trigger] || null;
}

// Get parts sorted by z-index for rendering
export function getPartsSortedByZ() {
  return [...state.partsInVariant].sort((a, b) => a.zIndex - b.zIndex);
}

// Get variant data for saving
export function getVariantData() {
  return {
    formatVersion: '2.0',
    unitId: state.selectedObjectId,
    canvasSize: { width: state.canvasWidth, height: state.canvasHeight },
    parts: state.partsInVariant.map(p => ({
      partId: p.partId,
      image: p.image,
      x: p.x,
      y: p.y,
      rotation: p.rotation,
      scale: p.scale,
      opacity: p.opacity,
      zIndex: p.zIndex,
      // Multi-trigger animations
      animations: p.animations || { idle: null, move: null, aim: null, fire: null, hit: null },
      pivotX: p.pivotX,
      pivotY: p.pivotY,
      // Snap point system
      category: p.category,
      snapPoints: p.snapPoints,
      parentIndex: p.parentIndex,
      attachedTo: p.attachedTo,
      inheritRotation: p.inheritRotation,
      inheritScale: p.inheritScale
    }))
  };
}

// Drag state for variant builder
let isDraggingVariantPart = false;
let dragStartX = 0;
let dragStartY = 0;
let dragOrigX = 0;
let dragOrigY = 0;
let dragAxis = null;  // null = free, 'x' = X only, 'y' = Y only
let dragOrigPositions = {};  // Store original positions of all selected parts

// Hit test to find which part is at the given canvas position
// Returns the part index or -1 if no part found
export function hitTestPart(x, y, imageCache) {
  // Check in reverse z-order (top to bottom) to select topmost
  const sorted = getPartsSortedByZ().reverse();

  for (const part of sorted) {
    if (!part.visible) continue;

    // Get part's image dimensions (use cached image or fallback)
    const img = imageCache?.(part.image);
    const w = img ? (img.naturalWidth || img.width) : 60;
    const h = img ? (img.naturalHeight || img.height) : 60;

    // Apply scale
    const scaledW = w * part.scale;
    const scaledH = h * part.scale;

    // Part center is at (part.x, part.y), so bounds are:
    const left = part.x - scaledW / 2;
    const right = part.x + scaledW / 2;
    const top = part.y - scaledH / 2;
    const bottom = part.y + scaledH / 2;

    if (x >= left && x <= right && y >= top && y <= bottom) {
      // Found it - return the original index in partsInVariant
      return state.partsInVariant.indexOf(part);
    }
  }

  return -1;
}

// Start dragging a part
// axis: null = free drag, 'x' = X only, 'y' = Y only, 'center' = free drag
export function startPartDrag(x, y, axis = null) {
  if (selectedPartIndices.size === 0) return false;

  isDraggingVariantPart = true;

  // Disable pointer events on snap points during drag so mouseup goes to canvas
  const overlay = document.getElementById('snapPointOverlay');
  if (overlay) overlay.classList.add('dragging');
  dragStartX = x;
  dragStartY = y;
  dragAxis = (axis === 'center') ? null : axis;

  // Store original positions of all selected parts
  dragOrigPositions = {};
  for (const idx of selectedPartIndices) {
    const part = state.partsInVariant[idx];
    if (part) {
      dragOrigPositions[idx] = { x: part.x, y: part.y };
    }
  }

  // Also store primary part's position for compatibility
  const part = getSelectedPart();
  if (part) {
    dragOrigX = part.x;
    dragOrigY = part.y;
  }

  return true;
}

// Continue dragging (moves all selected parts)
export function continuePartDrag(x, y) {
  if (!isDraggingVariantPart) return false;

  const dx = x - dragStartX;
  const dy = y - dragStartY;

  // Calculate constrained deltas
  let applyDx = dragAxis === 'y' ? 0 : dx;
  let applyDy = dragAxis === 'x' ? 0 : dy;

  // Move all selected parts by delta from their original positions
  for (const idx of selectedPartIndices) {
    const part = state.partsInVariant[idx];
    if (part && dragOrigPositions[idx]) {
      part.x = dragOrigPositions[idx].x + applyDx;
      part.y = dragOrigPositions[idx].y + applyDy;
    }
  }

  return true;
}

// End dragging
export function endPartDrag() {
  isDraggingVariantPart = false;
  dragStartX = 0;
  dragStartY = 0;
  dragAxis = null;
  dragOrigPositions = {};

  // Re-enable pointer events on snap points
  const overlay = document.getElementById('snapPointOverlay');
  if (overlay) overlay.classList.remove('dragging');
}

// Get current drag axis (for cursor feedback)
export function getDragAxis() {
  return dragAxis;
}

// Check if currently dragging
export function isDraggingPart() {
  return isDraggingVariantPart;
}

// ===== Marquee Selection =====
let isMarqueeActive = false;
let marqueeStart = null;
let marqueeEnd = null;

// Start marquee selection
export function startMarquee(x, y) {
  isMarqueeActive = true;
  marqueeStart = { x, y };
  marqueeEnd = { x, y };
}

// Update marquee selection during drag
export function continueMarquee(x, y) {
  if (!isMarqueeActive) return;
  marqueeEnd = { x, y };
}

// End marquee selection and select parts within bounds
export function endMarquee(additive, imageCache) {
  if (!isMarqueeActive || !marqueeStart || !marqueeEnd) {
    isMarqueeActive = false;
    return;
  }

  // Calculate bounds
  const x1 = Math.min(marqueeStart.x, marqueeEnd.x);
  const y1 = Math.min(marqueeStart.y, marqueeEnd.y);
  const x2 = Math.max(marqueeStart.x, marqueeEnd.x);
  const y2 = Math.max(marqueeStart.y, marqueeEnd.y);

  // Only process if marquee is large enough (not just a click)
  const marqueeW = x2 - x1;
  const marqueeH = y2 - y1;

  if (marqueeW > 5 || marqueeH > 5) {
    // Find parts that intersect with the marquee
    const partsInMarquee = [];

    for (let i = 0; i < state.partsInVariant.length; i++) {
      const part = state.partsInVariant[i];
      if (!part.visible) continue;

      // Get part bounds (simple AABB check)
      const img = imageCache ? imageCache(part.image) : null;
      const partW = img ? (img.naturalWidth || img.width) : 60;
      const partH = img ? (img.naturalHeight || img.height) : 60;
      const scale = part.scale || 1;
      const halfW = (partW * scale) / 2;
      const halfH = (partH * scale) / 2;

      const partX = part.x;
      const partY = part.y;
      const partLeft = partX - halfW;
      const partRight = partX + halfW;
      const partTop = partY - halfH;
      const partBottom = partY + halfH;

      // Check intersection
      if (partRight >= x1 && partLeft <= x2 && partBottom >= y1 && partTop <= y2) {
        partsInMarquee.push(i);
      }
    }

    // Select parts
    if (!additive) {
      selectedPartIndices.clear();
    }

    for (const idx of partsInMarquee) {
      selectedPartIndices.add(idx);
    }

    // Set primary selection to first part in marquee
    if (partsInMarquee.length > 0) {
      state.selectedPartInVariant = partsInMarquee[0];
    } else if (!additive) {
      state.selectedPartInVariant = null;
    }
  } else if (!additive) {
    // Small marquee (click) - deselect all
    selectedPartIndices.clear();
    state.selectedPartInVariant = null;
  }

  // Reset marquee state
  isMarqueeActive = false;
  marqueeStart = null;
  marqueeEnd = null;
}

// Cancel marquee without applying
export function cancelMarquee() {
  isMarqueeActive = false;
  marqueeStart = null;
  marqueeEnd = null;
}

// Check if marquee is active
export function isMarqueeSelecting() {
  return isMarqueeActive;
}

// Get marquee bounds for rendering
export function getMarqueeBounds() {
  if (!isMarqueeActive || !marqueeStart || !marqueeEnd) return null;
  return {
    x1: Math.min(marqueeStart.x, marqueeEnd.x),
    y1: Math.min(marqueeStart.y, marqueeEnd.y),
    x2: Math.max(marqueeStart.x, marqueeEnd.x),
    y2: Math.max(marqueeStart.y, marqueeEnd.y)
  };
}
