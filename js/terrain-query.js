// ═══════════════════════════════════════════════════════════════
// TERRAIN QUERY — Scatter-aware point queries for terrain properties
// Replaces the grid-based rasterizer for gameplay queries.
// Uses actual placed scatter items (trees, brush, boulders) and
// stroke geometry (water) for accurate terrain property computation.
// ═══════════════════════════════════════════════════════════════

import { getSpatialHash, SCATTER_TYPES } from './world-builder/scatter.js';
import {
  FEATURE_DEFS,
  calcStrokeCoverage,
  computeSpeedMod,
  computeCoverBonus,
  computeVisibility,
  computeWaterDepth
} from './world-builder/terrain-math.js';

// ── Per-frame query cache ────────────────────────────────────
// 8px resolution cache, cleared once per frame via clearQueryCache()
const CACHE_RESOLUTION = 8;
let _queryCache = new Map();

/**
 * Clear the per-frame query cache. Call once at the top of each game update.
 */
export function clearQueryCache() {
  _queryCache.clear();
}

function _cacheKey(x, y) {
  const cx = (x / CACHE_RESOLUTION) | 0;
  const cy = (y / CACHE_RESOLUTION) | 0;
  return (cx << 16) | (cy & 0xFFFF);
}

// ── Default query radius ─────────────────────────────────────
const DEFAULT_RADIUS = 64;

// ── Main query function ──────────────────────────────────────

/**
 * Query terrain properties at a world position using scatter items + stroke geometry.
 *
 * @param {object} terrainMap - TerrainMap with scatterItems, strokes, bridges
 * @param {number} x - World X coordinate
 * @param {number} y - World Y coordinate
 * @param {number} [radius=64] - Search radius for scatter density
 * @returns {{ cover: number, speedMod: number, visibility: number,
 *             water: number, depth: string|null, dominant: string,
 *             isBlocked: boolean, isBridge: boolean }}
 */
export function queryTerrain(terrainMap, x, y, radius) {
  if (!terrainMap) {
    return _emptyResult();
  }

  // Check cache
  const key = _cacheKey(x, y);
  const cached = _queryCache.get(key);
  if (cached) return cached;

  const r = radius || DEFAULT_RADIUS;

  // ── 1. Bridge check (overrides water) ──────────────────────
  const bridge = queryBridge(terrainMap.bridges, x, y);

  // ── 2. Water coverage from strokes ─────────────────────────
  let waterCov = 0;
  if (!bridge) {
    for (const stroke of terrainMap.strokes) {
      if (stroke.type !== 'water') continue;
      const cov = calcStrokeCoverage(stroke, x, y);
      if (cov > 0) {
        // Water doesn't stack — take max
        waterCov = Math.max(waterCov, cov);
      }
    }
  }

  // ── 3. Scatter density from spatial hash ───────────────────
  let forestWeight = 0;
  let brushWeight = 0;
  let hasBoulder = false;

  const spatialHash = getSpatialHash(terrainMap);
  const nearby = spatialHash.query(x, y, r);
  const rSq = r * r;

  for (const item of nearby) {
    const dx = item.x - x;
    const dy = item.y - y;
    const distSq = dx * dx + dy * dy;
    if (distSq > rSq) continue;

    const config = SCATTER_TYPES[item.type];
    if (!config) continue;

    const category = config.category;

    if (category === 'tree') {
      // Size-weighted: larger trees contribute more
      // Scale is typically 0.02-0.12, normalize to reasonable weight
      const dist = Math.sqrt(distSq);
      const falloff = 1 - (dist / r); // Linear falloff from center
      forestWeight += item.scale * falloff * 10; // Scale factor for meaningful coverage
    } else if (category === 'brush') {
      const dist = Math.sqrt(distSq);
      const falloff = 1 - (dist / r);
      brushWeight += item.scale * falloff * 8;
    } else if (category === 'boulder') {
      // Boulder collision: per-item circle check
      // spriteWidth approx 256px * scale * 0.4 for collision radius
      const collisionRadius = 256 * item.scale * 0.4;
      const dist = Math.sqrt(distSq);
      if (dist < collisionRadius) {
        hasBoulder = true;
      }
    }
    // floor, particle categories: visual only, no gameplay effect
  }

  // Clamp density values to 0-1 range for coverage computation
  const forestCov = Math.min(forestWeight, 1.0);
  const brushCov = Math.min(brushWeight, 1.0);

  // ── 4. Compute gameplay properties ─────────────────────────
  const coverage = {
    forest: forestCov,
    brush: brushCov,
    water: waterCov
  };

  let speedMod, cover, vis, depth, dominant, isBlocked;

  if (bridge) {
    // Bridge overrides: fast, no cover, full visibility, no water
    speedMod = 0.9;
    cover = 0;
    vis = 1.0;
    depth = null;
    dominant = 'open';
    isBlocked = false;
  } else {
    speedMod = computeSpeedMod(coverage);
    cover = computeCoverBonus(coverage);
    vis = computeVisibility(coverage);
    depth = computeWaterDepth(waterCov);
    isBlocked = hasBoulder || (depth === 'deep' && speedMod === 0);

    // Determine dominant feature
    if (waterCov >= 0.3) {
      dominant = 'water';
    } else if (forestCov >= brushCov && forestCov >= FEATURE_DEFS.forest.minCoverageForEffect) {
      dominant = 'forest';
    } else if (brushCov >= FEATURE_DEFS.brush.minCoverageForEffect) {
      dominant = 'brush';
    } else {
      dominant = 'open';
    }
  }

  // Boulder always blocks
  if (hasBoulder) {
    isBlocked = true;
    speedMod = 0;
  }

  const result = {
    cover,
    speedMod,
    visibility: vis,
    water: waterCov,
    depth,
    dominant,
    isBlocked,
    isBridge: !!bridge
  };

  _queryCache.set(key, result);
  return result;
}

// ── Bridge hit test ──────────────────────────────────────────

/**
 * Test if a point is on a bridge using rotated rectangle geometry.
 * Projects the point into the bridge's local coordinate system.
 *
 * @param {Array} bridges - Array of bridge objects
 * @param {number} x - World X
 * @param {number} y - World Y
 * @returns {object|null} The bridge object if hit, null otherwise
 */
export function queryBridge(bridges, x, y) {
  if (!bridges || bridges.length === 0) return null;

  for (const bridge of bridges) {
    const { x: bx, y: by, width, length, dirX, dirY } = bridge;
    const halfLen = length / 2;
    const halfW = width / 2;

    // Vector from bridge center to point
    const dx = x - bx;
    const dy = y - by;

    // Project onto bridge's local axes
    // Along bridge direction (dirX, dirY)
    const projAlong = dx * dirX + dy * dirY;
    // Perpendicular to bridge direction (-dirY, dirX)
    const projPerp = dx * (-dirY) + dy * dirX;

    if (Math.abs(projAlong) <= halfLen && Math.abs(projPerp) <= halfW) {
      return bridge;
    }
  }

  return null;
}

// ── Boulder collision ────────────────────────────────────────

/**
 * Test if a point collides with any boulder scatter item.
 *
 * @param {object} terrainMap - TerrainMap
 * @param {number} x - World X
 * @param {number} y - World Y
 * @returns {boolean} True if point is inside a boulder collision circle
 */
export function queryBoulder(terrainMap, x, y) {
  if (!terrainMap) return false;

  const spatialHash = getSpatialHash(terrainMap);
  // Search radius: largest possible boulder collision radius
  const searchRadius = 256 * 0.15 * 0.4; // ~15px for typical max scale
  const nearby = spatialHash.query(x, y, searchRadius + 20);

  for (const item of nearby) {
    const config = SCATTER_TYPES[item.type];
    if (!config || config.category !== 'boulder') continue;

    const collisionRadius = 256 * item.scale * 0.4;
    const dx = item.x - x;
    const dy = item.y - y;
    const distSq = dx * dx + dy * dy;

    if (distSq < collisionRadius * collisionRadius) {
      return true;
    }
  }

  return false;
}

// ── Helper ───────────────────────────────────────────────────

function _emptyResult() {
  return {
    cover: 0,
    speedMod: 1.0,
    visibility: 1.0,
    water: 0,
    depth: null,
    dominant: 'open',
    isBlocked: false,
    isBridge: false
  };
}
