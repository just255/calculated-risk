// ═══════════════════════════════════════════════════════════════
// SCATTER RENDERER - Unified rendering for scatter items
// ═══════════════════════════════════════════════════════════════
// Renders scatter items with viewport culling and proper layering.
//
// PREVIEW SCALE SYSTEM
// --------------------
// Similar to the ground texture system which uses 2x scale for preview
// and 4x for final render, the scatter renderer supports a `previewScale`
// option to reduce sprite resolution during previews:
//
//   previewScale: 1.0  = Full resolution (256px sprites) - for cache builds
//   previewScale: 0.5  = Half resolution (128px effective) - for previews
//   previewScale: 0.25 = Quarter resolution (64px effective) - for thumbnails
//
// This is used in:
//   - Panel preview (200x200 canvas) - uses 0.5 scale
//   - On-canvas scatter preview during painting - uses 0.5 scale
//   - Final canopy cache - uses 1.0 scale (full quality)
//
// The scale is applied to the sprite's draw size, not the item's scale.
// This means items maintain their relative sizes but use less GPU bandwidth.
// ═══════════════════════════════════════════════════════════════

import { SCATTER_TYPES, getVisibleScatter, getSpriteKey } from './scatter.js';

/**
 * Render scatter items for a specific layer
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {object} terrainMap - TerrainMap with scatterItems[]
 * @param {string} layer - 'ground' or 'canopy'
 * @param {object} viewport - { x, y, width, height }
 * @param {object} images - Image collections by category { tree: {}, floor: {}, brush: {}, particle: {} }
 * @param {object} options - Rendering options
 */
export function renderScatterLayer(ctx, terrainMap, layer, viewport, images, options = {}) {
  // Get visible items for this layer (pass through category filter if provided)
  const filterOpts = { layer };
  if (options.category) filterOpts.category = options.category;
  if (options.excludeCategories) filterOpts.excludeCategories = options.excludeCategories;
  const visible = getVisibleScatter(terrainMap, viewport, filterOpts);

  if (visible.length === 0) {
    console.log(`[ScatterRenderer] Layer '${layer}': 0 visible items`);
    return;
  }

  // Sort canopy layer (smaller scale first, then by Y)
  let sorted = visible;
  if (layer === 'canopy') {
    sorted = [...visible].sort((a, b) => (a.scale - b.scale) || (a.y - b.y));
  }

  console.log(`[ScatterRenderer] Layer '${layer}': rendering ${sorted.length} items (skipFilters: ${!!options.skipFilters})`);

  // Render each item
  for (const item of sorted) {
    renderScatterItem(ctx, item, images, options);
  }
}

/**
 * Render a single scatter item
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {object} item - ScatterItem
 * @param {object} images - Image collections
 * @param {object} options - Rendering options
 * @param {number} options.previewScale - Sprite resolution scale (1.0 = full, 0.5 = half, 0.25 = quarter)
 * @param {boolean} options.skipFilters - Skip expensive CSS filters
 * @param {object} options.postProcessing - Color adjustments { canopy: {}, ground: {} }
 * @param {boolean} options.showMissing - Show placeholder for missing sprites
 */
// Track logged warnings to avoid spam
const _loggedWarnings = new Set();

export function renderScatterItem(ctx, item, images, options = {}) {
  const config = SCATTER_TYPES[item.type];
  if (!config) {
    if (config === undefined && item.type?.startsWith('tree-')) {
      console.error(`[Render] No config for tree type: ${item.type}`);
    }
    return;
  }

  // Get the image
  const spriteKey = getSpriteKey(item);
  const categoryImages = images[config.category];
  if (!categoryImages) {
    if (config.category === 'tree') {
      console.error(`[Render] No categoryImages for tree, category=${config.category}`);
    }
    return;
  }

  const img = categoryImages[spriteKey];
  if (!img || !img.complete) {
    // Log missing sprites (only once per key)
    if (!_loggedWarnings.has(spriteKey)) {
      console.warn(`[ScatterRenderer] Missing sprite: ${spriteKey} (category: ${config.category}, actualKey from getSpriteKey)`);
      if (config.category === 'tree') {
        console.warn(`[Render] Tree item details:`, { type: item.type, age: item.age, variant: item.variant, isDead: item.isDead });
        console.warn(`[Render] Available tree keys sample:`, Object.keys(categoryImages).slice(0, 15));
      }
      _loggedWarnings.add(spriteKey);
    }
    // Draw placeholder for debugging
    if (options.showMissing) {
      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
      const size = 20 * (item.scale || 0.2);
      ctx.fillRect(-size/2, -size/2, size, size);
      ctx.restore();
    }
    return;
  }

  // Calculate size (use animated scale if available, unless skipAnimation)
  // Apply previewScale to reduce GPU bandwidth during previews
  const baseSize = img.width || 256;
  const skipAnim = options.skipAnimation;
  const effectiveScale = skipAnim ? item.scale : (item._renderScale ?? item.scale);
  const previewScale = options.previewScale ?? 1.0;
  const size = baseSize * effectiveScale * previewScale;

  // Get render position (use animated position if available, unless skipAnimation)
  const rx = skipAnim ? item.x : (item._renderX ?? item.x);
  const ry = skipAnim ? item.y : (item._renderY ?? item.y);
  const rrot = skipAnim ? item.rotation : (item._renderRotation ?? item.rotation);

  ctx.save();

  // Position and rotation
  ctx.translate(rx, ry);
  if (rrot !== 0) {
    ctx.rotate(rrot * Math.PI / 180);
  }

  // Alpha (use animated alpha if available, unless skipAnimation)
  ctx.globalAlpha = Math.min(1, skipAnim ? (item.alpha ?? 1.0) : (item._renderAlpha ?? (item.alpha ?? 1.0)));

  // Color adjustments (hue, brightness, saturation) + animation brightness
  // CSS filters are GPU-expensive; skip during live rendering (options.skipFilters)
  // Filters are applied during cache builds where cost is amortized
  if (!options.skipFilters) {
    const animBrightness = item._renderBrightness ?? 1;

    // Base item values
    let hue = item.hueShift || 0;
    let brightness = (item.brightness || 1) * animBrightness;
    let saturation = item.saturation || 1;

    // Apply post-processing overrides for canopy items (trees, brush, particles)
    const postProcess = options.postProcessing;
    if (postProcess && config.layer === 'canopy') {
      const canopy = postProcess.canopy;
      if (canopy) {
        hue += canopy.hueShift || 0;
        brightness *= canopy.brightness ?? 1;
        saturation *= canopy.saturation ?? 1;
      }
    }

    // Apply post-processing for ground items (floor patches)
    if (postProcess && config.layer === 'ground') {
      const ground = postProcess.ground;
      if (ground) {
        brightness *= ground.brightness ?? 1;
        // Note: tintColor would require more complex blending, skipped for now
      }
    }

    const hasColorAdjustment = hue || brightness !== 1 || saturation !== 1;
    if (hasColorAdjustment) {
      ctx.filter = `hue-rotate(${hue}deg) brightness(${brightness}) saturate(${saturation})`;
    }
  }

  // Draw centered
  ctx.drawImage(img, -size / 2, -size / 2, size, size);

  ctx.restore();
}

/**
 * Render ground layer (floor patches)
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {object} terrainMap - TerrainMap
 * @param {object} viewport - Viewport
 * @param {object} images - Images
 * @param {object} options - Options
 */
export function renderGroundScatter(ctx, terrainMap, viewport, images, options = {}) {
  renderScatterLayer(ctx, terrainMap, 'ground', viewport, images, options);
}

/**
 * Render canopy layer (trees, brush, particles)
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {object} terrainMap - TerrainMap
 * @param {object} viewport - Viewport
 * @param {object} images - Images
 * @param {object} options - Options
 */
export function renderCanopyScatter(ctx, terrainMap, viewport, images, options = {}) {
  renderScatterLayer(ctx, terrainMap, 'canopy', viewport, images, options);
}

/**
 * Get count of visible scatter items (for debugging/stats)
 * @param {object} terrainMap - TerrainMap
 * @param {object} viewport - Viewport
 * @returns {object} Counts by layer
 */
export function getVisibleScatterCounts(terrainMap, viewport) {
  const ground = getVisibleScatter(terrainMap, viewport, { layer: 'ground' });
  const canopy = getVisibleScatter(terrainMap, viewport, { layer: 'canopy' });

  return {
    ground: ground.length,
    canopy: canopy.length,
    total: ground.length + canopy.length
  };
}
