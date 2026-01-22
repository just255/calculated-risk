// ═══════════════════════════════════════════════════════════════
// PRESETS - Configuration presets for different game modes
// ═══════════════════════════════════════════════════════════════

import { BIOME_TERRAIN, Biome } from '../constants.js';

/**
 * Campaign battle plan preset
 * 24x24 grid with player/enemy deployment zones and NML
 */
export const CAMPAIGN_PRESET = {
  width: 24,
  height: 24,
  playerRows: 4,
  enemyRows: 4,

  features: {
    baseLayer: {
      enabled: true,
      scatterChance: 0.5
    },
    ridge: {
      count: 1,
      minLength: 6,
      maxLength: 14
    },
    brush: {
      count: [3, 5],
      minSize: 1,
      maxSize: 2,
      density: 0.6
    },
    forest: {
      count: [2, 3],
      minSize: 2,
      maxSize: 4,
      density: 0.75,
      withBrushEdge: true
    },
    water: {
      enabled: true,
      chance: 0.5,
      crossings: 1
    },
    fortifications: {
      player: {
        enabled: true,
        minLength: 6,
        maxLength: 12
      },
      enemy: {
        enabled: true,
        chance: 0.5,
        minLength: 4,
        maxLength: 8
      }
    }
  }
};

/**
 * Zone battle preset
 * Variable size, uses biome weights
 */
export const ZONE_PRESET = {
  rowsPerZone: 24,
  width: 16,

  features: {
    baseLayer: {
      enabled: true,
      scatterChance: 0.6
    },
    useBiomeWeights: true,
    blendEdges: true,
    blendRows: 2
  }
};

/**
 * Endless mode preset
 * Scales with wave number
 */
export const ENDLESS_PRESET = {
  baseSize: 16,
  maxSize: 24,
  sizeScalePerWaves: 5,

  features: {
    baseLayer: {
      enabled: true,
      scatterChance: 0.4
    },
    brush: {
      baseCount: 2,
      scalePerWave: 0.3,
      minSize: 1,
      maxSize: 2,
      density: 0.6
    },
    forest: {
      baseCount: 1,
      scalePerWave: 0.2,
      minSize: 2,
      maxSize: 3,
      density: 0.7,
      withBrushEdge: true
    },
    ridge: {
      baseCount: 0,
      scalePerWave: 0.25,
      minLength: 3,
      maxLength: 8
    },
    water: {
      enabled: true,
      startAtWave: 5,
      chance: 0.3,
      crossings: 1
    },
    trench: {
      baseCount: 0,
      scalePerWave: 0.15,
      minLength: 3,
      maxLength: 6
    }
  }
};

/**
 * Get feature configuration from biome weights
 * Converts biome terrain weights into feature counts
 *
 * @param {string} biome - Biome name from Biome enum
 * @returns {Object} - Feature configuration
 */
export function getBiomeConfig(biome) {
  const weights = BIOME_TERRAIN[biome] || BIOME_TERRAIN.fields;

  return {
    water: {
      enabled: (weights.water || 0) > 0.1,
      count: (weights.water || 0) > 0.2 ? 2 : 1
    },
    brush: {
      count: Math.ceil((weights.brush || 0) * 10),
      density: 0.65
    },
    forest: {
      count: Math.floor((weights.forest || 0) * 5),
      density: 0.75,
      withBrushEdge: true
    },
    trench: {
      count: Math.ceil((weights.trench || 0) * 3)
    },
    pillbox: {
      count: Math.ceil((weights.pillbox || 0) * 3)
    },
    ridge: {
      count: Math.ceil((weights.high || 0) * 2)
    }
  };
}

/**
 * Calculate grid size for endless mode based on wave
 *
 * @param {number} wave - Current wave number
 * @returns {Object} - { width, height }
 */
export function getEndlessGridSize(wave) {
  const preset = ENDLESS_PRESET;
  const sizeBonus = Math.min(
    preset.maxSize - preset.baseSize,
    Math.floor(wave / preset.sizeScalePerWaves)
  );
  const size = preset.baseSize + sizeBonus;
  return { width: size, height: size };
}

/**
 * Calculate feature counts for endless mode based on wave
 *
 * @param {number} wave - Current wave number
 * @returns {Object} - Feature configuration with counts
 */
export function getEndlessFeatureCounts(wave) {
  const features = ENDLESS_PRESET.features;

  return {
    brush: {
      count: Math.floor(features.brush.baseCount + wave * features.brush.scalePerWave),
      minSize: features.brush.minSize,
      maxSize: features.brush.maxSize,
      density: features.brush.density
    },
    forest: {
      count: Math.floor(features.forest.baseCount + wave * features.forest.scalePerWave),
      minSize: features.forest.minSize,
      maxSize: features.forest.maxSize,
      density: features.forest.density,
      withBrushEdge: features.forest.withBrushEdge
    },
    ridge: {
      count: Math.floor(features.ridge.baseCount + wave * features.ridge.scalePerWave),
      minLength: features.ridge.minLength,
      maxLength: features.ridge.maxLength
    },
    water: {
      enabled: features.water.enabled && wave >= features.water.startAtWave,
      chance: features.water.chance,
      crossings: features.water.crossings
    },
    trench: {
      count: Math.floor(features.trench.baseCount + wave * features.trench.scalePerWave),
      minLength: features.trench.minLength,
      maxLength: features.trench.maxLength
    }
  };
}

/**
 * List of available biomes
 */
export const BIOMES = Object.values(Biome);

/**
 * Get a random biome
 * @param {Object} rng - RNG helper
 * @returns {string} - Biome name
 */
export function getRandomBiome(rng) {
  return rng.pick(BIOMES);
}
