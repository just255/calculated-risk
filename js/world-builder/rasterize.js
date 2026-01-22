// ═══════════════════════════════════════════════════════════════
// RASTERIZE - Convert strokes to grid coverage
// ═══════════════════════════════════════════════════════════════

import { FEATURE_DEFS, FALLOFF, createEmptyCell } from './strokes.js';

/**
 * Calculate coverage contribution from a stroke to a cell center
 * @param {object} stroke - Stroke object
 * @param {number} cellCenterX - Cell center X in world coords
 * @param {number} cellCenterY - Cell center Y in world coords
 * @returns {number} Coverage value (0-1)
 */
function calcStrokeCoverage(stroke, cellCenterX, cellCenterY) {
  const dist = Math.hypot(stroke.x - cellCenterX, stroke.y - cellCenterY);

  if (dist >= stroke.radius) return 0;

  // Normalize distance (0 = center, 1 = edge)
  const normalizedDist = dist / stroke.radius;

  // Apply falloff function
  const falloffFn = FALLOFF[stroke.falloff] || FALLOFF.linear;
  const falloffMult = falloffFn(normalizedDist);

  return stroke.intensity * falloffMult;
}

/**
 * Compute combined speed modifier from coverage values
 * @param {object} coverage - Object with feature coverages
 * @returns {number} Speed multiplier (0-1)
 */
function computeSpeedMod(coverage) {
  let totalWeight = 0;
  let weightedSpeed = 0;

  for (const [type, cov] of Object.entries(coverage)) {
    if (cov <= 0 || !FEATURE_DEFS[type]) continue;

    const def = FEATURE_DEFS[type];
    const effectiveCov = Math.min(cov, 1.0);

    // Blockers override everything
    if (def.isBlocker && cov >= def.minCoverageForEffect) {
      return 0;
    }

    // Only apply effect if above threshold
    if (cov >= def.minCoverageForEffect) {
      weightedSpeed += def.speedMod * effectiveCov;
      totalWeight += effectiveCov;
    }
  }

  if (totalWeight === 0) return 1.0;

  // Blend toward base speed based on coverage
  const blendedSpeed = weightedSpeed / totalWeight;
  const coverageInfluence = Math.min(totalWeight, 1.0);

  return 1.0 * (1 - coverageInfluence) + blendedSpeed * coverageInfluence;
}

/**
 * Compute cover/defense bonus from coverage values
 * @param {object} coverage - Object with feature coverages
 * @returns {number} Defense bonus (0-1)
 */
function computeCoverBonus(coverage) {
  let maxBonus = 0;

  for (const [type, cov] of Object.entries(coverage)) {
    if (cov <= 0 || !FEATURE_DEFS[type]) continue;

    const def = FEATURE_DEFS[type];
    if (cov >= def.minCoverageForEffect) {
      // Proportional bonus based on coverage
      const bonus = def.coverBonus * Math.min(cov, 1.0);
      maxBonus = Math.max(maxBonus, bonus);
    }
  }

  return maxBonus;
}

/**
 * Compute visibility from coverage values
 * @param {object} coverage - Object with feature coverages
 * @returns {number} Visibility multiplier (0-1)
 */
function computeVisibility(coverage) {
  let minVis = 1.0;

  for (const [type, cov] of Object.entries(coverage)) {
    if (cov <= 0 || !FEATURE_DEFS[type]) continue;

    const def = FEATURE_DEFS[type];
    if (cov >= def.minCoverageForEffect) {
      // Blend visibility based on coverage
      const effectiveCov = Math.min(cov, 1.0);
      const vis = 1.0 - (1.0 - def.visibility) * effectiveCov;
      minVis = Math.min(minVis, vis);
    }
  }

  return minVis;
}

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
    const minCol = Math.max(0, Math.floor((stroke.x - stroke.radius) / cellSize));
    const maxCol = Math.min(gridWidth - 1, Math.floor((stroke.x + stroke.radius) / cellSize));
    const minRow = Math.max(0, Math.floor((stroke.y - stroke.radius) / cellSize));
    const maxRow = Math.min(gridHeight - 1, Math.floor((stroke.y + stroke.radius) / cellSize));

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
      let maxCov = 0;
      for (const type of Object.keys(FEATURE_DEFS)) {
        if ((cell[type] || 0) > maxCov) {
          maxCov = cell[type];
          cell.dominant = type;
        }
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
