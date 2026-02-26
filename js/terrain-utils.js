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

  // Threat direction: away from current target or last attacker
  const target = unit._currentTarget;
  let threatX = null, threatY = null;
  if (target && !target.dead) {
    threatX = target.x; threatY = target.y;
  }

  // Ally centroid: prefer cover behind friendlies (between unit and allies)
  let allyX = 0, allyY = 0, allyCount = 0;
  if (friendlies) {
    for (const f of friendlies) {
      if (f === unit || f.dead) continue;
      allyX += f.x; allyY += f.y; allyCount++;
    }
  }
  if (allyCount > 0) { allyX /= allyCount; allyY /= allyCount; }

  let bestPos = null;
  let bestScore = -Infinity;

  for (let dr = -r; dr <= r; dr++) {
    for (let dc = -r; dc <= r; dc++) {
      if (dr === 0 && dc === 0) continue;
      const cx = (col + dc + 0.5) * cellSize;
      const cy = (row + dr + 0.5) * cellSize;
      if (isTerrainBlocked(b, cx, cy)) continue;
      const t = getTerrainAt(b, cx, cy);
      const coverScore = TERRAIN_COVER_SCORE[t] || 0;
      if (coverScore >= 15) {
        let score = coverScore;
        const dist = Math.hypot(cx - unit.x, cy - unit.y);

        // Closer is better (normalize by search area)
        const maxDist = r * cellSize;
        score += (1 - dist / maxDist) * 10;

        // Prefer cover AWAY from threat
        if (threatX !== null) {
          const threatDist = Math.hypot(cx - threatX, cy - threatY);
          const unitThreatDist = Math.hypot(unit.x - threatX, unit.y - threatY);
          // Positive when cover is farther from threat than unit currently is
          score += Math.min(15, (threatDist - unitThreatDist) / cellSize * 5);
        }

        // Prefer cover TOWARD allies (behind friendlies relative to threat)
        if (allyCount > 0) {
          const allyDist = Math.hypot(cx - allyX, cy - allyY);
          const unitAllyDist = Math.hypot(unit.x - allyX, unit.y - allyY);
          // Positive when cover is closer to ally centroid
          score += Math.min(10, (unitAllyDist - allyDist) / cellSize * 5);
        }

        // Crowding penalty: prefer cover not already occupied by friendlies
        if (friendlies) {
          for (const f of friendlies) {
            if (f === unit || f.dead) continue;
            const fdist = Math.hypot(cx - f.x, cy - f.y);
            if (fdist < cellSize * 1.5) score -= 15;
          }
        }

        if (score > bestScore) {
          bestPos = { x: cx, y: cy };
          bestScore = score;
        }
      }
    }
  }

  return bestPos;
}

// ── Spawn Validation ──────────────────────────────────────────

/**
 * Find a valid spawn position within a zone, avoiding water and blocked terrain.
 * Tries the requested offset first, then spirals outward using golden angle.
 * @param {{ x: number, y: number, radius: number }} zone - Spawn zone center + radius
 * @param {number} offsetX - Desired X offset from zone center
 * @param {number} offsetY - Desired Y offset from zone center
 * @param {object} [terrainMap] - TerrainMap for scatter-aware queries (null = skip check)
 * @returns {{ x: number, y: number }}
 */
export function findValidSpawnPos(zone, offsetX, offsetY, terrainMap) {
  const x = zone.x + offsetX;
  const y = zone.y + offsetY;

  if (!terrainMap) return { x, y };

  const result = queryTerrain(terrainMap, x, y);
  if (!result.isBlocked && !result.depth) return { x, y };

  // Spiral search within the zone for dry, unblocked land
  const maxAttempts = 20;
  for (let i = 1; i <= maxAttempts; i++) {
    const angle = i * 2.399; // Golden angle for even spread
    const dist = 20 + i * 12;
    const sx = zone.x + Math.cos(angle) * dist;
    const sy = zone.y + Math.sin(angle) * dist;

    // Stay within zone radius
    const dx = sx - zone.x;
    const dy = sy - zone.y;
    if (dx * dx + dy * dy > zone.radius * zone.radius) continue;

    const r = queryTerrain(terrainMap, sx, sy);
    if (!r.isBlocked && !r.depth) return { x: sx, y: sy };
  }

  return { x, y };
}
