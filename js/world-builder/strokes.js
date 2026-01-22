// ═══════════════════════════════════════════════════════════════
// STROKES - Data structures for stroke-based terrain painting
// ═══════════════════════════════════════════════════════════════

/**
 * Feature definitions with gameplay effects
 * Coverage determines how strongly effects apply
 */
export const FEATURE_DEFS = {
  forest: {
    speedMod: 0.7,             // 70% movement speed
    coverBonus: 0.25,          // 25% defense at full coverage
    visibility: 0.5,           // 50% visibility (concealment)
    isBlocker: false,
    isCanopy: true,            // Renders above units
    minCoverageForEffect: 0.3, // Need 30% coverage for effects
    stackable: true,           // Multiple strokes add coverage
    autoGroundTexture: 'forest-floor'  // Auto-paint this ground texture
  },
  brush: {
    speedMod: 0.9,             // 90% movement speed
    coverBonus: 0.10,          // 10% defense at full coverage
    visibility: 0.8,           // 80% visibility
    isBlocker: false,
    isCanopy: true,
    minCoverageForEffect: 0.2, // Need 20% coverage for effects
    stackable: true,
    autoGroundTexture: null    // No auto ground texture for brush
  },
  water: {
    speedMod: 0.5,             // 50% movement speed
    coverBonus: 0.0,           // No defense bonus
    visibility: 1.0,           // Full visibility
    isBlocker: false,          // Passable but slow
    isCanopy: false,           // Renders on base layer
    minCoverageForEffect: 0.3,
    stackable: false,          // Full water or not
    autoGroundTexture: 'mud'   // Auto-paint mud around water edges
  }
};

/**
 * Ground texture types
 * These render below features but above base layer
 */
export const GROUND_TEXTURES = {
  grass: { name: 'Grass', file: 'grass' },
  dirt: { name: 'Dirt', file: 'dirt' },
  'forest-floor': { name: 'Forest Floor', file: 'forest-floor' },
  mud: { name: 'Mud', file: 'mud' },
  sand: { name: 'Sand', file: 'sand' }
};

/**
 * Tree type definitions
 * Each tree type maps to 'forest' for gameplay effects
 * Uses age-based images: young (sparse canopy) and old (full canopy)
 * Variants are auto-detected from loaded images (oak-young-1.png, oak-young-2.png, etc.)
 */
export const TREE_TYPES = {
  oak: {
    featureType: 'forest',     // Maps to forest for gameplay
    ages: ['young', 'old'],    // Available age images
    baseScale: 1.0,            // Relative size
    spacing: 50,               // Base spacing at full scale (pixels)
    canopyRadius: 40           // Visual canopy size for z-ordering
  },
  pine: {
    featureType: 'forest',
    ages: ['young', 'old'],
    baseScale: 0.9,
    spacing: 30,               // Pines grow denser
    canopyRadius: 25
  },
  birch: {
    featureType: 'forest',
    ages: ['young', 'old'],
    baseScale: 0.7,
    spacing: 35,               // Medium spacing, clusters OK
    canopyRadius: 28
  },
  willow: {
    featureType: 'forest',
    ages: ['young', 'old'],
    baseScale: 1.1,
    spacing: 55,               // Large drooping canopy
    canopyRadius: 45
  },
  dead: {
    featureType: 'forest',
    ages: ['young', 'old'],
    baseScale: 0.8,
    spacing: 20,               // No foliage, can be close
    canopyRadius: 15
  }
};

/**
 * Age/scale mapping for trees
 * Young image used for sapling-young range, old image for mature-old range
 * Transitional trees are mixed health (lush + dying patches)
 */
export const TREE_AGES = {
  sapling: 0.4,
  young: 0.6,
  mature: 0.8,
  old: 1.0,
  transitional: 0.85  // Transitional uses its own images, scale similar to mature
};

/**
 * Threshold for switching between young and old images
 * Below this scale uses young image, at or above uses old image
 * (Does not apply to transitional - those use dedicated images)
 */
export const TREE_AGE_THRESHOLD = 0.7;

/**
 * Color variation ranges for natural look
 */
export const COLOR_VARIATION = {
  hueRange: 20,        // ±10 degrees
  brightnessRange: 0.2, // ±10%
  saturationRange: 0.2  // ±10%
};

/**
 * Falloff functions for brush strokes
 * Returns 0-1 based on normalized distance (0=center, 1=edge)
 */
export const FALLOFF = {
  linear: (d) => 1 - d,
  smooth: (d) => 1 - (d * d * (3 - 2 * d)), // Hermite interpolation
  hard: (d) => d < 0.95 ? 1 : 0
};

/**
 * Create a new stroke
 * @param {string} type - Feature type (forest, brush, water, groundTexture)
 * @param {number} x - World X coordinate (pixels)
 * @param {number} y - World Y coordinate (pixels)
 * @param {number} radius - Brush radius (pixels)
 * @param {object} options - Optional: intensity, falloff, seed, tree painting options
 * @param {string} [options.treeType] - Tree type for forest strokes (oak, pine, birch, willow, dead)
 * @param {number} [options.density] - Trees per 100px radius (default: 5)
 * @param {string} [options.minAge] - Minimum tree age for scale (sapling, young, mature, old)
 * @param {string} [options.maxAge] - Maximum tree age for scale
 * @param {string} [options.textureType] - Ground texture type for groundTexture strokes
 * @returns {object} Stroke object
 */
export function createStroke(type, x, y, radius, options = {}) {
  const stroke = {
    id: `stroke_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type,
    x,
    y,
    radius,
    intensity: options.intensity ?? 1.0,
    falloff: options.falloff ?? 'smooth',
    seed: options.seed ?? Math.floor(Math.random() * 1000000),
    timestamp: Date.now()
  };

  // Add tree painting properties if specified
  if (options.treeType && TREE_TYPES[options.treeType]) {
    stroke.treeType = options.treeType;
    stroke.density = options.density ?? 5;
    stroke.minAge = options.minAge ?? 'young';
    stroke.maxAge = options.maxAge ?? 'old';
  }

  // Add ground texture properties if specified
  if (type === 'groundTexture' && options.textureType) {
    stroke.textureType = options.textureType;
  }

  return stroke;
}

/**
 * Create an empty terrain map
 * @param {number} gridWidth - Grid width in cells
 * @param {number} gridHeight - Grid height in cells
 * @param {number} cellSize - Cell size in pixels
 * @param {string} baseLayer - Base terrain type (grass, dirt, sand)
 * @returns {object} TerrainMap object
 */
export function createTerrainMap(gridWidth, gridHeight, cellSize = 64, baseLayer = 'grass') {
  return {
    strokes: [],
    trees: [],              // Global tree registry for collision detection & rendering
    baseLayer,
    grid: [],
    gridWidth,
    gridHeight,
    cellSize,
    dirty: true,
    version: 0
  };
}

/**
 * Create an empty grid cell
 * @returns {object} Cell with zero coverage
 */
export function createEmptyCell() {
  return {
    forest: 0,
    brush: 0,
    water: 0,
    dominant: null,
    speedMod: 1.0,
    coverBonus: 0,
    visibility: 1.0,
    isBlocked: false
  };
}

/**
 * Simple seeded random for consistent tree placement
 */
function seededRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/**
 * Generate trees for a stroke with collision detection
 * Adds trees to the global registry if they don't overlap existing trees
 * @param {object} terrainMap - TerrainMap with global tree registry
 * @param {object} stroke - Stroke with tree painting properties
 * @param {object} options - Additional options
 * @param {number} options.globalScale - Global scale multiplier (default 0.08)
 * @param {string[]} options.selectedAges - Which ages to use (young, transitional, old)
 * @returns {object[]} Array of trees that were added
 */
export function generateTreesForStroke(terrainMap, stroke, options = {}) {
  const { x, y, radius, seed, treeType, density } = stroke;

  // Get tree type config
  const treeConfig = TREE_TYPES[treeType];
  if (!treeConfig) return [];

  const globalScale = options.globalScale || stroke.treeScale || 0.08;
  const selectedAges = options.selectedAges || stroke.selectedAges || ['young', 'transitional', 'old'];
  const ageRatios = options.ageRatios || stroke.ageRatios || null;

  // Calculate number of tree attempts based on density and radius
  const maxAttempts = Math.max(1, Math.floor((density || 5) * (radius / 100) * 2));

  // Get age scales for selected ages
  const ageScales = selectedAges.map(age => ({
    age,
    scale: TREE_AGES[age] || TREE_AGES.young,
    ratio: ageRatios ? (ageRatios[age] || 0) : (1 / selectedAges.length)
  }));

  const addedTrees = [];

  for (let i = 0; i < maxAttempts; i++) {
    const treeSeed = seed + i * 1000;

    // Random position within stroke circle (sqrt for uniform distribution)
    const angle = seededRandom(treeSeed) * Math.PI * 2;
    const distFactor = Math.sqrt(seededRandom(treeSeed + 1));
    const dist = distFactor * radius * 0.95;
    const tx = x + Math.cos(angle) * dist;
    const ty = y + Math.sin(angle) * dist;

    // Select age based on weighted ratios
    const ageRand = seededRandom(treeSeed + 4);
    let cumulative = 0;
    let selectedAge = ageScales[0]; // Default to first
    for (const ageInfo of ageScales) {
      cumulative += ageInfo.ratio;
      if (ageRand < cumulative) {
        selectedAge = ageInfo;
        break;
      }
    }

    // Calculate final scale
    const ageScale = selectedAge.scale;
    const finalScale = treeConfig.baseScale * ageScale * globalScale;

    // Calculate spacing requirement (scaled by tree size)
    const treeSpacing = treeConfig.spacing * finalScale * 4; // Reduced multiplier for denser forests

    // Check collision with existing trees
    const tooClose = terrainMap.trees.some(existing => {
      const dx = existing.x - tx;
      const dy = existing.y - ty;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Get existing tree's spacing
      const existingConfig = TREE_TYPES[existing.treeType] || TREE_TYPES.oak;
      const existingSpacing = existingConfig.spacing * existing.scale * 4;

      // Minimum distance is average of both trees' spacing requirements
      const minDist = (treeSpacing + existingSpacing) / 2;

      return dist < minDist;
    });

    if (tooClose) continue;

    // Determine if this tree should be dead
    // forceAllDead = true when using dead variant types (e.g., "oak-dead")
    const forceAllDead = stroke.forceAllDead || false;
    const isDead = forceAllDead;

    // Create tree object
    const tree = {
      id: `tree_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      strokeId: stroke.id,
      treeType,
      x: tx,
      y: ty,
      scale: finalScale,
      age: selectedAge.age,
      isDead,  // Whether to use dead variant sprites
      rotation: 0, // Disabled for now due to perspective issues
      variant: Math.floor(seededRandom(treeSeed + 3) * 3) + 1, // 1, 2, or 3
      hueShift: (seededRandom(treeSeed + 6) - 0.5) * COLOR_VARIATION.hueRange,
      brightness: 1 + (seededRandom(treeSeed + 7) - 0.5) * COLOR_VARIATION.brightnessRange,
      saturation: 1 + (seededRandom(treeSeed + 8) - 0.5) * COLOR_VARIATION.saturationRange
    };

    // Add to global registry
    terrainMap.trees.push(tree);
    addedTrees.push(tree);
  }

  return addedTrees;
}

/**
 * Remove trees associated with a stroke
 * @param {object} terrainMap - TerrainMap with global tree registry
 * @param {string} strokeId - ID of stroke to remove trees for
 * @returns {number} Number of trees removed
 */
export function removeTreesForStroke(terrainMap, strokeId) {
  const before = terrainMap.trees.length;
  terrainMap.trees = terrainMap.trees.filter(t => t.strokeId !== strokeId);
  return before - terrainMap.trees.length;
}

/**
 * Remove trees within a radius (for clearing tool)
 * @param {object} terrainMap - TerrainMap with global tree registry
 * @param {number} x - Center X coordinate
 * @param {number} y - Center Y coordinate
 * @param {number} radius - Clearing radius
 * @param {string} falloff - Falloff type ('hard', 'linear', 'smooth')
 * @returns {number} Number of trees removed
 */
export function removeTreesInRadius(terrainMap, x, y, radius, falloff = 'hard') {
  const before = terrainMap.trees.length;
  const radiusSq = radius * radius;

  terrainMap.trees = terrainMap.trees.filter(tree => {
    const dx = tree.x - x;
    const dy = tree.y - y;
    const distSq = dx * dx + dy * dy;

    if (distSq > radiusSq) {
      return true; // Outside radius, keep
    }

    // For hard falloff, remove everything in radius
    if (falloff === 'hard') {
      return false;
    }

    // For soft falloffs, use probability based on distance
    const dist = Math.sqrt(distSq);
    const normalizedDist = dist / radius;
    let keepChance;

    if (falloff === 'linear') {
      keepChance = normalizedDist; // More likely to keep at edges
    } else {
      // Smooth (hermite)
      keepChance = normalizedDist * normalizedDist * (3 - 2 * normalizedDist);
    }

    // Random chance to keep based on distance
    return Math.random() < keepChance;
  });

  return before - terrainMap.trees.length;
}

/**
 * Get all trees sorted by scale (for z-ordering - smaller first)
 * @param {object} terrainMap - TerrainMap with global tree registry
 * @returns {object[]} Trees sorted by scale ascending
 */
export function getTreesSortedByScale(terrainMap) {
  return [...terrainMap.trees].sort((a, b) => a.scale - b.scale);
}
