// sprite-editor/snap-overlay.js - HTML overlay for snap points
// Single responsibility: Render crisp HTML snap points over the canvas
// Handles both Part Editor (editing snap points) and Variant Builder (attaching parts)

import { state } from './state.js';
import { SNAP_POINT_TYPES, canAttachTo } from './constants.js';
import { getAllSnapPointsInVariant, attachPartToSnapPoint } from './snap-points.js';

let overlay = null;
let canvas = null;
let onAttachCallback = null;
let onSelectCallback = null;
let onMoveCallback = null;
let onSnapPointClickCallback = null;  // Called when snap point clicked in builder mode

// Drag state for Part Editor
let isDragging = false;
let dragPointId = null;
let dragStartX = 0;
let dragStartY = 0;
let dragOrigX = 0;
let dragOrigY = 0;

/**
 * Initialize the snap point overlay system
 */
export function initSnapOverlay(callbacks = {}) {
  overlay = document.getElementById('snapPointOverlay');
  canvas = document.getElementById('canvas');
  onAttachCallback = callbacks.onAttach || null;
  onSelectCallback = callbacks.onSelect || null;
  onMoveCallback = callbacks.onMove || null;
  onSnapPointClickCallback = callbacks.onSnapPointClick || null;

  if (!overlay) {
    console.warn('[snap-overlay] Overlay element not found');
    return;
  }

  // Global mouse events for dragging
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);

  console.log('[snap-overlay] Initialized');
}

/**
 * Convert canvas coordinates to overlay screen position
 * @param {number} canvasX - X position in canvas pixels
 * @param {number} canvasY - Y position in canvas pixels
 */
function canvasToScreen(canvasX, canvasY) {
  const panOffset = window.spriteEditor?.getPanOffset?.() || { x: 0, y: 0 };
  return {
    x: panOffset.x + (canvasX * state.zoom),
    y: panOffset.y + (canvasY * state.zoom)
  };
}

/**
 * Convert local coordinates (relative to canvas center) to screen position
 * Used for Part Editor where snap points are stored relative to center
 */
function localToScreen(localX, localY) {
  const canvasCenterX = state.canvasWidth / 2;
  const canvasCenterY = state.canvasHeight / 2;
  return canvasToScreen(canvasCenterX + localX, canvasCenterY + localY);
}

/**
 * Convert screen position to local coordinates (relative to canvas center)
 */
function screenToLocal(screenX, screenY) {
  if (!overlay) return { x: 0, y: 0 };

  const overlayRect = overlay.getBoundingClientRect();
  const panOffset = window.spriteEditor?.getPanOffset?.() || { x: 0, y: 0 };

  // Screen position relative to overlay
  const relX = screenX - overlayRect.left;
  const relY = screenY - overlayRect.top;

  // Remove pan offset and zoom to get canvas pixel
  const canvasX = (relX - panOffset.x) / state.zoom;
  const canvasY = (relY - panOffset.y) / state.zoom;

  // Canvas pixel to local (relative to center)
  const canvasCenterX = state.canvasWidth / 2;
  const canvasCenterY = state.canvasHeight / 2;

  return {
    x: Math.round((canvasX - canvasCenterX) * 2) / 2,
    y: Math.round((canvasY - canvasCenterY) * 2) / 2
  };
}

/**
 * Render snap points - dispatches to appropriate mode
 */
export function renderSnapPointOverlay() {
  if (!overlay) return;

  if (state.selectedMode === 'part-editor') {
    renderPartEditorSnapPoints();
  } else if (state.selectedMode === 'variant-builder') {
    renderVariantBuilderSnapPoints();
  } else {
    overlay.innerHTML = '';
  }
}

/**
 * Render snap points for Part Editor (editing/defining snap points on a part)
 */
function renderPartEditorSnapPoints() {
  if (!state.showSnapPoints || !state.snapPoints || state.snapPoints.length === 0) {
    overlay.innerHTML = '';
    return;
  }

  const html = state.snapPoints.map(sp => {
    const screenPos = localToScreen(sp.x, sp.y);
    const typeInfo = SNAP_POINT_TYPES[sp.type] || { color: '#888', label: 'Unknown' };
    const isSelected = sp.id === state.selectedSnapPointId;

    const classes = [
      'snap-point',
      'editor-mode',
      isSelected ? 'selected' : ''
    ].filter(Boolean).join(' ');

    return `
      <div class="${classes}"
           style="left: ${screenPos.x}px; top: ${screenPos.y}px; color: ${typeInfo.color};"
           data-snap-id="${sp.id}"
           data-mode="editor">
        <div class="snap-point-dot" style="background: ${typeInfo.color};"></div>
        <span class="snap-point-label">${sp.name || sp.id}</span>
      </div>
    `;
  }).join('');

  overlay.innerHTML = html;

  // Add event handlers
  overlay.querySelectorAll('.snap-point').forEach(el => {
    el.addEventListener('mousedown', handleEditorMouseDown);
  });
}

/**
 * Render snap points for Variant Builder (attaching parts)
 */
function renderVariantBuilderSnapPoints() {
  if (!state.showSnapPoints) {
    overlay.innerHTML = '';
    return;
  }

  const allSnapPoints = getAllSnapPointsInVariant();

  if (allSnapPoints.length === 0) {
    overlay.innerHTML = '';
    return;
  }

  const selectedPart = state.selectedPartInVariant !== null
    ? state.partsInVariant[state.selectedPartInVariant]
    : null;

  const html = allSnapPoints.map(sp => {
    // worldX/worldY are already in canvas coordinates
    const screenPos = canvasToScreen(sp.worldX, sp.worldY);
    const typeInfo = sp.typeInfo || SNAP_POINT_TYPES[sp.snapPoint.type] || { color: '#888', label: 'Unknown' };

    // Check if selected part can attach here
    const canAttach = selectedPart && selectedPart.category && !sp.isOccupied &&
      sp.partIndex !== state.selectedPartInVariant &&
      canAttachTo(selectedPart.category, sp.snapPoint.type);

    const classes = [
      'snap-point',
      'builder-mode',
      sp.isOccupied ? 'occupied' : '',
      canAttach ? 'compatible' : ''
    ].filter(Boolean).join(' ');

    return `
      <div class="${classes}"
           style="left: ${screenPos.x}px; top: ${screenPos.y}px; color: ${typeInfo.color};"
           data-part-index="${sp.partIndex}"
           data-snap-id="${sp.snapPoint.id}"
           data-can-attach="${canAttach}"
           data-mode="builder">
        <div class="snap-point-dot" style="background: ${typeInfo.color};"></div>
        <span class="snap-point-label">${sp.snapPoint.name}</span>
      </div>
    `;
  }).join('');

  overlay.innerHTML = html;

  // Add click handlers
  overlay.querySelectorAll('.snap-point').forEach(el => {
    el.addEventListener('click', handleBuilderClick);
  });
}

/**
 * Handle mousedown on snap point in Part Editor (select + start drag)
 */
function handleEditorMouseDown(e) {
  e.preventDefault();
  e.stopPropagation();

  const el = e.currentTarget;
  const snapId = el.dataset.snapId;

  // Select the snap point
  state.selectedSnapPointId = snapId;

  if (onSelectCallback) {
    onSelectCallback(snapId);
  }

  // Start dragging
  const point = state.snapPoints.find(p => p.id === snapId);
  if (point) {
    isDragging = true;
    dragPointId = snapId;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragOrigX = point.x;
    dragOrigY = point.y;
    el.classList.add('dragging');
  }

  // Re-render to show selection
  renderSnapPointOverlay();
}

/**
 * Handle mouse move (for dragging in Part Editor)
 */
function handleMouseMove(e) {
  if (!isDragging || !dragPointId) return;

  const point = state.snapPoints.find(p => p.id === dragPointId);
  if (!point) return;

  // Calculate delta in screen space, convert to local space
  const deltaScreenX = e.clientX - dragStartX;
  const deltaScreenY = e.clientY - dragStartY;

  // Convert screen delta to local delta (accounting for zoom)
  const deltaLocalX = deltaScreenX / state.zoom;
  const deltaLocalY = deltaScreenY / state.zoom;

  // Update point position (round to 0.5 increments for pixel-center positioning)
  point.x = Math.round((dragOrigX + deltaLocalX) * 2) / 2;
  point.y = Math.round((dragOrigY + deltaLocalY) * 2) / 2;

  // Update the overlay position directly for smooth dragging
  const el = overlay.querySelector(`[data-snap-id="${dragPointId}"]`);
  if (el) {
    const screenPos = localToScreen(point.x, point.y);
    el.style.left = `${screenPos.x}px`;
    el.style.top = `${screenPos.y}px`;
  }
}

/**
 * Handle mouse up (end dragging)
 */
function handleMouseUp(e) {
  if (isDragging && dragPointId) {
    const el = overlay.querySelector(`[data-snap-id="${dragPointId}"]`);
    if (el) {
      el.classList.remove('dragging');
    }

    // Notify callback that move is complete
    if (onMoveCallback) {
      const point = state.snapPoints.find(p => p.id === dragPointId);
      if (point) {
        onMoveCallback(dragPointId, point.x, point.y);
      }
    }
  }

  isDragging = false;
  dragPointId = null;
}

/**
 * Handle click on snap point in Variant Builder (attach part)
 */
function handleBuilderClick(e) {
  e.stopPropagation();

  const el = e.currentTarget;
  const partIndex = parseInt(el.dataset.partIndex);
  const snapId = el.dataset.snapId;
  const isOccupied = el.classList.contains('occupied');

  // Get snap point info
  const part = state.partsInVariant[partIndex];
  const snapPoint = part?.snapPoints?.find(sp => sp.id === snapId);

  if (!snapPoint) {
    console.log('[snap-overlay] Snap point not found');
    return;
  }

  // Call the callback to show attachment panel
  if (onSnapPointClickCallback) {
    onSnapPointClickCallback({
      partIndex,
      snapId,
      snapPoint,
      isOccupied,
      partName: part.name
    });
  }
}

/**
 * Update snap point positions (call on zoom/pan)
 */
export function updateSnapPointPositions() {
  if (!overlay) return;

  if (state.selectedMode === 'part-editor') {
    // Update Part Editor snap points
    state.snapPoints?.forEach(sp => {
      const el = overlay.querySelector(`[data-snap-id="${sp.id}"]`);
      if (el) {
        const screenPos = localToScreen(sp.x, sp.y);
        el.style.left = `${screenPos.x}px`;
        el.style.top = `${screenPos.y}px`;
      }
    });
  } else if (state.selectedMode === 'variant-builder') {
    // Update Variant Builder snap points
    const allSnapPoints = getAllSnapPointsInVariant();
    const elements = overlay.querySelectorAll('.snap-point');

    elements.forEach((el, index) => {
      if (index < allSnapPoints.length) {
        const sp = allSnapPoints[index];
        // worldX/worldY are already in canvas coordinates
        const screenPos = canvasToScreen(sp.worldX, sp.worldY);
        el.style.left = `${screenPos.x}px`;
        el.style.top = `${screenPos.y}px`;
      }
    });
  }
}

/**
 * Clear the overlay
 */
export function clearSnapOverlay() {
  if (overlay) {
    overlay.innerHTML = '';
  }
  isDragging = false;
  dragPointId = null;
}

/**
 * Check if currently dragging a snap point
 */
export function isDraggingSnapPoint() {
  return isDragging;
}
