// Skins Module - Manage unit variants/skins for players
// Handles loading, selecting, and rendering custom unit appearances

import { renderShapesToCanvas } from './sprite-parser.js';

// Cache for loaded variants
let variantsCache = null;
let variantDataCache = new Map();

// Player's skin preferences (stored in localStorage)
const PREFS_KEY = 'calculatedRisk_skinPrefs';

/**
 * Load all available variants from server
 * @returns {Promise<Array>} Array of variant metadata
 */
export async function loadVariants() {
  if (variantsCache) {
    return variantsCache;
  }

  try {
    const res = await fetch('/api/variants');
    const data = await res.json();
    variantsCache = data.variants || [];
    return variantsCache;
  } catch (err) {
    console.warn('Failed to load variants:', err);
    variantsCache = [];
    return [];
  }
}

/**
 * Get variants for a specific unit/terrain type
 * @param {string} objectType - 'unit' or 'terrain'
 * @param {string} objectId - The object ID (e.g., 'infantry', 'abrams')
 * @returns {Promise<Array>} Array of variants for this object
 */
export async function getVariantsFor(objectType, objectId) {
  const variants = await loadVariants();
  return variants.filter(v => v.objectType === objectType && v.objectId === objectId);
}

/**
 * Load full variant data (including frames/parts)
 * @param {string} variantId - The variant ID
 * @returns {Promise<Object|null>} Variant data or null
 */
export async function loadVariantData(variantId) {
  if (variantDataCache.has(variantId)) {
    return variantDataCache.get(variantId);
  }

  try {
    const res = await fetch(`/api/variants/${variantId}`);
    if (!res.ok) return null;

    const data = await res.json();
    variantDataCache.set(variantId, data);
    return data;
  } catch (err) {
    console.warn(`Failed to load variant ${variantId}:`, err);
    return null;
  }
}

/**
 * Get player's skin preferences from localStorage
 * @returns {Object} Map of objectId -> variantId
 */
export function getSkinPrefs() {
  try {
    const stored = localStorage.getItem(PREFS_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

/**
 * Save skin preference for a unit
 * @param {string} objectId - The unit/terrain ID
 * @param {string} variantId - The variant ID (or 'default' for base sprite)
 */
export function setSkinPref(objectId, variantId) {
  const prefs = getSkinPrefs();
  if (variantId === 'default') {
    delete prefs[objectId];
  } else {
    prefs[objectId] = variantId;
  }
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

/**
 * Get active skin ID for a unit
 * @param {string} objectId - The unit ID
 * @returns {string} Variant ID or 'default'
 */
export function getActiveSkin(objectId) {
  const prefs = getSkinPrefs();
  return prefs[objectId] || 'default';
}

/**
 * Check if a variant exists and is not archived
 * @param {string} variantId - The variant ID
 * @returns {Promise<boolean>}
 */
export async function variantExists(variantId) {
  const variants = await loadVariants();
  return variants.some(v => v.id === variantId && !v.archived);
}

/**
 * Get rendering data for a unit (with fallback to default)
 * @param {string} objectId - The unit ID
 * @returns {Promise<Object>} { type: 'default' | 'variant', data: ... }
 */
export async function getRenderDataForUnit(objectId) {
  const skinId = getActiveSkin(objectId);

  if (skinId === 'default') {
    return { type: 'default', data: null };
  }

  // Check if variant exists
  const exists = await variantExists(skinId);
  if (!exists) {
    console.warn(`Variant ${skinId} not found, falling back to default`);
    setSkinPref(objectId, 'default');
    return { type: 'default', data: null };
  }

  // Load variant data
  const variantData = await loadVariantData(skinId);
  if (!variantData) {
    console.warn(`Failed to load variant ${skinId}, falling back to default`);
    setSkinPref(objectId, 'default');
    return { type: 'default', data: null };
  }

  return { type: 'variant', data: variantData };
}

/**
 * Render a variant to a canvas
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} variantData - Loaded variant data
 * @param {number} frameIndex - Animation frame index (default 0)
 */
export function renderVariant(ctx, variantData, frameIndex = 0) {
  if (!variantData || !variantData.data || !variantData.data.parts) {
    return;
  }

  const parts = variantData.data.parts;

  // Render each part in z-order
  const sortedParts = Object.entries(parts)
    .sort((a, b) => (a[1].zIndex || 0) - (b[1].zIndex || 0));

  for (const [partName, part] of sortedParts) {
    if (!part.frames || part.frames.length === 0) continue;

    // Get the appropriate frame
    const frame = part.frames[frameIndex % part.frames.length];
    if (!frame || !frame.shapes) continue;

    ctx.save();

    // Apply offset
    if (part.offset) {
      ctx.translate(part.offset.x || 0, part.offset.y || 0);
    }

    // Render shapes
    renderShapesToCanvas(ctx, frame.shapes);

    ctx.restore();
  }
}

/**
 * Create a preview canvas for a variant
 * @param {Object} variantData - Loaded variant data
 * @param {number} size - Canvas size in pixels
 * @returns {HTMLCanvasElement}
 */
export function createVariantPreview(variantData, size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (variantData && variantData.data) {
    const scale = size / Math.max(
      variantData.data.canvasWidth || 64,
      variantData.data.canvasHeight || 64
    );
    ctx.scale(scale, scale);
    renderVariant(ctx, variantData, 0);
  }

  return canvas;
}

/**
 * Clear variant caches (useful after editor updates)
 */
export function clearCache() {
  variantsCache = null;
  variantDataCache.clear();
}

/**
 * Get skin selector UI data for settings page
 * @returns {Promise<Array>} Array of { id, name, variants: [...] }
 */
export async function getSkinSelectorData() {
  // List of units that can have skins
  const units = [
    { id: 'infantry', name: 'Infantry' },
    { id: 'medic', name: 'Medic' },
    { id: 'specops', name: 'Spec Ops' },
    { id: 'stinger', name: 'Stinger' },
    { id: 'jeep', name: 'Jeep' },
    { id: 'humvee', name: 'Humvee' },
    { id: 'sherman', name: 'Sherman' },
    { id: 'tiger', name: 'Tiger' },
    { id: 'abrams', name: 'M1 Abrams' },
    { id: 'howitzer', name: 'Howitzer' },
    { id: 'drone', name: 'Drone' },
    { id: 'helicopter', name: 'Helicopter' }
  ];

  const allVariants = await loadVariants();
  const prefs = getSkinPrefs();

  return units.map(unit => {
    const unitVariants = allVariants.filter(
      v => v.objectType === 'unit' && v.objectId === unit.id
    );

    return {
      id: unit.id,
      name: unit.name,
      selectedSkin: prefs[unit.id] || 'default',
      variants: [
        { id: 'default', name: 'Default' },
        ...unitVariants.map(v => ({ id: v.id, name: v.name, author: v.author }))
      ]
    };
  });
}
