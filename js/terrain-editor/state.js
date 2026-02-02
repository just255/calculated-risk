// ═══════════════════════════════════════════════════════════════
// TERRAIN EDITOR - State Management
// Centralized state with event emission
// ═══════════════════════════════════════════════════════════════

import { EventEmitter, Events } from './events.js';
// Legacy imports (deprecated - keeping for backwards compatibility)
import { createTerrainMap, generateTreesForStroke, removeTreesForStroke, removeTreesInRadius, generateBrushForStroke, removeBrushForStroke, removeBrushInRadius, generateParticlesForStroke, removeParticlesForStroke, removeParticlesInRadius, removeParticlesForParent, generateFloorPatchesForStroke, removeFloorPatchesForStroke, removeFloorPatchesInRadius, removeFloorPatchesForParent } from '../world-builder/index.js';
// NEW: Unified scatter system
import { generateScatter, generateForestItems, removeScatterByStroke, removeScatterInRadius, getScatterByCategory, SCATTER_TYPES, rebuildSpatialHash } from '../world-builder/index.js';
// NEW: Animation system
import { animateNewItems } from '../world-builder/scatter-animation.js';

/**
 * Default editor configuration
 */
const DEFAULT_CONFIG = {
  gridWidth: 24,
  gridHeight: 24,
  cellSize: 64,
  baseLayer: 'grass-1'
};

/**
 * Default tool options
 */
const DEFAULT_TOOL_OPTIONS = {
  brushRadius: 60,
  falloff: 'smooth',
  brushShape: 'circle',         // Brush shape: 'circle' or 'square'
  clearMode: 'all',             // What to clear: 'all', 'trees', 'water', 'groundTexture', 'forest'
  featureType: 'forest',
  treeType: 'pine',             // Legacy single type (fallback)
  treeTypes: ['pine'],          // Multi-select tree types
  treeRatios: { pine: 1.0 },    // Ratios for each selected type
  deadTypes: [],                // Which species can have dead variants (e.g., ['oak-dead', 'pine-dead'])
  deadRatio: 0.2,               // Percentage of trees that spawn as dead (0-1)
  treeDensity: 1.0,             // Density multiplier (0.5-2.0): affects spacing between trees
  treeSpacing: 1.0,             // Spacing multiplier (0.5-1.5): scales tree-to-tree collision radius
  treeScale: 0.35,              // Global scale multiplier for trees (0.03-0.6)
  selectedAges: ['young', 'transitional', 'old'],  // Which ages to include
  ageRatios: { young: 0.333, transitional: 0.333, old: 0.334 },  // Ratios for each selected age
  // Ground texture options
  autoGroundTexture: true,      // Auto-paint ground texture with features
  groundTextureType: 'grass-1', // Manual ground texture type when painting groundTexture (matches default base layer)
  fadeWidth: 12,                // Width of soft alpha fade at edges in pixels (0 = hard edge)
  floorRadiusPercent: 30,       // Forest floor extends X% beyond canopy (10-100)
  floorFade: 100,               // Floor fade percentage (0=hard edge, 100=entire ring fades)
  floorIntensity: 70,           // Forest floor opacity/darkness (30-100%)

  // Water options
  waterTextureType: 'water',    // Water texture to paint
  waterFalloff: 30,             // Water edge falloff (0-100%): how soft the edges are
  waterDepth: 70,               // Deep water opacity (10-100%): how dark/deep it appears
  shoreTextureType: 'mud',      // Shore texture around water (or 'none')
  shoreWidth: 24,               // Width of shore ring around water
  shoreFadeWidth: 12,           // Shore edge fade width (independent from water)
  treesInWater: false,          // Allow trees to spawn in water areas

  // Animation options
  animationStyle: 'deploy',     // 'none', 'digitize', 'scan', 'deploy', 'flash', 'ripple'

  // Brush/Undergrowth options (independent of trees, with own floor/particles)
  brushType: 'fern',            // Legacy single type (fallback)
  brushTypes: ['fern'],         // Multi-select brush types
  brushRatios: { 'fern': 1.0 }, // Ratios for each selected type
  brushDensity: 1.0,            // Density multiplier (0-2.0): affects spacing between brush
  brushScale: 0.25,             // Global scale multiplier for brush
  brushInWater: false,          // Allow brush to spawn in water areas

  // Category toggles (enable/disable each category independently)
  treesEnabled: true,           // Generate trees
  floorEnabled: true,           // Generate floor (as children or direct)
  particlesEnabled: true,       // Generate particles (as children or direct)
  brushEnabled: true,           // Generate brush

  // Particle options (auto-scatter with forest strokes)
  autoParticles: true,          // Auto-generate particles with forest strokes
  particleDensity: 8,           // Particles per tree (0-20)
  particleSpread: 40,           // Spread as % of canopy size (10-100)
  particleFalloff: 0.4,         // Falloff exponent (0.2=concentrated, 1.0=uniform)
  particleScale: 0.15,          // Global particle scale (0.05-0.40)

  // Environment presets
  biome: 'conifer',             // Biome preset key (sets tree ratios, brush, etc.)
  season: 'summer',             // 'spring', 'summer', 'fall', 'winter'

  // Generation system
  useScatterSystem: false,      // false = legacy system, true = new scatter system

  // Child spawn overrides (scatter system)
  childSpawnOverrides: {
    floor: {
      enabled: true,
      type: 'auto',          // 'auto' = match tree type, or specific floor type
      density: 6,            // Base density per tree
      scale: 0.5,            // Scale multiplier (0.1 = 10%, 1.0 = 100%)
      radius: 1.3,           // Max radius as % of canopy (1.3 = 130%)
      alphaMin: 0.3,         // Min alpha for floor patches
      alphaMax: 0.9          // Max alpha for floor patches
    },
    particle: {
      enabled: true,
      type: 'auto',          // 'auto' = match tree type, or specific particle type
      density: 4,            // Base density per tree
      scale: 0.35,           // Scale multiplier
      radiusMin: 0.9,        // Min radius as % of canopy
      radiusMax: 1.5         // Max radius as % of canopy
    },
    brush: {
      enabled: true,
      type: 'auto',          // 'auto' = match tree type, or specific brush type
      density: 1,            // Base density per tree
      scale: 0.25,           // Scale multiplier
      radiusMin: 0.9,        // Min radius as % of canopy
      radiusMax: 1.4         // Max radius as % of canopy
    }
  },

  // Delete behavior
  cascadeDelete: true,          // Remove particles when deleting trees/brush

  // Preview seed (shared between sidebar and on-canvas preview, applied to strokes on paint)
  previewSeed: Math.floor(Math.random() * 1000000)
};

/**
 * Default view settings
 */
const DEFAULT_VIEW_SETTINGS = {
  showGrid: true,
  gridOpacity: 0.35,
  showBoundary: true,
  showParticleDebug: false,
  useScatterRendering: false,  // Toggle between legacy and new scatter system rendering
  showScatterPreview: false,   // Show scatter preview on canvas at cursor position
  showGroundPreview: true,     // Show ground texture preview on canvas
  showWaterPreview: true       // Show water texture preview on canvas
};

/**
 * Editor state management
 */
export class EditorState extends EventEmitter {
  constructor(config = {}) {
    super();

    const cfg = { ...DEFAULT_CONFIG, ...config };

    // Terrain data
    this._terrainMap = createTerrainMap(
      cfg.gridWidth,
      cfg.gridHeight,
      cfg.cellSize,
      cfg.baseLayer
    );

    // Tool state
    this._activeTool = 'paint';
    this._toolOptions = { ...DEFAULT_TOOL_OPTIONS };

    // Selection state
    this._selection = [];

    // Viewport state
    this._viewport = {
      x: 0,
      y: 0,
      zoom: 1,
      minZoom: 0.25,
      maxZoom: 4
    };

    // Map metadata
    this._metadata = {
      name: 'Untitled Map',
      author: '',
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };

    // View settings
    this._viewSettings = { ...DEFAULT_VIEW_SETTINGS };

    // Dirty flag (unsaved changes)
    this._dirty = false;
  }

  // ═══════════════════════════════════════════════════════════════
  // TERRAIN MAP
  // ═══════════════════════════════════════════════════════════════

  get terrainMap() {
    return this._terrainMap;
  }

  get strokes() {
    return this._terrainMap.strokes;
  }

  get baseLayer() {
    return this._terrainMap.baseLayer;
  }

  set baseLayer(value) {
    this._terrainMap.baseLayer = value;
    this._terrainMap.dirty = true;
    this._markDirty();
    this.emit(Events.BASE_LAYER_CHANGED, { baseLayer: value });
    this.emit(Events.RENDER_REQUESTED);
  }

  get gridWidth() {
    return this._terrainMap.gridWidth;
  }

  get gridHeight() {
    return this._terrainMap.gridHeight;
  }

  get cellSize() {
    return this._terrainMap.cellSize;
  }

  get canvasWidth() {
    return this._terrainMap.gridWidth * this._terrainMap.cellSize;
  }

  get canvasHeight() {
    return this._terrainMap.gridHeight * this._terrainMap.cellSize;
  }

  // ═══════════════════════════════════════════════════════════════
  // STROKES
  // ═══════════════════════════════════════════════════════════════

  addStroke(stroke, skipRender = false, options = {}) {
    this._terrainMap.strokes.push(stroke);

    const useScatter = this._toolOptions.useScatterSystem ?? false;
    const skipAnimation = options.skipAnimation ?? false;  // Skip for loading, PCG, etc.
    let newItems = [];

    // ═══════════════════════════════════════════════════════════════
    // TREE STROKES
    // ═══════════════════════════════════════════════════════════════
    if (stroke.treeType || (stroke.treeTypes && stroke.treeTypes.length > 0)) {
      if (useScatter) {
        // SCATTER SYSTEM: Use shared forest generation (single source of truth)
        const treeTypes = stroke.treeTypes && stroke.treeTypes.length > 0
          ? stroke.treeTypes
          : [stroke.treeType || 'oak'];

        const items = generateForestItems(this._terrainMap,
          { ...stroke, seed: stroke.seed ?? Math.floor(Math.random() * 1000000) },
          {
            treeTypes,
            treeRatios: stroke.treeRatios || {},
            deadTypes: this._toolOptions.deadTypes || [],
            deadRatio: this._toolOptions.deadRatio ?? 0,
            treeDensity: stroke.density ?? this._toolOptions.treeDensity ?? 1.0,
            treeScale: stroke.treeScale ?? this._toolOptions.treeScale ?? 0.35,
            treeSpacing: this._toolOptions.treeSpacing ?? 1.0,
            selectedAges: stroke.selectedAges ?? this._toolOptions.selectedAges ?? ['young', 'transitional', 'old'],
            ageRatios: stroke.ageRatios ?? this._toolOptions.ageRatios ?? null,
            brushTypes: this._toolOptions.brushTypes || ['bush-small'],
            brushRatios: this._toolOptions.brushRatios || {},
            brushDensity: this._toolOptions.brushDensity ?? 1.0,
            brushScale: this._toolOptions.brushScale ?? 0.25,
            season: this._toolOptions.season ?? 'summer',
            biome: this._toolOptions.biome ?? 'temperate',
            seasonOverrides: this._toolOptions.seasonOverrides ?? {},
            childSpawnOverrides: this._toolOptions.childSpawnOverrides ?? {},
            // Category toggles
            treesEnabled: this._toolOptions.treesEnabled ?? true,
            floorEnabled: this._toolOptions.floorEnabled ?? true,
            particlesEnabled: this._toolOptions.particlesEnabled ?? true,
            brushEnabled: this._toolOptions.brushEnabled ?? true,
            strokeId: stroke.id,
            // Water collision
            allowInWater: stroke.allowTreesInWater ?? false
          }
        );
        newItems.push(...items);
      } else {
        // LEGACY SYSTEM: Trees + particles (floor uses ground texture, not discrete sprites)
        generateTreesForStroke(this._terrainMap, stroke);

        // Particles still use discrete sprites
        const autoParticles = options.autoParticles ?? this._toolOptions.autoParticles ?? true;
        const particleDensity = options.particleDensity ?? this._toolOptions.particleDensity ?? 8;
        if (autoParticles && particleDensity > 0) {
          generateParticlesForStroke(this._terrainMap, stroke.id, {
            density: particleDensity,
            radius: options.particleRadius ?? this._toolOptions.particleRadius ?? 60,
            falloff: options.particleFalloff ?? this._toolOptions.particleFalloff ?? 0.4,
            scale: options.particleScale ?? this._toolOptions.particleScale ?? 0.15
          });
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // BRUSH STROKES - Brush as parent with floor/particle children
    // ═══════════════════════════════════════════════════════════════
    if (stroke.brushType || (stroke.brushTypes && stroke.brushTypes.length > 0)) {
      if (useScatter) {
        // SCATTER SYSTEM: Use shared forest generation with trees disabled
        const brushTypes = stroke.brushTypes && stroke.brushTypes.length > 0
          ? stroke.brushTypes
          : [stroke.brushType || 'bush-small'];

        const items = generateForestItems(this._terrainMap,
          { ...stroke, seed: stroke.seed ?? Math.floor(Math.random() * 1000000) },
          {
            // Disable trees - brush is the parent
            treesEnabled: false,
            treeTypes: [],
            // Brush settings
            brushTypes,
            brushRatios: stroke.brushRatios || this._toolOptions.brushRatios || {},
            brushDensity: stroke.density ?? this._toolOptions.brushDensity ?? 1.0,
            brushScale: stroke.brushScale ?? this._toolOptions.brushScale ?? 0.25,
            brushEnabled: true,
            // Floor/particle children
            floorEnabled: stroke.floorEnabled ?? this._toolOptions.floorEnabled ?? true,
            particlesEnabled: stroke.particlesEnabled ?? this._toolOptions.particlesEnabled ?? true,
            // Season/biome
            season: this._toolOptions.season ?? 'summer',
            biome: this._toolOptions.biome ?? 'temperate',
            seasonOverrides: this._toolOptions.seasonOverrides ?? {},
            childSpawnOverrides: this._toolOptions.childSpawnOverrides ?? {},
            strokeId: stroke.id,
            // Water collision
            allowInWater: stroke.allowBrushInWater ?? false
          }
        );
        newItems.push(...items);
      } else {
        // LEGACY SYSTEM
        generateBrushForStroke(this._terrainMap, stroke);
      }
    }

    // Trigger placement animations for newly created scatter items
    if (newItems.length > 0 && !skipAnimation) {
      const animStyle = this._toolOptions.animationStyle ?? 'digitize';
      animateNewItems(newItems, SCATTER_TYPES, animStyle);
    }

    this._terrainMap.dirty = true;
    this._markDirty();
    this.emit(Events.STROKE_ADDED, { stroke });

    if (!skipRender) {
      this.emit(Events.RENDER_REQUESTED);
    }
    return stroke;
  }

  /**
   * Request a render (used after batch operations)
   */
  requestRender() {
    this.emit(Events.RENDER_REQUESTED);
  }

  removeStroke(strokeId) {
    const index = this._terrainMap.strokes.findIndex(s => s.id === strokeId);
    if (index !== -1) {
      const stroke = this._terrainMap.strokes.splice(index, 1)[0];

      // NEW: Remove from unified scatter system
      removeScatterByStroke(this._terrainMap, strokeId);

      // LEGACY: Also remove from old arrays for backwards compatibility
      removeTreesForStroke(this._terrainMap, strokeId);
      removeBrushForStroke(this._terrainMap, strokeId);
      removeParticlesForStroke(this._terrainMap, strokeId);
      removeFloorPatchesForStroke(this._terrainMap, strokeId);

      this._terrainMap.dirty = true;
      this._markDirty();
      this.emit(Events.STROKE_REMOVED, { stroke });
      this.emit(Events.RENDER_REQUESTED);
      return stroke;
    }
    return null;
  }

  /**
   * Remove shore strokes that overlap with a water area
   * Called when painting water to "absorb" existing shore
   * @param {number} x - Center X
   * @param {number} y - Center Y
   * @param {number} radius - Water stroke radius
   */
  removeShoreStrokesAt(x, y, radius) {
    const removed = [];

    this._terrainMap.strokes = this._terrainMap.strokes.filter(stroke => {
      // Only remove shore strokes
      if (!stroke.isShore) return true;

      const dx = stroke.x - x;
      const dy = stroke.y - y;
      const distSq = dx * dx + dy * dy;

      // Remove if the shore center is inside the water radius
      // This means the water covers the shore
      if (distSq < radius * radius) {
        removed.push(stroke);
        return false;
      }
      return true;
    });

    if (removed.length > 0) {
      this._terrainMap.dirty = true;
      this._markDirty();
    }

    return removed;
  }

  removeStrokesAt(x, y, radius) {
    const removed = [];
    const radiusSq = radius * radius;

    this._terrainMap.strokes = this._terrainMap.strokes.filter(stroke => {
      const dx = stroke.x - x;
      const dy = stroke.y - y;
      const distSq = dx * dx + dy * dy;
      const combinedRadius = stroke.radius + radius;

      if (distSq < combinedRadius * combinedRadius) {
        removed.push(stroke);
        return false;
      }
      return true;
    });

    if (removed.length > 0) {
      // Remove associated items for all removed strokes
      removed.forEach(stroke => {
        // NEW: Remove from unified scatter system
        removeScatterByStroke(this._terrainMap, stroke.id);

        // LEGACY: Also remove from old arrays
        removeTreesForStroke(this._terrainMap, stroke.id);
        removeBrushForStroke(this._terrainMap, stroke.id);
        removeParticlesForStroke(this._terrainMap, stroke.id);
        removeFloorPatchesForStroke(this._terrainMap, stroke.id);
      });

      this._terrainMap.dirty = true;
      this._markDirty();
      removed.forEach(stroke => this.emit(Events.STROKE_REMOVED, { stroke }));
      this.emit(Events.RENDER_REQUESTED);
    }

    return removed;
  }

  clearStrokes() {
    this._terrainMap.strokes = [];
    this._terrainMap.trees = [];        // Clear all trees too
    this._terrainMap.brushes = [];      // Clear all brush too
    this._terrainMap.particles = [];    // Clear all particles too
    this._terrainMap.floorPatches = []; // Clear all floor patches too
    this._terrainMap.scatterItems = []; // NEW: Clear unified scatter items
    // Clear spatial hash index
    if (this._terrainMap._spatialHash) {
      this._terrainMap._spatialHash.clear();
    }
    this._terrainMap.dirty = true;
    this._markDirty();
    this.emit(Events.STROKES_CLEARED);
    this.emit(Events.RENDER_REQUESTED);
  }

  clearTreesAt(x, y, radius, falloff = 'hard', options = {}) {
    const cascadeDelete = options.cascadeDelete ?? this._toolOptions.cascadeDelete ?? true;

    // NEW: Remove from unified scatter system (cascade is automatic)
    const scatterRemoved = removeScatterInRadius(this._terrainMap, x, y, radius, {
      categories: ['tree'],
      cascade: cascadeDelete,
      falloff
    });

    // LEGACY: If cascading, first find trees to be removed and delete their particles and floor patches
    if (cascadeDelete) {
      const treesToRemove = this._terrainMap.trees.filter(tree => {
        const dx = tree.x - x;
        const dy = tree.y - y;
        return Math.sqrt(dx * dx + dy * dy) <= radius;
      });
      treesToRemove.forEach(tree => {
        removeParticlesForParent(this._terrainMap, tree.id);
        removeFloorPatchesForParent(this._terrainMap, tree.id);
      });
    }

    const removed = removeTreesInRadius(this._terrainMap, x, y, radius, falloff);
    if (removed > 0 || scatterRemoved > 0) {
      this._terrainMap.dirty = true;
      this._markDirty();
      this.emit(Events.RENDER_REQUESTED);
    }
    return removed + scatterRemoved;
  }

  clearBrushAt(x, y, radius, falloff = 'hard', options = {}) {
    const cascadeDelete = options.cascadeDelete ?? this._toolOptions.cascadeDelete ?? true;

    // NEW: Remove from unified scatter system
    const scatterRemoved = removeScatterInRadius(this._terrainMap, x, y, radius, {
      categories: ['brush'],
      cascade: cascadeDelete,
      falloff
    });

    // LEGACY: If cascading, first find brush to be removed and delete their particles
    if (cascadeDelete) {
      const brushToRemove = (this._terrainMap.brushes || []).filter(brush => {
        const dx = brush.x - x;
        const dy = brush.y - y;
        return Math.sqrt(dx * dx + dy * dy) <= radius;
      });
      brushToRemove.forEach(brush => {
        removeParticlesForParent(this._terrainMap, brush.id);
      });
    }

    const removed = removeBrushInRadius(this._terrainMap, x, y, radius, falloff);
    if (removed > 0 || scatterRemoved > 0) {
      this._terrainMap.dirty = true;
      this._markDirty();
      this.emit(Events.RENDER_REQUESTED);
    }
    return removed + scatterRemoved;
  }

  clearParticlesAt(x, y, radius) {
    // NEW: Remove from unified scatter system
    const scatterRemoved = removeScatterInRadius(this._terrainMap, x, y, radius, {
      categories: ['particle'],
      cascade: false
    });

    // LEGACY
    const removed = removeParticlesInRadius(this._terrainMap, x, y, radius);
    if (removed > 0 || scatterRemoved > 0) {
      this._terrainMap.dirty = true;
      this._markDirty();
      this.emit(Events.RENDER_REQUESTED);
    }
    return removed + scatterRemoved;
  }

  // ═══════════════════════════════════════════════════════════════
  // TOOLS
  // ═══════════════════════════════════════════════════════════════

  get activeTool() {
    return this._activeTool;
  }

  set activeTool(toolName) {
    const previous = this._activeTool;
    this._activeTool = toolName;
    this.emit(Events.TOOL_CHANGED, { tool: toolName, previous });
  }

  get toolOptions() {
    return this._toolOptions;
  }

  setToolOption(key, value) {
    const previous = this._toolOptions[key];
    this._toolOptions[key] = value;
    this.emit(Events.TOOL_OPTIONS_CHANGED, { key, value, previous });
  }

  setToolOptions(options) {
    Object.entries(options).forEach(([key, value]) => {
      this._toolOptions[key] = value;
    });
    this.emit(Events.TOOL_OPTIONS_CHANGED, { options });
  }

  // ═══════════════════════════════════════════════════════════════
  // SELECTION
  // ═══════════════════════════════════════════════════════════════

  get selection() {
    return this._selection;
  }

  select(strokes) {
    this._selection = Array.isArray(strokes) ? strokes : [strokes];
    this.emit(Events.SELECTION_CHANGED, { selection: this._selection });
    this.emit(Events.RENDER_REQUESTED);
  }

  addToSelection(stroke) {
    if (!this._selection.includes(stroke)) {
      this._selection.push(stroke);
      this.emit(Events.SELECTION_CHANGED, { selection: this._selection });
      this.emit(Events.RENDER_REQUESTED);
    }
  }

  removeFromSelection(stroke) {
    const index = this._selection.indexOf(stroke);
    if (index !== -1) {
      this._selection.splice(index, 1);
      this.emit(Events.SELECTION_CHANGED, { selection: this._selection });
      this.emit(Events.RENDER_REQUESTED);
    }
  }

  clearSelection() {
    if (this._selection.length > 0) {
      this._selection = [];
      this.emit(Events.SELECTION_CLEARED);
      this.emit(Events.RENDER_REQUESTED);
    }
  }

  getStrokesAt(x, y) {
    return this._terrainMap.strokes.filter(stroke => {
      const dx = stroke.x - x;
      const dy = stroke.y - y;
      return Math.sqrt(dx * dx + dy * dy) <= stroke.radius;
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // VIEWPORT
  // ═══════════════════════════════════════════════════════════════

  get viewport() {
    return this._viewport;
  }

  pan(dx, dy) {
    this._viewport.x += dx;
    this._viewport.y += dy;
    this.emit(Events.VIEWPORT_CHANGED, { viewport: this._viewport });
    this.emit(Events.RENDER_REQUESTED);
  }

  setViewport(x, y, zoom) {
    this._viewport.x = x;
    this._viewport.y = y;
    if (zoom !== undefined) {
      this._viewport.zoom = Math.max(
        this._viewport.minZoom,
        Math.min(this._viewport.maxZoom, zoom)
      );
    }
    this.emit(Events.VIEWPORT_CHANGED, { viewport: this._viewport });
    this.emit(Events.RENDER_REQUESTED);
  }

  zoom(delta, centerX, centerY) {
    const oldZoom = this._viewport.zoom;
    const newZoom = Math.max(
      this._viewport.minZoom,
      Math.min(this._viewport.maxZoom, oldZoom * (1 + delta))
    );

    if (newZoom !== oldZoom) {
      // Zoom toward point
      const scale = newZoom / oldZoom;
      this._viewport.x = centerX - (centerX - this._viewport.x) * scale;
      this._viewport.y = centerY - (centerY - this._viewport.y) * scale;
      this._viewport.zoom = newZoom;

      this.emit(Events.VIEWPORT_CHANGED, { viewport: this._viewport });
      this.emit(Events.RENDER_REQUESTED);
    }
  }

  resetViewport() {
    this._viewport.x = 0;
    this._viewport.y = 0;
    this._viewport.zoom = 1;
    this.emit(Events.VIEWPORT_CHANGED, { viewport: this._viewport });
    this.emit(Events.RENDER_REQUESTED);
  }

  // ═══════════════════════════════════════════════════════════════
  // METADATA & DIRTY STATE
  // ═══════════════════════════════════════════════════════════════

  get metadata() {
    return this._metadata;
  }

  setMetadata(data) {
    Object.assign(this._metadata, data);
    this._metadata.modified = new Date().toISOString();
  }

  get isDirty() {
    return this._dirty;
  }

  _markDirty() {
    this._dirty = true;
    this._metadata.modified = new Date().toISOString();
  }

  markClean() {
    this._dirty = false;
  }

  // ═══════════════════════════════════════════════════════════════
  // VIEW SETTINGS
  // ═══════════════════════════════════════════════════════════════

  get viewSettings() {
    return this._viewSettings;
  }

  setViewSetting(key, value) {
    this._viewSettings[key] = value;
    this.emit(Events.RENDER_REQUESTED);
  }

  // ═══════════════════════════════════════════════════════════════
  // STROKE OPTIMIZATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Check if a stroke is completely occluded by another stroke of the same type
   * @param {object} stroke - The stroke to check
   * @param {object[]} sameTypeStrokes - Array of strokes of the same type
   * @returns {boolean} True if stroke is completely hidden
   */
  _isStrokeOccluded(stroke, sameTypeStrokes) {
    for (const other of sameTypeStrokes) {
      if (other === stroke || other.id === stroke.id) continue;
      // Stroke is inside other if: distance(centers) + stroke.radius <= other.radius
      const dx = stroke.x - other.x;
      const dy = stroke.y - other.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist + stroke.radius <= other.radius) {
        return true;
      }
    }
    return false;
  }

  /**
   * Remove strokes that are completely occluded by other strokes
   * This optimizes the data by removing invisible strokes
   * @returns {number} Number of strokes removed
   */
  purgeOccludedStrokes() {
    const strokes = this._terrainMap.strokes;
    const initialCount = strokes.length;

    // Group strokes by type for occlusion testing
    const waterStrokes = strokes.filter(s => s.type === 'water');
    const shoreStrokes = strokes.filter(s => s.type === 'groundTexture' && s.isShore);
    const groundStrokes = strokes.filter(s => s.type === 'groundTexture' && !s.isShore);

    // Find occluded strokes in each group
    const occludedIds = new Set();

    for (const stroke of waterStrokes) {
      if (this._isStrokeOccluded(stroke, waterStrokes)) {
        occludedIds.add(stroke.id);
      }
    }

    for (const stroke of shoreStrokes) {
      if (this._isStrokeOccluded(stroke, shoreStrokes)) {
        occludedIds.add(stroke.id);
      }
    }

    for (const stroke of groundStrokes) {
      if (this._isStrokeOccluded(stroke, groundStrokes)) {
        occludedIds.add(stroke.id);
      }
    }

    // Remove occluded strokes
    if (occludedIds.size > 0) {
      this._terrainMap.strokes = strokes.filter(s => !occludedIds.has(s.id));
      this._terrainMap.dirty = true;
      console.log(`[State] Purged ${occludedIds.size} occluded strokes`);
    }

    return occludedIds.size;
  }

  // ═══════════════════════════════════════════════════════════════
  // SERIALIZATION
  // ═══════════════════════════════════════════════════════════════

  toJSON() {
    // Optimize data before saving - remove hidden strokes
    this.purgeOccludedStrokes();
    return {
      version: 5,  // Bumped for unified scatter system
      metadata: { ...this._metadata },
      baseLayer: this._terrainMap.baseLayer,
      gridWidth: this._terrainMap.gridWidth,
      gridHeight: this._terrainMap.gridHeight,
      cellSize: this._terrainMap.cellSize,
      strokes: this._terrainMap.strokes.map(s => ({ ...s })),
      // Legacy arrays (for backwards compatibility)
      trees: this._terrainMap.trees.map(t => ({ ...t })),
      brushes: (this._terrainMap.brushes || []).map(b => ({ ...b })),
      particles: (this._terrainMap.particles || []).map(p => ({ ...p })),
      floorPatches: (this._terrainMap.floorPatches || []).map(f => ({ ...f })),
      // NEW: Unified scatter items
      scatterItems: (this._terrainMap.scatterItems || []).map(item => ({ ...item }))
    };
  }

  loadFromJSON(data) {
    if (!data || (data.version !== 1 && data.version !== 2 && data.version !== 3 && data.version !== 4 && data.version !== 5)) {
      throw new Error('Invalid map data format');
    }

    // Reset terrain map
    this._terrainMap = createTerrainMap(
      data.gridWidth || DEFAULT_CONFIG.gridWidth,
      data.gridHeight || DEFAULT_CONFIG.gridHeight,
      data.cellSize || DEFAULT_CONFIG.cellSize,
      data.baseLayer || DEFAULT_CONFIG.baseLayer
    );

    // Load strokes
    this._terrainMap.strokes = data.strokes || [];

    // Load or regenerate trees
    if (data.version >= 2 && data.trees) {
      this._terrainMap.trees = data.trees;
    } else {
      // Version 1: Regenerate trees from strokes
      this._terrainMap.trees = [];
      for (const stroke of this._terrainMap.strokes) {
        if (stroke.treeType) {
          generateTreesForStroke(this._terrainMap, stroke);
        }
      }
    }

    // Load or regenerate brush
    if (data.version >= 3 && data.brushes) {
      this._terrainMap.brushes = data.brushes;
    } else {
      // Regenerate brush from strokes
      this._terrainMap.brushes = [];
      for (const stroke of this._terrainMap.strokes) {
        if (stroke.brushType) {
          generateBrushForStroke(this._terrainMap, stroke);
        }
      }
    }

    // Load or regenerate particles
    if (data.version >= 3 && data.particles) {
      this._terrainMap.particles = data.particles;
    } else {
      // Regenerate particles from trees (use defaults for old maps)
      this._terrainMap.particles = [];
      for (const stroke of this._terrainMap.strokes) {
        if (stroke.treeType) {
          generateParticlesForStroke(this._terrainMap, stroke.id, {
            density: 8,
            radius: 60,
            falloff: 0.4
          });
        }
      }
    }

    // Load or regenerate floor patches
    if (data.version >= 4 && data.floorPatches) {
      this._terrainMap.floorPatches = data.floorPatches;
    } else {
      // Regenerate floor patches from trees (use defaults for old maps)
      this._terrainMap.floorPatches = [];
      for (const stroke of this._terrainMap.strokes) {
        if (stroke.treeType) {
          generateFloorPatchesForStroke(this._terrainMap, stroke.id, {
            scale: 0.5
          });
        }
      }
    }

    // NEW: Load or migrate scatterItems (version 5+)
    if (data.version >= 5 && data.scatterItems) {
      this._terrainMap.scatterItems = data.scatterItems;
      // Rebuild spatial hash for O(1) collision lookups
      rebuildSpatialHash(this._terrainMap);
    } else {
      // Migration from v1-4: Convert legacy arrays to scatterItems
      // For now, just initialize empty - full migration happens when using scatter system
      this._terrainMap.scatterItems = [];
      // TODO: Migrate legacy trees/brushes/particles/floorPatches to scatterItems
      // This will be done in a future phase when renderer is updated
    }

    this._terrainMap.dirty = true;

    // Load metadata
    this._metadata = { ...data.metadata };

    // Clear selection and mark clean
    this._selection = [];
    this._dirty = false;

    this.emit(Events.MAP_LOADED, { data });
    this.emit(Events.RENDER_REQUESTED);
  }

  newMap(config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    this._terrainMap = createTerrainMap(
      cfg.gridWidth,
      cfg.gridHeight,
      cfg.cellSize,
      cfg.baseLayer
    );

    this._metadata = {
      name: 'Untitled Map',
      author: '',
      created: new Date().toISOString(),
      modified: new Date().toISOString()
    };

    this._selection = [];
    this._dirty = false;

    this.emit(Events.MAP_CLEARED);
    this.emit(Events.RENDER_REQUESTED);
  }
}

/**
 * Create a new editor state instance
 */
export function createEditorState(config) {
  return new EditorState(config);
}
