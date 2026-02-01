// ═══════════════════════════════════════════════════════════════
// SCATTER SYSTEM - Unified terrain element generation
// ═══════════════════════════════════════════════════════════════
// Pure generation logic. All config data lives in season-config.js.
// ═══════════════════════════════════════════════════════════════

import {
  COLOR_VARIATION,
  TREE_AGES,
  AGE_MODIFIERS,
  TREE_CATEGORIES,
  SCATTER_TYPES,
  SPAWN_RULES,
  SEASONS,
  BIOME_PRESETS,
  TREE_AGE_THRESHOLD,
  getEffectiveSettings,
  getSeasonBiomeConfig
} from './season-config.js';

// Re-export config for consumers that import from scatter.js
export {
  COLOR_VARIATION,
  TREE_AGES,
  TREE_AGE_THRESHOLD,
  AGE_MODIFIERS,
  TREE_CATEGORIES,
  SCATTER_TYPES,
  SPAWN_RULES,
  SEASONS,
  BIOME_PRESETS,
  getEffectiveSettings,
  getSeasonBiomeConfig
};

// Also re-export new config entries
export { SEASON_BIOME_CONFIG, getConfigSchema, exportConfigString } from './season-config.js';

// ═══════════════════════════════════════════════════════════════
// SPATIAL HASH - O(1) collision lookups
// ═══════════════════════════════════════════════════════════════
// Divides space into grid cells for fast nearby item queries.
// Instead of checking all N items (O(n²)), we only check items
// in nearby cells (O(1) average case).
// ═══════════════════════════════════════════════════════════════

const SPATIAL_CELL_SIZE = 100; // pixels per cell

/**
 * Spatial hash index for fast collision detection
 */
class SpatialHash {
  constructor(cellSize = SPATIAL_CELL_SIZE) {
    this.cellSize = cellSize;
    this.cells = new Map(); // Map<"x,y", Set<item>>
    this.itemCells = new Map(); // Map<item.id, "x,y"> for removal
  }

  /**
   * Get cell key for a position
   */
  _getCellKey(x, y) {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return `${cx},${cy}`;
  }

  /**
   * Insert an item into the hash
   */
  insert(item) {
    const key = this._getCellKey(item.x, item.y);

    if (!this.cells.has(key)) {
      this.cells.set(key, new Set());
    }
    this.cells.get(key).add(item);
    this.itemCells.set(item.id, key);
  }

  /**
   * Remove an item from the hash
   */
  remove(item) {
    const key = this.itemCells.get(item.id);
    if (key && this.cells.has(key)) {
      this.cells.get(key).delete(item);
      // Clean up empty cells
      if (this.cells.get(key).size === 0) {
        this.cells.delete(key);
      }
    }
    this.itemCells.delete(item.id);
  }

  /**
   * Query items within radius of a point
   * Returns items from all cells that could contain nearby items
   */
  query(x, y, radius) {
    const results = [];

    // Calculate cell range to check
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCy = Math.floor((y - radius) / this.cellSize);
    const maxCy = Math.floor((y + radius) / this.cellSize);

    // Check all cells in range
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = `${cx},${cy}`;
        const cell = this.cells.get(key);
        if (cell) {
          for (const item of cell) {
            results.push(item);
          }
        }
      }
    }

    return results;
  }

  /**
   * Clear all items
   */
  clear() {
    this.cells.clear();
    this.itemCells.clear();
  }

  /**
   * Get total item count (for debugging)
   */
  get size() {
    let count = 0;
    for (const cell of this.cells.values()) {
      count += cell.size;
    }
    return count;
  }
}

/**
 * Global spatial hash instance (per terrainMap)
 * Stored on terrainMap._spatialHash
 */
function getSpatialHash(terrainMap) {
  if (!terrainMap._spatialHash) {
    terrainMap._spatialHash = new SpatialHash();
    // Index existing items if any
    if (terrainMap.scatterItems) {
      for (const item of terrainMap.scatterItems) {
        terrainMap._spatialHash.insert(item);
      }
    }
  }
  return terrainMap._spatialHash;
}

/**
 * Rebuild spatial hash from scratch (after load or major changes)
 */
export function rebuildSpatialHash(terrainMap) {
  terrainMap._spatialHash = new SpatialHash();
  if (terrainMap.scatterItems) {
    for (const item of terrainMap.scatterItems) {
      terrainMap._spatialHash.insert(item);
    }
  }
  return terrainMap._spatialHash;
}

// Config data imported from season-config.js (see top of file)

/**
 * Simple seeded random for consistent placement
 */
function seededRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/**
 * Generate unique ID - uses incrementing counter for performance
 * Avoids Date.now() and random string generation in hot path
 */
let _idCounter = 0;
function generateId(prefix = 'scatter') {
  return `${prefix}_${++_idCounter}`;
}

// SCATTER_TYPES imported from season-config.js

// SPAWN_RULES, TREE_AGES, TREE_AGE_THRESHOLD imported from season-config.js

// ═══════════════════════════════════════════════════════════════
// GENERATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Generate scatter items for a given area
 * @param {object} terrainMap - TerrainMap with scatterItems[]
 * @param {object} source - Area definition: { x, y, radius } or stroke object
 * @param {string} type - Type key from SCATTER_TYPES
 * @param {object} options - Generation options
 * @returns {object[]} Array of created ScatterItem objects
 */
export function generateScatter(terrainMap, source, type, options = {}) {
  const config = SCATTER_TYPES[type];
  if (!config) {
    console.warn(`[Scatter] Unknown type: ${type}`);
    return [];
  }

  // Ensure scatterItems array exists
  if (!terrainMap.scatterItems) terrainMap.scatterItems = [];

  // Extract source properties
  const x = source.x;
  const y = source.y;
  const radius = source.radius;
  const seed = source.seed ?? options.seed ?? Math.floor(Math.random() * 1000000);
  const strokeId = source.id ?? options.strokeId ?? null;

  // Get options with defaults
  // Density is now a multiplier (0.5 to 2.0) that affects spacing
  // Higher density = tighter spacing = more items
  const densityMultiplier = options.density ?? 1.0;
  const globalScale = options.scale ?? (config.category === 'tree' ? 0.08 : 0.12);
  const shouldSpawnChildren = options.spawnChildren !== false;
  const parent = options.parent ?? null;

  // Tree-specific options
  const selectedAges = options.selectedAges ?? ['young', 'transitional', 'old'];
  const ageRatios = options.ageRatios ?? null;
  const forceAllDead = options.forceAllDead ?? false;

  // Dry run mode - generate items without adding to terrainMap or spatial hash
  const dryRun = options.dryRun ?? false;

  // Existing items to check for collision in dry run mode (for multi-type preview generation)
  const existingItems = options.existingItems ?? [];

  // ═══════════════════════════════════════════════════════════════
  // SPACING-BASED DENSITY CALCULATION
  // ═══════════════════════════════════════════════════════════════
  // Instead of absolute count, we calculate how many items can fit
  // based on brush area and type-specific spacing requirements.
  //
  // effectiveSpacing = baseSpacing / densityMultiplier
  // targetCount = brushArea / (effectiveSpacing²) * packingEfficiency
  // ═══════════════════════════════════════════════════════════════

  // Get base spacing from config (this is the "room to grow" value)
  const baseSpacing = config.spacing || 40;

  // Calculate effective spacing based on density multiplier
  // Higher density = smaller spacing = items closer together
  const effectiveSpacing = baseSpacing / Math.max(0.5, Math.min(2.0, densityMultiplier));

  // Calculate brush area
  const brushArea = Math.PI * radius * radius;

  // Calculate target count based on area divided by spacing squared
  // Packing efficiency factor (0.5) accounts for random placement not achieving
  // perfect hexagonal packing - we expect roughly half the theoretical max
  const packingEfficiency = 0.5;
  const baseTargetCount = Math.floor((brushArea / (effectiveSpacing * effectiveSpacing)) * packingEfficiency);

  // Ratio fraction: when generating multiple types, each gets a fraction of the total
  // e.g., oak at 60% gets ratioFraction=0.6, so its target is 60% of what it would normally be
  const ratioFraction = options.ratioFraction ?? 1.0;
  const targetCount = Math.max(1, Math.round(baseTargetCount * ratioFraction));

  // Performance caps: limit attempts to prevent infinite loops
  // maxAttempts is 2x target (to handle collisions) but capped at 100
  const maxAttempts = Math.min(targetCount * 2, 100);

  const addedItems = [];

  for (let i = 0; i < maxAttempts; i++) {
    const itemSeed = seed + i * 1000;

    // Random position within area
    const angle = seededRandom(itemSeed) * Math.PI * 2;
    const distFactor = Math.sqrt(seededRandom(itemSeed + 1)); // sqrt for uniform distribution
    const dist = distFactor * radius * 0.95;
    const ix = x + Math.cos(angle) * dist;
    const iy = y + Math.sin(angle) * dist;

    // Check water collision (for trees and brush)
    if (config.category === 'tree' || config.category === 'brush') {
      const allowInWater = options.allowInWater ?? false;
      if (!allowInWater && terrainMap.strokes) {
        const inWater = terrainMap.strokes.some(s => {
          if (s.type !== 'water') return false;
          const dx = s.x - ix;
          const dy = s.y - iy;
          const d = Math.sqrt(dx * dx + dy * dy);
          const effectiveRadius = s.radius + (s.shoreWidth || 0);
          return d < effectiveRadius;
        });
        if (inWater) continue;
      }
    }

    // Calculate scale
    let ageScale = 1.0;
    let selectedAge = null;

    if (config.ages && config.ages.length > 0) {
      // Dead tree sprites only exist for young/old, not transitional
      // Filter ages when forceAllDead to avoid missing sprites
      const deadCompatibleAges = ['young', 'old'];
      const effectiveAges = forceAllDead
        ? selectedAges.filter(a => deadCompatibleAges.includes(a))
        : selectedAges;
      // Fallback to young/old if no compatible ages selected
      const agesToUse = effectiveAges.length > 0 ? effectiveAges : deadCompatibleAges;

      // Select age based on weighted ratios
      const ageScales = agesToUse.map(age => ({
        age,
        scale: TREE_AGES[age] || TREE_AGES.young,
        ratio: ageRatios ? (ageRatios[age] || 0) : (1 / agesToUse.length)
      }));

      const ageRand = seededRandom(itemSeed + 4);
      let cumulative = 0;
      let chosen = ageScales[0];
      for (const ageInfo of ageScales) {
        cumulative += ageInfo.ratio;
        if (ageRand < cumulative) {
          chosen = ageInfo;
          break;
        }
      }
      ageScale = chosen.scale;
      selectedAge = chosen.age;
    }

    // Scale with variance
    const scaleVariance = config.scaleVariance ?? 0.3;
    const scaleRand = 1 + (seededRandom(itemSeed + 2) - 0.5) * 2 * scaleVariance;
    const finalScale = config.baseScale * ageScale * scaleRand * globalScale;

    // ═══════════════════════════════════════════════════════════════
    // CANOPY COLLISION SYSTEM
    // ═══════════════════════════════════════════════════════════════
    // Universal rule for visibility: distance > (A.canopyRadius * A.scale) - (B.canopyRadius * B.scale)
    // This ensures item B always "sticks out" from under item A's canopy.
    //
    // Tree vs Tree: uses spacing (modified by treeSpacing slider)
    // Brush vs Brush: uses canopyRadius visibility rule
    // Brush vs Tree: uses canopyRadius visibility rule (brush must stick out)
    // Floor/particles: handled in spawnChildren() - check ALL nearby tree canopies
    // ═══════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════
    // CANOPY COLLISION SYSTEM
    // ═══════════════════════════════════════════════════════════════
    // Tree vs Tree: spacing-based collision (modified by treeSpacing slider)
    // Brush vs Brush: spacing-based collision (like trees)
    // Brush vs Tree: canopyRadius visibility rule (brush must stick out)
    // Floor/particles: handled in spawnChildren() - check ALL nearby tree canopies
    // ═══════════════════════════════════════════════════════════════

    if (config.spacing > 0) {
      const isTree = config.category === 'tree';
      const isBrush = config.category === 'brush';

      // Only trees and brush have collision detection
      if (isTree || isBrush) {
        // Tree spacing is modified by treeSpacing option (50%-150%)
        const treeSpacing = isTree ? (options.treeSpacing ?? 1.0) : 1.0;

        // Calculate spacing-based collision radius (same formula for trees and brush)
        const itemSpacing = Math.min(effectiveSpacing * finalScale * 4 * treeSpacing, radius * 1.5);

        // Get canopy radius for visibility checks (brush vs tree)
        const newCanopyRadius = config.canopyRadius || 30;
        const newCanopyScaled = newCanopyRadius * finalScale;

        // Query only nearby items from spatial hash instead of all items
        const spatialHash = getSpatialHash(terrainMap);
        const searchRadius = Math.max(itemSpacing, 100) * 2; // Search area
        const nearbyItems = spatialHash.query(ix, iy, searchRadius);

        // In dryRun mode, items aren't inserted into the spatial hash, so also
        // check items placed earlier in this batch for self-collision
        // Also check existingItems (for multi-type preview generation)
        const candidates = dryRun
          ? nearbyItems.concat(addedItems).concat(existingItems)
          : nearbyItems;

        const tooClose = candidates.some(existing => {
          const existingConfig = SCATTER_TYPES[existing.type];
          if (!existingConfig) return false;

          const existingIsTree = existingConfig.category === 'tree';
          const existingIsBrush = existingConfig.category === 'brush';

          // Skip if not a relevant collision pair
          if (isTree && !existingIsTree) return false; // Trees only collide with trees
          if (isBrush && !existingIsBrush && !existingIsTree) return false; // Brush collides with brush and trees
          if (!isTree && !isBrush) return false; // floor/particle don't collide here

          const dx = existing.x - ix;
          const dy = existing.y - iy;
          const d = Math.sqrt(dx * dx + dy * dy);

          // ─────────────────────────────────────────────────────────
          // TREE VS TREE: Use spacing-based collision
          // ─────────────────────────────────────────────────────────
          if (isTree && existingIsTree) {
            const existingBaseSpacing = existingConfig.spacing || 40;
            const existingEffectiveSpacing = existingBaseSpacing / densityMultiplier * treeSpacing;
            const existingSpacing = existingEffectiveSpacing * existing.scale * 4;
            const minDist = (itemSpacing + existingSpacing) / 2;
            return d < minDist;
          }

          // ─────────────────────────────────────────────────────────
          // BRUSH VS TREE: Canopy visibility rule
          // Brush must "stick out" from tree canopy (never fully hidden)
          // Rule: distance > (tree.canopyRadius * tree.scale) - (brush.canopyRadius * brush.scale)
          // ─────────────────────────────────────────────────────────
          if (isBrush && existingIsTree) {
            const existingCanopyRadius = existingConfig.canopyRadius || 30;
            const existingCanopyScaled = existingCanopyRadius * existing.scale;
            const minDist = existingCanopyScaled - newCanopyScaled;
            return d < minDist;
          }

          // ─────────────────────────────────────────────────────────
          // BRUSH VS BRUSH: Use spacing-based collision (like trees)
          // ─────────────────────────────────────────────────────────
          if (isBrush && existingIsBrush) {
            const existingBaseSpacing = existingConfig.spacing || 100;
            const existingEffectiveSpacing = existingBaseSpacing / densityMultiplier;
            const existingSpacing = existingEffectiveSpacing * existing.scale * 4;
            const minDist = (itemSpacing + existingSpacing) / 2;
            return d < minDist;
          }

          return false;
        });

        if (tooClose) {
          continue;
        }
      }
    }

    // Calculate rotation based on category
    // Trees and brush don't rotate, floor and particles do
    let rotation = 0;
    if (config.category === 'floor' || config.category === 'particle') {
      rotation = seededRandom(itemSeed + 5) * 360;
    }

    // Create scatter item
    const item = {
      id: generateId(config.category),
      type,
      strokeId,
      parentId: parent?.id ?? null,
      x: ix,
      y: iy,
      scale: finalScale,
      rotation,
      alpha: 1.0,
      variant: Math.floor(seededRandom(itemSeed + 3) * config.variants) + 1,
      hueShift: (seededRandom(itemSeed + 6) - 0.5) * COLOR_VARIATION.hueRange,
      brightness: 1 + (seededRandom(itemSeed + 7) - 0.5) * COLOR_VARIATION.brightnessRange,
      saturation: 1 + (seededRandom(itemSeed + 8) - 0.5) * COLOR_VARIATION.saturationRange
    };

    // Tree-specific properties
    if (config.category === 'tree') {
      item.age = selectedAge;
      // Dead if forced, or if this is a dead tree type (config.isDead)
      item.isDead = forceAllDead || config.isDead || false;

      // Apply season canopy color modifiers from biome config (not UI overrides - those apply at render time)
      const seasonConfig = getSeasonBiomeConfig(options.season || 'summer', options.biome || 'temperate');
      const canopy = seasonConfig?.canopy;
      if (canopy) {
        item.hueShift += canopy.hueShift || 0;
        item.brightness *= canopy.brightness ?? 1;
        item.saturation *= canopy.saturation ?? 1;
      }
    }

    // Add to registry and spatial hash (skip in dry run mode)
    if (!dryRun) {
      terrainMap.scatterItems.push(item);
      getSpatialHash(terrainMap).insert(item);
    }
    addedItems.push(item);

    // Spawn children if enabled (scales are defined in SPAWN_RULES per tree type)
    if (shouldSpawnChildren && SPAWN_RULES[type]) {
      const children = spawnChildren(terrainMap, item, {
        seed: itemSeed + 10000,
        season: options.season || 'summer',
        biome: options.biome || 'temperate',
        seasonOverrides: options.seasonOverrides || {},
        childSpawnOverrides: options.childSpawnOverrides || {},
        brushRadius: radius,  // Pass brush size for density scaling
        images: options.images,  // Pass images for actual sprite dimension lookup
        dryRun
      });
      addedItems.push(...children);
    }

    // Early exit: stop once we've placed enough primary items (trees/brush)
    // Count only items of this type's category (not children)
    const primaryCount = addedItems.filter(it => {
      const c = SCATTER_TYPES[it.type];
      return c && c.category === config.category;
    }).length;
    if (primaryCount >= targetCount) {
      break;
    }
  }

  return addedItems;
}

/**
 * Spawn child items for a parent scatter item
 * @param {object} terrainMap - TerrainMap
 * @param {object} parent - Parent ScatterItem
 * @param {object} options - Spawn options
 * @param {string} options.season - Season context ('spring', 'summer', 'fall', 'winter')
 * @returns {object[]} Array of spawned child items
 */
export function spawnChildren(terrainMap, parent, options = {}) {
  const rules = SPAWN_RULES[parent.type];
  if (!rules || !rules.spawns) return [];

  const parentConfig = SCATTER_TYPES[parent.type];
  if (!parentConfig) return [];

  // Calculate parent's visual radius from actual loaded sprite dimensions
  // If images provided, use real dimensions; otherwise fall back to config
  let spriteWidth = 256; // default fallback
  if (options.images && parentConfig.category === 'tree') {
    const spriteKey = getSpriteKey(parent);
    const img = options.images.tree?.[spriteKey];
    if (img && img.width) {
      spriteWidth = img.width;
    }
  }
  const canopyFill = parentConfig.canopyFill ?? 0.8;
  const canopyRadius = (spriteWidth / 2) * canopyFill * parent.scale;
  const baseSeed = options.seed ?? Date.now();

  // Get age and season modifiers
  const parentAge = parent.age || 'old';
  const ageMod = AGE_MODIFIERS[parentAge] || AGE_MODIFIERS.old;

  // Dry run mode
  const dryRun = options.dryRun ?? false;

  // Season + biome context
  const season = options.season || 'summer';
  const biome = options.biome || 'temperate';
  const seasonConfig = getSeasonBiomeConfig(season, biome);
  const scatter = seasonConfig?.scatter || {};

  // Apply user overrides from season tuning panel
  const overrides = options.seasonOverrides?.scatter || {};
  const floorType = overrides.floorType ?? scatter.floorType;
  const floorDensity = overrides.floorDensity ?? scatter.floorDensity ?? 1.0;
  const particleType = overrides.particleType ?? scatter.particleType;
  const particleDensity = overrides.particleDensity ?? scatter.particleDensity ?? 1.0;
  const brushDensity = overrides.brushDensity ?? scatter.brushDensity ?? 1.0;

  // Child spawn overrides (full control from UI)
  const childOverrides = options.childSpawnOverrides || {};
  const floorOverrides = childOverrides.floor || {};
  const particleOverrides = childOverrides.particle || {};
  const brushOverrides = childOverrides.brush || {};

  const allChildren = [];

  for (const spawnRule of rules.spawns) {
    // Determine actual type to spawn (season may override)
    let actualType = spawnRule.type;
    const baseConfig = SCATTER_TYPES[spawnRule.type];
    if (!baseConfig) continue;

    // Get category-specific overrides
    const catOverrides = baseConfig.category === 'floor' ? floorOverrides :
                          baseConfig.category === 'particle' ? particleOverrides :
                          baseConfig.category === 'brush' ? brushOverrides : {};

    // Check if this category is enabled
    if (catOverrides.enabled === false) continue;

    // Season type override for floor/particle (use season-specific sprites)
    // User type override takes priority over season override
    if (baseConfig.category === 'floor') {
      if (catOverrides.type && catOverrides.type !== 'auto') {
        actualType = catOverrides.type;
      } else if (floorType && (spawnRule.type === 'floor-leaf' || spawnRule.type.startsWith('floor-leaf'))) {
        actualType = floorType;
      }
    } else if (baseConfig.category === 'particle') {
      if (catOverrides.type && catOverrides.type !== 'auto') {
        actualType = catOverrides.type;
      } else if (particleType && (spawnRule.type === 'particle-leaf' || spawnRule.type.startsWith('particle-leaf'))) {
        actualType = particleType;
      }
    } else if (baseConfig.category === 'brush') {
      if (catOverrides.type && catOverrides.type !== 'auto') {
        actualType = catOverrides.type;
      }
    }

    const childConfig = SCATTER_TYPES[actualType];
    if (!childConfig) continue;

    // Calculate density: use override if provided, otherwise rule + variance
    const densityVariance = spawnRule.densityVariance ?? 0;
    let density = catOverrides.density ?? (spawnRule.density + Math.floor((seededRandom(baseSeed) - 0.5) * 2 * densityVariance));
    if (density <= 0) continue;

    // Apply age modifier based on child category
    const ageMultiplier = ageMod[childConfig.category] ?? 1.0;
    density *= ageMultiplier;

    // Apply season density multiplier from biome config
    const seasonMultiplier = childConfig.category === 'floor' ? floorDensity :
                             childConfig.category === 'particle' ? particleDensity :
                             childConfig.category === 'brush' ? brushDensity : 1.0;
    density *= seasonMultiplier;

    // Skip if density drops below threshold
    if (density < 0.5) continue;

    // Scale density by parent size
    const scaleMultiplier = Math.max(1, Math.pow(parent.scale / 0.1, 0.75));

    // Scale density by brush size - smaller brushes spawn fewer children
    // Reference size: 50px. Below that, density scales down proportionally
    const brushRadius = options.brushRadius ?? 50;
    const brushMultiplier = Math.min(1, brushRadius / 50);

    const finalDensity = Math.round(density * scaleMultiplier * brushMultiplier);

    // Get child spawn start from parent config (0 = trunk, 0.9 = canopy edge, 1.0+ = outside)
    // Dead trees default to 0 (visible through bare branches), live trees to 0.9 (at drip line)
    const childSpawnStart = parentConfig.childSpawnStart ?? (parentConfig.isDead ? 0 : 0.9);

    for (let i = 0; i < finalDensity; i++) {
      const childSeed = baseSeed + i * 137 + spawnRule.type.charCodeAt(0) * 1000;

      // Position based on distribution
      let cx, cy, alpha = 1.0;

      if (spawnRule.distribution === 'under-canopy') {
        // Radial distribution starting from childSpawnStart
        // For live trees: spawns at canopy edge and beyond (visible)
        // For dead trees: spawns from trunk outward (visible through bare branches)
        const minRadius = childSpawnStart * canopyRadius;
        // User override for radius, or default 1.3 (130%)
        const radiusOverride = catOverrides.radius ?? 1.3;
        const maxRadius = canopyRadius * radiusOverride;
        const ringWidth = maxRadius - minRadius;

        const angle = seededRandom(childSeed) * Math.PI * 2;
        // Falloff controls density distribution:
        // 0% = even spread (power 0.5 for uniform area distribution)
        // 100% = concentrated at center (power 2.0)
        const falloff = catOverrides.falloff ?? 0.5;
        const power = 0.5 + falloff * 1.5;
        const distFactor = Math.pow(seededRandom(childSeed + 1), power);
        const dist = minRadius + (distFactor * ringWidth);
        cx = parent.x + Math.cos(angle) * dist;
        cy = parent.y + Math.sin(angle) * dist;

        // Slight alpha variation for natural look (no user control needed)
        if (childConfig.fadeWithDistance) {
          alpha = 0.6 + seededRandom(childSeed + 2) * 0.4; // 0.6 to 1.0
        }
      } else if (spawnRule.distribution === 'ring') {
        // Ring around parent - respects childSpawnStart as minimum
        // Use single radius value, derive min from spawn rule
        const radiusOverride = catOverrides.radius ?? spawnRule.maxRadius ?? 1.2;
        const ruleMin = spawnRule.minRadius ?? 0.9;
        // Ensure ring starts at least at childSpawnStart
        const minRadius = Math.max(childSpawnStart, ruleMin) * canopyRadius;
        const maxRadius = Math.max(childSpawnStart + 0.3, radiusOverride) * canopyRadius;
        const ringWidth = Math.max(1, maxRadius - minRadius);

        const angle = seededRandom(childSeed) * Math.PI * 2;
        const distFactor = Math.pow(seededRandom(childSeed + 1), 0.4); // Bias toward inner edge
        const dist = minRadius + (distFactor * ringWidth);
        cx = parent.x + Math.cos(angle) * dist;
        cy = parent.y + Math.sin(angle) * dist;
      } else {
        // Default: random scatter from childSpawnStart outward
        const minRadius = childSpawnStart * canopyRadius;
        const radiusOverride = catOverrides.radius ?? 1.2;
        const maxRadius = canopyRadius * radiusOverride;
        const angle = seededRandom(childSeed) * Math.PI * 2;
        const distFactor = Math.sqrt(seededRandom(childSeed + 1));
        const dist = minRadius + distFactor * (maxRadius - minRadius);
        cx = parent.x + Math.cos(angle) * dist;
        cy = parent.y + Math.sin(angle) * dist;
      }

      // Calculate child scale - use override if provided, else spawn rule default
      const scaleVariance = childConfig.scaleVariance ?? 0.3;
      const scaleRand = 1 + (seededRandom(childSeed + 3) - 0.5) * 2 * scaleVariance;
      // User scale override, or spawn rule default
      const ruleScale = catOverrides.scale ?? spawnRule.scale ?? 0.12;
      const finalScale = childConfig.baseScale * scaleRand * ruleScale;

      // Skip very faint items
      if (alpha < 0.1) continue;

      // ─────────────────────────────────────────────────────────────
      // CANOPY OCCLUSION CHECK (floor/particles only)
      // Skip children that would be fully hidden under a NEIGHBORING tree's canopy.
      // Children under their own parent are fine (that's intended).
      // Universal rule: distance > (tree.canopyRadius * tree.scale) - (child.canopyRadius * child.scale)
      // Floor/particles have canopyRadius of 0, so they're hidden if distance < tree's canopy.
      // ─────────────────────────────────────────────────────────────
      if (!dryRun && (childConfig.category === 'floor' || childConfig.category === 'particle')) {
        // Child's effective radius (floor/particles are essentially point-sized for occlusion)
        const childCanopyRadius = childConfig.canopyRadius || 0;
        const childCanopyScaled = childCanopyRadius * finalScale;

        // Check if fully under any OTHER tree's canopy
        const spatialHash = getSpatialHash(terrainMap);
        const searchRadius = 150; // Search nearby trees
        const nearbyItems = spatialHash.query(cx, cy, searchRadius);

        const occluded = nearbyItems.some(item => {
          // Only check trees (not the parent)
          if (item.id === parent.id) return false;
          const itemConfig = SCATTER_TYPES[item.type];
          if (!itemConfig || itemConfig.category !== 'tree') return false;

          // Check if child is fully under this tree's canopy
          const treeCanopyRadius = itemConfig.canopyRadius || 30;
          const treeCanopyScaled = treeCanopyRadius * item.scale;

          const dx = cx - item.x;
          const dy = cy - item.y;
          const d = Math.sqrt(dx * dx + dy * dy);

          // Fully hidden if distance < tree's canopy - child's canopy
          // (child's canopy is ~0 for floor/particles, so essentially d < tree's canopy)
          const minVisibleDist = treeCanopyScaled - childCanopyScaled;
          return d < minVisibleDist;
        });

        if (occluded) continue; // Skip this child - would be wasted draw call
      }

      // Calculate rotation - floor and particles rotate, trees and brush don't
      let childRotation = 0;
      if (childConfig.category === 'floor' || childConfig.category === 'particle') {
        childRotation = seededRandom(childSeed + 4) * 360;
      }

      // Natural color variation (small, for variety within same sprite type)
      // No seasonal color shifts - we use different sprites per season instead
      const hueShift = (seededRandom(childSeed + 6) - 0.5) * COLOR_VARIATION.hueRange * 0.5;
      const brightness = 1 + (seededRandom(childSeed + 7) - 0.5) * COLOR_VARIATION.brightnessRange;
      const saturation = 1 + (seededRandom(childSeed + 8) - 0.5) * COLOR_VARIATION.saturationRange;

      // Create child item (uses actualType which may be season-specific)
      const child = {
        id: generateId(childConfig.category),
        type: actualType,
        strokeId: parent.strokeId,
        parentId: parent.id,
        x: cx,
        y: cy,
        scale: finalScale,
        rotation: childRotation,
        alpha,
        variant: Math.floor(seededRandom(childSeed + 5) * childConfig.variants) + 1,
        hueShift,
        brightness,
        saturation,
        // Store context for debugging/future use
        _parentAge: parentAge,
        _season: season
      };

      if (!dryRun) {
        terrainMap.scatterItems.push(child);
        getSpatialHash(terrainMap).insert(child);
      }
      allChildren.push(child);
    }
  }

  return allChildren;
}

// ═══════════════════════════════════════════════════════════════
// REMOVAL FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Remove all scatter items associated with a stroke (cascades to children)
 * @param {object} terrainMap - TerrainMap
 * @param {string} strokeId - Stroke ID
 * @returns {number} Number of items removed
 */
export function removeScatterByStroke(terrainMap, strokeId) {
  if (!terrainMap.scatterItems) return 0;
  const before = terrainMap.scatterItems.length;

  // Remove from spatial hash before filtering
  const spatialHash = getSpatialHash(terrainMap);
  for (const item of terrainMap.scatterItems) {
    if (item.strokeId === strokeId) {
      spatialHash.remove(item);
    }
  }

  terrainMap.scatterItems = terrainMap.scatterItems.filter(item => item.strokeId !== strokeId);
  return before - terrainMap.scatterItems.length;
}

/**
 * Remove all scatter items with a given parent ID
 * @param {object} terrainMap - TerrainMap
 * @param {string} parentId - Parent item ID
 * @returns {number} Number of items removed
 */
export function removeScatterByParent(terrainMap, parentId) {
  if (!terrainMap.scatterItems) return 0;
  const before = terrainMap.scatterItems.length;

  // Remove from spatial hash before filtering
  const spatialHash = getSpatialHash(terrainMap);
  for (const item of terrainMap.scatterItems) {
    if (item.parentId === parentId) {
      spatialHash.remove(item);
    }
  }

  terrainMap.scatterItems = terrainMap.scatterItems.filter(item => item.parentId !== parentId);
  return before - terrainMap.scatterItems.length;
}

/**
 * Remove scatter items within a radius
 * @param {object} terrainMap - TerrainMap
 * @param {number} x - Center X
 * @param {number} y - Center Y
 * @param {number} radius - Removal radius
 * @param {object} options - Options
 * @param {string[]} options.categories - Only remove these categories (null = all)
 * @param {boolean} options.cascade - Also remove children of removed items
 * @param {string} options.falloff - Falloff type ('hard', 'linear', 'smooth')
 * @returns {number} Number of items removed
 */
export function removeScatterInRadius(terrainMap, x, y, radius, options = {}) {
  if (!terrainMap.scatterItems) return 0;

  const categories = options.categories ?? null;
  const cascade = options.cascade !== false;
  const falloff = options.falloff ?? 'hard';
  const radiusSq = radius * radius;
  const spatialHash = getSpatialHash(terrainMap);

  // Find items to remove - use spatial hash for O(1) nearby query
  const toRemove = new Set();
  const toRemoveItems = []; // Track actual items for spatial hash removal

  // Query nearby items from spatial hash instead of iterating all
  const nearbyItems = spatialHash.query(x, y, radius);

  for (const item of nearbyItems) {
    // Check category filter
    if (categories) {
      const config = SCATTER_TYPES[item.type];
      if (!config || !categories.includes(config.category)) continue;
    }

    const dx = item.x - x;
    const dy = item.y - y;
    const distSq = dx * dx + dy * dy;

    if (distSq > radiusSq) continue;

    // Apply falloff
    if (falloff === 'hard') {
      toRemove.add(item.id);
      toRemoveItems.push(item);
    } else {
      const dist = Math.sqrt(distSq);
      const normalizedDist = dist / radius;
      let keepChance;

      if (falloff === 'linear') {
        keepChance = normalizedDist;
      } else {
        // Smooth (hermite)
        keepChance = normalizedDist * normalizedDist * (3 - 2 * normalizedDist);
      }

      if (Math.random() >= keepChance) {
        toRemove.add(item.id);
        toRemoveItems.push(item);
      }
    }
  }

  // Cascade to children (still needs full scan for parent relationships)
  if (cascade && toRemove.size > 0) {
    let foundMore = true;
    while (foundMore) {
      foundMore = false;
      for (const item of terrainMap.scatterItems) {
        if (item.parentId && toRemove.has(item.parentId) && !toRemove.has(item.id)) {
          toRemove.add(item.id);
          toRemoveItems.push(item);
          foundMore = true;
        }
      }
    }
  }

  // Remove from spatial hash
  for (const item of toRemoveItems) {
    spatialHash.remove(item);
  }

  // Remove items from array
  const before = terrainMap.scatterItems.length;
  terrainMap.scatterItems = terrainMap.scatterItems.filter(item => !toRemove.has(item.id));
  return before - terrainMap.scatterItems.length;
}

// ═══════════════════════════════════════════════════════════════
// QUERY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Get all scatter items for a render layer
 * @param {object} terrainMap - TerrainMap
 * @param {string} layer - 'ground' or 'canopy'
 * @returns {object[]} Items for that layer
 */
export function getScatterByLayer(terrainMap, layer) {
  if (!terrainMap.scatterItems) return [];
  return terrainMap.scatterItems.filter(item => {
    const config = SCATTER_TYPES[item.type];
    return config && config.layer === layer;
  });
}

/**
 * Get all scatter items for a category
 * @param {object} terrainMap - TerrainMap
 * @param {string} category - 'tree', 'floor', 'brush', or 'particle'
 * @returns {object[]} Items for that category
 */
export function getScatterByCategory(terrainMap, category) {
  if (!terrainMap.scatterItems) return [];
  return terrainMap.scatterItems.filter(item => {
    const config = SCATTER_TYPES[item.type];
    return config && config.category === category;
  });
}

/**
 * Get scatter items sorted for rendering
 * @param {object} terrainMap - TerrainMap
 * @param {string} sortBy - 'y', 'scale', or 'scale-y'
 * @returns {object[]} Sorted items
 */
export function getScatterSorted(terrainMap, sortBy = 'scale-y') {
  if (!terrainMap.scatterItems) return [];

  const items = [...terrainMap.scatterItems];

  if (sortBy === 'y') {
    items.sort((a, b) => a.y - b.y);
  } else if (sortBy === 'scale') {
    items.sort((a, b) => a.scale - b.scale);
  } else {
    // scale-y: smaller scales first, then by Y
    items.sort((a, b) => (a.scale - b.scale) || (a.y - b.y));
  }

  return items;
}

/**
 * Get visible scatter items (viewport culling)
 * @param {object} terrainMap - TerrainMap
 * @param {object} viewport - { x, y, width, height }
 * @param {object} options - Options
 * @param {string} options.layer - Filter by layer
 * @param {string} options.category - Filter by category
 * @param {number} options.margin - Extra margin around viewport (default 100)
 * @returns {object[]} Visible items
 */
export function getVisibleScatter(terrainMap, viewport, options = {}) {
  if (!terrainMap.scatterItems) return [];

  const margin = options.margin ?? 100;
  const minX = viewport.x - margin;
  const maxX = viewport.x + viewport.width + margin;
  const minY = viewport.y - margin;
  const maxY = viewport.y + viewport.height + margin;

  return terrainMap.scatterItems.filter(item => {
    // Bounds check
    if (item.x < minX || item.x > maxX || item.y < minY || item.y > maxY) {
      return false;
    }

    // Layer filter
    if (options.layer) {
      const config = SCATTER_TYPES[item.type];
      if (!config || config.layer !== options.layer) return false;
    }

    // Category filter
    if (options.category) {
      const config = SCATTER_TYPES[item.type];
      if (!config || config.category !== options.category) return false;
    }

    return true;
  });
}

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Get sprite key for a scatter item
 *
 * Maps scatter types to actual sprite filenames:
 * - Trees: oak-old-1.png, pine-young-2.png, etc.
 * - Dead trees: oak-old-dead-1.png, pine-young-dead-1.png, etc.
 * - Floor: floor-leaf-1.png, floor-leaf-fall-1.png, floor-needle-1.png, etc.
 * - Brush: bush-small-1.png, fern-small-1.png, etc.
 * - Particles: leaf-particles-1.png, leaf-fall-particles-1.png, etc.
 */
export function getSpriteKey(item) {
  const config = SCATTER_TYPES[item.type];
  if (!config) return null;

  // Trees have age variants: oak-old-1, pine-young-2, etc.
  // Dead trees use pattern: oak-old-dead-1, pine-young-dead-1, etc.
  if (config.category === 'tree' && config.ages && item.age) {
    let treeType = item.type.replace('tree-', '');

    // For 'tree-dead' type, use oak as the species (sprites are species-specific)
    if (treeType === 'dead') {
      treeType = 'oak';
    }

    // Dead trees (either tree-dead type or isDead flag) use {species}-{age}-dead-{variant}
    if (item.isDead || config.isDead) {
      return `${treeType}-${item.age}-dead-${item.variant}`;
    }

    return `${treeType}-${item.age}-${item.variant}`;
  }

  // Use spriteBase if defined, otherwise use type name
  // This allows flexible sprite naming without hardcoded transformations
  const spriteBase = config.spriteBase || item.type;
  return `${spriteBase}-${item.variant}`;
}

/**
 * Get the config for a scatter type
 * @param {string} type - Type key
 * @returns {object|null} Config or null
 */
export function getScatterConfig(type) {
  return SCATTER_TYPES[type] || null;
}

// ═══════════════════════════════════════════════════════════════
// FOREST GENERATION - Single source of truth
// ═══════════════════════════════════════════════════════════════
// Used by: paint-tool.js (preview), editor.js (sidebar preview),
// state.js (actual stroke painting)
// ═══════════════════════════════════════════════════════════════

/**
 * Generate all forest items (trees + brush + children) for a stroke.
 * This is the single source of truth for forest generation.
 *
 * @param {object} terrainMap - TerrainMap (or mock with scatterItems[])
 * @param {object} stroke - { x, y, radius, seed }
 * @param {object} options - Generation options
 * @param {string[]} options.treeTypes - Tree types to generate (e.g., ['oak', 'birch'])
 * @param {object} options.treeRatios - Ratios per type (e.g., { oak: 0.6, birch: 0.3 })
 * @param {number} options.treeDensity - Tree density multiplier (0.5-2.0)
 * @param {number} options.treeScale - Tree scale (0.03-0.6)
 * @param {number} options.treeSpacing - Tree spacing multiplier (0.5-1.5)
 * @param {string[]} options.selectedAges - Ages to include
 * @param {object} options.ageRatios - Age ratios
 * @param {string[]} options.brushTypes - Brush types to generate
 * @param {object} options.brushRatios - Ratios per brush type
 * @param {number} options.brushDensity - Brush density multiplier
 * @param {number} options.brushScale - Brush scale
 * @param {string} options.season - Season key
 * @param {string} options.biome - Biome key
 * @param {object} options.seasonOverrides - Season config overrides
 * @param {object} options.childSpawnOverrides - Child spawn overrides
 * @param {object} options.images - Image references for sprite dimensions
 * @param {string} options.strokeId - Stroke ID for persistence
 * @param {boolean} options.treesEnabled - Whether to generate trees (default true)
 * @param {boolean} options.brushEnabled - Whether to generate brush (default true)
 * @param {boolean} options.floorEnabled - Whether to generate floor (default true)
 * @param {boolean} options.particlesEnabled - Whether to generate particles (default true)
 * @returns {object[]} All generated items (trees, brush, floor, particles)
 */
export function generateForestItems(terrainMap, stroke, options = {}) {
  const {
    treeTypes = ['oak'],
    treeRatios = {},
    treeDensity = 1.0,
    treeScale = 0.35,
    treeSpacing = 1.0,
    selectedAges = ['young', 'transitional', 'old'],
    ageRatios = null,
    brushTypes = ['bush-small'],
    brushRatios = {},
    brushDensity = 1.0,
    brushScale = 0.25,
    season = 'summer',
    biome = 'temperate',
    seasonOverrides = {},
    childSpawnOverrides = {},
    images = null,
    strokeId = null,
    // Category toggles
    treesEnabled = true,
    brushEnabled = true,
    floorEnabled = true,
    particlesEnabled = true
  } = options;

  const { x, y, radius, seed = 42 } = stroke;
  const allItems = [];

  // Build effective childSpawnOverrides based on floor/particle toggles
  const effectiveChildOverrides = { ...childSpawnOverrides };
  if (!floorEnabled) {
    effectiveChildOverrides.floor = { ...effectiveChildOverrides.floor, enabled: false };
  }
  if (!particlesEnabled) {
    effectiveChildOverrides.particle = { ...effectiveChildOverrides.particle, enabled: false };
  }

  // Filter out 'dead' from types - it's a modifier, not a real type
  const speciesTypes = treeTypes.filter(t => t !== 'dead' && !t.endsWith('-dead'));
  const deadVariantTypes = treeTypes.filter(t => t.endsWith('-dead'));
  // Support both old format (treeRatios['dead']) and new format (options.deadRatio)
  const deadRatio = options.deadRatio ?? treeRatios['dead'] ?? 0;
  // Which species can have dead variants (new UI format: ['oak-dead', 'pine-dead'])
  const deadTypes = options.deadTypes || [];

  let typeSeed = seed;

  // ─────────────────────────────────────────────────────────────
  // GENERATE TREES - Regular species (if enabled)
  // ─────────────────────────────────────────────────────────────
  if (treesEnabled) {
    for (const type of speciesTypes) {
      const ratioFraction = treeRatios[type] || (1 / speciesTypes.length);
      const scatterType = `tree-${type}`;

      if (!SCATTER_TYPES[scatterType]) continue;

      const items = generateScatter(terrainMap,
        { x, y, radius, seed: typeSeed },
        scatterType,
        {
          density: treeDensity,
          ratioFraction,
          scale: treeScale,
          treeSpacing,
          selectedAges,
          ageRatios,
          forceAllDead: false,
          spawnChildren: true,
          season,
          biome,
          seasonOverrides,
          childSpawnOverrides: effectiveChildOverrides,
          images,
          strokeId
        }
      );
      allItems.push(...items);
      typeSeed += 1000;
    }

    // ─────────────────────────────────────────────────────────────
    // GENERATE TREES - Explicit dead variants (e.g., 'oak-dead')
    // ─────────────────────────────────────────────────────────────
    for (const type of deadVariantTypes) {
      const ratioFraction = treeRatios[type] || 0;
      if (ratioFraction <= 0) continue;

      const baseType = type.replace('-dead', '');
      const scatterType = `tree-${baseType}`;

      if (!SCATTER_TYPES[scatterType]) continue;

      const items = generateScatter(terrainMap,
        { x, y, radius, seed: typeSeed },
        scatterType,
        {
          density: treeDensity,
          ratioFraction,
          scale: treeScale,
          treeSpacing,
          selectedAges,
          ageRatios,
          forceAllDead: true,
          spawnChildren: true,
          season,
          biome,
          seasonOverrides,
          childSpawnOverrides: effectiveChildOverrides,
          images,
          strokeId
        }
      );
      allItems.push(...items);
      typeSeed += 1000;
    }

    // ─────────────────────────────────────────────────────────────
    // APPLY DEAD RATIO - Convert some live trees to dead
    // Note: Dead sprites only exist for young and old ages, not transitional
    // Only applies if user has selected specific species for dead variants
    // ─────────────────────────────────────────────────────────────
    if (deadRatio > 0 && deadTypes.length > 0) {
      let deadSeed = seed + 77777;
      for (const item of allItems) {
        const config = SCATTER_TYPES[item.type];
        if (!config || config.category !== 'tree') continue;
        if (item.isDead) continue;
        if (item.age === 'transitional') continue;

        // Only apply to species the user has selected for dead variants
        const species = item.type.replace('tree-', '');
        const deadKey = `${species}-dead`;
        if (!deadTypes.includes(deadKey)) continue;

        const rand = Math.sin(deadSeed) * 10000;
        const roll = rand - Math.floor(rand);
        deadSeed += 1;

        if (roll < deadRatio) {
          item.isDead = true;
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // GENERATE BRUSH - Independent with own floor/particles (if enabled)
  // ─────────────────────────────────────────────────────────────
  if (brushEnabled && brushDensity > 0 && brushTypes.length > 0) {
    let brushSeed = seed + 50000;
    for (const brushType of brushTypes) {
      if (!SCATTER_TYPES[brushType]) continue;

      const ratioFraction = brushRatios[brushType] || (1 / brushTypes.length);

      const brushItems = generateScatter(terrainMap,
        { x, y, radius, seed: brushSeed },
        brushType,
        {
          density: brushDensity,
          ratioFraction,
          scale: brushScale,
          spawnChildren: true,
          season,
          biome,
          seasonOverrides,
          childSpawnOverrides: effectiveChildOverrides,
          images,
          strokeId
        }
      );
      allItems.push(...brushItems);
      brushSeed += 1000;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // DIRECT FLOOR/PARTICLE GENERATION
  // When trees and brush are disabled but floor/particles are enabled,
  // scatter them directly in the brush stroke area
  // ─────────────────────────────────────────────────────────────
  if (!treesEnabled && !brushEnabled) {
    const seasonConfig = getSeasonBiomeConfig(season, biome);
    const floorOverrides = effectiveChildOverrides.floor || {};
    const particleOverrides = effectiveChildOverrides.particle || {};

    // Direct floor generation
    if (floorEnabled && floorOverrides.enabled !== false) {
      const floorType = floorOverrides.type && floorOverrides.type !== 'auto'
        ? floorOverrides.type
        : seasonConfig?.scatter?.floorType || 'floor-leaf';
      const floorDensity = floorOverrides.density ?? 8;
      const floorScale = floorOverrides.scale ?? 0.4;

      if (SCATTER_TYPES[floorType]) {
        const floorItems = generateScatter(terrainMap,
          { x, y, radius, seed: seed + 30000 },
          floorType,
          {
            density: 1.0,
            ratioFraction: 1.0,
            scale: floorScale,
            spawnChildren: false,
            season,
            biome,
            seasonOverrides,
            images,
            strokeId,
            // Use density as target count for direct scatter
            targetCount: floorDensity * (radius / 50)
          }
        );
        allItems.push(...floorItems);
      }
    }

    // Direct particle generation
    if (particlesEnabled && particleOverrides.enabled !== false) {
      const particleType = particleOverrides.type && particleOverrides.type !== 'auto'
        ? particleOverrides.type
        : seasonConfig?.scatter?.particleType || 'particle-leaf';
      const particleDensity = particleOverrides.density ?? 5;
      const particleScale = particleOverrides.scale ?? 0.35;

      if (SCATTER_TYPES[particleType]) {
        const particleItems = generateScatter(terrainMap,
          { x, y, radius, seed: seed + 40000 },
          particleType,
          {
            density: 1.0,
            ratioFraction: 1.0,
            scale: particleScale,
            spawnChildren: false,
            season,
            biome,
            seasonOverrides,
            images,
            strokeId,
            // Use density as target count for direct scatter
            targetCount: particleDensity * (radius / 50)
          }
        );
        allItems.push(...particleItems);
      }
    }
  }

  return allItems;
}
