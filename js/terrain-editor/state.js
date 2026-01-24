// ═══════════════════════════════════════════════════════════════
// TERRAIN EDITOR - State Management
// Centralized state with event emission
// ═══════════════════════════════════════════════════════════════

import { EventEmitter, Events } from './events.js';
import { createTerrainMap, generateTreesForStroke, removeTreesForStroke, removeTreesInRadius, generateBrushForStroke, removeBrushForStroke, removeBrushInRadius, generateParticlesForStroke, removeParticlesForStroke, removeParticlesInRadius, removeParticlesForParent } from '../world-builder/index.js';

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
  treeType: 'oak',              // Legacy single type (fallback)
  treeTypes: ['oak'],           // Multi-select tree types (includes dead variants like 'oak-dead')
  treeRatios: { oak: 1.0 },     // Ratios for each selected type
  treeDensity: 5,
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
  waterFadeWidth: 12,           // Water edge fade width
  shoreTextureType: 'mud',      // Shore texture around water (or 'none')
  shoreWidth: 24,               // Width of shore ring around water
  treesInWater: false,          // Allow trees to spawn in water areas

  // Brush/Undergrowth options
  brushType: 'bush-small',      // Legacy single type (fallback)
  brushTypes: ['bush-small'],   // Multi-select brush types
  brushRatios: { 'bush-small': 1.0 },  // Ratios for each selected type
  brushDensity: 4,              // Brush items per stroke (lowered for more natural look)
  brushScale: 0.12,             // Global scale multiplier for brush
  brushInWater: false,          // Allow brush to spawn in water areas

  // Particle options (auto-scatter with forest strokes)
  autoParticles: true,          // Auto-generate particles with forest strokes
  particleDensity: 8,           // Particles per tree (0-20)
  particleSpread: 40,           // Spread as % of canopy size (10-100)
  particleFalloff: 0.4,         // Falloff exponent (0.2=concentrated, 1.0=uniform)
  particleScale: 0.15,          // Global particle scale (0.05-0.40)

  // Delete behavior
  cascadeDelete: true           // Remove particles when deleting trees/brush
};

/**
 * Default view settings
 */
const DEFAULT_VIEW_SETTINGS = {
  showGrid: true,
  gridOpacity: 0.1,
  showBoundary: true,
  showParticleDebug: false
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

    // Generate trees for forest strokes
    if (stroke.treeType) {
      generateTreesForStroke(this._terrainMap, stroke);

      // Auto-generate particles around trees (if enabled)
      const autoParticles = options.autoParticles ?? this._toolOptions.autoParticles ?? true;
      const particleDensity = options.particleDensity ?? this._toolOptions.particleDensity ?? 8;
      const particleRadius = options.particleRadius ?? this._toolOptions.particleRadius ?? 60;
      const particleFalloff = options.particleFalloff ?? this._toolOptions.particleFalloff ?? 0.4;
      const particleScale = options.particleScale ?? this._toolOptions.particleScale ?? 0.15;
      if (autoParticles && particleDensity > 0) {
        generateParticlesForStroke(this._terrainMap, stroke.id, {
          density: particleDensity,
          radius: particleRadius,
          falloff: particleFalloff,
          scale: particleScale
        });
      }
    }

    // Generate brush items for brush strokes
    if (stroke.brushType) {
      generateBrushForStroke(this._terrainMap, stroke);
    }

    this._terrainMap.dirty = true;
    this._markDirty();
    this.emit(Events.STROKE_ADDED, { stroke });

    // Allow batching - skip render during drag painting
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

      // Remove associated trees, brush, and particles
      removeTreesForStroke(this._terrainMap, strokeId);
      removeBrushForStroke(this._terrainMap, strokeId);
      removeParticlesForStroke(this._terrainMap, strokeId);

      this._terrainMap.dirty = true;
      this._markDirty();
      this.emit(Events.STROKE_REMOVED, { stroke });
      this.emit(Events.RENDER_REQUESTED);
      return stroke;
    }
    return null;
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
      // Remove associated trees, brush, and particles for all removed strokes
      removed.forEach(stroke => {
        removeTreesForStroke(this._terrainMap, stroke.id);
        removeBrushForStroke(this._terrainMap, stroke.id);
        removeParticlesForStroke(this._terrainMap, stroke.id);
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
    this._terrainMap.trees = [];      // Clear all trees too
    this._terrainMap.brushes = [];    // Clear all brush too
    this._terrainMap.particles = [];  // Clear all particles too
    this._terrainMap.dirty = true;
    this._markDirty();
    this.emit(Events.STROKES_CLEARED);
    this.emit(Events.RENDER_REQUESTED);
  }

  clearTreesAt(x, y, radius, falloff = 'hard', options = {}) {
    const cascadeDelete = options.cascadeDelete ?? this._toolOptions.cascadeDelete ?? true;

    // If cascading, first find trees to be removed and delete their particles
    if (cascadeDelete) {
      const treesToRemove = this._terrainMap.trees.filter(tree => {
        const dx = tree.x - x;
        const dy = tree.y - y;
        return Math.sqrt(dx * dx + dy * dy) <= radius;
      });
      treesToRemove.forEach(tree => {
        removeParticlesForParent(this._terrainMap, tree.id);
      });
    }

    const removed = removeTreesInRadius(this._terrainMap, x, y, radius, falloff);
    if (removed > 0) {
      this._terrainMap.dirty = true;
      this._markDirty();
      this.emit(Events.RENDER_REQUESTED);
    }
    return removed;
  }

  clearBrushAt(x, y, radius, falloff = 'hard', options = {}) {
    const cascadeDelete = options.cascadeDelete ?? this._toolOptions.cascadeDelete ?? true;

    // If cascading, first find brush to be removed and delete their particles
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
    if (removed > 0) {
      this._terrainMap.dirty = true;
      this._markDirty();
      this.emit(Events.RENDER_REQUESTED);
    }
    return removed;
  }

  clearParticlesAt(x, y, radius) {
    const removed = removeParticlesInRadius(this._terrainMap, x, y, radius);
    if (removed > 0) {
      this._terrainMap.dirty = true;
      this._markDirty();
      this.emit(Events.RENDER_REQUESTED);
    }
    return removed;
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
  // SERIALIZATION
  // ═══════════════════════════════════════════════════════════════

  toJSON() {
    return {
      version: 3,  // Bumped for particle/brush registry support
      metadata: { ...this._metadata },
      baseLayer: this._terrainMap.baseLayer,
      gridWidth: this._terrainMap.gridWidth,
      gridHeight: this._terrainMap.gridHeight,
      cellSize: this._terrainMap.cellSize,
      strokes: this._terrainMap.strokes.map(s => ({ ...s })),
      trees: this._terrainMap.trees.map(t => ({ ...t })),
      brushes: (this._terrainMap.brushes || []).map(b => ({ ...b })),
      particles: (this._terrainMap.particles || []).map(p => ({ ...p }))
    };
  }

  loadFromJSON(data) {
    if (!data || (data.version !== 1 && data.version !== 2 && data.version !== 3)) {
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
