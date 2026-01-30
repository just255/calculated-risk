// ═══════════════════════════════════════════════════════════════
// SCATTER RENDERER - Unified rendering for scatter items
// ═══════════════════════════════════════════════════════════════
// Renders scatter items with viewport culling and proper layering.
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
  // Get visible items for this layer
  const visible = getVisibleScatter(terrainMap, viewport, { layer });

  if (visible.length === 0) return;

  // Sort canopy layer (smaller scale first, then by Y)
  let sorted = visible;
  if (layer === 'canopy') {
    sorted = [...visible].sort((a, b) => (a.scale - b.scale) || (a.y - b.y));
  }

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

  // Calculate size (use animated scale if available)
  const baseSize = img.width || 256;
  const effectiveScale = item._renderScale ?? item.scale;
  const size = baseSize * effectiveScale;

  // Get render position (use animated position if available)
  const rx = item._renderX ?? item.x;
  const ry = item._renderY ?? item.y;
  const rrot = item._renderRotation ?? item.rotation;

  ctx.save();

  // Position and rotation
  ctx.translate(rx, ry);
  if (rrot !== 0) {
    ctx.rotate(rrot * Math.PI / 180);
  }

  // Alpha (use animated alpha if available)
  ctx.globalAlpha = Math.min(1, item._renderAlpha ?? (item.alpha ?? 1.0));

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
