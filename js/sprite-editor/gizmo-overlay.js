// sprite-editor/gizmo-overlay.js - HTML overlay for axis gizmos
// Single responsibility: Render crisp gizmo handles over canvas

import { state } from './state.js';
import { getSelectedPartIndices } from './variants.js';
import * as snapPoints from './snap-points.js';

let overlay = null;
let canvasWrapper = null;
let onHandleClickCallback = null;

const ARROW_LENGTH = 40;  // Length of axis arrows in screen pixels

/**
 * Initialize gizmo overlay
 * @param {HTMLElement} wrapper - The canvas wrapper element
 * @param {Function} onHandleClick - Callback when gizmo handle is clicked: (handleType, partIndex) => void
 */
export function initGizmoOverlay(wrapper, onHandleClick) {
  canvasWrapper = wrapper;
  overlay = document.getElementById('gizmoOverlay');
  onHandleClickCallback = onHandleClick;

  if (!overlay) {
    console.warn('Gizmo overlay element not found');
    return;
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

  // Calculate scale from canvas pixels to screen pixels
  const scaleX = canvasRect.width / canvas.width;
  const scaleY = canvasRect.height / canvas.height;

  // Position relative to canvas, then offset by canvas position in wrapper
  const screenX = (canvasX * scaleX) + (canvasRect.left - wrapperRect.left);
  const screenY = (canvasY * scaleY) + (canvasRect.top - wrapperRect.top);

  return { x: screenX, y: screenY };
}

/**
 * Create HTML for a single gizmo
 */
function createGizmoElement(partIndex, isPrimary) {
  const world = snapPoints.getWorldTransform(partIndex);
  if (!world) return null;

  // For attached parts, world.x/y is the anchor point (snap point)
  // The gizmo should appear at the part's center, not the anchor
  let gizmoX = world.x;
  let gizmoY = world.y;

  if (world.isAttached && (world.originOffsetX || world.originOffsetY)) {
    const originX = world.originOffsetX || 0;
    const originY = world.originOffsetY || 0;
    const rad = (world.rotation || 0) * Math.PI / 180;
    const scale = world.scale || 1;

    // Origin offset is in local coords, rotate and scale to get world offset
    const rotatedOffsetX = (originX * Math.cos(rad) - originY * Math.sin(rad)) * scale;
    const rotatedOffsetY = (originX * Math.sin(rad) + originY * Math.cos(rad)) * scale;

    // Part center = anchor - rotated origin offset
    gizmoX = world.x - rotatedOffsetX;
    gizmoY = world.y - rotatedOffsetY;
  }

  const pos = canvasToScreen(gizmoX, gizmoY);

  const gizmo = document.createElement('div');
  gizmo.className = `gizmo ${isPrimary ? 'primary' : 'secondary'}`;
  gizmo.style.left = `${pos.x}px`;
  gizmo.style.top = `${pos.y}px`;
  gizmo.dataset.partIndex = partIndex;

  // X axis line and handle
  const lineX = document.createElement('div');
  lineX.className = 'gizmo-line-x';
  lineX.style.width = `${ARROW_LENGTH}px`;
  gizmo.appendChild(lineX);

  const handleX = document.createElement('div');
  handleX.className = 'gizmo-handle gizmo-x';
  handleX.style.left = `${ARROW_LENGTH}px`;
  handleX.style.top = '0';
  handleX.dataset.handle = 'x';
  handleX.dataset.partIndex = partIndex;
  handleX.addEventListener('mousedown', handleGizmoMouseDown);
  gizmo.appendChild(handleX);

  // Y axis line and handle
  const lineY = document.createElement('div');
  lineY.className = 'gizmo-line-y';
  lineY.style.height = `${ARROW_LENGTH}px`;
  gizmo.appendChild(lineY);

  const handleY = document.createElement('div');
  handleY.className = 'gizmo-handle gizmo-y';
  handleY.style.left = '0';
  handleY.style.top = `${ARROW_LENGTH}px`;
  handleY.dataset.handle = 'y';
  handleY.dataset.partIndex = partIndex;
  handleY.addEventListener('mousedown', handleGizmoMouseDown);
  gizmo.appendChild(handleY);

  // Center handle
  const center = document.createElement('div');
  center.className = 'gizmo-handle gizmo-center';
  center.dataset.handle = 'center';
  center.dataset.partIndex = partIndex;
  center.addEventListener('mousedown', handleGizmoMouseDown);
  gizmo.appendChild(center);

  return gizmo;
}

/**
 * Handle mouse down on gizmo handle
 */
function handleGizmoMouseDown(e) {
  e.preventDefault();
  e.stopPropagation();

  const handle = e.target.dataset.handle;
  const partIndex = parseInt(e.target.dataset.partIndex, 10);

  if (onHandleClickCallback) {
    onHandleClickCallback(handle, partIndex, e);
  }
}

/**
 * Render all gizmos for selected parts
 */
export function renderGizmoOverlay() {
  if (!overlay) return;

  // Only show gizmos in variant builder mode
  if (state.selectedMode !== 'variant-builder') {
    overlay.innerHTML = '';
    return;
  }

  const selectedIndices = getSelectedPartIndices();

  // Clear existing gizmos
  overlay.innerHTML = '';

  if (selectedIndices.size === 0) return;

  // Create gizmos for secondary selections first (so primary is on top)
  for (const idx of selectedIndices) {
    if (idx === state.selectedPartInVariant) continue;
    const gizmo = createGizmoElement(idx, false);
    if (gizmo) overlay.appendChild(gizmo);
  }

  // Create primary gizmo last (on top)
  if (state.selectedPartInVariant !== null && selectedIndices.has(state.selectedPartInVariant)) {
    const gizmo = createGizmoElement(state.selectedPartInVariant, true);
    if (gizmo) overlay.appendChild(gizmo);
  }
}

/**
 * Update gizmo positions (call during pan/zoom/drag)
 */
export function updateGizmoPositions() {
  if (!overlay) return;

  const gizmos = overlay.querySelectorAll('.gizmo');

  gizmos.forEach(gizmo => {
    const partIndex = parseInt(gizmo.dataset.partIndex, 10);
    const world = snapPoints.getWorldTransform(partIndex);
    if (!world) return;

    // For attached parts, calculate the part center (same as createGizmoElement)
    let gizmoX = world.x;
    let gizmoY = world.y;

    if (world.isAttached && (world.originOffsetX || world.originOffsetY)) {
      const originX = world.originOffsetX || 0;
      const originY = world.originOffsetY || 0;
      const rad = (world.rotation || 0) * Math.PI / 180;
      const scale = world.scale || 1;

      const rotatedOffsetX = (originX * Math.cos(rad) - originY * Math.sin(rad)) * scale;
      const rotatedOffsetY = (originX * Math.sin(rad) + originY * Math.cos(rad)) * scale;

      gizmoX = world.x - rotatedOffsetX;
      gizmoY = world.y - rotatedOffsetY;
    }

    const pos = canvasToScreen(gizmoX, gizmoY);
    gizmo.style.left = `${pos.x}px`;
    gizmo.style.top = `${pos.y}px`;
  });
}

/**
 * Clear all gizmos
 */
export function clearGizmoOverlay() {
  if (overlay) {
    overlay.innerHTML = '';
  }
}
