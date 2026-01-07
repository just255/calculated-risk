// sprite-editor/selection.js - Selection tools and state
// Single responsibility: Handle selection operations (magic wand, marching ants, etc.)

import { state } from './state.js';
import { render, getContext, getCurrentLayerImageData, getAllLayersImageData } from './canvas.js';
import { getBrushBounds } from './constants.js';

// Selection state
let selectionMask = null;  // Uint8Array where 1 = selected, 0 = not selected
let selectionBounds = null; // { x, y, width, height }
let marchingAntsOffset = 0;
let marchingAntsInterval = null;

// Tolerance for magic wand (0-255)
let tolerance = 32;

// Get/set tolerance
export function getTolerance() {
  return tolerance;
}

export function setTolerance(value) {
  tolerance = Math.max(0, Math.min(255, value));
}

// Check if there's an active selection
export function hasSelection() {
  return selectionMask !== null;
}

// Get the selection mask
export function getSelectionMask() {
  return selectionMask;
}

// Get selection bounds
export function getSelectionBounds() {
  return selectionBounds;
}

// Clear selection
export function clearSelection() {
  selectionMask = null;
  selectionBounds = null;
  stopMarchingAnts();
}

// Set selection from external mask and bounds
export function setSelectionFromMask(mask, bounds) {
  selectionMask = mask;
  selectionBounds = bounds;
  startMarchingAnts();
}

// Start marching ants animation
export function startMarchingAnts() {
  if (marchingAntsInterval) return;
  marchingAntsInterval = setInterval(() => {
    marchingAntsOffset = (marchingAntsOffset + 1) % 8;
    render();
  }, 100);
}

// Stop marching ants animation
export function stopMarchingAnts() {
  if (marchingAntsInterval) {
    clearInterval(marchingAntsInterval);
    marchingAntsInterval = null;
    marchingAntsOffset = 0;
  }
}

// Get current marching ants offset
export function getMarchingAntsOffset() {
  return marchingAntsOffset;
}

// Magic wand selection
export function magicWandSelect(startX, startY, addToSelection = false) {
  // Get image data from layers only (no background grid)
  const imageData = getAllLayersImageData();
  if (!imageData) return;

  const width = imageData.width;
  const height = imageData.height;
  const pixels = imageData.data;

  // Get the target color at click position
  const targetIndex = (startY * width + startX) * 4;
  const targetR = pixels[targetIndex];
  const targetG = pixels[targetIndex + 1];
  const targetB = pixels[targetIndex + 2];
  const targetA = pixels[targetIndex + 3];

  // Create or reuse selection mask
  if (!addToSelection || !selectionMask) {
    selectionMask = new Uint8Array(width * height);
  }

  // Flood fill to find connected pixels
  const visited = new Uint8Array(width * height);
  const stack = [[startX, startY]];

  let minX = startX, maxX = startX;
  let minY = startY, maxY = startY;

  while (stack.length > 0) {
    const [x, y] = stack.pop();

    // Bounds check
    if (x < 0 || x >= width || y < 0 || y >= height) continue;

    const idx = y * width + x;

    // Already visited
    if (visited[idx]) continue;
    visited[idx] = 1;

    // Check color match
    const pixelIndex = idx * 4;
    const r = pixels[pixelIndex];
    const g = pixels[pixelIndex + 1];
    const b = pixels[pixelIndex + 2];
    const a = pixels[pixelIndex + 3];

    if (!colorMatches(r, g, b, a, targetR, targetG, targetB, targetA, tolerance)) {
      continue;
    }

    // Add to selection
    selectionMask[idx] = 1;

    // Update bounds
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    // Add neighbors (4-connected)
    stack.push([x + 1, y]);
    stack.push([x - 1, y]);
    stack.push([x, y + 1]);
    stack.push([x, y - 1]);
  }

  // Update bounds
  selectionBounds = {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };

  // Start marching ants if we have a selection
  if (hasSelection()) {
    startMarchingAnts();
  }

  return true;
}

// Check if two colors match within tolerance
function colorMatches(r1, g1, b1, a1, r2, g2, b2, a2, tol) {
  // Handle transparency
  if (a1 < 10 && a2 < 10) return true; // Both transparent
  if (a1 < 10 || a2 < 10) return false; // One transparent, one not

  const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
  return diff <= tol * 3; // Tolerance applies to each channel
}

// Offscreen canvas for mask (reused to avoid allocation)
let maskCanvas = null;
let maskCtx = null;

// Draw semi-transparent mask over NON-selected pixels (selection shows through clearly)
function drawSelectionFill(ctx) {
  if (!selectionMask || !selectionBounds) return;

  const width = ctx.canvas.width;
  const height = ctx.canvas.height;

  // Create/resize offscreen canvas for mask
  if (!maskCanvas || maskCanvas.width !== width || maskCanvas.height !== height) {
    maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    maskCtx = maskCanvas.getContext('2d');
  }

  // Clear and draw mask to offscreen canvas
  maskCtx.clearRect(0, 0, width, height);
  const opacity = state.selectionMaskOpacity || 0.5;
  maskCtx.fillStyle = `rgba(0, 0, 0, ${opacity})`;
  maskCtx.fillRect(0, 0, width, height);

  // Cut out selected pixels
  maskCtx.globalCompositeOperation = 'destination-out';
  maskCtx.fillStyle = 'rgba(0, 0, 0, 1)';

  for (let y = selectionBounds.y; y < selectionBounds.y + selectionBounds.height; y++) {
    for (let x = selectionBounds.x; x < selectionBounds.x + selectionBounds.width; x++) {
      const idx = y * width + x;
      if (selectionMask[idx]) {
        maskCtx.fillRect(x, y, 1, 1);
      }
    }
  }

  // Reset composite mode and draw mask onto main canvas
  maskCtx.globalCompositeOperation = 'source-over';
  ctx.drawImage(maskCanvas, 0, 0);
}

// Draw marching ants outline around selection
function drawMarchingAnts(ctx) {
  if (!selectionMask || !selectionBounds) return;

  const width = ctx.canvas.width;
  const height = ctx.canvas.height;

  ctx.save();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.lineDashOffset = -marchingAntsOffset;
  ctx.beginPath();

  for (let y = selectionBounds.y; y < selectionBounds.y + selectionBounds.height; y++) {
    for (let x = selectionBounds.x; x < selectionBounds.x + selectionBounds.width; x++) {
      const idx = y * width + x;
      if (!selectionMask[idx]) continue;

      // Top edge
      if (y === 0 || !selectionMask[(y - 1) * width + x]) {
        ctx.moveTo(x, y);
        ctx.lineTo(x + 1, y);
      }
      // Bottom edge
      if (y === height - 1 || !selectionMask[(y + 1) * width + x]) {
        ctx.moveTo(x, y + 1);
        ctx.lineTo(x + 1, y + 1);
      }
      // Left edge
      if (x === 0 || !selectionMask[y * width + (x - 1)]) {
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 1);
      }
      // Right edge
      if (x === width - 1 || !selectionMask[y * width + (x + 1)]) {
        ctx.moveTo(x + 1, y);
        ctx.lineTo(x + 1, y + 1);
      }
    }
  }

  ctx.stroke();
  ctx.strokeStyle = '#fff';
  ctx.lineDashOffset = -marchingAntsOffset + 4;
  ctx.stroke();

  ctx.restore();
}

// Main selection visualization - calls fill and/or ants based on state
export function drawSelectionOutline(ctx) {
  if (!selectionMask || !selectionBounds) return;

  if (state.showSelectionFill) {
    drawSelectionFill(ctx);
  }

  if (state.showMarchingAnts) {
    drawMarchingAnts(ctx);
  }
}

// Get selected pixels as ImageData
export function getSelectedImageData() {
  if (!selectionMask || !selectionBounds) return null;

  // Get image data from layers only (no background grid)
  const sourceData = getAllLayersImageData();
  if (!sourceData) return null;

  const width = sourceData.width;

  // Create new image data for selection
  const { x, y, width: selWidth, height: selHeight } = selectionBounds;
  const resultData = new ImageData(selWidth, selHeight);

  for (let sy = 0; sy < selHeight; sy++) {
    for (let sx = 0; sx < selWidth; sx++) {
      const sourceX = x + sx;
      const sourceY = y + sy;
      const sourceIdx = sourceY * width + sourceX;

      // Only copy if selected
      if (selectionMask[sourceIdx]) {
        const sourcePixel = sourceIdx * 4;
        const destPixel = (sy * selWidth + sx) * 4;

        resultData.data[destPixel] = sourceData.data[sourcePixel];
        resultData.data[destPixel + 1] = sourceData.data[sourcePixel + 1];
        resultData.data[destPixel + 2] = sourceData.data[sourcePixel + 2];
        resultData.data[destPixel + 3] = sourceData.data[sourcePixel + 3];
      }
    }
  }

  return {
    imageData: resultData,
    bounds: selectionBounds
  };
}

// Invert selection
export function invertSelection() {
  if (!selectionMask) return;

  const ctx = getContext();
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;

  for (let i = 0; i < selectionMask.length; i++) {
    selectionMask[i] = selectionMask[i] ? 0 : 1;
  }

  // Recalculate bounds
  let minX = width, maxX = 0, minY = height, maxY = 0;
  let hasAny = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (selectionMask[y * width + x]) {
        hasAny = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (hasAny) {
    selectionBounds = {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    };
  } else {
    clearSelection();
  }
}

// Select all
export function selectAll() {
  const ctx = getContext();
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;

  selectionMask = new Uint8Array(width * height).fill(1);
  selectionBounds = { x: 0, y: 0, width, height };
  startMarchingAnts();
}

// Rectangle marquee select
export function rectangleSelect(x1, y1, x2, y2, addToSelection = false) {
  const width = state.canvasWidth;
  const height = state.canvasHeight;

  // Normalize coordinates (ensure x1 < x2, y1 < y2)
  const minX = Math.max(0, Math.min(x1, x2));
  const maxX = Math.min(width - 1, Math.max(x1, x2));
  const minY = Math.max(0, Math.min(y1, y2));
  const maxY = Math.min(height - 1, Math.max(y1, y2));

  // Don't create selection if it's too small
  if (maxX - minX < 1 || maxY - minY < 1) {
    if (!addToSelection) clearSelection();
    return false;
  }

  // Create or reuse selection mask
  if (!addToSelection || !selectionMask) {
    selectionMask = new Uint8Array(width * height);
  }

  // Fill the rectangle in the mask
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = y * width + x;
      selectionMask[idx] = 1;
    }
  }

  // Update bounds
  if (addToSelection && selectionBounds) {
    selectionBounds = {
      x: Math.min(selectionBounds.x, minX),
      y: Math.min(selectionBounds.y, minY),
      width: Math.max(selectionBounds.x + selectionBounds.width, maxX + 1) - Math.min(selectionBounds.x, minX),
      height: Math.max(selectionBounds.y + selectionBounds.height, maxY + 1) - Math.min(selectionBounds.y, minY)
    };
  } else {
    selectionBounds = {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    };
  }

  startMarchingAnts();
  console.log(`[selection] Rectangle select: ${selectionBounds.width}x${selectionBounds.height}`);
  return true;
}

// Flood fill with color (bucket tool)
// Returns array of affected pixel coordinates for adding to layer
// Uses only the current layer's pixel data for fill detection
export function floodFill(startX, startY, fillColor) {
  const width = state.canvasWidth;
  const height = state.canvasHeight;

  // Get image data from ONLY the current layer (not composite)
  const imageData = getCurrentLayerImageData();
  if (!imageData) return [];

  const pixels = imageData.data;

  // Get the target color at click position
  const targetIndex = (startY * width + startX) * 4;
  const targetR = pixels[targetIndex];
  const targetG = pixels[targetIndex + 1];
  const targetB = pixels[targetIndex + 2];
  const targetA = pixels[targetIndex + 3];

  // Parse fill color
  const fillRGB = hexToRgb(fillColor);
  if (!fillRGB) return [];

  // Check if target and fill are the same (no need to fill)
  if (targetR === fillRGB.r && targetG === fillRGB.g && targetB === fillRGB.b && targetA === 255) {
    return [];
  }

  // Collect filled pixels
  const filledPixels = [];

  // Flood fill
  const visited = new Uint8Array(width * height);
  const stack = [[startX, startY]];

  while (stack.length > 0) {
    const [x, y] = stack.pop();

    // Bounds check
    if (x < 0 || x >= width || y < 0 || y >= height) continue;

    const idx = y * width + x;

    // Already visited
    if (visited[idx]) continue;
    visited[idx] = 1;

    // Check color match
    const pixelIndex = idx * 4;
    const r = pixels[pixelIndex];
    const g = pixels[pixelIndex + 1];
    const b = pixels[pixelIndex + 2];
    const a = pixels[pixelIndex + 3];

    if (!colorMatches(r, g, b, a, targetR, targetG, targetB, targetA, tolerance)) {
      continue;
    }

    // Track filled pixel (don't modify imageData - let render() handle display)
    filledPixels.push({ x, y });

    // Add neighbors (4-connected)
    stack.push([x + 1, y]);
    stack.push([x - 1, y]);
    stack.push([x, y + 1]);
    stack.push([x, y - 1]);
  }

  return filledPixels;
}

// Helper: hex to RGB
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

// ========================================================================
// EDGE FILL ALGORITHM
// ========================================================================
// Fills transparent regions by sampling colors from the edges and
// interpolating inward based on distance.
// ========================================================================

/**
 * Edge Fill - Fill transparent holes by interpolating edge colors
 *
 * Algorithm:
 * 1. Find all connected transparent pixels from click point (flood fill)
 * 2. Identify edge pixels (opaque pixels adjacent to the transparent region)
 * 3. For each transparent pixel, find K nearest edge pixels
 * 4. Interpolate color using inverse distance weighting
 * 5. Return array of filled pixels with their colors
 *
 * @param {number} startX, startY - Click position (must be transparent)
 * @param {number} kNearest - Number of nearest edge pixels to sample (default 4)
 * @returns {Array<{x, y, r, g, b}>} Filled pixels with interpolated colors
 */
export function edgeFill(startX, startY, kNearest = 4) {
  const width = state.canvasWidth;
  const height = state.canvasHeight;

  // Get image data from current layer
  const imageData = getCurrentLayerImageData();
  if (!imageData) return [];

  const pixels = imageData.data;

  // Check if click is on transparent pixel
  const startIdx = (startY * width + startX) * 4;
  const startAlpha = pixels[startIdx + 3];
  if (startAlpha > 10) {
    // Clicked on opaque pixel - nothing to fill
    return [];
  }

  // Step 1: Find all connected transparent pixels (flood fill)
  const transparentRegion = new Set();
  const visited = new Uint8Array(width * height);
  const stack = [[startX, startY]];

  while (stack.length > 0) {
    const [x, y] = stack.pop();

    // Bounds check
    if (x < 0 || x >= width || y < 0 || y >= height) continue;

    const idx = y * width + x;
    if (visited[idx]) continue;
    visited[idx] = 1;

    // Check if transparent (alpha < 10)
    const pixelIdx = idx * 4;
    if (pixels[pixelIdx + 3] > 10) continue;

    // This pixel is part of the transparent region
    transparentRegion.add(`${x},${y}`);

    // Add 4-connected neighbors
    stack.push([x + 1, y]);
    stack.push([x - 1, y]);
    stack.push([x, y + 1]);
    stack.push([x, y - 1]);
  }

  if (transparentRegion.size === 0) return [];

  // Step 2: Find edge pixels (opaque pixels adjacent to transparent region)
  const edgePixels = [];
  const edgeSet = new Set();

  for (const key of transparentRegion) {
    const [x, y] = key.split(',').map(Number);

    // Check 8-connected neighbors for opaque pixels
    const neighbors = [
      [x - 1, y - 1], [x, y - 1], [x + 1, y - 1],
      [x - 1, y],                 [x + 1, y],
      [x - 1, y + 1], [x, y + 1], [x + 1, y + 1]
    ];

    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      const nKey = `${nx},${ny}`;
      if (transparentRegion.has(nKey) || edgeSet.has(nKey)) continue;

      const nIdx = (ny * width + nx) * 4;
      const alpha = pixels[nIdx + 3];

      // This is an opaque neighbor - it's an edge pixel
      if (alpha > 10) {
        edgeSet.add(nKey);
        edgePixels.push({
          x: nx,
          y: ny,
          r: pixels[nIdx],
          g: pixels[nIdx + 1],
          b: pixels[nIdx + 2]
        });
      }
    }
  }

  if (edgePixels.length === 0) {
    // No edge pixels found - can't fill
    return [];
  }

  // Step 3 & 4: For each transparent pixel, interpolate from nearest edge pixels
  const filledPixels = [];

  for (const key of transparentRegion) {
    const [x, y] = key.split(',').map(Number);

    // Calculate distances to all edge pixels
    const distances = edgePixels.map((edge, i) => ({
      index: i,
      dist: Math.sqrt((x - edge.x) ** 2 + (y - edge.y) ** 2)
    }));

    // Sort by distance and take K nearest
    distances.sort((a, b) => a.dist - b.dist);
    const nearest = distances.slice(0, Math.min(kNearest, edgePixels.length));

    // Inverse distance weighting (IDW)
    let totalWeight = 0;
    let weightedR = 0, weightedG = 0, weightedB = 0;

    for (const { index, dist } of nearest) {
      const edge = edgePixels[index];
      // Add small epsilon to avoid division by zero when pixel is at edge
      const weight = 1 / (dist + 0.001);
      totalWeight += weight;
      weightedR += edge.r * weight;
      weightedG += edge.g * weight;
      weightedB += edge.b * weight;
    }

    // Normalize
    const r = Math.round(weightedR / totalWeight);
    const g = Math.round(weightedG / totalWeight);
    const b = Math.round(weightedB / totalWeight);

    filledPixels.push({ x, y, r, g, b });
  }

  return filledPixels;
}

/**
 * Edge Fill with Gradient Blending
 *
 * Enhanced version that creates smoother gradients by considering
 * the direction from edge to center of the hole.
 *
 * @param {number} startX, startY - Click position
 * @param {number} smoothness - Blend smoothness (1-10, default 5)
 * @returns {Array<{x, y, r, g, b}>} Filled pixels
 */
export function edgeFillSmooth(startX, startY, smoothness = 5) {
  // Use more neighbors for smoother gradients
  const kNearest = Math.max(4, smoothness * 2);
  return edgeFill(startX, startY, kNearest);
}

/**
 * Advanced Edge Fill - Symmetry + Exemplar-Based Inpainting
 *
 * Two-stage algorithm:
 * 1. Symmetry fill: Mirror pixels across vertical axis (great for tanks/vehicles)
 * 2. Exemplar-based: Copy matching patches from elsewhere in the image
 *
 * This preserves pixel-art crispness by copying exact pixels, no blending.
 *
 * @param {number} startX, startY - Click position (must be transparent)
 * @param {number} patchSize - Patch size for matching (default 7)
 * @returns {Array<{x, y, r, g, b, a}>} Filled pixels
 */
export function edgeFillAdvanced(startX, startY, patchSize = 7) {
  const width = state.canvasWidth;
  const height = state.canvasHeight;

  const imageData = getCurrentLayerImageData();
  if (!imageData) return [];

  // Work with a copy of pixel data
  const pixels = new Uint8ClampedArray(imageData.data);

  // Check if click is on transparent pixel
  const startIdx = (startY * width + startX) * 4;
  if (pixels[startIdx + 3] > 10) {
    return []; // Clicked on opaque pixel
  }

  // Build hole mask: true = hole (transparent)
  const holeMask = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  const stack = [[startX, startY]];
  const holePixels = [];

  // Flood fill to find connected transparent region
  while (stack.length > 0) {
    const [x, y] = stack.pop();
    if (x < 0 || x >= width || y < 0 || y >= height) continue;

    const idx = y * width + x;
    if (visited[idx]) continue;
    visited[idx] = 1;

    if (pixels[idx * 4 + 3] > 10) continue; // Opaque

    holeMask[idx] = 1;
    holePixels.push({ x, y });

    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  if (holePixels.length === 0) return [];

  console.log(`[EdgeFill] Found ${holePixels.length} hole pixels`);

  // Stage 1: Symmetry fill
  const cx = estimateSymmetryAxis(pixels, holeMask, width, height);
  console.log(`[EdgeFill] Symmetry axis at x=${cx}`);

  let symFilled = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (!holeMask[idx]) continue;

        const xm = 2 * cx - x; // Mirror x
        if (xm < 0 || xm >= width) continue;

        const mIdx = y * width + xm;
        if (holeMask[mIdx]) continue; // Mirror is also hole

        // Copy from mirror
        const srcI = mIdx * 4;
        const dstI = idx * 4;
        pixels[dstI] = pixels[srcI];
        pixels[dstI + 1] = pixels[srcI + 1];
        pixels[dstI + 2] = pixels[srcI + 2];
        pixels[dstI + 3] = pixels[srcI + 3];
        holeMask[idx] = 0;
        symFilled++;
        changed = true;
      }
    }
  }

  console.log(`[EdgeFill] Symmetry filled ${symFilled} pixels`);

  // Stage 2: Exemplar-based patch fill
  const remaining = holeMask.reduce((sum, v) => sum + v, 0);
  if (remaining > 0) {
    console.log(`[EdgeFill] ${remaining} pixels remaining, starting exemplar fill`);
    exemplarFill(pixels, holeMask, width, height, patchSize);
  }

  // Stage 3: Boundary tone blending (reduce visible seams)
  console.log(`[EdgeFill] Applying boundary tone blend...`);
  boundaryToneBlend(pixels, width, height, holePixels);

  // Collect results
  const filledPixels = [];
  for (const { x, y } of holePixels) {
    const idx = (y * width + x) * 4;
    filledPixels.push({
      x, y,
      r: pixels[idx],
      g: pixels[idx + 1],
      b: pixels[idx + 2],
      a: pixels[idx + 3]
    });
  }

  return filledPixels;
}

/**
 * Edge fill using user-specified reference points
 * Samples colors from areas around reference points and fills hole using
 * inverse distance weighting.
 *
 * @param {number} startX, startY - Click position (must be transparent)
 * @param {Array<{x, y}>} refPoints - Array of reference point coordinates
 * @param {number} sampleRadius - Radius around each reference point to sample (default 16)
 * @returns {Array<{x, y, r, g, b, a}>} Filled pixels
 */
export function edgeFillFromReferences(startX, startY, refPoints, sampleRadius = 16) {
  const width = state.canvasWidth;
  const height = state.canvasHeight;

  const imageData = getCurrentLayerImageData();
  if (!imageData) return [];

  const pixels = new Uint8ClampedArray(imageData.data);

  // Check if click is on transparent pixel
  const startIdx = (startY * width + startX) * 4;
  if (pixels[startIdx + 3] > 10) {
    console.log('[EdgeFill] Clicked on opaque pixel');
    return [];
  }

  // Build hole mask via flood fill
  const holeMask = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  const stack = [[startX, startY]];
  const holePixels = [];

  while (stack.length > 0) {
    const [x, y] = stack.pop();
    if (x < 0 || x >= width || y < 0 || y >= height) continue;

    const idx = y * width + x;
    if (visited[idx]) continue;
    visited[idx] = 1;

    if (pixels[idx * 4 + 3] > 10) continue;

    holeMask[idx] = 1;
    holePixels.push({ x, y });

    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  if (holePixels.length === 0) return [];

  console.log(`[EdgeFill] Found ${holePixels.length} hole pixels, ${refPoints.length} reference points`);

  // Sample colors from each reference point area
  const refSamples = [];
  for (const ref of refPoints) {
    const colors = [];
    for (let dy = -sampleRadius; dy <= sampleRadius; dy++) {
      for (let dx = -sampleRadius; dx <= sampleRadius; dx++) {
        // Circular sampling
        if (dx * dx + dy * dy > sampleRadius * sampleRadius) continue;

        const sx = ref.x + dx;
        const sy = ref.y + dy;
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;

        const sIdx = (sy * width + sx) * 4;
        if (pixels[sIdx + 3] < 128) continue; // Skip transparent

        colors.push({
          r: pixels[sIdx],
          g: pixels[sIdx + 1],
          b: pixels[sIdx + 2],
          a: pixels[sIdx + 3]
        });
      }
    }

    if (colors.length > 0) {
      // Compute average color for this reference
      let r = 0, g = 0, b = 0, a = 0;
      for (const c of colors) {
        r += c.r; g += c.g; b += c.b; a += c.a;
      }
      refSamples.push({
        x: ref.x,
        y: ref.y,
        r: Math.round(r / colors.length),
        g: Math.round(g / colors.length),
        b: Math.round(b / colors.length),
        a: Math.round(a / colors.length),
        count: colors.length
      });
    }
  }

  if (refSamples.length === 0) {
    console.log('[EdgeFill] No valid samples from reference points');
    return [];
  }

  console.log(`[EdgeFill] Got ${refSamples.length} valid reference samples`);

  // Fill each hole pixel using inverse distance weighting from reference samples
  const filledPixels = [];
  for (const { x, y } of holePixels) {
    let totalWeight = 0;
    let r = 0, g = 0, b = 0, a = 0;

    for (const sample of refSamples) {
      const dx = x - sample.x;
      const dy = y - sample.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const weight = 1 / Math.max(1, dist * dist); // Inverse square weighting

      r += sample.r * weight;
      g += sample.g * weight;
      b += sample.b * weight;
      a += sample.a * weight;
      totalWeight += weight;
    }

    if (totalWeight > 0) {
      filledPixels.push({
        x, y,
        r: Math.round(r / totalWeight),
        g: Math.round(g / totalWeight),
        b: Math.round(b / totalWeight),
        a: Math.round(a / totalWeight)
      });
    }
  }

  console.log(`[EdgeFill] Filled ${filledPixels.length} pixels from references`);
  return filledPixels;
}

/**
 * Boundary tone blending - reduces visible seams at fill boundaries
 *
 * For pixels near the original boundary, computes local color offset
 * and applies subtle adjustment to match surrounding tones.
 * Keeps pixels crisp (no blur), just adjusts RGB values.
 */
function boundaryToneBlend(pixels, width, height, filledPixels) {
  // Create a set of filled pixel coordinates for fast lookup
  const filledSet = new Set(filledPixels.map(p => `${p.x},${p.y}`));

  // Find boundary pixels (filled pixels adjacent to non-filled)
  const boundaryPixels = [];
  for (const { x, y } of filledPixels) {
    const neighbors = [
      [x-1, y], [x+1, y], [x, y-1], [x, y+1]
    ];

    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (!filledSet.has(`${nx},${ny}`)) {
        boundaryPixels.push({ x, y });
        break;
      }
    }
  }

  if (boundaryPixels.length === 0) return;

  // For each boundary pixel, compute color difference with original neighbors
  // and propagate adjustment inward
  const adjustments = new Map(); // "x,y" -> {dr, dg, db}

  for (const { x, y } of boundaryPixels) {
    const idx = (y * width + x) * 4;
    const filledR = pixels[idx], filledG = pixels[idx + 1], filledB = pixels[idx + 2];

    // Sample original neighbors
    let origR = 0, origG = 0, origB = 0, origCount = 0;
    const neighbors = [
      [x-1, y], [x+1, y], [x, y-1], [x, y+1],
      [x-1, y-1], [x+1, y-1], [x-1, y+1], [x+1, y+1]
    ];

    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (filledSet.has(`${nx},${ny}`)) continue;

      const nIdx = (ny * width + nx) * 4;
      if (pixels[nIdx + 3] < 128) continue; // Skip transparent

      origR += pixels[nIdx];
      origG += pixels[nIdx + 1];
      origB += pixels[nIdx + 2];
      origCount++;
    }

    if (origCount > 0) {
      origR /= origCount;
      origG /= origCount;
      origB /= origCount;

      // Compute adjustment (clamped to subtle range)
      const maxAdj = 20;
      const dr = Math.max(-maxAdj, Math.min(maxAdj, origR - filledR));
      const dg = Math.max(-maxAdj, Math.min(maxAdj, origG - filledG));
      const db = Math.max(-maxAdj, Math.min(maxAdj, origB - filledB));

      adjustments.set(`${x},${y}`, { dr, dg, db, dist: 0 });
    }
  }

  // Propagate adjustments inward with falloff
  const maxPropagation = 8;
  for (let dist = 1; dist <= maxPropagation; dist++) {
    const newAdj = new Map();

    for (const { x, y } of filledPixels) {
      const key = `${x},${y}`;
      if (adjustments.has(key)) continue;

      // Check if any neighbor has adjustment at dist-1
      const neighbors = [[x-1, y], [x+1, y], [x, y-1], [x, y+1]];
      let sumDr = 0, sumDg = 0, sumDb = 0, count = 0;

      for (const [nx, ny] of neighbors) {
        const nKey = `${nx},${ny}`;
        const adj = adjustments.get(nKey);
        if (adj && adj.dist === dist - 1) {
          sumDr += adj.dr;
          sumDg += adj.dg;
          sumDb += adj.db;
          count++;
        }
      }

      if (count > 0) {
        // Apply falloff
        const falloff = 1 - (dist / maxPropagation);
        newAdj.set(key, {
          dr: (sumDr / count) * falloff,
          dg: (sumDg / count) * falloff,
          db: (sumDb / count) * falloff,
          dist
        });
      }
    }

    // Merge new adjustments
    for (const [key, adj] of newAdj) {
      adjustments.set(key, adj);
    }
  }

  // Apply adjustments
  for (const [key, adj] of adjustments) {
    const [x, y] = key.split(',').map(Number);
    const idx = (y * width + x) * 4;

    pixels[idx] = Math.max(0, Math.min(255, Math.round(pixels[idx] + adj.dr)));
    pixels[idx + 1] = Math.max(0, Math.min(255, Math.round(pixels[idx + 1] + adj.dg)));
    pixels[idx + 2] = Math.max(0, Math.min(255, Math.round(pixels[idx + 2] + adj.db)));
  }

  console.log(`[EdgeFill] Applied tone adjustments to ${adjustments.size} pixels`);
}

/**
 * Estimate vertical symmetry axis by minimizing mirror error
 */
function estimateSymmetryAxis(pixels, holeMask, width, height) {
  const center = Math.floor(width / 2);
  const searchRange = Math.min(16, Math.floor(width / 4));

  let bestCx = center;
  let bestError = Infinity;

  for (let cx = center - searchRange; cx <= center + searchRange; cx++) {
    let totalError = 0;
    let count = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const xm = 2 * cx - x;
        if (xm < 0 || xm >= width) continue;

        const idx = y * width + x;
        const mIdx = y * width + xm;

        // Skip if either is hole
        if (holeMask[idx] || holeMask[mIdx]) continue;

        // Compare RGB
        const i1 = idx * 4, i2 = mIdx * 4;
        const diff = Math.abs(pixels[i1] - pixels[i2]) +
                     Math.abs(pixels[i1 + 1] - pixels[i2 + 1]) +
                     Math.abs(pixels[i1 + 2] - pixels[i2 + 2]);
        totalError += diff;
        count++;
      }
    }

    if (count > 0) {
      const avgError = totalError / count;
      if (avgError < bestError) {
        bestError = avgError;
        bestCx = cx;
      }
    }
  }

  return bestCx;
}

/**
 * Exemplar-based inpainting using patch matching
 */
function exemplarFill(pixels, holeMask, width, height, patchSize) {
  const half = Math.floor(patchSize / 2);
  const maxIters = 5000;
  const searchRadius = 60;
  const numSamples = 100;

  for (let iter = 0; iter < maxIters; iter++) {
    // Find boundary pixels (hole pixels adjacent to known)
    const boundary = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (!holeMask[idx]) continue;

        // Check if adjacent to known pixel
        const hasKnownNeighbor = [
          [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
          [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1]
        ].some(([nx, ny]) => {
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) return false;
          return !holeMask[ny * width + nx];
        });

        if (hasKnownNeighbor) {
          // Compute confidence (fraction of known pixels in patch)
          let known = 0, total = 0;
          for (let dy = -half; dy <= half; dy++) {
            for (let dx = -half; dx <= half; dx++) {
              const px = x + dx, py = y + dy;
              if (px >= 0 && px < width && py >= 0 && py < height) {
                total++;
                if (!holeMask[py * width + px]) known++;
              }
            }
          }
          boundary.push({ x, y, confidence: known / total });
        }
      }
    }

    if (boundary.length === 0) {
      console.log(`[EdgeFill] Exemplar fill complete at iter ${iter}`);
      break;
    }

    // Sort by confidence (highest first)
    boundary.sort((a, b) => b.confidence - a.confidence);

    // Try to fill highest priority pixel
    let filled = false;
    for (const target of boundary.slice(0, 5)) {
      const source = findBestPatch(pixels, holeMask, width, height,
                                    target.x, target.y, patchSize,
                                    searchRadius, numSamples);

      if (source) {
        // Copy patch
        for (let dy = -half; dy <= half; dy++) {
          for (let dx = -half; dx <= half; dx++) {
            const tx = target.x + dx, ty = target.y + dy;
            const sx = source.x + dx, sy = source.y + dy;

            if (tx < 0 || tx >= width || ty < 0 || ty >= height) continue;
            if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;

            const tIdx = ty * width + tx;
            if (!holeMask[tIdx]) continue; // Only fill holes

            const sIdx = sy * width + sx;
            const ti = tIdx * 4, si = sIdx * 4;

            pixels[ti] = pixels[si];
            pixels[ti + 1] = pixels[si + 1];
            pixels[ti + 2] = pixels[si + 2];
            pixels[ti + 3] = pixels[si + 3];
            holeMask[tIdx] = 0;
          }
        }
        filled = true;
        break;
      }
    }

    if (!filled) {
      console.log(`[EdgeFill] Stuck at iter ${iter}, ${boundary.length} pixels remaining`);
      break;
    }

    if (iter % 100 === 0) {
      const remaining = holeMask.reduce((sum, v) => sum + v, 0);
      console.log(`[EdgeFill] Iter ${iter}: ${remaining} pixels remaining`);
    }
  }
}

/**
 * Calculate texture complexity using COLOR ENTROPY
 * Better than gradients for pixel art because:
 * - Vents/grills have many colors (high entropy)
 * - Smooth hull panels have 1-3 colors (low entropy)
 *
 * Uses 4-bit quantization to group similar shades.
 */
function getPatchComplexity(pixels, width, height, cx, cy, patchSize, holeMask) {
  const half = Math.floor(patchSize / 2);
  const colorCounts = new Map();
  let total = 0;

  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;

      const idx = y * width + x;
      if (holeMask && holeMask[idx]) continue;

      const i = idx * 4;
      // Use 4-bit quantized color to group similar shades (16 levels per channel)
      const r = pixels[i] >> 4;
      const g = pixels[i + 1] >> 4;
      const b = pixels[i + 2] >> 4;
      const key = `${r},${g},${b}`;
      colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
      total++;
    }
  }

  if (total === 0) return 0;

  // Calculate Shannon entropy - higher = more colors = more complex
  let entropy = 0;
  for (const count of colorCounts.values()) {
    const p = count / total;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

/**
 * Find best matching source patch for target location
 * Now includes texture complexity matching to avoid grabbing features
 */
function findBestPatch(pixels, holeMask, width, height, tx, ty, patchSize, radius, samples) {
  const half = Math.floor(patchSize / 2);

  // Can't use patches too close to border
  if (tx < half || tx >= width - half || ty < half || ty >= height - half) {
    return null;
  }

  // Calculate target patch complexity (from known pixels around hole)
  // Using color entropy: smooth hull ~0.5-1.5, busy vents ~2.5-4.0
  const targetComplexity = getPatchComplexity(pixels, width, height, tx, ty, patchSize, holeMask);

  let bestSSD = Infinity;
  let bestPos = null;

  // Generate random candidate positions
  for (let i = 0; i < samples; i++) {
    // Mix of local and global samples - prefer local heavily
    let sx, sy;
    if (i < samples * 0.85) {
      // Local: within radius (closer = better)
      const localRadius = radius * (0.3 + Math.random() * 0.7);
      const angle = Math.random() * Math.PI * 2;
      sx = Math.round(tx + Math.cos(angle) * localRadius);
      sy = Math.round(ty + Math.sin(angle) * localRadius);
    } else {
      // Global: anywhere
      sx = Math.floor(Math.random() * (width - patchSize)) + half;
      sy = Math.floor(Math.random() * (height - patchSize)) + half;
    }

    // Bounds check
    if (sx < half || sx >= width - half || sy < half || sy >= height - half) continue;

    // Check if source patch is fully known (no holes)
    let isValidSource = true;
    for (let dy = -half; dy <= half && isValidSource; dy++) {
      for (let dx = -half; dx <= half && isValidSource; dx++) {
        const idx = (sy + dy) * width + (sx + dx);
        if (holeMask[idx]) isValidSource = false;
      }
    }
    if (!isValidSource) continue;

    // Check texture complexity using RATIO - reject patches much busier than target
    // Tightened threshold: reject if source is 2x busier (was 3x)
    const sourceComplexity = getPatchComplexity(pixels, width, height, sx, sy, patchSize, null);
    const complexityRatio = sourceComplexity / Math.max(0.1, targetComplexity);

    // Also reject if source has absolute high entropy (busy feature)
    if (sourceComplexity > 2.5 || complexityRatio > 2.0) {
      continue; // Source is too busy - probably a feature like vents
    }

    // Compute SSD over known target pixels only
    let ssd = 0;
    let count = 0;
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const tIdx = (ty + dy) * width + (tx + dx);
        if (holeMask[tIdx]) continue; // Skip hole pixels

        const sIdx = (sy + dy) * width + (sx + dx);
        const ti = tIdx * 4, si = sIdx * 4;

        const dr = pixels[ti] - pixels[si];
        const dg = pixels[ti + 1] - pixels[si + 1];
        const db = pixels[ti + 2] - pixels[si + 2];
        ssd += dr * dr + dg * dg + db * db;
        count++;
      }
    }

    // Add distance penalty to prefer closer patches
    const dist = Math.sqrt((sx - tx) ** 2 + (sy - ty) ** 2);
    const distancePenalty = dist * 0.5;

    if (count > 0) {
      const adjustedSSD = ssd + distancePenalty;
      if (adjustedSSD < bestSSD) {
        bestSSD = adjustedSSD;
        bestPos = { x: sx, y: sy };
      }
    }
  }

  return bestPos;
}

// ========================================================================
// SELECTION ALGORITHMS
// ========================================================================
// This module provides various algorithms for pixel selection in a sprite
// editor context. Each algorithm is documented with its purpose, complexity,
// and usage examples.
// ========================================================================

// ------------------------------------------------------------------------
// COLOR DISTANCE ALGORITHMS
// ------------------------------------------------------------------------
// Different methods for calculating how "similar" two colors are.
// Lower distance = more similar colors.
// ------------------------------------------------------------------------

/**
 * Manhattan Distance (L1 Norm)
 *
 * Calculates the sum of absolute differences across RGB channels.
 * Fast and simple, treats all channels equally.
 *
 * @param {number} r1, g1, b1 - First color RGB (0-255)
 * @param {number} r2, g2, b2 - Second color RGB (0-255)
 * @returns {number} Distance (0-765, where 0 = identical)
 *
 * @example
 * colorDistanceManhattan(255, 0, 0, 250, 5, 5) // Red vs slightly different red = 15
 */
function colorDistanceManhattan(r1, g1, b1, r2, g2, b2) {
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
}

/**
 * Euclidean Distance (L2 Norm)
 *
 * Calculates the straight-line distance in RGB color space.
 * More perceptually accurate than Manhattan for large differences.
 *
 * @param {number} r1, g1, b1 - First color RGB (0-255)
 * @param {number} r2, g2, b2 - Second color RGB (0-255)
 * @returns {number} Distance (0-441.67, where 0 = identical)
 *
 * @example
 * colorDistanceEuclidean(255, 0, 0, 0, 255, 0) // Red vs Green ≈ 360.6
 */
function colorDistanceEuclidean(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Weighted Euclidean Distance (Perceptual)
 *
 * Human eyes are more sensitive to green, less to blue.
 * This weighting provides better perceptual matching.
 * Based on ITU-R BT.601 luma coefficients.
 *
 * Weights: R=0.299, G=0.587, B=0.114
 *
 * @param {number} r1, g1, b1 - First color RGB (0-255)
 * @param {number} r2, g2, b2 - Second color RGB (0-255)
 * @returns {number} Weighted distance (0 = identical)
 *
 * @example
 * // Green differences matter more than blue differences
 * colorDistanceWeighted(0, 100, 0, 0, 110, 0) > colorDistanceWeighted(0, 0, 100, 0, 0, 110)
 */
function colorDistanceWeighted(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  // Attempt to incorporate human color perception
  const rMean = (r1 + r2) / 2;
  const rWeight = 2 + rMean / 256;
  const gWeight = 4;
  const bWeight = 2 + (255 - rMean) / 256;
  return Math.sqrt(rWeight * dr * dr + gWeight * dg * dg + bWeight * db * db);
}

/**
 * Check if two colors match within a tolerance
 *
 * Uses Manhattan distance for speed, normalized to 0-100 tolerance scale.
 * Tolerance of 0 = exact match only
 * Tolerance of 100 = matches anything
 *
 * @param {number} r1, g1, b1, a1 - First color RGBA (0-255)
 * @param {number} r2, g2, b2, a2 - Second color RGBA (0-255)
 * @param {number} tolerance - Match tolerance (0-100)
 * @returns {boolean} True if colors match within tolerance
 */
function colorsMatch(r1, g1, b1, a1, r2, g2, b2, a2, tolerance) {
  // Handle transparency: both transparent = match, one transparent = no match
  if (a1 < 10 && a2 < 10) return true;
  if (a1 < 10 || a2 < 10) return false;

  // Scale tolerance: 0-100 maps to 0-765 (max Manhattan distance)
  const maxDist = (tolerance / 100) * 765;
  const dist = colorDistanceManhattan(r1, g1, b1, r2, g2, b2);
  return dist <= maxDist;
}

// ------------------------------------------------------------------------
// GEOMETRY ALGORITHMS
// ------------------------------------------------------------------------

/**
 * Point-in-Polygon Test (Ray Casting Algorithm)
 *
 * Determines if a point is inside a polygon by casting a ray from the point
 * to infinity (rightward) and counting edge crossings. Odd count = inside.
 *
 * Algorithm: For each edge, check if a horizontal ray from (x,y) going right
 * crosses that edge. Uses the Jordan curve theorem.
 *
 * Time Complexity: O(n) where n = number of polygon vertices
 * Space Complexity: O(1)
 *
 * @param {number} x, y - Point to test
 * @param {Array<{x: number, y: number}>} polygon - Array of vertices
 * @returns {boolean} True if point is inside polygon
 *
 * @example
 * const triangle = [{x: 0, y: 0}, {x: 10, y: 0}, {x: 5, y: 10}];
 * pointInPolygon(5, 5, triangle)  // true - center of triangle
 * pointInPolygon(0, 10, triangle) // false - outside
 */
function pointInPolygon(x, y, polygon) {
  if (polygon.length < 3) return false;

  let inside = false;

  // Iterate through each edge (from vertex j to vertex i)
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    // Check if edge crosses the horizontal ray from (x, y) going right
    // Condition 1: Edge must span the y-coordinate (one vertex above, one below)
    // Condition 2: Intersection point must be to the right of x
    const intersects = ((yi > y) !== (yj > y)) &&
                       (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

    if (intersects) {
      inside = !inside; // Toggle inside/outside state
    }
  }

  return inside;
}

/**
 * Check if a pixel overlaps with a polygon (Pixel-Perfect Coverage Test)
 *
 * A pixel at integer coordinate (px, py) occupies the square [px, px+1) × [py, py+1).
 * We want to select the pixel if ANY part of this square overlaps the polygon.
 *
 * Strategy: Test pixel center AND all 4 corners. If any point is inside, the pixel
 * is selected. This ensures:
 * - Clicked boundary pixels are always included
 * - No gaps appear in the selection outline, especially at sharp angles
 * - Behavior matches user expectations (WYSIWYG)
 *
 * Technical details:
 * - Polygon vertices are stored at pixel centers (e.g., clicking pixel 10 stores 10.5)
 * - We test 5 points: center + 4 corners with small epsilon offset
 * - Epsilon prevents edge cases where point lies exactly on polygon edge
 *
 * @param {number} px - Pixel X coordinate (integer)
 * @param {number} py - Pixel Y coordinate (integer)
 * @param {Array<{x,y}>} polygon - Polygon vertices (stored at pixel centers)
 * @returns {boolean} True if pixel should be selected
 */
function pixelInPolygon(px, py, polygon) {
  // Small epsilon to handle floating point edge cases
  // Without this, points exactly on polygon edges may give inconsistent results
  const eps = 0.0001;

  // Test pixel center first (most likely to be inside for filled regions)
  if (pointInPolygon(px + 0.5, py + 0.5, polygon)) return true;

  // Test all 4 corners with epsilon offset (ensures boundary pixels are caught)
  // This is critical for sharp angles where polygon may only intersect one corner
  if (pointInPolygon(px + eps, py + eps, polygon)) return true;           // Top-left corner
  if (pointInPolygon(px + 1 - eps, py + eps, polygon)) return true;       // Top-right corner
  if (pointInPolygon(px + eps, py + 1 - eps, polygon)) return true;       // Bottom-left corner
  if (pointInPolygon(px + 1 - eps, py + 1 - eps, polygon)) return true;   // Bottom-right corner

  return false;
}

/**
 * Get Bounding Box of a Polygon
 *
 * Finds the axis-aligned bounding box (AABB) containing all polygon vertices.
 * Useful for optimizing algorithms by limiting search area.
 *
 * Time Complexity: O(n)
 *
 * @param {Array<{x: number, y: number}>} points - Polygon vertices
 * @returns {{minX: number, maxX: number, minY: number, maxY: number}}
 */
function getPolygonBounds(points) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    minX: Math.floor(minX),
    maxX: Math.ceil(maxX),
    minY: Math.floor(minY),
    maxY: Math.ceil(maxY)
  };
}

/**
 * Calculate Polygon Area (Shoelace Formula)
 *
 * Computes the signed area of a polygon. Positive = counter-clockwise,
 * negative = clockwise winding. Useful for determining polygon orientation.
 *
 * Formula: A = 0.5 * |Σ(x_i * y_{i+1} - x_{i+1} * y_i)|
 *
 * Time Complexity: O(n)
 *
 * @param {Array<{x: number, y: number}>} points - Polygon vertices
 * @returns {number} Signed area (absolute value = actual area)
 */
function polygonArea(points) {
  if (points.length < 3) return 0;

  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += (points[j].x + points[i].x) * (points[j].y - points[i].y);
  }
  return area / 2;
}

// ------------------------------------------------------------------------
// COLOR CLUSTERING ALGORITHMS
// ------------------------------------------------------------------------

/**
 * Sample Colors from Region
 *
 * Extracts all unique colors from pixels inside a polygon region,
 * counts their frequency, and groups similar colors together.
 *
 * Process:
 * 1. Find bounding box of polygon (optimization)
 * 2. For each pixel in bounds, test if inside polygon
 * 3. Collect color frequencies
 * 4. Group similar colors using tolerance
 * 5. Return top N color groups
 *
 * @param {Array<{x, y}>} points - Polygon vertices defining region
 * @param {ImageData} imageData - Canvas image data
 * @param {number} width, height - Canvas dimensions
 * @param {number} tolerance - Grouping tolerance (0-100)
 * @returns {Array<{color: string, tolerance: number}>} Dominant colors
 */
function sampleColorsInRegion(points, imageData, width, height, tolerance = 15) {
  const pixels = imageData.data;
  const colorMap = new Map(); // Key: 'r,g,b', Value: count

  // Optimization: Only scan within polygon bounding box
  const bounds = getPolygonBounds(points);

  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      // Bounds check
      if (x < 0 || x >= width || y < 0 || y >= height) continue;

      // Use robust pixel test that checks center + all corners
      if (!pixelInPolygon(x, y, points)) continue;

      const idx = (y * width + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const a = pixels[idx + 3];

      // Skip transparent/semi-transparent pixels
      if (a < 128) continue;

      // Count this color
      const key = `${r},${g},${b}`;
      colorMap.set(key, (colorMap.get(key) || 0) + 1);
    }
  }

  // Convert to array sorted by frequency (most common first)
  const colors = Array.from(colorMap.entries())
    .map(([key, count]) => {
      const [r, g, b] = key.split(',').map(Number);
      return { r, g, b, count };
    })
    .sort((a, b) => b.count - a.count);

  // Group similar colors and return with specified tolerance
  return groupSimilarColors(colors, tolerance);
}

/**
 * Group Similar Colors (Simple Clustering)
 *
 * Groups colors that are within tolerance of each other.
 * Uses a greedy approach: first color becomes first group center,
 * subsequent colors join existing group if close enough, else start new group.
 *
 * This is a simplified k-means-like clustering without iteration.
 * Good for finding dominant color groups quickly.
 *
 * @param {Array<{r, g, b, count}>} colors - Colors sorted by frequency
 * @param {number} tolerance - Grouping tolerance (0-100)
 * @param {number} maxGroups - Maximum groups to return (default 5)
 * @returns {Array<{color: string, tolerance: number}>} Color groups
 */
function groupSimilarColors(colors, tolerance = 15, maxGroups = 5) {
  const groups = [];

  // Scale tolerance for Manhattan distance (0-100 → 0-765)
  const maxDist = (tolerance / 100) * 765;

  for (const color of colors) {
    // Try to find an existing group this color belongs to
    let foundGroup = null;

    for (const group of groups) {
      const dist = colorDistanceManhattan(color.r, color.g, color.b, group.r, group.g, group.b);
      if (dist <= maxDist) {
        foundGroup = group;
        break;
      }
    }

    if (foundGroup) {
      // Add to existing group (accumulate count for weighting)
      foundGroup.count += color.count;
    } else {
      // Start new group with this color as center
      groups.push({ ...color });
    }
  }

  // Return top groups by frequency, formatted as hex colors
  return groups
    .sort((a, b) => b.count - a.count)
    .slice(0, maxGroups)
    .map(g => ({
      color: rgbToHex(g.r, g.g, g.b),
      tolerance: tolerance
    }));
}

/**
 * Convert RGB to Hex Color String
 *
 * @param {number} r, g, b - RGB values (0-255)
 * @returns {string} Hex color string (e.g., "#ff0000")
 */
function rgbToHex(r, g, b) {
  return '#' + [r, g, b]
    .map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0'))
    .join('');
}

// ------------------------------------------------------------------------
// EDGE DETECTION ALGORITHMS
// ------------------------------------------------------------------------

/**
 * Detect Edges Using Gradient Magnitude
 *
 * Finds pixels that are on the boundary between different colors.
 * Uses a simplified Sobel-like operator to detect color gradients.
 *
 * A pixel is an "edge" if its color differs significantly from
 * at least one of its 4-connected neighbors.
 *
 * @param {ImageData} imageData - Canvas image data
 * @param {number} width, height - Canvas dimensions
 * @param {number} threshold - Edge detection threshold (0-255)
 * @returns {Uint8Array} Edge mask (1 = edge pixel, 0 = not edge)
 */
function detectEdges(imageData, width, height, threshold = 30) {
  const pixels = imageData.data;
  const edges = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];

      // Check 4-connected neighbors
      const neighbors = [
        (y - 1) * width + x,     // top
        (y + 1) * width + x,     // bottom
        y * width + (x - 1),     // left
        y * width + (x + 1)      // right
      ];

      let maxDiff = 0;
      for (const nIdx of neighbors) {
        const ni = nIdx * 4;
        const diff = colorDistanceManhattan(
          r, g, b,
          pixels[ni], pixels[ni + 1], pixels[ni + 2]
        );
        if (diff > maxDiff) maxDiff = diff;
      }

      // Mark as edge if difference exceeds threshold
      if (maxDiff > threshold * 3) {
        edges[y * width + x] = 1;
      }
    }
  }

  return edges;
}

/**
 * Find Contour Points (Edge Following)
 *
 * Given an edge mask, traces connected edge pixels to form contours.
 * Uses 8-connected neighbor following.
 *
 * @param {Uint8Array} edgeMask - Edge mask from detectEdges()
 * @param {number} width, height - Dimensions
 * @param {number} startX, startY - Starting edge pixel
 * @returns {Array<{x, y}>} Ordered contour points
 */
function traceContour(edgeMask, width, height, startX, startY) {
  const contour = [];
  const visited = new Set();

  // 8-connected neighbor offsets (clockwise from right)
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];

  let x = startX, y = startY;
  let dir = 0; // Start direction: right

  do {
    contour.push({ x, y });
    visited.add(`${x},${y}`);

    // Search for next edge pixel (rotate clockwise from last direction)
    let found = false;
    for (let i = 0; i < 8; i++) {
      const checkDir = (dir + 6 + i) % 8; // Start from dir-2 (backtrack prevention)
      const nx = x + dx[checkDir];
      const ny = y + dy[checkDir];

      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIdx = ny * width + nx;
        if (edgeMask[nIdx] && !visited.has(`${nx},${ny}`)) {
          x = nx;
          y = ny;
          dir = checkDir;
          found = true;
          break;
        }
      }
    }

    if (!found) break;

  } while (!(x === startX && y === startY) && contour.length < width * height);

  return contour;
}

// ------------------------------------------------------------------------
// SELECTION MATCHING
// ------------------------------------------------------------------------

/**
 * Check if Pixel Matches Target Colors
 *
 * Tests whether a pixel's color matches any color in the target palette,
 * respecting each target's individual tolerance.
 *
 * @param {number} r, g, b, a - Pixel color
 * @param {Array<{color: string, tolerance: number}>} targetColors - Target palette
 * @returns {boolean} True if pixel matches any target color
 */
function matchesTargetColors(r, g, b, a, targetColors) {
  // Transparent/semi-transparent pixels never match
  if (a < 128) return false;

  for (const target of targetColors) {
    const rgb = hexToRgb(target.color);
    if (!rgb) continue;

    // Use Manhattan distance scaled by tolerance
    const maxDist = (target.tolerance / 100) * 765;
    const dist = colorDistanceManhattan(r, g, b, rgb.r, rgb.g, rgb.b);

    if (dist <= maxDist) {
      return true;
    }
  }

  return false;
}

/**
 * Lasso Selection
 *
 * Two modes controlled by `expandColors`:
 * - TRUE (expand): Sample colors inside lasso, then select ALL matching pixels on canvas
 * - FALSE (contain): Only select non-transparent pixels inside the lasso outline
 *
 * @param {Array<{x, y}>} points - Lasso outline vertices
 * @param {Object} options
 * @param {boolean} options.addToSelection - Add to existing selection (Shift)
 * @param {boolean} options.subtractFromSelection - Remove from selection (Alt)
 * @param {Array} options.targetColors - Pre-selected colors to match
 * @param {number} options.tolerance - Tolerance for color matching (0-100)
 * @param {boolean} options.expandColors - Expand to all matching colors on canvas
 */
// Debug data storage for lasso selection diagnostics
let lassoDebugData = null;

export function getLassoDebugData() {
  return lassoDebugData;
}

export function lassoSelect(points, options = {}) {
  const {
    addToSelection = false,
    subtractFromSelection = false,
    targetColors = [],
    tolerance = 10,
    expandColors = true
  } = options;

  // Initialize debug data
  lassoDebugData = {
    points: points.map(p => ({ x: p.x, y: p.y })),
    options: { addToSelection, subtractFromSelection, tolerance, expandColors },
    bounds: null,
    sampledColors: [],
    pixelTests: [],  // Sample of tested pixels
    skippedPixels: { alpha: 0, colorMismatch: 0, outsidePolygon: 0 },
    selectedCount: 0
  };

  if (points.length < 3) return false;

  // Get image data from layers only (no background grid)
  const imageData = getAllLayersImageData();
  if (!imageData) return false;

  const width = imageData.width;
  const height = imageData.height;
  const pixels = imageData.data;

  // Create or modify selection mask
  if (!addToSelection && !subtractFromSelection || !selectionMask) {
    selectionMask = new Uint8Array(width * height);
  }

  let minX = width, maxX = 0, minY = height, maxY = 0;
  let hasSelection = false;

  if (expandColors) {
    // EXPAND MODE: Sample colors from lasso, select matching within lasso bounds
    // (with small margin for edge pixels)

    // Determine colors to match
    let colorsToMatch = targetColors;
    if (colorsToMatch.length === 0) {
      // Auto-sample colors from inside the lasso region
      colorsToMatch = sampleColorsInRegion(points, imageData, width, height, tolerance);
      if (colorsToMatch.length === 0) return false;
    }

    // Debug: Store sampled colors
    lassoDebugData.sampledColors = colorsToMatch.map(c => ({
      r: c.r, g: c.g, b: c.b, a: c.a, tolerance: c.tolerance
    }));

    // Get polygon bounds with small margin (3 pixels) for edge tolerance
    const margin = 3;
    const bounds = getPolygonBounds(points);
    const searchMinX = Math.max(0, bounds.minX - margin);
    const searchMaxX = Math.min(width - 1, bounds.maxX + margin);
    const searchMinY = Math.max(0, bounds.minY - margin);
    const searchMaxY = Math.min(height - 1, bounds.maxY + margin);

    // Debug: Store bounds
    lassoDebugData.bounds = {
      raw: bounds,
      search: { minX: searchMinX, maxX: searchMaxX, minY: searchMinY, maxY: searchMaxY }
    };

    // Scan within lasso bounds for matching colors
    for (let y = searchMinY; y <= searchMaxY; y++) {
      for (let x = searchMinX; x <= searchMaxX; x++) {
        // Must be inside lasso (or within margin of it)
        const insidePolygon = pixelInPolygon(x, y, points);
        if (!insidePolygon) {
          // Check if within margin by testing if any neighbor is inside
          let nearLasso = false;
          for (let dy = -margin; dy <= margin && !nearLasso; dy++) {
            for (let dx = -margin; dx <= margin && !nearLasso; dx++) {
              if (pixelInPolygon(x + dx, y + dy, points)) {
                nearLasso = true;
              }
            }
          }
          if (!nearLasso) {
            lassoDebugData.skippedPixels.outsidePolygon++;
            continue;
          }
        }

        const idx = y * width + x;
        const pixelIdx = idx * 4;

        const r = pixels[pixelIdx];
        const g = pixels[pixelIdx + 1];
        const b = pixels[pixelIdx + 2];
        const a = pixels[pixelIdx + 3];

        // Skip transparent/semi-transparent pixels
        if (a < 128) {
          lassoDebugData.skippedPixels.alpha++;
          continue;
        }

        const matches = matchesTargetColors(r, g, b, a, colorsToMatch);

        // Debug: Log some pixel tests (first 50 that are inside polygon)
        if (insidePolygon && lassoDebugData.pixelTests.length < 50) {
          lassoDebugData.pixelTests.push({
            x, y, r, g, b, a, matches, insidePolygon
          });
        }

        if (!matches) {
          lassoDebugData.skippedPixels.colorMismatch++;
        }

        if (subtractFromSelection) {
          if (matches && selectionMask[idx]) selectionMask[idx] = 0;
        } else if (addToSelection) {
          if (matches) selectionMask[idx] = 1;
        } else {
          selectionMask[idx] = matches ? 1 : 0;
        }

        if (selectionMask[idx]) {
          hasSelection = true;
          lassoDebugData.selectedCount++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  } else {
    // CONTAIN MODE: Only select pixels inside the lasso outline
    const bounds = getPolygonBounds(points);

    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        // Test pixel center against polygon
        if (!pixelInPolygon(x, y, points)) continue;

        const idx = y * width + x;
        const pixelIdx = idx * 4;
        const a = pixels[pixelIdx + 3];

        // Skip transparent/semi-transparent pixels
        if (a < 128) continue;

        // Optionally filter by target colors
        let shouldSelect = true;
        if (targetColors.length > 0) {
          const r = pixels[pixelIdx], g = pixels[pixelIdx + 1], b = pixels[pixelIdx + 2];
          shouldSelect = matchesTargetColors(r, g, b, a, targetColors);
        }

        if (subtractFromSelection) {
          if (shouldSelect && selectionMask[idx]) selectionMask[idx] = 0;
        } else if (addToSelection) {
          if (shouldSelect) selectionMask[idx] = 1;
        } else {
          if (shouldSelect) selectionMask[idx] = 1;
        }

        if (selectionMask[idx]) {
          hasSelection = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }

  if (hasSelection) {
    selectionBounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    startMarchingAnts();
  } else {
    clearSelection();
  }

  // Debug: Log summary and save to file
  lassoDebugData.finalBounds = selectionBounds;
  lassoDebugData.hasSelection = hasSelection;
  console.log('=== LASSO DEBUG ===');
  console.log('Points:', lassoDebugData.points);
  console.log('Options:', lassoDebugData.options);
  console.log('Bounds:', lassoDebugData.bounds);
  console.log('Sampled colors:', lassoDebugData.sampledColors);
  console.log('Skipped pixels:', lassoDebugData.skippedPixels);
  console.log('Selected count:', lassoDebugData.selectedCount);
  console.log('Sample pixel tests:', lassoDebugData.pixelTests.slice(0, 10));

  // Save to downloadable file
  saveLassoDebugToFile();

  return hasSelection;
}

// Save lasso debug data to server file
function saveLassoDebugToFile() {
  // Also make available on window for console access
  window.lassoDebugData = lassoDebugData;

  // POST to server to save to file
  fetch('/api/debug/lasso', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lassoDebugData)
  })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        console.log('Debug data saved to:', data.path);
      }
    })
    .catch(err => console.error('Failed to save debug data:', err));
}

// Get target colors (for UI)
export function getTargetColors() {
  return state.targetColors;
}

// Add a target color
export function addTargetColor(color, tolerance = 32) {
  state.targetColors.push({ color, tolerance });
}

// Remove a target color by index
export function removeTargetColor(index) {
  if (index >= 0 && index < state.targetColors.length) {
    state.targetColors.splice(index, 1);
  }
}

// Update target color tolerance
export function updateTargetColorTolerance(index, tolerance) {
  if (index >= 0 && index < state.targetColors.length) {
    state.targetColors[index].tolerance = Math.max(0, Math.min(255, tolerance));
  }
}

// Clear all target colors
export function clearTargetColors() {
  state.targetColors = [];
}

// ========== SELECTION BRUSH ==========

// Start a new brush stroke - clears selection unless adding/erasing
export function startBrushStroke(addMode, eraseMode) {
  if (!addMode && !eraseMode) {
    clearSelection();
  }
}

// Paint onto selection mask (brush-style selection)
// brushSize is the actual pixel size (e.g., 2 for 2x2 brush)
export function brushSelect(x, y, brushSize, erase = false) {
  const width = state.canvasWidth;
  const height = state.canvasHeight;

  // Create mask if needed
  if (!selectionMask) {
    selectionMask = new Uint8Array(width * height);
  }

  // Use shared utility for consistent bounds with preview
  // This matches exactly how fillRect works in canvas preview
  const bounds = getBrushBounds(x, y, brushSize);

  // Loop using < (not <=) to match fillRect behavior
  for (let py = bounds.y; py < bounds.y + bounds.height; py++) {
    if (py < 0 || py >= height) continue;
    for (let px = bounds.x; px < bounds.x + bounds.width; px++) {
      if (px < 0 || px >= width) continue;
      const idx = py * width + px;
      selectionMask[idx] = erase ? 0 : 1;
    }
  }

  // Update bounds
  updateSelectionBounds();
}

// Paint a line onto selection mask (for smooth brush strokes)
export function brushSelectLine(x1, y1, x2, y2, brushSize, erase = false) {
  // Bresenham-style line with squares at each point
  // Skip start position (i=0) since it was already painted by startDraw or previous continueDraw
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const steps = Math.max(dx, dy, 1);

  // Start from i=1 to skip start position (already painted)
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(x1 + (x2 - x1) * t);
    const y = Math.round(y1 + (y2 - y1) * t);
    brushSelect(x, y, brushSize, erase);
  }
}

// Update selection bounds after brush painting
function updateSelectionBounds() {
  const width = state.canvasWidth;
  const height = state.canvasHeight;

  let minX = width, maxX = 0, minY = height, maxY = 0;
  let hasAny = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (selectionMask[y * width + x]) {
        hasAny = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (hasAny) {
    selectionBounds = {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    };
    startMarchingAnts();
  } else {
    selectionMask = null;
    selectionBounds = null;
    stopMarchingAnts();
  }
}

// Get selection state for history (serializable snapshot)
export function getSelectionState() {
  return {
    mask: selectionMask ? Array.from(selectionMask) : null,
    bounds: selectionBounds ? { ...selectionBounds } : null,
    lastLassoPoints: state.lastLassoPoints ? [...state.lastLassoPoints] : null,
    targetColors: state.targetColors ? JSON.parse(JSON.stringify(state.targetColors)) : []
  };
}

// Restore selection state from history
export function setSelectionState(selState) {
  if (!selState) {
    selectionMask = null;
    selectionBounds = null;
    state.lastLassoPoints = null;
    state.targetColors = [];
    return;
  }

  selectionMask = selState.mask ? new Uint8Array(selState.mask) : null;
  selectionBounds = selState.bounds ? { ...selState.bounds } : null;
  state.lastLassoPoints = selState.lastLassoPoints ? [...selState.lastLassoPoints] : null;
  state.targetColors = selState.targetColors ? JSON.parse(JSON.stringify(selState.targetColors)) : [];
}

// ========================================================================
// EXPORTED UTILITY FUNCTIONS
// ========================================================================
// These functions are exported for use in other modules (e.g., magnetic lasso)

export {
  // Color distance algorithms
  colorDistanceManhattan,
  colorDistanceEuclidean,
  colorDistanceWeighted,
  colorsMatch,

  // Geometry algorithms
  pointInPolygon,
  getPolygonBounds,
  polygonArea,

  // Edge detection
  detectEdges,
  traceContour,

  // Color utilities
  rgbToHex
};
