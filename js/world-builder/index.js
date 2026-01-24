// ═══════════════════════════════════════════════════════════════
// WORLD BUILDER - Unified terrain generation interface
// Generates terrain for all game modes through a single API
// ═══════════════════════════════════════════════════════════════

import { createSeededRNG } from './rng.js';
import {
  placeCluster,
  placeLine,
  placeRiver,
  placeFortification,
  fillBase,
  blendEdge,
  placePoint
} from './placers.js';
import {
  CAMPAIGN_PRESET,
  ZONE_PRESET,
  ENDLESS_PRESET,
  getBiomeConfig,
  getEndlessGridSize,
  getEndlessFeatureCounts,
  getRandomBiome
} from './presets.js';

/**
 * WorldBuilder - Unified terrain generation
 *
 * @example
 * // Seeded weekly challenge
 * const terrain = WorldBuilder.generate({
 *   mode: 'endless',
 *   seed: 'weekly-2024-01-14',
 *   wave: 5
 * });
 *
 * @example
 * // Random campaign map
 * const terrain = WorldBuilder.generateForCampaign();
 *
 * @example
 * // Custom configuration
 * const terrain = WorldBuilder.generate({
 *   width: 20,
 *   height: 20,
 *   biome: 'forest',
 *   features: { water: { enabled: false } }
 * });
 */
export class WorldBuilder {

  /**
   * Main entry point - generate terrain
   *
   * @param {Object} config - Generation configuration
   * @param {string} [config.mode] - 'campaign' | 'zone' | 'endless' | 'custom'
   * @param {number|string|null} [config.seed] - RNG seed (null = random)
   * @param {number} [config.width] - Grid width
   * @param {number} [config.height] - Grid height
   * @param {string} [config.biome] - Biome name for terrain weights
   * @param {number} [config.wave] - Wave number (for endless scaling)
   * @param {string[][]} [config.previousEdge] - Previous zone for blending
   * @param {Object} [config.features] - Feature overrides
   * @returns {string[][]} - 2D terrain grid
   */
  static generate(config = {}) {
    const {
      mode = 'custom',
      seed = null,
      width,
      height,
      biome = null,
      wave = 1,
      previousEdge = null,
      features = {}
    } = config;

    // Initialize seeded RNG
    const rng = createSeededRNG(seed);

    // Get preset based on mode
    const preset = this._getPreset(mode);

    // Calculate grid dimensions
    let gridWidth, gridHeight;
    if (mode === 'endless') {
      const size = getEndlessGridSize(wave);
      gridWidth = width ?? size.width;
      gridHeight = height ?? size.height;
    } else {
      gridWidth = width ?? preset.width ?? 24;
      gridHeight = height ?? preset.height ?? preset.rowsPerZone ?? 24;
    }

    // Create empty terrain grid
    const terrain = this._createEmptyGrid(gridHeight, gridWidth);
    const bounds = { height: gridHeight, width: gridWidth };

    // Calculate NML zone (no-man's-land for combat)
    const nml = this._calculateNML(gridHeight, preset, mode);

    // Merge feature configs: preset defaults < biome weights < user overrides
    let featureConfig = { ...preset.features };

    // Apply biome weights if specified
    if (biome) {
      const biomeConfig = getBiomeConfig(biome);
      featureConfig = this._mergeFeatures(featureConfig, biomeConfig);
    }

    // Apply mode-specific scaling (endless)
    if (mode === 'endless') {
      const waveConfig = getEndlessFeatureCounts(wave);
      featureConfig = this._mergeFeatures(featureConfig, waveConfig);
    }

    // Apply user overrides
    featureConfig = this._mergeFeatures(featureConfig, features);

    // Run generation pipeline
    this._generateBase(terrain, rng, bounds, nml, featureConfig, previousEdge);
    this._generateFeatures(terrain, rng, bounds, nml, featureConfig, mode);

    return terrain;
  }

  /**
   * Generate terrain for campaign battle plan
   * @param {number|string|null} [seed] - RNG seed
   * @returns {string[][]} - 24x24 terrain grid
   */
  static generateForCampaign(seed = null) {
    return this.generate({ mode: 'campaign', seed });
  }

  /**
   * Generate terrain for endless mode
   * @param {number} wave - Current wave number
   * @param {number|string|null} [seed] - RNG seed
   * @returns {string[][]} - Terrain grid (size scales with wave)
   */
  static generateForEndless(wave, seed = null) {
    return this.generate({ mode: 'endless', wave, seed });
  }

  /**
   * Generate terrain for a zone
   * @param {Object} zone - Zone object with biome, startRow, endRow
   * @param {number} mapWidth - Width in cells
   * @param {string[][]} [previousEdge] - Previous zone's edge for blending
   * @param {number|string|null} [seed] - RNG seed
   * @returns {string[][]} - Terrain grid
   */
  static generateForZone(zone, mapWidth, previousEdge = null, seed = null) {
    const rows = (zone.endRow - zone.startRow) || ZONE_PRESET.rowsPerZone;
    return this.generate({
      mode: 'zone',
      width: mapWidth,
      height: rows,
      biome: zone.biome,
      previousEdge,
      seed
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════

  static _getPreset(mode) {
    switch (mode) {
      case 'campaign': return { ...CAMPAIGN_PRESET };
      case 'zone': return { ...ZONE_PRESET };
      case 'endless': return { ...ENDLESS_PRESET };
      default: return {};
    }
  }

  static _createEmptyGrid(height, width, fill = 'open') {
    const terrain = [];
    for (let r = 0; r < height; r++) {
      terrain.push(new Array(width).fill(fill));
    }
    return terrain;
  }

  static _calculateNML(gridHeight, preset, mode) {
    if (mode === 'endless' || mode === 'zone') {
      // Endless/zone: entire grid is combat area, but leave margins
      return {
        startRow: 2,
        endRow: gridHeight - 2
      };
    }

    // Campaign: fixed deployment zones
    const playerRows = preset.playerRows ?? 4;
    const enemyRows = preset.enemyRows ?? 4;
    return {
      startRow: enemyRows,
      endRow: gridHeight - playerRows
    };
  }

  static _mergeFeatures(base, override) {
    const result = { ...base };
    for (const [key, value] of Object.entries(override)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = { ...result[key], ...value };
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  static _generateBase(terrain, rng, bounds, nml, config, previousEdge) {
    // Blend with previous zone edge
    if (previousEdge && config.blendEdges) {
      blendEdge({
        terrain,
        previousEdge,
        blendRows: config.blendRows ?? 2,
        blendChance: 0.7,
        rng,
        bounds
      });
    }

    // Fill base layer
    if (config.baseLayer?.enabled) {
      fillBase({
        terrain,
        baseType: 'open',
        scatterType: 'grass',
        scatterChance: config.baseLayer.scatterChance ?? 0.5,
        rng,
        bounds,
        zone: nml
      });
    }
  }

  static _generateFeatures(terrain, rng, bounds, nml, config, mode) {
    const { height, width } = bounds;

    // Order matters: place larger/blocking features first

    // 1. Ridges / High ground
    this._placeRidges(terrain, rng, bounds, nml, config);

    // 2. Water features
    this._placeWater(terrain, rng, bounds, nml, config);

    // 3. Forest clusters (before brush, since forests have brush edges)
    this._placeForests(terrain, rng, bounds, nml, config);

    // 4. Brush clusters
    this._placeBrush(terrain, rng, bounds, nml, config);

    // 5. Fortifications (campaign mode)
    if (mode === 'campaign' && config.fortifications) {
      this._placeFortifications(terrain, rng, bounds, nml, config.fortifications);
    }

    // 6. Individual trenches (zone/endless)
    this._placeTrenches(terrain, rng, bounds, nml, config);

    // 7. Individual pillboxes (zone)
    this._placePillboxes(terrain, rng, bounds, config);
  }

  static _placeRidges(terrain, rng, bounds, nml, config) {
    const ridgeConfig = config.ridge;
    if (!ridgeConfig) return;

    const count = this._resolveCount(ridgeConfig.count, rng);
    if (count <= 0) return;

    const { height, width } = bounds;

    for (let i = 0; i < count; i++) {
      // Place ridge in middle area of NML
      const row = nml.startRow + Math.floor((nml.endRow - nml.startRow) / 2) + rng.int(-2, 2);
      const length = rng.int(ridgeConfig.minLength ?? 4, ridgeConfig.maxLength ?? 10);
      const startCol = rng.int(1, width - length - 1);

      placeLine({
        terrain,
        type: 'high',
        row,
        col: startCol,
        length,
        direction: 'horizontal',
        rng,
        bounds,
        natural: true
      });
    }
  }

  static _placeWater(terrain, rng, bounds, nml, config) {
    const waterConfig = config.water;
    if (!waterConfig?.enabled) return;

    // Check chance
    if (waterConfig.chance !== undefined && !rng.chance(waterConfig.chance)) return;

    const { height, width } = bounds;

    // Place river in NML area
    const row = nml.startRow + 3 + rng.int(0, Math.max(0, nml.endRow - nml.startRow - 6));
    const startCol = rng.int(0, 3);
    const endCol = width - rng.int(0, 3);

    placeRiver({
      terrain,
      row,
      startCol,
      endCol,
      rng,
      bounds,
      crossings: waterConfig.crossings ?? 1
    });
  }

  static _placeForests(terrain, rng, bounds, nml, config) {
    const forestConfig = config.forest;
    if (!forestConfig) return;

    const count = this._resolveCount(forestConfig.count, rng);
    if (count <= 0) return;

    const { height, width } = bounds;

    for (let i = 0; i < count; i++) {
      const centerRow = nml.startRow + 2 + rng.int(0, Math.max(0, nml.endRow - nml.startRow - 5));
      const centerCol = rng.int(4, width - 5);
      const size = rng.int(forestConfig.minSize ?? 2, forestConfig.maxSize ?? 4);

      placeCluster({
        terrain,
        type: 'forest',
        row: centerRow,
        col: centerCol,
        size,
        rng,
        density: forestConfig.density ?? 0.75,
        edgeType: forestConfig.withBrushEdge ? 'brush' : null,
        bounds,
        zone: nml
      });
    }
  }

  static _placeBrush(terrain, rng, bounds, nml, config) {
    const brushConfig = config.brush;
    if (!brushConfig) return;

    const count = this._resolveCount(brushConfig.count, rng);
    if (count <= 0) return;

    const { height, width } = bounds;

    for (let i = 0; i < count; i++) {
      const centerRow = nml.startRow + 1 + rng.int(0, Math.max(0, nml.endRow - nml.startRow - 3));
      const centerCol = rng.int(2, width - 3);
      const size = rng.int(brushConfig.minSize ?? 1, brushConfig.maxSize ?? 2);

      placeCluster({
        terrain,
        type: 'brush',
        row: centerRow,
        col: centerCol,
        size,
        rng,
        density: brushConfig.density ?? 0.6,
        bounds,
        zone: nml
      });
    }
  }

  static _placeFortifications(terrain, rng, bounds, nml, fortConfig) {
    const { height, width } = bounds;

    // Player fortifications (near bottom of NML)
    if (fortConfig.player?.enabled) {
      const row = nml.endRow - 2;
      const startCol = 4 + rng.int(0, 3);
      const length = rng.int(
        fortConfig.player.minLength ?? 6,
        fortConfig.player.maxLength ?? 12
      );

      placeFortification({
        terrain,
        row,
        col: startCol,
        length,
        rng,
        bounds,
        includePillbox: true,
        pillboxOffset: 1
      });
    }

    // Enemy fortifications (near top of NML)
    if (fortConfig.enemy?.enabled && rng.chance(fortConfig.enemy.chance ?? 0.5)) {
      const row = nml.startRow + 1;
      const startCol = 8 + rng.int(0, 5);
      const length = rng.int(
        fortConfig.enemy.minLength ?? 4,
        fortConfig.enemy.maxLength ?? 8
      );

      placeFortification({
        terrain,
        row,
        col: startCol,
        length,
        rng,
        bounds,
        includePillbox: true,
        pillboxOffset: -1
      });
    }
  }

  static _placeTrenches(terrain, rng, bounds, nml, config) {
    const trenchConfig = config.trench;
    if (!trenchConfig) return;

    const count = this._resolveCount(trenchConfig.count, rng);
    if (count <= 0) return;

    const { height, width } = bounds;

    for (let i = 0; i < count; i++) {
      const row = nml.startRow + 2 + rng.int(0, Math.max(0, nml.endRow - nml.startRow - 4));
      const startCol = 2 + rng.int(0, width - 8);
      const length = rng.int(trenchConfig.minLength ?? 3, trenchConfig.maxLength ?? 6);

      placeLine({
        terrain,
        type: 'trench',
        row,
        col: startCol,
        length,
        direction: 'horizontal',
        rng,
        bounds
      });
    }
  }

  static _placePillboxes(terrain, rng, bounds, config) {
    const pillboxConfig = config.pillbox;
    if (!pillboxConfig) return;

    const count = this._resolveCount(pillboxConfig.count, rng);
    if (count <= 0) return;

    const { height, width } = bounds;

    for (let i = 0; i < count; i++) {
      const row = 3 + rng.int(0, height - 6);
      const col = 2 + rng.int(0, width - 4);

      placePoint({
        terrain,
        type: 'pillbox',
        row,
        col,
        bounds
      });
    }
  }

  /**
   * Resolve count from number, array [min, max], or undefined
   */
  static _resolveCount(countConfig, rng) {
    if (countConfig === undefined || countConfig === null) return 0;
    if (typeof countConfig === 'number') return countConfig;
    if (Array.isArray(countConfig)) {
      return rng.int(countConfig[0], countConfig[1]);
    }
    return 0;
  }
}

// Export convenience functions
export const generateTerrain = (config) => WorldBuilder.generate(config);
export const generateCampaignTerrain = (seed) => WorldBuilder.generateForCampaign(seed);
export const generateZoneTerrain = (zone, width, prevEdge, seed) => WorldBuilder.generateForZone(zone, width, prevEdge, seed);
export const generateEndlessTerrain = (wave, seed) => WorldBuilder.generateForEndless(wave, seed);

// ═══════════════════════════════════════════════════════════════
// STROKE-BASED TERRAIN SYSTEM (v2)
// ═══════════════════════════════════════════════════════════════

// Re-export stroke system components
export { createStroke, createTerrainMap, createEmptyCell, FEATURE_DEFS, GROUND_TEXTURES, FALLOFF, TREE_TYPES, TREE_AGES, TREE_AGE_THRESHOLD, BRUSH_TYPES, PARTICLE_TYPES, TREE_TO_PARTICLES, TREE_TO_BRUSH, COLOR_VARIATION, generateTreesForStroke, removeTreesForStroke, removeTreesInRadius, getTreesSortedByScale, generateBrushForStroke, removeBrushForStroke, removeBrushInRadius, getBrushSortedByScale, generateParticlesForTree, generateParticlesForStroke, removeParticlesForParent, removeParticlesForStroke, removeParticlesInRadius, getParticlesSortedByY } from './strokes.js';
export { paint, paintTrees, erase, addStroke, removeStroke, clearStrokes, getStrokesAt } from './stroke-painter.js';
export { rasterize, ensureRasterized } from './rasterize.js';
export {
  getTerrainAt,
  getTerrainSpeedMod,
  isTerrainBlocked,
  getCoverBonus,
  getVisibility,
  getFeatureCoverage,
  isConcealed,
  isInCover,
  isUnderCanopy,
  getCellData,
  getGridCoords
} from './terrain-query.js';
export { renderBaseLayer, renderCanopyLayer, renderTerrain } from './stroke-renderer.js';
export {
  legacyToTerrainMap,
  terrainMapToLegacy,
  wrapBattleForTerrain,
  createBattleTerrainQueries,
  exportTerrainMap,
  importTerrainMap
} from './compat.js';
