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
  sand: { name: 'Sand', file: 'sand' },
  // Floor patches for tree-based floor system (scatter-rendered)
  'floor-oak': { name: 'Oak Leaves', file: 'floor-oak' },
  'floor-pine': { name: 'Pine Needles', file: 'floor-pine' },
  'floor-birch': { name: 'Birch Leaves', file: 'floor-birch' },
  'floor-damp': { name: 'Damp Debris', file: 'floor-damp' },
  'floor-bare': { name: 'Dead Debris', file: 'floor-bare' },
  'floor-mixed': { name: 'Mixed Debris', file: 'floor-mixed' }
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
 * Brush/undergrowth type definitions
 * These render in the canopy layer but BELOW trees (z-order by scale)
 * Brushes have closer spacing than trees for denser coverage
 */
export const BRUSH_TYPES = {
  'bush-small': {
    featureType: 'brush',     // Maps to brush for gameplay effects
    baseScale: 0.8,
    spacing: 35,              // Similar to birch trees
    canopyRadius: 25,
    variants: 3               // Number of variant images (1, 2, 3)
  },
  'bush-large': {
    featureType: 'brush',
    baseScale: 1.0,
    spacing: 45,              // Similar to oak trees
    canopyRadius: 35,
    variants: 3
  },
  'fern-small': {
    featureType: 'brush',
    baseScale: 0.7,
    spacing: 30,              // Similar to pine trees
    canopyRadius: 22,
    variants: 3
  },
  'leaf-particles': {
    featureType: 'brush',
    baseScale: 0.5,
    spacing: 0,               // No spacing - particles can overlap freely
    canopyRadius: 0,
    variants: 3,
    noCollision: true         // Skip collision detection for particles
  }
};

/**
 * Particle type definitions
 * Particles are sparse scatter items that can overlap freely
 * They link to parent trees/brush for cascading delete
 */
export const PARTICLE_TYPES = {
  'leaf-particles': {
    baseScale: 0.5,
    variants: 3,
    noCollision: true
  },
  'pine-needles': {
    baseScale: 0.4,
    variants: 3,
    noCollision: true
  },
  'twigs': {
    baseScale: 0.45,
    variants: 3,
    noCollision: true
  }
};

/**
 * Tree type to particle type mapping
 * Defines which particles auto-generate around each tree type
 */
export const TREE_TO_PARTICLES = {
  'oak': ['leaf-particles'],
  'pine': ['pine-needles'],
  'birch': ['leaf-particles'],
  'willow': ['leaf-particles', 'twigs'],
  'dead': ['twigs']
};

/**
 * Tree type to floor patch mapping
 * Defines which floor patches scatter around each tree type
 * See sprites/terrain/floor-prompts.md for sprite generation
 */
export const TREE_TO_FLOOR = {
  // Deciduous trees use leaf-based floor (seasonal variants available)
  'oak': 'floor-leaf-dry',      // Default to dry leaves (works for all seasons)
  'birch': 'floor-leaf-dry',
  'willow': 'floor-leaf-dry',
  // Conifers use needle floor
  'pine': 'floor-needle',
  // Dead trees use debris
  'dead': 'floor-debris'
};

/**
 * Default floor type for mixed/unknown tree types
 */
export const DEFAULT_FLOOR = 'floor-debris';

/**
 * Floor patch type definitions
 * Floor patches are discrete sprites scattered around trees on the ground layer
 * Seasonal types: floor-leaf (green), floor-leaf-fall (autumn), floor-leaf-dry (brown)
 * See sprites/terrain/floor-prompts.md for sprite generation
 */
export const FLOOR_PATCH_TYPES = {
  // Seasonal floor types (primary)
  'floor-leaf': {
    baseScale: 0.4,
    variants: 3,
    noCollision: true
  },
  'floor-leaf-fall': {
    baseScale: 0.4,
    variants: 3,
    noCollision: true
  },
  'floor-leaf-dry': {
    baseScale: 0.4,
    variants: 3,
    noCollision: true
  },
  'floor-needle': {
    baseScale: 0.35,
    variants: 3,
    noCollision: true
  },
  'floor-debris': {
    baseScale: 0.38,
    variants: 3,
    noCollision: true
  }
};

/**
 * Tree type to suggested brush mapping
 */
export const TREE_TO_BRUSH = {
  'oak': ['fern-small', 'bush-small'],
  'pine': ['fern-small'],
  'birch': ['fern-small', 'bush-small'],
  'willow': ['fern-small'],
  'dead': ['bush-small']
};

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
    if (options.fadeWidth !== undefined) stroke.fadeWidth = options.fadeWidth;
    if (options.isShore) stroke.isShore = true;
  }

  // Add water properties if specified
  if (type === 'water') {
    stroke.textureType = options.textureType || 'water';
    if (options.fadeWidth !== undefined) stroke.fadeWidth = options.fadeWidth;
    if (options.shoreWidth !== undefined) stroke.shoreWidth = options.shoreWidth;
    if (options.waterDepth !== undefined) stroke.waterDepth = options.waterDepth;
    if (options.waterDepthFalloff !== undefined) stroke.waterDepthFalloff = options.waterDepthFalloff;
  }

  // Add water depth overlay properties
  if (type === 'waterDepth') {
    if (options.fadeWidth !== undefined) stroke.fadeWidth = options.fadeWidth;
    if (options.depthFalloff !== undefined) stroke.depthFalloff = options.depthFalloff;
    if (options.parentStrokeId !== undefined) stroke.parentStrokeId = options.parentStrokeId;
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
    // Legacy arrays (for backwards compatibility during migration)
    trees: [],              // Global tree registry for collision detection & rendering
    brushes: [],            // Global brush registry for collision detection & rendering
    particles: [],          // Global particle registry (leaves, needles, etc.)
    floorPatches: [],       // Global floor patch registry (ground layer sprites)
    // NEW: Unified scatter system (MVP)
    scatterItems: [],       // All terrain elements in one array
    // Water depth overlays (path-based depth gradients)
    waterDepthPaths: [],    // Array of { path: [{x,y}], radius, depth }
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
 * @deprecated Use generateScatter() from scatter.js instead
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

    // Check if position is in water or shore (unless allowTreesInWater is set)
    const allowTreesInWater = stroke.allowTreesInWater || false;
    if (!allowTreesInWater) {
      const inWater = terrainMap.strokes.some(s => {
        if (s.type !== 'water') return false;
        const dx = s.x - tx;
        const dy = s.y - ty;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Include shore area in the check
        const effectiveRadius = s.radius + (s.shoreWidth || 0);
        return dist < effectiveRadius;
      });
      if (inWater) continue;
    }

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
      saturation: 1 + (seededRandom(treeSeed + 8) - 0.5) * COLOR_VARIATION.saturationRange,
      // Floor settings baked at creation time (includes density bonus)
      floorRadiusPercent: (() => {
        const base = options.floorRadiusPercent ?? stroke.floorRadiusPercent ?? 30;
        const treeDensity = stroke.density ?? 5;
        const densityBonus = Math.max(0, (treeDensity - 3) * 2);
        return base + densityBonus;
      })(),
      floorFade: options.floorFade ?? stroke.floorFade ?? 100,
      floorIntensity: options.floorIntensity ?? stroke.floorIntensity ?? 70
    };

    // Add to global registry
    terrainMap.trees.push(tree);
    addedTrees.push(tree);
  }

  return addedTrees;
}

/**
 * @deprecated Use removeScatterByStroke() from scatter.js instead
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
 * @deprecated Use removeScatterInRadius() from scatter.js instead
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

// ═══════════════════════════════════════════════════════════════
// BRUSH GENERATION
// ═══════════════════════════════════════════════════════════════

/**
 * @deprecated Use generateScatter() from scatter.js instead
 * Generate brush/undergrowth for a stroke with collision detection
 * Adds brush items to the global registry if they don't overlap existing items
 * @param {object} terrainMap - TerrainMap with global brush registry
 * @param {object} stroke - Stroke with brush painting properties
 * @param {object} options - Additional options
 * @param {number} options.globalScale - Global scale multiplier (default 0.12)
 * @returns {object[]} Array of brush items that were added
 */
export function generateBrushForStroke(terrainMap, stroke, options = {}) {
  const { x, y, radius, seed, brushType, density } = stroke;

  // Get brush type config
  const brushConfig = BRUSH_TYPES[brushType];
  if (!brushConfig) return [];

  // Ensure brushes array exists
  if (!terrainMap.brushes) terrainMap.brushes = [];

  const globalScale = options.globalScale || stroke.brushScale || 0.12;

  // Calculate number of brush attempts based on density and radius
  // Same formula as trees for proportionate spacing
  const maxAttempts = Math.max(1, Math.floor((density || 5) * (radius / 100) * 2));

  // Scale variation for natural look
  const scaleVariation = 0.3; // ±30% from base

  const addedBrush = [];

  for (let i = 0; i < maxAttempts; i++) {
    const brushSeed = seed + i * 1000;

    // Random position within stroke circle (sqrt for uniform distribution)
    const angle = seededRandom(brushSeed) * Math.PI * 2;
    const distFactor = Math.sqrt(seededRandom(brushSeed + 1));
    const dist = distFactor * radius * 0.95;
    const bx = x + Math.cos(angle) * dist;
    const by = y + Math.sin(angle) * dist;

    // Random scale variation
    const scaleRand = 1 + (seededRandom(brushSeed + 2) - 0.5) * 2 * scaleVariation;
    const finalScale = brushConfig.baseScale * scaleRand * globalScale;

    // Calculate spacing requirement (scaled by brush size)
    const brushSpacing = brushConfig.spacing * finalScale * 4;

    // Check if position is in water or shore (unless allowBrushInWater is set)
    const allowBrushInWater = stroke.allowBrushInWater || false;
    if (!allowBrushInWater) {
      const inWater = terrainMap.strokes.some(s => {
        if (s.type !== 'water') return false;
        const dx = s.x - bx;
        const dy = s.y - by;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const effectiveRadius = s.radius + (s.shoreWidth || 0);
        return dist < effectiveRadius;
      });
      if (inWater) continue;
    }

    // Skip collision checks for particle-type brush (noCollision flag)
    if (!brushConfig.noCollision) {
      // Check collision with existing brush items
      const tooCloseToBrush = terrainMap.brushes.some(existing => {
        // Skip collision with other noCollision types
        const existingConfig = BRUSH_TYPES[existing.brushType] || BRUSH_TYPES['bush-small'];
        if (existingConfig.noCollision) return false;

        const dx = existing.x - bx;
        const dy = existing.y - by;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const existingSpacing = existingConfig.spacing * existing.scale * 4;

        // Minimum distance is average of both items' spacing requirements
        const minDist = (brushSpacing + existingSpacing) / 2;

        return dist < minDist;
      });

      if (tooCloseToBrush) continue;

      // Also check collision with trees (brush should not overlap trees)
      const tooCloseToTree = terrainMap.trees.some(tree => {
        const dx = tree.x - bx;
        const dy = tree.y - by;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Get tree's spacing
        const treeConfig = TREE_TYPES[tree.treeType] || TREE_TYPES.oak;
        const treeSpacing = treeConfig.spacing * tree.scale * 2; // Less strict with trees

        return dist < treeSpacing;
      });

      if (tooCloseToTree) continue;
    }

    // Create brush object
    const brushItem = {
      id: `brush_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      strokeId: stroke.id,
      brushType,
      x: bx,
      y: by,
      scale: finalScale,
      variant: Math.floor(seededRandom(brushSeed + 3) * brushConfig.variants) + 1,
      hueShift: (seededRandom(brushSeed + 4) - 0.5) * COLOR_VARIATION.hueRange,
      brightness: 1 + (seededRandom(brushSeed + 5) - 0.5) * COLOR_VARIATION.brightnessRange,
      saturation: 1 + (seededRandom(brushSeed + 6) - 0.5) * COLOR_VARIATION.saturationRange
    };

    // Add to global registry
    terrainMap.brushes.push(brushItem);
    addedBrush.push(brushItem);
  }

  return addedBrush;
}

/**
 * Remove brush associated with a stroke
 * @param {object} terrainMap - TerrainMap with global brush registry
 * @param {string} strokeId - ID of stroke to remove brush for
 * @returns {number} Number of brush items removed
 */
export function removeBrushForStroke(terrainMap, strokeId) {
  if (!terrainMap.brushes) return 0;
  const before = terrainMap.brushes.length;
  terrainMap.brushes = terrainMap.brushes.filter(b => b.strokeId !== strokeId);
  return before - terrainMap.brushes.length;
}

/**
 * Remove brush within a radius (for clearing tool)
 * @param {object} terrainMap - TerrainMap with global brush registry
 * @param {number} x - Center X coordinate
 * @param {number} y - Center Y coordinate
 * @param {number} radius - Clearing radius
 * @param {string} falloff - Falloff type ('hard', 'linear', 'smooth')
 * @returns {number} Number of brush items removed
 */
export function removeBrushInRadius(terrainMap, x, y, radius, falloff = 'hard') {
  if (!terrainMap.brushes) return 0;
  const before = terrainMap.brushes.length;
  const radiusSq = radius * radius;

  terrainMap.brushes = terrainMap.brushes.filter(brush => {
    const dx = brush.x - x;
    const dy = brush.y - y;
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
      keepChance = normalizedDist;
    } else {
      // Smooth (hermite)
      keepChance = normalizedDist * normalizedDist * (3 - 2 * normalizedDist);
    }

    return Math.random() < keepChance;
  });

  return before - terrainMap.brushes.length;
}

/**
 * Get all brush items sorted by scale (for z-ordering - smaller first)
 * @param {object} terrainMap - TerrainMap with global brush registry
 * @returns {object[]} Brush items sorted by scale ascending
 */
export function getBrushSortedByScale(terrainMap) {
  if (!terrainMap.brushes) return [];
  return [...terrainMap.brushes].sort((a, b) => a.scale - b.scale);
}

// ═══════════════════════════════════════════════════════════════
// PARTICLE GENERATION
// ═══════════════════════════════════════════════════════════════

/**
 * @deprecated Use spawnChildren() from scatter.js instead (auto-spawns particles)
 * Generate particles around a tree
 * @param {object} terrainMap - TerrainMap with global particle registry
 * @param {object} tree - Tree object to generate particles around
 * @param {object} options - Generation options
 * @param {number} options.density - Particles to generate (default 3)
 * @param {number} options.radius - Scatter radius around tree (default based on tree scale)
 * @returns {object[]} Array of particles that were added
 */
export function generateParticlesForTree(terrainMap, tree, options = {}) {
  // Ensure particles array exists
  if (!terrainMap.particles) terrainMap.particles = [];

  // Get particle types for this tree type
  const particleTypes = TREE_TO_PARTICLES[tree.treeType];
  if (!particleTypes || particleTypes.length === 0) return [];

  const baseDensity = options.density ?? 3;
  const spreadPercent = options.spread ?? 40; // Spread as percentage of canopy size

  // Tree sprite is 256px, canopy fills ~90% of frame, so canopy diameter = 230px at scale 1.0
  // At tree.scale, canopy radius in pixels = 115 * tree.scale
  const canopyRadius = 115 * tree.scale;
  const minRadius = canopyRadius * 0.95; // Start right at canopy edge
  // Spread scales proportionally with canopy size
  const maxRadius = canopyRadius * (1 + spreadPercent / 100);

  // Scale density by tree size and spread - larger areas need more particles
  // Use power of 0.75 instead of 0.5 (sqrt) for more aggressive scaling on big trees
  const scaleMultiplier = Math.max(1, Math.pow(tree.scale / 0.1, 0.75));
  const spreadMultiplier = Math.max(1, spreadPercent / 40); // 40% is baseline
  const density = Math.round(baseDensity * scaleMultiplier * spreadMultiplier);
  const falloffExponent = options.falloff ?? 0.4; // Controls concentration (0.2=tight at inner edge, 1.0=uniform)

  // Debug output
  console.log(`[Particles] scale=${tree.scale.toFixed(2)}, density=${density} (base ${baseDensity} × scale ${scaleMultiplier.toFixed(1)} × spread ${spreadMultiplier.toFixed(1)}), ring=${minRadius.toFixed(0)}-${maxRadius.toFixed(0)}px`);
  const seed = options.seed ?? (parseInt(tree.id.split('_')[1]) || Date.now());

  const addedParticles = [];

  for (let i = 0; i < density; i++) {
    const particleSeed = seed + i * 100;

    // Pick random particle type from available types
    const typeIndex = Math.floor(seededRandom(particleSeed) * particleTypes.length);
    const particleType = particleTypes[typeIndex];
    const particleConfig = PARTICLE_TYPES[particleType];
    if (!particleConfig) continue;

    // Ring distribution: particles spawn between minRadius (canopy edge) and maxRadius
    // Falloff controls concentration: lower = denser at inner edge, 1.0 = uniform across ring
    const ringWidth = Math.max(0, maxRadius - minRadius);
    const distFactor = Math.pow(seededRandom(particleSeed + 2), 1 / falloffExponent);

    const angle = seededRandom(particleSeed + 1) * Math.PI * 2;
    const dist = minRadius + (distFactor * ringWidth);
    const px = tree.x + Math.cos(angle) * dist;
    const py = tree.y + Math.sin(angle) * dist;

    // Random scale variation
    const scaleVariation = 0.4; // ±40%
    const scaleRand = 1 + (seededRandom(particleSeed + 3) - 0.5) * 2 * scaleVariation;
    const globalScale = options.scale ?? 0.15; // User-controlled global particle scale
    const finalScale = particleConfig.baseScale * scaleRand * globalScale;

    // Create particle object
    const particle = {
      id: `particle_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      strokeId: tree.strokeId,       // For bulk stroke delete
      parentId: tree.id,             // For cascading delete from tree
      particleType,
      x: px,
      y: py,
      scale: finalScale,
      rotation: seededRandom(particleSeed + 4) * 360,
      variant: Math.floor(seededRandom(particleSeed + 5) * particleConfig.variants) + 1,
      hueShift: (seededRandom(particleSeed + 6) - 0.5) * COLOR_VARIATION.hueRange,
      brightness: 1 + (seededRandom(particleSeed + 7) - 0.5) * COLOR_VARIATION.brightnessRange,
      saturation: 1 + (seededRandom(particleSeed + 8) - 0.5) * COLOR_VARIATION.saturationRange
    };

    terrainMap.particles.push(particle);
    addedParticles.push(particle);
  }

  return addedParticles;
}

/**
 * Generate particles for all trees in a stroke
 * @param {object} terrainMap - TerrainMap
 * @param {string} strokeId - Stroke ID
 * @param {object} options - Generation options
 * @returns {object[]} Array of particles added
 */
export function generateParticlesForStroke(terrainMap, strokeId, options = {}) {
  const trees = terrainMap.trees.filter(t => t.strokeId === strokeId);
  const allParticles = [];

  for (const tree of trees) {
    const particles = generateParticlesForTree(terrainMap, tree, options);
    allParticles.push(...particles);
  }

  return allParticles;
}

/**
 * Remove particles associated with a parent (tree or brush)
 * @param {object} terrainMap - TerrainMap
 * @param {string} parentId - Parent tree/brush ID
 * @returns {number} Number of particles removed
 */
export function removeParticlesForParent(terrainMap, parentId) {
  if (!terrainMap.particles) return 0;
  const before = terrainMap.particles.length;
  terrainMap.particles = terrainMap.particles.filter(p => p.parentId !== parentId);
  return before - terrainMap.particles.length;
}

/**
 * Remove particles associated with a stroke
 * @param {object} terrainMap - TerrainMap
 * @param {string} strokeId - Stroke ID
 * @returns {number} Number of particles removed
 */
export function removeParticlesForStroke(terrainMap, strokeId) {
  if (!terrainMap.particles) return 0;
  const before = terrainMap.particles.length;
  terrainMap.particles = terrainMap.particles.filter(p => p.strokeId !== strokeId);
  return before - terrainMap.particles.length;
}

/**
 * Remove particles within a radius
 * @param {object} terrainMap - TerrainMap
 * @param {number} x - Center X
 * @param {number} y - Center Y
 * @param {number} radius - Radius
 * @returns {number} Number of particles removed
 */
export function removeParticlesInRadius(terrainMap, x, y, radius) {
  if (!terrainMap.particles) return 0;
  const before = terrainMap.particles.length;
  const radiusSq = radius * radius;

  terrainMap.particles = terrainMap.particles.filter(p => {
    const dx = p.x - x;
    const dy = p.y - y;
    return (dx * dx + dy * dy) > radiusSq;
  });

  return before - terrainMap.particles.length;
}

/**
 * Get all particles sorted by Y position (for z-ordering)
 * @param {object} terrainMap - TerrainMap
 * @returns {object[]} Particles sorted by Y ascending
 */
export function getParticlesSortedByY(terrainMap) {
  if (!terrainMap.particles) return [];
  return [...terrainMap.particles].sort((a, b) => a.y - b.y);
}

// ═══════════════════════════════════════════════════════════════
// FLOOR PATCH GENERATION
// ═══════════════════════════════════════════════════════════════

/**
 * @deprecated Use spawnChildren() from scatter.js instead (auto-spawns floor patches)
 * Generate floor patches around a tree
 * Floor patches are discrete sprites scattered under/around the tree canopy
 * @param {object} terrainMap - TerrainMap with global floor patch registry
 * @param {object} tree - Tree object to generate floor patches around
 * @param {object} options - Generation options (overrides tree's baked settings)
 * @returns {object[]} Array of floor patches that were added
 */
export function generateFloorPatchesForTree(terrainMap, tree, options = {}) {
  // Ensure floorPatches array exists
  if (!terrainMap.floorPatches) terrainMap.floorPatches = [];

  // Get floor type for this tree type
  const floorType = TREE_TO_FLOOR[tree.treeType] || DEFAULT_FLOOR;
  const floorConfig = FLOOR_PATCH_TYPES[floorType];
  if (!floorConfig) return [];

  // Get floor settings from tree (baked at paint time) or options
  const floorRadiusPercent = options.floorRadiusPercent ?? tree.floorRadiusPercent ?? 30;
  const floorIntensity = options.floorIntensity ?? tree.floorIntensity ?? 70;
  const floorFadePercent = options.floorFade ?? tree.floorFade ?? 100;

  // Calculate coverage area based on canopy size
  const canopyRadius = 115 * tree.scale;
  const floorRadiusMultiplier = floorRadiusPercent / 100 + 1;
  const maxRadius = canopyRadius * floorRadiusMultiplier;

  // Skip very small trees
  if (maxRadius < 15) return [];

  // Base patch count scales with coverage area
  const area = Math.PI * maxRadius * maxRadius;
  const basePatchSize = 20; // Average patch covers ~20px
  const baseDensity = Math.floor(area / (basePatchSize * basePatchSize * 3));
  const density = Math.max(3, Math.min(50, baseDensity)); // Clamp 3-50 patches per tree

  // Seeded random for consistent placement
  const seed = options.seed ?? (parseInt(tree.id.split('_')[1]) || Date.now());

  const addedPatches = [];

  for (let i = 0; i < density; i++) {
    const patchSeed = seed + i * 137;

    // Random position within floor radius (concentrated under canopy)
    const angle = seededRandom(patchSeed) * Math.PI * 2;
    // Bias toward center (under canopy)
    const distFactor = Math.pow(seededRandom(patchSeed + 1), 0.7);
    const dist = distFactor * maxRadius;

    const px = tree.x + Math.cos(angle) * dist;
    const py = tree.y + Math.sin(angle) * dist;

    // Random scale variation (±50%)
    const scaleVariation = 0.5;
    const scaleRand = 1 + (seededRandom(patchSeed + 2) - 0.5) * 2 * scaleVariation;
    const globalScale = options.scale ?? 0.5; // User-controlled scale
    const finalScale = floorConfig.baseScale * scaleRand * globalScale;

    // Intensity decreases toward edge (based on floorFadePercent)
    const distRatio = dist / maxRadius;
    const edgeFade = floorFadePercent >= 100
      ? 1 - (distRatio * distRatio * 0.5)  // Gradual fade
      : distRatio < (1 - floorFadePercent / 100) ? 1 : 0;  // Hard cutoff
    const baseAlpha = (floorIntensity / 100) * edgeFade;
    // Add some random variation to alpha
    const alpha = baseAlpha * (0.6 + seededRandom(patchSeed + 3) * 0.4);

    // Skip very faint patches
    if (alpha < 0.1) continue;

    // Create floor patch object
    const patch = {
      id: `floorpatch_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      strokeId: tree.strokeId,       // For bulk stroke delete
      parentId: tree.id,             // For cascading delete from tree
      floorType,
      x: px,
      y: py,
      scale: finalScale,
      alpha: Math.min(0.9, Math.max(0.2, alpha)),
      rotation: seededRandom(patchSeed + 4) * 360,
      variant: Math.floor(seededRandom(patchSeed + 5) * floorConfig.variants) + 1,
      hueShift: (seededRandom(patchSeed + 6) - 0.5) * COLOR_VARIATION.hueRange * 0.5, // Less color variation
      brightness: 1 + (seededRandom(patchSeed + 7) - 0.5) * COLOR_VARIATION.brightnessRange,
      saturation: 1 + (seededRandom(patchSeed + 8) - 0.5) * COLOR_VARIATION.saturationRange
    };

    terrainMap.floorPatches.push(patch);
    addedPatches.push(patch);
  }

  return addedPatches;
}

/**
 * Generate floor patches for all trees in a stroke
 * @param {object} terrainMap - TerrainMap
 * @param {string} strokeId - Stroke ID
 * @param {object} options - Generation options
 * @returns {object[]} Array of floor patches added
 */
export function generateFloorPatchesForStroke(terrainMap, strokeId, options = {}) {
  const trees = terrainMap.trees.filter(t => t.strokeId === strokeId);
  const allPatches = [];

  for (const tree of trees) {
    const patches = generateFloorPatchesForTree(terrainMap, tree, options);
    allPatches.push(...patches);
  }

  return allPatches;
}

/**
 * Remove floor patches associated with a parent (tree)
 * @param {object} terrainMap - TerrainMap
 * @param {string} parentId - Parent tree ID
 * @returns {number} Number of floor patches removed
 */
export function removeFloorPatchesForParent(terrainMap, parentId) {
  if (!terrainMap.floorPatches) return 0;
  const before = terrainMap.floorPatches.length;
  terrainMap.floorPatches = terrainMap.floorPatches.filter(p => p.parentId !== parentId);
  return before - terrainMap.floorPatches.length;
}

/**
 * Remove floor patches associated with a stroke
 * @param {object} terrainMap - TerrainMap
 * @param {string} strokeId - Stroke ID
 * @returns {number} Number of floor patches removed
 */
export function removeFloorPatchesForStroke(terrainMap, strokeId) {
  if (!terrainMap.floorPatches) return 0;
  const before = terrainMap.floorPatches.length;
  terrainMap.floorPatches = terrainMap.floorPatches.filter(p => p.strokeId !== strokeId);
  return before - terrainMap.floorPatches.length;
}

/**
 * Remove floor patches within a radius
 * @param {object} terrainMap - TerrainMap
 * @param {number} x - Center X
 * @param {number} y - Center Y
 * @param {number} radius - Radius
 * @returns {number} Number of floor patches removed
 */
export function removeFloorPatchesInRadius(terrainMap, x, y, radius) {
  if (!terrainMap.floorPatches) return 0;
  const before = terrainMap.floorPatches.length;
  const radiusSq = radius * radius;

  terrainMap.floorPatches = terrainMap.floorPatches.filter(p => {
    const dx = p.x - x;
    const dy = p.y - y;
    return (dx * dx + dy * dy) > radiusSq;
  });

  return before - terrainMap.floorPatches.length;
}

/**
 * Get all floor patches (no sorting needed - they're on ground layer)
 * @param {object} terrainMap - TerrainMap
 * @returns {object[]} All floor patches
 */
export function getFloorPatches(terrainMap) {
  return terrainMap.floorPatches || [];
}
