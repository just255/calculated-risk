// sprite-editor/clone-stamp.js - Clone Stamp tool (Photoshop-style)
// Single responsibility: Handle clone/stamp operations with Alt+Click source

import { state } from './state.js';
import { getContext, render } from './canvas.js';

// Clone stamp state
let sourceX = null;
let sourceY = null;
let sourceSet = false;
let aligned = true;
let initialOffsetX = 0;
let initialOffsetY = 0;
let lastPaintX = null;
let lastPaintY = null;
let flipH = false;
let flipV = false;
let brushSize = 8;

/**
 * Check if clone source is set
 */
export function hasSource() {
  return sourceSet;
}

/**
 * Get current source position
 */
export function getSource() {
  return sourceSet ? { x: sourceX, y: sourceY } : null;
}

/**
 * Set clone source position (called on Alt+Click)
 */
export function setSource(x, y) {
  sourceX = Math.round(x);
  sourceY = Math.round(y);
  sourceSet = true;
  lastPaintX = null;
  lastPaintY = null;
  console.log(`[CloneStamp] Source set at (${sourceX}, ${sourceY})`);
}

/**
 * Clear clone source
 */
export function clearSource() {
  sourceX = null;
  sourceY = null;
  sourceSet = false;
  lastPaintX = null;
  lastPaintY = null;
}

/**
 * Get/set aligned mode
 */
export function isAligned() {
  return aligned;
}

export function setAligned(value) {
  aligned = value;
}

/**
 * Get/set flip options
 */
export function getFlipH() { return flipH; }
export function setFlipH(value) { flipH = value; }
export function getFlipV() { return flipV; }
export function setFlipV(value) { flipV = value; }

/**
 * Get/set brush size
 */
export function getBrushSize() { return brushSize; }
export function setBrushSize(value) {
  brushSize = Math.max(1, Math.min(64, value));
}

/**
 * Calculate source position for a given destination
 */
function getSourceForDest(destX, destY) {
  if (!sourceSet) return null;

  if (aligned && lastPaintX !== null) {
    // Aligned mode: maintain offset from initial source-dest relationship
    return {
      x: sourceX + (destX - lastPaintX),
      y: sourceY + (destY - lastPaintY)
    };
  } else {
    // Non-aligned: always sample from original source
    return { x: sourceX, y: sourceY };
  }
}

/**
 * Start painting (first click after source is set)
 */
export function startPaint(destX, destY) {
  if (!sourceSet) return;

  lastPaintX = destX;
  lastPaintY = destY;
  initialOffsetX = destX - sourceX;
  initialOffsetY = destY - sourceY;
}

/**
 * Paint clone pixels at destination
 * Returns array of {x, y, r, g, b, a} pixels
 */
export function paint(destX, destY, imageData) {
  if (!sourceSet) return null;

  const width = state.canvasWidth;
  const height = state.canvasHeight;
  const pixels = imageData.data;
  const half = Math.floor(brushSize / 2);

  const srcPos = getSourceForDest(destX, destY);
  if (!srcPos) return null;

  const result = [];

  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      // Circular brush
      if (dx * dx + dy * dy > half * half) continue;

      const dstX = destX + dx;
      const dstY = destY + dy;

      // Apply flip transformations
      let srcDx = flipH ? -dx : dx;
      let srcDy = flipV ? -dy : dy;

      const srcX = srcPos.x + srcDx;
      const srcY = srcPos.y + srcDy;

      // Bounds check
      if (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height) continue;
      if (dstX < 0 || dstX >= width || dstY < 0 || dstY >= height) continue;

      const srcIdx = (srcY * width + srcX) * 4;

      // Skip transparent source pixels
      if (pixels[srcIdx + 3] < 10) continue;

      result.push({
        x: dstX,
        y: dstY,
        r: pixels[srcIdx],
        g: pixels[srcIdx + 1],
        b: pixels[srcIdx + 2],
        a: pixels[srcIdx + 3]
      });
    }
  }

  // Update last paint position for aligned mode
  if (aligned) {
    lastPaintX = destX;
    lastPaintY = destY;
  }

  return result.length > 0 ? result : null;
}

/**
 * Get preview pixels for cursor position (ghost overlay)
 */
export function getPreview(destX, destY, imageData) {
  if (!sourceSet) return null;

  const width = state.canvasWidth;
  const height = state.canvasHeight;
  const pixels = imageData.data;
  const half = Math.floor(brushSize / 2);

  const srcPos = getSourceForDest(destX, destY);
  if (!srcPos) return null;

  const result = [];

  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      // Circular brush
      if (dx * dx + dy * dy > half * half) continue;

      const dstX = destX + dx;
      const dstY = destY + dy;

      // Apply flip transformations
      let srcDx = flipH ? -dx : dx;
      let srcDy = flipV ? -dy : dy;

      const srcX = srcPos.x + srcDx;
      const srcY = srcPos.y + srcDy;

      // Bounds check
      if (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height) continue;
      if (dstX < 0 || dstX >= width || dstY < 0 || dstY >= height) continue;

      const srcIdx = (srcY * width + srcX) * 4;

      // Skip transparent
      if (pixels[srcIdx + 3] < 10) continue;

      result.push({
        x: dstX,
        y: dstY,
        r: pixels[srcIdx],
        g: pixels[srcIdx + 1],
        b: pixels[srcIdx + 2],
        a: Math.floor(pixels[srcIdx + 3] * 0.5) // 50% opacity preview
      });
    }
  }

  return result;
}

/**
 * Draw source marker on canvas
 */
export function drawSourceMarker(ctx) {
  if (!sourceSet) return;

  const zoom = state.zoom || 1;
  const x = sourceX;
  const y = sourceY;

  ctx.save();

  // Crosshair
  ctx.strokeStyle = '#00ffff';
  ctx.lineWidth = 1 / zoom;

  // Vertical line
  ctx.beginPath();
  ctx.moveTo(x + 0.5, y - 8 / zoom);
  ctx.lineTo(x + 0.5, y + 8 / zoom);
  ctx.stroke();

  // Horizontal line
  ctx.beginPath();
  ctx.moveTo(x - 8 / zoom, y + 0.5);
  ctx.lineTo(x + 8 / zoom, y + 0.5);
  ctx.stroke();

  // Circle
  ctx.beginPath();
  ctx.arc(x + 0.5, y + 0.5, 4 / zoom, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

/**
 * Draw preview overlay at cursor
 */
export function drawPreview(ctx, destX, destY, previewPixels) {
  if (!previewPixels || previewPixels.length === 0) return;

  ctx.save();

  for (const p of previewPixels) {
    ctx.fillStyle = `rgba(${p.r}, ${p.g}, ${p.b}, ${p.a / 255})`;
    ctx.fillRect(p.x, p.y, 1, 1);
  }

  // Brush outline
  const half = Math.floor(brushSize / 2);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1 / (state.zoom || 1);
  ctx.beginPath();
  ctx.arc(destX + 0.5, destY + 0.5, half, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#000000';
  ctx.setLineDash([2, 2]);
  ctx.stroke();

  ctx.restore();
}
