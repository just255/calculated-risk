// ═══════════════════════════════════════════════════════════════
// LOD (Level of Detail) System
// Centralized quality/performance configuration
// ═══════════════════════════════════════════════════════════════

/**
 * Default sprite size in pixels (most sprites are 256x256)
 */
export const BASE_SPRITE_SIZE = 256;

/**
 * Quality presets for different performance/quality tradeoffs
 *
 * minPixels: Minimum rendered pixel size before an item is culled.
 * Formula: renderedSize = BASE_SPRITE_SIZE * itemScale * zoom
 * Item is visible when: renderedSize >= minPixels[category]
 */
export const LOD_PRESETS = {
  low: {
    name: 'Low',
    description: 'Best performance, reduced detail',

    // Preview canvas
    previewMaxPixels: 128 * 128,      // 16K pixels (very low for large maps)
    previewMinScale: 0.05,

    // Minimum rendered pixel size per category (higher = more aggressive culling)
    minPixels: {
      tree: 16,       // Trees stay visible longest
      brush: 20,      // Medium items
      floor: 16,      // Ground detail
      particle: 12,   // Tiny accents, hide first
    },

    // Texture quality
    textureScale: 1,                   // Always 1x
    textureScalePreview: 1,

    // Sprite resolution
    spriteScale: 0.5,                  // Half resolution sprites

    // Viewport margins
    cullMarginGround: 50,
    cullMarginCanopy: 100,

    // No item caps - rely on LOD culling for performance
    maxItems: null,
  },

  medium: {
    name: 'Medium',
    description: 'Balanced quality and performance',

    previewMaxPixels: 512 * 512,      // 256K pixels
    previewMinScale: 0.1,

    minPixels: {
      tree: 12,
      brush: 14,
      floor: 12,
      particle: 8,
    },

    textureScale: 2,
    textureScalePreview: 1,

    spriteScale: 0.75,

    cullMarginGround: 100,
    cullMarginCanopy: 150,

    // No item caps - rely on LOD culling for performance
    maxItems: null,
  },

  high: {
    name: 'High',
    description: 'High quality, good performance',

    previewMaxPixels: 1024 * 1024,    // 1M pixels
    previewMinScale: 0.15,

    minPixels: {
      tree: 8,
      brush: 10,
      floor: 8,
      particle: 5,
    },

    textureScale: 2,
    textureScalePreview: 1,

    spriteScale: 1.0,

    cullMarginGround: 100,
    cullMarginCanopy: 150,

    // No item caps - rely on LOD culling for performance
    maxItems: null,
  },

  ultra: {
    name: 'Ultra',
    description: 'Maximum quality, may impact performance',

    previewMaxPixels: 2048 * 2048,    // 4M pixels
    previewMinScale: 0.2,

    minPixels: {
      tree: 4,
      brush: 6,
      floor: 4,
      particle: 3,
    },

    textureScale: 4,
    textureScalePreview: 2,

    spriteScale: 1.0,

    cullMarginGround: 150,
    cullMarginCanopy: 200,

    // No item caps - rely on LOD culling for performance
    maxItems: null,
  }
};

// Current quality level
let currentPreset = 'high';
let currentSettings = {
  ...LOD_PRESETS.high,
  minPixels: { ...LOD_PRESETS.high.minPixels }
};

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
  // Deep copy minPixels
  if (LOD_PRESETS[preset].minPixels) {
    currentSettings.minPixels = { ...LOD_PRESETS[preset].minPixels };
  }
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

/**
 * Update a single LOD setting
 * @param {string} key - Setting key (e.g., 'previewMaxPixels' or 'maxItems.tree')
 * @param {any} value - New value
 */
export function setLODSetting(key, value) {
  if (key.startsWith('maxItems.')) {
    const subKey = key.split('.')[1];
    if (!currentSettings.maxItems) currentSettings.maxItems = {};
    currentSettings.maxItems[subKey] = value;
  } else if (key.startsWith('minPixels.')) {
    const subKey = key.split('.')[1];
    if (!currentSettings.minPixels) currentSettings.minPixels = {};
    currentSettings.minPixels[subKey] = value;
  } else {
    currentSettings[key] = value;
  }
  currentPreset = 'custom';
}

/**
 * Apply a complete settings object (for bulk updates)
 * @param {object} settings - Settings object
 */
export function applyLODSettings(settings) {
  currentSettings = { ...settings };
  if (settings.maxItems) {
    currentSettings.maxItems = { ...settings.maxItems };
  }
  if (settings.minPixels) {
    currentSettings.minPixels = { ...settings.minPixels };
  }
  currentPreset = 'custom';
}

/**
 * Reset to current preset (discards custom changes)
 */
export function resetToPreset() {
  const preset = currentPreset === 'custom' ? 'high' : currentPreset;
  currentSettings = { ...LOD_PRESETS[preset] };
  if (LOD_PRESETS[preset].maxItems) {
    currentSettings.maxItems = { ...LOD_PRESETS[preset].maxItems };
  }
  if (LOD_PRESETS[preset].minPixels) {
    currentSettings.minPixels = { ...LOD_PRESETS[preset].minPixels };
  }
  currentPreset = preset;
  return preset;
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
 * Typical/average scales for each category (used for category-level checks)
 * These represent common item scales for quick culling decisions
 */
const TYPICAL_SCALES = {
  tree: 0.4,      // Trees tend to be larger
  brush: 0.25,    // Brush is medium
  floor: 0.15,    // Floor items are smaller
  particle: 0.08, // Particles are tiny
};

/**
 * Check if a specific scatter item should render at current zoom
 * Uses pixel-size based culling: item renders if its screen size >= minPixels
 *
 * @param {object} item - Scatter item with scale property
 * @param {number} zoom - Current viewport zoom level
 * @param {string} category - Category: 'tree', 'brush', 'floor', 'particle'
 * @returns {boolean} Whether to render this item
 */
export function shouldRenderItem(item, zoom, category) {
  const settings = currentSettings;
  const minPixels = settings.minPixels?.[category];

  // No threshold set = always render
  if (!minPixels) return true;

  // Calculate rendered pixel size: spriteSize * itemScale * zoom
  const renderedSize = BASE_SPRITE_SIZE * (item.scale || TYPICAL_SCALES[category]) * zoom;

  return renderedSize >= minPixels;
}

/**
 * Check if a scatter category should render at current zoom (quick check)
 * Uses typical/average scale for the category - for fast category-level culling
 *
 * @param {number} zoom - Current viewport zoom level
 * @param {string} category - Category: 'tree', 'brush', 'floor', 'particle'
 * @returns {boolean} Whether to render this category
 */
export function shouldRenderCategory(zoom, category) {
  const settings = currentSettings;
  const minPixels = settings.minPixels?.[category];

  // No threshold set = always render
  if (!minPixels) return true;

  // Use typical scale for quick category-level check
  const typicalScale = TYPICAL_SCALES[category] || 0.2;
  const renderedSize = BASE_SPRITE_SIZE * typicalScale * zoom;

  return renderedSize >= minPixels;
}

/**
 * Get the minimum zoom at which a category becomes visible
 * Useful for UI display
 *
 * @param {string} category - Category: 'tree', 'brush', 'floor', 'particle'
 * @returns {number} Minimum zoom level (0-1) for visibility
 */
export function getCategoryMinZoom(category) {
  const settings = currentSettings;
  const minPixels = settings.minPixels?.[category];
  if (!minPixels) return 0;

  const typicalScale = TYPICAL_SCALES[category] || 0.2;
  // Solve: BASE_SPRITE_SIZE * typicalScale * zoom = minPixels
  // zoom = minPixels / (BASE_SPRITE_SIZE * typicalScale)
  return minPixels / (BASE_SPRITE_SIZE * typicalScale);
}

/**
 * Get list of categories that should render at current zoom
 * @param {number} zoom - Current viewport zoom level
 * @returns {string[]} Array of category names to render
 */
export function getVisibleCategories(zoom) {
  const categories = [];

  if (shouldRenderCategory(zoom, 'tree')) categories.push('tree');
  if (shouldRenderCategory(zoom, 'floor')) categories.push('floor');
  if (shouldRenderCategory(zoom, 'brush')) categories.push('brush');
  if (shouldRenderCategory(zoom, 'particle')) categories.push('particle');

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
const STORAGE_KEY_CUSTOM = 'terrainEditor.customLODSettings';

/**
 * Save current quality preset to localStorage
 */
export function saveQualityPreset() {
  try {
    localStorage.setItem(STORAGE_KEY, currentPreset);
    // If custom settings, also save the full settings object
    if (currentPreset === 'custom') {
      localStorage.setItem(STORAGE_KEY_CUSTOM, JSON.stringify(currentSettings));
    }
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
    if (saved === 'custom') {
      // Load custom settings
      const customSettings = localStorage.getItem(STORAGE_KEY_CUSTOM);
      if (customSettings) {
        const parsed = JSON.parse(customSettings);
        currentSettings = { ...parsed };
        if (parsed.maxItems) {
          currentSettings.maxItems = { ...parsed.maxItems };
        }
        if (parsed.minPixels) {
          currentSettings.minPixels = { ...parsed.minPixels };
        }
        currentPreset = 'custom';
        console.log('[LOD] Loaded custom settings');
        return true;
      }
    } else if (saved && LOD_PRESETS[saved]) {
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
