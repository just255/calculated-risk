// ═══════════════════════════════════════════════════════════════
// BATTLE TERRAIN - PCG terrain pipeline for game battles
// Connects PCG generation → scatter population → canvas rendering
// Standalone orchestrator: no editor dependencies
// ═══════════════════════════════════════════════════════════════

import { generateBattlefield } from '../terrain-editor/pcg.js';
import { createTerrainMap } from './strokes.js';
import { generateForestItems, removeScatterInRadius } from './scatter.js';
import { renderScatterLayer } from './scatter-renderer.js';
import { renderGroundLayer } from './ground-renderer.js';
import { BIOME_PRESETS, SCATTER_TYPES } from './season-config.js';
import { ensureRasterized } from './rasterize.js';
import { renderBridgeDecks, renderBridgeTrusses } from './bridge-renderer.js';

// ═══════════════════════════════════════════════════════════════
// IMAGE LOADING (cached singleton)
// ═══════════════════════════════════════════════════════════════

let _cachedImages = null;
let _loadPromise = null;

/**
 * Load a single image from a URL path.
 * @returns {Promise<HTMLImageElement|null>}
 */
function loadImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn(`[battle-terrain] Failed to load: ${src}`);
      resolve(null);
    };
    img.src = src;
  });
}

/**
 * Preload all terrain sprite images from the server manifest.
 * Cached as module-level singleton — subsequent calls return immediately.
 * @returns {Promise<object>} Image collections { ground, trees, brush, floor, particles, boulders, bridge }
 */
export async function loadTerrainImages() {
  if (_cachedImages) return _cachedImages;
  if (_loadPromise) return _loadPromise;

  _loadPromise = _doLoadImages();
  _cachedImages = await _loadPromise;
  _loadPromise = null;
  return _cachedImages;
}

async function _doLoadImages() {
  const images = {
    ground: {},
    trees: {},
    brush: {},
    floor: {},
    particles: {},
    boulders: {},
    bridge: {}
  };

  // Fetch sprite manifest from server
  let manifest;
  try {
    const resp = await fetch('/api/terrain/sprites');
    manifest = await resp.json();
  } catch (err) {
    console.warn('[battle-terrain] Could not fetch sprite manifest:', err);
    manifest = { trees: {}, brush: {}, ground: ['grass', 'open'], water: ['water'], floor: {}, boulders: {}, particles: {}, bridge: {} };
  }

  const promises = [];

  // Ground textures (from resized/ folder)
  for (const type of (manifest.ground || [])) {
    promises.push(
      loadImage(`/sprites/terrain/ground/resized/${type}.png`)
        .then(img => { if (img) images.ground[type] = img; })
    );
  }

  // Water textures (also in ground/resized/, keyed by water type name)
  for (const type of (manifest.water || [])) {
    promises.push(
      loadImage(`/sprites/terrain/ground/resized/${type}.png`)
        .then(img => { if (img) images.ground[type] = img; })
    );
  }

  // Tree sprites
  for (const [key, path] of Object.entries(manifest.trees || {})) {
    promises.push(
      loadImage(path).then(img => { if (img) images.trees[key] = img; })
    );
  }

  // Brush sprites
  for (const [key, path] of Object.entries(manifest.brush || {})) {
    promises.push(
      loadImage(path).then(img => { if (img) images.brush[key] = img; })
    );
  }

  // Floor patch sprites
  for (const [key, path] of Object.entries(manifest.floor || {})) {
    promises.push(
      loadImage(path).then(img => { if (img) images.floor[key] = img; })
    );
  }

  // Boulder sprites
  for (const [key, path] of Object.entries(manifest.boulders || {})) {
    promises.push(
      loadImage(path).then(img => { if (img) images.boulders[key] = img; })
    );
  }

  // Particle sprites
  for (const [key, path] of Object.entries(manifest.particles || {})) {
    promises.push(
      loadImage(path).then(img => { if (img) images.particles[key] = img; })
    );
  }

  // Bridge sprites
  for (const [key, path] of Object.entries(manifest.bridge || {})) {
    promises.push(
      loadImage(path).then(img => { if (img) images.bridge[key] = img; })
    );
  }

  await Promise.all(promises);

  console.log('[battle-terrain] Images loaded:', {
    ground: Object.keys(images.ground).length,
    trees: Object.keys(images.trees).length,
    brush: Object.keys(images.brush).length,
    floor: Object.keys(images.floor).length,
    boulders: Object.keys(images.boulders).length,
    particles: Object.keys(images.particles).length
  });

  return images;
}

// ═══════════════════════════════════════════════════════════════
// TERRAIN VARIETY - Random biome/season/params per battle
// ═══════════════════════════════════════════════════════════════

/** Simple seeded PRNG (same as pcg.js uses) */
function seededRng(seed) {
  let s = seed | 0;
  return {
    next() { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; },
    int(min, max) { return min + Math.floor(this.next() * (max - min + 1)); },
    pick(arr) { return arr[this.int(0, arr.length - 1)]; },
    chance(p) { return this.next() < p; }
  };
}

// Terrain templates — each defines a biome + parameter overrides for a distinct feel
const BATTLE_TEMPLATES = [
  {
    name: 'Pine Forest',
    biome: 'conifer', seasons: ['summer', 'autumn'],
    params: { forestCount: 14, waterCount: 1, brushCount: 18, riverEnabled: false, boulderCount: 2 }
  },
  {
    name: 'River Crossing',
    biome: 'conifer', seasons: ['summer', 'autumn'],
    params: { forestCount: 8, waterCount: 0, brushCount: 12, riverEnabled: true, riverWidth: 60, boulderCount: 0, bridgeEnabled: true }
  },
  {
    name: 'Oak Woodland',
    biome: 'temperate', seasons: ['summer', 'autumn', 'winter'],
    params: { forestCount: 10, waterCount: 2, brushCount: 20, riverEnabled: false, boulderCount: 0 }
  },
  {
    name: 'Birch Grove',
    biome: 'birch-grove', seasons: ['summer', 'autumn'],
    params: { forestCount: 12, waterCount: 1, brushCount: 14, riverEnabled: false, boulderCount: 0, openGround: 50 }
  },
  {
    name: 'Wetland',
    biome: 'wetland', seasons: ['summer', 'autumn'],
    params: { forestCount: 6, waterCount: 4, brushCount: 22, riverEnabled: false, boulderCount: 0, waterVegDensity: 70 }
  },
  {
    name: 'Open Field',
    biome: 'temperate', seasons: ['summer', 'autumn'],
    params: { forestCount: 4, waterCount: 1, brushCount: 24, riverEnabled: false, boulderCount: 4, openGround: 65, heavyCover: 8 }
  },
  {
    name: 'Dense Forest',
    biome: 'conifer', seasons: ['summer', 'autumn', 'winter'],
    params: { forestCount: 20, forestMaxRadius: 180, waterCount: 0, brushCount: 10, riverEnabled: false, boulderCount: 0, openGround: 25, heavyCover: 30 }
  },
  {
    name: 'Rocky Highland',
    biome: 'conifer', seasons: ['summer', 'autumn'],
    params: { forestCount: 6, waterCount: 0, brushCount: 8, riverEnabled: false, boulderCount: 8, boulderMaxRadius: 60, rockyCount: 4, openGround: 55 }
  },
  {
    name: 'River Valley',
    biome: 'temperate', seasons: ['summer', 'autumn'],
    params: { forestCount: 10, waterCount: 2, brushCount: 16, riverEnabled: true, riverWidth: 45, boulderCount: 2, bridgeEnabled: true, bridgeStyle: 'stone' }
  },
  {
    name: 'Dead Woods',
    biome: 'dead-forest', seasons: ['autumn', 'winter'],
    params: { forestCount: 14, waterCount: 1, brushCount: 8, riverEnabled: false, boulderCount: 3, openGround: 40 }
  }
];

/**
 * Generate varied battle config from a seed.
 * Picks a random template, season, and applies per-battle jitter.
 * @param {number|null} seed - RNG seed (null = random)
 * @returns {{ biome: string, season: string, pcgParams: object }}
 */
export function randomizeBattleConfig(seed) {
  const s = seed ?? Math.floor(Math.random() * 999999);
  const rng = seededRng(s);

  const template = rng.pick(BATTLE_TEMPLATES);
  const season = rng.pick(template.seasons);

  // Apply jitter to numeric params for extra variety
  const params = { ...template.params };
  if (params.forestCount) params.forestCount += rng.int(-2, 2);
  if (params.waterCount) params.waterCount += rng.int(-1, 1);
  if (params.brushCount) params.brushCount += rng.int(-3, 3);
  if (params.boulderCount) params.boulderCount = Math.max(0, params.boulderCount + rng.int(-1, 1));

  // Occasional river even on non-river templates
  if (!params.riverEnabled && rng.chance(0.15)) {
    params.riverEnabled = true;
    params.riverWidth = rng.int(35, 55);
    params.bridgeEnabled = true;
    params.bridgeStyle = rng.chance(0.4) ? 'stone' : 'wood';
  }

  // Randomize bridge style if not explicitly set
  if (params.bridgeEnabled && !params.bridgeStyle) {
    params.bridgeStyle = rng.chance(0.3) ? 'stone' : 'wood';
  }

  console.log(`[battle-terrain] Template: ${template.name} (${season}), seed: ${s}`, params);

  return { biome: template.biome, season, pcgParams: params, templateName: template.name };
}

// ═══════════════════════════════════════════════════════════════
// TERRAIN GENERATION PIPELINE
// ═══════════════════════════════════════════════════════════════

/**
 * Generate complete battle terrain with pre-rendered canvases.
 *
 * Pipeline:
 *   1. generateBattlefield() → strokes[], spawnZones, pathData
 *   2. Create terrainMap, push strokes
 *   3. For forest/brush strokes, call generateForestItems() → scatter items
 *   4. Clear scatter along path spines
 *   5. Render ground canvas (base tile + ground strokes + scatter + water)
 *   6. Render canopy canvas (tree/brush sprites above entities)
 *   7. Return { terrainCanvas, canopyCanvas, terrainMap, spawnZones }
 *
 * @param {object} config
 * @param {number} config.mapWidth - Map width in pixels
 * @param {number} config.mapHeight - Map height in pixels
 * @param {number} config.cellSize - Cell size in pixels (default 64)
 * @param {string} config.biome - Biome key from BIOME_PRESETS (default 'conifer')
 * @param {string} config.season - Season key (default 'summer')
 * @param {number|null} config.seed - RNG seed (null = random)
 * @param {object} config.images - Preloaded image collections from loadTerrainImages()
 * @param {object} [config.pcgParams] - Additional PCG parameter overrides
 * @returns {object} { terrainCanvas, canopyCanvas, terrainMap, spawnZones }
 */
export function generateBattleTerrain(config) {
  const {
    mapWidth, mapHeight,
    cellSize = 64,
    biome = 'conifer',
    season = 'summer',
    seed = null,
    images,
    pcgParams = {}
  } = config;

  const t0 = performance.now();

  // ── Step 1: Generate strokes via PCG ──
  const pcgResult = generateBattlefield(
    { biome, seed, ...pcgParams },
    { width: mapWidth, height: mapHeight }
  );
  const { strokes, spawnZones, pathData, riverData } = pcgResult;

  console.log(`[battle-terrain] PCG generated ${strokes.length} strokes in ${(performance.now() - t0).toFixed(0)}ms`);

  // ── Step 2: Create terrainMap ──
  const gridW = Math.ceil(mapWidth / cellSize);
  const gridH = Math.ceil(mapHeight / cellSize);
  const biomePreset = BIOME_PRESETS[biome] || BIOME_PRESETS.conifer;
  const terrainMap = createTerrainMap(gridW, gridH, cellSize, 'grass-1');

  // Push all strokes to terrainMap
  for (const stroke of strokes) {
    terrainMap.strokes.push(stroke);
  }

  // Store bridge data for rendering and passability
  if (riverData?.bridge) {
    terrainMap.bridges = [riverData.bridge];
  } else {
    terrainMap.bridges = [];
  }

  // ── Step 3: Populate scatter items for forest/brush strokes ──
  const t1 = performance.now();
  let scatterCount = 0;

  for (const stroke of strokes) {
    // Forest strokes have treeTypes (from PCG's getForestOpts)
    if (stroke.type === 'forest' && stroke.treeTypes) {
      const centers = stroke.centers || [{ x: stroke.x, y: stroke.y }];
      const baseSeed = stroke.seed ?? Math.floor(Math.random() * 1000000);

      for (let i = 0; i < centers.length; i++) {
        const center = centers[i];
        const items = generateForestItems(terrainMap,
          { x: center.x, y: center.y, radius: stroke.radius, seed: baseSeed + i * 7919 },
          {
            treeTypes: stroke.treeTypes,
            treeRatios: stroke.treeRatios || {},
            treeDensity: stroke.density ?? 1.0,
            treeScale: stroke.treeScale ?? 0.35,
            treeSpacing: stroke.treeSpacing ?? 1.0,
            selectedAges: stroke.selectedAges || ['young', 'transitional', 'old'],
            ageRatios: stroke.ageRatios || null,
            brushTypes: biomePreset.brush || ['bush-small'],
            brushDensity: 1.0,
            brushScale: 0.25,
            season,
            biome,
            treesEnabled: true,
            brushEnabled: true,
            floorEnabled: true,
            particlesEnabled: true,
            allowInWater: stroke.allowTreesInWater ?? false,
            strokeId: stroke.id
          }
        );
        scatterCount += items.length;
      }
    }

    // Brush strokes have brushTypes
    if (stroke.type === 'brush' && stroke.brushTypes) {
      const centers = stroke.centers || [{ x: stroke.x, y: stroke.y }];
      const baseSeed = stroke.seed ?? Math.floor(Math.random() * 1000000);

      for (let i = 0; i < centers.length; i++) {
        const center = centers[i];
        const items = generateForestItems(terrainMap,
          { x: center.x, y: center.y, radius: stroke.radius, seed: baseSeed + i * 7919 },
          {
            treeTypes: [],
            treeDensity: 0,
            treesEnabled: false,
            brushTypes: stroke.brushTypes,
            brushRatios: stroke.brushRatios || {},
            brushDensity: stroke.density ?? 1.0,
            brushScale: stroke.brushScale ?? 0.25,
            season,
            biome,
            brushEnabled: true,
            floorEnabled: true,
            particlesEnabled: true,
            allowInWater: stroke.allowBrushInWater ?? false,
            strokeId: stroke.id
          }
        );
        scatterCount += items.length;
      }
    }
  }

  console.log(`[battle-terrain] Scatter: ${scatterCount} items in ${(performance.now() - t1).toFixed(0)}ms`);

  // ── Step 4: Clear scatter along path spines ──
  if (pathData?.spines?.length > 0) {
    const clearWidth = pathData.clearWidth || 30;
    let cleared = 0;

    for (const spine of pathData.spines) {
      const pathWidth = spine.width || clearWidth;
      for (const pt of spine.points) {
        cleared += removeScatterInRadius(terrainMap, pt.x, pt.y, pathWidth * 0.6, {
          categories: ['tree', 'brush', 'boulder'],
          cascade: true
        });
      }
    }

    if (cleared > 0) {
      console.log(`[battle-terrain] Cleared ${cleared} scatter items from paths`);
    }
  }

  // Clear scatter along bridge centerlines
  if (terrainMap.bridges?.length > 0) {
    for (const bridge of terrainMap.bridges) {
      const clearR = bridge.width / 2;
      const steps = Math.ceil(bridge.length / 4);
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) - 0.5;
        const px = bridge.x + bridge.dirX * t * bridge.length;
        const py = bridge.y + bridge.dirY * t * bridge.length;
        removeScatterInRadius(terrainMap, px, py, clearR, {
          categories: ['tree', 'brush', 'boulder'],
          cascade: true
        });
      }
    }
  }

  // ── Step 4b: Mark boulder cells as impassable ──
  ensureRasterized(terrainMap);
  let boulderCells = 0;
  for (const item of terrainMap.scatterItems) {
    const cfg = SCATTER_TYPES[item.type];
    if (!cfg || cfg.category !== 'boulder') continue;
    const col = Math.floor(item.x / cellSize);
    const row = Math.floor(item.y / cellSize);
    if (row >= 0 && row < gridH && col >= 0 && col < gridW) {
      const cell = terrainMap.grid[row][col];
      cell.isBlocked = true;
      cell.isBoulder = true;
      cell.speedMod = 0;
      cell.dominant = 'high'; // Blocks LOS like solid terrain
      cell.coverBonus = 0.9;  // Great cover adjacent
      boulderCells++;
    }
  }
  if (boulderCells > 0) {
    console.log(`[battle-terrain] Marked ${boulderCells} cells as boulder-blocked`);
  }

  // ── Step 5: Render ground canvas ──
  const t2 = performance.now();
  const terrainCanvas = renderGroundLayer(terrainMap, mapWidth, mapHeight, images);

  const scatterImages = {
    tree: images.trees,
    brush: { ...images.brush },
    boulder: images.boulders,
    floor: images.floor,
    particle: { ...images.brush, ...images.particles }
  };
  const viewport = { x: 0, y: 0, width: mapWidth, height: mapHeight };
  const scatterOpts = { skipFilters: true, skipAnimation: true };

  // Render bridge decks (on top of water, below scatter)
  const terrainCtx = terrainCanvas.getContext('2d');
  if (terrainMap.bridges?.length > 0) {
    renderBridgeDecks(terrainCtx, terrainMap.bridges, images.ground);
  }

  // Render brush, boulders, particles onto terrain canvas (below entities)
  renderScatterLayer(terrainCtx, terrainMap, 'canopy', viewport, scatterImages, {
    ...scatterOpts, excludeCategories: ['tree']
  });
  renderScatterLayer(terrainCtx, terrainMap, 'particle', viewport, scatterImages, scatterOpts);
  console.log(`[battle-terrain] Ground + sub-entity scatter rendered in ${(performance.now() - t2).toFixed(0)}ms`);

  // ── Step 6: Render canopy canvas (trees only — above entities) ──
  const t3 = performance.now();
  const canopyCanvas = document.createElement('canvas');
  canopyCanvas.width = mapWidth;
  canopyCanvas.height = mapHeight;
  const canopyCtx = canopyCanvas.getContext('2d');
  canopyCtx.imageSmoothingEnabled = false;

  renderScatterLayer(canopyCtx, terrainMap, 'canopy', viewport, scatterImages, {
    ...scatterOpts, category: 'tree'
  });
  console.log(`[battle-terrain] Tree canopy rendered in ${(performance.now() - t3).toFixed(0)}ms`);

  const totalMs = performance.now() - t0;
  console.log(`[battle-terrain] Total pipeline: ${totalMs.toFixed(0)}ms`);

  // Render bridge trusses (canopy overlay — above entities)
  if (terrainMap.bridges?.length > 0 && images.bridge) {
    renderBridgeTrusses(canopyCtx, terrainMap.bridges, images.bridge);
  }

  return {
    terrainCanvas,
    canopyCanvas,
    terrainMap,
    spawnZones
  };
}

// Bridge rendering imported from shared module: ./bridge-renderer.js
