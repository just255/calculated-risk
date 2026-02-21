// ═══════════════════════════════════════════════════════════════
// TERRAIN UTILITIES — Shared terrain queries, cover, water depth
// Used by: ai.js, vision.js, movement-modes.js, game.js
//
// terrainMap battles use scatter-aware point queries (terrain-query.js)
// Legacy string-grid battles use direct grid lookups
// ═══════════════════════════════════════════════════════════════

import { queryTerrain, queryBoulder } from './terrain-query.js';

// ── Blocking & Speed ──────────────────────────────────────────

export function isTerrainBlocked(b, x, y) {
  if (b.terrainMap) {
    const result = queryTerrain(b.terrainMap, x, y);
    return result.isBlocked;
  }
  const col = Math.floor(x / b.cellSize);
  const row = Math.floor(y / b.cellSize);
  if (row < 0 || row >= b.gridHeight || col < 0 || col >= b.gridWidth) return true;
  const terrain = b.terrain[row]?.[col];
  return terrain === 'high';
}

export function getTerrainSpeedMod(b, x, y) {
  if (b.terrainMap) {
    const result = queryTerrain(b.terrainMap, x, y);
    return result.speedMod;
  }
  const col = Math.floor(x / b.cellSize);
  const row = Math.floor(y / b.cellSize);
  if (row < 0 || row >= b.gridHeight || col < 0 || col >= b.gridWidth) return 1.0;
  const terrain = b.terrain[row]?.[col];
  switch (terrain) {
    case 'water': return 0.5;
    case 'brush': return 0.9;
    case 'forest': return 0.7;
    default: return 1.0;
  }
}

// ── Terrain Type Queries ──────────────────────────────────────

export function getTerrainAt(b, x, y) {
  if (b.terrainMap) {
    const result = queryTerrain(b.terrainMap, x, y);
    return result.dominant || 'open';
  }
  const col = Math.floor(x / b.cellSize);
  const row = Math.floor(y / b.cellSize);
  if (row < 0 || row >= b.gridHeight || col < 0 || col >= b.gridWidth) return 'open';
  return b.terrain[row]?.[col] || 'open';
}

export function isInCover(b, x, y) {
  const terrain = getTerrainAt(b, x, y);
  return terrain === 'trench' || terrain === 'pillbox';
}

export const TERRAIN_COVER_SCORE = {
  pillbox: 50,
  trench: 40,
  forest: 25,
  brush: 15,
  high: -1000,
  water: -500,
  grass: 5,
  open: 0
};

// ── Water Depth ───────────────────────────────────────────────

/**
 * Get water depth at position. Returns 'shallow' | 'medium' | 'deep' | null.
 */
export function getWaterDepth(b, x, y) {
  if (b.terrainMap) {
    const result = queryTerrain(b.terrainMap, x, y);
    return result.depth;
  }
  // Legacy grid — all water is medium
  const col = Math.floor(x / b.cellSize);
  const row = Math.floor(y / b.cellSize);
  if (row < 0 || row >= b.gridHeight || col < 0 || col >= b.gridWidth) return null;
  return b.terrain[row]?.[col] === 'water' ? 'medium' : null;
}

/**
 * Water depth speed modifiers per unit category.
 */
export const WATER_DEPTH_SPEED = {
  shallow: { infantry: 0.95, light_vehicle: 0.98, medium_tank: 0.98, heavy_tank: 0.98 },
  medium:  { infantry: 0.60, light_vehicle: 0.70, medium_tank: 0.70, heavy_tank: 0.70 },
  deep:    { infantry: 0.30, light_vehicle: 0, medium_tank: 0, heavy_tank: 0 }
};

/**
 * Check if terrain is passable for a given unit category.
 * Deep water blocks vehicles.
 */
export function isTerrainPassable(b, x, y, category) {
  if (isTerrainBlocked(b, x, y)) return false;
  const depth = getWaterDepth(b, x, y);
  if (depth === 'deep' && category !== 'infantry') return false;
  return true;
}

/**
 * Get speed modifier for water depth, factoring in unit category.
 * Returns 1.0 if not in water or no category specified.
 */
export function getWaterSpeedMod(b, x, y, category) {
  const depth = getWaterDepth(b, x, y);
  if (!depth) return 1.0;
  const mods = WATER_DEPTH_SPEED[depth];
  if (!mods) return 1.0;
  return mods[category] ?? 0.7;
}

// ── Utility Functions ─────────────────────────────────────────

export function distanceBetween(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Find the nearest cover position within searchRadius cells of the unit.
 * Returns { x, y } or null if no cover found.
 */
export function findNearbyCoverPos(b, unit, searchRadius, friendlies) {

  const terrain = getTerrainAt(b, unit.x, unit.y);
  if ((TERRAIN_COVER_SCORE[terrain] || 0) >= 15) return null; // Already in cover

  const cellSize = b.terrainMap?.cellSize || b.cellSize || 64;
  const col = Math.floor(unit.x / cellSize);
  const row = Math.floor(unit.y / cellSize);
  const r = searchRadius ?? 3;

  let bestPos = null;
  let bestScore = -Infinity;
  let bestDistSq = Infinity;

  for (let dr = -r; dr <= r; dr++) {
    for (let dc = -r; dc <= r; dc++) {
      if (dr === 0 && dc === 0) continue;
      const cx = (col + dc + 0.5) * cellSize;
      const cy = (row + dr + 0.5) * cellSize;
      if (isTerrainBlocked(b, cx, cy)) continue;
      const t = getTerrainAt(b, cx, cy);
      const coverScore = TERRAIN_COVER_SCORE[t] || 0;
      if (coverScore >= 15) {
        const dSq = (cx - unit.x) ** 2 + (cy - unit.y) ** 2;

        // Crowding penalty: prefer cover not already occupied by friendlies
        let crowdPenalty = 0;
        if (friendlies) {
          for (const f of friendlies) {
            if (f === unit || f.dead) continue;
            const fdist = Math.hypot(cx - f.x, cy - f.y);
            if (fdist < cellSize * 1.5) crowdPenalty += 15;
          }
        }

        const effectiveScore = coverScore - crowdPenalty;
        if (effectiveScore > bestScore || (effectiveScore === bestScore && dSq < bestDistSq)) {
          bestPos = { x: cx, y: cy };
          bestScore = effectiveScore;
          bestDistSq = dSq;
        }
      }
    }
  }

  return bestPos;
}
