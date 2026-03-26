// ═══════════════════════════════════════════════════════════════
// VISION SYSTEM — Detection, LOS, Concealment, Sound
// Used by: ai.js (buildSpottedList in updateBrain)
// ═══════════════════════════════════════════════════════════════

import { getTerrainAt } from './terrain-utils.js';
import { queryTerrain, isBridgeDeckBlocking } from './terrain-query.js';
import { logEvent } from './battle-log.js';

// ── LOS & Visibility ──────────────────────────────────────────

// Terrain visibility: how much a terrain cell reduces LOS passing through it
const TERRAIN_VISIBILITY = {
  open: 1.0,
  grass: 1.0,
  brush: 0.8,
  forest: 0.7,
  trench: 0.9,   // Low profile, doesn't block much overhead LOS
  pillbox: 0.3,  // Mostly opaque structure
  high: 0.0,     // Fully blocks LOS
  water: 1.0
};

// Concealment: how hard it is to spot a unit IN this terrain (lower = better hidden)
const TERRAIN_CONCEALMENT = {
  open: 1.0,
  grass: 0.95,
  brush: 0.8,
  forest: 0.5,
  trench: 0.3,
  pillbox: 0.2,
  water: 1.0,
  high: 1.0
};

// Step size for accumulative LOS raycast (pixels)
const LOS_STEP = 16;

/**
 * Raycast from (x1,y1) to (x2,y2) through terrain.
 * For terrainMap: 16px step accumulative raycast using point queries.
 * For legacy grids: cell-stepping with terrain visibility table.
 * Returns cumulative visibility (1.0 = clear, 0.0 = fully blocked).
 * Stops early if visibility drops below threshold.
 */
export function traceLineOfSight(b, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (b.terrainMap) {
    // Scatter-aware accumulative raycast at 16px intervals
    if (dist < LOS_STEP) return 1.0;

    const steps = Math.ceil(dist / LOS_STEP);
    let visibility = 1.0;

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const sx = x1 + dx * t;
      const sy = y1 + dy * t;
      const result = queryTerrain(b.terrainMap, sx, sy);
      // Boulders heavily reduce LOS but don't fully block (they're ground-level obstacles,
      // elevated units like tanks can see over them; the ray may clip an edge)
      if (result.hasBoulder) {
        visibility *= 0.15;
        if (visibility < 0.1) return 0;
        continue; // Skip normal terrain vis for this step — boulder dominates
      }
      // Per-step visibility derived from terrain losRange — no softening needed.
      // At full forest coverage (losRange 350), LOS drops to 0.1 after ~350px.
      visibility *= result.visibility;
      if (visibility < 0.1) return 0;
    }
    return visibility;
  }

  // Legacy grid path
  const cellSize = b.cellSize || 64;
  if (dist < cellSize) return 1.0;

  const steps = Math.ceil(dist / cellSize);
  let visibility = 1.0;

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const sx = x1 + dx * t;
    const sy = y1 + dy * t;
    const terrain = getTerrainAt(b, sx, sy);
    visibility *= (TERRAIN_VISIBILITY[terrain] ?? 1.0);
    if (visibility < 0.1) return 0;
  }
  return visibility;
}

/**
 * Check if there is usable line of sight between two points.
 * Returns true if visibility > 0.1 (not fully blocked).
 */
export function hasLineOfSight(b, x1, y1, x2, y2) {
  return traceLineOfSight(b, x1, y1, x2, y2) > 0.1;
}

/**
 * Trace a ray from (x1,y1) in a given direction, returning the distance
 * at which visibility drops below 0.1 (or maxRange if clear).
 * Used for building vision polygons.
 */
function traceViewRay(b, x1, y1, angle, maxRange) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const step = LOS_STEP;
  const steps = Math.ceil(maxRange / step);
  let visibility = 1.0;

  if (b.terrainMap) {
    for (let i = 1; i <= steps; i++) {
      const d = Math.min(i * step, maxRange);
      const sx = x1 + cos * d;
      const sy = y1 + sin * d;
      const result = queryTerrain(b.terrainMap, sx, sy);
      if (result.hasBoulder) {
        visibility *= 0.15;
        if (visibility < 0.1) return d;
        continue;
      }
      // Per-step visibility derived from terrain losRange — no softening needed.
      visibility *= result.visibility;
      if (visibility < 0.1) return d;
    }
  } else {
    const cellSize = b.cellSize || 64;
    for (let i = 1; i <= steps; i++) {
      const d = Math.min(i * step, maxRange);
      const sx = x1 + cos * d;
      const sy = y1 + sin * d;
      const terrain = getTerrainAt(b, sx, sy);
      visibility *= (TERRAIN_VISIBILITY[terrain] ?? 1.0);
      if (visibility < 0.1) return d;
    }
  }
  return maxRange;
}

/**
 * Build a vision polygon for a unit — array of {x, y} points forming
 * the visible area boundary. Casts rays in all directions, each limited
 * by LOS occlusion or maxRange.
 * @param {object} b - Battle state
 * @param {object} unit - Unit with x, y, viewRange
 * @param {number} [rayCount=72] - Number of rays (every 5° at 72)
 * @returns {Array<{x: number, y: number}>}
 */
export function buildVisionPolygon(b, unit, rayCount = 72) {
  const maxRange = unit.viewRange || 400;
  const points = [];
  const step = (Math.PI * 2) / rayCount;

  for (let i = 0; i < rayCount; i++) {
    const angle = i * step;
    const dist = traceViewRay(b, unit.x, unit.y, angle, maxRange);
    points.push({
      x: unit.x + Math.cos(angle) * dist,
      y: unit.y + Math.sin(angle) * dist
    });
  }
  return points;
}

/**
 * Get concealment score for a target unit based on terrain and state.
 * Lower = harder to spot. Range 0.08 (prone+still in pillbox) to 1.5 (firing in open).
 * Applied as multiplier to detector's effective view range.
 */
export function getConcealment(b, unit) {
  // For terrainMap: use point query cover value for concealment
  // Higher cover = lower concealment multiplier (harder to spot)
  let terrainMod = 1.0;
  if (b.terrainMap) {
    const result = queryTerrain(b.terrainMap, unit.x, unit.y);
    // Map cover (0-0.25) to concealment (1.0-0.5)
    // More cover = lower concealment = harder to spot
    terrainMod = Math.max(0.2, 1.0 - result.cover * 2);
  } else {
    const terrain = getTerrainAt(b, unit.x, unit.y);
    terrainMod = TERRAIN_CONCEALMENT[terrain] ?? 1.0;
  }

  // State modifier: what is the unit doing?
  // Per-unit signatures cached from UNIT_COMBAT_STATS (set in initBrain)
  let stateMod = 1.0;
  const now = Date.now();
  const recentlyFired = unit.lastShot && (now - unit.lastShot < 500);
  if (recentlyFired) {
    stateMod = unit._fireSignature ?? 1.4;
  } else if (unit._movedThisFrame) {
    stateMod = unit._moveSignature ?? 1.2;
  } else if (unit._isProne || unit._isHullDown) {
    stateMod = unit._proneSignature ?? 0.5;
  }

  return terrainMod * stateMod;
}

// ── Detection ─────────────────────────────────────────────────

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/**
 * Can `detector` detect `target`? Considers vision cone, range, LOS, and concealment.
 * @returns {{ detected: boolean, zone: string, distance: number, accuracy: number, concealment: number }}
 */
export function canDetect(detector, target, b) {
  // Units off-map cannot be detected or detect others
  const mapW = b?.mapWidth || 9999;
  const mapH = b?.mapHeight || 9999;
  if (target.x < 0 || target.y < 0 || target.x > mapW || target.y > mapH) {
    return { detected: false, zone: 'offmap', distance: Infinity, accuracy: 0, concealment: 1 };
  }
  // Allow detectors slightly off-map (staging area) — use generous margin
  const detectorMargin = 200;
  if (detector.x < -detectorMargin || detector.y < -detectorMargin || detector.x > mapW + detectorMargin || detector.y > mapH + detectorMargin) {
    return { detected: false, zone: 'offmap', distance: Infinity, accuracy: 0, concealment: 1 };
  }

  const dx = target.x - detector.x;
  const dy = target.y - detector.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  const viewRange = detector.viewRange || 200;
  const baseCone = (detector.viewCone || 140) * Math.PI / 180;
  const awareness = detector._awareness ?? 0.5;

  // Awareness widens forward cone by up to 40 degrees
  const effectiveCone = baseCone + awareness * (40 * Math.PI / 180);
  const halfCone = effectiveCone / 2;

  // Angle from detector's facing to target
  // Use hullAngle for detection (crew scans from hull, not gun barrel)
  const angleToTarget = Math.atan2(dy, dx);
  const facingAngle = detector.hullAngle ?? detector.angle ?? 0;
  let angleDiff = angleToTarget - facingAngle;
  // Normalize to -PI..PI
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
  const absAngle = Math.abs(angleDiff);

  // Determine zone and range multiplier
  let zone, zoneMult, accuracy;
  if (absAngle <= halfCone) {
    zone = 'forward';
    zoneMult = 1.0;
    accuracy = 1.0;
  } else if (absAngle <= Math.PI / 2) {
    zone = 'peripheral';
    zoneMult = 0.6;
    accuracy = 0.7;
  } else {
    zone = 'rear';
    zoneMult = 0.3;
    accuracy = 0.4;
  }

  // Target concealment reduces effective detection range
  let concealment = getConcealment(b, target);

  // Tracer-back: if we were recently hit, we know roughly where the shot came from.
  // The attacker's concealment is heavily reduced — muzzle flash + bullet trajectory.
  // Awareness modulates how well the unit reads the tracer direction.
  if ((detector._shockTimer ?? 0) > 0 && detector._lastAttackerId && detector._lastAttackerId === target.id) {
    const tracerBoost = 0.5 + (detector._awareness ?? 0.5) * 0.3; // 0.5-0.8 minimum concealment
    concealment = Math.max(concealment, tracerBoost);
  }

  // Effective range: concealment < 1.0 shrinks range (hidden target),
  // concealment > 1.0 extends range (moving/firing targets are more visible from farther).
  // Capped at 1.5x to prevent cross-map omniscience.
  const effectiveRange = viewRange * zoneMult * Math.min(concealment, 1.5);

  // Distance check
  if (dist > effectiveRange) {
    return { detected: false, zone, distance: dist, accuracy: 0, concealment };
  }

  // LOS check — can we see through the terrain between us?
  const losVisibility = traceLineOfSight(b, detector.x, detector.y, target.x, target.y);
  if (losVisibility < 0.1) {
    return { detected: false, zone, distance: dist, accuracy: 0, concealment };
  }

  // Bridge deck blocks vision between units on different elevation levels
  if (isBridgeDeckBlocking(b.terrainMap?.bridges, detector.x, detector.y, target.x, target.y, detector._bridgeElevation, target._bridgeElevation)) {
    return { detected: false, zone, distance: dist, accuracy: 0, concealment };
  }

  // Detected — accuracy is reduced by poor LOS and by distance
  const distFactor = 1.0 - (dist / (viewRange * zoneMult * 1.5)); // Degrades at long range
  const finalAccuracy = accuracy * Math.max(0.2, losVisibility) * Math.max(0.3, distFactor);

  return { detected: true, zone, distance: dist, accuracy: clamp01(finalAccuracy), concealment };
}

// ── Sound Detection ───────────────────────────────────────────

// Sound radii in pixels. Gunfire is loud; footsteps barely audible.
const SOUND_RANGES = {
  gunfire_light:  250,  // Small arms (infantry, specops)
  gunfire_heavy:  350,  // Heavy weapons (tanks, howitzer)
  explosion:      400,  // Explosions, artillery impact
  engine_idle:    80,   // Stationary vehicle
  engine_move:    150,  // Moving vehicle
  footsteps:      30    // Infantry on the move
};

// Map unit types to their gunfire sound category
const UNIT_SOUND_TYPE = {
  infantry: 'gunfire_light', medic: 'gunfire_light', specops: 'gunfire_light',
  jeep: 'gunfire_light', humvee: 'gunfire_light',
  sherman: 'gunfire_heavy', tiger: 'gunfire_heavy', abrams: 'gunfire_heavy',
  howitzer: 'gunfire_heavy', apache: 'gunfire_heavy'
};

/**
 * Check if `listener` can detect `source` by sound.
 * Sound is omnidirectional (no cone), gives direction + rough distance, low accuracy.
 * @returns {{ heard: boolean, direction: number, accuracy: number, soundType: string }|null}
 */
function detectBySound(listener, source, now) {
  const dx = source.x - listener.x;
  const dy = source.y - listener.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const direction = Math.atan2(dy, dx);

  // Check each sound source the target might be emitting
  // 1. Recent gunfire (within 500ms)
  const recentlyFired = source.lastShot && (now - source.lastShot < 500);
  if (recentlyFired) {
    const soundType = UNIT_SOUND_TYPE[source.unitId] || 'gunfire_light';
    const range = SOUND_RANGES[soundType] || 250;
    if (dist <= range) {
      const accuracy = 0.2 + 0.1 * (1 - dist / range); // 0.2-0.3, closer = slightly more precise
      return { heard: true, direction, accuracy, soundType, dist };
    }
  }

  // 2. Engine noise (vehicles only, continuous)
  const isVehicle = source.unitId && ['jeep', 'humvee', 'sherman', 'tiger', 'abrams', 'howitzer', 'apache'].includes(source.unitId);
  if (isVehicle && !source.dead) {
    const moving = source._movedThisFrame;
    const range = moving ? SOUND_RANGES.engine_move : SOUND_RANGES.engine_idle;
    if (dist <= range) {
      const accuracy = 0.15 + 0.1 * (1 - dist / range);
      return { heard: true, direction, accuracy, soundType: moving ? 'engine_move' : 'engine_idle', dist };
    }
  }

  // 3. Footsteps (infantry moving)
  if (!isVehicle && source._movedThisFrame && !source.dead) {
    if (dist <= SOUND_RANGES.footsteps) {
      return { heard: true, direction, accuracy: 0.15, soundType: 'footsteps', dist };
    }
  }

  return null;
}

// ── Spotted List Builder ──────────────────────────────────────

/**
 * Build the spotted list for a unit by scanning all hostiles through vision AND sound.
 * Stores results on unit._spotted[]. Preserves stale entries until they expire.
 * @param {object} unit - The detecting unit
 * @param {object[]} hostiles - All enemy units
 * @param {object} b - Battle state
 * @param {number} now - Current timestamp (Date.now())
 */
export function buildSpottedList(unit, hostiles, b, now) {
  const awareness = unit._awareness ?? 0.5;
  const staleTimeout = 2000 + awareness * 1000; // 2-3s based on awareness

  // Awareness-driven scan throttling: less aware = scan less often
  // 100ms (awareness 1.0) to 500ms (awareness 0.0)
  const scanInterval = 500 - awareness * 400;
  if (now - (unit._lastVisionScan || 0) < scanInterval) return; // Reuse cached spotted list
  unit._lastVisionScan = now;

  // Awareness-driven perception cap: how many hostiles we can process per scan
  // 2 (awareness 0.0) to 8 (awareness 1.0)
  const perceptionCap = 2 + Math.floor(awareness * 6);

  // Sort hostiles by distance (closest = highest priority for scanning)
  // Reuse a lightweight distance array to avoid sorting the full hostiles array
  const scanTargets = [];
  for (let i = 0; i < hostiles.length; i++) {
    const e = hostiles[i];
    if (e.dead || (e.hp !== undefined && e.hp <= 0)) continue;
    const dx = e.x - unit.x;
    const dy = e.y - unit.y;
    scanTargets.push({ enemy: e, distSq: dx * dx + dy * dy });
  }
  // Partial sort: only need the closest perceptionCap entries
  // For small arrays, full sort is fine; for large ones this avoids overhead
  scanTargets.sort((a, b2) => a.distSq - b2.distSq);

  const prevSpotted = unit._spotted || [];
  const prevIds = new Set(prevSpotted.map(e => e.enemy?.id));
  const freshMap = new Map(); // enemyId → spotted entry
  const logTeam = unit.team || 'blue';

  // Visual scan — limited by perception cap (closest first)
  const visualLimit = Math.min(perceptionCap, scanTargets.length);
  for (let i = 0; i < visualLimit; i++) {
    const enemy = scanTargets[i].enemy;

    const result = canDetect(unit, enemy, b);
    if (result.detected) {
      freshMap.set(enemy.id, {
        enemy,
        dist: result.distance,
        zone: result.zone,
        accuracy: result.accuracy,
        concealment: result.concealment,
        direct: true,
        timestamp: now
      });
      // Log new visual detections
      if (b && !prevIds.has(enemy.id)) {
        logEvent(b, { t: now, who: unit.id, team: logTeam, type: 'spot',
          source: 'unit', category: 'intel', severity: 'info',
          x: Math.round(unit.x), y: Math.round(unit.y),
          action: 'spotted', target: enemy.id,
          detail: `zone:${result.zone} dist:${Math.round(result.distance)} acc:${result.accuracy.toFixed(2)} conceal:${result.concealment.toFixed(2)}` });
      }
    }
  }

  // Sound detection pass — passive/cheap, runs on ALL hostiles (no cap)
  for (let i = 0; i < scanTargets.length; i++) {
    const enemy = scanTargets[i].enemy;
    if (freshMap.has(enemy.id)) continue; // Already visually spotted

    const sound = detectBySound(unit, enemy, now);
    if (sound) {
      freshMap.set(enemy.id, {
        enemy,
        dist: sound.dist,
        zone: 'sound',
        accuracy: sound.accuracy,
        concealment: 1.0,
        direct: true,
        source: 'sound',
        soundType: sound.soundType,
        direction: sound.direction,
        timestamp: now
      });
      // Log new sound detections
      if (b && !prevIds.has(enemy.id)) {
        logEvent(b, { t: now, who: unit.id, team: logTeam, type: 'sound',
          source: 'unit', category: 'intel', severity: 'info',
          x: Math.round(unit.x), y: Math.round(unit.y),
          action: 'heard', target: enemy.id,
          detail: `type:${sound.soundType} dir:${Math.round(sound.direction * 180 / Math.PI)}° dist:${Math.round(sound.dist)}` });
      }
    }
  }

  // Merge: keep previous entries that aren't refreshed (stale intel from own previous sighting)
  const merged = [];
  for (const entry of prevSpotted) {
    const fresh = freshMap.get(entry.enemy?.id);
    if (fresh) {
      merged.push(fresh); // Updated with fresh data
      freshMap.delete(entry.enemy.id);
    } else if (!entry.enemy?.dead && (now - entry.timestamp < staleTimeout)) {
      // Stale but not expired — keep with degraded accuracy
      const age = (now - entry.timestamp) / staleTimeout;
      merged.push({ ...entry, accuracy: entry.accuracy * (1 - age * 0.5), stale: true });
    }
    // Else: expired, drop it
  }

  // Add any new detections not in previous list
  for (const fresh of freshMap.values()) {
    merged.push(fresh);
  }

  unit._spotted = merged;
}
