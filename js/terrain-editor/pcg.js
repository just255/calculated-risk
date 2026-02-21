// ═══════════════════════════════════════════════════════════════
// PCG - Procedural Battlefield Generation (Stroke-Based)
// Generates terrain strokes that feed into the scatter system
// ═══════════════════════════════════════════════════════════════

import { createStroke } from '../world-builder/strokes.js';
import { createSeededRNG } from '../world-builder/rng.js';
import { BIOME_PRESETS } from '../world-builder/season-config.js';
import { PCG_RULES, getDepthClass } from './pcg-rules.js';

// Biome → default shore texture mapping
const BIOME_SHORE_DEFAULTS = {
  conifer: 'mud',
  temperate: 'mud',
  'oak-forest': 'mud',
  'birch-grove': 'dirt-3',
  wetland: 'mud',
  'dead-forest': 'mud',
  tropical: 'sand',
  desert: 'sand',
};

export const PCG_DEFAULTS = {
  seed: null,  // null = random

  // Terrain mix (rough percentages)
  openGround: 45,
  lightCover: 25,
  heavyCover: 15,
  water: 10,

  // Forest clusters (layout)
  forestCount: 12,
  forestMinRadius: 70,
  forestMaxRadius: 160,
  forestMinSpacing: 110,
  forestEdgeMargin: 40,

  // Forest placement bias (layout)
  forestFlankBias: 60,
  forestCenterAvoid: 30,

  // Forest rendering (paint tool pass-through)
  forestDensity: 1.0,        // paint tool: treeDensity (default 1.0)
  forestTreeScale: 0.35,     // paint tool: treeScale (default 0.35)
  forestTreeSpacing: 1.0,    // paint tool: treeSpacing (default 1.0)

  // Water bodies (layout)
  waterCount: 2,
  waterMinRadius: 60,
  waterMaxRadius: 140,
  waterFlankAnchor: 80,
  waterIrregularity: 60,

  // Water rendering (paint tool pass-through)
  waterMaxDepth: 50,         // max depth at center (0-100). Slider = "Max Depth"
  waterDepthFalloff: 50,     // paint tool: waterDepthFalloff (0-100)
  waterFalloff: 30,          // paint tool: waterFalloff (0-100, controls fade width)

  // Water shore (biome-driven type + variable width)
  waterShoreType: '',        // '' = biome default, or 'mud'/'sand'/'dirt-3'
  waterShoreMin: 10,         // min shore width (px) — varies per-center within body
  waterShoreMax: 30,         // max shore width (px)

  // River (layout + paint tool pass-through)
  riverEnabled: false,
  riverWidth: 50,
  riverWindiness: 50,
  riverMaxDepth: 60,         // max depth at deep sections (0-100). Slider = "Max Depth"
  riverDepthFalloff: 50,     // paint tool: waterDepthFalloff for river
  riverFalloff: 30,          // paint tool: waterFalloff for river

  // River shore (biome-driven type + variable width)
  riverShoreType: '',        // '' = biome default
  riverShoreMin: 12,         // min shore width along banks
  riverShoreMax: 28,         // max shore width along banks

  // Brush clusters (layout)
  brushCount: 16,
  brushMinRadius: 35,
  brushMaxRadius: 70,

  // Brush rendering (paint tool pass-through)
  brushDensity: 1.0,         // paint tool: brushDensity (default 1.0)
  brushScale: 0.25,          // paint tool: brushScale (default 0.25)

  // Particle scatter (per-feature density control)
  forestParticleDensity: 100, // % of default particle density for forests (0=off, 200=double)
  brushParticleDensity: 100,  // % of default particle density for brush (0=off, 200=double)

  // Ground texture (open area variation)
  groundAmount: 30,          // patch count (scaled by map area)
  groundOpenIntensity: 0.5,  // opacity of open area patches (0-1)
  groundFadeWidth: 35,       // paint tool: fadeWidth (default 12, PCG uses wider)

  // Tactical features (layout)
  chokepoints: 2,
  chokepointWidth: 80,
  approachRoutes: 3,

  // Worn paths (ground trails between spawns)
  pathEnabled: true,
  pathWidth: 30,              // base width of worn grass layer (px, scaled by map)
  pathDirtIntensity: 70,      // dirt rut visibility 0-100
  pathGrassIntensity: 75,     // grass spine visibility 0-100
  pathWindiness: 30,          // meander amount 0-100 (0=straight, 100=very winding)
  pathClearWidth: 50,         // tree/brush clearing radius along path (0=no clearing, px, scaled by map)

  // Bridge (river crossing)
  bridgeEnabled: true,
  bridgeStyle: 'wood',              // 'wood' (wood deck + truss-2) or 'stone' (stone deck, no truss)

  // Rocky ground (exposed bedrock patches in open areas)
  rockyCount: 0,              // number of rocky patches (0=off, scaled by map area)
  rockyIntensity: 50,         // visibility 0-100

  // Boulders (rock cover features, like brush but stone)
  boulderCount: 0,            // number of boulder clusters (0=off)
  boulderMinRadius: 20,       // smallest boulder cluster
  boulderMaxRadius: 50,       // largest boulder cluster

  // Water vegetation (mixed trees + brush near water)
  waterVegDensity: 50,       // 0-100 (probability of placing vegetation at each sample point)
  waterVegTreeRatio: 30,     // 0-100 (0=all brush, 100=all trees)

  // Biome / Season
  biome: 'conifer',
  season: 'summer'
};

// ═══════════════════════════════════════════════════════════════
// SPAWN ZONE PROTECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Define protected spawn zones on opposing edges
 * Orientation (top/bottom or left/right) is chosen by RNG for variety
 * Position along the edge is randomized (30%-70%) for variety
 * @returns {{x, y, radius}[]}
 */
function getSpawnZones(bounds, rng) {
  const size = Math.min(bounds.width, bounds.height) * PCG_RULES.spawn.sizeFraction;
  const inset = size * PCG_RULES.spawn.insetMultiplier;
  const vertical = rng ? rng.chance(0.5) : true;

  const [posMin, posMax] = PCG_RULES.spawn.positionRange;
  const t1 = rng ? rng.float(posMin, posMax) : 0.5;
  const t2 = rng ? rng.float(posMin, posMax) : 0.5;

  const zones = vertical
    ? [
        { x: bounds.width * t1, y: inset, radius: size },
        { x: bounds.width * t2, y: bounds.height - inset, radius: size }
      ]
    : [
        { x: inset, y: bounds.height * t1, radius: size },
        { x: bounds.width - inset, y: bounds.height * t2, radius: size }
      ];

  // Tag orientation so weight functions can adapt
  zones.orientation = vertical ? 'vertical' : 'horizontal';
  // Tag the edge fractions so river can use them
  zones.edgeFractions = [t1, t2];
  return zones;
}

/**
 * Check if a point + radius overlaps the river (any river center within range)
 */
function overlapsRiver(x, y, radius, riverCenters, riverBrushR) {
  if (riverCenters.length === 0) return false;
  const minDist = radius + riverBrushR * 1.5; // generous buffer
  for (const c of riverCenters) {
    const dx = x - c.x;
    const dy = y - c.y;
    if (dx * dx + dy * dy < minDist * minDist) return true;
  }
  return false;
}

/**
 * Check if a point + radius overlaps any spawn zone
 */
function overlapsSpawnZone(x, y, radius, spawnZones) {
  for (const zone of spawnZones) {
    const dx = x - zone.x;
    const dy = y - zone.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < zone.radius + radius) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
// MAIN GENERATION FUNCTION
// ═══════════════════════════════════════════════════════════════

const MAX_RETRIES = 5;

/**
 * Generate a complete battlefield as an array of terrain strokes
 *
 * @param {Object} params - Generation parameters (merged with PCG_DEFAULTS)
 * @param {Object} mapBounds - { width, height } in pixels
 * @returns {{ strokes: Object[], seed: number }}
 */
export function generateBattlefield(params, mapBounds) {
  const p = { ...PCG_DEFAULTS, ...params };
  let seed = p.seed ?? Math.floor(Math.random() * 999999);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const result = _generateOnce(p, mapBounds, seed);

    // Validate connectivity (use spawn zones from the generation, same rng orientation)
    const connected = validateConnectivity(result.strokes, mapBounds, result.spawnZones);
    console.log(`[PCG] Connectivity check: ${connected ? 'PASS' : 'FAIL'} (seed: ${seed}, attempt: ${attempt + 1}/${MAX_RETRIES})`);
    if (connected) {
      return result;
    }

    console.warn(`[PCG] Seed ${seed} failed connectivity check, retrying...`);
    seed = seed + 1;
  }

  // Last attempt — return regardless
  console.warn(`[PCG] All ${MAX_RETRIES} retries failed connectivity, using last result`);
  return _generateOnce(p, mapBounds, seed);
}

// Reference map area: 24×24 grid at cellSize 64 = 1536×1536 pixels
const REF_AREA = 1536 * 1536;

function _generateOnce(p, mapBounds, seed) {
  const rng = createSeededRNG(seed);
  const { width, height } = mapBounds;
  const bounds = { width, height };

  // Scale params relative to map area so bigger maps get proportionally more features
  const mapArea = width * height;
  const areaRatio = mapArea / REF_AREA;           // >1 for larger maps, <1 for smaller
  const countScale = Math.max(0.5, areaRatio);     // scale counts by area (min 50%)

  p = { ...p };  // don't mutate the original
  // Scale counts only — bigger maps get more features, not bigger features
  p.forestCount = Math.max(p.forestCount > 0 ? 1 : 0, Math.round(p.forestCount * countScale));
  p.waterCount = Math.max(p.waterCount > 0 ? 1 : 0, Math.round(p.waterCount * countScale));
  p.brushCount = Math.max(p.brushCount > 0 ? 1 : 0, Math.round(p.brushCount * countScale));
  p.chokepoints = Math.max(p.chokepoints > 0 ? 1 : 0, Math.round(p.chokepoints * countScale));
  // Feature sizes stay constant — a path is a path regardless of map size

  // Get biome config for tree/brush types
  const biome = BIOME_PRESETS[p.biome] || BIOME_PRESETS.conifer;

  // Spawn zones — exclusion areas for terrain features (orientation chosen by rng)
  const spawnZones = getSpawnZones(bounds, rng);

  const strokes = [];

  // ── Phase 2a: River (before still water so lakes can overlap) ──
  const riverResult = placeRiver(rng, p, bounds, spawnZones);
  const riverStrokes = riverResult.strokes;
  const riverData = riverResult.riverData;
  strokes.push(...riverStrokes);

  // ── Phase 2b: Water bodies (avoid river) ──────────────────
  const waterStrokes = placeWaterBodies(rng, p, bounds, spawnZones, riverStrokes);
  strokes.push(...waterStrokes);

  // ── Phase 2c: Bridge nearby water bodies ─────────────────
  const waterBridgeStrokes = bridgeWaterBodies(rng, waterStrokes, p);
  strokes.push(...waterBridgeStrokes);

  // ── Phase 3: Forest clusters (with satellites) ─────────────
  const forestStrokes = placeForestClusters(rng, p, bounds, biome, spawnZones);
  strokes.push(...forestStrokes);

  // ── Phase 3b: Forest tree lines (elongated features) ───────
  const treeLineStrokes = placeTreeLines(rng, p, bounds, biome, spawnZones, forestStrokes);
  strokes.push(...treeLineStrokes);

  // ── Phase 3c: Forest bridging (connect nearby forests) ─────
  const allForestSoFar = [...forestStrokes, ...treeLineStrokes];
  const bridgeStrokes = bridgeForests(rng, allForestSoFar, biome, spawnZones, p);
  strokes.push(...bridgeStrokes);

  // ── Phase 3.5: Water vegetation (trees + brush near water) ─
  const waterVegStrokes = placeWaterVegetation(rng, p, bounds, biome, spawnZones,
    riverData, waterStrokes);
  strokes.push(...waterVegStrokes);

  // ── Phase 4: Brush clusters ────────────────────────────────
  const brushStrokes = placeBrushClusters(rng, p, bounds, biome, allForestSoFar, spawnZones);
  strokes.push(...brushStrokes);

  // ── Phase 5: Chokepoint extensions ─────────────────────────
  const allWater = [...riverStrokes, ...waterStrokes, ...waterBridgeStrokes];
  const allForest = [...allForestSoFar, ...bridgeStrokes];
  const chokeStrokes = createChokepoints(rng, p, bounds, biome, allForest, allWater, spawnZones);
  strokes.push(...chokeStrokes);

  // ── Phase 6: Approach cover (brush trails from spawns) ─────
  const existingCover = [...allForest, ...brushStrokes];
  const approachStrokes = placeApproachCover(rng, bounds, biome, spawnZones, existingCover, p);
  strokes.push(...approachStrokes);

  // ── Phase 7: Cover balancing (equalize both sides) ─────────
  const balanceStrokes = balanceCover(rng, bounds, biome, spawnZones, strokes, p);
  strokes.push(...balanceStrokes);

  // ── Phase 8: Forest/brush floor textures ─────────────────────
  // Ground textures (dirt, forest-floor) under canopy for natural look.
  // Sprite-based floor is disabled; these use the groundTexture system with noise alpha.
  const allForestFinal = [...allForest, ...chokeStrokes, ...balanceStrokes.filter(s => s.treeTypes)];
  const allBrushFinal = [...brushStrokes, ...approachStrokes, ...balanceStrokes.filter(s => s.brushTypes)];
  const floorStrokes = placeForestFloor(rng, p.biome, allForestFinal, allBrushFinal);
  strokes.unshift(...floorStrokes);

  // ── Phase 9: Open area ground textures ───────────────────────
  // Break up base grass tiling with random texture variation.
  const groundStrokes = placeGroundTextures(rng, p, bounds);
  strokes.unshift(...groundStrokes);

  // ── Phase 10: Rocky ground (exposed bedrock in open areas) ──
  const allCover = [...allForestFinal, ...allBrushFinal, ...chokeStrokes];
  const rockyStrokes = placeRockyGround(rng, p, bounds, allCover, spawnZones);
  strokes.unshift(...rockyStrokes);

  // ── Phase 11: Worn paths (trails between spawns) ────────────
  const pathResult = placePaths(rng, p, bounds, spawnZones, allForestFinal, allBrushFinal, riverData);
  const pathStrokes = pathResult.strokes;
  const pathSpines = pathResult.spines;
  strokes.unshift(...pathStrokes);

  // ── Phase 12: Boulders (rock cover features) ────────────────
  const boulderStrokes = placeBoulders(rng, p, bounds, biome, spawnZones, allCover, rockyStrokes);
  strokes.push(...boulderStrokes);

  // Count satellites (forest strokes beyond the primary count from Poisson)
  const primaryCount = p.forestCount;
  const clusterForest = forestStrokes.length;
  const satelliteCount = clusterForest - Math.min(primaryCount, clusterForest);

  // Generation stats for verification
  const stats = {
    mapScale: `${(countScale).toFixed(2)}x area`,
    spawnOrientation: spawnZones.orientation || 'vertical',
    spawnZones: spawnZones.length,
    ground: groundStrokes.length,
    floor: floorStrokes.length,
    river: riverStrokes.length,
    riverDepth: riverData ? riverData.depthClassName : 'none',
    riverBridge: riverData && riverData.bridge ? 1 : 0,
    water: waterStrokes.length,
    waterVeg: waterVegStrokes.length,
    waterBridges: waterBridgeStrokes.length,
    forestClusters: clusterForest,
    forestPrimaries: clusterForest - satelliteCount,
    forestSatellites: satelliteCount,
    treeLines: treeLineStrokes.length,
    bridges: bridgeStrokes.length,
    brush: brushStrokes.length,
    approach: approachStrokes.length,
    balance: balanceStrokes.length,
    chokepoints: chokeStrokes.length,
    rocky: rockyStrokes.length,
    paths: pathStrokes.length,
    boulders: boulderStrokes.length,
    total: strokes.length
  };

  console.log('[PCG] Generation stats:', stats);

  const pathData = { spines: pathSpines, clearWidth: (p.pathClearWidth ?? 0) };
  return { strokes, seed, stats, spawnZones, riverData, pathData };
}

// ═══════════════════════════════════════════════════════════════
// POISSON DISK SAMPLING
// ═══════════════════════════════════════════════════════════════

/**
 * Poisson disk sampling - places points with minimum spacing
 * @param {Object} rng - Seeded RNG helper
 * @param {Object} bounds - { width, height }
 * @param {number} minSpacing - Minimum distance between points
 * @param {number} maxPoints - Maximum number of points
 * @param {number} margin - Edge margin (pixels)
 * @param {Function} [weightFn] - Optional position weighting function (x,y) => 0-1
 * @param {Array} [spawnZones] - Exclusion zones to avoid
 * @returns {{x: number, y: number}[]}
 */
function poissonDiskSample(rng, bounds, minSpacing, maxPoints, margin, weightFn, spawnZones) {
  const points = [];
  const cellSize = minSpacing / Math.SQRT2;
  const gridW = Math.ceil(bounds.width / cellSize);
  const gridH = Math.ceil(bounds.height / cellSize);
  const grid = new Array(gridW * gridH).fill(-1);
  const active = [];

  // D1: More attempts when weight function causes rejections
  const maxAttempts = weightFn ? 60 : 30;

  function gridIndex(x, y) {
    const gx = Math.floor(x / cellSize);
    const gy = Math.floor(y / cellSize);
    if (gx < 0 || gx >= gridW || gy < 0 || gy >= gridH) return -1;
    return gy * gridW + gx;
  }

  function isValid(x, y) {
    if (x < margin || x > bounds.width - margin) return false;
    if (y < margin || y > bounds.height - margin) return false;

    // A3: Reject points in spawn zones
    if (spawnZones && overlapsSpawnZone(x, y, 0, spawnZones)) return false;

    const gx = Math.floor(x / cellSize);
    const gy = Math.floor(y / cellSize);

    // Check 5x5 neighborhood
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
        const idx = ny * gridW + nx;
        if (grid[idx] === -1) continue;
        const other = points[grid[idx]];
        const dist = Math.hypot(x - other.x, y - other.y);
        if (dist < minSpacing) return false;
      }
    }
    return true;
  }

  function addPoint(x, y) {
    const idx = gridIndex(x, y);
    if (idx === -1) return false;
    const i = points.length;
    points.push({ x, y });
    grid[idx] = i;
    active.push(i);
    return true;
  }

  // Seed with first point
  const startX = margin + rng.random() * (bounds.width - margin * 2);
  const startY = margin + rng.random() * (bounds.height - margin * 2);
  addPoint(startX, startY);

  while (active.length > 0 && points.length < maxPoints) {
    const activeIdx = rng.int(0, active.length - 1);
    const point = points[active[activeIdx]];
    let found = false;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const angle = rng.random() * Math.PI * 2;
      const dist = minSpacing + rng.random() * minSpacing;
      const nx = point.x + Math.cos(angle) * dist;
      const ny = point.y + Math.sin(angle) * dist;

      if (!isValid(nx, ny)) continue;

      // Apply weight function - reject low-weight positions
      if (weightFn) {
        const weight = weightFn(nx, ny);
        if (rng.random() > weight) continue;
      }

      addPoint(nx, ny);
      found = true;
      break;
    }

    if (!found) {
      active.splice(activeIdx, 1);
    }
  }

  return points;
}

// ═══════════════════════════════════════════════════════════════
// GROUND TEXTURES
// ═══════════════════════════════════════════════════════════════

function placeGroundTextures(rng, params, bounds) {
  const strokes = [];
  const { width, height } = bounds;
  const mapArea = width * height;
  const areaRatio = mapArea / REF_AREA;

  const count = Math.max(0, Math.round((params.groundAmount ?? 10) * areaRatio));
  if (count === 0) return strokes;

  const intensity = params.groundOpenIntensity ?? 0.4;
  const biome = params.biome || 'conifer';
  const wetTexture = (biome === 'desert' || biome === 'tropical') ? 'sand' : 'mud';
  const textureTypes = ['grass-1', 'dirt-3', wetTexture];

  for (let i = 0; i < count; i++) {
    const px = rng.float(width * 0.02, width * 0.98);
    const py = rng.float(height * 0.02, height * 0.98);
    const r = rng.float(100, 300);
    const texture = rng.pick(textureTypes);

    strokes.push(createStroke('groundTexture', px, py, r, {
      textureType: texture,
      fadeWidth: r * rng.float(0.35, 0.55),
      intensity: intensity * rng.float(0.8, 1.2),
      noiseAlpha: true,
      seed: rng.int(0, 999999)
    }));
  }

  return strokes;
}

// ═══════════════════════════════════════════════════════════════
// FOREST/BRUSH FLOOR TEXTURES
// Ground textures (dirt, forest-floor, etc.) placed under canopy areas.
// Uses the groundTexture stroke system with noise alpha for patchy appearance.
// ═══════════════════════════════════════════════════════════════

/** Biome → floor texture palette */
const BIOME_FLOOR_TEXTURES = {
  conifer:       ['forest-floor', 'dirt-3', 'dirt-2'],
  temperate:     ['forest-floor', 'dirt-3', 'dirt-4'],
  'birch-grove': ['forest-floor', 'dirt-3', 'dirt-2'],
  wetland:       ['mud', 'dirt-3', 'forest-floor'],
  'dead-forest': ['dirt-2', 'dirt-3', 'dirt-4'],
  mixed:         ['forest-floor', 'dirt-3', 'dirt-4']
};

/**
 * Generate ground texture strokes under forest and brush cluster footprints.
 * Each forest/brush stroke gets a slightly smaller ground texture underneath
 * with noise alpha for a natural patchy appearance.
 *
 * @param {Object} rng - Seeded RNG
 * @param {string} biomeName - Biome key for texture palette
 * @param {Array} forestStrokes - All forest strokes (clusters, lines, bridges, chokes, balance)
 * @param {Array} brushStrokes - All brush strokes (clusters, approach)
 * @returns {Array} groundTexture strokes to render under canopy
 */
function placeForestFloor(rng, biomeName, forestStrokes, brushStrokes) {
  const strokes = [];
  const textures = BIOME_FLOOR_TEXTURES[biomeName] || BIOME_FLOOR_TEXTURES.conifer;

  // Forest clusters — each stroke gets a floor texture
  for (const fs of forestStrokes) {
    // Slightly smaller radius so texture stays under canopy
    const r = fs.radius * rng.float(0.75, 0.9);
    const texture = rng.pick(textures);

    strokes.push(createStroke('groundTexture', fs.x, fs.y, r, {
      textureType: texture,
      fadeWidth: r * rng.float(0.4, 0.6),
      intensity: rng.float(0.3, 0.55),
      noiseAlpha: true,
      seed: rng.int(0, 999999)
    }));
  }

  // Brush clusters — lighter floor texture
  for (const bs of brushStrokes) {
    // Brush gets smaller, more subtle floor
    const r = bs.radius * rng.float(0.6, 0.8);
    const texture = rng.pick(textures);

    strokes.push(createStroke('groundTexture', bs.x, bs.y, r, {
      textureType: texture,
      fadeWidth: r * rng.float(0.45, 0.65),
      intensity: rng.float(0.2, 0.4),
      noiseAlpha: true,
      seed: rng.int(0, 999999)
    }));
  }

  return strokes;
}

// ═══════════════════════════════════════════════════════════════
// WORN PATHS (layered ground trails between spawn zones)
// Layer 1: wider "worn grass" using lighter grass texture
// Layer 2: narrower dirt center showing exposed earth
// ═══════════════════════════════════════════════════════════════

/**
 * Generate worn path strokes between spawn zones.
 * Primary path: spawn-to-spawn with gentle meander.
 * Secondary trails: branch from primary toward nearby cover.
 */
function placePaths(rng, params, bounds, spawnZones, allForest, allBrush, riverData) {
  const strokes = [];
  const spines = [];  // collected for post-gen clearing
  if (!params.pathEnabled || !spawnZones || spawnZones.length < 2) return { strokes, spines };

  const { width, height } = bounds;
  const linScale = Math.sqrt((width * height) / REF_AREA);
  const baseWidth = (params.pathWidth ?? 40);
  const dirtInt = (params.pathDirtIntensity ?? 70) / 100;
  const grassInt = (params.pathGrassIntensity ?? 50) / 100;
  if (dirtInt <= 0 && grassInt <= 0) return { strokes, spines };

  const windiness = (params.pathWindiness ?? 30) / 100;
  const isVertical = spawnZones.orientation !== 'horizontal';

  // Build river exclusion zone (skip ground textures inside river)
  const riverZone = riverData ? { spine: riverData.spine, radius: riverData.brushRadius } : null;

  // ── Spawn zone ground textures (blend path ends naturally) ─
  for (const zone of spawnZones) {
    const zoneR = zone.radius * rng.float(0.6, 0.8);
    strokes.push(createStroke('groundTexture', zone.x, zone.y, zoneR, {
      textureType: rng.pick(['grass-2', 'grass-3']),
      fadeWidth: zoneR * 0.5,
      intensity: grassInt * 0.5,
      noiseAlpha: true,
      seed: rng.int(0, 999999)
    }));
    const dirtR = zoneR * 0.4;
    strokes.push(createStroke('groundTexture', zone.x, zone.y, dirtR, {
      textureType: 'dirt-3',
      fadeWidth: dirtR * 0.4,
      intensity: dirtInt * 0.6,
      noiseAlpha: true,
      seed: rng.int(0, 999999)
    }));
  }

  // ── Primary path: spawn to spawn, extending to map edges ──
  const s1 = spawnZones[0];
  const s2 = spawnZones[1];

  // Extend start/end past spawns to the map edge so path bleeds off-screen
  const dx = s2.x - s1.x;
  const dy = s2.y - s1.y;
  const len = Math.hypot(dx, dy) || 1;
  const dirX = dx / len;
  const dirY = dy / len;
  const bleed = baseWidth * 2;
  const edgeStart = { x: s1.x - dirX * (s1.radius + bleed), y: s1.y - dirY * (s1.radius + bleed) };
  const edgeEnd = { x: s2.x + dirX * (s2.radius + bleed), y: s2.y + dirY * (s2.radius + bleed) };

  const perpX = isVertical ? 1 : 0;
  const perpY = isVertical ? 0 : 1;
  const maxOffset = Math.min(width, height) * 0.2 * windiness;
  const spacing = baseWidth * 0.45;

  // Build control points — route through bridge crossing if river blocks path
  // Check if the direct spawn-to-spawn line crosses the river
  let riverBlocksPath = false;
  let crossingPoint = null;
  if (riverData && riverData.spine && riverData.spine.length > 0) {
    const rSpine = riverData.spine;
    const rR = riverData.brushRadius;
    // Sample a few points along the s1→s2 line and check river proximity
    for (let t = PCG_RULES.path.riverProbeRange[0]; t <= PCG_RULES.path.riverProbeRange[1]; t += PCG_RULES.path.riverProbeStep) {
      const px = s1.x + dx * t;
      const py = s1.y + dy * t;
      for (const rp of rSpine) {
        if (Math.hypot(px - rp.x, py - rp.y) < rR * PCG_RULES.path.riverProbeThreshold) {
          riverBlocksPath = true;
          break;
        }
      }
      if (riverBlocksPath) break;
    }

    // Find crossing point: spine point closest to midpoint between spawns
    if (riverBlocksPath) {
      const midX = (s1.x + s2.x) / 2;
      const midY = (s1.y + s2.y) / 2;
      let bestDist = Infinity;
      let bestIdx = 0;
      for (let si = 0; si < rSpine.length; si++) {
        const d = Math.hypot(rSpine[si].x - midX, rSpine[si].y - midY);
        if (d < bestDist) { bestDist = d; bestIdx = si; }
      }
      crossingPoint = { ...rSpine[bestIdx] };

      // Get spine direction at crossing for bridge orientation
      const prev = rSpine[Math.max(0, bestIdx - 1)];
      const next = rSpine[Math.min(rSpine.length - 1, bestIdx + 1)];
      const sdx = next.x - prev.x;
      const sdy = next.y - prev.y;
      const sLen = Math.hypot(sdx, sdy) || 1;
      crossingPoint.spineDirX = sdx / sLen;
      crossingPoint.spineDirY = sdy / sLen;
      // Perpendicular to spine = bridge direction
      crossingPoint.bridgeDirX = -sdy / sLen;
      crossingPoint.bridgeDirY = sdx / sLen;
    }
  }

  const controlPoints = [edgeStart, { x: s1.x, y: s1.y }];

  if (riverBlocksPath && crossingPoint) {
    // Helper: check if a point is inside the river (reject waypoints that wander into it)
    const rSpine = riverData.spine;
    const rR = riverData.brushRadius * PCG_RULES.path.riverExclusionZone;
    const nearRiver = (px, py) => rSpine.some(rp => Math.hypot(px - rp.x, py - rp.y) < rR);

    // t = how far along the s1→s2 line the crossing falls (0-1)
    const crossT = ((crossingPoint.x - s1.x) * dx + (crossingPoint.y - s1.y) * dy) / (len * len);

    // Reduced offset near river — keep path more direct
    const bridgeOffset = maxOffset * 0.4;

    // Waypoints before crossing (s1 side) — avoid river
    const preCount = rng.int(1, 2);
    for (let i = 1; i <= preCount; i++) {
      const t = (crossT * i) / (preCount + 1);
      const bx = s1.x + dx * t;
      const by = s1.y + dy * t;
      let wx = bx + perpX * rng.float(-bridgeOffset, bridgeOffset);
      let wy = by + perpY * rng.float(-bridgeOffset, bridgeOffset);
      if (nearRiver(wx, wy)) { wx = bx; wy = by; }
      controlPoints.push({ x: wx, y: wy });
    }

    // Approach point just before crossing (on s1 side of river)
    const approachDist = (riverData.brushRadius + baseWidth) * PCG_RULES.path.approachDistanceMultiplier;
    controlPoints.push({
      x: crossingPoint.x - dirX * approachDist,
      y: crossingPoint.y - dirY * approachDist
    });

    // Bridge crossing point
    controlPoints.push({ x: crossingPoint.x, y: crossingPoint.y });

    // Exit point just after crossing (on s2 side of river)
    controlPoints.push({
      x: crossingPoint.x + dirX * approachDist,
      y: crossingPoint.y + dirY * approachDist
    });

    // Waypoints after crossing (s2 side) — avoid river
    const postCount = rng.int(1, 2);
    for (let i = 1; i <= postCount; i++) {
      const t = crossT + ((1 - crossT) * i) / (postCount + 1);
      const bx = s1.x + dx * t;
      const by = s1.y + dy * t;
      let wx = bx + perpX * rng.float(-bridgeOffset, bridgeOffset);
      let wy = by + perpY * rng.float(-bridgeOffset, bridgeOffset);
      if (nearRiver(wx, wy)) { wx = bx; wy = by; }
      controlPoints.push({ x: wx, y: wy });
    }
  } else {
    // No river crossing — simple meandering waypoints
    const waypointCount = rng.int(3, 5);
    for (let i = 1; i <= waypointCount; i++) {
      const t = i / (waypointCount + 1);
      const baseX = s1.x + dx * t;
      const baseY = s1.y + dy * t;
      controlPoints.push({
        x: baseX + perpX * rng.float(-maxOffset, maxOffset),
        y: baseY + perpY * rng.float(-maxOffset, maxOffset)
      });
    }
  }

  controlPoints.push({ x: s2.x, y: s2.y }, edgeEnd);

  // Sample spine with Catmull-Rom
  const spine = sampleCatmullRom(controlPoints, spacing);

  // Generate three-layer strokes along primary path (skipping river zone)
  _pathToStrokes(rng, spine, baseWidth, dirtInt, grassInt, strokes, riverZone);

  // ── Bridge at river crossing ──
  // Bridge deck is NOT a stroke — it's rendered by the renderer after water
  // Derive bridge endpoints from actual path-spine intersection with river zone
  if (riverBlocksPath && crossingPoint && params.bridgeEnabled) {
    // Hit radius = water edge + shore so bridge spans the full visual river
    const shoreMax = params.riverShoreMax ?? 28;
    const hitR = riverData.brushRadius + shoreMax;
    let entryIdx = -1, exitIdx = -1;

    // Walk the path spine to find first/last points inside water+shore zone
    for (let i = 0; i < spine.length; i++) {
      const pt = spine[i];
      for (const rp of riverData.spine) {
        if (Math.hypot(pt.x - rp.x, pt.y - rp.y) < hitR) {
          if (entryIdx === -1) entryIdx = i;
          exitIdx = i;
          break;
        }
      }
    }

    if (entryIdx !== -1 && exitIdx !== -1 && exitIdx > entryIdx) {
      const entry = spine[entryIdx];
      const exit = spine[exitIdx];
      const cx = (entry.x + exit.x) / 2;
      const cy = (entry.y + exit.y) / 2;
      const rawLen = Math.hypot(exit.x - entry.x, exit.y - entry.y);

      // Direction from entry to exit (along the path across the river)
      const bdx = exit.x - entry.x;
      const bdy = exit.y - entry.y;
      const bLen = Math.hypot(bdx, bdy) || 1;
      const dxN = bdx / bLen, dyN = bdy / bLen;

      // Perpendicular to bridge direction (for computing corners)
      const perpX = -dyN, perpY = dxN;
      const deckHalfW = (baseWidth * 2.8) / 2;

      // Check all 4 corners of the deck rectangle are on dry land.
      // Extend overhang until corners clear the river+shore zone.
      const isWet = (px, py) => {
        for (const rp of riverData.spine) {
          if (Math.hypot(px - rp.x, py - rp.y) < hitR) return true;
        }
        return false;
      };

      // Walk the spine backward/forward from entry/exit to find deck endpoints
      // on the actual path curve, not projected straight from the bridge direction.
      const walkSpine = (fromIdx, dist, direction) => {
        // direction: -1 = backward (toward start), +1 = forward (toward end)
        let remaining = dist;
        let idx = fromIdx;
        while (remaining > 0) {
          const nextIdx = idx + direction;
          if (nextIdx < 0 || nextIdx >= spine.length) break;
          const segLen = Math.hypot(
            spine[nextIdx].x - spine[idx].x,
            spine[nextIdx].y - spine[idx].y
          );
          if (segLen >= remaining) {
            // Interpolate within this segment
            const t = remaining / segLen;
            return {
              x: spine[idx].x + (spine[nextIdx].x - spine[idx].x) * t,
              y: spine[idx].y + (spine[nextIdx].y - spine[idx].y) * t
            };
          }
          remaining -= segLen;
          idx = nextIdx;
        }
        // Ran out of spine — use the last reachable point
        return { x: spine[idx].x, y: spine[idx].y };
      };

      let overhang = baseWidth * PCG_RULES.bridge.overhang;
      let deckStart, deckEnd;
      for (let attempt = 0; attempt < 10; attempt++) {
        deckStart = walkSpine(entryIdx, overhang, -1);
        deckEnd = walkSpine(exitIdx, overhang, +1);

        // Recompute perpendicular from actual deck endpoints
        const edx = deckEnd.x - deckStart.x;
        const edy = deckEnd.y - deckStart.y;
        const eLen = Math.hypot(edx, edy) || 1;
        const ePerpX = -edy / eLen, ePerpY = edx / eLen;

        // 4 corners of the deck rectangle
        const corners = [
          { x: deckStart.x + ePerpX * deckHalfW, y: deckStart.y + ePerpY * deckHalfW },
          { x: deckStart.x - ePerpX * deckHalfW, y: deckStart.y - ePerpY * deckHalfW },
          { x: deckEnd.x + ePerpX * deckHalfW, y: deckEnd.y + ePerpY * deckHalfW },
          { x: deckEnd.x - ePerpX * deckHalfW, y: deckEnd.y - ePerpY * deckHalfW },
        ];
        if (corners.every(c => !isWet(c.x, c.y))) break;
        overhang += baseWidth * 0.3; // extend further
      }

      // Derive deck texture and truss from bridge style
      const style = params.bridgeStyle || 'wood';

      // Stone bridges extend further onto dry land to simulate anchor abutments
      if (style === 'stone') {
        const anchorExtra = overhang * (PCG_RULES.bridge.stoneAnchor - 1);
        deckStart = walkSpine(entryIdx, overhang + anchorExtra, -1);
        deckEnd = walkSpine(exitIdx, overhang + anchorExtra, +1);
      }

      // Derive bridge geometry from actual spine-based endpoints
      const finalDx = deckEnd.x - deckStart.x;
      const finalDy = deckEnd.y - deckStart.y;
      const bridgeLength = Math.hypot(finalDx, finalDy);
      const finalLen = bridgeLength || 1;
      const finalDirX = finalDx / finalLen;
      const finalDirY = finalDy / finalLen;
      const isWood = style === 'wood';

      riverData.bridge = {
        x: (deckStart.x + deckEnd.x) / 2,
        y: (deckStart.y + deckEnd.y) / 2,
        startX: deckStart.x,
        startY: deckStart.y,
        endX: deckEnd.x,
        endY: deckEnd.y,
        width: baseWidth * 3.5,
        length: bridgeLength,
        dirX: finalDirX,
        dirY: finalDirY,
        deckTexture: isWood ? 'bridge-wood' : 'bridge-stone',
        trussEnabled: isWood,
        trussVariant: 2,               // only style 2 used for wood
      };

      console.log(`[PCG River] bridge start=(${deckStart.x.toFixed(0)},${deckStart.y.toFixed(0)}) end=(${deckEnd.x.toFixed(0)},${deckEnd.y.toFixed(0)}) len=${bridgeLength.toFixed(0)} overhang=${overhang.toFixed(0)} dir=(${finalDirX.toFixed(2)},${finalDirY.toFixed(2)})`);
    }
  }
  spines.push({ points: spine, width: baseWidth });

  // ── Secondary trails: branch toward nearby cover ──────────
  const coverFeatures = [...allForest, ...allBrush];
  const branchCount = rng.int(2, 4);
  const usedFeatures = new Set();

  for (let b = 0; b < branchCount && coverFeatures.length > 0; b++) {
    // Pick a random point along the primary spine (25%-75% along)
    const spineIdx = Math.floor(rng.float(0.25, 0.75) * spine.length);
    const branchStart = spine[spineIdx];

    // Find nearest unused cover feature within range
    let bestFeature = null;
    let bestDist = Infinity;
    const maxBranchDist = Math.min(width, height) * 0.3;

    for (let f = 0; f < coverFeatures.length; f++) {
      if (usedFeatures.has(f)) continue;
      const cf = coverFeatures[f];
      const d = Math.hypot(cf.x - branchStart.x, cf.y - branchStart.y);
      if (d < bestDist && d < maxBranchDist && d > cf.radius) {
        bestDist = d;
        bestFeature = f;
      }
    }

    if (bestFeature === null) continue;
    usedFeatures.add(bestFeature);

    const target = coverFeatures[bestFeature];
    // Aim for the edge of the cover feature, not the center
    const angle = Math.atan2(target.y - branchStart.y, target.x - branchStart.x);
    const endX = target.x - Math.cos(angle) * target.radius * 0.6;
    const endY = target.y - Math.sin(angle) * target.radius * 0.6;

    // Simple 2-point branch with slight offset
    const bMidX = (branchStart.x + endX) / 2 + rng.float(-30, 30) * linScale;
    const bMidY = (branchStart.y + endY) / 2 + rng.float(-30, 30) * linScale;
    const branchCP = [branchStart, { x: bMidX, y: bMidY }, { x: endX, y: endY }];
    const branchSpine = sampleCatmullRom(branchCP, spacing);

    // Secondary trails are narrower and more subtle
    _pathToStrokes(rng, branchSpine, baseWidth * 0.65, dirtInt * 0.7, grassInt * 0.7, strokes, riverZone);
    spines.push({ points: branchSpine, width: baseWidth * 0.65 });
  }

  return { strokes, spines };
}

/**
 * Convert a path spine into three-layer groundTexture strokes.
 * Layer 1: Dirt wheel ruts (full path width)
 * Layer 2: Dark edge shadow where dirt meets grass
 * Layer 3: Grass spine between the ruts
 * Skips strokes that fall inside a river zone.
 */
function _pathToStrokes(rng, spine, width, dirtInt, grassInt, strokes, riverZone) {
  // Helper: check if point is inside river
  const inRiver = riverZone ? (pt) => {
    for (const rp of riverZone.spine) {
      if (Math.hypot(pt.x - rp.x, pt.y - rp.y) < riverZone.radius * 0.9) return true;
    }
    return false;
  } : () => false;

  // Layer 1: Dirt wheel ruts (full path width)
  if (dirtInt > 0) {
    for (const pt of spine) {
      if (inRiver(pt)) continue;
      strokes.push(createStroke('groundTexture', pt.x, pt.y, width, {
        textureType: rng.pick(['dirt-3', 'dirt-4']),
        fadeWidth: 12,
        intensity: dirtInt,
        isPath: true,
        seed: rng.int(0, 999999)
      }));
    }
  }

  // Layer 2: Dark edge shadow (slightly wider than dirt, very low intensity)
  // Creates a thin dark border where ruts meet surrounding grass
  if (dirtInt > 0) {
    const shadowWidth = width * 1.12;
    for (const pt of spine) {
      if (inRiver(pt)) continue;
      strokes.push(createStroke('groundTexture', pt.x, pt.y, shadowWidth, {
        textureType: 'forest-floor',
        fadeWidth: 4,
        intensity: dirtInt * 0.3,
        isPath: true,
        seed: rng.int(0, 999999)
      }));
    }
  }

  // Layer 3: Grass spine between the ruts — narrow strip with frequent breaks
  if (grassInt > 0) {
    const grassWidth = width * 0.3;  // narrow — stays between the ruts
    const grassTextures = ['grass-2', 'grass-3'];
    let currentTexture = rng.pick(grassTextures);
    let currentSeed = rng.int(0, 999999);
    let inBreak = false;
    let breakCounter = 0;
    let segmentCounter = 0;
    // Long continuous segments (15-30 points) with short breaks (1-2 points)
    let nextBreakAt = rng.int(15, 30);
    let breakLength = rng.int(1, 2);
    const FADE_POINTS = 3; // points at each end of a segment that fade in/out

    // Build denser point array by interpolating midpoints between spine points
    // so the narrow grass circles overlap instead of leaving gaps
    const denseSpine = [];
    for (let i = 0; i < spine.length; i++) {
      denseSpine.push(spine[i]);
      if (i < spine.length - 1) {
        denseSpine.push({
          x: (spine[i].x + spine[i + 1].x) / 2,
          y: (spine[i].y + spine[i + 1].y) / 2
        });
      }
    }

    for (const pt of denseSpine) {
      if (inRiver(pt)) continue;

      if (inBreak) {
        breakCounter++;
        if (breakCounter >= breakLength) {
          inBreak = false;
          segmentCounter = 0;
          nextBreakAt = rng.int(15, 30);
          currentTexture = rng.pick(grassTextures);
          currentSeed = rng.int(0, 999999);
        }
        continue;
      }

      // Fade intensity at segment edges for soft transitions
      let pointIntensity = grassInt;
      if (segmentCounter < FADE_POINTS) {
        // Fade in at start of segment
        pointIntensity = grassInt * ((segmentCounter + 1) / (FADE_POINTS + 1));
      } else if (segmentCounter >= nextBreakAt - FADE_POINTS) {
        // Fade out approaching break
        const remaining = nextBreakAt - segmentCounter;
        pointIntensity = grassInt * (remaining / (FADE_POINTS + 1));
      }

      strokes.push(createStroke('groundTexture', pt.x, pt.y, grassWidth, {
        textureType: currentTexture,
        fadeWidth: 4,
        intensity: pointIntensity,
        isPath: true,
        seed: currentSeed
      }));

      segmentCounter++;
      if (segmentCounter >= nextBreakAt) {
        inBreak = true;
        breakCounter = 0;
        breakLength = rng.int(1, 2);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// ROCKY GROUND (exposed bedrock patches in open areas)
// ═══════════════════════════════════════════════════════════════

/**
 * Place rocky ground patches in open areas.
 * Uses pebbly dirt textures with noise alpha for exposed bedrock feel.
 */
function placeRockyGround(rng, params, bounds, allCover, spawnZones) {
  const strokes = [];
  const { width, height } = bounds;
  const mapArea = width * height;
  const areaRatio = mapArea / REF_AREA;

  const count = Math.max(0, Math.round((params.rockyCount ?? 4) * areaRatio));
  if (count === 0) return strokes;

  const intensity = (params.rockyIntensity ?? 50) / 100;
  if (intensity <= 0) return strokes;

  const rockyTextures = ['dirt-2', 'dirt-3', 'dirt-4'];
  const margin = 40;

  for (let i = 0; i < count; i++) {
    // Try to place in open areas (away from cover and water)
    let px, py;
    let placed = false;

    for (let attempt = 0; attempt < 15; attempt++) {
      px = rng.float(margin, width - margin);
      py = rng.float(margin, height - margin);

      // Avoid spawn zones
      if (overlapsSpawnZone(px, py, 60, spawnZones)) continue;

      // Avoid heavy cover (forests, brush) — prefer open ground
      const nearCover = allCover.some(c => {
        const d = Math.hypot(px - c.x, py - c.y);
        return d < c.radius * 1.3;
      });
      if (nearCover) continue;

      placed = true;
      break;
    }

    if (!placed) continue;

    const r = rng.float(60, 140);
    const texture = rng.pick(rockyTextures);

    strokes.push(createStroke('groundTexture', px, py, r, {
      textureType: texture,
      fadeWidth: r * rng.float(0.3, 0.5),
      intensity: intensity * rng.float(0.6, 1.0),
      noiseAlpha: true,
      seed: rng.int(0, 999999)
    }));
  }

  return strokes;
}

// ═══════════════════════════════════════════════════════════════
// BOULDERS (rock cover features — gameplay equivalent of brush)
// ═══════════════════════════════════════════════════════════════

/**
 * Place boulder clusters in open/rocky areas as cover features.
 * Boulders function like brush for gameplay (concealment) but are stone.
 * NOTE: Requires boulder sprites to render. Without sprites, these are
 * invisible but the strokes will be placed correctly for when art is added.
 */
function placeBoulders(rng, params, bounds, biome, spawnZones, allCover, rockyPatches) {
  const strokes = [];
  const { width, height } = bounds;
  const count = params.boulderCount ?? 3;
  if (count <= 0) return strokes;

  const minR = (params.boulderMinRadius ?? 20);
  const maxR = (params.boulderMaxRadius ?? 50);
  const margin = 40;

  // Prefer placing boulders near rocky patches if available
  const targets = rockyPatches.length > 0 ? rockyPatches : null;

  for (let i = 0; i < count; i++) {
    let px, py;
    let placed = false;

    for (let attempt = 0; attempt < 15; attempt++) {
      if (targets && rng.chance(0.6)) {
        // Place near a rocky patch
        const rock = rng.pick(targets);
        const angle = rng.random() * Math.PI * 2;
        const dist = rng.float(0, rock.radius * 0.7);
        px = rock.x + Math.cos(angle) * dist;
        py = rock.y + Math.sin(angle) * dist;
      } else {
        // Random open area
        px = rng.float(margin, width - margin);
        py = rng.float(margin, height - margin);
      }

      // Avoid spawns
      if (overlapsSpawnZone(px, py, 50, spawnZones)) continue;

      // Avoid dense cover
      const tooClose = allCover.some(c => {
        const d = Math.hypot(px - c.x, py - c.y);
        return d < c.radius * 0.8;
      });
      if (tooClose) continue;

      // Stay in bounds
      if (px < margin || px > width - margin || py < margin || py > height - margin) continue;

      placed = true;
      break;
    }

    if (!placed) continue;

    const r = rng.float(minR, maxR);

    // Boulder uses brush stroke type with rock-specific options
    // When boulder sprites exist, these will render as rock clusters
    // For now they create brush-like cover points
    strokes.push(createStroke('brush', px, py, r, {
      brushTypes: params.boulderTypes ?? ['boulder-erratic', 'boulder-field', 'boulder-outcrop'],
      brushRatios: params.boulderRatios ?? {},
      density: 0.8,
      brushScale: 0.3,
      seed: rng.int(0, 999999),
      boulderFloorTypes: params.boulderFloorTypes ?? ['floor-rock'],
      boulderParticleTypes: params.boulderParticleTypes ?? ['particle-rock'],
      isBoulder: true
    }));
  }

  return strokes;
}

// ═══════════════════════════════════════════════════════════════
// WATER BODIES (uses same multi-center stroke pattern as the paint tool)
// Generates center positions, then creates combined strokes with a
// centers array — identical to how _createCombinedStroke works.
// ═══════════════════════════════════════════════════════════════

function placeWaterBodies(rng, params, bounds, spawnZones, riverStrokes = []) {
  const strokes = [];
  const { width, height } = bounds;
  const count = params.waterCount;
  if (count <= 0) return strokes;

  const flankAnchor = params.waterFlankAnchor / 100;
  const irregularity = (params.waterIrregularity ?? 60) / 100;
  const depth = (params.waterMaxDepth ?? 50) / 100;
  const shoreMin = params.waterShoreMin ?? 10;
  const shoreMax = params.waterShoreMax ?? 30;
  const shoreType = resolveShoreType(params.waterShoreType, params.biome);
  const isVertical = !spawnZones || spawnZones.orientation !== 'horizontal';

  // Collect river center positions for collision avoidance
  const riverCenters = [];
  let riverBrushR = 50;
  for (const s of riverStrokes) {
    if (s.type === 'water' && s.centers) {
      riverBrushR = s.radius || 50;
      for (const c of s.centers) {
        riverCenters.push(c);
      }
    }
  }

  // Deterministic flank assignment: first N bodies go to flanks based on ratio
  const flankCount = Math.round(count * flankAnchor);

  for (let i = 0; i < count; i++) {
    let cx, cy;
    let attempts = 0;
    const useFlank = i < flankCount;

    // Position body — flank-anchored bodies are placed at map edges
    do {
      if (useFlank) {
        // Alternate between left/right (or top/bottom) flanks
        const side = (i % 2 === 0) ? 0.15 : 0.85;
        const jitter = rng.float(-0.08, 0.08);
        if (isVertical) {
          cx = width * (side + jitter);
          cy = rng.float(height * 0.15, height * 0.85);
        } else {
          cx = rng.float(width * 0.15, width * 0.85);
          cy = height * (side + jitter);
        }
      } else {
        // Non-flank bodies placed anywhere (10-90% of map)
        cx = rng.float(width * 0.1, width * 0.9);
        cy = rng.float(height * 0.1, height * 0.9);
      }
      attempts++;
    } while (attempts < 20 && (
      (spawnZones && overlapsSpawnZone(cx, cy, params.waterMaxRadius, spawnZones)) ||
      overlapsRiver(cx, cy, params.waterMaxRadius, riverCenters, riverBrushR)
    ));

    const R = rng.float(params.waterMinRadius, params.waterMaxRadius);
    const brushR = R * rng.float(0.28, 0.38); // brush radius (same for all centers in stroke)

    // ── Generate noisy boundary (polar coords) ──
    // More samples + wider variation = more interesting shapes
    const BOUNDARY_SAMPLES = 24;
    const rawBoundary = [];
    for (let b = 0; b < BOUNDARY_SAMPLES; b++) {
      rawBoundary.push(R * (1 + irregularity * rng.float(-0.5, 0.5)));
    }
    // Smooth twice for natural curves without sharp corners
    const smooth1 = rawBoundary.map((val, idx) => {
      const prev = rawBoundary[(idx - 1 + BOUNDARY_SAMPLES) % BOUNDARY_SAMPLES];
      const next = rawBoundary[(idx + 1) % BOUNDARY_SAMPLES];
      return prev * 0.25 + val * 0.5 + next * 0.25;
    });
    const boundaryRadii = smooth1.map((val, idx) => {
      const prev = smooth1[(idx - 1 + BOUNDARY_SAMPLES) % BOUNDARY_SAMPLES];
      const next = smooth1[(idx + 1) % BOUNDARY_SAMPLES];
      return prev * 0.2 + val * 0.6 + next * 0.2;
    });

    function getBoundaryR(angle) {
      const norm = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const idx = norm / (Math.PI * 2) * BOUNDARY_SAMPLES;
      const i0 = Math.floor(idx) % BOUNDARY_SAMPLES;
      const i1 = (i0 + 1) % BOUNDARY_SAMPLES;
      const t = idx - Math.floor(idx);
      return boundaryRadii[i0] * (1 - t) + boundaryRadii[i1] * t;
    }

    // ── Generate center positions (like dense brush strokes) ──
    const centers = [];
    const spacing = brushR * 0.35; // tight overlap so circles merge

    // 1) Grid fill: pack the interior with a hex grid, reject points outside boundary
    // This ensures dense, even coverage with no bubbly gaps
    const gridStep = spacing;
    const rowHeight = gridStep * 0.866; // sqrt(3)/2 for hex packing
    for (let row = -R / rowHeight; row <= R / rowHeight; row++) {
      const yOff = row * rowHeight;
      const xShift = (Math.round(row) % 2) ? gridStep * 0.5 : 0; // hex offset
      for (let col = -R / gridStep; col <= R / gridStep; col++) {
        const xOff = col * gridStep + xShift;
        const dist = Math.sqrt(xOff * xOff + yOff * yOff);
        const angle = Math.atan2(yOff, xOff);
        const bR = getBoundaryR(angle);
        // Keep points inside boundary (with slight inset so edges aren't cut off)
        if (dist < bR - brushR * 0.3) {
          centers.push({
            x: cx + xOff + rng.float(-3, 3),
            y: cy + yOff + rng.float(-3, 3)
          });
        }
      }
    }

    // 2) Lobe extensions (push outward from boundary for organic shape)
    const lobeCount = Math.max(1, Math.round(irregularity * rng.float(1, 4)));
    for (let lb = 0; lb < lobeCount; lb++) {
      const lobeAngle = rng.random() * Math.PI * 2;
      const bR = getBoundaryR(lobeAngle);
      // Chain from boundary outward
      const lobeSteps = rng.int(3, 7);
      const lobeSpread = rng.float(0.3, 0.8); // angular spread
      for (let ls = 0; ls < lobeSteps; ls++) {
        const dist = bR - brushR * 0.2 + spacing * ls;
        const drift = rng.float(-lobeSpread, lobeSpread) * (ls / lobeSteps);
        centers.push({
          x: cx + Math.cos(lobeAngle + drift) * dist,
          y: cy + Math.sin(lobeAngle + drift) * dist
        });
        // Add width to the lobe (side circles)
        if (ls > 0 && ls < lobeSteps - 1) {
          const perp = lobeAngle + Math.PI / 2;
          const sideOff = spacing * rng.float(0.4, 0.8);
          centers.push({
            x: cx + Math.cos(lobeAngle + drift) * dist + Math.cos(perp) * sideOff,
            y: cy + Math.sin(lobeAngle + drift) * dist + Math.sin(perp) * sideOff
          });
        }
      }
    }

    // 3) Inlet notches (concave bites into the boundary for variety)
    const inletCount = Math.round(irregularity * rng.float(0, 2));
    // Track inlet angles so grid fill points near inlets can be removed
    const inletZones = [];
    for (let ni = 0; ni < inletCount; ni++) {
      const inletAngle = rng.random() * Math.PI * 2;
      const inletDepth = R * rng.float(0.2, 0.4); // how far in the notch goes
      const inletWidth = rng.float(0.3, 0.6); // angular width in radians
      inletZones.push({ angle: inletAngle, depth: inletDepth, width: inletWidth });
    }

    // Remove centers that fall inside inlet notches
    if (inletZones.length > 0) {
      for (let ci = centers.length - 1; ci >= 0; ci--) {
        const c = centers[ci];
        const dx = c.x - cx;
        const dy = c.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        for (const inlet of inletZones) {
          // Angular distance (wrapped)
          let angleDiff = Math.abs(angle - inlet.angle);
          if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;

          if (angleDiff < inlet.width) {
            // Inside inlet angular range — remove if beyond the notch depth
            const bR = getBoundaryR(angle);
            const notchStart = bR - inlet.depth;
            if (dist > notchStart - brushR * 0.3) {
              centers.splice(ci, 1);
              break;
            }
          }
        }
      }
    }

    if (centers.length === 0) continue;

    const avgBoundaryR = boundaryRadii.reduce((a, b) => a + b, 0) / BOUNDARY_SAMPLES;
    const minBR = Math.min(...boundaryRadii);
    const maxBR = Math.max(...boundaryRadii);
    const brRange = maxBR - minBR || 1;

    // ── Create combined strokes (same pattern as paint tool) ──
    const firstCenter = centers[0];
    const waterFadeWidth = brushR * (params.waterFalloff / 100);

    // ── Shore strokes with variable width ──
    // Split centers into 3 bands by their angle's boundary noise.
    // Where boundary bulges outward → wider shore (lobes catch sediment).
    // Where boundary is tight → narrow shore (steep drop-off).
    if (shoreMax > 0) {
      const SHORE_BANDS = 3;
      const bandCenters = Array.from({ length: SHORE_BANDS }, () => []);

      for (const c of centers) {
        const dx = c.x - cx;
        const dy = c.y - cy;
        const angle = Math.atan2(dy, dx);
        const bR = getBoundaryR(angle);
        // Normalize: 0 = tightest boundary, 1 = widest bulge
        const t = (bR - minBR) / brRange;
        const band = Math.min(SHORE_BANDS - 1, Math.floor(t * SHORE_BANDS));
        bandCenters[band].push(c);
      }

      for (let b = 0; b < SHORE_BANDS; b++) {
        if (bandCenters[b].length === 0) continue;
        // Band 0 (tight boundary) → narrow shore, Band 2 (wide bulge) → wide shore
        const bandT = b / (SHORE_BANDS - 1);
        const bandShore = shoreMin + (shoreMax - shoreMin) * bandT;
        if (bandShore < 2) continue;

        const first = bandCenters[b][0];
        strokes.push(createStroke('groundTexture', first.x, first.y,
          brushR + bandShore, {
            intensity: 1.0,
            textureType: shoreType,
            fadeWidth: Math.max(6, bandShore * 0.4),
            isShore: true,
            centers: bandCenters[b]
          }));
      }
    }
    // Average shore for water stroke reference
    const avgShore = (shoreMin + shoreMax) / 2;

    // Water stroke
    strokes.push(createStroke('water', firstCenter.x, firstCenter.y, brushR, {
      intensity: 1.0,
      textureType: 'water',
      fadeWidth: waterFadeWidth,
      shoreWidth: avgShore,
      centers: centers
    }));

    // Depth stroke — all bodies get depth, intensity scales with area
    // Size classification based on body area (absolute, not relative to map):
    //   pond (area < ~11k px², r≈60): faint depth
    //   small lake (11k-45k, r≈60-120): moderate depth
    //   large lake (>45k, r≈120+): deep
    const bodyArea = Math.PI * avgBoundaryR * avgBoundaryR;
    // Smooth ramp: ponds ~0.3, small lakes ~0.55, large lakes ~1.0
    const sizeFactor = Math.min(1, 0.2 + bodyArea / 60000);
    const depthOpts = waterDepthOpts(depth * sizeFactor, (params.waterDepthFalloff ?? 50) / 100);

    if (depthOpts.intensity > 0.01) {
      strokes.push(createStroke('waterDepth', firstCenter.x, firstCenter.y, brushR, {
        ...depthOpts,
        centers: centers
      }));
    }
  }

  return strokes;
}

// ═══════════════════════════════════════════════════════════════
// WATER BRIDGING (connect nearby water bodies into cohesive lakes)
// Each water body is now a single combined stroke with centers[].
// Bridge by finding closest center pairs between bodies.
// ═══════════════════════════════════════════════════════════════

function bridgeWaterBodies(rng, waterStrokes, params) {
  const bridges = [];
  const depth = (params.waterMaxDepth ?? 50) / 100;
  const shoreType = resolveShoreType(params.waterShoreType, params.biome);
  // Average of connected bodies' shore range
  const shore = ((params.waterShoreMin ?? 10) + (params.waterShoreMax ?? 30)) / 2;

  // Get water body strokes (combined strokes with centers arrays)
  const waterBodies = waterStrokes.filter(s => s.type === 'water');
  if (waterBodies.length < 2) return bridges;

  for (let i = 0; i < waterBodies.length; i++) {
    const bodyA = waterBodies[i];
    const centersA = bodyA.centers || [{ x: bodyA.x, y: bodyA.y }];

    for (let j = i + 1; j < waterBodies.length; j++) {
      const bodyB = waterBodies[j];
      const centersB = bodyB.centers || [{ x: bodyB.x, y: bodyB.y }];
      const r = bodyA.radius; // both bodies use same-ish brush radius

      // Find closest pair of centers between the two bodies
      let minDist = Infinity;
      let closestA = null, closestB = null;
      for (const ca of centersA) {
        for (const cb of centersB) {
          const d = Math.hypot(ca.x - cb.x, ca.y - cb.y);
          if (d < minDist) {
            minDist = d;
            closestA = ca;
            closestB = cb;
          }
        }
      }

      // Bridge when gap between nearest centers is close but not overlapping
      const gap = minDist - r * 2;
      if (gap <= 0 || gap > 150) continue;

      // Generate bridge centers between closest points
      const bridgeCenters = [];
      const bridgeRadius = r * rng.float(0.6, 0.9);
      const stepDist = bridgeRadius * 0.6;
      const steps = Math.max(1, Math.ceil(gap / stepDist));

      for (let s = 0; s <= steps; s++) {
        const t = s / Math.max(1, steps);
        bridgeCenters.push({
          x: closestA.x + (closestB.x - closestA.x) * t + rng.float(-6, 6),
          y: closestA.y + (closestB.y - closestA.y) * t + rng.float(-6, 6)
        });
      }

      if (bridgeCenters.length === 0) continue;
      const first = bridgeCenters[0];

      // Shore
      if (shore > 0) {
        const bridgeShore = shore * 0.7;
        bridges.push(createStroke('groundTexture', first.x, first.y,
          bridgeRadius + bridgeShore, {
            intensity: 1.0,
            textureType: shoreType,
            fadeWidth: Math.max(6, bridgeShore * 0.4),
            isShore: true,
            centers: bridgeCenters
          }));
      }

      // Water
      bridges.push(createStroke('water', first.x, first.y, bridgeRadius, {
        intensity: 1.0,
        textureType: 'water',
        fadeWidth: bridgeRadius * ((params.waterFalloff ?? 30) / 100),
        shoreWidth: shore * 0.7,
        centers: bridgeCenters
      }));

      // Depth
      if (depth > 0.05) {
        const depthOpts = waterDepthOpts(depth * 0.5, (params.waterDepthFalloff ?? 50) / 100);
        bridges.push(createStroke('waterDepth', first.x, first.y, bridgeRadius, {
          ...depthOpts,
          centers: bridgeCenters
        }));
      }
    }
  }

  return bridges;
}

// ═══════════════════════════════════════════════════════════════
// RIVER (geomorphology-based generation)
//
// Based on fluvial geomorphology (Leopold & Wolman):
// - Meander wavelength = 10-14x river width
// - Meander amplitude = 2.5-4.5x river width
// - Pool-riffle spacing = 5-7x width
// - Width varies ±15-25% (wider at pools/bends, narrower at riffles)
// - Depth: uniform across river, driven by width + depth sliders
//
// Tactical implications:
// - River divides the battlefield (edge-to-edge crossing)
// - Bridge placed where path crosses river
// - Bends create cover/concealment opportunities
// - Width variation creates tactical variety
// ═══════════════════════════════════════════════════════════════

function placeRiver(rng, params, bounds, spawnZones) {
  const empty = { strokes: [], riverData: null };
  if (!params.riverEnabled) return empty;
  const strokes = [];

  const { width, height } = bounds;
  const riverW = params.riverWidth ?? 50; // base brush radius (≈ half-width)
  const windiness = (params.riverWindiness ?? 50) / 100;
  const depth = (params.riverMaxDepth ?? 60) / 100;
  const riverShoreType = resolveShoreType(params.riverShoreType, params.biome);
  const riverShoreMin = params.riverShoreMin ?? 12;
  const riverShoreMax = params.riverShoreMax ?? 28;

  // ── 1) Pick entry and exit edges (spawn-aware) ──
  // Entry/exit are always on opposite edges. Endpoints account for spawn
  // positions: if a spawn is on the same edge, push the endpoint far away.
  // 0=top, 1=right, 2=bottom, 3=left
  const entryEdge = rng.int(0, 3);
  const exitEdge = (entryEdge + 2) % 4;

  // Project a point onto an edge → fraction 0-1 along that edge
  const projectOntoEdge = (px, py, edge) => {
    switch (edge) {
      case 0: case 2: return px / width;   // top/bottom → x fraction
      case 1: case 3: return py / height;  // left/right → y fraction
    }
  };

  // Distance from a point to an edge (perpendicular)
  const distToEdge = (px, py, edge) => {
    switch (edge) {
      case 0: return py;               // top
      case 1: return width - px;       // right
      case 2: return height - py;      // bottom
      case 3: return px;               // left
    }
  };

  const margin = PCG_RULES.river.endpointMargin;
  const [jitterMin, jitterMax] = PCG_RULES.river.endpointJitter;

  // Place river endpoint on an edge, aware of spawn positions
  const placeEndpoint = (edge) => {
    if (!spawnZones || spawnZones.length === 0) return rng.float(margin, 1 - margin);

    // Check if any spawn is ON this edge (within 3× spawn radius)
    const spawnOnEdge = spawnZones.find(sz => distToEdge(sz.x, sz.y, edge) < sz.radius * 3);

    if (spawnOnEdge) {
      // Parallel scenario: spawn is on this edge.
      // Push river endpoint to the opposite end of the edge from the spawn.
      const spawnT = projectOntoEdge(spawnOnEdge.x, spawnOnEdge.y, edge);
      const target = spawnT < 0.5
        ? rng.float(0.70, 1 - margin)   // spawn on left half → river on right
        : rng.float(margin, 0.30);       // spawn on right half → river on left
      return Math.max(margin, Math.min(1 - margin, target));
    }

    // Perpendicular scenario: no spawn on this edge. Place freely.
    return rng.float(margin, 1 - margin);
  };

  const entryT = placeEndpoint(entryEdge);
  const exitT = placeEndpoint(exitEdge);

  const pointOnEdge = (edge, t) => {
    switch (edge) {
      case 0: return { x: t * width, y: 0 };
      case 1: return { x: width, y: t * height };
      case 2: return { x: t * width, y: height };
      case 3: return { x: 0, y: t * height };
    }
  };

  const entryEdgePt = pointOnEdge(entryEdge, entryT);
  const exitEdgePt = pointOnEdge(exitEdge, exitT);

  const edgeNames = ['top', 'right', 'bottom', 'left'];
  const spawnEdges = spawnZones.orientation === 'vertical' ? [0, 2] : [1, 3];
  const riverLayout = spawnEdges.includes(entryEdge) ? 'parallel' : 'crossing';
  console.log(`[PCG River] ${riverLayout} | edges: ${edgeNames[entryEdge]}(${entryT.toFixed(2)}) → ${edgeNames[exitEdge]}(${exitT.toFixed(2)})`,
    `| spawns(${spawnZones.orientation}): (${spawnZones[0]?.x.toFixed(0)},${spawnZones[0]?.y.toFixed(0)}) (${spawnZones[1]?.x.toFixed(0)},${spawnZones[1]?.y.toFixed(0)})`,
    `| entry: (${entryEdgePt.x.toFixed(0)},${entryEdgePt.y.toFixed(0)}) exit: (${exitEdgePt.x.toFixed(0)},${exitEdgePt.y.toFixed(0)})`);

  // Extend entry/exit PAST the map edge along the edge normal so centers
  // bleed off-screen even when the river curves near an edge
  const overshoot = riverW * PCG_RULES.river.overshootMultiplier;
  // Edge normals: outward direction from each edge
  const edgeNormals = [
    { x: 0, y: -1 },  // 0=top → push up
    { x: 1, y: 0 },   // 1=right → push right
    { x: 0, y: 1 },   // 2=bottom → push down
    { x: -1, y: 0 }   // 3=left → push left
  ];
  const entryNorm = edgeNormals[entryEdge];
  const exitNorm = edgeNormals[exitEdge];
  const entry = {
    x: entryEdgePt.x + entryNorm.x * overshoot,
    y: entryEdgePt.y + entryNorm.y * overshoot
  };
  const exit = {
    x: exitEdgePt.x + exitNorm.x * overshoot,
    y: exitEdgePt.y + exitNorm.y * overshoot
  };

  // ── 2) Generate meander control points ──
  // Meander wavelength = 10-14x river width, amplitude = 2.5-4.5x width
  const dx = exit.x - entry.x;
  const dy = exit.y - entry.y;
  const valleyLength = Math.sqrt(dx * dx + dy * dy);
  if (valleyLength < 100) return empty;

  const dirX = dx / valleyLength;
  const dirY = dy / valleyLength;
  const perpX = -dirY;
  const perpY = dirX;

  // Meander params based on river width and windiness
  const baseWavelength = riverW * rng.float(...PCG_RULES.river.wavelengthRange);
  const baseAmplitude = riverW * rng.float(...PCG_RULES.river.amplitudeRange) * windiness;
  const numBends = Math.max(PCG_RULES.river.minBends, Math.round(valleyLength / baseWavelength));

  const controlPoints = [entry];
  let currentSide = rng.chance(0.5) ? 1 : -1;

  for (let i = 1; i <= numBends; i++) {
    const t = i / (numBends + 1);
    const baseX = entry.x + dx * t;
    const baseY = entry.y + dy * t;

    // Alternate sides for S-curve meander pattern
    currentSide *= -1;

    // ±20-30% variation in wavelength and amplitude per bend
    const ampVar = rng.float(...PCG_RULES.river.amplitudeVariation);
    const amplitude = baseAmplitude * ampVar * currentSide;

    // Downstream bend asymmetry: tighter on downstream limb
    const asymmetry = rng.float(...PCG_RULES.river.asymmetryRange) * currentSide;

    controlPoints.push({
      x: baseX + perpX * amplitude + dirX * valleyLength * asymmetry,
      y: baseY + perpY * amplitude + dirY * valleyLength * asymmetry
    });
  }
  controlPoints.push(exit);

  // ── Center pull: bias the midpoint control point toward map center ──
  // This ensures the river crosses near the center of the battlefield.
  // Pull strength fades for control points further from the midpoint.
  const mapCenterX = width / 2;
  const mapCenterY = height / 2;
  const innerCount = controlPoints.length - 2; // exclude entry/exit
  if (innerCount > 0) {
    for (let ci = 1; ci < controlPoints.length - 1; ci++) {
      const cp = controlPoints[ci];
      // Weight: strongest at midpoint, fades toward edges (bell curve)
      const normalizedT = (ci - 1) / Math.max(1, innerCount - 1); // 0-1
      const centerWeight = Math.exp(-PCG_RULES.river.centerPullFalloff * (normalizedT - 0.5) * (normalizedT - 0.5));
      const pullStrength = PCG_RULES.river.centerPullStrength * centerWeight;
      cp.x += (mapCenterX - cp.x) * pullStrength;
      cp.y += (mapCenterY - cp.y) * pullStrength;
    }
  }

  // Clamp interior control points to stay within map bounds
  // (skip first/last — they're deliberately beyond the edge)
  const clampMargin = riverW * PCG_RULES.river.clampMarginMultiplier;
  for (let ci = 1; ci < controlPoints.length - 1; ci++) {
    const cp = controlPoints[ci];
    cp.x = Math.max(clampMargin, Math.min(width - clampMargin, cp.x));
    cp.y = Math.max(clampMargin, Math.min(height - clampMargin, cp.y));
  }

  // ── 3) Sample spine points along spline ──
  const spineSpacing = riverW * PCG_RULES.river.spineSpacingMultiplier;
  const spinePoints = sampleCatmullRom(controlPoints, spineSpacing);
  if (spinePoints.length < 3) return empty;

  // ═══════════════════════════════════════════════════════════════
  // 4) DEPTH CLASS — driven by width + depth sliders
  // ═══════════════════════════════════════════════════════════════

  // Derive depth class from slider values (no ford/map-size dependency)
  const depthClassName = getDepthClass(params.riverWidth ?? 50, params.riverMaxDepth ?? 60);
  const depthClass = PCG_RULES.depthClasses[depthClassName];
  console.log(`[PCG River] depthClass=${depthClassName} (width=${params.riverWidth}, depth=${params.riverMaxDepth})`);

  const poolRiffleWavelength = riverW * rng.float(...PCG_RULES.river.poolRiffleRange);

  const waterCenters = [];
  const shoreCenters = [];
  const depthCenters = []; // ALL spine points — uniform depth rendering

  // Pre-generate per-point bank noise (smoothed random offsets for natural irregularity)
  // This creates gentle bumps and indentations along each bank independently
  const bankNoiseL = [];
  const bankNoiseR = [];
  for (let i = 0; i < spinePoints.length; i++) {
    bankNoiseL.push(rng.float(-1, 1));
    bankNoiseR.push(rng.float(-1, 1));
  }
  // Smooth the noise (3-tap)
  const smoothBank = (arr) => arr.map((v, i) => {
    const prev = arr[Math.max(0, i - 1)];
    const next = arr[Math.min(arr.length - 1, i + 1)];
    return prev * 0.25 + v * 0.5 + next * 0.25;
  });
  const bankL = smoothBank(smoothBank(bankNoiseL));
  const bankR = smoothBank(smoothBank(bankNoiseR));

  for (let i = 0; i < spinePoints.length; i++) {
    const p = spinePoints[i];

    // Get local direction for perpendicular calculations
    const prev = spinePoints[Math.max(0, i - 1)];
    const next = spinePoints[Math.min(spinePoints.length - 1, i + 1)];
    const ldx = next.x - prev.x;
    const ldy = next.y - prev.y;
    const lLen = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
    const localPerpX = -ldy / lLen;
    const localPerpY = ldx / lLen;

    // Curvature estimate (how much the river bends here)
    let curvature = 0;
    if (i > 1 && i < spinePoints.length - 2) {
      const pp = spinePoints[i - 2];
      const nn = spinePoints[i + 2];
      const v1x = p.x - pp.x, v1y = p.y - pp.y;
      const v2x = nn.x - p.x, v2y = nn.y - p.y;
      const cross = v1x * v2y - v1y * v2x;
      const len1 = Math.sqrt(v1x * v1x + v1y * v1y) || 1;
      const len2 = Math.sqrt(v2x * v2x + v2y * v2y) || 1;
      curvature = Math.abs(cross / (len1 * len2)); // 0=straight, 1=sharp turn
    }

    // Pool-riffle pattern: sinusoidal width variation along river length
    const distAlong = i * spineSpacing;
    const poolRifflePhase = Math.sin(distAlong / poolRiffleWavelength * Math.PI * 2);
    // poolRifflePhase: +1 = pool (wider, deeper), -1 = riffle (narrower, shallower)

    // Width factors (stronger variation for more natural look):
    //   bends: +20-30% wider on outside
    //   pools: +25-30% wider, riffles: -20% narrower
    //   bank noise: ±15% per side (independent L/R)
    const bendWidth = curvature * PCG_RULES.river.bendWidthFactor;
    const poolWidth = poolRifflePhase * PCG_RULES.river.poolWidthFactor;
    const baseWidthFactor = Math.max(PCG_RULES.river.minWidthFactor, 1 + bendWidth + poolWidth);

    // Per-bank width: left and right sides vary independently
    const leftWidth = baseWidthFactor + bankL[i] * PCG_RULES.river.bankNoiseFactor;
    const rightWidth = baseWidthFactor + bankR[i] * PCG_RULES.river.bankNoiseFactor;

    // Main spine center
    waterCenters.push({
      x: p.x + rng.float(-3, 3),
      y: p.y + rng.float(-3, 3)
    });
    shoreCenters.push({ x: p.x, y: p.y });

    // Width expansion: perpendicular centers on each side (independent widths)
    const leftDist = riverW * leftWidth * PCG_RULES.river.perpExpansionFactor;
    const rightDist = riverW * rightWidth * PCG_RULES.river.perpExpansionFactor;

    if (leftDist > 5) {
      waterCenters.push({
        x: p.x + localPerpX * leftDist + rng.float(-3, 3),
        y: p.y + localPerpY * leftDist + rng.float(-3, 3)
      });
      shoreCenters.push({
        x: p.x + localPerpX * leftDist,
        y: p.y + localPerpY * leftDist
      });
    }
    if (rightDist > 5) {
      waterCenters.push({
        x: p.x - localPerpX * rightDist + rng.float(-3, 3),
        y: p.y - localPerpY * rightDist + rng.float(-3, 3)
      });
      shoreCenters.push({
        x: p.x - localPerpX * rightDist,
        y: p.y - localPerpY * rightDist
      });
    }

    // Extra bank bumps: occasional wider spots on one side (40% chance)
    if (rng.chance(PCG_RULES.river.bumpChance)) {
      const side = rng.chance(0.5) ? 1 : -1;
      const bumpDist = riverW * rng.float(...PCG_RULES.river.bumpRange) * baseWidthFactor;
      waterCenters.push({
        x: p.x + localPerpX * bumpDist * side,
        y: p.y + localPerpY * bumpDist * side
      });
    }

    // Depth: uniform across all spine points (driven by slider-based depth class)
    depthCenters.push({ x: p.x, y: p.y });
  }

  if (waterCenters.length === 0) return empty;
  const firstCenter = waterCenters[0];
  const waterFadeWidth = riverW * ((params.riverFalloff ?? 30) / 100);
  const avgShoreWidth = Math.max(6, (riverShoreMin + riverShoreMax) / 2);
  const depthFalloff = (params.riverDepthFalloff ?? 50) / 100;

  // ── 5) Create combined strokes ──

  // Shore — split into bands by bank noise for variable width.
  // Pool/bend areas (wider bankL) get wider shore; riffle areas get narrower.
  // Shore centers are spine-only (1 per spine point), indexed same as bankL.
  if (riverShoreMax > 0) {
    const SHORE_BANDS = 3;
    const bandCenters = Array.from({ length: SHORE_BANDS }, () => []);

    for (let si = 0; si < shoreCenters.length; si++) {
      // Map bank noise (smoothed, roughly -1..1) to 0..1
      const noiseIdx = Math.min(si, bankL.length - 1);
      const t = Math.max(0, Math.min(1, (bankL[noiseIdx] + 1) / 2));
      const band = Math.min(SHORE_BANDS - 1, Math.floor(t * SHORE_BANDS));
      bandCenters[band].push(shoreCenters[si]);
    }

    for (let b = 0; b < SHORE_BANDS; b++) {
      if (bandCenters[b].length === 0) continue;
      const bandT = b / (SHORE_BANDS - 1);
      const bandShore = riverShoreMin + (riverShoreMax - riverShoreMin) * bandT;
      if (bandShore < 2) continue;

      const first = bandCenters[b][0];
      strokes.push(createStroke('groundTexture', first.x, first.y,
        riverW + bandShore, {
          intensity: 1.0,
          textureType: riverShoreType,
          fadeWidth: Math.max(6, bandShore * 0.4),
          isShore: true,
          centers: bandCenters[b]
        }));
    }
  }

  // Water
  strokes.push(createStroke('water', firstCenter.x, firstCenter.y, riverW, {
    intensity: 1.0,
    textureType: 'water',
    fadeWidth: waterFadeWidth,
    shoreWidth: avgShoreWidth,
    centers: waterCenters
  }));

  // Depth — paint tool pass-through:
  //   Paint tool formula: intensity = depthSlider * 0.5, depthFalloff = slider
  //   PCG slider "depth" (0-1) maps directly to the paint tool's depthSlider.
  //   Uniform depth across all spine points, driven by slider-based depth class.

  // 1) Shallow layer: ALL spine points get a light "passable" depth tint
  const shallowDepth = depth * depthClass.shallowFraction;
  if (shallowDepth > 0.01 && depthCenters.length > 0) {
    strokes.push(createStroke('waterDepth',
      depthCenters[0].x, depthCenters[0].y,
      riverW, {
        intensity: shallowDepth * 0.5,   // paint tool formula
        depthFalloff: depthFalloff,
        centers: depthCenters
      }));
  }
  // 2) Deep layer: additional darkening for medium/full depth rivers
  if (depthClass.deepLayer && depth > 0.05 && depthCenters.length > 0) {
    const deepIntensity = depth * depthClass.deepFraction;
    strokes.push(createStroke('waterDepth',
      depthCenters[0].x, depthCenters[0].y,
      riverW * PCG_RULES.river.deepBrushRadiusMultiplier, {
        intensity: deepIntensity * 0.5,   // paint tool formula
        depthFalloff: depthFalloff,
        centers: depthCenters
      }));
  }

  // Build structured river data for game logic / pathfinding
  const riverData = {
    spine: spinePoints,           // full path [{x,y}, ...]
    brushRadius: riverW,          // half-width of the river
    depthClassName,               // 'shallow'|'medium'|'full' from slider thresholds
    entry: entryEdgePt,           // where river enters map
    exit: exitEdgePt,             // where river exits map
    entryEdge,                    // edge index (0=top, 1=right, 2=bottom, 3=left)
    exitEdge
  };

  return { strokes, riverData };
}

// ═══════════════════════════════════════════════════════════════
// CATMULL-ROM SPLINE SAMPLING
// ═══════════════════════════════════════════════════════════════

/**
 * Sample evenly-spaced points along a Catmull-Rom spline
 * @param {Array<{x,y}>} controlPoints - at least 2 points
 * @param {number} spacing - approximate distance between samples
 * @returns {Array<{x,y}>}
 */
function sampleCatmullRom(controlPoints, spacing) {
  const points = [];
  const n = controlPoints.length;
  if (n < 2) return points;

  // For each segment between consecutive control points
  for (let i = 0; i < n - 1; i++) {
    const p0 = controlPoints[Math.max(0, i - 1)];
    const p1 = controlPoints[i];
    const p2 = controlPoints[Math.min(n - 1, i + 1)];
    const p3 = controlPoints[Math.min(n - 1, i + 2)];

    // Estimate segment length for sampling density
    const segDx = p2.x - p1.x;
    const segDy = p2.y - p1.y;
    const segLen = Math.sqrt(segDx * segDx + segDy * segDy);
    const steps = Math.max(2, Math.ceil(segLen / spacing));

    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;

      // Catmull-Rom basis functions
      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      );
      const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
      );

      points.push({ x, y });
    }
  }

  // Add the final point
  points.push({ ...controlPoints[n - 1] });
  return points;
}

// ═══════════════════════════════════════════════════════════════
// BIOME HELPERS (shared by forest/bridge/choke/water functions)
// ═══════════════════════════════════════════════════════════════

/**
 * Resolve shore texture type: user override > biome default > 'mud'
 */
function resolveShoreType(userType, biomeName) {
  if (userType && userType !== '') return userType;
  return BIOME_SHORE_DEFAULTS[biomeName] || 'mud';
}

function getForestOpts(biome) {
  const rawTreeKeys = Object.keys(biome.trees);
  const treeTypes = rawTreeKeys.map(k => k.replace(/^tree-/, ''));
  const treeRatios = {};
  for (const key of rawTreeKeys) {
    treeRatios[key.replace(/^tree-/, '')] = biome.trees[key];
  }
  const ageRatios = { ...biome.ageRatios };
  return {
    treeTypes,
    treeRatios,
    selectedAges: Object.keys(ageRatios),
    ageRatios,
    allowTreesInWater: false
  };
}

function getBrushOpts(biome) {
  const brushTypes = biome.brush || ['bush-small'];
  const brushRatios = {};
  brushTypes.forEach(t => { brushRatios[t] = 1 / brushTypes.length; });
  return { brushTypes, brushRatios, allowBrushInWater: false };
}

/**
 * Build forest createStroke options from params (paint tool pass-through + natural variation)
 * @param {Object} params - PCG params (contains forestDensity, forestTreeScale, forestTreeSpacing)
 * @param {Object} biomeOpts - from getForestOpts()
 * @param {Object} rng - seeded RNG
 * @param {number} [varianceMult=1] - how much random variation (0=exact, 1=normal)
 */
function forestStrokeOpts(params, biomeOpts, rng, varianceMult = 1) {
  const v = varianceMult;
  const opts = {
    ...biomeOpts,
    density: params.forestDensity * rng.float(1 - 0.2 * v, 1 + 0.2 * v),
    treeScale: params.forestTreeScale * rng.float(1 - 0.15 * v, 1 + 0.15 * v),
    treeSpacing: params.forestTreeSpacing * rng.float(1 - 0.1 * v, 1 + 0.1 * v),
    seed: rng.int(0, 999999)
  };
  // Per-stroke particle density multiplier from PCG slider (percentage → multiplier)
  const particleMult = (params.forestParticleDensity ?? 100) / 100;
  if (particleMult !== 1) {
    opts.childSpawnOverrides = { particle: { densityMult: particleMult } };
  }
  return opts;
}

/**
 * Build brush createStroke options from params (paint tool pass-through + natural variation)
 */
function brushStrokeOpts(params, biomeOpts, rng, varianceMult = 1) {
  const v = varianceMult;
  const opts = {
    ...biomeOpts,
    density: params.brushDensity * rng.float(1 - 0.2 * v, 1 + 0.2 * v),
    brushScale: params.brushScale * rng.float(1 - 0.15 * v, 1 + 0.15 * v),
    seed: rng.int(0, 999999)
  };
  // Per-stroke particle density multiplier from PCG slider (percentage → multiplier)
  const particleMult = (params.brushParticleDensity ?? 100) / 100;
  if (particleMult !== 1) {
    opts.childSpawnOverrides = { particle: { densityMult: particleMult } };
  }
  return opts;
}

/**
 * Build water depth createStroke options using paint tool formula.
 * Paint tool: intensity = depthValue * 0.5, depthFalloff = falloffSlider
 * @param {number} depthValue - 0-1 from depth slider
 * @param {number} falloff - 0-1 from falloff slider (default 0.5)
 */
function waterDepthOpts(depthValue, falloff = 0.5) {
  return {
    intensity: depthValue * 0.5,
    depthFalloff: falloff
  };
}

// ═══════════════════════════════════════════════════════════════
// FOREST CLUSTERS (with satellite circles for organic shapes)
// ═══════════════════════════════════════════════════════════════

function placeForestClusters(rng, params, bounds, biome, spawnZones) {
  const strokes = [];
  const { width, height } = bounds;

  // Spawn orientation determines which axis is "depth" (spawn→spawn) vs "flank" (perpendicular)
  const isVertical = !spawnZones || spawnZones.orientation !== 'horizontal';

  const flankBias = params.forestFlankBias / 100;
  const centerAvoid = params.forestCenterAvoid / 100;

  const weightFn = (x, y) => {
    const flankNorm = isVertical ? x / width : y / height;
    const depthNorm = isVertical ? y / height : x / width;

    const distFromCenter = Math.abs(flankNorm - 0.5) * 2;
    const flankWeight = 1 - flankBias + flankBias * distFromCenter;
    const centerWeight = 1 - centerAvoid * Math.max(0, 1 - distFromCenter * 2);

    const depthDist = Math.abs(depthNorm - 0.5);
    const depthWeight = 0.5 + 0.5 * (1 - depthDist * 1.6);

    return flankWeight * centerWeight * Math.max(0.15, depthWeight);
  };

  const positions = poissonDiskSample(
    rng, bounds,
    params.forestMinSpacing,
    params.forestCount,
    params.forestEdgeMargin,
    weightFn,
    spawnZones
  );

  const forestOpts = getForestOpts(biome);

  for (const pos of positions) {
    const radius = rng.float(params.forestMinRadius, params.forestMaxRadius);

    // Primary forest circle
    strokes.push(createStroke('forest', pos.x, pos.y, radius, forestStrokeOpts(params, forestOpts, rng)));

    // Satellite circles for organic shape (2-4)
    const satelliteCount = rng.int(2, 4);
    const biasAngle = rng.random() * Math.PI * 2;

    for (let s = 0; s < satelliteCount; s++) {
      let angle;
      if (rng.chance(0.5)) {
        angle = biasAngle + rng.float(-1.2, 1.2);
      } else {
        angle = rng.random() * Math.PI * 2;
      }

      const offsetDist = radius * rng.float(0.2, 0.5);
      const sx = pos.x + Math.cos(angle) * offsetDist;
      const sy = pos.y + Math.sin(angle) * offsetDist;
      const sr = radius * rng.float(0.4, 0.7);

      strokes.push(createStroke('forest', sx, sy, sr, forestStrokeOpts(params, forestOpts, rng)));
    }

    // Tendril extension (60% chance)
    if (rng.chance(0.6)) {
      const tendrilAngle = rng.random() * Math.PI * 2;
      const tendrilDist = radius * rng.float(0.6, 0.9);
      const tx = pos.x + Math.cos(tendrilAngle) * tendrilDist;
      const ty = pos.y + Math.sin(tendrilAngle) * tendrilDist;
      const tr = radius * rng.float(0.25, 0.4);

      strokes.push(createStroke('forest', tx, ty, tr, forestStrokeOpts(params, forestOpts, rng)));
    }
  }

  return strokes;
}

// ═══════════════════════════════════════════════════════════════
// FOREST TREE LINES (elongated forest features along curved paths)
// ═══════════════════════════════════════════════════════════════

function placeTreeLines(rng, params, bounds, biome, spawnZones, existingForest) {
  const strokes = [];
  const { width, height } = bounds;
  const isVertical = !spawnZones || spawnZones.orientation !== 'horizontal';

  // Number of tree lines scales with forest count (2-5)
  const lineCount = Math.max(2, Math.min(5, Math.floor(params.forestCount / 3)));
  const forestOpts = getForestOpts(biome);

  for (let i = 0; i < lineCount; i++) {
    // Pick start point — prefer map edges or near existing forests
    let startX, startY, endX, endY;

    if (existingForest.length > 0 && rng.chance(0.5)) {
      // Start from an existing forest and extend outward
      const anchor = rng.pick(existingForest);
      const angle = rng.random() * Math.PI * 2;
      startX = anchor.x + Math.cos(angle) * anchor.radius;
      startY = anchor.y + Math.sin(angle) * anchor.radius;
      const lineLen = rng.float(200, 450);
      endX = startX + Math.cos(angle) * lineLen;
      endY = startY + Math.sin(angle) * lineLen;
    } else {
      // Freestanding tree line — runs roughly perpendicular to spawn axis
      // (creates cover corridors across approach routes)
      if (isVertical) {
        startX = rng.float(width * 0.1, width * 0.4);
        startY = rng.float(height * 0.2, height * 0.8);
        endX = rng.float(width * 0.4, width * 0.9);
        endY = startY + rng.float(-height * 0.2, height * 0.2);
      } else {
        startX = rng.float(width * 0.2, width * 0.8);
        startY = rng.float(height * 0.1, height * 0.4);
        endX = startX + rng.float(-width * 0.2, width * 0.2);
        endY = rng.float(height * 0.4, height * 0.9);
      }
    }

    // Clamp to bounds
    startX = Math.max(40, Math.min(width - 40, startX));
    startY = Math.max(40, Math.min(height - 40, startY));
    endX = Math.max(40, Math.min(width - 40, endX));
    endY = Math.max(40, Math.min(height - 40, endY));

    // Build control points with some curve
    const dx = endX - startX;
    const dy = endY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 80) continue; // too short

    const perpX = -dy / dist;
    const perpY = dx / dist;

    const controlPoints = [{ x: startX, y: startY }];
    const midPoints = rng.int(1, 3);
    for (let m = 1; m <= midPoints; m++) {
      const t = m / (midPoints + 1);
      const curve = rng.float(-80, 80);
      controlPoints.push({
        x: startX + dx * t + perpX * curve,
        y: startY + dy * t + perpY * curve
      });
    }
    controlPoints.push({ x: endX, y: endY });

    // Sample along the spline — circles are decent-sized for visible tree lines
    const circleRadius = rng.float(params.forestMinRadius * 0.6, params.forestMinRadius * 1.0);
    const splinePoints = sampleCatmullRom(controlPoints, circleRadius * 1.2);

    for (let j = 0; j < splinePoints.length; j++) {
      const p = splinePoints[j];

      // Skip if in spawn zone
      if (spawnZones && overlapsSpawnZone(p.x, p.y, circleRadius, spawnZones)) continue;

      // Vary radius along the line (thicker in middle, thinner at ends)
      const t = j / splinePoints.length;
      const taper = Math.min(1, t * 3, (1 - t) * 3);
      const r = circleRadius * taper * rng.float(0.7, 1.3);
      if (r < 20) continue;

      strokes.push(createStroke('forest', p.x, p.y, r, forestStrokeOpts(params, forestOpts, rng)));

      // Occasional satellite off the line for organic feel (30% chance)
      if (rng.chance(0.3)) {
        const sideAngle = (rng.chance(0.5) ? 1 : -1) * (Math.PI / 2) + rng.float(-0.5, 0.5);
        // Get local direction
        const next = splinePoints[Math.min(j + 1, splinePoints.length - 1)];
        const localAngle = Math.atan2(next.y - p.y, next.x - p.x);
        const satAngle = localAngle + sideAngle;
        const satDist = r * rng.float(0.5, 0.9);

        strokes.push(createStroke('forest',
          p.x + Math.cos(satAngle) * satDist,
          p.y + Math.sin(satAngle) * satDist,
          r * rng.float(0.4, 0.7),
          forestStrokeOpts(params, forestOpts, rng)));
      }
    }
  }

  return strokes;
}

// ═══════════════════════════════════════════════════════════════
// APPROACH COVER (brush corridors from spawn toward midfield)
// ═══════════════════════════════════════════════════════════════

function placeApproachCover(rng, bounds, biome, spawnZones, existingCover, params) {
  const strokes = [];
  const { width, height } = bounds;
  const isVertical = !spawnZones || spawnZones.orientation !== 'horizontal';
  const brushOpts = getBrushOpts(biome);

  // For each spawn zone, create 3-4 brush trails leading toward midfield
  for (const zone of spawnZones) {
    const trailCount = rng.int(3, 4);

    for (let t = 0; t < trailCount; t++) {
      // Direction from spawn toward center, with some spread
      const midX = width / 2;
      const midY = height / 2;
      const toMidAngle = Math.atan2(midY - zone.y, midX - zone.x);
      const spread = rng.float(-0.8, 0.8);
      const angle = toMidAngle + spread;

      // Place 4-7 brush clusters stepping from spawn edge toward midfield
      const stepCount = rng.int(4, 7);
      const startDist = zone.radius + rng.float(15, 40);
      const stepDist = rng.float(50, 85);

      for (let s = 0; s < stepCount; s++) {
        const dist = startDist + s * stepDist;
        const bx = zone.x + Math.cos(angle) * dist + rng.float(-20, 20);
        const by = zone.y + Math.sin(angle) * dist + rng.float(-20, 20);

        // Stay in bounds
        if (bx < 20 || bx > width - 20 || by < 20 || by > height - 20) continue;

        // Don't overlap spawn zones
        if (overlapsSpawnZone(bx, by, 30, spawnZones)) continue;

        // Don't place on top of existing heavy cover
        const overlapsCover = existingCover.some(c => {
          const d = Math.hypot(bx - c.x, by - c.y);
          return d < c.radius * 0.6;
        });
        if (overlapsCover) continue;

        const r = rng.float(30, 55);
        strokes.push(createStroke('brush', bx, by, r, brushStrokeOpts(params, brushOpts, rng)));
      }
    }
  }

  return strokes;
}

// ═══════════════════════════════════════════════════════════════
// COVER BALANCING (ensure both sides have adequate cover)
// ═══════════════════════════════════════════════════════════════

function balanceCover(rng, bounds, biome, spawnZones, allStrokes, params) {
  const strokes = [];
  const isVertical = !spawnZones || spawnZones.orientation !== 'horizontal';
  const { width, height } = bounds;

  // Split strokes into two halves along the spawn axis
  const midpoint = isVertical ? height / 2 : width / 2;
  const coverStrokes = allStrokes.filter(s => s.type === 'forest' || s.type === 'brush');

  let coverA = 0; // side with spawn[0] (top or left)
  let coverB = 0; // side with spawn[1] (bottom or right)

  for (const s of coverStrokes) {
    const pos = isVertical ? s.y : s.x;
    const area = Math.PI * s.radius * s.radius;
    if (pos < midpoint) {
      coverA += area;
    } else {
      coverB += area;
    }
  }

  // If imbalanced (ratio > 1.4:1), add cover to the lighter side
  const ratio = Math.max(coverA, coverB) / (Math.min(coverA, coverB) || 1);
  if (ratio < 1.4) return strokes;

  const lightSide = coverA < coverB ? 'A' : 'B';
  const brushOpts = getBrushOpts(biome);
  const forestOpts = getForestOpts(biome);

  // Add 4-8 compensating features to the lighter side
  const addCount = Math.min(8, Math.ceil((ratio - 1.2) * 4));

  for (let i = 0; i < addCount; i++) {
    let x, y;

    if (isVertical) {
      x = rng.float(width * 0.1, width * 0.9);
      y = lightSide === 'A'
        ? rng.float(height * 0.15, height * 0.45)
        : rng.float(height * 0.55, height * 0.85);
    } else {
      x = lightSide === 'A'
        ? rng.float(width * 0.15, width * 0.45)
        : rng.float(width * 0.55, width * 0.85);
      y = rng.float(height * 0.1, height * 0.9);
    }

    if (overlapsSpawnZone(x, y, 40, spawnZones)) continue;

    // Mix of brush (70%) and small forest (30%)
    if (rng.chance(0.7)) {
      const r = rng.float(30, 55);
      strokes.push(createStroke('brush', x, y, r, brushStrokeOpts(params, brushOpts, rng)));
    } else {
      const r = rng.float(40, 70);
      strokes.push(createStroke('forest', x, y, r, forestStrokeOpts(params, forestOpts, rng)));
    }
  }

  console.log(`[PCG] Cover balance: A=${Math.round(coverA)} B=${Math.round(coverB)} ratio=${ratio.toFixed(1)} → added ${strokes.length} to side ${lightSide}`);
  return strokes;
}

// ═══════════════════════════════════════════════════════════════
// FOREST BRIDGING (connect nearby forests for flanking routes)
// ═══════════════════════════════════════════════════════════════

function bridgeForests(rng, forestStrokes, biome, spawnZones, params) {
  const bridges = [];
  const primaries = forestStrokes.filter(s => s.radius >= 50);
  const forestOpts = getForestOpts(biome);

  for (let i = 0; i < primaries.length; i++) {
    for (let j = i + 1; j < primaries.length; j++) {
      const a = primaries[i];
      const b = primaries[j];

      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const gap = dist - a.radius - b.radius;

      // Bridge close forests (gap 0-120px) with 30% probability
      if (gap > 0 && gap < 120 && rng.chance(0.3)) {
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;

        if (spawnZones && overlapsSpawnZone(midX, midY, 40, spawnZones)) continue;

        const bridgeRadius = Math.min(gap * 0.6, 45);
        if (bridgeRadius < 20) continue;

        bridges.push(createStroke('forest', midX, midY, bridgeRadius, forestStrokeOpts(params, forestOpts, rng)));
      }
    }
  }

  return bridges;
}

// ═══════════════════════════════════════════════════════════════
// WATER VEGETATION (trees + brush near water edges)
// ═══════════════════════════════════════════════════════════════

/**
 * Place mixed vegetation (trees + brush) around water body shores and river banks.
 * Density and tree/brush ratio controlled by sliders.
 */
function placeWaterVegetation(rng, params, bounds, biome, spawnZones, riverData, waterStrokes) {
  const strokes = [];
  const density = (params.waterVegDensity ?? 50) / 100;
  if (density <= 0) return strokes;

  const treeRatio = (params.waterVegTreeRatio ?? 30) / 100;
  const forestOpts = getForestOpts(biome);
  const brushOpts = getBrushOpts(biome);
  const margin = 8; // offset from water edge

  // Collect vegetation sample points around water features
  const vegPoints = [];

  // 1) Water body boundaries: sample along each water stroke's centers
  for (const ws of waterStrokes) {
    if (ws.type !== 'water') continue;
    const centers = ws.centers || [{ x: ws.x, y: ws.y }];
    const r = ws.radius || 60;
    // Sample a subset of boundary points around each water body
    const step = Math.max(1, Math.floor(centers.length / 12));
    for (let i = 0; i < centers.length; i += step) {
      const c = centers[i];
      // Place points at several angles around the perimeter
      const angleCount = 4;
      for (let a = 0; a < angleCount; a++) {
        const angle = (a / angleCount) * Math.PI * 2 + rng.float(0, 0.5);
        const dist = r + margin + rng.float(5, 25);
        vegPoints.push({
          x: c.x + Math.cos(angle) * dist,
          y: c.y + Math.sin(angle) * dist
        });
      }
    }
  }

  // 2) River banks: sample spine at intervals, offset perpendicular on both sides
  if (riverData && riverData.spine && riverData.spine.length > 0) {
    const rSpine = riverData.spine;
    const rW = riverData.brushRadius;
    const sampleInterval = Math.max(3, Math.floor(rSpine.length / 20));
    for (let i = 0; i < rSpine.length; i += sampleInterval) {
      const p = rSpine[i];
      // Get local perpendicular direction
      const prev = rSpine[Math.max(0, i - 1)];
      const next = rSpine[Math.min(rSpine.length - 1, i + 1)];
      const ldx = next.x - prev.x;
      const ldy = next.y - prev.y;
      const lLen = Math.hypot(ldx, ldy) || 1;
      const perpX = -ldy / lLen;
      const perpY = ldx / lLen;

      const bankDist = rW + margin + rng.float(10, 30);
      // Both banks
      vegPoints.push({ x: p.x + perpX * bankDist, y: p.y + perpY * bankDist });
      vegPoints.push({ x: p.x - perpX * bankDist, y: p.y - perpY * bankDist });
    }
  }

  // 3) Place vegetation at each point (probability = density)
  for (const vp of vegPoints) {
    // Skip out-of-bounds
    if (vp.x < 10 || vp.x > bounds.width - 10 || vp.y < 10 || vp.y > bounds.height - 10) continue;
    // Skip spawn zones
    if (overlapsSpawnZone(vp.x, vp.y, 20, spawnZones)) continue;
    // Probability check
    if (!rng.chance(density)) continue;

    if (rng.chance(treeRatio)) {
      // Tree: small forest stroke
      const r = rng.float(20, 40);
      strokes.push(createStroke('forest', vp.x, vp.y, r,
        forestStrokeOpts(params, forestOpts, rng, 0.5)));
    } else {
      // Brush: small brush stroke
      const r = rng.float(15, 30);
      strokes.push(createStroke('brush', vp.x, vp.y, r, {
        ...brushOpts,
        seed: rng.int(0, 999999)
      }));
    }
  }

  return strokes;
}

// ═══════════════════════════════════════════════════════════════
// BRUSH CLUSTERS
// ═══════════════════════════════════════════════════════════════

function placeBrushClusters(rng, params, bounds, biome, forestStrokes, spawnZones) {
  const strokes = [];
  const { width, height } = bounds;
  const count = params.brushCount;
  if (count <= 0) return strokes;

  const brushOpts = getBrushOpts(biome);

  // Place brush in several modes for organic distribution:
  // 40% near forest edges, 30% filling open gaps, 30% scattered
  for (let i = 0; i < count; i++) {
    let x, y;
    const roll = rng.random();

    if (roll < 0.4 && forestStrokes.length > 0) {
      // Near a forest edge — creates transition zones
      const forest = rng.pick(forestStrokes);
      const angle = rng.random() * Math.PI * 2;
      const dist = forest.radius + rng.float(15, 50);
      x = forest.x + Math.cos(angle) * dist;
      y = forest.y + Math.sin(angle) * dist;
    } else if (roll < 0.7) {
      // Gap-filling: place between two features as stepping-stone cover
      if (forestStrokes.length >= 2) {
        const a = rng.pick(forestStrokes);
        const b = rng.pick(forestStrokes);
        if (a !== b) {
          const t = rng.float(0.3, 0.7);
          x = a.x + (b.x - a.x) * t + rng.float(-40, 40);
          y = a.y + (b.y - a.y) * t + rng.float(-40, 40);
        } else {
          x = rng.float(width * 0.05, width * 0.95);
          y = rng.float(height * 0.05, height * 0.95);
        }
      } else {
        x = rng.float(width * 0.05, width * 0.95);
        y = rng.float(height * 0.05, height * 0.95);
      }
    } else {
      // Random scatter
      x = rng.float(width * 0.05, width * 0.95);
      y = rng.float(height * 0.05, height * 0.95);
    }

    x = Math.max(20, Math.min(width - 20, x));
    y = Math.max(20, Math.min(height - 20, y));

    if (spawnZones && overlapsSpawnZone(x, y, params.brushMaxRadius, spawnZones)) continue;

    const radius = rng.float(params.brushMinRadius, params.brushMaxRadius);

    strokes.push(createStroke('brush', x, y, radius, brushStrokeOpts(params, brushOpts, rng)));

    // 45% chance: add a secondary brush nearby for cluster feel
    if (rng.chance(0.45)) {
      const sx = x + rng.float(-40, 40);
      const sy = y + rng.float(-40, 40);
      if (sx > 20 && sx < width - 20 && sy > 20 && sy < height - 20) {
        if (!spawnZones || !overlapsSpawnZone(sx, sy, 30, spawnZones)) {
          strokes.push(createStroke('brush', sx, sy, radius * rng.float(0.5, 0.8),
            brushStrokeOpts(params, brushOpts, rng)));
        }
      }
    }
  }

  return strokes;
}

// ═══════════════════════════════════════════════════════════════
// CHOKEPOINTS
// ═══════════════════════════════════════════════════════════════

function createChokepoints(rng, params, bounds, biome, forestStrokes, waterStrokes, spawnZones) {
  const strokes = [];
  const targetChokepoints = params.chokepoints;
  if (targetChokepoints <= 0 || forestStrokes.length < 2) return strokes;

  const { width, height } = bounds;
  const chokepointWidth = params.chokepointWidth;
  const isVertical = !spawnZones || spawnZones.orientation !== 'horizontal';

  const scanCount = 5;
  const forestOpts = getForestOpts(biome);

  // Combine all obstacle strokes
  const obstacles = [...forestStrokes, ...waterStrokes];

  // Scan across the depth axis (spawn→spawn direction) at evenly spaced positions
  const scanLength = isVertical ? width : height;    // perpendicular extent
  const depthLength = isVertical ? height : width;   // spawn-to-spawn extent

  for (let scanIdx = 0; scanIdx < scanCount && strokes.length < targetChokepoints; scanIdx++) {
    const scanPos = depthLength * (0.25 + scanIdx * 0.5 / scanCount);

    // Find gaps along the perpendicular axis at this depth position
    const gaps = findGaps(obstacles, scanPos, scanLength, isVertical);

    for (const gap of gaps) {
      if (strokes.length >= targetChokepoints) break;
      if (gap.width > chokepointWidth * 2) {
        const gapCenter = gap.start + gap.width / 2 + rng.float(-gap.width * 0.2, gap.width * 0.2);
        const narrowRadius = (gap.width - chokepointWidth) / 2 * rng.float(0.3, 0.6);

        if (narrowRadius > 30) {
          // Place forest at the correct coordinates based on orientation
          const fx = isVertical ? gapCenter : scanPos;
          const fy = isVertical ? scanPos : gapCenter;

          strokes.push(createStroke('forest', fx, fy, narrowRadius, forestStrokeOpts(params, forestOpts, rng)));
        }
      }
    }
  }

  return strokes;
}

/**
 * Find open gaps along a scan line (horizontal or vertical)
 * @param {boolean} isVertical - true = scan horizontally at a Y position, false = scan vertically at an X position
 */
function findGaps(obstacles, scanPos, scanLength, isVertical) {
  const covered = [];
  for (const obs of obstacles) {
    // Distance along the depth axis from scan line to obstacle center
    const depthDist = isVertical ? Math.abs(scanPos - obs.y) : Math.abs(scanPos - obs.x);
    if (depthDist < obs.radius) {
      const halfSpan = Math.sqrt(obs.radius * obs.radius - depthDist * depthDist);
      // Position along the perpendicular (scanned) axis
      const center = isVertical ? obs.x : obs.y;
      covered.push({ start: center - halfSpan, end: center + halfSpan });
    }
  }

  covered.sort((a, b) => a.start - b.start);

  const merged = [];
  for (const range of covered) {
    if (merged.length > 0 && range.start <= merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  const gaps = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) {
      gaps.push({ start: cursor, width: range.start - cursor });
    }
    cursor = range.end;
  }
  if (cursor < scanLength) {
    gaps.push({ start: cursor, width: scanLength - cursor });
  }

  return gaps;
}

// ═══════════════════════════════════════════════════════════════
// CONNECTIVITY VALIDATION (flood-fill)
// ═══════════════════════════════════════════════════════════════

/**
 * Verify all spawn zones can reach each other via BFS on a coarse grid.
 * Deep water blocks movement; forests/brush slow but don't block.
 */
function validateConnectivity(strokes, bounds, spawnZones) {
  const cellSize = PCG_RULES.connectivity.cellSize;
  const gridW = Math.ceil(bounds.width / cellSize);
  const gridH = Math.ceil(bounds.height / cellSize);

  // Build passability grid (1 = passable, 0 = blocked)
  const passable = new Uint8Array(gridW * gridH).fill(1);

  // Only deep water blocks
  for (const s of strokes) {
    if (s.type !== 'water') continue;
    if ((s.waterDepth || 0) < PCG_RULES.connectivity.deepWaterThreshold) continue;

    const minGX = Math.max(0, Math.floor((s.x - s.radius) / cellSize));
    const maxGX = Math.min(gridW - 1, Math.floor((s.x + s.radius) / cellSize));
    const minGY = Math.max(0, Math.floor((s.y - s.radius) / cellSize));
    const maxGY = Math.min(gridH - 1, Math.floor((s.y + s.radius) / cellSize));

    for (let gy = minGY; gy <= maxGY; gy++) {
      for (let gx = minGX; gx <= maxGX; gx++) {
        const wx = (gx + 0.5) * cellSize;
        const wy = (gy + 0.5) * cellSize;
        const dx = wx - s.x;
        const dy = wy - s.y;
        // Only block inner area (not the shore fade)
        const blockR = s.radius * PCG_RULES.connectivity.blockingRadiusFraction;
        if (dx * dx + dy * dy < blockR * blockR) {
          passable[gy * gridW + gx] = 0;
        }
      }
    }
  }

  // BFS from first spawn zone
  const visited = new Uint8Array(gridW * gridH);
  const sx = Math.floor(spawnZones[0].x / cellSize);
  const sy = Math.floor(spawnZones[0].y / cellSize);
  const startIdx = sy * gridW + sx;
  if (startIdx >= 0 && startIdx < passable.length) {
    visited[startIdx] = 1;
  }

  const queue = [startIdx];
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];

  while (queue.length > 0) {
    const idx = queue.shift();
    const gx = idx % gridW;
    const gy = Math.floor(idx / gridW);

    for (const [ddx, ddy] of dirs) {
      const nx = gx + ddx;
      const ny = gy + ddy;
      if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
      const nIdx = ny * gridW + nx;
      if (visited[nIdx] || !passable[nIdx]) continue;
      visited[nIdx] = 1;
      queue.push(nIdx);
    }
  }

  // Check all other spawn zones are reachable
  for (let i = 1; i < spawnZones.length; i++) {
    const gx = Math.floor(spawnZones[i].x / cellSize);
    const gy = Math.floor(spawnZones[i].y / cellSize);
    const idx = gy * gridW + gx;
    if (idx >= 0 && idx < visited.length && !visited[idx]) {
      return false; // Disconnected
    }
  }

  return true;
}
