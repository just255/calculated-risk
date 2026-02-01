// ═══════════════════════════════════════════════════════════════
// SEASON CONFIG - All scatter/terrain config data
// ═══════════════════════════════════════════════════════════════
// Single source of truth for:
// - Scatter type definitions (SCATTER_TYPES)
// - Spawn rules (SPAWN_RULES)
// - Tree ages and categories
// - Age modifiers
// - Biome presets
// - Season x Biome config matrix (absolute values)
//
// See docs/season-biome-design.md for visual mood reference.
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// COLOR VARIATION - Natural randomness ranges
// ═══════════════════════════════════════════════════════════════

export const COLOR_VARIATION = {
  hueRange: 20,        // ±10 degrees
  brightnessRange: 0.2, // ±10%
  saturationRange: 0.2  // ±10%
};

// ═══════════════════════════════════════════════════════════════
// TREE AGES - Scale multipliers per age
// ═══════════════════════════════════════════════════════════════

export const TREE_AGES = {
  sapling: 0.4,
  young: 0.6,
  mature: 0.8,
  old: 1.0,
  transitional: 0.85
};

export const TREE_AGE_THRESHOLD = 0.7;

// ═══════════════════════════════════════════════════════════════
// AGE MODIFIERS - How tree age affects child spawn density
// ═══════════════════════════════════════════════════════════════

export const AGE_MODIFIERS = {
  young:        { floor: 0.5, particle: 0.5, brush: 0.6 },
  transitional: { floor: 1.0, particle: 1.0, brush: 1.0 },
  old:          { floor: 1.0, particle: 1.0, brush: 1.0 },
  mature:       { floor: 1.0, particle: 1.0, brush: 1.0 },
  stressed:     { floor: 2.0, particle: 2.5, brush: 0.4 }
};

// ═══════════════════════════════════════════════════════════════
// TREE CATEGORIES - Maps tree types to deciduous/conifer/dead
// ═══════════════════════════════════════════════════════════════

export const TREE_CATEGORIES = {
  'tree-oak': 'deciduous',
  'tree-birch': 'deciduous',
  'tree-willow': 'deciduous',
  'tree-pine': 'conifer',
  'tree-dead': 'dead'
};

// ═══════════════════════════════════════════════════════════════
// SCATTER_TYPES - Unified type definitions
// ═══════════════════════════════════════════════════════════════

export const SCATTER_TYPES = {
  // ── TREES ──────────────────────────────────────────────────
  // childSpawnStart: ratio of canopy radius where children BEGIN spawning
  //   - 0.0 = from trunk (for dead trees - visible through bare branches)
  //   - 0.9 = from canopy edge (for live trees - visible at drip line)
  //   - 1.0+ = outside canopy only
  'tree-oak': {
    category: 'tree',
    layer: 'canopy',
    featureType: 'forest',
    baseScale: 1.0,
    scaleVariance: 0.3,
    spacing: 50,
    canopyRadius: 45,     // Visual canopy radius for occlusion checks
    variants: 3,
    ages: ['young', 'old', 'transitional'],
    canopyFill: 0.85,
    childSpawnStart: 0.9
  },
  'tree-pine': {
    category: 'tree',
    layer: 'canopy',
    featureType: 'forest',
    baseScale: 0.9,
    scaleVariance: 0.25,
    spacing: 30,
    canopyRadius: 30,
    variants: 3,
    ages: ['young', 'old', 'transitional'],
    canopyFill: 0.7,
    childSpawnStart: 0.85
  },
  'tree-birch': {
    category: 'tree',
    layer: 'canopy',
    featureType: 'forest',
    baseScale: 0.7,
    scaleVariance: 0.2,
    spacing: 35,
    canopyRadius: 28,
    variants: 3,
    ages: ['young', 'old', 'transitional'],
    canopyFill: 0.75,
    childSpawnStart: 0.9
  },
  'tree-willow': {
    category: 'tree',
    layer: 'canopy',
    featureType: 'forest',
    baseScale: 1.1,
    scaleVariance: 0.3,
    spacing: 55,
    canopyRadius: 50,
    variants: 3,
    ages: ['young', 'old'],
    canopyFill: 0.9,
    childSpawnStart: 0.7
  },
  'tree-dead': {
    category: 'tree',
    layer: 'canopy',
    featureType: 'forest',
    baseScale: 0.8,
    scaleVariance: 0.35,
    spacing: 20,
    canopyRadius: 10,     // Small - dead trees don't hide much
    variants: 3,
    ages: ['young', 'old'],
    canopyFill: 0.4,
    childSpawnStart: 0,
    isDead: true
  },

  // ── FLOOR ──────────────────────────────────────────────────
  'floor-leaf': {
    category: 'floor',
    layer: 'ground',
    baseScale: 0.4,
    scaleVariance: 0.15,
    spacing: 0,
    variants: 3,
    fadeWithDistance: true
  },
  'floor-leaf-fall': {
    category: 'floor',
    layer: 'ground',
    baseScale: 0.4,
    scaleVariance: 0.15,
    spacing: 0,
    variants: 3,
    fadeWithDistance: true
  },
  'floor-leaf-dry': {
    category: 'floor',
    layer: 'ground',
    baseScale: 0.35,
    scaleVariance: 0.15,
    spacing: 0,
    variants: 3,
    fadeWithDistance: true
  },
  'floor-needle': {
    category: 'floor',
    layer: 'ground',
    baseScale: 0.35,
    scaleVariance: 0.1,
    spacing: 0,
    variants: 3,
    fadeWithDistance: true
  },
  'floor-debris': {
    category: 'floor',
    layer: 'ground',
    baseScale: 0.35,
    scaleVariance: 0.2,
    spacing: 0,
    variants: 3,
    fadeWithDistance: true
  },

  // ── BRUSH ──────────────────────────────────────────────────
  // canopyRadius values per docs/canopy-collision-system.md
  // spacing values calibrated so 1× density produces natural-looking amount
  'bush-small': {
    category: 'brush',
    layer: 'canopy',
    featureType: 'brush',
    baseScale: 0.8,
    scaleVariance: 0.25,
    spacing: 105,
    variants: 3,
    canopyRadius: 12     // Small shrub
  },
  'bush-large': {
    category: 'brush',
    layer: 'canopy',
    featureType: 'brush',
    baseScale: 1.0,
    scaleVariance: 0.3,
    spacing: 135,
    variants: 3,
    canopyRadius: 18     // Larger shrub
  },
  'fern': {
    category: 'brush',
    layer: 'canopy',
    featureType: 'brush',
    baseScale: 0.7,
    scaleVariance: 0.2,
    spacing: 90,
    variants: 3,
    canopyRadius: 10,     // Low ground cover
    spriteBase: 'fern-small'  // Maps to fern-small-1.png, etc.
  },
  'reed': {
    category: 'brush',
    layer: 'canopy',
    featureType: 'brush',
    baseScale: 0.75,
    scaleVariance: 0.25,
    spacing: 75,
    variants: 3,
    canopyRadius: 8      // Thin vertical
  },
  'dead-brush': {
    category: 'brush',
    layer: 'canopy',
    featureType: 'brush',
    baseScale: 0.6,
    scaleVariance: 0.3,
    spacing: 120,
    variants: 3,
    canopyRadius: 10     // Sparse dead brush
  },

  // ── PARTICLES ──────────────────────────────────────────────
  // Particles render in 'particle' layer (between ground and canopy)
  // spriteBase maps type to actual sprite files: {spriteBase}-{variant}.png
  'particle-leaf': {
    category: 'particle',
    layer: 'particle',
    baseScale: 0.5,
    scaleVariance: 0.4,
    spacing: 0,
    variants: 3,
    spriteBase: 'leaf-particles'  // Maps to leaf-particles-1.png, etc.
  },
  'particle-leaf-fall': {
    category: 'particle',
    layer: 'particle',
    baseScale: 0.5,
    scaleVariance: 0.4,
    spacing: 0,
    variants: 3,
    spriteBase: 'leaf-fall-particles'
  },
  'particle-leaf-dry': {
    category: 'particle',
    layer: 'particle',
    baseScale: 0.45,
    scaleVariance: 0.35,
    spacing: 0,
    variants: 3,
    spriteBase: 'leaf-dry-particles'
  },
  'particle-petal': {
    category: 'particle',
    layer: 'particle',
    baseScale: 0.4,
    scaleVariance: 0.3,
    spacing: 0,
    variants: 3,
    spriteBase: 'leaf-particles'  // Uses leaf for now (needs petal sprites)
  },
  'particle-needle': {
    category: 'particle',
    layer: 'particle',
    baseScale: 0.4,
    scaleVariance: 0.3,
    spacing: 0,
    variants: 3,
    spriteBase: 'needle-particles'
  },
  'particle-twig': {
    category: 'particle',
    layer: 'particle',
    baseScale: 0.45,
    scaleVariance: 0.35,
    spacing: 0,
    variants: 3,
    spriteBase: 'twig-particles'
  }
};

// ═══════════════════════════════════════════════════════════════
// SPAWN_RULES - Parent to child spawn definitions
// ═══════════════════════════════════════════════════════════════

export const SPAWN_RULES = {
  // === DECIDUOUS TREES ===
  'tree-oak': {
    spawns: [
      { type: 'floor-leaf', density: 6, densityVariance: 2, scale: 0.5, distribution: 'under-canopy' },
      { type: 'particle-leaf', density: 4, densityVariance: 2, scale: 0.35, distribution: 'ring', minRadius: 0.9, maxRadius: 1.5 }
    ]
  },
  'tree-birch': {
    spawns: [
      { type: 'floor-leaf', density: 5, densityVariance: 2, scale: 0.4, distribution: 'under-canopy' },
      { type: 'particle-leaf', density: 3, densityVariance: 1, scale: 0.3, distribution: 'ring', minRadius: 0.9, maxRadius: 1.3 }
    ]
  },
  'tree-willow': {
    spawns: [
      { type: 'floor-leaf', density: 7, densityVariance: 2, scale: 0.5, distribution: 'under-canopy' },
      { type: 'particle-leaf', density: 4, densityVariance: 2, scale: 0.35, distribution: 'ring', minRadius: 0.8, maxRadius: 1.4 }
    ]
  },

  // === CONIFER TREES ===
  'tree-pine': {
    spawns: [
      { type: 'floor-needle', density: 7, densityVariance: 2, scale: 0.4, distribution: 'under-canopy' },
      { type: 'particle-leaf', density: 3, densityVariance: 1, scale: 0.3, distribution: 'ring', minRadius: 0.85, maxRadius: 1.4 }
    ]
  },

  // === DEAD TREES ===
  'tree-dead': {
    spawns: [
      { type: 'floor-debris', density: 5, densityVariance: 2, scale: 0.4, distribution: 'under-canopy' },
      { type: 'particle-leaf', density: 3, densityVariance: 1, scale: 0.25, distribution: 'ring', minRadius: 0.8, maxRadius: 1.3 }
    ]
  },

  // === BRUSH (independent, spawns own floor + particles) ===
  'bush-small': {
    spawns: [
      { type: 'floor-leaf', density: 2, densityVariance: 1, scale: 0.3, distribution: 'under-canopy' },
      { type: 'particle-leaf', density: 2, densityVariance: 1, scale: 0.25, distribution: 'ring', minRadius: 0.8, maxRadius: 1.3 }
    ]
  },
  'bush-large': {
    spawns: [
      { type: 'floor-leaf', density: 3, densityVariance: 1, scale: 0.35, distribution: 'under-canopy' },
      { type: 'particle-leaf', density: 3, densityVariance: 1, scale: 0.3, distribution: 'ring', minRadius: 0.8, maxRadius: 1.4 }
    ]
  },
  'fern': {
    spawns: [
      { type: 'floor-leaf', density: 2, densityVariance: 1, scale: 0.25, distribution: 'under-canopy' },
      { type: 'particle-leaf', density: 1, densityVariance: 1, scale: 0.2, distribution: 'ring', minRadius: 0.7, maxRadius: 1.2 }
    ]
  },
  'reed': {
    spawns: [
      { type: 'floor-leaf', density: 1, densityVariance: 1, scale: 0.2, distribution: 'under-canopy' },
      { type: 'particle-leaf', density: 1, densityVariance: 1, scale: 0.15, distribution: 'ring', minRadius: 0.6, maxRadius: 1.0 }
    ]
  }
};

// ═══════════════════════════════════════════════════════════════
// BIOME PRESETS - Tree mix, brush types, age ratios
// ═══════════════════════════════════════════════════════════════
// Season-independent structural data per biome.
// Season-specific values (density, color, environment) are in
// SEASON_BIOME_CONFIG below.
// ═══════════════════════════════════════════════════════════════

export const BIOME_PRESETS = {
  temperate: {
    name: 'Temperate Forest',
    description: 'Mixed deciduous forest with oak and birch',
    treeCategory: 'deciduous',
    trees: { 'tree-oak': 0.6, 'tree-birch': 0.3, 'tree-dead': 0.1 },
    brush: ['bush-small'],
    ageRatios: { young: 0.2, transitional: 0.3, old: 0.5 }
  },
  'oak-forest': {
    name: 'Oak Forest',
    description: 'Dense oak woodland',
    treeCategory: 'deciduous',
    trees: { 'tree-oak': 0.85, 'tree-dead': 0.15 },
    brush: ['bush-small', 'bush-large'],
    ageRatios: { young: 0.15, transitional: 0.25, old: 0.6 }
  },
  'birch-grove': {
    name: 'Birch Grove',
    description: 'Light, airy birch forest',
    treeCategory: 'deciduous',
    trees: { 'tree-birch': 0.8, 'tree-oak': 0.15, 'tree-dead': 0.05 },
    brush: ['bush-small'],
    ageRatios: { young: 0.3, transitional: 0.4, old: 0.3 }
  },
  conifer: {
    name: 'Conifer Forest',
    description: 'Pine forest with ferns',
    treeCategory: 'conifer',
    trees: { 'tree-pine': 0.9, 'tree-dead': 0.1 },
    brush: ['fern'],
    ageRatios: { young: 0.25, transitional: 0.35, old: 0.4 }
  },
  wetland: {
    name: 'Wetland',
    description: 'Willow trees near water with reeds',
    treeCategory: 'deciduous',
    trees: { 'tree-willow': 0.8, 'tree-dead': 0.2 },
    brush: ['reed', 'bush-small'],
    ageRatios: { young: 0.2, transitional: 0.4, old: 0.4 }
  },
  'dead-forest': {
    name: 'Dead Forest',
    description: 'Barren, lifeless trees',
    treeCategory: 'dead',
    trees: { 'tree-dead': 1.0 },
    brush: ['dead-brush'],
    ageRatios: { old: 1.0 }
  },
  custom: {
    name: 'Custom',
    description: 'Define your own settings',
    treeCategory: 'deciduous',
    trees: {},
    brush: [],
    ageRatios: { young: 0.33, transitional: 0.34, old: 0.33 }
  }
};

// ═══════════════════════════════════════════════════════════════
// SEASON x BIOME CONFIG - Absolute values per combination
// ═══════════════════════════════════════════════════════════════
// No multipliers. WYSIWYG. Each entry is the complete set of
// season-specific values for one season + biome pair.
//
// Access via: getSeasonBiomeConfig(season, biome)
// ═══════════════════════════════════════════════════════════════

export const SEASON_BIOME_CONFIG = {

  // ═════════════════════════════════════════════════════════════
  // SUMMER - Baseline. Full foliage, peak green.
  // ═════════════════════════════════════════════════════════════
  summer: {
    temperate: {
      scatter: {
        floorType: 'floor-leaf',
        floorDensity: 0.6,
        particleType: 'particle-leaf',
        particleDensity: 0.3,
        brushDensity: 1.0
      },
      canopy: { hueShift: 0, saturation: 1.0, brightness: 1.0 },
      ground: { tintColor: '#4a5e3a', brightness: 1.0 },
      environment: { snow: false, puddles: false, fogDensity: 0, frost: false },
      atmosphere: { ambientColor: '#ffffff', shadowIntensity: 0.6, windSpeed: 0.3 }
    },

    'oak-forest': {
      scatter: {
        floorType: 'floor-leaf',
        floorDensity: 0.72,
        particleType: 'particle-leaf',
        particleDensity: 0.3,
        brushDensity: 1.2
      },
      canopy: { hueShift: 0, saturation: 1.0, brightness: 0.95 },
      ground: { tintColor: '#3d4f30', brightness: 0.9 },
      environment: { snow: false, puddles: false, fogDensity: 0, frost: false },
      atmosphere: { ambientColor: '#ffffff', shadowIntensity: 0.7, windSpeed: 0.15 }
    },

    'birch-grove': {
      scatter: {
        floorType: 'floor-leaf',
        floorDensity: 0.48,
        particleType: 'particle-leaf',
        particleDensity: 0.36,
        brushDensity: 0.8
      },
      canopy: { hueShift: -5, saturation: 1.05, brightness: 1.1 },
      ground: { tintColor: '#5a6e45', brightness: 1.1 },
      environment: { snow: false, puddles: false, fogDensity: 0, frost: false },
      atmosphere: { ambientColor: '#ffffff', shadowIntensity: 0.45, windSpeed: 0.4 }
    },

    conifer: {
      scatter: {
        floorType: 'floor-needle',
        floorDensity: 1.2,
        particleType: 'particle-needle',
        particleDensity: 0.48,
        brushDensity: 1.0
      },
      canopy: { hueShift: 0, saturation: 1.0, brightness: 1.0 },
      ground: { tintColor: '#5c4a35', brightness: 0.95 },
      environment: { snow: false, puddles: false, fogDensity: 0, frost: false },
      atmosphere: { ambientColor: '#f8f8ff', shadowIntensity: 0.55, windSpeed: 0.2 }
    },

    wetland: {
      scatter: {
        floorType: 'floor-leaf',
        floorDensity: 0.6,
        particleType: 'particle-leaf',
        particleDensity: 0.24,
        brushDensity: 1.5
      },
      canopy: { hueShift: 5, saturation: 1.1, brightness: 1.0 },
      ground: { tintColor: '#3a4a30', brightness: 0.85 },
      environment: { snow: false, puddles: false, fogDensity: 0.05, frost: false },
      atmosphere: { ambientColor: '#fffff5', shadowIntensity: 0.4, windSpeed: 0.2 }
    },

    'dead-forest': {
      scatter: {
        floorType: 'floor-debris',
        floorDensity: 0.9,
        particleType: 'particle-twig',
        particleDensity: 0.24,
        brushDensity: 0.5
      },
      canopy: { hueShift: 0, saturation: 0.6, brightness: 0.9 },
      ground: { tintColor: '#6b6055', brightness: 1.0 },
      environment: { snow: false, puddles: false, fogDensity: 0, frost: false },
      atmosphere: { ambientColor: '#ffffff', shadowIntensity: 0.3, windSpeed: 0.35 }
    }
  },

  // ═════════════════════════════════════════════════════════════
  // FALL - Amber/rust canopy, heavy leaf litter, warm decay.
  // ═════════════════════════════════════════════════════════════
  fall: {
    temperate: {
      scatter: {
        floorType: 'floor-leaf-fall',
        floorDensity: 2.0,
        particleType: 'particle-leaf-fall',
        particleDensity: 2.0,
        brushDensity: 0.7
      },
      canopy: { hueShift: 30, saturation: 1.2, brightness: 0.9 },
      ground: { tintColor: '#6b5030', brightness: 0.95 },
      environment: { snow: false, puddles: false, fogDensity: 0.1, frost: false },
      atmosphere: { ambientColor: '#fff5e6', shadowIntensity: 0.5, windSpeed: 0.4 }
    },

    'oak-forest': {
      scatter: {
        floorType: 'floor-leaf-fall',
        floorDensity: 2.4,
        particleType: 'particle-leaf-fall',
        particleDensity: 2.0,
        brushDensity: 0.84
      },
      canopy: { hueShift: 35, saturation: 1.1, brightness: 0.85 },
      ground: { tintColor: '#5a4025', brightness: 0.85 },
      environment: { snow: false, puddles: false, fogDensity: 0.15, frost: false },
      atmosphere: { ambientColor: '#fff0d9', shadowIntensity: 0.5, windSpeed: 0.25 }
    },

    'birch-grove': {
      scatter: {
        floorType: 'floor-leaf-fall',
        floorDensity: 1.6,
        particleType: 'particle-leaf-fall',
        particleDensity: 2.4,
        brushDensity: 0.56
      },
      canopy: { hueShift: 25, saturation: 1.3, brightness: 0.95 },
      ground: { tintColor: '#7a6840', brightness: 1.0 },
      environment: { snow: false, puddles: false, fogDensity: 0.05, frost: false },
      atmosphere: { ambientColor: '#fffae6', shadowIntensity: 0.4, windSpeed: 0.5 }
    },

    conifer: {
      scatter: {
        floorType: 'floor-needle',
        floorDensity: 1.2,
        particleType: 'particle-needle',
        particleDensity: 0.6,
        brushDensity: 1.0
      },
      canopy: { hueShift: 0, saturation: 1.0, brightness: 1.0 },
      ground: { tintColor: '#5c4a35', brightness: 0.9 },
      environment: { snow: false, puddles: false, fogDensity: 0.05, frost: false },
      atmosphere: { ambientColor: '#fffcf5', shadowIntensity: 0.55, windSpeed: 0.25 }
    },

    wetland: {
      scatter: {
        floorType: 'floor-leaf-fall',
        floorDensity: 2.0,
        particleType: 'particle-leaf-fall',
        particleDensity: 1.6,
        brushDensity: 1.05
      },
      canopy: { hueShift: 20, saturation: 0.8, brightness: 0.85 },
      ground: { tintColor: '#4a4030', brightness: 0.8 },
      environment: { snow: false, puddles: true, fogDensity: 0.2, frost: false },
      atmosphere: { ambientColor: '#f5f0e6', shadowIntensity: 0.35, windSpeed: 0.3 }
    },

    'dead-forest': {
      scatter: {
        floorType: 'floor-debris',
        floorDensity: 2.25,
        particleType: 'particle-twig',
        particleDensity: 0.64,
        brushDensity: 0.35
      },
      canopy: { hueShift: 0, saturation: 0.6, brightness: 0.85 },
      ground: { tintColor: '#6b5a48', brightness: 0.9 },
      environment: { snow: false, puddles: false, fogDensity: 0.1, frost: false },
      atmosphere: { ambientColor: '#fff5e6', shadowIntensity: 0.3, windSpeed: 0.45 }
    }
  },

  // ═════════════════════════════════════════════════════════════
  // WINTER - Bare branches, frost/snow, desaturated, stark.
  // ═════════════════════════════════════════════════════════════
  winter: {
    temperate: {
      scatter: {
        floorType: 'floor-leaf-dry',
        floorDensity: 0.5,
        particleType: 'particle-leaf-dry',
        particleDensity: 0.1,
        brushDensity: 0.3
      },
      canopy: { hueShift: 0, saturation: 0.3, brightness: 0.8 },
      ground: { tintColor: '#8a8a85', brightness: 1.1 },
      environment: { snow: true, puddles: false, fogDensity: 0.05, frost: true },
      atmosphere: { ambientColor: '#e6eeff', shadowIntensity: 0.4, windSpeed: 0.25 }
    },

    'oak-forest': {
      scatter: {
        floorType: 'floor-leaf-dry',
        floorDensity: 0.6,
        particleType: 'particle-leaf-dry',
        particleDensity: 0.1,
        brushDensity: 0.36
      },
      canopy: { hueShift: 0, saturation: 0.3, brightness: 0.75 },
      ground: { tintColor: '#7a7a72', brightness: 1.0 },
      environment: { snow: true, puddles: false, fogDensity: 0.1, frost: true },
      atmosphere: { ambientColor: '#e0e8f8', shadowIntensity: 0.35, windSpeed: 0.2 }
    },

    'birch-grove': {
      scatter: {
        floorType: 'floor-leaf-dry',
        floorDensity: 0.4,
        particleType: 'particle-leaf-dry',
        particleDensity: 0.12,
        brushDensity: 0.24
      },
      canopy: { hueShift: 0, saturation: 0.2, brightness: 0.85 },
      ground: { tintColor: '#a0a098', brightness: 1.2 },
      environment: { snow: true, puddles: false, fogDensity: 0, frost: true },
      atmosphere: { ambientColor: '#eaf0ff', shadowIntensity: 0.25, windSpeed: 0.3 }
    },

    conifer: {
      scatter: {
        floorType: 'floor-needle',
        floorDensity: 1.2,
        particleType: 'particle-needle',
        particleDensity: 0.3,
        brushDensity: 0.3
      },
      canopy: { hueShift: 0, saturation: 0.95, brightness: 0.95 },
      ground: { tintColor: '#7a7a80', brightness: 1.05 },
      environment: { snow: true, puddles: false, fogDensity: 0.05, frost: true },
      atmosphere: { ambientColor: '#e6eeff', shadowIntensity: 0.5, windSpeed: 0.2 }
    },

    wetland: {
      scatter: {
        floorType: 'floor-leaf-dry',
        floorDensity: 0.5,
        particleType: 'particle-leaf-dry',
        particleDensity: 0.08,
        brushDensity: 0.45
      },
      canopy: { hueShift: 0, saturation: 0.3, brightness: 0.75 },
      ground: { tintColor: '#6a6a68', brightness: 0.9 },
      environment: { snow: true, puddles: false, fogDensity: 0.15, frost: true },
      atmosphere: { ambientColor: '#dde5f0', shadowIntensity: 0.3, windSpeed: 0.2 }
    },

    'dead-forest': {
      scatter: {
        floorType: 'floor-debris',
        floorDensity: 1.5,
        particleType: 'particle-twig',
        particleDensity: 0.16,
        brushDensity: 0.15
      },
      canopy: { hueShift: 0, saturation: 0.4, brightness: 0.8 },
      ground: { tintColor: '#9a9a95', brightness: 1.15 },
      environment: { snow: true, puddles: false, fogDensity: 0, frost: true },
      atmosphere: { ambientColor: '#e6eeff', shadowIntensity: 0.25, windSpeed: 0.3 }
    }
  },

  // ═════════════════════════════════════════════════════════════
  // SPRING - Thin buds, petals, decomposing debris, renewal.
  // ═════════════════════════════════════════════════════════════
  spring: {
    temperate: {
      scatter: {
        floorType: 'floor-leaf-dry',
        floorDensity: 0.4,
        particleType: 'particle-petal',
        particleDensity: 0.6,
        brushDensity: 0.5
      },
      canopy: { hueShift: -10, saturation: 1.1, brightness: 1.1 },
      ground: { tintColor: '#556040', brightness: 1.0 },
      environment: { snow: false, puddles: false, fogDensity: 0.1, frost: false },
      atmosphere: { ambientColor: '#f5ffe6', shadowIntensity: 0.45, windSpeed: 0.35 }
    },

    'oak-forest': {
      scatter: {
        floorType: 'floor-leaf-dry',
        floorDensity: 0.48,
        particleType: 'particle-petal',
        particleDensity: 0.6,
        brushDensity: 0.6
      },
      canopy: { hueShift: -10, saturation: 1.05, brightness: 1.05 },
      ground: { tintColor: '#4a5535', brightness: 0.95 },
      environment: { snow: false, puddles: false, fogDensity: 0.15, frost: false },
      atmosphere: { ambientColor: '#f0f8e0', shadowIntensity: 0.45, windSpeed: 0.2 }
    },

    'birch-grove': {
      scatter: {
        floorType: 'floor-leaf-dry',
        floorDensity: 0.32,
        particleType: 'particle-petal',
        particleDensity: 0.72,
        brushDensity: 0.4
      },
      canopy: { hueShift: -15, saturation: 1.15, brightness: 1.15 },
      ground: { tintColor: '#657548', brightness: 1.1 },
      environment: { snow: false, puddles: false, fogDensity: 0.05, frost: false },
      atmosphere: { ambientColor: '#f8ffe8', shadowIntensity: 0.35, windSpeed: 0.45 }
    },

    conifer: {
      scatter: {
        floorType: 'floor-needle',
        floorDensity: 1.2,
        particleType: 'particle-needle',
        particleDensity: 0.48,
        brushDensity: 0.5
      },
      canopy: { hueShift: -5, saturation: 1.02, brightness: 1.02 },
      ground: { tintColor: '#5c4a38', brightness: 1.0 },
      environment: { snow: false, puddles: false, fogDensity: 0.05, frost: false },
      atmosphere: { ambientColor: '#f8fcf0', shadowIntensity: 0.5, windSpeed: 0.25 }
    },

    wetland: {
      scatter: {
        floorType: 'floor-leaf-dry',
        floorDensity: 0.4,
        particleType: 'particle-petal',
        particleDensity: 0.48,
        brushDensity: 0.75
      },
      canopy: { hueShift: -10, saturation: 1.1, brightness: 1.05 },
      ground: { tintColor: '#3d4a30', brightness: 0.9 },
      environment: { snow: false, puddles: true, fogDensity: 0.2, frost: false },
      atmosphere: { ambientColor: '#f0f5e6', shadowIntensity: 0.35, windSpeed: 0.3 }
    },

    'dead-forest': {
      scatter: {
        floorType: 'floor-debris',
        floorDensity: 1.5,
        particleType: 'particle-twig',
        particleDensity: 0.24,
        brushDensity: 0.25
      },
      canopy: { hueShift: 0, saturation: 0.5, brightness: 0.85 },
      ground: { tintColor: '#5a5548', brightness: 0.9 },
      environment: { snow: false, puddles: true, fogDensity: 0.1, frost: false },
      atmosphere: { ambientColor: '#f0f0e6', shadowIntensity: 0.3, windSpeed: 0.35 }
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// LEGACY COMPAT - Old SEASONS format (multiplier-based)
// ═══════════════════════════════════════════════════════════════
// Kept for backward compatibility during migration. Will be
// removed once scatter.js is fully refactored to use
// SEASON_BIOME_CONFIG.
// ═══════════════════════════════════════════════════════════════

export const SEASONS = {
  spring: {
    deciduous: {
      floorMult: 0.4,
      particleMult: 0.6,
      floorType: 'floor-leaf-dry',
      particleType: 'particle-petal'
    },
    conifer: {
      floorMult: 1.0,
      particleMult: 0.8,
      floorType: 'floor-needle',
      particleType: 'particle-needle'
    }
  },
  summer: {
    deciduous: {
      floorMult: 0.6,
      particleMult: 0.3,
      floorType: 'floor-leaf',
      particleType: 'particle-leaf'
    },
    conifer: {
      floorMult: 1.0,
      particleMult: 0.8,
      floorType: 'floor-needle',
      particleType: 'particle-needle'
    }
  },
  fall: {
    deciduous: {
      floorMult: 2.0,
      particleMult: 2.0,
      floorType: 'floor-leaf-fall',
      particleType: 'particle-leaf-fall'
    },
    conifer: {
      floorMult: 1.0,
      particleMult: 1.0,
      floorType: 'floor-needle',
      particleType: 'particle-needle'
    }
  },
  winter: {
    deciduous: {
      floorMult: 0.5,
      particleMult: 0.1,
      floorType: 'floor-leaf-dry',
      particleType: 'particle-leaf-dry'
    },
    conifer: {
      floorMult: 1.0,
      particleMult: 0.5,
      floorType: 'floor-needle',
      particleType: 'particle-needle'
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Get config for a specific season + biome combination
 * @param {string} season - 'spring' | 'summer' | 'fall' | 'winter'
 * @param {string} biome - biome key from BIOME_PRESETS
 * @returns {object} Complete season-specific config for that combination
 */
export function getSeasonBiomeConfig(season, biome) {
  return SEASON_BIOME_CONFIG[season]?.[biome]
    ?? SEASON_BIOME_CONFIG[season]?.temperate
    ?? SEASON_BIOME_CONFIG.summer?.temperate;
}

/**
 * Get effective settings by merging biome preset with season config and user overrides.
 * This replaces the old getEffectiveSettings that used multiplier-based SEASONS.
 *
 * @param {string} biome - Biome preset key
 * @param {string} season - Season key
 * @param {object} overrides - User overrides (from editor UI)
 * @returns {object} Merged settings ready for generation
 */
export function getEffectiveSettings(biome, season, overrides = {}) {
  const preset = BIOME_PRESETS[biome] || BIOME_PRESETS.temperate;
  const seasonConfig = getSeasonBiomeConfig(season, biome);

  // Build settings from biome structure + season absolute values
  const settings = {
    // From biome preset (season-independent)
    trees: { ...preset.trees },
    brush: [...preset.brush],
    ageRatios: { ...preset.ageRatios },

    // From season config (absolute values)
    brushDensity: seasonConfig.scatter.brushDensity,
    floorDensity: seasonConfig.scatter.floorDensity,
    particleDensity: seasonConfig.scatter.particleDensity,
    floorType: seasonConfig.scatter.floorType,
    particleType: seasonConfig.scatter.particleType,

    // Visual config (passed through for rendering)
    canopy: { ...seasonConfig.canopy },
    ground: { ...seasonConfig.ground },
    environment: { ...seasonConfig.environment },
    atmosphere: { ...seasonConfig.atmosphere },

    // Context
    season,
    biome
  };

  // Apply user overrides
  if (overrides.trees) Object.assign(settings.trees, overrides.trees);
  if (overrides.brush) settings.brush = overrides.brush;
  if (overrides.brushDensity !== undefined) settings.brushDensity = overrides.brushDensity;
  if (overrides.floorDensity !== undefined) settings.floorDensity = overrides.floorDensity;
  if (overrides.particleDensity !== undefined) settings.particleDensity = overrides.particleDensity;
  if (overrides.ageRatios) Object.assign(settings.ageRatios, overrides.ageRatios);

  // Deep merge for visual overrides
  if (overrides.canopy) Object.assign(settings.canopy, overrides.canopy);
  if (overrides.ground) Object.assign(settings.ground, overrides.ground);
  if (overrides.environment) Object.assign(settings.environment, overrides.environment);
  if (overrides.atmosphere) Object.assign(settings.atmosphere, overrides.atmosphere);

  return settings;
}

/**
 * Get config schema for UI generation.
 * Returns metadata about all tweakable values with ranges and defaults.
 * Used by the editor to dynamically build slider/input controls.
 *
 * @returns {object} Schema describing all config values
 */
export function getConfigSchema() {
  return {
    scatter: {
      label: 'Scatter',
      fields: {
        floorType: {
          type: 'select',
          label: 'Floor Type',
          options: Object.keys(SCATTER_TYPES).filter(k => SCATTER_TYPES[k].category === 'floor')
        },
        floorDensity: { type: 'range', label: 'Floor Density', min: 0, max: 3.0, step: 0.05 },
        particleType: {
          type: 'select',
          label: 'Particle Type',
          options: Object.keys(SCATTER_TYPES).filter(k => SCATTER_TYPES[k].category === 'particle')
        },
        particleDensity: { type: 'range', label: 'Particle Density', min: 0, max: 3.0, step: 0.05 },
        brushDensity: { type: 'range', label: 'Brush Density', min: 0, max: 2.0, step: 0.05 }
      }
    },
    canopy: {
      label: 'Canopy',
      fields: {
        hueShift: { type: 'range', label: 'Hue Shift', min: -180, max: 180, step: 1, unit: 'deg' },
        saturation: { type: 'range', label: 'Saturation', min: 0, max: 2.0, step: 0.05 },
        brightness: { type: 'range', label: 'Brightness', min: 0, max: 2.0, step: 0.05 }
      }
    },
    ground: {
      label: 'Ground',
      fields: {
        tintColor: { type: 'color', label: 'Tint Color' },
        brightness: { type: 'range', label: 'Brightness', min: 0, max: 2.0, step: 0.05 }
      }
    },
    environment: {
      label: 'Environment',
      fields: {
        snow: { type: 'checkbox', label: 'Snow' },
        puddles: { type: 'checkbox', label: 'Puddles' },
        fogDensity: { type: 'range', label: 'Fog Density', min: 0, max: 1.0, step: 0.05 },
        frost: { type: 'checkbox', label: 'Frost' }
      }
    },
    atmosphere: {
      label: 'Atmosphere',
      fields: {
        ambientColor: { type: 'color', label: 'Ambient Color' },
        shadowIntensity: { type: 'range', label: 'Shadow Intensity', min: 0, max: 1.0, step: 0.05 },
        windSpeed: { type: 'range', label: 'Wind Speed', min: 0, max: 1.0, step: 0.05 }
      }
    }
  };
}

/**
 * Export current season override values as a formatted JS string.
 * Used by the editor's "Export Config" button.
 *
 * @param {string} season - Season key
 * @param {string} biome - Biome key
 * @param {object} values - Current values (with overrides applied)
 * @returns {string} Formatted JS object literal ready to paste into config
 */
export function exportConfigString(season, biome, values) {
  const indent = '      ';
  const lines = [];

  lines.push(`    '${biome}': {`);
  lines.push(`${indent}scatter: {`);
  lines.push(`${indent}  floorType: '${values.scatter?.floorType || values.floorType}',`);
  lines.push(`${indent}  floorDensity: ${values.scatter?.floorDensity ?? values.floorDensity},`);
  lines.push(`${indent}  particleType: '${values.scatter?.particleType || values.particleType}',`);
  lines.push(`${indent}  particleDensity: ${values.scatter?.particleDensity ?? values.particleDensity},`);
  lines.push(`${indent}  brushDensity: ${values.scatter?.brushDensity ?? values.brushDensity}`);
  lines.push(`${indent}},`);

  const canopy = values.canopy || {};
  lines.push(`${indent}canopy: { hueShift: ${canopy.hueShift ?? 0}, saturation: ${canopy.saturation ?? 1.0}, brightness: ${canopy.brightness ?? 1.0} },`);

  const ground = values.ground || {};
  lines.push(`${indent}ground: { tintColor: '${ground.tintColor || '#4a5e3a'}', brightness: ${ground.brightness ?? 1.0} },`);

  const env = values.environment || {};
  lines.push(`${indent}environment: { snow: ${!!env.snow}, puddles: ${!!env.puddles}, fogDensity: ${env.fogDensity ?? 0}, frost: ${!!env.frost} },`);

  const atm = values.atmosphere || {};
  lines.push(`${indent}atmosphere: { ambientColor: '${atm.ambientColor || '#ffffff'}', shadowIntensity: ${atm.shadowIntensity ?? 0.6}, windSpeed: ${atm.windSpeed ?? 0.3} }`);

  lines.push(`    }`);

  return lines.join('\n');
}
