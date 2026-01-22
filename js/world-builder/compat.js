// ═══════════════════════════════════════════════════════════════
// COMPAT - Backwards compatibility for legacy terrain format
// ═══════════════════════════════════════════════════════════════

import { createTerrainMap, createEmptyCell, FEATURE_DEFS } from './strokes.js';
import { ensureRasterized } from './rasterize.js';

/**
 * Convert legacy 2D string array to TerrainMap
 * Used for loading old campaign/battle terrain
 * @param {string[][]} legacyTerrain - 2D array of terrain type strings
 * @param {number} cellSize - Cell size in pixels
 * @returns {object} TerrainMap object
 */
export function legacyToTerrainMap(legacyTerrain, cellSize = 64) {
  const gridHeight = legacyTerrain.length;
  const gridWidth = legacyTerrain[0]?.length || 0;

  const terrainMap = createTerrainMap(gridWidth, gridHeight, cellSize, 'grass');

  // Build grid directly from legacy data (no strokes)
  terrainMap.grid = [];
  for (let row = 0; row < gridHeight; row++) {
    terrainMap.grid[row] = [];
    for (let col = 0; col < gridWidth; col++) {
      const type = legacyTerrain[row]?.[col] || 'open';
      terrainMap.grid[row][col] = createCellFromLegacyType(type);
    }
  }

  terrainMap.dirty = false;
  terrainMap.version = 1;

  return terrainMap;
}

/**
 * Create a cell with coverage based on legacy terrain type
 */
function createCellFromLegacyType(type) {
  const cell = createEmptyCell();

  switch (type) {
    case 'forest':
      cell.forest = 1.0;
      cell.dominant = 'forest';
      cell.speedMod = 0.7;
      cell.coverBonus = 0.25;
      cell.visibility = 0.5;
      break;

    case 'brush':
      cell.brush = 1.0;
      cell.dominant = 'brush';
      cell.speedMod = 0.9;
      cell.coverBonus = 0.1;
      cell.visibility = 0.8;
      break;

    case 'water':
      cell.water = 1.0;
      cell.dominant = 'water';
      cell.speedMod = 0.5;
      break;

    case 'high':
      // High ground is blocking in legacy system
      cell.dominant = 'high';
      cell.speedMod = 0;
      cell.isBlocked = true;
      break;

    case 'trench':
      cell.dominant = 'trench';
      cell.coverBonus = 0.5;
      break;

    case 'pillbox':
      cell.dominant = 'pillbox';
      cell.coverBonus = 0.75;
      break;

    case 'grass':
      cell.dominant = null; // Grass is just base terrain
      break;

    case 'open':
    default:
      cell.dominant = null;
      break;
  }

  return cell;
}

/**
 * Convert TerrainMap to legacy 2D string array
 * Used for backwards compatibility with systems expecting old format
 * @param {object} terrainMap - TerrainMap object
 * @returns {string[][]} 2D array of terrain type strings
 */
export function terrainMapToLegacy(terrainMap) {
  ensureRasterized(terrainMap);

  const legacy = [];
  for (let row = 0; row < terrainMap.gridHeight; row++) {
    legacy[row] = [];
    for (let col = 0; col < terrainMap.gridWidth; col++) {
      const cell = terrainMap.grid[row]?.[col];
      if (!cell) {
        legacy[row][col] = 'open';
      } else if (cell.dominant) {
        legacy[row][col] = cell.dominant;
      } else {
        legacy[row][col] = terrainMap.baseLayer === 'grass' ? 'grass' : 'open';
      }
    }
  }

  return legacy;
}

/**
 * Wrap a battle object to support both legacy and new terrain queries
 * @param {object} battle - Battle state object
 * @returns {object} Battle with terrainMap added if needed
 */
export function wrapBattleForTerrain(battle) {
  // If battle already has terrainMap, use it
  if (battle.terrainMap) {
    return battle;
  }

  // Convert legacy terrain array to TerrainMap
  if (battle.terrain && Array.isArray(battle.terrain) && Array.isArray(battle.terrain[0])) {
    battle.terrainMap = legacyToTerrainMap(battle.terrain, battle.cellSize || 64);
  }

  return battle;
}

/**
 * Create terrain query functions bound to a specific battle
 * For easy drop-in replacement of legacy queries
 * @param {object} battle - Battle state object
 * @returns {object} Object with query functions
 */
export function createBattleTerrainQueries(battle) {
  wrapBattleForTerrain(battle);

  return {
    getTerrainAt: (x, y) => {
      const cell = getCellAtPosition(battle.terrainMap, x, y);
      return cell?.dominant || 'open';
    },

    getTerrainSpeedMod: (x, y) => {
      const cell = getCellAtPosition(battle.terrainMap, x, y);
      return cell?.speedMod ?? 1.0;
    },

    isTerrainBlocked: (x, y) => {
      const cell = getCellAtPosition(battle.terrainMap, x, y);
      return cell?.isBlocked ?? false;
    },

    getCoverBonus: (x, y) => {
      const cell = getCellAtPosition(battle.terrainMap, x, y);
      return cell?.coverBonus ?? 0;
    },

    isInCover: (x, y) => {
      const cell = getCellAtPosition(battle.terrainMap, x, y);
      return (cell?.coverBonus ?? 0) > 0;
    }
  };
}

/**
 * Get cell at position (internal helper)
 */
function getCellAtPosition(terrainMap, x, y) {
  if (!terrainMap || !terrainMap.grid) return null;

  const col = Math.floor(x / terrainMap.cellSize);
  const row = Math.floor(y / terrainMap.cellSize);

  if (row < 0 || row >= terrainMap.gridHeight ||
      col < 0 || col >= terrainMap.gridWidth) {
    return null;
  }

  return terrainMap.grid[row]?.[col] || null;
}

/**
 * Export terrain map to JSON for saving
 * @param {object} terrainMap - TerrainMap object
 * @returns {string} JSON string
 */
export function exportTerrainMap(terrainMap) {
  return JSON.stringify({
    version: 1,
    baseLayer: terrainMap.baseLayer,
    strokes: terrainMap.strokes,
    gridWidth: terrainMap.gridWidth,
    gridHeight: terrainMap.gridHeight,
    cellSize: terrainMap.cellSize
  });
}

/**
 * Import terrain map from JSON
 * @param {string} json - JSON string
 * @returns {object} TerrainMap object
 */
export function importTerrainMap(json) {
  const data = JSON.parse(json);

  const terrainMap = createTerrainMap(
    data.gridWidth || 24,
    data.gridHeight || 24,
    data.cellSize || 64,
    data.baseLayer || 'grass'
  );

  terrainMap.strokes = data.strokes || [];
  terrainMap.dirty = true;

  return terrainMap;
}
