// sprite-renderer.js - Canvas rendering for animated unit sprites
// Single responsibility: Draw unit parts to canvas with transforms
//
// This module handles all visual rendering of unit sprites.
// No game logic, no state management - just drawing.

// Image cache for part images
const imageCache = new Map();
const loadingImages = new Map();

/**
 * Load an image and cache it
 * @param {string} src - Image source URL
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(src) {
  if (!src) return Promise.resolve(null);

  // Return cached image if available
  if (imageCache.has(src)) {
    return Promise.resolve(imageCache.get(src));
  }

  // Return existing promise if already loading
  if (loadingImages.has(src)) {
    return loadingImages.get(src);
  }

  // Start loading
  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(src, img);
      loadingImages.delete(src);
      resolve(img);
    };
    img.onerror = () => {
      loadingImages.delete(src);
      console.warn(`Failed to load image: ${src}`);
      resolve(null);
    };
    img.src = src;
  });

  loadingImages.set(src, promise);
  return promise;
}

/**
 * Get cached image (synchronous - returns null if not loaded)
 * @param {string} src - Image source URL
 * @returns {HTMLImageElement|null}
 */
export function getCachedImage(src) {
  return imageCache.get(src) || null;
}

/**
 * Preload all images for a variant
 * @param {object} variantData - Variant JSON with parts
 * @returns {Promise<void>}
 */
export async function loadVariantImages(variantData) {
  if (!variantData || !variantData.parts) return;

  const promises = variantData.parts
    .filter(p => p.image)
    .map(p => loadImage(p.image));

  await Promise.all(promises);
}

/**
 * Render a single unit at a position with rotation
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {object} variantData - Variant JSON with parts
 * @param {Array} transforms - Part transforms from calculateUnitTransforms()
 * @param {number} worldX - World X position
 * @param {number} worldY - World Y position
 * @param {number} worldRotation - World rotation in degrees
 * @param {number} worldScale - World scale (1 = 100%)
 */
export function renderUnit(ctx, variantData, transforms, worldX, worldY, worldRotation = 0, worldScale = 1) {
  if (!variantData || !transforms || transforms.length === 0) return;

  const parts = variantData.parts || [];
  const canvasW = variantData.canvasSize?.width || 256;
  const canvasH = variantData.canvasSize?.height || 256;

  // Sort transforms by z-index (lower first)
  const sortedTransforms = [...transforms].sort((a, b) => {
    const partA = parts[a.partIndex];
    const partB = parts[b.partIndex];
    return (partA?.zIndex || 0) - (partB?.zIndex || 0);
  });

  ctx.save();

  // Move to world position
  ctx.translate(worldX, worldY);
  ctx.rotate(worldRotation * Math.PI / 180);
  ctx.scale(worldScale, worldScale);

  // Offset so variant center is at origin
  ctx.translate(-canvasW / 2, -canvasH / 2);

  // Render each part
  for (const transform of sortedTransforms) {
    const part = parts[transform.partIndex];
    if (!part) continue;

    const img = getCachedImage(part.image);
    if (!img) continue;

    const { x, y, rotation, scale, opacity, originOffsetX, originOffsetY } = transform;

    ctx.save();

    // Apply transform
    ctx.translate(x, y);
    ctx.rotate((rotation || 0) * Math.PI / 180);
    ctx.scale(scale || 1, scale || 1);

    // Apply opacity
    ctx.globalAlpha = (opacity ?? 100) / 100;

    // Draw with origin offset for attached parts
    // originOffset is the attachment point on the child part
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const offsetX = originOffsetX || 0;
    const offsetY = originOffsetY || 0;
    ctx.drawImage(img, -w / 2 - offsetX, -h / 2 - offsetY, w, h);

    ctx.restore();
  }

  ctx.restore();
}

/**
 * Render unit shadow (silhouette)
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {object} variantData - Variant JSON with parts
 * @param {Array} transforms - Part transforms
 * @param {number} worldX - World X position
 * @param {number} worldY - World Y position
 * @param {number} worldRotation - World rotation in degrees
 * @param {number} worldScale - World scale
 * @param {object} shadowConfig - { offsetAngle, offsetDistance, opacity }
 */
export function renderUnitShadow(ctx, variantData, transforms, worldX, worldY, worldRotation = 0, worldScale = 1, shadowConfig = {}) {
  if (!variantData || !transforms || transforms.length === 0) return;

  const {
    offsetAngle = 135,
    offsetDistance = 4,
    opacity = 0.3
  } = shadowConfig;

  // Calculate shadow offset
  const rad = offsetAngle * Math.PI / 180;
  const offsetX = Math.cos(rad) * offsetDistance * worldScale;
  const offsetY = Math.sin(rad) * offsetDistance * worldScale;

  const parts = variantData.parts || [];
  const canvasW = variantData.canvasSize?.width || 256;
  const canvasH = variantData.canvasSize?.height || 256;

  const sortedTransforms = [...transforms].sort((a, b) => {
    const partA = parts[a.partIndex];
    const partB = parts[b.partIndex];
    return (partA?.zIndex || 0) - (partB?.zIndex || 0);
  });

  ctx.save();

  // Move to shadow position
  ctx.translate(worldX + offsetX, worldY + offsetY);
  ctx.rotate(worldRotation * Math.PI / 180);
  ctx.scale(worldScale, worldScale);
  ctx.translate(-canvasW / 2, -canvasH / 2);

  // Shadow render settings
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = 'source-over';

  // Render each part as black silhouette
  for (const transform of sortedTransforms) {
    const part = parts[transform.partIndex];
    if (!part) continue;

    const img = getCachedImage(part.image);
    if (!img) continue;

    const { x, y, rotation, scale } = transform;

    ctx.save();

    ctx.translate(x, y);
    ctx.rotate((rotation || 0) * Math.PI / 180);
    ctx.scale(scale || 1, scale || 1);

    // Draw as black silhouette
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    // Method: Draw image, then fill with black using composite
    ctx.drawImage(img, -w / 2, -h / 2, w, h);

    // Overlay black on the drawn pixels
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = '#000';
    ctx.fillRect(-w / 2, -h / 2, w, h);

    ctx.restore();
  }

  ctx.restore();
}

/**
 * Batch render multiple units
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Array} units - Array of { variantData, transforms, x, y, rotation, scale }
 * @param {object} shadowConfig - Shadow config (shared for all)
 */
export function renderUnits(ctx, units, shadowConfig = null) {
  // First pass: shadows
  if (shadowConfig) {
    for (const unit of units) {
      renderUnitShadow(
        ctx,
        unit.variantData,
        unit.transforms,
        unit.x,
        unit.y,
        unit.rotation || 0,
        unit.scale || 1,
        shadowConfig
      );
    }
  }

  // Second pass: units
  for (const unit of units) {
    renderUnit(
      ctx,
      unit.variantData,
      unit.transforms,
      unit.x,
      unit.y,
      unit.rotation || 0,
      unit.scale || 1
    );
  }
}

/**
 * Clear image cache (for cleanup or refresh)
 */
export function clearImageCache() {
  imageCache.clear();
  loadingImages.clear();
}

/**
 * Get cache stats (for debugging)
 */
export function getCacheStats() {
  return {
    cached: imageCache.size,
    loading: loadingImages.size
  };
}
