// sprite-editor/clipboard.js - Clipboard operations for copy/paste
// Single responsibility: Handle copy, cut, paste of selections

import { state } from './state.js';
import { render, getContext, getCurrentLayerImageData, getAllLayersImageData } from './canvas.js';
import { getCachedImage, cacheImage } from './images.js';
import { hasSelection, getSelectionMask, getSelectionBounds, getSelectedImageData, clearSelection, setSelectionFromMask } from './selection.js';
import { saveHistory } from './history.js';

// Clipboard state
let clipboard = null;  // { dataUrl, width, height, bounds }

// ============================================
// Shared Arrow Key Utilities
// ============================================

/**
 * Parse arrow key event and return movement delta
 * @param {KeyboardEvent} e - The keyboard event
 * @returns {{dx: number, dy: number}|null} - Movement delta or null if not an arrow key
 */
export function getArrowKeyDelta(e) {
  const step = e.shiftKey ? 10 : 1;

  switch (e.key) {
    case 'ArrowUp':    return { dx: 0, dy: -step };
    case 'ArrowDown':  return { dx: 0, dy: step };
    case 'ArrowLeft':  return { dx: -step, dy: 0 };
    case 'ArrowRight': return { dx: step, dy: 0 };
    default: return null;
  }
}

// ============================================
// Selection Movement
// ============================================

/**
 * Move selected pixels by dx, dy
 * Works by: copy selection -> delete original -> paste at offset
 * @param {number} dx - Horizontal movement
 * @param {number} dy - Vertical movement
 * @returns {boolean} - Success
 */
export async function moveSelection(dx, dy) {
  if (!hasSelection()) return false;
  if (dx === 0 && dy === 0) return false;

  // Copy the current selection to internal clipboard
  if (!copySelection()) return false;

  const bounds = getSelectionBounds();
  const mask = getSelectionMask();
  const width = state.canvasWidth;
  const height = state.canvasHeight;

  saveHistory();

  // Delete the original pixels
  await deleteSelectedPixels();

  // Calculate new position
  const newX = bounds.x + dx;
  const newY = bounds.y + dy;

  // Paste at new position (as an image shape on the current layer)
  const layer = state.layers.find(l => l.id === state.selectedLayerId);
  if (!layer || !clipboard) return false;

  const imageShape = {
    type: 'image',
    imageData: clipboard.dataUrl,
    x: newX,
    y: newY,
    width: clipboard.width,
    height: clipboard.height,
    originalWidth: clipboard.width,
    originalHeight: clipboard.height,
    opacity: 100
  };

  layer.shapes.push(imageShape);

  // Update selection mask to new position
  const newMask = new Uint8Array(width * height);
  const newBounds = {
    x: Math.max(0, Math.min(width - 1, newX)),
    y: Math.max(0, Math.min(height - 1, newY)),
    width: bounds.width,
    height: bounds.height
  };

  // Shift the mask
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const oldX = x - dx;
      const oldY = y - dy;
      if (oldX >= 0 && oldX < width && oldY >= 0 && oldY < height) {
        const oldIdx = oldY * width + oldX;
        if (mask[oldIdx]) {
          const newIdx = y * width + x;
          if (x >= 0 && x < width && y >= 0 && y < height) {
            newMask[newIdx] = 1;
          }
        }
      }
    }
  }

  // Recalculate bounds for new mask
  let minX = width, maxX = 0, minY = height, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (newMask[y * width + x]) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX >= minX && maxY >= minY) {
    setSelectionFromMask(newMask, {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    });
  }

  render();
  return true;
}

// ============================================
// Selection Rotation
// ============================================

/**
 * Rotate selected pixels by given angle (in degrees)
 * Works by: copy selection -> delete original -> paste rotated at same center
 * @param {number} angleDegrees - Rotation angle in degrees (positive = clockwise)
 * @returns {Promise<boolean>} - Success
 */
export async function rotateSelection(angleDegrees) {
  if (!hasSelection()) return false;
  if (angleDegrees === 0) return false;

  // Copy the current selection to internal clipboard
  if (!copySelection()) return false;

  const bounds = getSelectionBounds();
  const width = state.canvasWidth;
  const height = state.canvasHeight;

  // Calculate center of selection
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  saveHistory();

  // Delete the original pixels
  await deleteSelectedPixels();

  // Get the clipboard image and rotate it
  if (!clipboard) return false;

  const rotatedDataUrl = await rotateImageData(
    clipboard.dataUrl,
    clipboard.width,
    clipboard.height,
    angleDegrees
  );

  if (!rotatedDataUrl) return false;

  // Calculate new dimensions after rotation
  const angleRad = angleDegrees * Math.PI / 180;
  const cos = Math.abs(Math.cos(angleRad));
  const sin = Math.abs(Math.sin(angleRad));
  const newWidth = Math.ceil(clipboard.width * cos + clipboard.height * sin);
  const newHeight = Math.ceil(clipboard.width * sin + clipboard.height * cos);

  // Calculate new position to keep center at same location
  const newX = Math.round(centerX - newWidth / 2);
  const newY = Math.round(centerY - newHeight / 2);

  // Create rotated image shape on current layer
  const layer = state.layers.find(l => l.id === state.selectedLayerId);
  if (!layer) return false;

  const imageShape = {
    type: 'image',
    imageData: rotatedDataUrl.dataUrl,
    x: newX,
    y: newY,
    width: newWidth,
    height: newHeight,
    originalWidth: newWidth,
    originalHeight: newHeight,
    opacity: 100
  };

  layer.shapes.push(imageShape);

  // Update selection to cover the rotated area
  const newMask = new Uint8Array(width * height);
  const newBounds = {
    x: Math.max(0, newX),
    y: Math.max(0, newY),
    width: Math.min(width - newX, newWidth),
    height: Math.min(height - newY, newHeight)
  };

  // Fill rectangular selection for the rotated bounds
  for (let y = newBounds.y; y < newBounds.y + newBounds.height && y < height; y++) {
    for (let x = newBounds.x; x < newBounds.x + newBounds.width && x < width; x++) {
      if (x >= 0 && y >= 0) {
        newMask[y * width + x] = 1;
      }
    }
  }

  setSelectionFromMask(newMask, newBounds);

  render();
  console.log(`[clipboard] Rotated selection by ${angleDegrees}°`);
  return true;
}

/**
 * Rotate image data by given angle
 * @param {string} dataUrl - Source image data URL
 * @param {number} width - Source width
 * @param {number} height - Source height
 * @param {number} angleDegrees - Rotation angle in degrees
 * @returns {Promise<{dataUrl: string, width: number, height: number}|null>}
 */
async function rotateImageData(dataUrl, width, height, angleDegrees) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const angleRad = angleDegrees * Math.PI / 180;
      const cos = Math.abs(Math.cos(angleRad));
      const sin = Math.abs(Math.sin(angleRad));

      // Calculate new canvas size to fit rotated image
      const newWidth = Math.ceil(width * cos + height * sin);
      const newHeight = Math.ceil(width * sin + height * cos);

      const canvas = document.createElement('canvas');
      canvas.width = newWidth;
      canvas.height = newHeight;
      const ctx = canvas.getContext('2d');

      // Move to center, rotate, then draw image centered
      ctx.translate(newWidth / 2, newHeight / 2);
      ctx.rotate(angleRad);
      ctx.drawImage(img, -width / 2, -height / 2, width, height);

      const rotatedDataUrl = canvas.toDataURL('image/png');

      // Pre-cache the rotated image
      const cachedImg = new Image();
      cachedImg.onload = () => {
        cacheImage(rotatedDataUrl, cachedImg);
        resolve({ dataUrl: rotatedDataUrl, width: newWidth, height: newHeight });
      };
      cachedImg.onerror = () => resolve(null);
      cachedImg.src = rotatedDataUrl;
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * Flip selection horizontally
 * @returns {Promise<boolean>}
 */
export async function flipSelectionHorizontal() {
  return flipSelection(true, false);
}

/**
 * Flip selection vertically
 * @returns {Promise<boolean>}
 */
export async function flipSelectionVertical() {
  return flipSelection(false, true);
}

/**
 * Flip selected pixels
 * @param {boolean} horizontal - Flip horizontally
 * @param {boolean} vertical - Flip vertically
 * @returns {Promise<boolean>}
 */
async function flipSelection(horizontal, vertical) {
  if (!hasSelection()) return false;
  if (!horizontal && !vertical) return false;

  // Copy the current selection
  if (!copySelection()) return false;

  const bounds = getSelectionBounds();

  saveHistory();

  // Delete the original pixels
  await deleteSelectedPixels();

  if (!clipboard) return false;

  // Flip the image
  const flippedDataUrl = await flipImageData(
    clipboard.dataUrl,
    clipboard.width,
    clipboard.height,
    horizontal,
    vertical
  );

  if (!flippedDataUrl) return false;

  // Create flipped image shape at same position
  const layer = state.layers.find(l => l.id === state.selectedLayerId);
  if (!layer) return false;

  const imageShape = {
    type: 'image',
    imageData: flippedDataUrl,
    x: bounds.x,
    y: bounds.y,
    width: clipboard.width,
    height: clipboard.height,
    originalWidth: clipboard.width,
    originalHeight: clipboard.height,
    opacity: 100
  };

  layer.shapes.push(imageShape);

  render();
  console.log(`[clipboard] Flipped selection ${horizontal ? 'H' : ''}${vertical ? 'V' : ''}`);
  return true;
}

/**
 * Flip image data
 */
async function flipImageData(dataUrl, width, height, horizontal, vertical) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      ctx.translate(horizontal ? width : 0, vertical ? height : 0);
      ctx.scale(horizontal ? -1 : 1, vertical ? -1 : 1);
      ctx.drawImage(img, 0, 0, width, height);

      const flippedDataUrl = canvas.toDataURL('image/png');

      // Pre-cache
      const cachedImg = new Image();
      cachedImg.onload = () => {
        cacheImage(flippedDataUrl, cachedImg);
        resolve(flippedDataUrl);
      };
      cachedImg.onerror = () => resolve(null);
      cachedImg.src = flippedDataUrl;
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// Check if clipboard has content
export function hasClipboard() {
  return clipboard !== null;
}

// Get clipboard data
export function getClipboard() {
  return clipboard;
}

// Clear clipboard
export function clearClipboard() {
  clipboard = null;
}

// Copy selection to clipboard
export function copySelection() {
  if (!hasSelection()) {
    console.log('[clipboard] No selection to copy');
    return false;
  }

  const selectionData = getSelectedImageData();
  if (!selectionData || !selectionData.imageData) {
    console.log('[clipboard] Failed to get selection data');
    return false;
  }

  const { imageData, bounds } = selectionData;

  // Convert ImageData to data URL
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = imageData.width;
  tempCanvas.height = imageData.height;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.putImageData(imageData, 0, 0);
  const dataUrl = tempCanvas.toDataURL('image/png');

  clipboard = {
    dataUrl,
    width: imageData.width,
    height: imageData.height,
    bounds: { ...bounds }
  };

  console.log(`[clipboard] Copied selection: ${imageData.width}x${imageData.height}`);
  return true;
}

// Cut selection (copy + delete)
export async function cutSelection() {
  if (!copySelection()) {
    return false;
  }

  // Delete selected pixels from current layer
  await deleteSelectedPixels();
  clearSelection();
  render();

  console.log('[clipboard] Cut selection');
  return true;
}

// Delete selected pixels from current layer
export async function deleteSelectedPixels() {
  if (!hasSelection()) return false;

  const layer = state.layers.find(l => l.id === state.selectedLayerId);
  if (!layer) return false;

  const mask = getSelectionMask();
  const bounds = getSelectionBounds();
  if (!mask || !bounds) return false;

  // Debug: count selected pixels
  let selectedCount = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) selectedCount++;
  }
  console.log(`[clipboard] Selection: ${selectedCount} pixels selected, bounds:`, bounds);

  saveHistory();

  const width = state.canvasWidth;
  const height = state.canvasHeight;
  console.log(`[clipboard] Canvas size: ${width}x${height}, layer has ${layer.shapes.length} shapes`);

  // For each shape in layer, we need to modify pixels that fall within selection
  for (let i = 0; i < layer.shapes.length; i++) {
    const shape = layer.shapes[i];

    if (shape.type === 'pixels' || shape.type === 'stamp' || shape.type === 'blend' || shape.type === 'pixelate' || shape.type === 'edge-fill') {
      // Filter out pixels that are selected
      if (shape.pixels) {
        shape.pixels = shape.pixels.filter(p => {
          const idx = p.y * width + p.x;
          return !mask[idx];
        });
      }
    } else if (shape.type === 'image' && shape.imageData) {
      // For image shapes, we need to make selected pixels transparent
      const newImageData = await deletePixelsFromImage(shape, mask, width, height);
      if (newImageData) {
        shape.imageData = newImageData;
      }
    }
  }

  return true;
}

// Helper: Delete selected pixels from an image shape
async function deletePixelsFromImage(shape, mask, canvasWidth, canvasHeight) {
  console.log(`[clipboard] Processing image shape at (${shape.x}, ${shape.y}), size ${shape.width}x${shape.height}`);
  console.log(`[clipboard] Mask length: ${mask.length}, expected: ${canvasWidth * canvasHeight}`);

  // Debug: Check a few mask values
  let maskOnes = 0, maskZeros = 0;
  for (let i = 0; i < Math.min(1000, mask.length); i++) {
    if (mask[i]) maskOnes++; else maskZeros++;
  }
  console.log(`[clipboard] First 1000 mask values: ${maskOnes} ones, ${maskZeros} zeros`);

  // Get the image to work with
  let img;

  if (!shape.imageData.startsWith('data:')) {
    // For URL-based images, use cached image
    img = getCachedImage(shape.imageData);
    if (!img) return null;
  } else {
    // For data URLs, load the image first
    img = await new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => resolve(null);
      i.src = shape.imageData;
    });
    if (!img) return null;
  }

  // Draw to temp canvas
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = shape.width;
  tempCanvas.height = shape.height;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(img, 0, 0, shape.width, shape.height);

  const imgData = tempCtx.getImageData(0, 0, shape.width, shape.height);

  // Delete pixels that fall within selection
  let deletedCount = 0;
  let keptCount = 0;
  let outOfBounds = 0;
  let totalPixels = shape.width * shape.height;

  // Debug: log first few pixel checks
  let debugCount = 0;

  for (let py = 0; py < shape.height; py++) {
    for (let px = 0; px < shape.width; px++) {
      // Convert shape-local coords to canvas coords
      const canvasX = Math.floor(shape.x + px);
      const canvasY = Math.floor(shape.y + py);

      if (canvasX >= 0 && canvasX < canvasWidth && canvasY >= 0 && canvasY < canvasHeight) {
        const maskIdx = canvasY * canvasWidth + canvasX;
        const isSelected = mask[maskIdx];

        if (debugCount < 5) {
          console.log(`[clipboard] Pixel (${px},${py}) -> canvas (${canvasX},${canvasY}) -> maskIdx ${maskIdx} = ${isSelected}`);
          debugCount++;
        }

        if (isSelected) {
          // This pixel is selected - make it transparent
          const imgIdx = (py * shape.width + px) * 4;
          imgData.data[imgIdx + 3] = 0; // Set alpha to 0
          deletedCount++;
        } else {
          keptCount++;
        }
      } else {
        outOfBounds++;
      }
    }
  }

  console.log(`[clipboard] Result: deleted=${deletedCount}, kept=${keptCount}, outOfBounds=${outOfBounds}, total=${totalPixels}`);

  tempCtx.putImageData(imgData, 0, 0);
  const dataUrl = tempCanvas.toDataURL('image/png');

  // Pre-cache the new image so it renders immediately
  await new Promise((resolve) => {
    const newImg = new Image();
    newImg.onload = () => {
      cacheImage(dataUrl, newImg);
      console.log('[clipboard] Pre-cached modified image');
      resolve();
    };
    newImg.onerror = () => {
      console.warn('[clipboard] Failed to pre-cache modified image');
      resolve();
    };
    newImg.src = dataUrl;
  });

  return dataUrl;
}

// Paste clipboard as new shape on current layer
export function pasteSelection(offsetX = 0, offsetY = 0) {
  if (!clipboard) {
    console.log('[clipboard] Nothing to paste');
    return null;
  }

  const layer = state.layers.find(l => l.id === state.selectedLayerId);
  if (!layer) {
    console.log('[clipboard] No layer selected');
    return null;
  }

  saveHistory();

  // Calculate paste position (center of canvas or offset from original)
  let x, y;
  if (offsetX === 0 && offsetY === 0) {
    // Paste at original position with slight offset for visibility
    x = clipboard.bounds.x + 10;
    y = clipboard.bounds.y + 10;
  } else {
    x = offsetX;
    y = offsetY;
  }

  // Create image shape from clipboard
  const imageShape = {
    type: 'image',
    imageData: clipboard.dataUrl,
    x: x,
    y: y,
    width: clipboard.width,
    height: clipboard.height,
    originalWidth: clipboard.width,
    originalHeight: clipboard.height,
    opacity: 100
  };

  layer.shapes.push(imageShape);

  // Select the new shape
  state.selectedShapeIndex = layer.shapes.length - 1;

  render();
  console.log(`[clipboard] Pasted at (${x}, ${y})`);

  return imageShape;
}

// Paste at specific canvas position
export function pasteAt(canvasX, canvasY) {
  if (!clipboard) return null;

  // Center the pasted content at the click position
  const x = Math.round(canvasX - clipboard.width / 2);
  const y = Math.round(canvasY - clipboard.height / 2);

  return pasteSelection(x - clipboard.bounds.x, y - clipboard.bounds.y);
}

// Select all non-transparent pixels on current layer
export function selectAllOpaque() {
  const layerData = getCurrentLayerImageData();
  if (!layerData) {
    console.log('[clipboard] No layer data');
    return false;
  }

  const width = state.canvasWidth;
  const height = state.canvasHeight;
  const pixels = layerData.data;

  // Create selection mask for all non-transparent pixels
  const mask = new Uint8Array(width * height);
  let minX = width, maxX = 0, minY = height, maxY = 0;
  let hasAny = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const alpha = pixels[idx * 4 + 3];

      if (alpha > 0) {
        mask[idx] = 1;
        hasAny = true;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (!hasAny) {
    console.log('[clipboard] No opaque pixels found on current layer');
    return false;
  }

  const bounds = {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };

  setSelectionFromMask(mask, bounds);
  render();
  console.log(`[clipboard] Selected ${bounds.width}x${bounds.height} opaque area on current layer`);
  return true;
}

// Select all non-transparent pixels from all visible layers
export function selectAllOpaqueAllLayers() {
  const layerData = getAllLayersImageData();
  if (!layerData) {
    console.log('[clipboard] No layer data');
    return false;
  }

  const width = state.canvasWidth;
  const height = state.canvasHeight;
  const pixels = layerData.data;

  // Create selection mask for all non-transparent pixels
  const mask = new Uint8Array(width * height);
  let minX = width, maxX = 0, minY = height, maxY = 0;
  let hasAny = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const alpha = pixels[idx * 4 + 3];

      if (alpha > 0) {
        mask[idx] = 1;
        hasAny = true;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (!hasAny) {
    console.log('[clipboard] No opaque pixels found on any layer');
    return false;
  }

  const bounds = {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };

  setSelectionFromMask(mask, bounds);
  render();
  console.log(`[clipboard] Selected ${bounds.width}x${bounds.height} opaque area from all layers`);
  return true;
}
