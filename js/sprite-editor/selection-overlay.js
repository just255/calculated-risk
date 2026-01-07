// sprite-editor/selection-overlay.js - HTML overlay for selection indicators
// Single responsibility: Render crisp selection boxes (marching ants) over canvas

import { state } from './state.js';
import { getSelectedPartIndices, getMarqueeBounds, isMarqueeSelecting } from './variants.js';
import * as snapPoints from './snap-points.js';
import { getCachedImage } from './images.js';

let overlay = null;
let canvasWrapper = null;

/**
 * Initialize selection overlay
 * @param {HTMLElement} wrapper - The canvas wrapper element
 */
export function initSelectionOverlay(wrapper) {
  canvasWrapper = wrapper;
  overlay = document.getElementById('selectionOverlay');

  if (!overlay) {
    console.warn('Selection overlay element not found');
  }
}

/**
 * Convert canvas coordinates to screen position within wrapper
 */
function canvasToScreen(canvasX, canvasY) {
  if (!canvasWrapper) return { x: 0, y: 0 };

  const canvas = canvasWrapper.querySelector('canvas');
  if (!canvas) return { x: 0, y: 0 };

  const wrapperRect = canvasWrapper.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();

  const scaleX = canvasRect.width / canvas.width;
  const scaleY = canvasRect.height / canvas.height;

  const screenX = (canvasX * scaleX) + (canvasRect.left - wrapperRect.left);
  const screenY = (canvasY * scaleY) + (canvasRect.top - wrapperRect.top);

  return { x: screenX, y: screenY };
}

/**
 * Convert canvas size to screen size
 */
function canvasSizeToScreen(canvasW, canvasH) {
  if (!canvasWrapper) return { w: 0, h: 0 };

  const canvas = canvasWrapper.querySelector('canvas');
  if (!canvas) return { w: 0, h: 0 };

  const canvasRect = canvas.getBoundingClientRect();

  const scaleX = canvasRect.width / canvas.width;
  const scaleY = canvasRect.height / canvas.height;

  return { w: canvasW * scaleX, h: canvasH * scaleY };
}

/**
 * Create selection box element for a part
 */
function createSelectionBox(partIndex, isPrimary) {
  const part = state.partsInVariant[partIndex];
  if (!part || !part.visible) return null;

  const world = snapPoints.getWorldTransform(partIndex);
  if (!world) return null;

  // Get part dimensions
  const img = getCachedImage(part.image);
  const partW = img ? (img.naturalWidth || img.width) : 60;
  const partH = img ? (img.naturalHeight || img.height) : 60;
  const scale = world.scale || 1;

  // Calculate the actual part center
  // For attached parts, world.x/y is the anchor (snap point), not the center
  // We need to offset by the rotated origin offset to find the true center
  let centerX = world.x;
  let centerY = world.y;

  if (world.isAttached && (world.originOffsetX || world.originOffsetY)) {
    const originX = world.originOffsetX || 0;
    const originY = world.originOffsetY || 0;
    const rad = (world.rotation || 0) * Math.PI / 180;

    // Origin offset is in local coords, rotate by world rotation and scale
    const rotatedOffsetX = (originX * Math.cos(rad) - originY * Math.sin(rad)) * scale;
    const rotatedOffsetY = (originX * Math.sin(rad) + originY * Math.cos(rad)) * scale;

    // Part center = anchor - rotated origin offset (because origin is offset FROM center TO anchor)
    centerX = world.x - rotatedOffsetX;
    centerY = world.y - rotatedOffsetY;
  }

  // Calculate bounds in canvas coords
  const halfW = (partW * scale) / 2;
  const halfH = (partH * scale) / 2;

  // Convert to screen coords
  const topLeft = canvasToScreen(centerX - halfW, centerY - halfH);
  const size = canvasSizeToScreen(partW * scale, partH * scale);

  const box = document.createElement('div');
  box.className = `selection-box ${isPrimary ? 'primary' : 'secondary'}`;
  box.style.left = `${topLeft.x}px`;
  box.style.top = `${topLeft.y}px`;
  box.style.width = `${size.w}px`;
  box.style.height = `${size.h}px`;
  box.dataset.partIndex = partIndex;

  // Handle rotation
  if (world.rotation) {
    box.style.transform = `rotate(${world.rotation}deg)`;
    box.style.transformOrigin = 'center center';
  }

  return box;
}

/**
 * Create marquee selection box
 */
function createMarqueeBox() {
  const bounds = getMarqueeBounds();
  if (!bounds) return null;

  const topLeft = canvasToScreen(bounds.x1, bounds.y1);
  const bottomRight = canvasToScreen(bounds.x2, bounds.y2);

  const box = document.createElement('div');
  box.className = 'selection-box marquee';
  box.style.left = `${topLeft.x}px`;
  box.style.top = `${topLeft.y}px`;
  box.style.width = `${bottomRight.x - topLeft.x}px`;
  box.style.height = `${bottomRight.y - topLeft.y}px`;
  box.style.background = 'rgba(59, 130, 246, 0.15)';

  // Override border color for marquee
  const beforeStyle = document.createElement('style');
  box.style.setProperty('--marquee-color', '#3b82f6');

  return box;
}

/**
 * Render all selection indicators
 */
export function renderSelectionOverlay() {
  if (!overlay) return;

  // Only show in variant builder mode
  if (state.selectedMode !== 'variant-builder') {
    overlay.innerHTML = '';
    return;
  }

  // Clear existing
  overlay.innerHTML = '';

  // Draw marquee if active
  if (isMarqueeSelecting()) {
    const marquee = createMarqueeBox();
    if (marquee) overlay.appendChild(marquee);
  }

  // Draw selection boxes for selected parts
  const selectedIndices = getSelectedPartIndices();

  // Secondary selections first
  for (const idx of selectedIndices) {
    if (idx === state.selectedPartInVariant) continue;
    const box = createSelectionBox(idx, false);
    if (box) overlay.appendChild(box);
  }

  // Primary selection last (on top)
  if (state.selectedPartInVariant !== null && selectedIndices.has(state.selectedPartInVariant)) {
    const box = createSelectionBox(state.selectedPartInVariant, true);
    if (box) overlay.appendChild(box);
  }
}

/**
 * Update selection positions (call during pan/zoom)
 */
export function updateSelectionPositions() {
  // Just re-render since rotation/scale make incremental updates complex
  renderSelectionOverlay();
}

/**
 * Clear all selections
 */
export function clearSelectionOverlay() {
  if (overlay) {
    overlay.innerHTML = '';
  }
}
