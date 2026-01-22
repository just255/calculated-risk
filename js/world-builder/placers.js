// ═══════════════════════════════════════════════════════════════
// PLACERS - Modular terrain feature placement functions
// Extracted and enhanced from existing terrain generators
// ═══════════════════════════════════════════════════════════════

/**
 * Check if coordinates are within bounds
 */
function inBounds(row, col, height, width) {
  return row >= 0 && row < height && col >= 0 && col < width;
}

/**
 * Check if terrain type can be overwritten
 * Higher priority types won't be overwritten by lower priority
 */
function canOverwrite(existing, proposed) {
  const priority = {
    'open': 0,
    'grass': 1,
    'brush': 2,
    'forest': 3,
    'trench': 4,
    'pillbox': 5,
    'water': 6,
    'high': 7
  };

  const existingPriority = priority[existing] ?? 0;
  const proposedPriority = priority[proposed] ?? 0;

  // Can only overwrite if proposed has higher or equal priority
  // Exception: water and high ground are protected
  if (existing === 'water' || existing === 'high') return false;

  return proposedPriority >= existingPriority;
}

/**
 * Place a circular/organic cluster of terrain with falloff
 * Adapted from generateZoneTerrain's placeCluster (state.js:858-873)
 *
 * @param {Object} params
 * @param {string[][]} params.terrain - 2D terrain grid (mutated)
 * @param {string} params.type - Terrain type to place
 * @param {number} params.row - Cluster center row
 * @param {number} params.col - Cluster center column
 * @param {number} params.size - Radius of cluster
 * @param {Object} params.rng - RNG helper object
 * @param {number} [params.density=0.7] - Base placement chance (0-1)
 * @param {string} [params.edgeType] - Optional type for cluster edges (e.g., brush around forest)
 * @param {Object} params.bounds - { height, width }
 * @param {Object} [params.zone] - Optional { startRow, endRow } restriction
 */
export function placeCluster({
  terrain,
  type,
  row,
  col,
  size,
  rng,
  density = 0.7,
  edgeType = null,
  bounds,
  zone = null
}) {
  const { height, width } = bounds;
  const edgeSize = edgeType ? size + 1 : size;

  for (let dr = -edgeSize; dr <= edgeSize; dr++) {
    for (let dc = -edgeSize; dc <= edgeSize; dc++) {
      const r = row + dr;
      const c = col + dc;

      if (!inBounds(r, c, height, width)) continue;
      if (zone && (r < zone.startRow || r >= zone.endRow)) continue;

      const dist = Math.sqrt(dr * dr + dc * dc);
      const isEdge = edgeType && dist > size && dist <= edgeSize;
      const falloff = 1 - (dist / (edgeSize + 1));

      if (rng.chance(density * falloff)) {
        const currentType = terrain[r][c];
        const targetType = isEdge ? edgeType : type;

        if (canOverwrite(currentType, targetType)) {
          terrain[r][c] = targetType;
        }
      }
    }
  }
}

/**
 * Place a linear feature (ridge, trench line, etc.)
 *
 * @param {Object} params
 * @param {string[][]} params.terrain - 2D terrain grid (mutated)
 * @param {string} params.type - Terrain type to place
 * @param {number} params.row - Start row
 * @param {number} params.col - Start column
 * @param {number} params.length - Length of line
 * @param {string} [params.direction='horizontal'] - 'horizontal' | 'vertical'
 * @param {Object} params.rng - RNG helper
 * @param {Object} params.bounds - { height, width }
 * @param {Object} [params.gap] - Optional { start, end } for gap in line
 * @param {boolean} [params.natural=false] - Add natural variation (for ridges)
 */
export function placeLine({
  terrain,
  type,
  row,
  col,
  length,
  direction = 'horizontal',
  rng,
  bounds,
  gap = null,
  natural = false
}) {
  const { height, width } = bounds;
  const isHorizontal = direction === 'horizontal';

  for (let i = 0; i < length; i++) {
    // Skip gap
    if (gap && i >= gap.start && i < gap.end) continue;

    const r = isHorizontal ? row : row + i;
    const c = isHorizontal ? col + i : col;

    if (!inBounds(r, c, height, width)) continue;

    const current = terrain[r][c];
    if (canOverwrite(current, type)) {
      terrain[r][c] = type;
    }

    // Natural variation for ridges - extend up/down randomly
    if (natural && type === 'high') {
      if (rng.chance(0.5) && inBounds(r - 1, c, height, width)) {
        if (canOverwrite(terrain[r - 1][c], type)) {
          terrain[r - 1][c] = type;
        }
      }
      if (rng.chance(0.3) && inBounds(r + 1, c, height, width)) {
        if (canOverwrite(terrain[r + 1][c], type)) {
          terrain[r + 1][c] = type;
        }
      }
    }
  }
}

/**
 * Place a river with crossing points
 *
 * @param {Object} params
 * @param {string[][]} params.terrain - 2D terrain grid (mutated)
 * @param {number} params.row - River row
 * @param {number} params.startCol - Start column
 * @param {number} params.endCol - End column
 * @param {Object} params.rng - RNG helper
 * @param {Object} params.bounds - { height, width }
 * @param {number} [params.crossings=1] - Number of crossing points
 */
export function placeRiver({
  terrain,
  row,
  startCol,
  endCol,
  rng,
  bounds,
  crossings = 1
}) {
  const { height, width } = bounds;
  const riverLength = endCol - startCol;

  // Generate crossing gaps
  const gaps = [];
  for (let i = 0; i < crossings; i++) {
    const gapStart = Math.floor(riverLength / (crossings + 1)) * (i + 1);
    const gapWidth = 2 + rng.int(0, 2);
    gaps.push({ start: startCol + gapStart, end: startCol + gapStart + gapWidth });
  }

  for (let c = startCol; c < endCol; c++) {
    if (!inBounds(row, c, height, width)) continue;

    // Check if in a crossing
    const inCrossing = gaps.some(g => c >= g.start && c < g.end);
    if (inCrossing) continue;

    const current = terrain[row][c];
    // Don't place water on high ground
    if (current !== 'high') {
      terrain[row][c] = 'water';
    }
  }
}

/**
 * Place a fortification (trench line + pillbox)
 *
 * @param {Object} params
 * @param {string[][]} params.terrain - 2D terrain grid (mutated)
 * @param {number} params.row - Trench row
 * @param {number} params.col - Start column
 * @param {number} params.length - Trench length
 * @param {Object} params.rng - RNG helper
 * @param {Object} params.bounds - { height, width }
 * @param {boolean} [params.includePillbox=true] - Add pillbox
 * @param {number} [params.pillboxOffset=1] - Row offset for pillbox (positive = below, negative = above)
 */
export function placeFortification({
  terrain,
  row,
  col,
  length,
  rng,
  bounds,
  includePillbox = true,
  pillboxOffset = 1
}) {
  const { height, width } = bounds;

  // Place trench line
  placeLine({
    terrain,
    type: 'trench',
    row,
    col,
    length,
    direction: 'horizontal',
    rng,
    bounds
  });

  // Place pillbox near center
  if (includePillbox) {
    const pillboxCol = col + Math.floor(length / 2);
    const pillboxRow = row + pillboxOffset;

    if (inBounds(pillboxRow, pillboxCol, height, width)) {
      const current = terrain[pillboxRow][pillboxCol];
      if (current !== 'water' && current !== 'high') {
        terrain[pillboxRow][pillboxCol] = 'pillbox';
      }
    }
  }
}

/**
 * Fill area with base terrain (grass scatter on open)
 *
 * @param {Object} params
 * @param {string[][]} params.terrain - 2D terrain grid (mutated)
 * @param {string} [params.baseType='open'] - Primary terrain type
 * @param {string} [params.scatterType='grass'] - Secondary terrain type
 * @param {number} [params.scatterChance=0.5] - Chance for scatter type
 * @param {Object} params.rng - RNG helper
 * @param {Object} params.bounds - { height, width }
 * @param {Object} [params.zone] - Optional { startRow, endRow } restriction
 */
export function fillBase({
  terrain,
  baseType = 'open',
  scatterType = 'grass',
  scatterChance = 0.5,
  rng,
  bounds,
  zone = null
}) {
  const { height, width } = bounds;
  const startRow = zone?.startRow ?? 0;
  const endRow = zone?.endRow ?? height;

  for (let r = startRow; r < endRow; r++) {
    for (let c = 0; c < width; c++) {
      terrain[r][c] = rng.chance(scatterChance) ? scatterType : baseType;
    }
  }
}

/**
 * Blend edges with previous zone terrain
 *
 * @param {Object} params
 * @param {string[][]} params.terrain - 2D terrain grid (mutated)
 * @param {string[][]} params.previousEdge - Previous zone's edge rows
 * @param {number} [params.blendRows=2] - Number of rows to blend
 * @param {number} [params.blendChance=0.7] - Chance to inherit from previous
 * @param {Object} params.rng - RNG helper
 * @param {Object} params.bounds - { height, width }
 */
export function blendEdge({
  terrain,
  previousEdge,
  blendRows = 2,
  blendChance = 0.7,
  rng,
  bounds
}) {
  if (!previousEdge) return;

  const { width } = bounds;

  for (let r = 0; r < Math.min(blendRows, terrain.length); r++) {
    const sourceRow = previousEdge[previousEdge.length - blendRows + r];
    if (!sourceRow) continue;

    for (let c = 0; c < width; c++) {
      if (rng.chance(blendChance) && sourceRow[c]) {
        terrain[r][c] = sourceRow[c];
      }
    }
  }
}

/**
 * Place a single point feature (pillbox, obstacle)
 *
 * @param {Object} params
 * @param {string[][]} params.terrain - 2D terrain grid (mutated)
 * @param {string} params.type - Terrain type to place
 * @param {number} params.row - Row
 * @param {number} params.col - Column
 * @param {Object} params.bounds - { height, width }
 * @param {boolean} [params.extend=false] - Extend to adjacent cell
 * @param {Object} [params.rng] - RNG helper (required if extend=true)
 */
export function placePoint({
  terrain,
  type,
  row,
  col,
  bounds,
  extend = false,
  rng = null
}) {
  const { height, width } = bounds;

  if (!inBounds(row, col, height, width)) return;

  const current = terrain[row][col];
  if (current !== 'water' && current !== 'high') {
    terrain[row][col] = type;
  }

  // Optionally extend to adjacent cell
  if (extend && rng && rng.chance(0.5)) {
    const extendCol = col + 1;
    if (inBounds(row, extendCol, height, width)) {
      const extendCurrent = terrain[row][extendCol];
      if (extendCurrent !== 'water' && extendCurrent !== 'high') {
        terrain[row][extendCol] = type;
      }
    }
  }
}
