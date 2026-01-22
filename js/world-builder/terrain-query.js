// ═══════════════════════════════════════════════════════════════
// TERRAIN QUERY - Query functions for stroke-based terrain
// Replaces legacy grid-only queries with coverage-aware lookups
// ═══════════════════════════════════════════════════════════════

import { ensureRasterized } from './rasterize.js';
import { FEATURE_DEFS } from './strokes.js';

/**
 * Get cell at world position
 * @param {object} terrainMap - TerrainMap object
 * @param {number} x - World X coordinate
 * @param {number} y - World Y coordinate
 * @returns {object|null} Cell object or null if out of bounds
 */
function getCellAt(terrainMap, x, y) {
  ensureRasterized(terrainMap);

  const col = Math.floor(x / terrainMap.cellSize);
  const row = Math.floor(y / terrainMap.cellSize);

  if (row < 0 || row >= terrainMap.gridHeight ||
      col < 0 || col >= terrainMap.gridWidth) {
    return null;
  }

  return terrainMap.grid[row]?.[col] || null;
}

/**
 * Get dominant terrain type at position
 * Backwards compatible with legacy getTerrainAt()
 * @param {object} terrainMap - TerrainMap object
 * @param {number} x - World X coordinate
 * @param {number} y - World Y coordinate
 * @returns {string} Terrain type ('forest', 'brush', 'water', 'open')
 */
export function getTerrainAt(terrainMap, x, y) {
  const cell = getCellAt(terrainMap, x, y);
  if (!cell) return 'open';
  return cell.dominant || 'open';
}

/**
 * Get speed modifier at position
 * Backwards compatible with legacy getTerrainSpeedMod()
 * @param {object} terrainMap - TerrainMap object
 * @param {number} x - World X coordinate
 * @param {number} y - World Y coordinate
 * @returns {number} Speed multiplier (0.0 = blocked, 1.0 = full speed)
 */
export function getTerrainSpeedMod(terrainMap, x, y) {
  const cell = getCellAt(terrainMap, x, y);
  if (!cell) return 1.0;
  return cell.speedMod;
}

/**
 * Check if terrain is impassable at position
 * Backwards compatible with legacy isTerrainBlocked()
 * @param {object} terrainMap - TerrainMap object
 * @param {number} x - World X coordinate
 * @param {number} y - World Y coordinate
 * @returns {boolean} True if blocked
 */
export function isTerrainBlocked(terrainMap, x, y) {
  const cell = getCellAt(terrainMap, x, y);
  if (!cell) return false;
  return cell.isBlocked;
}

/**
 * Get cover/defense bonus at position
 * @param {object} terrainMap - TerrainMap object
 * @param {number} x - World X coordinate
 * @param {number} y - World Y coordinate
 * @returns {number} Defense bonus (0.0 - 0.25 typically)
 */
export function getCoverBonus(terrainMap, x, y) {
  const cell = getCellAt(terrainMap, x, y);
  if (!cell) return 0;
  return cell.coverBonus;
}

/**
 * Get visibility multiplier at position
 * @param {object} terrainMap - TerrainMap object
 * @param {number} x - World X coordinate
 * @param {number} y - World Y coordinate
 * @returns {number} Visibility (0.0 = hidden, 1.0 = fully visible)
 */
export function getVisibility(terrainMap, x, y) {
  const cell = getCellAt(terrainMap, x, y);
  if (!cell) return 1.0;
  return cell.visibility;
}

/**
 * Get feature coverage at position
 * @param {object} terrainMap - TerrainMap object
 * @param {number} x - World X coordinate
 * @param {number} y - World Y coordinate
 * @param {string} featureType - Feature type to check
 * @returns {number} Coverage (0.0 - 1.0+)
 */
export function getFeatureCoverage(terrainMap, x, y, featureType) {
  const cell = getCellAt(terrainMap, x, y);
  if (!cell) return 0;
  return cell[featureType] || 0;
}

/**
 * Check if position is concealed (in forest or dense brush)
 * @param {object} terrainMap - TerrainMap object
 * @param {number} x - World X coordinate
 * @param {number} y - World Y coordinate
 * @returns {boolean} True if concealed
 */
export function isConcealed(terrainMap, x, y) {
  const cell = getCellAt(terrainMap, x, y);
  if (!cell) return false;

  const forestDef = FEATURE_DEFS.forest;
  const brushDef = FEATURE_DEFS.brush;

  return (cell.forest >= forestDef.minCoverageForEffect) ||
         (cell.brush >= brushDef.minCoverageForEffect * 2); // Need more brush for concealment
}

/**
 * Check if position is in cover (any defensive terrain)
 * Backwards compatible with legacy isInCover()
 * @param {object} terrainMap - TerrainMap object
 * @param {number} x - World X coordinate
 * @param {number} y - World Y coordinate
 * @returns {boolean} True if in cover
 */
export function isInCover(terrainMap, x, y) {
  const cell = getCellAt(terrainMap, x, y);
  if (!cell) return false;
  return cell.coverBonus > 0;
}

/**
 * Check if position is in canopy (forest/brush overhead)
 * Used for rendering canopy layer
 * @param {object} terrainMap - TerrainMap object
 * @param {number} x - World X coordinate
 * @param {number} y - World Y coordinate
 * @returns {boolean} True if under canopy
 */
export function isUnderCanopy(terrainMap, x, y) {
  const cell = getCellAt(terrainMap, x, y);
  if (!cell) return false;

  for (const [type, def] of Object.entries(FEATURE_DEFS)) {
    if (def.isCanopy && (cell[type] || 0) >= def.minCoverageForEffect) {
      return true;
    }
  }
  return false;
}

/**
 * Get all coverage data at position
 * @param {object} terrainMap - TerrainMap object
 * @param {number} x - World X coordinate
 * @param {number} y - World Y coordinate
 * @returns {object} Full cell data or default values
 */
export function getCellData(terrainMap, x, y) {
  const cell = getCellAt(terrainMap, x, y);
  if (!cell) {
    return {
      forest: 0,
      brush: 0,
      water: 0,
      dominant: null,
      speedMod: 1.0,
      coverBonus: 0,
      visibility: 1.0,
      isBlocked: false
    };
  }
  return { ...cell };
}

/**
 * Get grid coordinates from world position
 * @param {object} terrainMap - TerrainMap object
 * @param {number} x - World X coordinate
 * @param {number} y - World Y coordinate
 * @returns {object} { row, col } or null if out of bounds
 */
export function getGridCoords(terrainMap, x, y) {
  const col = Math.floor(x / terrainMap.cellSize);
  const row = Math.floor(y / terrainMap.cellSize);

  if (row < 0 || row >= terrainMap.gridHeight ||
      col < 0 || col >= terrainMap.gridWidth) {
    return null;
  }

  return { row, col };
}
