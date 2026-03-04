// ═══════════════════════════════════════════════════════════════
// PATHFINDING - A* algorithm with terrain costs
// Supports both legacy 2D string grids and PCG terrainMap cells
// ═══════════════════════════════════════════════════════════════

import { queryTerrain, queryBridgeRailing } from './terrain-query.js';
import { getSpatialHash, SCATTER_TYPES } from './world-builder/scatter.js';
import { WATER_DEPTH_SPEED } from './terrain-utils.js';

// Pathfinding cell size for terrainMap battles (finer than the old 64px rasterize grid)
const PATH_CELL_SIZE = 32;

// Terrain movement costs for legacy grids (lower = faster/preferred)
export const TERRAIN_COSTS = {
  open: 1.0,
  grass: 1.0,
  trench: 1.2,
  pillbox: 1.5,
  brush: 1.3,
  forest: 1.8,
  water: 2.0,
  high: Infinity
};

// Small overhead multiplier so A* slightly prefers dry ground over wading
// at equal distance, without making detours worthwhile
const WATER_COST_OVERHEAD = 1.15;

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

// Cells with cost >= this threshold block line-of-sight for path smoothing.
// Deep water for infantry costs ~3.8 — this prevents smoothing through it
// while allowing shortcuts through shallow (~1.2) and medium (~1.6-2.0).
const SMOOTH_BLOCK_COST = 3.0;

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

function heuristic(row1, col1, row2, col2) {
  return Math.abs(row1 - row2) + Math.abs(col1 - col2);
}

// Legacy helpers for string-grid terrain
function getTerrainAt(terrain, row, col, gridHeight, gridWidth) {
  if (row < 0 || row >= gridHeight || col < 0 || col >= gridWidth) return 'high';
  return terrain[row]?.[col] || 'open';
}

function getMovementCost(terrainType) {
  return TERRAIN_COSTS[terrainType] ?? 1.0;
}

const NEIGHBORS_4 = [
  { dr: -1, dc: 0 },
  { dr: 1, dc: 0 },
  { dr: 0, dc: -1 },
  { dr: 0, dc: 1 }
];

const NEIGHBORS_8 = [
  { dr: -1, dc: 0, cost: 1.0 },
  { dr: 1, dc: 0, cost: 1.0 },
  { dr: 0, dc: -1, cost: 1.0 },
  { dr: 0, dc: 1, cost: 1.0 },
  { dr: -1, dc: -1, cost: 1.414 },
  { dr: -1, dc: 1, cost: 1.414 },
  { dr: 1, dc: -1, cost: 1.414 },
  { dr: 1, dc: 1, cost: 1.414 }
];

/**
 * Find optimal path using A* algorithm.
 *
 * Accepts either a legacy `terrain` 2D string grid or a `costFn(row, col) => number`
 * callback. If costFn is provided it takes priority over the terrain grid.
 *
 * @param {Object} params
 * @param {string[][]|null} params.terrain - Legacy 2D terrain grid (optional if costFn provided)
 * @param {Function|null} params.costFn - (row, col) => cost. Infinity = impassable. Overrides terrain.
 * @param {number} params.startRow
 * @param {number} params.startCol
 * @param {number} params.endRow
 * @param {number} params.endCol
 * @param {number} params.gridHeight
 * @param {number} params.gridWidth
 * @param {boolean} [params.allowDiagonal=true]
 * @param {number} [params.maxIterations=1000]
 * @returns {Array<{row, col}>|null}
 */
export function findPath({
  terrain,
  costFn,
  startRow,
  startCol,
  endRow,
  endCol,
  gridHeight,
  gridWidth,
  allowDiagonal = true,
  maxIterations = 1000
}) {
  // Build cost function — costFn takes priority, otherwise use legacy terrain lookup
  const getCost = costFn || ((row, col) => {
    const t = getTerrainAt(terrain, row, col, gridHeight, gridWidth);
    return getMovementCost(t);
  });

  // Quick checks
  if (getCost(startRow, startCol) === Infinity || getCost(endRow, endCol) === Infinity) {
    return null;
  }

  if (startRow === endRow && startCol === endCol) {
    return [{ row: startRow, col: startCol }];
  }

  const neighbors = allowDiagonal ? NEIGHBORS_8 : NEIGHBORS_4;
  const openSet = new MinHeap();
  const closedSet = new Set();
  const gScores = new Map();

  const startKey = `${startRow},${startCol}`;
  const h = heuristic(startRow, startCol, endRow, endCol);

  openSet.push({ row: startRow, col: startCol, g: 0, f: h, parent: null });
  gScores.set(startKey, 0);

  let iterations = 0;

  while (!openSet.isEmpty() && iterations < maxIterations) {
    iterations++;
    const current = openSet.pop();
    const currentKey = `${current.row},${current.col}`;

    if (current.row === endRow && current.col === endCol) {
      return reconstructPath(current);
    }

    closedSet.add(currentKey);

    for (const { dr, dc, cost = 1.0 } of neighbors) {
      const newRow = current.row + dr;
      const newCol = current.col + dc;
      const neighborKey = `${newRow},${newCol}`;

      if (closedSet.has(neighborKey)) continue;

      const terrainCost = getCost(newRow, newCol);
      if (terrainCost === Infinity) continue;

      // Prevent diagonal corner cutting through impassable cells
      if (allowDiagonal && dr !== 0 && dc !== 0) {
        if (getCost(current.row + dr, current.col) === Infinity ||
            getCost(current.row, current.col + dc) === Infinity) {
          continue;
        }
      }

      const moveCost = cost * terrainCost;
      const newG = current.g + moveCost;
      const existingG = gScores.get(neighborKey);

      if (existingG !== undefined && newG >= existingG) continue;

      gScores.set(neighborKey, newG);
      const nh = heuristic(newRow, newCol, endRow, endCol);

      openSet.push({
        row: newRow,
        col: newCol,
        g: newG,
        f: newG + nh,
        parent: current
      });
    }
  }

  return null;
}

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
// WORLD-LEVEL PATHFINDING — Battle-aware wrapper
// ═══════════════════════════════════════════════════════════════

/**
 * Check if any boulder's collision circle overlaps a pathfinding cell.
 * Single spatial hash query covers the whole cell — much cheaper than 4x queryBoulder().
 */
function _cellHasBoulder(terrainMap, cx, cy, cellSize) {
  const spatialHash = getSpatialHash(terrainMap);
  const half = cellSize / 2;
  // Search radius: cell half-diagonal + max boulder collision radius
  const maxBoulderRadius = 256 * 0.15 * 0.4; // ~15px
  const searchRadius = half * 1.42 + maxBoulderRadius; // ~38px for 32px cells
  const nearby = spatialHash.query(cx, cy, searchRadius);

  for (const item of nearby) {
    const config = SCATTER_TYPES[item.type];
    if (!config || config.category !== 'boulder') continue;
    const collisionRadius = 256 * item.scale * 0.4;
    // Check if boulder circle overlaps the cell rectangle
    // Clamp boulder center to nearest point on cell, then check distance
    const nearestX = Math.max(cx - half, Math.min(item.x, cx + half));
    const nearestY = Math.max(cy - half, Math.min(item.y, cy + half));
    const dx = item.x - nearestX;
    const dy = item.y - nearestY;
    if (dx * dx + dy * dy < collisionRadius * collisionRadius) return true;
  }
  return false;
}

/**
 * Build a cost function from a battle object's terrain.
 * Supports both terrainMap (PCG) and legacy 2D grids.
 *
 * @param {Object} b - Battle object
 * @param {string} category - Unit category: 'infantry' | 'light_vehicle' | 'medium_tank' | 'heavy_tank'
 * @returns {{ costFn: Function, gridWidth: number, gridHeight: number, cellSize: number }}
 */
export function buildCostFn(b, category = 'infantry') {
  const hasTM = !!b.terrainMap;

  if (hasTM) {
    // Use 32px pathfinding grid with scatter-aware point queries
    const cellSize = PATH_CELL_SIZE;
    const mapW = b.terrainMap.gridWidth * b.terrainMap.cellSize; // world pixels
    const mapH = b.terrainMap.gridHeight * b.terrainMap.cellSize;
    const gridW = Math.ceil(mapW / cellSize);
    const gridH = Math.ceil(mapH / cellSize);
    const tm = b.terrainMap;

    const costFn = (row, col) => {
      if (row < 0 || row >= gridH || col < 0 || col >= gridW) return Infinity;

      // Query terrain at cell center
      const wx = (col + 0.5) * cellSize;
      const wy = (row + 0.5) * cellSize;
      const result = queryTerrain(tm, wx, wy);

      if (result.isBlocked) return Infinity;

      // Check for boulders that overlap this cell (even if center is outside collision radius)
      if (_cellHasBoulder(tm, wx, wy, cellSize)) return Infinity;

      // Bridge railing — high cost so A* routes fully on or fully off the bridge
      if (tm.bridges && queryBridgeRailing(tm.bridges, wx, wy)) return 10.0;

      // Water depth — use actual per-category speed mods so A* cost
      // reflects real movement speed rather than flat avoidance penalties
      if (result.depth) {
        const mods = WATER_DEPTH_SPEED[result.depth];
        const speedMod = mods?.[category] ?? 0.7;
        if (speedMod === 0) return Infinity;
        return (1.0 / speedMod) * WATER_COST_OVERHEAD;
      }

      // Inverse speedMod — slower terrain = higher cost
      return result.speedMod > 0 ? 1.0 / result.speedMod : Infinity;
    };

    return { costFn, gridWidth: gridW, gridHeight: gridH, cellSize };
  }

  // Legacy string grid
  const cellSize = b.cellSize || 64;
  const gridW = b.gridWidth;
  const gridH = b.gridHeight;

  const costFn = (row, col) => {
    if (row < 0 || row >= gridH || col < 0 || col >= gridW) return Infinity;
    const t = b.terrain[row]?.[col] || 'open';
    if (t === 'water') {
      // Legacy grids: all water is "medium" depth
      const mods = WATER_DEPTH_SPEED.medium;
      const speedMod = mods?.[category] ?? 0.7;
      if (speedMod === 0) return Infinity;
      return (1.0 / speedMod) * WATER_COST_OVERHEAD;
    }
    return TERRAIN_COSTS[t] ?? 1.0;
  };

  return { costFn, gridWidth: gridW, gridHeight: gridH, cellSize };
}

/**
 * Find a path between two world positions using the battle's terrain.
 *
 * @param {Object} b - Battle object (has .terrainMap or .terrain/.cellSize/.gridWidth/.gridHeight)
 * @param {number} startX - Start world X
 * @param {number} startY - Start world Y
 * @param {number} goalX  - Goal world X
 * @param {number} goalY  - Goal world Y
 * @param {Object} [opts]
 * @param {string} [opts.category='infantry'] - Unit category for passability
 * @param {boolean} [opts.allowDiagonal=true]
 * @param {number} [opts.maxIterations=2000]
 * @param {boolean} [opts.smooth=true] - Run path smoothing
 * @returns {Array<{x, y}>|null} - World-coordinate waypoints, or null if no path
 */
export function findPathWorld(b, startX, startY, goalX, goalY, opts = {}) {
  const category = opts.category || 'infantry';
  const { costFn, gridWidth: gridW, gridHeight: gridH, cellSize } = buildCostFn(b, category);

  // Convert world → grid, clamp to bounds
  let start = worldToGrid(startX, startY, cellSize);
  let goal  = worldToGrid(goalX, goalY, cellSize);

  start.row = Math.max(0, Math.min(gridH - 1, start.row));
  start.col = Math.max(0, Math.min(gridW - 1, start.col));
  goal.row  = Math.max(0, Math.min(gridH - 1, goal.row));
  goal.col  = Math.max(0, Math.min(gridW - 1, goal.col));

  // If start or goal is impassable, nudge to nearest passable cell
  if (costFn(start.row, start.col) === Infinity) {
    start = nudgeToPassable(start.row, start.col, costFn, gridH, gridW);
    if (!start) return null;
  }
  if (costFn(goal.row, goal.col) === Infinity) {
    goal = nudgeToPassable(goal.row, goal.col, costFn, gridH, gridW);
    if (!goal) return null;
  }

  const gridPath = findPath({
    costFn,
    startRow: start.row,
    startCol: start.col,
    endRow: goal.row,
    endCol: goal.col,
    gridHeight: gridH,
    gridWidth: gridW,
    allowDiagonal: opts.allowDiagonal ?? true,
    maxIterations: opts.maxIterations ?? 2000
  });

  if (!gridPath) return null;

  // Smooth (skip unnecessary waypoints where line-of-sight is clear)
  const final = (opts.smooth !== false)
    ? smoothPath(gridPath, null, gridH, gridW, costFn)
    : gridPath;

  return pathToWorld(final, cellSize);
}

/**
 * Search neighboring cells for the nearest passable one (expanding ring, max 3 cells out).
 */
function nudgeToPassable(row, col, costFn, gridH, gridW) {
  for (let r = 1; r <= 3; r++) {
    for (let dr = -r; dr <= r; dr++) {
      for (let dc = -r; dc <= r; dc++) {
        if (Math.abs(dr) !== r && Math.abs(dc) !== r) continue;
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nr >= gridH || nc < 0 || nc >= gridW) continue;
        if (costFn(nr, nc) < Infinity) return { row: nr, col: nc };
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// COVER FINDING
// ═══════════════════════════════════════════════════════════════

/**
 * Find the nearest defensive position (legacy grid version).
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

  for (let dist = 1; dist <= maxDistance; dist++) {
    for (let dr = -dist; dr <= dist; dr++) {
      for (let dc = -dist; dc <= dist; dc++) {
        if (Math.abs(dr) !== dist && Math.abs(dc) !== dist) continue;

        const row = fromRow + dr;
        const col = fromCol + dc;

        if (row < 0 || row >= gridHeight || col < 0 || col >= gridWidth) continue;

        const terrainType = terrain[row]?.[col] || 'open';
        const coverValue = COVER_VALUES[terrainType] || 0;

        if (coverValue <= 0) continue;

        const path = findPath({
          terrain,
          startRow: fromRow,
          startCol: fromCol,
          endRow: row,
          endCol: col,
          gridHeight,
          gridWidth,
          maxIterations: 200
        });

        if (!path) continue;

        const pathLength = path.length;

        if (coverValue > bestValue || (coverValue === bestValue && pathLength < bestDistance)) {
          bestCover = { row, col, coverValue, terrainType, path };
          bestValue = coverValue;
          bestDistance = pathLength;
        }
      }
    }

    if (bestCover && bestValue >= 3) break;
  }

  return bestCover;
}

// ═══════════════════════════════════════════════════════════════
// PATH UTILITIES
// ═══════════════════════════════════════════════════════════════

/**
 * Convert grid path to world coordinates (cell centers).
 */
export function pathToWorld(path, cellSize) {
  return path.map(p => ({
    x: (p.col + 0.5) * cellSize,
    y: (p.row + 0.5) * cellSize
  }));
}

/**
 * Convert world position to grid position.
 */
export function worldToGrid(x, y, cellSize) {
  return {
    row: Math.floor(y / cellSize),
    col: Math.floor(x / cellSize)
  };
}

/**
 * Smooth a path by removing unnecessary waypoints.
 * Uses line-of-sight checks to skip intermediate points.
 *
 * Accepts either a legacy `terrain` 2D grid or a `costFn`.
 * If costFn is provided it takes priority.
 */
export function smoothPath(path, terrain, gridHeight, gridWidth, costFn) {
  if (path.length <= 2) return path;

  const smoothed = [path[0]];
  let current = 0;

  while (current < path.length - 1) {
    let furthest = current + 1;

    for (let i = path.length - 1; i > current + 1; i--) {
      if (hasLineOfSight(path[current], path[i], terrain, gridHeight, gridWidth, costFn)) {
        furthest = i;
        break;
      }
    }

    smoothed.push(path[furthest]);
    current = furthest;
  }

  return smoothed;
}

/**
 * Check if there's a clear line of sight between two grid positions.
 * Blocks on impassable cells (Infinity) and high-cost cells (>= SMOOTH_BLOCK_COST)
 * to prevent smoothed paths from cutting through water.
 */
function hasLineOfSight(from, to, terrain, gridHeight, gridWidth, costFn) {
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
    // Use costFn if available, else legacy terrain lookup
    let blocked;
    if (costFn) {
      const c = costFn(y0, x0);
      blocked = c === Infinity || c >= SMOOTH_BLOCK_COST;
    } else {
      const terrainType = getTerrainAt(terrain, y0, x0, gridHeight, gridWidth);
      blocked = getMovementCost(terrainType) === Infinity;
    }

    if (blocked) return false;
    if (x0 === x1 && y0 === y1) break;

    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx)  { err += dx; y0 += sy; }
  }

  return true;
}

// ── Navigation Waypoint Resolution ──────────────────────────

const NAV_PATH_THRESHOLD = 128;  // Use A* for distances > 128px
const NAV_RETARGET_DIST = 64;    // Recompute path when target moves > 64px

/**
 * Resolve the next movement waypoint for a unit using cached A* paths.
 * Long-distance targets are routed through A* waypoints.
 * Short-distance targets are returned as-is (direct steering).
 *
 * Path state stored on unit: _navPath, _navIndex, _navTarget
 *
 * @param {object} b - Battle state (needs b.terrainMap for PCG maps)
 * @param {object} unit - The moving unit (path state cached here)
 * @param {number} targetX - Desired destination X
 * @param {number} targetY - Desired destination Y
 * @param {string} category - Unit category for passability ('infantry', 'light_vehicle', etc.)
 * @returns {{ x: number, y: number }} - Next position to steer toward
 */
export function resolveNavWaypoint(b, unit, targetX, targetY, category) {
  // Only use A* on PCG terrainMap battles
  if (!b.terrainMap) {
    return { x: targetX, y: targetY };
  }

  const navDist = Math.hypot(targetX - unit.x, targetY - unit.y);

  if (navDist < NAV_PATH_THRESHOLD) {
    // Close enough — clear cached path, go direct
    unit._navPath = null;
    unit._navTarget = null;
    return { x: targetX, y: targetY };
  }

  // Check if we need a new path
  const needsPath = !unit._navPath
    || !unit._navTarget
    || Math.hypot(targetX - unit._navTarget.x, targetY - unit._navTarget.y) > NAV_RETARGET_DIST;

  if (needsPath) {
    const path = findPathWorld(b, unit.x, unit.y, targetX, targetY, { category });
    if (path && path.length > 1) {
      unit._navPath = path;
      unit._navIndex = 0;
      unit._navTarget = { x: targetX, y: targetY };
      unit._navFailCount = 0;
    } else {
      // Log pathfinding failure (throttled to once per 5s per unit)
      const now = Date.now();
      if (!unit._lastNavFailLog || now - unit._lastNavFailLog > 5000) {
        unit._lastNavFailLog = now;
        unit._navFailCount = (unit._navFailCount || 0) + 1;
        if (b._debugLog) {
          const logTeam = unit.team;
          b._debugLog.push({
            t: now, who: unit.id, team: logTeam, type: 'nav_fail',
            x: Math.round(unit.x), y: Math.round(unit.y),
            detail: `no path to (${Math.round(targetX)},${Math.round(targetY)}) dist:${Math.round(navDist)} cat:${category} fails:${unit._navFailCount}`
          });
        }
      }
      unit._navPath = null;
      unit._navTarget = null;
      return { x: targetX, y: targetY };
    }
  }

  // Advance past reached waypoints
  while (unit._navIndex < unit._navPath.length - 1) {
    const wp = unit._navPath[unit._navIndex];
    if (Math.hypot(wp.x - unit.x, wp.y - unit.y) < 20) {
      unit._navIndex++;
    } else {
      break;
    }
  }

  const wp = unit._navPath[unit._navIndex];
  return { x: wp.x, y: wp.y };
}
