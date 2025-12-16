// ═══════════════════════════════════════════════════════════════
// PATHFINDING - A* algorithm with terrain costs
// ═══════════════════════════════════════════════════════════════

// Terrain movement costs (lower = faster/preferred)
export const TERRAIN_COSTS = {
  open: 1.0,
  grass: 1.0,
  trench: 1.2,      // Slightly slower but good cover
  pillbox: 1.5,     // Slower to navigate around
  brush: 1.3,       // Some concealment
  forest: 1.8,      // Slow but good cover
  water: 3.0,       // Very slow
  high: Infinity    // Impassable (rocks/cliffs)
};

// Cover/defensive value (higher = better cover)
export const COVER_VALUES = {
  trench: 5,
  pillbox: 4,
  forest: 3,
  brush: 2,
  open: 0,
  grass: 0,
  water: 0,
  high: 0
};

// ═══════════════════════════════════════════════════════════════
// BINARY HEAP - Efficient priority queue for A*
// ═══════════════════════════════════════════════════════════════

class MinHeap {
  constructor() {
    this.heap = [];
  }

  push(node) {
    this.heap.push(node);
    this.bubbleUp(this.heap.length - 1);
  }

  pop() {
    if (this.heap.length === 0) return null;
    if (this.heap.length === 1) return this.heap.pop();

    const min = this.heap[0];
    this.heap[0] = this.heap.pop();
    this.bubbleDown(0);
    return min;
  }

  bubbleUp(idx) {
    while (idx > 0) {
      const parentIdx = Math.floor((idx - 1) / 2);
      if (this.heap[idx].f >= this.heap[parentIdx].f) break;
      [this.heap[idx], this.heap[parentIdx]] = [this.heap[parentIdx], this.heap[idx]];
      idx = parentIdx;
    }
  }

  bubbleDown(idx) {
    const length = this.heap.length;
    while (true) {
      const leftIdx = 2 * idx + 1;
      const rightIdx = 2 * idx + 2;
      let smallest = idx;

      if (leftIdx < length && this.heap[leftIdx].f < this.heap[smallest].f) {
        smallest = leftIdx;
      }
      if (rightIdx < length && this.heap[rightIdx].f < this.heap[smallest].f) {
        smallest = rightIdx;
      }
      if (smallest === idx) break;

      [this.heap[idx], this.heap[smallest]] = [this.heap[smallest], this.heap[idx]];
      idx = smallest;
    }
  }

  isEmpty() {
    return this.heap.length === 0;
  }

  // Update priority of existing node (for when we find a better path)
  updatePriority(row, col, newF, newG, newParent) {
    for (let i = 0; i < this.heap.length; i++) {
      if (this.heap[i].row === row && this.heap[i].col === col) {
        if (newG < this.heap[i].g) {
          this.heap[i].f = newF;
          this.heap[i].g = newG;
          this.heap[i].parent = newParent;
          this.bubbleUp(i);
        }
        return true;
      }
    }
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// A* PATHFINDING
// ═══════════════════════════════════════════════════════════════

// Heuristic: Manhattan distance (admissible for grid)
function heuristic(row1, col1, row2, col2) {
  return Math.abs(row1 - row2) + Math.abs(col1 - col2);
}

// Get terrain type at grid position
function getTerrainAt(terrain, row, col, gridHeight, gridWidth) {
  if (row < 0 || row >= gridHeight || col < 0 || col >= gridWidth) {
    return 'high'; // Out of bounds = impassable
  }
  return terrain[row]?.[col] || 'open';
}

// Get movement cost for terrain
function getMovementCost(terrainType) {
  return TERRAIN_COSTS[terrainType] ?? 1.0;
}

// 4-directional neighbors (no diagonal for cleaner paths)
const NEIGHBORS_4 = [
  { dr: -1, dc: 0 },  // Up
  { dr: 1, dc: 0 },   // Down
  { dr: 0, dc: -1 },  // Left
  { dr: 0, dc: 1 }    // Right
];

// 8-directional neighbors (includes diagonal)
const NEIGHBORS_8 = [
  { dr: -1, dc: 0, cost: 1.0 },   // Up
  { dr: 1, dc: 0, cost: 1.0 },    // Down
  { dr: 0, dc: -1, cost: 1.0 },   // Left
  { dr: 0, dc: 1, cost: 1.0 },    // Right
  { dr: -1, dc: -1, cost: 1.414 }, // Up-Left
  { dr: -1, dc: 1, cost: 1.414 },  // Up-Right
  { dr: 1, dc: -1, cost: 1.414 },  // Down-Left
  { dr: 1, dc: 1, cost: 1.414 }    // Down-Right
];

/**
 * Find optimal path using A* algorithm
 * @param {Object} params - Pathfinding parameters
 * @param {number[][]} params.terrain - 2D terrain grid
 * @param {number} params.startRow - Starting row
 * @param {number} params.startCol - Starting column
 * @param {number} params.endRow - Target row
 * @param {number} params.endCol - Target column
 * @param {number} params.gridHeight - Grid height
 * @param {number} params.gridWidth - Grid width
 * @param {boolean} params.allowDiagonal - Allow diagonal movement (default: true)
 * @param {number} params.maxIterations - Max iterations to prevent infinite loops (default: 1000)
 * @returns {Array<{row: number, col: number}>|null} - Path as array of cells, or null if no path
 */
export function findPath({
  terrain,
  startRow,
  startCol,
  endRow,
  endCol,
  gridHeight,
  gridWidth,
  allowDiagonal = true,
  maxIterations = 1000
}) {
  // Quick checks
  const startTerrain = getTerrainAt(terrain, startRow, startCol, gridHeight, gridWidth);
  const endTerrain = getTerrainAt(terrain, endRow, endCol, gridHeight, gridWidth);

  if (getMovementCost(startTerrain) === Infinity || getMovementCost(endTerrain) === Infinity) {
    return null; // Start or end is impassable
  }

  if (startRow === endRow && startCol === endCol) {
    return [{ row: startRow, col: startCol }]; // Already there
  }

  const neighbors = allowDiagonal ? NEIGHBORS_8 : NEIGHBORS_4;
  const openSet = new MinHeap();
  const closedSet = new Set();
  const gScores = new Map();

  const startKey = `${startRow},${startCol}`;
  const h = heuristic(startRow, startCol, endRow, endCol);

  openSet.push({
    row: startRow,
    col: startCol,
    g: 0,
    f: h,
    parent: null
  });
  gScores.set(startKey, 0);

  let iterations = 0;

  while (!openSet.isEmpty() && iterations < maxIterations) {
    iterations++;
    const current = openSet.pop();
    const currentKey = `${current.row},${current.col}`;

    // Found the goal
    if (current.row === endRow && current.col === endCol) {
      return reconstructPath(current);
    }

    closedSet.add(currentKey);

    // Explore neighbors
    for (const { dr, dc, cost = 1.0 } of neighbors) {
      const newRow = current.row + dr;
      const newCol = current.col + dc;
      const neighborKey = `${newRow},${newCol}`;

      // Skip if already evaluated
      if (closedSet.has(neighborKey)) continue;

      // Check bounds and terrain
      const terrainType = getTerrainAt(terrain, newRow, newCol, gridHeight, gridWidth);
      const terrainCost = getMovementCost(terrainType);

      if (terrainCost === Infinity) continue; // Impassable

      // For diagonal movement, check that we can actually move diagonally
      // (both adjacent cells must be passable to prevent corner cutting)
      if (allowDiagonal && dr !== 0 && dc !== 0) {
        const adj1 = getTerrainAt(terrain, current.row + dr, current.col, gridHeight, gridWidth);
        const adj2 = getTerrainAt(terrain, current.row, current.col + dc, gridHeight, gridWidth);
        if (getMovementCost(adj1) === Infinity || getMovementCost(adj2) === Infinity) {
          continue; // Can't cut corner
        }
      }

      // Calculate new g score (cost to reach this neighbor)
      const moveCost = cost * terrainCost;
      const newG = current.g + moveCost;
      const existingG = gScores.get(neighborKey);

      // Skip if we've found a better path to this node
      if (existingG !== undefined && newG >= existingG) continue;

      // This is a better path
      gScores.set(neighborKey, newG);
      const h = heuristic(newRow, newCol, endRow, endCol);

      openSet.push({
        row: newRow,
        col: newCol,
        g: newG,
        f: newG + h,
        parent: current
      });
    }
  }

  // No path found
  return null;
}

// Reconstruct path from goal node back to start
function reconstructPath(goalNode) {
  const path = [];
  let current = goalNode;

  while (current !== null) {
    path.unshift({ row: current.row, col: current.col });
    current = current.parent;
  }

  return path;
}

// ═══════════════════════════════════════════════════════════════
// COVER FINDING
// ═══════════════════════════════════════════════════════════════

/**
 * Find the nearest defensive position
 * @param {Object} params
 * @param {number[][]} params.terrain - Terrain grid
 * @param {number} params.fromRow - Starting row
 * @param {number} params.fromCol - Starting column
 * @param {number} params.gridHeight - Grid height
 * @param {number} params.gridWidth - Grid width
 * @param {number} params.maxDistance - Maximum search distance (default: 10)
 * @returns {{row: number, col: number, coverValue: number, path: Array}|null}
 */
export function findNearestCover({
  terrain,
  fromRow,
  fromCol,
  gridHeight,
  gridWidth,
  maxDistance = 10
}) {
  let bestCover = null;
  let bestValue = -1;
  let bestDistance = Infinity;

  // Search in expanding squares
  for (let dist = 1; dist <= maxDistance; dist++) {
    for (let dr = -dist; dr <= dist; dr++) {
      for (let dc = -dist; dc <= dist; dc++) {
        // Only check cells at this distance
        if (Math.abs(dr) !== dist && Math.abs(dc) !== dist) continue;

        const row = fromRow + dr;
        const col = fromCol + dc;

        if (row < 0 || row >= gridHeight || col < 0 || col >= gridWidth) continue;

        const terrainType = terrain[row]?.[col] || 'open';
        const coverValue = COVER_VALUES[terrainType] || 0;

        // Only consider cells with cover
        if (coverValue <= 0) continue;

        // Check if reachable
        const path = findPath({
          terrain,
          startRow: fromRow,
          startCol: fromCol,
          endRow: row,
          endCol: col,
          gridHeight,
          gridWidth,
          maxIterations: 200 // Limit for performance
        });

        if (!path) continue;

        const pathLength = path.length;

        // Prefer: higher cover value, then shorter distance
        if (coverValue > bestValue || (coverValue === bestValue && pathLength < bestDistance)) {
          bestCover = { row, col, coverValue, terrainType, path };
          bestValue = coverValue;
          bestDistance = pathLength;
        }
      }
    }

    // If we found good cover at this distance, don't search further
    if (bestCover && bestValue >= 3) break;
  }

  return bestCover;
}

// ═══════════════════════════════════════════════════════════════
// PATH UTILITIES
// ═══════════════════════════════════════════════════════════════

/**
 * Convert grid path to world coordinates
 * @param {Array<{row, col}>} path - Grid path
 * @param {number} cellSize - Cell size in pixels
 * @returns {Array<{x, y}>} - World coordinates path
 */
export function pathToWorld(path, cellSize) {
  return path.map(p => ({
    x: (p.col + 0.5) * cellSize,
    y: (p.row + 0.5) * cellSize
  }));
}

/**
 * Convert world position to grid position
 * @param {number} x - World X
 * @param {number} y - World Y
 * @param {number} cellSize - Cell size
 * @returns {{row, col}} - Grid position
 */
export function worldToGrid(x, y, cellSize) {
  return {
    row: Math.floor(y / cellSize),
    col: Math.floor(x / cellSize)
  };
}

/**
 * Smooth a path by removing unnecessary waypoints
 * Uses line-of-sight checks to skip intermediate points
 * @param {Array<{row, col}>} path - Original path
 * @param {number[][]} terrain - Terrain grid
 * @param {number} gridHeight
 * @param {number} gridWidth
 * @returns {Array<{row, col}>} - Smoothed path
 */
export function smoothPath(path, terrain, gridHeight, gridWidth) {
  if (path.length <= 2) return path;

  const smoothed = [path[0]];
  let current = 0;

  while (current < path.length - 1) {
    // Try to skip ahead as far as possible
    let furthest = current + 1;

    for (let i = path.length - 1; i > current + 1; i--) {
      if (hasLineOfSight(path[current], path[i], terrain, gridHeight, gridWidth)) {
        furthest = i;
        break;
      }
    }

    smoothed.push(path[furthest]);
    current = furthest;
  }

  return smoothed;
}

// Check if there's a clear line of sight between two grid positions
function hasLineOfSight(from, to, terrain, gridHeight, gridWidth) {
  // Bresenham's line algorithm
  let x0 = from.col;
  let y0 = from.row;
  const x1 = to.col;
  const y1 = to.row;

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    // Check if current cell is passable
    const terrainType = getTerrainAt(terrain, y0, x0, gridHeight, gridWidth);
    if (getMovementCost(terrainType) === Infinity) {
      return false;
    }

    if (x0 === x1 && y0 === y1) break;

    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }

  return true;
}
