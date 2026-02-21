// ═══════════════════════════════════════════════════════════════
// RASTERIZE - Convert strokes to grid coverage
// ═══════════════════════════════════════════════════════════════

import { createEmptyCell } from './strokes.js';
import {
  FEATURE_DEFS,
  calcStrokeCoverage,
  computeSpeedMod,
  computeCoverBonus,
  computeVisibility
} from './terrain-math.js';

/**
 * Rasterize all strokes to the grid cache
 * @param {object} terrainMap - TerrainMap object
 * @returns {object[][]} Updated grid
 */
export function rasterize(terrainMap) {
  const { strokes, gridWidth, gridHeight, cellSize } = terrainMap;

  // Create fresh grid
  const grid = [];
  for (let row = 0; row < gridHeight; row++) {
    grid[row] = [];
    for (let col = 0; col < gridWidth; col++) {
      grid[row][col] = createEmptyCell();
    }
  }

  // Accumulate stroke coverage into cells
  for (const stroke of strokes) {
    const def = FEATURE_DEFS[stroke.type];
    if (!def) continue;

    // Find cells that could be affected (bounding box optimization)
    // Multi-center strokes: expand bounds to cover all centers
    let bMinX = stroke.x - stroke.radius;
    let bMaxX = stroke.x + stroke.radius;
    let bMinY = stroke.y - stroke.radius;
    let bMaxY = stroke.y + stroke.radius;
    if (stroke.centers && stroke.centers.length > 0) {
      for (const c of stroke.centers) {
        bMinX = Math.min(bMinX, c.x - stroke.radius);
        bMaxX = Math.max(bMaxX, c.x + stroke.radius);
        bMinY = Math.min(bMinY, c.y - stroke.radius);
        bMaxY = Math.max(bMaxY, c.y + stroke.radius);
      }
    }
    const minCol = Math.max(0, Math.floor(bMinX / cellSize));
    const maxCol = Math.min(gridWidth - 1, Math.floor(bMaxX / cellSize));
    const minRow = Math.max(0, Math.floor(bMinY / cellSize));
    const maxRow = Math.min(gridHeight - 1, Math.floor(bMaxY / cellSize));

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const cellCenterX = (col + 0.5) * cellSize;
        const cellCenterY = (row + 0.5) * cellSize;

        const coverage = calcStrokeCoverage(stroke, cellCenterX, cellCenterY);
        if (coverage > 0) {
          const cell = grid[row][col];

          if (def.stackable) {
            cell[stroke.type] = (cell[stroke.type] || 0) + coverage;
          } else {
            cell[stroke.type] = Math.max(cell[stroke.type] || 0, coverage);
          }
        }
      }
    }
  }

  // Compute derived values for each cell
  for (let row = 0; row < gridHeight; row++) {
    for (let col = 0; col < gridWidth; col++) {
      const cell = grid[row][col];

      // Find dominant feature (highest coverage)
      // Water takes priority — a cell with real water IS water terrain
      let maxCov = 0;
      for (const type of Object.keys(FEATURE_DEFS)) {
        if ((cell[type] || 0) > maxCov) {
          maxCov = cell[type];
          cell.dominant = type;
        }
      }
      if ((cell.water || 0) >= 0.3) {
        cell.dominant = 'water';
      }

      // Compute gameplay values
      const coverage = {
        forest: cell.forest || 0,
        brush: cell.brush || 0,
        water: cell.water || 0
      };

      cell.speedMod = computeSpeedMod(coverage);
      cell.coverBonus = computeCoverBonus(coverage);
      cell.visibility = computeVisibility(coverage);
      cell.isBlocked = cell.speedMod === 0;
    }
  }

  // Bridge override: mark cells under bridges as passable
  if (terrainMap.bridges?.length > 0) {
    for (const bridge of terrainMap.bridges) {
      const { x, y, width: bw, length: bl, dirX, dirY } = bridge;
      const halfLen = bl / 2;
      const halfW = bw / 2;
      // Walk along bridge, mark cells as passable
      const steps = Math.ceil(bl / (cellSize * 0.5));
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) - 0.5; // -0.5 to 0.5
        const px = x + dirX * t * bl;
        const py = y + dirY * t * bl;
        // Mark a strip of cells across the bridge width
        const perpX = -dirY;
        const perpY = dirX;
        for (let w = -halfW; w <= halfW; w += cellSize * 0.5) {
          const cx = px + perpX * w;
          const cy = py + perpY * w;
          const col = Math.floor(cx / cellSize);
          const row = Math.floor(cy / cellSize);
          if (row >= 0 && row < gridHeight && col >= 0 && col < gridWidth) {
            const cell = grid[row][col];
            cell.isBlocked = false;
            cell.isBridge = true;
            cell.dominant = 'open';
            cell.speedMod = Math.max(cell.speedMod, 0.9);
            cell.water = 0; // Clear water so getWaterDepth returns null
          }
        }
      }
    }
  }

  terrainMap.grid = grid;
  terrainMap.dirty = false;
  terrainMap.version++;

  return grid;
}

/**
 * Ensure grid is up-to-date (rasterize if dirty)
 * @param {object} terrainMap - TerrainMap object
 * @returns {object[][]} Grid
 */
export function ensureRasterized(terrainMap) {
  if (terrainMap.dirty || !terrainMap.grid || terrainMap.grid.length === 0) {
    rasterize(terrainMap);
  }
  return terrainMap.grid;
}
