// sprite-editor/canvas.js - Canvas rendering
// Single responsibility: Draw to canvas based on current state

import { state } from './state.js';
import { CANVAS_DEFAULTS, getBrushBounds, CURSOR_PREVIEW_TOOLS, UNIT_DIMENSIONS, UNIT_DIMENSION_CATEGORY, SNAP_POINT_TYPES } from './constants.js';
import { getPartsSortedByZ, isPartSelected, getSelectedPartIndices, isDraggingPart, isMarqueeSelecting, getMarqueeBounds } from './variants.js';
import * as snapPointSystem from './snap-points.js';
import { getCachedImage, loadImage } from './images.js';
import { hasSelection, drawSelectionOutline } from './selection.js';
import { applyBlend, needsPixelBlend } from './blend.js';
import * as cloneStamp from './clone-stamp.js';
import { getEdgeFillRefPoints } from './tools.js';
import * as animation from './animation.js';

let canvas, ctx;

// Initialize canvas
export function initCanvas(canvasElement) {
  canvas = canvasElement;
  ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false; // Crisp pixel art
  canvas.width = state.canvasWidth;
  canvas.height = state.canvasHeight;
}

// Get canvas context
export function getContext() {
  return ctx;
}

// Main render function
export function render() {
  // Ensure crisp pixel art rendering (can get reset)
  ctx.imageSmoothingEnabled = false;

  drawCheckerboard();

  if (state.selectedMode === 'part-editor') {
    renderPartEditor();
  } else if (state.selectedMode === 'variant-builder') {
    renderVariantBuilder();
  }
}

// Draw transparency checkerboard - subdivides at high zoom
function drawCheckerboard() {
  // If grid is off, draw solid background instead
  if (!state.showGrid) {
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, state.canvasWidth, state.canvasHeight);
    return;
  }

  const size = getCheckerSize();
  const lightColor = '#3a3a3a';
  const darkColor = '#2a2a2a';

  for (let y = 0; y < state.canvasHeight; y += size) {
    for (let x = 0; x < state.canvasWidth; x += size) {
      const light = (Math.floor(x / size) + Math.floor(y / size)) % 2 === 0;
      ctx.fillStyle = light ? lightColor : darkColor;
      ctx.fillRect(x, y, size, size);
    }
  }
}

// Get checker size based on zoom level
function getCheckerSize() {
  let size = CANVAS_DEFAULTS.checkerSize;

  if (state.zoom >= 40) {
    size = size / 16; // 4000%+: 1px cells
  } else if (state.zoom >= 25) {
    size = size / 8;  // 2500%+: 2px cells
  } else if (state.zoom >= 15) {
    size = size / 4;  // 1500%+: 4px cells
  } else if (state.zoom >= 8) {
    size = size / 2;  // 800%+: 8px cells
  }

  return Math.max(1, size);
}

// Render Part Editor mode
function renderPartEditor() {
  // Apply rotation preview transform if enabled
  const rotPreview = state.rotationPreview;
  const isRotating = rotPreview && rotPreview.angle !== 0;

  if (isRotating) {
    ctx.save();
    // Translate to pivot point (relative to canvas center)
    const cx = state.canvasWidth / 2 + rotPreview.pivotX;
    const cy = state.canvasHeight / 2 + rotPreview.pivotY;
    ctx.translate(cx, cy);
    ctx.rotate(rotPreview.angle * Math.PI / 180);
    ctx.translate(-cx, -cy);
  }

  // Draw context parts (all default parts as reference)
  // The part being edited shows at higher opacity, others at lower
  if (state.showContextParts && state.contextParts.length > 0) {
    state.contextParts.forEach(part => {
      // Skip hidden parts
      if (part.visible === false) return;

      const img = getCachedImage(part.thumbnail);
      if (img) {
        // Part being edited shows at 80% opacity, others at 25%
        ctx.globalAlpha = part.isEditingPart ? 0.8 : 0.25;
        // Draw at natural size, centered on canvas
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        const x = (state.canvasWidth - width) / 2;
        const y = (state.canvasHeight - height) / 2;
        ctx.drawImage(img, x, y, width, height);
      }
    });
    ctx.globalAlpha = 1;
  }

  // Draw user-imported reference image if enabled
  if (state.showRef && state.refImage) {
    ctx.globalAlpha = state.refOpacity / 100;
    const scale = state.refScale / 100;
    const width = state.refImage.width * scale;
    const height = state.refImage.height * scale;
    // Center by default, then apply offset
    const x = (state.canvasWidth - width) / 2 + state.refX;
    const y = (state.canvasHeight - height) / 2 + state.refY;
    ctx.drawImage(state.refImage, x, y, width, height);
    ctx.globalAlpha = 1;
  }

  // Draw onion skin (previous/next frames) if enabled
  if (state.showOnion && state.frames.length > 1) {
    drawOnionSkin();
  }

  // Draw all visible layers using offscreen canvas for proper eraser support
  state.layers.forEach(layer => {
    if (!layer.visible) return;

    // Create offscreen canvas for this layer
    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = state.canvasWidth;
    layerCanvas.height = state.canvasHeight;
    const layerCtx = layerCanvas.getContext('2d');

    // Draw all shapes to the offscreen canvas
    layer.shapes.forEach(shape => {
      drawShapeToContext(layerCtx, shape);
    });

    // Composite the layer onto the main canvas
    const blendMode = layer.blend || 'normal';
    const layerOpacity = (layer.opacity ?? 100) / 100;

    if (needsPixelBlend(blendMode)) {
      applyBlend(ctx, layerCtx, blendMode, layerOpacity, state.canvasWidth, state.canvasHeight);
    } else {
      ctx.globalAlpha = layerOpacity;
      ctx.drawImage(layerCanvas, 0, 0);
      ctx.globalAlpha = 1;
    }
  });

  // Draw grid if enabled
  if (state.showGrid) {
    drawGrid();
  }

  // Draw selection outline (marching ants)
  if (hasSelection()) {
    drawSelectionOutline(ctx);
  }

  // Draw shape selection outline
  if (state.selectedShapeIndex !== null && state.tool === 'select') {
    const layer = state.layers.find(l => l.id === state.selectedLayerId);
    if (layer && layer.shapes[state.selectedShapeIndex]) {
      drawShapeSelectionOutline(ctx, layer.shapes[state.selectedShapeIndex]);
    }
  }

  // Snap points are now rendered via HTML overlay (snap-overlay.js)
  // Canvas-based rendering disabled for crisp display at any zoom
  // if (state.showSnapPoints && state.snapPoints.length > 0) {
  //   drawSnapPoints();
  // }

  // Restore transform before drawing UI overlays (they shouldn't rotate)
  if (isRotating) {
    ctx.restore();
  }

  // Draw rotation pivot indicator when rotation preview is active
  if (rotPreview && (rotPreview.enabled || rotPreview.angle !== 0)) {
    drawRotationPivot();
  }

  // Draw measure guides and current measurement (Part Editor)
  drawMeasureLines();

  // Draw cursor/stroke preview
  drawCursorPreview();
}

// Draw snap points on canvas
function drawSnapPoints() {
  const cx = state.canvasWidth / 2;
  const cy = state.canvasHeight / 2;

  ctx.save();

  state.snapPoints.forEach(point => {
    const x = cx + point.x;
    const y = cy + point.y;
    const isSelected = point.id === state.selectedSnapPointId;

    // Get color from type
    const typeInfo = SNAP_POINT_TYPES[point.type] || { color: '#888' };
    const color = typeInfo.color;

    // Outer circle (larger when selected)
    const radius = isSelected ? 8 / state.zoom : 6 / state.zoom;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = isSelected ? 0.9 : 0.7;
    ctx.fill();

    // Selection ring
    if (isSelected) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 / state.zoom;
      ctx.stroke();
    }

    // Inner dot
    ctx.beginPath();
    ctx.arc(x, y, 2 / state.zoom, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = 1;
    ctx.fill();

    // Label (name)
    ctx.font = `${Math.max(10, 11 / state.zoom)}px sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(point.name, x + radius + 4 / state.zoom, y);
  });

  ctx.restore();
}

// Draw rotation pivot indicator
function drawRotationPivot() {
  const rotPreview = state.rotationPreview;
  if (!rotPreview) return;

  ctx.save();

  // Pivot position (relative to canvas center)
  const cx = state.canvasWidth / 2 + rotPreview.pivotX;
  const cy = state.canvasHeight / 2 + rotPreview.pivotY;

  const size = Math.max(8, 12 / state.zoom);

  // Outer circle
  ctx.strokeStyle = '#f97316'; // Orange
  ctx.lineWidth = 2 / state.zoom;
  ctx.beginPath();
  ctx.arc(cx, cy, size, 0, Math.PI * 2);
  ctx.stroke();

  // Crosshair
  ctx.beginPath();
  ctx.moveTo(cx - size * 1.5, cy);
  ctx.lineTo(cx + size * 1.5, cy);
  ctx.moveTo(cx, cy - size * 1.5);
  ctx.lineTo(cx, cy + size * 1.5);
  ctx.stroke();

  // Center dot
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.arc(cx, cy, 2 / state.zoom, 0, Math.PI * 2);
  ctx.fill();

  // Label
  ctx.font = `${Math.max(10, 12 / state.zoom)}px sans-serif`;
  ctx.fillStyle = '#f97316';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';

  const label = rotPreview.pivotType === 'center' ? 'Pivot' : rotPreview.pivotType;
  ctx.fillText(label, cx + size + 4 / state.zoom, cy - 4 / state.zoom);

  // Angle indicator arc
  if (rotPreview.angle !== 0) {
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 1.5 / state.zoom;
    ctx.setLineDash([3 / state.zoom, 3 / state.zoom]);
    ctx.beginPath();
    ctx.arc(cx, cy, size * 2, -Math.PI / 2, (rotPreview.angle - 90) * Math.PI / 180);
    ctx.stroke();
    ctx.setLineDash([]);

    // Angle text
    ctx.fillText(`${Math.round(rotPreview.angle)}°`, cx + size * 2 + 4 / state.zoom, cy);
  }

  ctx.restore();
}

// Draw measure lines and guides
function drawMeasureLines() {
  ctx.save();

  // Scale line width based on zoom for consistent visibility
  const lineWidth = Math.max(1, 2 / state.zoom);
  const pointRadius = Math.max(2, 4 / state.zoom);
  const fontSize = Math.max(10, 12 / state.zoom);

  // Draw persistent guides (dashed orange)
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([4 / state.zoom, 4 / state.zoom]);

  for (const guide of state.measureGuides) {
    ctx.beginPath();
    ctx.moveTo(guide.p1.x, guide.p1.y);
    ctx.lineTo(guide.p2.x, guide.p2.y);
    ctx.stroke();

    // Midpoint marker (small diamond)
    const midX = (guide.p1.x + guide.p2.x) / 2;
    const midY = (guide.p1.y + guide.p2.y) / 2;
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(midX, midY - pointRadius);
    ctx.lineTo(midX + pointRadius, midY);
    ctx.lineTo(midX, midY + pointRadius);
    ctx.lineTo(midX - pointRadius, midY);
    ctx.closePath();
    ctx.fill();
  }

  ctx.setLineDash([]);

  // Draw current measurement (solid cyan with green midpoint)
  if (state.measurePoints.length > 0) {
    const p1 = state.measurePoints[0];
    const p2 = state.measurePoints[1];

    // Point 1 marker
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.arc(p1.x, p1.y, pointRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1 / state.zoom;
    ctx.stroke();

    // Label P1
    ctx.font = `${fontSize}px sans-serif`;
    ctx.fillStyle = '#22d3ee';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('P1', p1.x + pointRadius + 2 / state.zoom, p1.y - 2 / state.zoom);

    if (p2) {
      // Point 2 marker
      ctx.fillStyle = '#22d3ee';
      ctx.beginPath();
      ctx.arc(p2.x, p2.y, pointRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.stroke();

      // Label P2
      ctx.fillText('P2', p2.x + pointRadius + 2 / state.zoom, p2.y - 2 / state.zoom);

      // Line between points
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      // Midpoint marker (circle with crosshair)
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;

      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.arc(midX, midY, pointRadius * 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.stroke();

      // Crosshair on midpoint
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1 / state.zoom;
      ctx.beginPath();
      ctx.moveTo(midX - pointRadius * 2, midY);
      ctx.lineTo(midX + pointRadius * 2, midY);
      ctx.moveTo(midX, midY - pointRadius * 2);
      ctx.lineTo(midX, midY + pointRadius * 2);
      ctx.stroke();

      // Distance label at midpoint
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      ctx.fillStyle = '#4ade80';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${dist.toFixed(1)}px`, midX, midY - pointRadius * 2 - 2 / state.zoom);
    }
  }

  ctx.restore();
}

// Draw stroke size preview at cursor position
function drawCursorPreview() {
  // Only show for tools in CURSOR_PREVIEW_TOOLS (defined in constants.js)
  if (!CURSOR_PREVIEW_TOOLS.includes(state.tool)) return;
  if (state.cursorX < 0 || state.cursorY < 0) return;

  ctx.save();

  const px = Math.floor(state.cursorX);
  const py = Math.floor(state.cursorY);

  if (state.tool === 'lasso') {
    // Lasso: crosshair that scales with zoom to maintain consistent screen size
    const armLength = Math.max(1, Math.round(8 / state.zoom));

    ctx.fillStyle = '#00ff88';
    ctx.globalAlpha = 0.8;
    // Center dot
    ctx.fillRect(px, py, 1, 1);
    // Crosshair arms
    ctx.globalAlpha = 0.5;
    for (let i = -armLength; i <= armLength; i++) {
      if (i !== 0) {
        ctx.fillRect(px + i, py, 1, 1);
        ctx.fillRect(px, py + i, 1, 1);
      }
    }
    ctx.restore();
    return;
  }

  if (state.tool === 'clone-stamp') {
    // Clone stamp: show brush circle and source marker
    const brushSize = cloneStamp.getBrushSize();
    const half = Math.floor(brushSize / 2);

    // Draw source marker if set
    cloneStamp.drawSourceMarker(ctx);

    // Draw brush outline at cursor
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1 / state.zoom;
    ctx.beginPath();
    ctx.arc(px + 0.5, py + 0.5, half, 0, Math.PI * 2);
    ctx.stroke();

    // Dashed inner circle
    ctx.strokeStyle = '#000000';
    ctx.setLineDash([2 / state.zoom, 2 / state.zoom]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
    return;
  }

  if (state.tool === 'edge-fill') {
    // Edge fill: show reference points and cursor
    const refPoints = getEdgeFillRefPoints();

    // Draw reference point markers
    for (let i = 0; i < refPoints.length; i++) {
      const rp = refPoints[i];

      // Marker circle
      ctx.strokeStyle = '#ff00ff';
      ctx.lineWidth = 2 / state.zoom;
      ctx.beginPath();
      ctx.arc(rp.x + 0.5, rp.y + 0.5, 8 / state.zoom, 0, Math.PI * 2);
      ctx.stroke();

      // Cross
      ctx.beginPath();
      ctx.moveTo(rp.x - 4 / state.zoom, rp.y + 0.5);
      ctx.lineTo(rp.x + 4 / state.zoom, rp.y + 0.5);
      ctx.moveTo(rp.x + 0.5, rp.y - 4 / state.zoom);
      ctx.lineTo(rp.x + 0.5, rp.y + 4 / state.zoom);
      ctx.stroke();

      // Number label
      ctx.fillStyle = '#ff00ff';
      ctx.font = `${Math.max(8, 12 / state.zoom)}px sans-serif`;
      ctx.fillText(`${i + 1}`, rp.x + 10 / state.zoom, rp.y - 4 / state.zoom);
    }

    // Show hint if no ref points
    if (refPoints.length === 0) {
      ctx.fillStyle = 'rgba(255, 0, 255, 0.7)';
      ctx.font = `${Math.max(8, 10 / state.zoom)}px sans-serif`;
      ctx.fillText('Alt+Click to add ref points', px + 10 / state.zoom, py - 5 / state.zoom);
    }

    // Cursor crosshair
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1 / state.zoom;
    ctx.beginPath();
    ctx.moveTo(px - 6 / state.zoom, py + 0.5);
    ctx.lineTo(px + 6 / state.zoom, py + 0.5);
    ctx.moveTo(px + 0.5, py - 6 / state.zoom);
    ctx.lineTo(px + 0.5, py + 6 / state.zoom);
    ctx.stroke();

    ctx.restore();
    return;
  }

  if (state.tool === 'spray') {
    // Spray: circular outline showing spray radius
    const radius = Math.max(1, state.strokeWidth);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1 / state.zoom;
    ctx.beginPath();
    ctx.arc(px + 0.5, py + 0.5, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Dashed inner
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.setLineDash([2 / state.zoom, 2 / state.zoom]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
    return;
  }

  if (state.tool === 'blend') {
    // Blend brush: circular outline showing blend radius (cyan to distinguish)
    const radius = Math.max(1, Math.floor(state.strokeWidth / 2));

    ctx.strokeStyle = 'rgba(0, 255, 200, 0.8)';
    ctx.lineWidth = 1 / state.zoom;
    ctx.beginPath();
    ctx.arc(px + 0.5, py + 0.5, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Dashed inner
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.setLineDash([2 / state.zoom, 2 / state.zoom]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
    return;
  }

  // Use same size calculation as selection brush (Math.max(1, ...))
  const size = Math.max(1, state.strokeWidth);

  // Get brush bounds using shared utility (consistent with actual brush painting)
  const bounds = getBrushBounds(state.cursorX, state.cursorY, size);

  if (state.tool === 'selection-brush') {
    // Selection brush: semi-transparent cyan fill (matches selection exactly)
    ctx.fillStyle = 'rgba(0, 255, 255, 0.3)';
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  } else if (state.tool === 'eraser') {
    // Eraser: semi-transparent red fill
    ctx.fillStyle = 'rgba(255, 100, 100, 0.3)';
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  } else {
    // Other tools: semi-transparent stroke color fill
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = state.strokeColor;
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  }

  ctx.restore();
}

// Render Variant Builder mode
function renderVariantBuilder() {
  // Draw reference image first (behind parts)
  if (state.showReferenceImage && state.referenceImage?.img) {
    drawReferenceImage();
  }

  const sortedParts = getPartsSortedByZ();
  const animTime = animation.getAnimationTime();
  const animState = animation.getAnimationState();
  const isAnimating = animation.isPreviewPlaying();

  // Get aim angle for aim-based animations (recoil direction, turret aim, etc.)
  // Use the manual preview aim angle from the animation module
  const aimAngle = animation.getPreviewAimAngle();
  const animExtra = { aimAngle };

  sortedParts.forEach((partInVariant) => {
    // Skip invisible parts
    if (partInVariant.visible === false) return;

    const partIndex = state.partsInVariant.indexOf(partInVariant);
    const isPrimary = partIndex === state.selectedPartInVariant;
    const isInSelection = isPartSelected(partIndex);

    // Get world transform (accounts for hierarchy and animation)
    let x, y, rotation, scale;
    let originOffsetX = 0, originOffsetY = 0;
    let isAttached = false;

    // Use animated transform when playing OR when aim angle is set (for preview slider)
    // This ensures children of aimed parts rotate correctly through hierarchy
    const useAnimatedTransform = isAnimating || aimAngle !== 0;

    if (useAnimatedTransform) {
      // Use animated world transform that propagates through hierarchy
      const effectiveTime = isAnimating ? animTime : 0;
      const effectiveState = isAnimating ? animState : 'aim';
      const world = snapPointSystem.getAnimatedWorldTransform(partIndex, effectiveTime, effectiveState, animExtra);
      x = world.x;
      y = world.y;
      rotation = world.rotation;
      scale = world.scale;
      originOffsetX = world.originOffsetX || 0;
      originOffsetY = world.originOffsetY || 0;
      isAttached = world.isAttached || false;
    } else if (partInVariant.parentIndex !== null) {
      // Attached part - use world transform with anchor-based positioning
      const world = snapPointSystem.getWorldTransform(partIndex);
      x = world.x;
      y = world.y;
      rotation = world.rotation;
      scale = world.scale;
      originOffsetX = world.originOffsetX || 0;
      originOffsetY = world.originOffsetY || 0;
      isAttached = world.isAttached || false;
    } else {
      // Root part - use direct values
      x = partInVariant.x;
      y = partInVariant.y;
      rotation = partInVariant.rotation || 0;
      scale = partInVariant.scale || 1;
    }

    // Get part dimensions
    const img = partInVariant.image ? getCachedImage(partInVariant.image) : null;
    const partW = img ? (img.naturalWidth || img.width) : 60;
    const partH = img ? (img.naturalHeight || img.height) : 60;

    ctx.save();
    ctx.globalAlpha = partInVariant.opacity / 100;

    if (isAttached) {
      // Attached part: rotate around anchor (snap point), then offset by origin
      // This makes the part's attachment point stay at the anchor while rotating
      ctx.translate(x, y);                    // Move to anchor (snap point)
      ctx.rotate(rotation * Math.PI / 180);   // Rotate around anchor
      ctx.scale(scale, scale);
      ctx.translate(-originOffsetX, -originOffsetY);  // Offset so origin is at anchor
    } else {
      // Root part: use pivot-based rotation (legacy behavior)
      const pivotX = partInVariant.pivotX ?? x;
      const pivotY = partInVariant.pivotY ?? y;

      ctx.translate(pivotX, pivotY);
      ctx.rotate(rotation * Math.PI / 180);
      ctx.translate(-pivotX, -pivotY);
      ctx.translate(x, y);
      ctx.scale(scale, scale);
    }

    // Draw part image
    if (img) {
      ctx.drawImage(img, -partW/2, -partH/2, partW, partH);
    } else {
      // Fallback placeholder
      ctx.strokeStyle = isInSelection ? '#4ade80' : '#3b82f6';
      ctx.lineWidth = 2;
      ctx.strokeRect(-partW/2, -partH/2, partW, partH);
      ctx.fillStyle = isInSelection ? 'rgba(74, 222, 128, 0.1)' : 'rgba(59, 130, 246, 0.1)';
      ctx.fillRect(-partW/2, -partH/2, partW, partH);
      ctx.fillStyle = '#888';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(partInVariant.name.substring(0, 10), 0, 4);
    }

    // Selection indicators (marching ants) are now rendered via HTML overlay (selection-overlay.js)
    // Canvas-based rendering disabled for crisp display at any zoom
    // if (isInSelection) {
    //   const pad = 5;
    //   ctx.strokeStyle = isPrimary ? '#4ade80' : '#22c55e';
    //   ctx.lineWidth = isPrimary ? 2 : 1.5;
    //   ctx.setLineDash([4, 4]);
    //   ctx.strokeRect(-partW/2 - pad, -partH/2 - pad, partW + pad*2, partH + pad*2);
    //   ctx.setLineDash([]);
    // }

    // Draw pivot point indicator if pivot differs from part position (still canvas-based)
    if (isInSelection) {
      const hasPivot = partInVariant.pivotX !== null || partInVariant.pivotY !== null;
      if (hasPivot) {
        // Pivot is in canvas coords, we're in part-local scaled coords
        // Calculate offset from part center to pivot
        const pivotX = partInVariant.pivotX ?? x;
        const pivotY = partInVariant.pivotY ?? y;
        const offsetX = (pivotX - x) / scale;
        const offsetY = (pivotY - y) / scale;

        ctx.strokeStyle = '#f97316'; // Orange for pivot
        ctx.fillStyle = '#f97316';
        ctx.lineWidth = 1.5;
        const sz = 6 / scale;
        ctx.beginPath();
        ctx.moveTo(offsetX - sz, offsetY);
        ctx.lineTo(offsetX + sz, offsetY);
        ctx.moveTo(offsetX, offsetY - sz);
        ctx.lineTo(offsetX, offsetY + sz);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(offsetX, offsetY, 2 / scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  });

  // Axis gizmos are now rendered via HTML overlay (gizmo-overlay.js)
  // Canvas-based rendering disabled for crisp display at any zoom
  // drawAxisGizmo();

  // Marquee selection is now rendered via HTML overlay (selection-overlay.js)
  // Canvas-based rendering disabled for crisp display at any zoom
  // if (isMarqueeSelecting()) {
  //   drawMarquee();
  // }

  // Snap points are now rendered via HTML overlay (snap-overlay.js)
  // Canvas-based rendering disabled for crisp display at any zoom
  // if (isDraggingPart() || state.showSnapPoints) {
  //   drawSnapPointsFeedback();
  // }

  // Draw scale reference overlay
  if (state.showScaleOverlay) {
    drawScaleOverlay();
  }

  // Draw grid if enabled
  if (state.showGrid) {
    drawGrid();
  }
}

// Draw snap point visual feedback during drag
function drawSnapPointsFeedback() {
  const allSnapPoints = snapPointSystem.getAllSnapPointsInVariant();
  const candidate = snapPointSystem.getCandidateSnapPoint();

  ctx.save();

  // Draw all available snap points (larger, more visible)
  allSnapPoints.forEach(sp => {
    const isCandidate = candidate &&
      candidate.parentIndex === sp.partIndex &&
      candidate.snapPointId === sp.snapPoint.id;

    if (isCandidate) return;  // Will draw candidate separately

    // Check if this snap point is being hovered
    const isHovered = state.hoveredSnapPoint &&
      state.hoveredSnapPoint.partIndex === sp.partIndex &&
      state.hoveredSnapPoint.snapPoint.id === sp.snapPoint.id;

    const baseRadius = sp.isOccupied ? 4 / state.zoom : 8 / state.zoom;
    const radius = isHovered ? baseRadius * 1.5 : baseRadius;
    const alpha = sp.isOccupied ? 0.2 : (isHovered ? 1 : 0.7);

    // Outer glow for hovered
    if (isHovered && !sp.isOccupied) {
      ctx.beginPath();
      ctx.arc(sp.worldX, sp.worldY, radius + 4 / state.zoom, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.globalAlpha = 1;
      ctx.fill();
    }

    // Outer ring
    ctx.beginPath();
    ctx.arc(sp.worldX, sp.worldY, radius, 0, Math.PI * 2);
    ctx.fillStyle = sp.typeInfo.color;
    ctx.globalAlpha = alpha;
    ctx.fill();

    // White border for visibility
    if (!sp.isOccupied) {
      ctx.strokeStyle = isHovered ? '#fff' : '#fff';
      ctx.lineWidth = (isHovered ? 2.5 : 1.5) / state.zoom;
      ctx.globalAlpha = isHovered ? 1 : 0.8;
      ctx.stroke();

      // Inner dot
      ctx.beginPath();
      ctx.arc(sp.worldX, sp.worldY, (isHovered ? 3 : 2) / state.zoom, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = 1;
      ctx.fill();

      // Label with snap point name
      const fontSize = isHovered ? Math.max(11, 12 / state.zoom) : Math.max(9, 10 / state.zoom);
      ctx.font = `${isHovered ? 'bold ' : ''}${fontSize}px sans-serif`;
      ctx.fillStyle = isHovered ? '#fff' : sp.typeInfo.color;
      ctx.globalAlpha = isHovered ? 1 : 0.9;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(sp.snapPoint.name, sp.worldX + radius + 3 / state.zoom, sp.worldY);
    }
  });

  // Draw candidate snap point (highlighted)
  if (candidate) {
    const radius = 10 / state.zoom;

    // Outer glow
    ctx.beginPath();
    ctx.arc(candidate.x, candidate.y, radius + 4 / state.zoom, 0, Math.PI * 2);
    ctx.fillStyle = candidate.compatible ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)';
    ctx.globalAlpha = 1;
    ctx.fill();

    // Main circle
    ctx.beginPath();
    ctx.arc(candidate.x, candidate.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = candidate.compatible ? '#22c55e' : '#ef4444';
    ctx.fill();

    // Inner dot
    ctx.beginPath();
    ctx.arc(candidate.x, candidate.y, 3 / state.zoom, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();

    // Label
    ctx.font = `${Math.max(10, 12 / state.zoom)}px sans-serif`;
    ctx.fillStyle = candidate.compatible ? '#22c55e' : '#ef4444';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const label = candidate.compatible ? `✓ ${candidate.snapPointId}` : `✗ ${candidate.snapPointId}`;
    ctx.fillText(label, candidate.x + radius + 6 / state.zoom, candidate.y);
  }

  ctx.restore();
}

// Draw reference image overlay (centered on canvas origin)
function drawReferenceImage() {
  const ref = state.referenceImage;
  if (!ref || !ref.img) return;

  const img = ref.img;
  const scale = (ref.scale || 100) / 100;
  const opacity = (ref.opacity || 50) / 100;
  const offsetX = ref.x || 0;
  const offsetY = ref.y || 0;

  // Center the image on canvas origin
  const cx = state.canvasWidth / 2;
  const cy = state.canvasHeight / 2;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(cx + offsetX, cy + offsetY);
  ctx.scale(scale, scale);
  ctx.drawImage(img, -w / 2, -h / 2);
  ctx.restore();
}

// Draw scale reference overlay showing optimal unit dimensions
function drawScaleOverlay() {
  // Determine which unit type to show (use dimension category for hull sizing)
  const category = state.scaleOverlayType ||
    UNIT_DIMENSION_CATEGORY[state.selectedObjectId] ||
    'heavy_tank';

  const dims = UNIT_DIMENSIONS[category];
  if (!dims) return;

  const cx = state.canvasWidth / 2;
  const cy = state.canvasHeight / 2;
  const hw = dims.width / 2;
  const hh = dims.height / 2;

  ctx.save();

  // Draw semi-transparent mask outside the target area
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  // Top
  ctx.fillRect(0, 0, state.canvasWidth, cy - hh);
  // Bottom
  ctx.fillRect(0, cy + hh, state.canvasWidth, state.canvasHeight - (cy + hh));
  // Left
  ctx.fillRect(0, cy - hh, cx - hw, dims.height);
  // Right
  ctx.fillRect(cx + hw, cy - hh, state.canvasWidth - (cx + hw), dims.height);

  // Draw the target box outline
  ctx.strokeStyle = dims.color;
  ctx.lineWidth = 2 / state.zoom;
  ctx.setLineDash([4 / state.zoom, 4 / state.zoom]);
  ctx.strokeRect(cx - hw, cy - hh, dims.width, dims.height);
  ctx.setLineDash([]);

  // Draw corner markers
  const cornerSize = 8 / state.zoom;
  ctx.fillStyle = dims.color;
  // Top-left
  ctx.fillRect(cx - hw - 1, cy - hh - 1, cornerSize, 2 / state.zoom);
  ctx.fillRect(cx - hw - 1, cy - hh - 1, 2 / state.zoom, cornerSize);
  // Top-right
  ctx.fillRect(cx + hw - cornerSize + 1, cy - hh - 1, cornerSize, 2 / state.zoom);
  ctx.fillRect(cx + hw - 1, cy - hh - 1, 2 / state.zoom, cornerSize);
  // Bottom-left
  ctx.fillRect(cx - hw - 1, cy + hh - 1, cornerSize, 2 / state.zoom);
  ctx.fillRect(cx - hw - 1, cy + hh - cornerSize + 1, 2 / state.zoom, cornerSize);
  // Bottom-right
  ctx.fillRect(cx + hw - cornerSize + 1, cy + hh - 1, cornerSize, 2 / state.zoom);
  ctx.fillRect(cx + hw - 1, cy + hh - cornerSize + 1, 2 / state.zoom, cornerSize);

  // Draw dimension labels
  ctx.fillStyle = dims.color;
  ctx.font = `${Math.max(10, 12 / state.zoom)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  // Width label (top)
  ctx.fillText(`${dims.width}px`, cx, cy - hh - 4 / state.zoom);

  // Height label (right)
  ctx.save();
  ctx.translate(cx + hw + 4 / state.zoom, cy);
  ctx.rotate(Math.PI / 2);
  ctx.textBaseline = 'top';
  ctx.fillText(`${dims.height}px`, 0, 0);
  ctx.restore();

  // Unit type label (bottom)
  ctx.textBaseline = 'top';
  ctx.fillText(dims.label, cx, cy + hh + 4 / state.zoom);

  ctx.restore();
}

// Draw X/Y axis gizmo for a single part at given position
function drawGizmoAt(cx, cy, isPrimary = false) {
  const arrowLen = 40 / state.zoom;
  const arrowHead = 10 / state.zoom;
  const hitRadius = 8 / state.zoom;
  const alpha = isPrimary ? 1.0 : 0.6;  // Dimmer for non-primary

  ctx.save();
  ctx.globalAlpha = alpha;

  // X axis (red) - points right
  ctx.strokeStyle = '#ef4444';
  ctx.fillStyle = '#ef4444';
  ctx.lineWidth = 3 / state.zoom;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + arrowLen, cy);
  ctx.stroke();
  // Arrow head
  ctx.beginPath();
  ctx.moveTo(cx + arrowLen + arrowHead, cy);
  ctx.lineTo(cx + arrowLen, cy - arrowHead / 2);
  ctx.lineTo(cx + arrowLen, cy + arrowHead / 2);
  ctx.closePath();
  ctx.fill();
  // Hit circle at end
  ctx.globalAlpha = alpha * 0.3;
  ctx.beginPath();
  ctx.arc(cx + arrowLen, cy, hitRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = alpha;

  // Y axis (green) - points down
  ctx.strokeStyle = '#22c55e';
  ctx.fillStyle = '#22c55e';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy + arrowLen);
  ctx.stroke();
  // Arrow head
  ctx.beginPath();
  ctx.moveTo(cx, cy + arrowLen + arrowHead);
  ctx.lineTo(cx - arrowHead / 2, cy + arrowLen);
  ctx.lineTo(cx + arrowHead / 2, cy + arrowLen);
  ctx.closePath();
  ctx.fill();
  // Hit circle at end
  ctx.globalAlpha = alpha * 0.3;
  ctx.beginPath();
  ctx.arc(cx, cy + arrowLen, hitRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = alpha;

  // Center dot (white) for free drag
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1 / state.zoom;
  ctx.beginPath();
  ctx.arc(cx, cy, hitRadius * 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

// Draw X/Y axis gizmos for all selected parts
function drawAxisGizmo() {
  const selectedIndices = getSelectedPartIndices();
  if (selectedIndices.size === 0) return;

  // Helper to get gizmo position (always uses world transform for consistency)
  const getGizmoPos = (idx) => {
    const world = snapPointSystem.getWorldTransform(idx);
    return world ? { x: world.x, y: world.y } : null;
  };

  // Draw gizmos for all selected parts (non-primary first, then primary on top)
  for (const idx of selectedIndices) {
    if (idx === state.selectedPartInVariant) continue; // Skip primary, draw last
    const pos = getGizmoPos(idx);
    if (pos) {
      drawGizmoAt(pos.x, pos.y, false);
    }
  }

  // Draw primary selected part's gizmo last (on top)
  if (state.selectedPartInVariant !== null) {
    const pos = getGizmoPos(state.selectedPartInVariant);
    if (pos) {
      drawGizmoAt(pos.x, pos.y, true);
    }
  }
}

// Get gizmo handle at position (for hit testing)
// Returns: 'x', 'y', 'center', or null
export function getGizmoHandleAt(x, y) {
  if (state.selectedPartInVariant === null) return null;

  // Get gizmo center (always use world transform for consistency)
  const world = snapPointSystem.getWorldTransform(state.selectedPartInVariant);
  if (!world) return null;

  const cx = world.x;
  const cy = world.y;
  const arrowLen = 40 / state.zoom;
  const hitRadius = 12 / state.zoom;  // Slightly larger for easier clicking

  // Check X handle
  const xHandleX = cx + arrowLen;
  const xHandleY = cy;
  if (Math.hypot(x - xHandleX, y - xHandleY) < hitRadius) {
    return 'x';
  }

  // Check Y handle
  const yHandleX = cx;
  const yHandleY = cy + arrowLen;
  if (Math.hypot(x - yHandleX, y - yHandleY) < hitRadius) {
    return 'y';
  }

  // Check center
  if (Math.hypot(x - cx, y - cy) < hitRadius) {
    return 'center';
  }

  return null;
}

// Create fill style (solid or gradient) for a shape
function getFillStyle(shape, ctx) {
  if (!shape.fillColor) return null;
  if (!shape.fillType || shape.fillType === 'solid') return shape.fillColor;

  const angle = (shape.fillAngle || 0) * Math.PI / 180;
  const color1 = shape.fillColor;
  const color2 = shape.fillColor2 || shape.fillColor;

  // Calculate bounds for gradient
  let cx, cy, r;
  if (shape.type === 'rect') {
    cx = shape.x + shape.width / 2;
    cy = shape.y + shape.height / 2;
    r = Math.max(shape.width, shape.height) / 2;
  } else if (shape.type === 'circle') {
    cx = shape.x; cy = shape.y; r = shape.radius;
  } else if (shape.type === 'ellipse') {
    cx = shape.x; cy = shape.y; r = Math.max(shape.radiusX, shape.radiusY);
  } else {
    return shape.fillColor;
  }

  if (shape.fillType === 'linear') {
    const x1 = cx - Math.cos(angle) * r;
    const y1 = cy - Math.sin(angle) * r;
    const x2 = cx + Math.cos(angle) * r;
    const y2 = cy + Math.sin(angle) * r;
    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, color1);
    grad.addColorStop(1, color2);
    return grad;
  } else if (shape.fillType === 'radial') {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, color1);
    grad.addColorStop(1, color2);
    return grad;
  }
  return shape.fillColor;
}

// Pixel-perfect drawing helpers (Bresenham algorithms) - exported for preview use
export function drawPixelLine(ctx, x0, y0, x1, y1, size, color) {
  ctx.fillStyle = color;
  const offset = Math.floor((size - 1) / 2);
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;

  while (true) {
    ctx.fillRect(x - offset, y - offset, size, size);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

export function drawPixelRect(ctx, x, y, w, h, size, color) {
  // Draw 4 lines for rectangle outline
  const x2 = x + w, y2 = y + h;
  drawPixelLine(ctx, x, y, x2, y, size, color);     // Top
  drawPixelLine(ctx, x2, y, x2, y2, size, color);   // Right
  drawPixelLine(ctx, x2, y2, x, y2, size, color);   // Bottom
  drawPixelLine(ctx, x, y2, x, y, size, color);     // Left
}

export function drawPixelCircle(ctx, cx, cy, radius, size, color) {
  ctx.fillStyle = color;
  const offset = Math.floor((size - 1) / 2);
  let x = 0, y = Math.round(radius);
  let d = 1 - Math.round(radius);

  const plot = (px, py) => ctx.fillRect(px - offset, py - offset, size, size);

  while (x <= y) {
    plot(cx + x, cy + y); plot(cx - x, cy + y);
    plot(cx + x, cy - y); plot(cx - x, cy - y);
    plot(cx + y, cy + x); plot(cx - y, cy + x);
    plot(cx + y, cy - x); plot(cx - y, cy - x);
    x++;
    if (d < 0) {
      d += 2 * x + 1;
    } else {
      y--;
      d += 2 * (x - y) + 1;
    }
  }
}

export function drawPixelEllipse(ctx, cx, cy, rx, ry, size, color) {
  ctx.fillStyle = color;
  const offset = Math.floor((size - 1) / 2);
  rx = Math.round(rx); ry = Math.round(ry);
  if (rx === 0 || ry === 0) return;

  const plot = (px, py) => ctx.fillRect(px - offset, py - offset, size, size);

  let x = 0, y = ry;
  let rx2 = rx * rx, ry2 = ry * ry;
  let p1 = ry2 - rx2 * ry + 0.25 * rx2;

  // Region 1
  while (ry2 * x < rx2 * y) {
    plot(cx + x, cy + y); plot(cx - x, cy + y);
    plot(cx + x, cy - y); plot(cx - x, cy - y);
    x++;
    if (p1 < 0) {
      p1 += 2 * ry2 * x + ry2;
    } else {
      y--;
      p1 += 2 * ry2 * x - 2 * rx2 * y + ry2;
    }
  }

  // Region 2
  let p2 = ry2 * (x + 0.5) * (x + 0.5) + rx2 * (y - 1) * (y - 1) - rx2 * ry2;
  while (y >= 0) {
    plot(cx + x, cy + y); plot(cx - x, cy + y);
    plot(cx + x, cy - y); plot(cx - x, cy - y);
    y--;
    if (p2 > 0) {
      p2 -= 2 * rx2 * y + rx2;
    } else {
      x++;
      p2 += 2 * ry2 * x - 2 * rx2 * y + rx2;
    }
  }
}

// Draw a shape to a specific context (for offscreen layer rendering)
export function drawShapeToContext(targetCtx, shape) {
  targetCtx.save();

  // Apply shape opacity
  if (shape.opacity !== undefined && shape.opacity < 100) {
    targetCtx.globalAlpha = shape.opacity / 100;
  }

  const pixelPerfect = shape.pixelPerfect !== undefined ? shape.pixelPerfect : state.pixelPerfect;
  const size = shape.strokeWidth || state.strokeWidth;
  const color = shape.strokeColor || state.strokeColor;

  // Handle eraser with destination-out composite
  if (shape.isEraser) {
    targetCtx.globalCompositeOperation = 'destination-out';
    targetCtx.strokeStyle = 'rgba(255,255,255,1)';
    targetCtx.lineWidth = size;
    targetCtx.lineCap = 'round';
    targetCtx.lineJoin = 'round';
  } else if (!pixelPerfect) {
    targetCtx.strokeStyle = color;
    targetCtx.lineWidth = size;
    targetCtx.lineCap = 'round';
    targetCtx.lineJoin = 'round';
  }

  switch (shape.type) {
    case 'rect':
      if (pixelPerfect) {
        if (shape.fillColor) {
          targetCtx.fillStyle = getFillStyle(shape, targetCtx);
          targetCtx.fillRect(Math.round(shape.x), Math.round(shape.y), Math.round(shape.width), Math.round(shape.height));
        }
        drawPixelRect(targetCtx, Math.round(shape.x), Math.round(shape.y), Math.round(shape.width), Math.round(shape.height), size, color);
      } else {
        if (shape.fillColor) {
          targetCtx.fillStyle = getFillStyle(shape, targetCtx);
          targetCtx.fillRect(shape.x, shape.y, shape.width, shape.height);
        }
        targetCtx.strokeRect(shape.x, shape.y, shape.width, shape.height);
      }
      break;

    case 'circle':
      if (pixelPerfect) {
        if (shape.fillColor) {
          targetCtx.fillStyle = getFillStyle(shape, targetCtx);
          targetCtx.beginPath();
          targetCtx.arc(Math.round(shape.x), Math.round(shape.y), Math.round(shape.radius), 0, Math.PI * 2);
          targetCtx.fill();
        }
        drawPixelCircle(targetCtx, Math.round(shape.x), Math.round(shape.y), shape.radius, size, color);
      } else {
        targetCtx.beginPath();
        targetCtx.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
        if (shape.fillColor) {
          targetCtx.fillStyle = getFillStyle(shape, targetCtx);
          targetCtx.fill();
        }
        targetCtx.stroke();
      }
      break;

    case 'line':
      if (pixelPerfect) {
        drawPixelLine(targetCtx, Math.round(shape.x1), Math.round(shape.y1), Math.round(shape.x2), Math.round(shape.y2), size, color);
      } else {
        targetCtx.beginPath();
        targetCtx.moveTo(shape.x1, shape.y1);
        targetCtx.lineTo(shape.x2, shape.y2);
        targetCtx.stroke();
      }
      break;

    case 'ellipse':
      if (pixelPerfect) {
        if (shape.fillColor) {
          targetCtx.fillStyle = getFillStyle(shape, targetCtx);
          targetCtx.beginPath();
          targetCtx.ellipse(Math.round(shape.x), Math.round(shape.y), Math.round(shape.radiusX), Math.round(shape.radiusY), 0, 0, Math.PI * 2);
          targetCtx.fill();
        }
        drawPixelEllipse(targetCtx, Math.round(shape.x), Math.round(shape.y), shape.radiusX, shape.radiusY, size, color);
      } else {
        targetCtx.beginPath();
        targetCtx.ellipse(shape.x, shape.y, shape.radiusX, shape.radiusY, 0, 0, Math.PI * 2);
        if (shape.fillColor) {
          targetCtx.fillStyle = getFillStyle(shape, targetCtx);
          targetCtx.fill();
        }
        targetCtx.stroke();
      }
      break;

    case 'path':
      if (shape.points && shape.points.length >= 1) {
        const size = shape.strokeWidth || state.strokeWidth;
        const color = shape.isEraser ? 'rgba(255,255,255,1)' : (shape.strokeColor || state.strokeColor);
        const pixelPerfect = shape.pixelPerfect !== undefined ? shape.pixelPerfect : state.pixelPerfect;

        // Set composite operation for eraser
        if (shape.isEraser) {
          targetCtx.globalCompositeOperation = 'destination-out';
        }

        if (pixelPerfect) {
          // Pixel-perfect mode: draw individual pixels along the path
          targetCtx.fillStyle = color;
          const offset = Math.floor((size - 1) / 2);
          const drawn = new Set(); // Avoid overdraw

          for (let i = 0; i < shape.points.length; i++) {
            const p = shape.points[i];
            const px = Math.floor(p.x);
            const py = Math.floor(p.y);

            // Draw line between consecutive points using Bresenham-style
            if (i > 0) {
              const prev = shape.points[i - 1];
              const x0 = Math.floor(prev.x), y0 = Math.floor(prev.y);
              const x1 = px, y1 = py;
              const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
              const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
              let err = dx - dy, x = x0, y = y0;

              while (true) {
                const key = `${x},${y}`;
                if (!drawn.has(key)) {
                  drawn.add(key);
                  targetCtx.fillRect(x - offset, y - offset, size, size);
                }
                if (x === x1 && y === y1) break;
                const e2 = 2 * err;
                if (e2 > -dy) { err -= dy; x += sx; }
                if (e2 < dx) { err += dx; y += sy; }
              }
            } else {
              // First point
              const key = `${px},${py}`;
              if (!drawn.has(key)) {
                drawn.add(key);
                targetCtx.fillRect(px - offset, py - offset, size, size);
              }
            }
          }
        } else {
          // Smooth mode: use canvas stroke with anti-aliasing
          if (shape.points.length === 1) {
            const p = shape.points[0];
            targetCtx.fillStyle = color;
            const offset = Math.floor((size - 1) / 2);
            targetCtx.fillRect(p.x - offset, p.y - offset, size, size);
          } else {
            targetCtx.beginPath();
            targetCtx.moveTo(shape.points[0].x, shape.points[0].y);
            for (let i = 1; i < shape.points.length; i++) {
              targetCtx.lineTo(shape.points[i].x, shape.points[i].y);
            }
            targetCtx.stroke();
          }
        }

        // Reset composite operation after eraser
        if (shape.isEraser) {
          targetCtx.globalCompositeOperation = 'source-over';
        }
      }
      break;

    case 'image':
      if (shape.imageData) {
        // Get cached image or create new one
        let img = getCachedImage(shape.imageData);
        if (!img) {
          // Image not loaded yet, trigger load and skip this frame
          loadImage(shape.imageData);
        } else {
          // Disable smoothing for crisp pixels
          targetCtx.imageSmoothingEnabled = false;
          targetCtx.drawImage(img, shape.x, shape.y, shape.width, shape.height);
        }
      }
      break;

    case 'fill':
      // Fill individual pixels
      if (shape.pixels && shape.color) {
        targetCtx.fillStyle = shape.color;
        shape.pixels.forEach(p => {
          targetCtx.fillRect(p.x, p.y, 1, 1);
        });
      }
      break;

    case 'spray':
      // Spray dots - scatter of individual pixels
      if (shape.dots && shape.color) {
        targetCtx.fillStyle = shape.color;
        shape.dots.forEach(d => {
          targetCtx.fillRect(d.x, d.y, 1, 1);
        });
      }
      break;

    case 'edge-fill':
    case 'stamp':
    case 'blend':
    case 'pixelate':
      // Per-pixel shapes - each pixel has its own color (exact pixel copy, no blending)
      if (shape.pixels) {
        shape.pixels.forEach(p => {
          // Support both RGB and RGBA
          const a = p.a !== undefined ? p.a / 255 : 1;
          targetCtx.fillStyle = `rgba(${p.r}, ${p.g}, ${p.b}, ${a})`;
          targetCtx.fillRect(p.x, p.y, 1, 1);
        });
      }
      break;
  }

  targetCtx.restore();
}

// Draw a shape to main canvas (legacy, for compatibility)
function drawShape(shape) {
  drawShapeToContext(ctx, shape);
}

// Draw grid - now just a no-op, checkerboard handles visibility
function drawGrid() {
  // Grid toggle now controls checkerboard visibility in drawCheckerboard()
}

// Create checkered pattern for selection highlight (transparent + light grey)
let selectionPattern = null;
function getSelectionPattern(ctx) {
  if (selectionPattern) return selectionPattern;
  const size = 4;
  const patternCanvas = document.createElement('canvas');
  patternCanvas.width = size * 2;
  patternCanvas.height = size * 2;
  const pctx = patternCanvas.getContext('2d');
  // First squares: transparent (leave empty)
  // Second squares: light grey
  pctx.fillStyle = 'rgba(220, 220, 220, 0.2)';
  pctx.fillRect(size, 0, size, size);
  pctx.fillRect(0, size, size, size);
  selectionPattern = ctx.createPattern(patternCanvas, 'repeat');
  return selectionPattern;
}

// Draw selection highlight for a shape (checkered overlay matching shape pixels)
function drawShapeSelectionOutline(ctx, shape) {
  ctx.save();
  const pattern = getSelectionPattern(ctx);

  switch (shape.type) {
    case 'image':
      ctx.fillStyle = pattern;
      ctx.fillRect(shape.x, shape.y, shape.width || 0, shape.height || 0);
      break;
    case 'rect':
      // Match the rect exactly - filled or stroked
      if (shape.fillColor) {
        ctx.fillStyle = pattern;
        ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
      }
      if (shape.strokeColor) {
        ctx.strokeStyle = pattern;
        ctx.lineWidth = shape.strokeWidth || 1;
        ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
      }
      break;
    case 'circle':
      ctx.beginPath();
      ctx.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
      if (shape.fillColor) {
        ctx.fillStyle = pattern;
        ctx.fill();
      }
      if (shape.strokeColor) {
        ctx.strokeStyle = pattern;
        ctx.lineWidth = shape.strokeWidth || 1;
        ctx.stroke();
      }
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(shape.x, shape.y, shape.radiusX, shape.radiusY, 0, 0, Math.PI * 2);
      if (shape.fillColor) {
        ctx.fillStyle = pattern;
        ctx.fill();
      }
      if (shape.strokeColor) {
        ctx.strokeStyle = pattern;
        ctx.lineWidth = shape.strokeWidth || 1;
        ctx.stroke();
      }
      break;
    case 'line':
      ctx.strokeStyle = pattern;
      ctx.lineWidth = shape.strokeWidth || 1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(shape.x1, shape.y1);
      ctx.lineTo(shape.x2, shape.y2);
      ctx.stroke();
      break;
    case 'path':
      if (shape.points && shape.points.length > 0) {
        ctx.strokeStyle = pattern;
        ctx.lineWidth = shape.strokeWidth || 1;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(shape.points[0].x, shape.points[0].y);
        for (let i = 1; i < shape.points.length; i++) {
          ctx.lineTo(shape.points[i].x, shape.points[i].y);
        }
        if (shape.points.length === 1) {
          // Single point - draw a dot
          ctx.fillStyle = pattern;
          ctx.arc(shape.points[0].x, shape.points[0].y, (shape.strokeWidth || 1) / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.stroke();
        }
      }
      break;
  }

  // Draw resize handles for images
  if (shape.type === 'image') {
    ctx.fillStyle = '#4ade80';
    const handleSize = 8;
    const hs = handleSize / 2;
    const x = shape.x, y = shape.y, w = shape.width, h = shape.height;

    // Corner handles (nw, ne, sw, se)
    ctx.fillRect(x - hs, y - hs, handleSize, handleSize);           // nw
    ctx.fillRect(x + w - hs, y - hs, handleSize, handleSize);       // ne
    ctx.fillRect(x - hs, y + h - hs, handleSize, handleSize);       // sw
    ctx.fillRect(x + w - hs, y + h - hs, handleSize, handleSize);   // se

    // Edge handles (n, s, e, w)
    ctx.fillRect(x + w/2 - hs, y - hs, handleSize, handleSize);     // n (top center)
    ctx.fillRect(x + w/2 - hs, y + h - hs, handleSize, handleSize); // s (bottom center)
    ctx.fillRect(x - hs, y + h/2 - hs, handleSize, handleSize);     // w (left center)
    ctx.fillRect(x + w - hs, y + h/2 - hs, handleSize, handleSize); // e (right center)
  }

  ctx.restore();
}

// Zoom controls - max 6000% for pixel-level detail, min 10%
export function zoomIn() {
  state.zoom = Math.min(60, state.zoom * 1.25);
  return updateZoom();
}

export function zoomOut() {
  state.zoom = Math.max(0.1, state.zoom / 1.25);
  return updateZoom();
}

export function resetZoom() {
  state.zoom = 1;
  return updateZoom();
}

export function updateZoom() {
  // Don't set transform here - let main.js handle it with pan offset
  // Just return the percentage for UI display
  return Math.round(state.zoom * 100);
}

// Get current zoom for external use
export function getZoom() {
  return state.zoom;
}

// Toggle grid
export function toggleGrid() {
  state.showGrid = !state.showGrid;
  return state.showGrid;
}

// Toggle reference image
export function toggleRef() {
  state.showRef = !state.showRef;
  return state.showRef;
}

// Draw onion skin - shows previous/next frames faintly
function drawOnionSkin() {
  const prevFrame = state.currentFrame > 0 ? state.frames[state.currentFrame - 1] : null;
  const nextFrame = state.currentFrame < state.frames.length - 1 ? state.frames[state.currentFrame + 1] : null;

  // Draw previous frame in red tint
  if (prevFrame && prevFrame.layers) {
    drawFrameLayers(prevFrame.layers, 0.3, 'rgba(255, 100, 100, 0.15)');
  }

  // Draw next frame in blue tint
  if (nextFrame && nextFrame.layers) {
    drawFrameLayers(nextFrame.layers, 0.3, 'rgba(100, 100, 255, 0.15)');
  }
}

// Helper to draw a frame's layers with opacity and optional tint
function drawFrameLayers(layers, opacity, tintColor = null) {
  // Create offscreen canvas for the entire frame
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = state.canvasWidth;
  frameCanvas.height = state.canvasHeight;
  const frameCtx = frameCanvas.getContext('2d');

  // Draw all layers to the offscreen canvas
  layers.forEach(layer => {
    if (!layer.visible) return;

    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = state.canvasWidth;
    layerCanvas.height = state.canvasHeight;
    const layerCtx = layerCanvas.getContext('2d');

    layer.shapes.forEach(shape => {
      drawShapeToContext(layerCtx, shape);
    });

    const layerOpacity = (layer.opacity ?? 100) / 100;
    frameCtx.globalAlpha = layerOpacity;
    frameCtx.drawImage(layerCanvas, 0, 0);
  });

  // Apply tint if specified
  if (tintColor) {
    frameCtx.globalCompositeOperation = 'source-atop';
    frameCtx.fillStyle = tintColor;
    frameCtx.fillRect(0, 0, state.canvasWidth, state.canvasHeight);
  }

  // Draw to main canvas
  ctx.globalAlpha = opacity;
  ctx.drawImage(frameCanvas, 0, 0);
  ctx.globalAlpha = 1;
}

// Generate a spritesheet from all frames (horizontal strip)
// Render current frame to a clean canvas (no checkerboard, no UI, no gizmos)
// Used for publishing and exporting
export function renderCleanFrame() {
  const cleanCanvas = document.createElement('canvas');
  cleanCanvas.width = state.canvasWidth;
  cleanCanvas.height = state.canvasHeight;
  const cleanCtx = cleanCanvas.getContext('2d');
  cleanCtx.imageSmoothingEnabled = false;

  // Draw all visible layers
  state.layers.forEach(layer => {
    if (!layer.visible) return;

    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = state.canvasWidth;
    layerCanvas.height = state.canvasHeight;
    const layerCtx = layerCanvas.getContext('2d');
    layerCtx.imageSmoothingEnabled = false;

    layer.shapes.forEach(shape => {
      drawShapeToContext(layerCtx, shape);
    });

    const layerOpacity = (layer.opacity ?? 100) / 100;
    cleanCtx.globalAlpha = layerOpacity;
    cleanCtx.drawImage(layerCanvas, 0, 0);
    cleanCtx.globalAlpha = 1;
  });

  return cleanCanvas;
}

export function generateSpritesheet() {
  const frameCount = state.frames.length;
  if (frameCount === 0) return null;

  // Create canvas for horizontal spritesheet
  const sheetCanvas = document.createElement('canvas');
  sheetCanvas.width = state.canvasWidth * frameCount;
  sheetCanvas.height = state.canvasHeight;
  const sheetCtx = sheetCanvas.getContext('2d');
  sheetCtx.imageSmoothingEnabled = false;

  // Render each frame
  state.frames.forEach((frame, idx) => {
    if (!frame.layers) return;

    const offsetX = idx * state.canvasWidth;

    // Draw all layers for this frame
    frame.layers.forEach(layer => {
      if (!layer.visible) return;

      const layerCanvas = document.createElement('canvas');
      layerCanvas.width = state.canvasWidth;
      layerCanvas.height = state.canvasHeight;
      const layerCtx = layerCanvas.getContext('2d');

      layer.shapes.forEach(shape => {
        drawShapeToContext(layerCtx, shape);
      });

      const layerOpacity = (layer.opacity ?? 100) / 100;
      sheetCtx.globalAlpha = layerOpacity;
      sheetCtx.drawImage(layerCanvas, offsetX, 0);
      sheetCtx.globalAlpha = 1;
    });
  });

  return {
    dataUrl: sheetCanvas.toDataURL('image/png'),
    width: sheetCanvas.width,
    height: sheetCanvas.height,
    frameCount,
    frameWidth: state.canvasWidth,
    frameHeight: state.canvasHeight
  };
}

// Generate a thumbnail for a frame
export function generateFrameThumbnail(frame, size = 48) {
  if (!frame || !frame.layers) return null;

  // Create offscreen canvas at full size
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = state.canvasWidth;
  fullCanvas.height = state.canvasHeight;
  const fullCtx = fullCanvas.getContext('2d');

  // Draw checkerboard background
  const checkerSize = 8;
  for (let y = 0; y < state.canvasHeight; y += checkerSize) {
    for (let x = 0; x < state.canvasWidth; x += checkerSize) {
      const light = (Math.floor(x / checkerSize) + Math.floor(y / checkerSize)) % 2 === 0;
      fullCtx.fillStyle = light ? '#3a3a3a' : '#2a2a2a';
      fullCtx.fillRect(x, y, checkerSize, checkerSize);
    }
  }

  // Draw all layers
  frame.layers.forEach(layer => {
    if (!layer.visible) return;

    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = state.canvasWidth;
    layerCanvas.height = state.canvasHeight;
    const layerCtx = layerCanvas.getContext('2d');

    layer.shapes.forEach(shape => {
      drawShapeToContext(layerCtx, shape);
    });

    const layerOpacity = (layer.opacity ?? 100) / 100;
    fullCtx.globalAlpha = layerOpacity;
    fullCtx.drawImage(layerCanvas, 0, 0);
    fullCtx.globalAlpha = 1;
  });

  // Scale down to thumbnail size
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = size;
  thumbCanvas.height = size;
  const thumbCtx = thumbCanvas.getContext('2d');
  thumbCtx.imageSmoothingEnabled = false;

  // Calculate aspect ratio preserving fit
  const scale = Math.min(size / state.canvasWidth, size / state.canvasHeight);
  const w = state.canvasWidth * scale;
  const h = state.canvasHeight * scale;
  const x = (size - w) / 2;
  const y = (size - h) / 2;

  thumbCtx.drawImage(fullCanvas, x, y, w, h);

  return thumbCanvas.toDataURL();
}

// Toggle onion skinning
export function toggleOnion() {
  state.showOnion = !state.showOnion;
  return state.showOnion;
}

// Toggle context parts visibility
export function toggleContextParts() {
  state.showContextParts = !state.showContextParts;
  return state.showContextParts;
}

// Set reference image
export function setRefImage(img) {
  state.refImage = img;
  state.showRef = !!img;
}

// Clear reference image
export function clearRefImage() {
  state.refImage = null;
  state.refImageUrl = null;
  state.showRef = false;
}

// Render a single layer to a context (for tools that need layer-specific data)
export function renderLayerToContext(targetCtx, layer) {
  // Clear the target context
  targetCtx.clearRect(0, 0, targetCtx.canvas.width, targetCtx.canvas.height);

  // Draw all shapes to the context
  layer.shapes.forEach(shape => {
    drawShapeToContext(targetCtx, shape);
  });
}

// Get image data from only the current layer (reusable for tools)
export function getCurrentLayerImageData() {
  const layer = state.layers.find(l => l.id === state.selectedLayerId);
  if (!layer) return null;

  // Create offscreen canvas for just this layer
  const offscreen = document.createElement('canvas');
  offscreen.width = state.canvasWidth;
  offscreen.height = state.canvasHeight;
  const offCtx = offscreen.getContext('2d');

  renderLayerToContext(offCtx, layer);

  return offCtx.getImageData(0, 0, state.canvasWidth, state.canvasHeight);
}

// Get image data from all visible layers combined (no background grid)
export function getAllLayersImageData() {
  const offscreen = document.createElement('canvas');
  offscreen.width = state.canvasWidth;
  offscreen.height = state.canvasHeight;
  const offCtx = offscreen.getContext('2d');

  // Disable image smoothing for crisp pixel-perfect rendering
  offCtx.imageSmoothingEnabled = false;

  // Clear with transparent background
  offCtx.clearRect(0, 0, state.canvasWidth, state.canvasHeight);

  // Render all visible layers in order (bottom to top)
  for (const layer of state.layers) {
    if (!layer.visible) continue;

    // Apply layer opacity and blend mode
    offCtx.globalAlpha = (layer.opacity ?? 100) / 100;
    offCtx.globalCompositeOperation = layer.blend || 'source-over';

    // Draw each shape in the layer
    for (const shape of layer.shapes) {
      drawShapeToContext(offCtx, shape);
    }

    // Reset
    offCtx.globalAlpha = 1;
    offCtx.globalCompositeOperation = 'source-over';
  }

  return offCtx.getImageData(0, 0, state.canvasWidth, state.canvasHeight);
}

// Draw marquee selection rectangle
function drawMarquee() {
  const bounds = getMarqueeBounds();
  if (!bounds) return;

  const { x1, y1, x2, y2 } = bounds;
  const w = x2 - x1;
  const h = y2 - y1;

  ctx.save();

  // Semi-transparent fill
  ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
  ctx.fillRect(x1, y1, w, h);

  // Dashed border
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 1 / state.zoom;
  ctx.setLineDash([4 / state.zoom, 4 / state.zoom]);
  ctx.strokeRect(x1, y1, w, h);
  ctx.setLineDash([]);

  ctx.restore();
}

// Get mouse position on canvas
export function getCanvasPosition(event) {
  const rect = canvas.getBoundingClientRect();

  // Use ratio-based calculation - more robust with CSS transforms
  // Position within the visible canvas as a ratio (0 to 1)
  const ratioX = (event.clientX - rect.left) / rect.width;
  const ratioY = (event.clientY - rect.top) / rect.height;

  // Convert to canvas pixel coordinates
  // Floor gives the pixel the cursor is currently over (standard for pixel editors)
  return {
    x: Math.floor(ratioX * canvas.width),
    y: Math.floor(ratioY * canvas.height)
  };
}
