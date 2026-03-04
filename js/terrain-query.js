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
    hasBoulder,
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

// ── Bridge railing (movement-only barrier) ───────────────────

// Railing zone: thin strip straddling bridge long edges.
// Blocks unit movement but NOT projectiles or LOS.
const RAIL_INNER = 4;   // pixels inside the deck edge
const RAIL_OUTER = 8;   // pixels outside the deck edge

/**
 * Test if a point is on a bridge railing (blocks movement, not projectiles).
 * Railings run along the long sides but NOT across the short ends.
 */
export function queryBridgeRailing(bridges, x, y) {
  if (!bridges || bridges.length === 0) return false;

  for (const bridge of bridges) {
    const { x: bx, y: by, width, length, dirX, dirY } = bridge;
    const halfLen = length / 2;
    const halfW = width / 2;

    const dx = x - bx;
    const dy = y - by;
    const projAlong = dx * dirX + dy * dirY;
    const projPerp = dx * (-dirY) + dy * dirX;
    const absPerp = Math.abs(projPerp);

    // Must be within bridge length (not past the ends)
    if (Math.abs(projAlong) > halfLen) continue;

    // Railing zone straddles the edge: (halfW - inner) to (halfW + outer)
    if (absPerp >= halfW - RAIL_INNER && absPerp <= halfW + RAIL_OUTER) {
      return true;
    }
  }

  return false;
}

// ── Bridge elevation entry detection ─────────────────────────

/**
 * Determine bridge elevation for a unit moving from (prevX,prevY) to (x,y).
 * - Entering from bridge ends → 'on' (walked onto deck)
 * - Entering from bridge sides → 'under' (walked beneath)
 * - Already had elevation and still in zone → keep current
 * - Left bridge zone → null
 *
 * @param {Array} bridges
 * @param {number} prevX - Previous X
 * @param {number} prevY - Previous Y
 * @param {number} x - Current X
 * @param {number} y - Current Y
 * @param {string|null} currentElev - Current elevation ('on', 'under', or null)
 * @returns {string|null} 'on', 'under', or null
 */
export function queryBridgeEntry(bridges, prevX, prevY, x, y, currentElev) {
  if (!bridges || bridges.length === 0) return null;

  for (const bridge of bridges) {
    const { x: bx, y: by, width, length, dirX, dirY } = bridge;
    const halfLen = length / 2;
    const halfW = width / 2;

    // Check if current position is in bridge zone (deck rect)
    const dx = x - bx, dy = y - by;
    const projAlong = dx * dirX + dy * dirY;
    const projPerp = dx * (-dirY) + dy * dirX;
    const inBridgeZone = Math.abs(projAlong) <= halfLen && Math.abs(projPerp) <= halfW;

    if (!inBridgeZone) continue;

    // In bridge zone — check if we already had an elevation on this bridge
    if (currentElev) return currentElev;

    // New entry — check where we came from
    const pdx = prevX - bx, pdy = prevY - by;
    const prevAlong = pdx * dirX + pdy * dirY;
    const prevPerp = pdx * (-dirY) + pdy * dirX;
    const wasInZone = Math.abs(prevAlong) <= halfLen && Math.abs(prevPerp) <= halfW;

    if (wasInZone) {
      // Was already inside (e.g. spawned on bridge) — default to 'on'
      return 'on';
    }

    // Determine entry direction from previous position
    // If prev was past the ends (along axis exceeded halfLen), entered from end → 'on'
    // If prev was past the sides (perp axis exceeded halfW), entered from side → 'under'
    if (Math.abs(prevAlong) > halfLen) {
      return 'on';
    }
    return 'under';
  }

  // Not in any bridge zone
  return null;
}

// ── Bridge cover (directional damage reduction) ─────────────

/**
 * Get damage multiplier for a projectile hitting a target on a bridge.
 * Trusses provide cover from shots coming perpendicular to the bridge.
 * Shots along the bridge (through the ends) get no reduction.
 *
 * @param {Array} bridges - Bridge objects
 * @param {number} targetX - Target world X
 * @param {number} targetY - Target world Y
 * @param {number} projVX - Projectile velocity X
 * @param {number} projVY - Projectile velocity Y
 * @returns {number} Damage multiplier (1.0 = full damage, 0.5 = half from truss cover)
 */
export function getBridgeCoverMult(bridges, targetX, targetY, projVX, projVY) {
  if (!bridges || bridges.length === 0) return 1.0;

  for (const bridge of bridges) {
    const { x: bx, y: by, width, length, dirX, dirY } = bridge;
    const halfLen = length / 2;
    const halfW = width / 2;

    // Check if target is on this bridge
    const dx = targetX - bx;
    const dy = targetY - by;
    const projAlong = dx * dirX + dy * dirY;
    const projPerp = dx * (-dirY) + dy * dirX;
    if (Math.abs(projAlong) > halfLen || Math.abs(projPerp) > halfW) continue;

    // Target is on this bridge — check projectile angle vs bridge direction
    const pLen = Math.sqrt(projVX * projVX + projVY * projVY);
    if (pLen < 0.01) return 1.0;

    // Dot product of projectile direction with bridge perpendicular axis
    // |dot| = 1 means shot is perfectly perpendicular (max truss cover)
    // |dot| = 0 means shot is along the bridge (no cover)
    const perpDot = Math.abs((projVX * (-dirY) + projVY * dirX) / pLen);

    // Cover scales with how perpendicular the shot is
    // perpDot 0.5-1.0 → 30-50% damage reduction
    if (perpDot > 0.3) {
      const coverFactor = 0.3 + 0.2 * ((perpDot - 0.3) / 0.7); // 0.3 to 0.5
      return 1.0 - coverFactor;
    }

    return 1.0; // Shot along the bridge — no cover
  }

  return 1.0; // Not on a bridge
}

// ── Bridge deck blocking (elevation separation) ─────────────

// Shadow margin: how far past the bridge edges the "under bridge" zone extends.
// Units this close to the bridge footprint are considered sheltered from above.
const BRIDGE_SHADOW_MARGIN = 40;

/**
 * Test if a bridge deck blocks a projectile between two points.
 * The deck separates "on top" from "below". If one point is on the bridge
 * and the other is in the bridge's shadow (footprint + margin) but NOT on
 * the deck, the shot is blocked by the bridge floor.
 *
 * When explicit elevation is provided ('on'/'under'), uses that directly.
 *
 * @param {Array} bridges - Bridge objects
 * @param {number} shooterX - Shooter world X
 * @param {number} shooterY - Shooter world Y
 * @param {number} targetX - Target world X
 * @param {number} targetY - Target world Y
 * @param {string|null} [shooterElev] - Shooter bridge elevation ('on'/'under'/null)
 * @param {string|null} [targetElev] - Target bridge elevation ('on'/'under'/null)
 * @returns {boolean} True if a bridge deck blocks the shot
 */
export function isBridgeDeckBlocking(bridges, shooterX, shooterY, targetX, targetY, shooterElev, targetElev) {
  if (!bridges || bridges.length === 0) return false;

  // Fast path: explicit elevation on both — different elevations = blocked
  if (shooterElev && targetElev) {
    return shooterElev !== targetElev;
  }
  // One is 'on' and other has no elevation (not in bridge zone) — use spatial check
  // One is 'under' and other has no elevation — not blocked (both at ground level)
  if (shooterElev === 'under' && !targetElev) return false;
  if (targetElev === 'under' && !shooterElev) return false;

  for (const bridge of bridges) {
    const { x: bx, y: by, width, length, dirX, dirY } = bridge;
    const halfLen = length / 2;
    const halfW = width / 2;

    // Check shooter against bridge
    const sdx = shooterX - bx, sdy = shooterY - by;
    const sAlong = sdx * dirX + sdy * dirY;
    const sPerp = sdx * (-dirY) + sdy * dirX;
    const shooterOnDeck = shooterElev === 'on' || (Math.abs(sAlong) <= halfLen && Math.abs(sPerp) <= halfW);

    // Check target against bridge (expanded footprint = shadow zone)
    const tdx = targetX - bx, tdy = targetY - by;
    const tAlong = tdx * dirX + tdy * dirY;
    const tPerp = tdx * (-dirY) + tdy * dirX;
    const targetOnDeck = targetElev === 'on' || (Math.abs(tAlong) <= halfLen && Math.abs(tPerp) <= halfW);
    // Shadow only extends along the bridge (underneath), not to the sides (open air)
    const targetInShadow = targetElev === 'under' || (Math.abs(tAlong) <= halfLen + BRIDGE_SHADOW_MARGIN
                        && Math.abs(tPerp) <= halfW);

    // Shooter on bridge, target in shadow below → blocked
    if (shooterOnDeck && !targetOnDeck && targetInShadow) return true;

    // Target on bridge, shooter in shadow below → also blocked
    const shooterInShadow = shooterElev === 'under' || (Math.abs(sAlong) <= halfLen + BRIDGE_SHADOW_MARGIN
                         && Math.abs(sPerp) <= halfW);
    if (targetOnDeck && !shooterOnDeck && shooterInShadow) return true;
  }

  return false;
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
    hasBoulder: false,
    isBridge: false
  };
}
