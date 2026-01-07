// sprite-editor/stamp.js - Stamp tool for duplicating selections
// Single responsibility: Handle stamp/clone operations

import * as selection from './selection.js';

/**
 * Create stamp pixels from current selection
 *
 * @param {number} targetX - Center X position for stamp
 * @param {number} targetY - Center Y position for stamp
 * @param {Object} options - Stamp options
 * @param {boolean} options.flipH - Flip horizontally
 * @param {boolean} options.flipV - Flip vertically
 * @param {boolean} options.random - Randomize flips
 * @returns {Array|null} Array of {x, y, r, g, b, a} pixels or null if no selection
 */
export function createStamp(targetX, targetY, options = {}) {
  const stampData = selection.getSelectedImageData();

  if (!stampData) {
    console.log('[Stamp] No selection to stamp');
    return null;
  }

  const { imageData: stampImg, bounds: stampBounds } = stampData;

  // Determine transformations
  let doFlipH = options.flipH || false;
  let doFlipV = options.flipV || false;

  if (options.random) {
    doFlipH = Math.random() > 0.5;
    doFlipV = Math.random() > 0.5;
  }

  // Calculate offset to center stamp at target position
  const offsetX = targetX - Math.floor(stampBounds.width / 2);
  const offsetY = targetY - Math.floor(stampBounds.height / 2);

  const pixels = [];

  // Copy pixels from selection
  for (let sy = 0; sy < stampBounds.height; sy++) {
    for (let sx = 0; sx < stampBounds.width; sx++) {
      const srcIdx = (sy * stampBounds.width + sx) * 4;
      const a = stampImg.data[srcIdx + 3];

      if (a < 10) continue; // Skip transparent pixels

      // Apply flips
      const destX = doFlipH ? (stampBounds.width - 1 - sx) : sx;
      const destY = doFlipV ? (stampBounds.height - 1 - sy) : sy;

      pixels.push({
        x: offsetX + destX,
        y: offsetY + destY,
        r: stampImg.data[srcIdx],
        g: stampImg.data[srcIdx + 1],
        b: stampImg.data[srcIdx + 2],
        a: a
      });
    }
  }

  return pixels.length > 0 ? pixels : null;
}

/**
 * Get stamp preview bounds (for showing where stamp will be placed)
 *
 * @param {number} targetX - Center X position
 * @param {number} targetY - Center Y position
 * @returns {Object|null} {x, y, width, height} or null if no selection
 */
export function getStampPreviewBounds(targetX, targetY) {
  const bounds = selection.getSelectionBounds();

  if (!bounds) return null;

  return {
    x: targetX - Math.floor(bounds.width / 2),
    y: targetY - Math.floor(bounds.height / 2),
    width: bounds.width,
    height: bounds.height
  };
}

/**
 * Check if stamp tool can be used (has valid selection)
 *
 * @returns {boolean}
 */
export function canStamp() {
  return selection.hasSelection();
}
