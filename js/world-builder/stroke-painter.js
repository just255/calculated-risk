// ═══════════════════════════════════════════════════════════════
// STROKE PAINTER - Functions for adding/removing terrain strokes
// ═══════════════════════════════════════════════════════════════

import { createStroke, FEATURE_DEFS, TREE_TYPES } from './strokes.js';

/**
 * Add a stroke to the terrain map
 * @param {object} terrainMap - TerrainMap object
 * @param {object} stroke - Stroke object to add
 * @returns {string} Stroke ID
 */
export function addStroke(terrainMap, stroke) {
  stroke.id = stroke.id || `stroke_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  stroke.timestamp = stroke.timestamp || Date.now();
  terrainMap.strokes.push(stroke);
  terrainMap.dirty = true;
  return stroke.id;
}

/**
 * Remove a stroke by ID
 * @param {object} terrainMap - TerrainMap object
 * @param {string} strokeId - ID of stroke to remove
 * @returns {boolean} True if stroke was removed
 */
export function removeStroke(terrainMap, strokeId) {
  const idx = terrainMap.strokes.findIndex(s => s.id === strokeId);
  if (idx >= 0) {
    terrainMap.strokes.splice(idx, 1);
    terrainMap.dirty = true;
    return true;
  }
  return false;
}

/**
 * Paint a feature at position (convenience function)
 * @param {object} terrainMap - TerrainMap object
 * @param {string} type - Feature type (forest, brush, water)
 * @param {number} x - World X coordinate
 * @param {number} y - World Y coordinate
 * @param {number} radius - Brush radius
 * @param {object} options - Optional: intensity, falloff, seed
 * @returns {string} Stroke ID
 */
export function paint(terrainMap, type, x, y, radius, options = {}) {
  if (!FEATURE_DEFS[type]) {
    console.warn(`Unknown feature type: ${type}`);
    return null;
  }

  const stroke = createStroke(type, x, y, radius, options);
  return addStroke(terrainMap, stroke);
}

/**
 * Paint trees at position (convenience function for tree-based forest strokes)
 * @param {object} terrainMap - TerrainMap object
 * @param {string} treeType - Tree type (oak, pine, birch, willow, dead)
 * @param {number} x - World X coordinate
 * @param {number} y - World Y coordinate
 * @param {number} radius - Brush radius
 * @param {object} options - Optional: density, minAge, maxAge, intensity, falloff, seed
 * @returns {string} Stroke ID
 */
export function paintTrees(terrainMap, treeType, x, y, radius, options = {}) {
  if (!TREE_TYPES[treeType]) {
    console.warn(`Unknown tree type: ${treeType}`);
    return null;
  }

  const stroke = createStroke('forest', x, y, radius, {
    ...options,
    treeType,
    density: options.density ?? 5,
    minAge: options.minAge ?? 'young',
    maxAge: options.maxAge ?? 'old'
  });

  return addStroke(terrainMap, stroke);
}

/**
 * Erase strokes at position
 * Removes strokes whose center is within eraseRadius of position
 * @param {object} terrainMap - TerrainMap object
 * @param {number} x - World X coordinate
 * @param {number} y - World Y coordinate
 * @param {number} eraseRadius - Radius to check for stroke centers
 * @returns {string[]} Array of removed stroke IDs
 */
export function erase(terrainMap, x, y, eraseRadius) {
  const removed = [];
  terrainMap.strokes = terrainMap.strokes.filter(s => {
    const dist = Math.hypot(s.x - x, s.y - y);
    if (dist <= eraseRadius) {
      removed.push(s.id);
      return false;
    }
    return true;
  });

  if (removed.length > 0) {
    terrainMap.dirty = true;
  }
  return removed;
}

/**
 * Erase strokes of a specific type at position
 * @param {object} terrainMap - TerrainMap object
 * @param {string} type - Feature type to erase
 * @param {number} x - World X coordinate
 * @param {number} y - World Y coordinate
 * @param {number} eraseRadius - Radius to check
 * @returns {string[]} Array of removed stroke IDs
 */
export function eraseType(terrainMap, type, x, y, eraseRadius) {
  const removed = [];
  terrainMap.strokes = terrainMap.strokes.filter(s => {
    if (s.type !== type) return true;

    const dist = Math.hypot(s.x - x, s.y - y);
    if (dist <= eraseRadius) {
      removed.push(s.id);
      return false;
    }
    return true;
  });

  if (removed.length > 0) {
    terrainMap.dirty = true;
  }
  return removed;
}

/**
 * Clear all strokes from terrain map
 * @param {object} terrainMap - TerrainMap object
 */
export function clearStrokes(terrainMap) {
  terrainMap.strokes = [];
  terrainMap.dirty = true;
}

/**
 * Clear strokes of a specific type
 * @param {object} terrainMap - TerrainMap object
 * @param {string} type - Feature type to clear
 */
export function clearStrokesByType(terrainMap, type) {
  const before = terrainMap.strokes.length;
  terrainMap.strokes = terrainMap.strokes.filter(s => s.type !== type);
  if (terrainMap.strokes.length !== before) {
    terrainMap.dirty = true;
  }
}

/**
 * Get all strokes at a position (for selection/editing)
 * @param {object} terrainMap - TerrainMap object
 * @param {number} x - World X coordinate
 * @param {number} y - World Y coordinate
 * @returns {object[]} Array of strokes that cover this position
 */
export function getStrokesAt(terrainMap, x, y) {
  return terrainMap.strokes.filter(s => {
    const dist = Math.hypot(s.x - x, s.y - y);
    return dist <= s.radius;
  });
}

/**
 * Get stroke by ID
 * @param {object} terrainMap - TerrainMap object
 * @param {string} strokeId - Stroke ID
 * @returns {object|null} Stroke object or null
 */
export function getStrokeById(terrainMap, strokeId) {
  return terrainMap.strokes.find(s => s.id === strokeId) || null;
}

/**
 * Update a stroke's properties
 * @param {object} terrainMap - TerrainMap object
 * @param {string} strokeId - Stroke ID
 * @param {object} updates - Properties to update
 * @returns {boolean} True if stroke was updated
 */
export function updateStroke(terrainMap, strokeId, updates) {
  const stroke = getStrokeById(terrainMap, strokeId);
  if (!stroke) return false;

  Object.assign(stroke, updates);
  terrainMap.dirty = true;
  return true;
}
