// ═══════════════════════════════════════════════════════════════
// LOD (Level of Detail) System
// Centralized quality/performance configuration
// ═══════════════════════════════════════════════════════════════

/**
 * Quality presets for different performance/quality tradeoffs
 */
export const LOD_PRESETS = {
  low: {
    name: 'Low',
    description: 'Best performance, reduced detail',

    // Preview canvas
    previewMaxPixels: 128 * 128,      // 16K pixels (very low for large maps)
    previewMinScale: 0.05,

    // Scatter culling thresholds (zoom levels)
    scatterTreesOnlyZoom: 0.6,        // Below this: only trees
    scatterNoBrushZoom: 0.8,          // Below this: no brush
    scatterNoParticlesZoom: 1.0,      // Below this: no particles

    // Texture quality
    textureScale: 1,                   // Always 1x
    textureScalePreview: 1,

    // Sprite resolution
    spriteScale: 0.5,                  // Half resolution sprites

    // Viewport margins
    cullMarginGround: 50,
    cullMarginCanopy: 100,

    // Max scatter items per category (performance caps)
    maxItems: {
      tree: 5000,
      brush: 3000,
      floor: 5000,
      particle: 2000,
      total: 15000
    },
  },

  medium: {
    name: 'Medium',
    description: 'Balanced quality and performance',

    previewMaxPixels: 512 * 512,      // 256K pixels
    previewMinScale: 0.1,

    scatterTreesOnlyZoom: 0.4,
    scatterNoBrushZoom: 0.6,
    scatterNoParticlesZoom: 0.75,

    textureScale: 2,
    textureScalePreview: 1,

    spriteScale: 0.75,

    cullMarginGround: 100,
    cullMarginCanopy: 150,

    maxItems: {
      tree: 10000,
      brush: 8000,
      floor: 15000,
      particle: 10000,
      total: 40000
    },
  },

  high: {
    name: 'High',
    description: 'High quality, good performance',

    previewMaxPixels: 1024 * 1024,    // 1M pixels
    previewMinScale: 0.15,

    scatterTreesOnlyZoom: 0.3,
    scatterNoBrushZoom: 0.5,
    scatterNoParticlesZoom: 0.65,

    textureScale: 2,
    textureScalePreview: 1,

    spriteScale: 1.0,

    cullMarginGround: 100,
    cullMarginCanopy: 150,

    maxItems: {
      tree: 20000,
      brush: 15000,
      floor: 30000,
      particle: 20000,
      total: 80000
    },
  },

  ultra: {
    name: 'Ultra',
    description: 'Maximum quality, may impact performance',

    previewMaxPixels: 2048 * 2048,    // 4M pixels
    previewMinScale: 0.2,

    scatterTreesOnlyZoom: 0.2,
    scatterNoBrushZoom: 0.35,
    scatterNoParticlesZoom: 0.5,

    textureScale: 4,
    textureScalePreview: 2,

    spriteScale: 1.0,

    cullMarginGround: 150,
    cullMarginCanopy: 200,

    maxItems: {
      tree: 50000,
      brush: 40000,
      floor: 80000,
      particle: 50000,
      total: 200000
    },
  }
};

// Current quality level
let currentPreset = 'high';
let currentSettings = { ...LOD_PRESETS.high };

/**
 * Set quality preset
 * @param {string} preset - Preset name: 'low', 'medium', 'high', 'ultra'
 */
export function setQualityPreset(preset) {
  if (!LOD_PRESETS[preset]) {
    console.warn(`[LOD] Unknown preset: ${preset}`);
    return false;
  }
  currentPreset = preset;
  currentSettings = { ...LOD_PRESETS[preset] };
  console.log(`[LOD] Quality set to: ${currentSettings.name}`);
  return true;
}

/**
 * Get current LOD settings object
 */
export function getLODSettings() {
  return currentSettings;
}

/**
 * Get current preset name
 */
export function getCurrentPreset() {
  return currentPreset;
}

/**
 * Get list of available presets
 */
export function getPresetList() {
  return Object.entries(LOD_PRESETS).map(([key, value]) => ({
    key,
    name: value.name,
    description: value.description
  }));
}

// ═══════════════════════════════════════════════════════════════
// LOD Functions - Used by renderer and other systems
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate preview scale based on zoom and map size
 * @param {number} zoom - Current viewport zoom level
 * @param {number} mapWidth - Full map width in pixels
 * @param {number} mapHeight - Full map height in pixels
 * @returns {number} Scale factor for preview canvas (0.1 to 1.0)
 */
export function getPreviewScale(zoom, mapWidth, mapHeight) {
  const settings = currentSettings;
  const mapArea = mapWidth * mapHeight;

  // When zoomed in, use full resolution
  // When zoomed out, scale with zoom (LOD)
  let scale = zoom >= 1 ? 1 : zoom;

  // Apply max pixels cap
  const currentPixels = mapArea * scale * scale;
  if (currentPixels > settings.previewMaxPixels) {
    scale = Math.sqrt(settings.previewMaxPixels / mapArea);
  }

  // Apply minimum scale floor
  return Math.max(settings.previewMinScale, scale);
}

/**
 * Check if a scatter category should render at current zoom
 * @param {number} zoom - Current viewport zoom level
 * @param {string} category - Category: 'tree', 'brush', 'floor', 'particle'
 * @returns {boolean} Whether to render this category
 */
export function shouldRenderCategory(zoom, category) {
  const settings = currentSettings;

  switch (category) {
    case 'tree':
    case 'floor':
      return true; // Always render trees and floor
    case 'brush':
      return zoom >= settings.scatterTreesOnlyZoom;
    case 'particle':
      return zoom >= settings.scatterNoParticlesZoom;
    default:
      return true;
  }
}

/**
 * Get list of categories that should render at current zoom
 * @param {number} zoom - Current viewport zoom level
 * @returns {string[]} Array of category names to render
 */
export function getVisibleCategories(zoom) {
  const settings = currentSettings;
  const categories = ['tree', 'floor']; // Always render

  if (zoom >= settings.scatterTreesOnlyZoom) {
    categories.push('brush');
  }
  if (zoom >= settings.scatterNoParticlesZoom) {
    categories.push('particle');
  }

  return categories;
}

/**
 * Get texture render scale based on quality and scene complexity
 * @param {boolean} isPreview - Whether this is a preview render
 * @param {number} strokeCount - Number of strokes in scene (for dynamic scaling)
 * @param {number} radius - Stroke radius (for dynamic scaling)
 * @returns {number} Scale factor for texture rendering (1, 2, or 4)
 */
export function getTextureScale(isPreview, strokeCount = 0, radius = 0) {
  const settings = currentSettings;

  if (isPreview) {
    return settings.textureScalePreview;
  }

  // Dynamic reduction for heavy scenes
  if (strokeCount > 300 || radius > 150) {
    return Math.min(settings.textureScale, 1);
  }
  if (strokeCount > 100 || radius > 80) {
    return Math.min(settings.textureScale, 2);
  }

  return settings.textureScale;
}

/**
 * Get sprite render scale for scatter items
 * @returns {number} Scale factor for sprite rendering (0.5 to 1.0)
 */
export function getSpriteScale() {
  return currentSettings.spriteScale;
}

/**
 * Get viewport culling margin for a layer
 * @param {string} layer - Layer: 'ground' or 'canopy'
 * @returns {number} Margin in pixels to add around viewport for culling
 */
export function getCullMargin(layer) {
  const settings = currentSettings;
  return layer === 'ground' ? settings.cullMarginGround : settings.cullMarginCanopy;
}

/**
 * Get max item limits for scatter generation
 * @param {string} category - 'tree', 'brush', 'floor', 'particle', or 'total'
 * @returns {number} Maximum items allowed for this category
 */
export function getMaxItems(category) {
  const maxItems = currentSettings.maxItems;
  if (!maxItems) return Infinity;
  return maxItems[category] ?? Infinity;
}

/**
 * Check if a category has reached its item limit
 * @param {number} currentCount - Current item count for this category
 * @param {string} category - 'tree', 'brush', 'floor', 'particle'
 * @returns {boolean} Whether more items can be added
 */
export function canAddMoreItems(currentCount, category) {
  return currentCount < getMaxItems(category);
}

// ═══════════════════════════════════════════════════════════════
// Persistence
// ═══════════════════════════════════════════════════════════════

const STORAGE_KEY = 'terrainEditor.qualityPreset';

/**
 * Save current quality preset to localStorage
 */
export function saveQualityPreset() {
  try {
    localStorage.setItem(STORAGE_KEY, currentPreset);
  } catch (e) {
    console.warn('[LOD] Failed to save preset:', e);
  }
}

/**
 * Load quality preset from localStorage
 * @returns {boolean} Whether a saved preset was loaded
 */
export function loadQualityPreset() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LOD_PRESETS[saved]) {
      setQualityPreset(saved);
      return true;
    }
  } catch (e) {
    console.warn('[LOD] Failed to load preset:', e);
  }
  return false;
}

// Auto-load saved preset on module init
loadQualityPreset();
